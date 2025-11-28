package zededa

import (
    "encoding/base64"
    "encoding/json"
    "testing"
)

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