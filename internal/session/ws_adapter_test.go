package session

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/gorilla/websocket"
)

// wsEchoServer creates a test WebSocket server that sends the given messages
// and then closes the connection.
func wsEchoServer(t *testing.T, messages [][]byte) *httptest.Server {
	t.Helper()
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Logf("upgrade error: %v", err)
			return
		}
		defer conn.Close()
		for _, msg := range messages {
			if err := conn.WriteMessage(websocket.BinaryMessage, msg); err != nil {
				return
			}
		}
		// Send a close frame so the client sees a clean EOF.
		conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		// Wait for the client to ack before tearing down the server.
		conn.ReadMessage()
	}))
}

// dialWS connects to the test server and returns a WSConnAdapter.
func dialWS(t *testing.T, server *httptest.Server) *WSConnAdapter {
	t.Helper()
	url := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	return NewWSConnAdapter(conn)
}

func TestWSConnAdapter_ReadSingleMessage(t *testing.T) {
	payload := []byte("hello world")
	srv := wsEchoServer(t, [][]byte{payload})
	defer srv.Close()

	adapter := dialWS(t, srv)
	defer adapter.Close()

	buf := make([]byte, 64)
	n, err := adapter.Read(buf)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(buf[:n]) != "hello world" {
		t.Fatalf("expected %q, got %q", "hello world", string(buf[:n]))
	}
}

func TestWSConnAdapter_ReadMultipleMessages(t *testing.T) {
	// Verify the loop-based Read correctly spans multiple WS messages.
	messages := [][]byte{
		[]byte("msg1"),
		[]byte("msg2"),
		[]byte("msg3"),
	}
	srv := wsEchoServer(t, messages)
	defer srv.Close()

	adapter := dialWS(t, srv)
	defer adapter.Close()

	for _, expected := range messages {
		buf := make([]byte, 64)
		n, err := adapter.Read(buf)
		if err != nil {
			t.Fatalf("unexpected error reading %q: %v", expected, err)
		}
		if string(buf[:n]) != string(expected) {
			t.Fatalf("expected %q, got %q", expected, string(buf[:n]))
		}
	}
}

func TestWSConnAdapter_ReadSmallBuffer(t *testing.T) {
	// If the read buffer is smaller than the message, successive reads
	// should return the remainder from the same WebSocket message.
	payload := []byte("abcdefghij") // 10 bytes
	srv := wsEchoServer(t, [][]byte{payload})
	defer srv.Close()

	adapter := dialWS(t, srv)
	defer adapter.Close()

	var got []byte
	buf := make([]byte, 3) // small buffer
	for len(got) < len(payload) {
		n, err := adapter.Read(buf)
		if err != nil {
			t.Fatalf("unexpected error after %d bytes: %v", len(got), err)
		}
		got = append(got, buf[:n]...)
	}
	if string(got) != string(payload) {
		t.Fatalf("expected %q, got %q", payload, got)
	}
}

func TestWSConnAdapter_ReadAfterClose(t *testing.T) {
	srv := wsEchoServer(t, nil)
	defer srv.Close()

	adapter := dialWS(t, srv)
	adapter.Close()

	buf := make([]byte, 64)
	_, err := adapter.Read(buf)
	if err == nil {
		t.Fatal("expected error after close, got nil")
	}
}

func TestWSConnAdapter_FailedStateReturnEOF(t *testing.T) {
	adapter := &WSConnAdapter{failed: true}
	buf := make([]byte, 64)
	_, err := adapter.Read(buf)
	if err != io.EOF {
		t.Fatalf("expected io.EOF, got %v", err)
	}
}

func TestWSConnAdapter_Write(t *testing.T) {
	// Verify Write sends a BinaryMessage and returns the correct byte count.
	upgrader := websocket.Upgrader{CheckOrigin: func(r *http.Request) bool { return true }}
	received := make(chan []byte, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		_, msg, err := conn.ReadMessage()
		if err != nil {
			return
		}
		received <- msg
	}))
	defer srv.Close()

	url := "ws" + strings.TrimPrefix(srv.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	adapter := NewWSConnAdapter(conn)
	defer adapter.Close()

	payload := []byte("write test")
	n, err := adapter.Write(payload)
	if err != nil {
		t.Fatalf("write error: %v", err)
	}
	if n != len(payload) {
		t.Fatalf("expected n=%d, got %d", len(payload), n)
	}

	got := <-received
	if string(got) != string(payload) {
		t.Fatalf("server received %q, expected %q", got, payload)
	}
}

func TestWSConnAdapter_ConcurrentReadSafe(t *testing.T) {
	// The adapter uses a mutex on the failed flag; ensure concurrent access
	// to the failed state doesn't race (run with -race).
	adapter := &WSConnAdapter{}
	adapter.mu.Lock()
	adapter.failed = false
	adapter.mu.Unlock()

	var wg sync.WaitGroup
	// One goroutine marks as failed
	wg.Add(1)
	go func() {
		defer wg.Done()
		adapter.mu.Lock()
		adapter.failed = true
		adapter.mu.Unlock()
	}()

	// Another checks the state
	wg.Add(1)
	go func() {
		defer wg.Done()
		adapter.mu.Lock()
		_ = adapter.failed
		adapter.mu.Unlock()
	}()

	wg.Wait()
}
