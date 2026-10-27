package session

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"edgeViewLauncher/internal/zededa"

	"github.com/gorilla/websocket"
)

// EVE 16.6+ answers a pre-16.6 encrypted message with this plain-text notice
// (lf-edge/eve pkg/edgeview/src/crypto.go decryptEvMsg).
const eve166UpgradeNotice = "Edgeview encrypted message missing or invalid IV. Need Edgeview Client version 0.8.8 or higher\n"

func TestUnwrapMessageRecognisesEVE166UpgradeNotice(t *testing.T) {
	if _, err := unwrapMessage([]byte(eve166UpgradeNotice), "nonce", true); err != ErrE2EUnsupported {
		t.Fatalf("expected ErrE2EUnsupported, got %v", err)
	}
}

func TestUnwrapMessageRecognisesAESGCMEnvelope(t *testing.T) {
	// The shape encryptData produces on EVE 16.6+.
	data, _ := json.Marshal(map[string]interface{}{
		"message":    []byte("ciphertext"),
		"sha256Hash": [32]byte{},
		"iv":         make([]byte, 12),
		"cipher":     "AES-GCM",
	})
	if _, err := unwrapMessage(data, "nonce", true); err != ErrE2EUnsupported {
		t.Fatalf("expected ErrE2EUnsupported, got %v", err)
	}
}

// The pre-16.6 scheme (14.5/16.0 LTS) must keep working, and its envelope
// must not grow the new fields on the wire.
func TestLegacyEncryptedEnvelopeStillRoundTrips(t *testing.T) {
	conn, read := newEchoPair(t)
	if err := sendWrappedMessage(conn, []byte("+++tcpSetupOK+++"), "nonce", websocket.BinaryMessage, true); err != nil {
		t.Fatalf("send: %v", err)
	}
	raw := read()
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatalf("envelope is not JSON: %v", err)
	}
	if _, ok := fields["iv"]; ok {
		t.Fatalf("legacy envelope must not carry an iv field: %s", raw)
	}
	if _, ok := fields["cipher"]; ok {
		t.Fatalf("legacy envelope must not carry a cipher field: %s", raw)
	}
	got, err := unwrapMessage(raw, "nonce", true)
	if err != nil || string(got) != "+++tcpSetupOK+++" {
		t.Fatalf("round trip got %q, %v", got, err)
	}
}

// Like an external-policy denial, an undecryptable scheme must not burn
// through every retry round.
func TestStartProxyMulti_E2EUnsupportedShortCircuits(t *testing.T) {
	candidates := []string{"a", "b"}
	m, callsPtr, mu := newRecordingManager(5, func(c probeCall) error {
		return ErrE2EUnsupported
	})

	cfg := &zededa.SessionConfig{MaxInst: 2}
	_, _, err := m.StartProxyMulti(context.Background(), cfg, "n1", candidates, 22, "ssh", nil)
	if err != ErrE2EUnsupported {
		t.Fatalf("expected ErrE2EUnsupported, got %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if got := len(*callsPtr); got > len(candidates) {
		t.Fatalf("expected at most %d probes (one round), got %d", len(candidates), got)
	}
}

// newEchoPair returns a client websocket and a func that reads the next
// frame the server side received from it.
func newEchoPair(t *testing.T) (*websocket.Conn, func() []byte) {
	t.Helper()
	frames := make(chan []byte, 4)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := (&websocket.Upgrader{}).Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer c.Close()
		for {
			_, msg, err := c.ReadMessage()
			if err != nil {
				return
			}
			frames <- msg
		}
	}))
	t.Cleanup(srv.Close)
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn, func() []byte {
		select {
		case f := <-frames:
			return f
		case <-time.After(2 * time.Second):
			t.Fatalf("no frame received")
			return nil
		}
	}
}
