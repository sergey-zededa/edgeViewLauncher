package zededa

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestUnauthorizedMapsToErrUnauthorized verifies that a 401 from the ZEDEDA API
// surfaces as ErrUnauthorized (detectable via errors.Is up the call chain), so
// the HTTP layer can render a clean "update your token" prompt instead of the
// raw error body. Representative coverage: a status-returning method and an
// EdgeView control method, which use different error-construction sites.
func TestUnauthorizedMapsToErrUnauthorized(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":[{"ec":"Unauthorized","details":"Session Cache miss"}]}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "expired-token")

	if _, err := c.GetDeviceAppInstances("dev-1", ""); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("GetDeviceAppInstances: expected ErrUnauthorized, got %v", err)
	}
	if err := c.StartEdgeView("dev-1"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("StartEdgeView: expected ErrUnauthorized, got %v", err)
	}
}

// helper to build a minimal JWT with given claims
func buildTestJWT(t *testing.T, claims map[string]interface{}) string {
	t.Helper()

	header := map[string]interface{}{"alg": "none", "typ": "JWT"}
	h, err := json.Marshal(header)
	if err != nil {
		t.Fatalf("marshal header: %v", err)
	}
	p, err := json.Marshal(claims)
	if err != nil {
		t.Fatalf("marshal claims: %v", err)
	}

	enc := func(b []byte) string {
		return base64.RawURLEncoding.EncodeToString(b)
	}

	return enc(h) + "." + enc(p) + "." + enc([]byte(""))
}

func TestParseEdgeViewScript_JWTParsingAndURLNormalization(t *testing.T) {
	token := buildTestJWT(t, map[string]interface{}{
		"dep": "https://dispatcher.example.com/edgeview",
		"sub": "device-uuid-123",
		"num": 2,
		"key": "nonce-key",
	})

	script := "edgeview -token " + token

	c := &Client{}
	cfg, err := c.ParseEdgeViewScript(script)
	if err != nil {
		t.Fatalf("ParseEdgeViewScript returned error: %v", err)
	}

	if cfg.Token != token {
		t.Fatalf("expected token %q, got %q", token, cfg.Token)
	}
	if cfg.UUID != "device-uuid-123" {
		t.Fatalf("expected UUID 'device-uuid-123', got %q", cfg.UUID)
	}
	if cfg.MaxInst != 2 {
		t.Fatalf("expected MaxInst 2, got %d", cfg.MaxInst)
	}
	if cfg.InstID != 1 { // num>1 -> inst 1
		t.Fatalf("expected InstID 1, got %d", cfg.InstID)
	}
	if cfg.Key != "nonce-key" {
		t.Fatalf("expected Key 'nonce-key', got %q", cfg.Key)
	}

	expectedURL := "wss://dispatcher.example.com/edgeview"
	if cfg.URL != expectedURL {
		t.Fatalf("expected URL %q, got %q", expectedURL, cfg.URL)
	}
}

func TestParseEdgeViewScript_InvalidToken(t *testing.T) {
	c := &Client{}
	_, err := c.ParseEdgeViewScript("edgeview -token not-a-jwt")
	if err == nil {
		t.Fatalf("expected error for invalid JWT token, got nil")
	}
}

// TestGetEdgeViewStatus_ExpireSecFormats: the controller has been observed
// sending expireSec as a string; a numeric value must parse the same way
// rather than leaving the expiry empty.
func TestGetEdgeViewStatus_ExpireSecFormats(t *testing.T) {
	for name, expireSec := range map[string]string{"string": `"1790855448"`, "number": `1790855448`} {
		t.Run(name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Write([]byte(`{"edgeviewconfig":{"token":"jwt","jwtInfo":{"expireSec":` + expireSec + `}}}`))
			}))
			defer srv.Close()

			st, err := NewClient(srv.URL, "tok").GetEdgeViewStatus("dev-1")
			if err != nil {
				t.Fatalf("GetEdgeViewStatus: %v", err)
			}
			if st.Expiry != "1790855448" {
				t.Fatalf("expected expiry 1790855448, got %q", st.Expiry)
			}
		})
	}
}

// TestDisableEdgeView verifies the controller call that ends a device's
// EdgeView session (the same effect as disconnecting it in the ZEDEDA UI).
func TestDisableEdgeView(t *testing.T) {
	var gotMethod, gotPath, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod, gotPath, gotAuth = r.Method, r.URL.Path, r.Header.Get("Authorization")
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	if err := c.DisableEdgeView("dev-1"); err != nil {
		t.Fatalf("DisableEdgeView: %v", err)
	}
	if gotMethod != http.MethodPut || gotPath != "/api/v1/devices/id/dev-1/edgeview/disable" || gotAuth != "Bearer tok" {
		t.Fatalf("unexpected request: %s %s auth=%q", gotMethod, gotPath, gotAuth)
	}
}

func TestDisableEdgeView_Errors(t *testing.T) {
	status := http.StatusUnauthorized
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(status)
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "tok")
	if err := c.DisableEdgeView("dev-1"); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expected ErrUnauthorized, got %v", err)
	}
	status = http.StatusInternalServerError
	if err := c.DisableEdgeView("dev-1"); err == nil || errors.Is(err, ErrUnauthorized) {
		t.Fatalf("expected a non-auth error for 500, got %v", err)
	}
}

// TestEdgeViewControlRequests pins the request each EdgeView control call
// sends, and that any 2xx counts as success (a 204 from /disable means the
// session ended; reporting it as a failure would leave tunnels and cache up).
func TestEdgeViewControlRequests(t *testing.T) {
	cases := []struct {
		name     string
		call     func(*Client) error
		wantPath string
		wantBody string
	}{
		{"start", func(c *Client) error { return c.StartEdgeView("dev-1") }, "/api/v1/devices/id/dev-1/edgeview/enable", `{"debugKnob":true,"expiry":60}`},
		{"stop", func(c *Client) error { return c.StopEdgeView("dev-1") }, "/api/v1/devices/id/dev-1/edgeview/enable", `{"debugKnob":false,"expiry":60}`},
		{"disable", func(c *Client) error { return c.DisableEdgeView("dev-1") }, "/api/v1/devices/id/dev-1/edgeview/disable", ``},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var gotMethod, gotPath, gotBody string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				b, _ := io.ReadAll(r.Body)
				gotMethod, gotPath, gotBody = r.Method, r.URL.Path, string(b)
				w.WriteHeader(http.StatusNoContent)
			}))
			defer srv.Close()

			if err := tc.call(NewClient(srv.URL, "tok")); err != nil {
				t.Fatalf("expected 204 to be success, got %v", err)
			}
			if gotMethod != http.MethodPut || gotPath != tc.wantPath || gotBody != tc.wantBody {
				t.Fatalf("unexpected request: %s %s body=%q", gotMethod, gotPath, gotBody)
			}
		})
	}
}
