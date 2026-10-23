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

// TestForbiddenMapsToErrForbidden verifies that a 403 surfaces as a
// *ForbiddenError (matching ErrForbidden) carrying the permission the
// controller named, so the UI can say what is missing instead of dumping the
// raw envelope. Covers the EdgeView control path and the device-update path,
// which build their errors in different places.
func TestForbiddenMapsToErrForbidden(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"operationType":"OPS_TYPE_UNSPECIFIED","httpStatusCode":403,` +
			`"httpStatusMsg":"user someone@example.com does not have permission PermissionAccessUpdate ",` +
			`"error":[{"ec":"Forbidden","location":"","details":"Operation forbidden"}]}`))
	}))
	defer srv.Close()

	c := NewClient(srv.URL, "token")

	for name, err := range map[string]error{
		"StartEdgeView": c.StartEdgeView("dev-1"),
		"UpdateDevice":  c.UpdateDevice("dev-1", map[string]interface{}{}),
	} {
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("%s: expected ErrForbidden, got %v", name, err)
		}
		var fe *ForbiddenError
		if !errors.As(err, &fe) {
			t.Fatalf("%s: expected *ForbiddenError, got %T", name, err)
		}
		if fe.Permission != "PermissionAccessUpdate" {
			t.Fatalf("%s: expected permission PermissionAccessUpdate, got %q", name, fe.Permission)
		}
		if fe.Message != "user someone@example.com does not have permission PermissionAccessUpdate" {
			t.Fatalf("%s: unexpected message %q", name, fe.Message)
		}
	}
}

// TestParseForbidden_Fallbacks covers 403 bodies without httpStatusMsg (use
// the error details) and non-JSON bodies (no permission, generic message).
func TestParseForbidden_Fallbacks(t *testing.T) {
	fe := parseForbidden([]byte(`{"error":[{"ec":"Forbidden","details":"Operation forbidden"}]}`))
	if fe.Message != "Operation forbidden" || fe.Permission != "" {
		t.Fatalf("details fallback: got %+v", fe)
	}

	fe = parseForbidden([]byte(`<html>403 Forbidden</html>`))
	if fe.Message != "" || fe.Permission != "" {
		t.Fatalf("non-JSON body: got %+v", fe)
	}
	if !errors.Is(fe, ErrForbidden) || fe.Error() != ErrForbidden.Error() {
		t.Fatalf("non-JSON body: expected the generic ErrForbidden text, got %q", fe.Error())
	}
}

// TestEdgeViewErrorIsReadable verifies a non-auth EdgeView failure reports the
// envelope's details rather than the whole JSON body.
func TestEdgeViewErrorIsReadable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"operationType":"OPS_TYPE_UNSPECIFIED","httpStatusCode":400,` +
			`"error":[{"ec":"BadReqBody","details":"device is not edgeview capable"}]}`))
	}))
	defer srv.Close()

	err := NewClient(srv.URL, "token").StartEdgeView("dev-1")
	if err == nil {
		t.Fatal("expected an error")
	}
	want := "edgeview enable failed: ZEDEDA Cloud rejected the request (HTTP 400): device is not edgeview capable"
	if err.Error() != want {
		t.Fatalf("got %q, want %q", err.Error(), want)
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

// fakeDeviceServer serves GET /api/v1/devices/id/dev-1 with a device whose
// debug.enable.ssh value is sshValue (plus an unrelated config item), and
// records the device body of any PUT. puts counts PUT requests.
func fakeDeviceServer(t *testing.T, sshValue string) (srv *httptest.Server, put *map[string]interface{}, puts *int) {
	t.Helper()
	var gotPut map[string]interface{}
	var nPuts int
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/devices/id/dev-1" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		switch r.Method {
		case http.MethodGet:
			json.NewEncoder(w).Encode(map[string]interface{}{
				"id": "dev-1",
				"configItem": []interface{}{
					map[string]interface{}{"key": "timer.config.interval", "uint32Value": 60},
					map[string]interface{}{"key": "debug.enable.ssh", "stringValue": sshValue},
				},
			})
		case http.MethodPut:
			nPuts++
			if err := json.NewDecoder(r.Body).Decode(&gotPut); err != nil {
				t.Errorf("decode PUT body: %v", err)
			}
			w.WriteHeader(http.StatusOK)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &gotPut, &nPuts
}

// sshItem returns the debug.enable.ssh config item from a PUT device body,
// or nil when it was dropped.
func sshItem(t *testing.T, device map[string]interface{}) map[string]interface{} {
	t.Helper()
	items, ok := device["configItem"].([]interface{})
	if !ok {
		t.Fatalf("PUT body has no configItem list: %v", device)
	}
	if len(items) == 0 {
		t.Fatalf("PUT dropped unrelated config items: %v", items)
	}
	for _, it := range items {
		if cfg, ok := it.(map[string]interface{}); ok && cfg["key"] == "debug.enable.ssh" {
			return cfg
		}
	}
	return nil
}

// Removing the last entry drops the debug.enable.ssh config item entirely,
// which EVE-OS reads as SSH disabled; other config items are kept.
func TestRemoveSSHKey_LastKeyDropsConfigItem(t *testing.T) {
	srv, put, puts := fakeDeviceServer(t, launcherKey)
	c := NewClient(srv.URL, "tok")

	removed, remaining, err := c.RemoveSSHKey("dev-1", fingerprintOf(t, launcherKey), "")
	if err != nil || !removed || remaining != 0 {
		t.Fatalf("got (%v, %d, %v) want (true, 0, nil)", removed, remaining, err)
	}
	if *puts != 1 {
		t.Fatalf("expected 1 PUT, got %d", *puts)
	}
	if item := sshItem(t, *put); item != nil {
		t.Fatalf("expected debug.enable.ssh to be dropped, got %v", item)
	}
}

// When the last key is removed the PUT carries a rebuilt configItem slice;
// boolean items (VGA/USB/Console) in it must still be cleaned of the
// extraneous fields older versions wrote.
func TestRemoveSSHKey_LastKeyCleansBooleanItems(t *testing.T) {
	var gotPut map[string]interface{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			json.NewEncoder(w).Encode(map[string]interface{}{
				"id": "dev-1",
				"configItem": []interface{}{
					map[string]interface{}{"key": "debug.enable.vga", "stringValue": "true", "boolValue": true},
					map[string]interface{}{"key": "debug.enable.ssh", "stringValue": launcherKey},
				},
			})
		case http.MethodPut:
			if err := json.NewDecoder(r.Body).Decode(&gotPut); err != nil {
				t.Errorf("decode PUT body: %v", err)
			}
		}
	}))
	t.Cleanup(srv.Close)
	c := NewClient(srv.URL, "tok")

	if _, _, err := c.RemoveSSHKey("dev-1", fingerprintOf(t, launcherKey), ""); err != nil {
		t.Fatalf("RemoveSSHKey: %v", err)
	}
	items, _ := gotPut["configItem"].([]interface{})
	if len(items) != 1 {
		t.Fatalf("expected only the VGA item to remain, got %v", items)
	}
	vga, _ := items[0].(map[string]interface{})
	if _, extra := vga["boolValue"]; extra || vga["stringValue"] != "true" {
		t.Fatalf("expected cleaned VGA item {key, stringValue:true}, got %v", vga)
	}
}

// Removing one of several entries rewrites only the stringValue; an
// unparseable line is removed by its text.
func TestRemoveSSHKey_RewritesRemainingKeys(t *testing.T) {
	srv, put, _ := fakeDeviceServer(t, launcherKey+"\n"+invalidKey+"\n"+adminKey)
	c := NewClient(srv.URL, "tok")

	removed, remaining, err := c.RemoveSSHKey("dev-1", "", invalidKey)
	if err != nil || !removed || remaining != 2 {
		t.Fatalf("got (%v, %d, %v) want (true, 2, nil)", removed, remaining, err)
	}
	item := sshItem(t, *put)
	if item == nil || item["stringValue"] != launcherKey+"\n"+adminKey {
		t.Fatalf("unexpected ssh item after removal: %v", item)
	}
}

// An entry that is already gone (someone else removed it) is not an error and
// sends no PUT.
func TestRemoveSSHKey_AlreadyGone(t *testing.T) {
	srv, _, puts := fakeDeviceServer(t, adminKey+"\n"+invalidKey)
	c := NewClient(srv.URL, "tok")

	removed, remaining, err := c.RemoveSSHKey("dev-1", fingerprintOf(t, launcherKey), "")
	if err != nil || removed || remaining != 2 {
		t.Fatalf("got (%v, %d, %v) want (false, 2, nil)", removed, remaining, err)
	}
	if *puts != 0 {
		t.Fatalf("expected no PUT, got %d", *puts)
	}
}

// Exactly one of fingerprint/raw must be given; anything else is rejected
// before talking to the controller.
func TestRemoveSSHKey_RequiresExactlyOneSelector(t *testing.T) {
	c := NewClient("http://127.0.0.1:1", "tok")
	for _, sel := range [][2]string{{"", ""}, {"  ", " "}, {"SHA256:x", "line"}} {
		if _, _, err := c.RemoveSSHKey("dev-1", sel[0], sel[1]); !errors.Is(err, ErrInvalidKeySelector) {
			t.Fatalf("selector %q: expected ErrInvalidKeySelector, got %v", sel, err)
		}
	}
}

// The shared GET/PUT helper must leave DisableSSH's behaviour unchanged:
// only our key (by type+blob, any comment) goes; other lines stay.
func TestDisableSSH_RemovesOnlyOurKey(t *testing.T) {
	srv, put, _ := fakeDeviceServer(t, launcherSameBlob+"\n"+adminKey)
	c := NewClient(srv.URL, "tok")

	if err := c.DisableSSH("dev-1", launcherKey); err != nil {
		t.Fatalf("DisableSSH: %v", err)
	}
	item := sshItem(t, *put)
	if item == nil || item["stringValue"] != adminKey {
		t.Fatalf("unexpected ssh item after DisableSSH: %v", item)
	}
}

// A 403 on the PUT surfaces as ErrForbidden so the UI can show its
// "Permission denied" toast.
func TestRemoveSSHKey_ForbiddenOnUpdate(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			json.NewEncoder(w).Encode(map[string]interface{}{
				"configItem": []interface{}{
					map[string]interface{}{"key": "debug.enable.ssh", "stringValue": launcherKey},
				},
			})
			return
		}
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"httpStatusMsg":"user x does not have permission PermissionDeviceUpdate "}`))
	}))
	defer srv.Close()

	_, _, err := NewClient(srv.URL, "tok").RemoveSSHKey("dev-1", fingerprintOf(t, launcherKey), "")
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}
