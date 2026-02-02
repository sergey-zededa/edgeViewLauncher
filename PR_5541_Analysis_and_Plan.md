# Analysis of PR #5541: EdgeView Token Hash Update

## 1. Overview & Findings
PR #5541 introduces a **breaking change** to the EdgeView authentication mechanism to improve security.

*   **Change:** The token hash used for authentication is changing from a truncated **128-bit (16-byte)** SHA-256 hash to a **full 256-bit (32-byte)** SHA-256 hash.
*   **Backward Compatibility:** The reference implementation adds a "probing" mechanism. It checks if the device is online using the full hash; if that fails (returning "no device online"), it falls back to checking with the legacy short hash.
*   **Current State of `edgeViewLauncher`:** The current Go backend (`internal/session/manager.go`) hardcodes the legacy 16-byte truncated hash:
    ```go
    // Current implementation
    h := sha256.New()
    h.Write([]byte(tokenToHash))
    hash16 := h.Sum(nil)[:16] // <--- Problem: Truncates to 16 bytes
    tokenHash := base64.RawURLEncoding.EncodeToString(hash16)
    ```

## 2. Impact Analysis

### Reliability (Critical)
*   **Risk:** Without updates, `edgeViewLauncher` will fail to connect to any device running a newer EVE image that expects the full 32-byte hash. The Dispatcher will reject the session lookup because the 16-byte hash won't match the 32-byte hash the device used to register.
*   **Outcome:** Users will receive a "no device online" error even when the device is perfectly healthy and connected.

### Connection Speed & Logic
*   **Reference Implementation:** Uses a separate HTTP "probe" request before the WebSocket handshake. This adds 1 RTT + TLS handshake overhead to every connection attempt.
*   **Optimization Opportunity:** Since `edgeViewLauncher` is an interactive desktop app, we can optimize for speed by using an **Optimistic Connection Strategy**.
    1.  Attempt WebSocket connection with **Full Hash** (assuming most devices will update eventually).
    2.  If it fails with "no device online", immediately retry with **Short Hash**.
    3.  Cache the result (Full vs Short) for the session duration so we don't pay this penalty on every tunnel/channel open.

## 3. Proposed Implementation Plan

### Step 1: Hash Generation Helper
Refactor the hash generation logic into a helper method that supports both modes.

```go
func (m *Manager) generateTokenHash(token string, instID int, useFullHash bool) string {
    tokenToHash := token
    if instID > 0 {
        tokenToHash = fmt.Sprintf("%s.%d", token, instID)
    }

    h := sha256.New()
    h.Write([]byte(tokenToHash))
    
    var hashBytes []byte
    if useFullHash {
        hashBytes = h.Sum(nil)      // Full 32 bytes
    } else {
        hashBytes = h.Sum(nil)[:16] // Truncated 16 bytes (Legacy)
    }
    
    return base64.RawURLEncoding.EncodeToString(hashBytes)
}
```

### Step 2: Update `CachedSession`
Store the hash format preference in the session cache so we only determine it once per session.

```go
type CachedSession struct {
    Config      *zededa.SessionConfig
    Port        int
    ExpiresAt   time.Time
    UseFullHash bool // <--- New field: true = 32-byte, false = 16-byte
}
```

### Step 3: Optimistic Connection Logic in `connectToEdgeView`
Modify `connectToEdgeView` to handle the fallback logic.

**Logic Flow:**
1.  **Check Cache:** If we have a cached preference (e.g., from a previous successful connection for this node), use it.
2.  **Default Attempt:** If no preference, try **Full Hash** first.
3.  **Error Handling:**
    *   If connection succeeds -> Store `UseFullHash = true`.
    *   If error is "no device online" AND we tried Full Hash -> Retry immediately with **Short Hash**.
    *   If Short Hash succeeds -> Store `UseFullHash = false`.
    *   If Short Hash also fails -> Return "no device online".

### Step 4: Instance Rotation Integration
Ensure the instance rotation logic (handling `ErrBusyInstance`) respects the determined hash format.
*   When rotating from `InstID=0` to `InstID=1`, use the **same** hash format that was successfully established. Do not restart the probe/fallback process.

### Step 5: Verification
*   **Test Case 1 (Legacy Device):** Ensure connection fails on 1st attempt (Full Hash) but succeeds on retry (Short Hash).
*   **Test Case 2 (New Device):** Ensure connection succeeds on 1st attempt (Full Hash).
*   **Test Case 3 (Offline Device):** Ensure it fails both attempts and returns the correct error.
