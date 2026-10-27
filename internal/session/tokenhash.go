package session

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"edgeViewLauncher/internal/zededa"
)

// The dispatcher pairs a client with a device by the X-Session-Token header:
// a base64url SHA-256 of the EdgeView JWT (suffixed ".<inst>" in
// multi-instance mode). EVE before 17.3 — including the 14.5 and 16.0 LTS
// lines — registers the first 16 bytes of that hash; EVE 17.3+
// (lf-edge/eve ca1b11f73) registers all 32. A client sending the other form
// is told "no device online" even though the device is connected, so the
// form is discovered per token with the dispatcher's probe request, the same
// way EVE's own client does it.

// SlotState is the dispatcher's view of one EdgeView instance slot.
type SlotState string

const (
	// SlotUnknown means the probe failed or the dispatcher predates probing.
	SlotUnknown SlotState = "unknown"
	// SlotOffline means the device is not connected on this slot.
	SlotOffline SlotState = "offline"
	// SlotFree means the device is connected and waiting for a client.
	SlotFree SlotState = "free"
	// SlotBusy means the device and a client are both connected.
	SlotBusy SlotState = "busy"
)

const (
	// Probe replies, from zdispatcher wss-server.go.
	probeNoDeviceMsg        = "no device online"
	probeServerConnectedMsg = "server is connected"
	probeBusyMsg            = "can't have more than 2 peers"

	probeTimeout = 5 * time.Second
	// hashFormTTL bounds how long a discovered hash form is trusted, so a
	// device upgraded across 17.3 mid-session is picked up again.
	hashFormTTL = 2 * time.Minute
)

type hashForm struct {
	full bool
	at   time.Time
}

// hashFormCache remembers which hash form the device behind a token
// registered with.
type hashFormCache struct {
	mu    sync.Mutex
	forms map[string]hashForm // key is the EdgeView JWT
}

func (c *hashFormCache) get(token string) (bool, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	f, ok := c.forms[token]
	if !ok || time.Since(f.at) > hashFormTTL {
		return false, false
	}
	return f.full, true
}

func (c *hashFormCache) put(token string, full bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.forms == nil || len(c.forms) > 256 {
		// Tokens rotate with every session; don't let old ones pile up.
		c.forms = make(map[string]hashForm)
	}
	c.forms[token] = hashForm{full: full, at: time.Now()}
}

// tokenHash returns the X-Session-Token value for an instance slot, in the
// full (EVE 17.3+) or truncated (older EVE) form.
func tokenHash(token string, instID int, full bool) string {
	if instID > 0 {
		token = fmt.Sprintf("%s.%d", token, instID)
	}
	sum := sha256.Sum256([]byte(token))
	if !full {
		return base64.RawURLEncoding.EncodeToString(sum[:16])
	}
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// probeURL maps the dispatcher's websocket URL to the plain HTTP(S) URL the
// probe is sent to (it is answered before the websocket upgrade).
func probeURL(wsURL string) string {
	switch {
	case strings.HasPrefix(wsURL, "wss://"):
		return "https://" + strings.TrimPrefix(wsURL, "wss://")
	case strings.HasPrefix(wsURL, "ws://"):
		return "http://" + strings.TrimPrefix(wsURL, "ws://")
	}
	return wsURL
}

var defaultProbeClient = &http.Client{
	Timeout: probeTimeout,
	Transport: &http.Transport{
		// IPv4 only, like the websocket dialers in this package.
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			return (&net.Dialer{Timeout: probeTimeout}).DialContext(ctx, "tcp4", addr)
		},
		TLSHandshakeTimeout: probeTimeout,
	},
}

// probeSlot asks the dispatcher about one token hash without connecting.
func (m *Manager) probeSlot(ctx context.Context, wsURL, hash string) SlotState {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, probeURL(wsURL), nil)
	if err != nil {
		return SlotUnknown
	}
	req.Header.Set("X-Session-Probe", "true")
	req.Header.Set("X-Session-Token", hash)

	client := m.probeClient
	if client == nil {
		client = defaultProbeClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return SlotUnknown
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))

	// A dispatcher without probe support tries the websocket upgrade and
	// answers 400, so only a 200 with a known reply counts.
	if resp.StatusCode != http.StatusOK {
		return SlotUnknown
	}
	switch reply := string(body); {
	case strings.Contains(reply, probeServerConnectedMsg):
		return SlotFree
	case strings.Contains(reply, probeBusyMsg):
		return SlotBusy
	case strings.Contains(reply, probeNoDeviceMsg):
		return SlotOffline
	}
	return SlotUnknown
}

// sessionTokenHash returns the X-Session-Token to dial instID with: the full
// hash when the device registered that form, otherwise the truncated one,
// which is also the fallback whenever the dispatcher can't tell us (device
// offline, or a dispatcher without probe support) — it is what every device
// before EVE 17.3 expects.
func (m *Manager) sessionTokenHash(ctx context.Context, config *zededa.SessionConfig, instID int) string {
	if full, ok := m.hashForms.get(config.Token); ok {
		return tokenHash(config.Token, instID, full)
	}
	for _, full := range []bool{true, false} {
		switch m.probeSlot(ctx, config.URL, tokenHash(config.Token, instID, full)) {
		case SlotFree, SlotBusy:
			m.hashForms.put(config.Token, full)
			return tokenHash(config.Token, instID, full)
		case SlotUnknown:
			// No probe support: the short form can't be confirmed either.
			return tokenHash(config.Token, instID, false)
		}
	}
	return tokenHash(config.Token, instID, false)
}
