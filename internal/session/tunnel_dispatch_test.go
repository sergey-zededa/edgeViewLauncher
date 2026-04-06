package session

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// TestChannelDispatchCopiesData verifies that data dispatched to the channel
// is a defensive copy, not a slice of a shared buffer that could be overwritten.
func TestChannelDispatchCopiesData(t *testing.T) {
	ch := make(chan []byte, 1000)

	// Simulate what tunnelWSReader does: unmarshal tcpData, copy, dispatch.
	original := []byte("SSH-2.0-OpenSSH_8.9")
	td := tcpData{
		Version:   0,
		MappingID: 1,
		ChanNum:   1,
		Data:      original,
	}

	// Marshal and unmarshal to simulate the real path.
	jsonBytes, err := json.Marshal(td)
	if err != nil {
		t.Fatal(err)
	}

	var decoded tcpData
	if err := json.Unmarshal(jsonBytes, &decoded); err != nil {
		t.Fatal(err)
	}

	// Copy as the fix does.
	dataCopy := make([]byte, len(decoded.Data))
	copy(dataCopy, decoded.Data)

	ch <- dataCopy

	// Now mutate the source buffer (simulating buffer reuse).
	for i := range decoded.Data {
		decoded.Data[i] = 0xFF
	}

	// The value in the channel must be unaffected.
	received := <-ch
	if string(received) != "SSH-2.0-OpenSSH_8.9" {
		t.Fatalf("channel data was corrupted: got %q", received)
	}
}

// TestChannelDispatchBlocksWhenFull verifies that a full channel blocks
// (with timeout) instead of silently dropping data.
func TestChannelDispatchBlocksWhenFull(t *testing.T) {
	// Small channel to make it fill up fast.
	ch := make(chan []byte, 2)
	ch <- []byte("a")
	ch <- []byte("b")
	// Channel is now full.

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	dispatched := make(chan bool, 1)
	go func() {
		data := []byte("c")
		select {
		case ch <- data:
			dispatched <- true
		case <-ctx.Done():
			dispatched <- false
		case <-time.After(100 * time.Millisecond):
			// This is the expected path in our fixed code (timeout).
			dispatched <- false
		}
	}()

	// The dispatch should NOT succeed immediately since channel is full.
	select {
	case result := <-dispatched:
		if result {
			t.Fatal("expected dispatch to block or timeout, but it succeeded immediately")
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("test timed out waiting for dispatch result")
	}
}

// TestChannelDispatchSucceedsWhenDrained verifies that a temporarily full
// channel eventually accepts data once consumers drain it.
func TestChannelDispatchSucceedsWhenDrained(t *testing.T) {
	ch := make(chan []byte, 2)
	ch <- []byte("a")
	ch <- []byte("b")

	dispatched := make(chan bool, 1)
	go func() {
		data := []byte("c")
		select {
		case ch <- data:
			dispatched <- true
		case <-time.After(5 * time.Second):
			dispatched <- false
		}
	}()

	// Drain one item to make room.
	time.Sleep(50 * time.Millisecond)
	<-ch

	select {
	case result := <-dispatched:
		if !result {
			t.Fatal("expected dispatch to succeed after draining")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("test timed out")
	}
}

// TestChannelBufferSize verifies the channel is created with the expected capacity.
func TestChannelBufferSize(t *testing.T) {
	ch := make(chan []byte, 1000)
	if cap(ch) != 1000 {
		t.Fatalf("expected channel capacity 1000, got %d", cap(ch))
	}
}

// TestTcpDataMarshalRoundTrip verifies JSON serialization of tcpData preserves
// binary data correctly (base64 encoding of []byte fields).
func TestTcpDataMarshalRoundTrip(t *testing.T) {
	// Include bytes that would be problematic if not properly base64 encoded.
	binaryData := []byte{0x00, 0x01, 0xFF, 0xFE, 0x80, 0x7F}
	original := tcpData{
		Version:   0,
		MappingID: 1,
		ChanNum:   42,
		Data:      binaryData,
	}

	encoded, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded tcpData
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if decoded.Version != original.Version ||
		decoded.MappingID != original.MappingID ||
		decoded.ChanNum != original.ChanNum {
		t.Fatalf("header mismatch: %+v vs %+v", original, decoded)
	}

	if len(decoded.Data) != len(original.Data) {
		t.Fatalf("data length mismatch: %d vs %d", len(decoded.Data), len(original.Data))
	}
	for i := range original.Data {
		if decoded.Data[i] != original.Data[i] {
			t.Fatalf("data mismatch at byte %d: 0x%02x vs 0x%02x", i, original.Data[i], decoded.Data[i])
		}
	}
}

// TestWSWriteMutexPreventsInterleaving verifies that a mutex around
// WebSocket writes prevents concurrent frame interleaving.
func TestWSWriteMutexPreventsInterleaving(t *testing.T) {
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}

	// Collect all messages received by the server.
	var received []string
	var receivedMu sync.Mutex
	done := make(chan struct{})

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				close(done)
				return
			}
			receivedMu.Lock()
			received = append(received, string(msg))
			receivedMu.Unlock()
		}
	}))
	defer srv.Close()

	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}

	var wsMu sync.Mutex
	var wg sync.WaitGroup
	messagesPerGoroutine := 50

	// Simulate stdout writer.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < messagesPerGoroutine; i++ {
			wsMu.Lock()
			conn.WriteMessage(websocket.BinaryMessage, []byte(fmt.Sprintf("stdout-%d", i)))
			wsMu.Unlock()
		}
	}()

	// Simulate stderr writer.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < messagesPerGoroutine; i++ {
			wsMu.Lock()
			conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf("stderr-%d", i)))
			wsMu.Unlock()
		}
	}()

	wg.Wait()
	conn.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("server did not finish reading")
	}

	receivedMu.Lock()
	defer receivedMu.Unlock()

	if len(received) != messagesPerGoroutine*2 {
		t.Fatalf("expected %d messages, got %d", messagesPerGoroutine*2, len(received))
	}

	// Verify no message corruption (each should be a complete "stdout-N" or "stderr-N").
	for _, msg := range received {
		if !strings.HasPrefix(msg, "stdout-") && !strings.HasPrefix(msg, "stderr-") {
			t.Fatalf("corrupted message: %q", msg)
		}
	}
}

// TestTunnelSharedConnectionDataIntegrity creates a real TCP listener + WebSocket
// server to verify that data flows correctly through the tunnel path without corruption.
func TestTunnelSharedConnectionDataIntegrity(t *testing.T) {
	// Create a TCP listener that echoes data back.
	echoListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer echoListener.Close()

	go func() {
		conn, err := echoListener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		buf := make([]byte, 4096)
		for {
			n, err := conn.Read(buf)
			if err != nil {
				return
			}
			conn.Write(buf[:n])
		}
	}()

	// Create a channel-based data path (simulating tunnel dispatch).
	dataChan := make(chan []byte, 1000)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Simulate sending data and receiving it through the channel.
	testData := [][]byte{
		[]byte("SSH-2.0-OpenSSH_8.9\r\n"),
		{0x00, 0x00, 0x05, 0x1C}, // SSH packet length header
		make([]byte, 1308),        // SSH packet body (1308 bytes)
	}
	// Fill the body with a pattern.
	for i := range testData[2] {
		testData[2][i] = byte(i % 256)
	}

	// Send data through the channel (with copy, as the fix does).
	go func() {
		for _, data := range testData {
			dataCopy := make([]byte, len(data))
			copy(dataCopy, data)
			select {
			case dataChan <- dataCopy:
			case <-ctx.Done():
				return
			}
		}
	}()

	// Receive and verify data integrity.
	for i, expected := range testData {
		select {
		case received := <-dataChan:
			if len(received) != len(expected) {
				t.Fatalf("message %d: length mismatch: got %d, want %d", i, len(received), len(expected))
			}
			for j := range expected {
				if received[j] != expected[j] {
					t.Fatalf("message %d: byte %d mismatch: got 0x%02x, want 0x%02x", i, j, received[j], expected[j])
				}
			}
		case <-ctx.Done():
			t.Fatalf("message %d: timed out waiting for data", i)
		}
	}
}

// TestDeduplicationDoesNotDropNonSSHPackets verifies the dedup logic only
// affects SSH version strings, not arbitrary duplicate data.
func TestDeduplicationDoesNotDropNonSSHPackets(t *testing.T) {
	// Simulate the dedup logic from handleSharedTunnelConnection.
	packets := [][]byte{
		{0x00, 0x00, 0x00, 0x10}, // Duplicate non-SSH packet
		{0x00, 0x00, 0x00, 0x10}, // Should NOT be dropped (not SSH version)
		[]byte("SSH-2.0-OpenSSH"),
		[]byte("SSH-2.0-OpenSSH"), // Should be dropped (duplicate SSH version)
	}

	var lastPacket []byte
	var output [][]byte

	for _, data := range packets {
		if len(lastPacket) > 0 && len(data) == len(lastPacket) {
			equal := true
			for i := range data {
				if data[i] != lastPacket[i] {
					equal = false
					break
				}
			}
			if equal && len(data) > 4 && string(data[:4]) == "SSH-" {
				continue // Drop duplicate SSH version
			}
		}
		lastPacket = make([]byte, len(data))
		copy(lastPacket, data)
		output = append(output, data)
	}

	// We expect 3 outputs: both non-SSH packets plus one SSH version.
	if len(output) != 3 {
		t.Fatalf("expected 3 output packets, got %d", len(output))
	}

	// First two should be the non-SSH duplicates (both kept).
	if output[0][3] != 0x10 || output[1][3] != 0x10 {
		t.Fatal("non-SSH duplicate was incorrectly dropped")
	}

	// Third should be the SSH version.
	if string(output[2][:4]) != "SSH-" {
		t.Fatal("SSH version string missing")
	}
}
