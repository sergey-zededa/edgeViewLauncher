# External Policy — Per-Node Enable / Disable

How the launcher enables and disables EdgeView's "External Connection Policy"
on a per-device basis, with the full call stack from the UI toggle down to
the ZEDEDA Cloud REST PUT.

---

## What "External Policy" means

When a user opens an SSH/VNC tunnel to an IP that **isn't recognised as an
internal EVE-OS address**, EdgeView on the device rejects the tunnel unless
`edgeviewconfig.extPolicy.allowExt` is set to `true` in the device config.
The launcher surfaces this as `ErrExternalPolicyDenied`
(`internal/session/manager.go`) with an actionable message pointing the user
at the toggle.

The setting is per-device — flipped by **PUT-ing the entire device config**
with `edgeviewconfig.extPolicy.allowExt` set, and read back from the same
field.

---

## Layer 1 — Local launcher backend HTTP API

The frontend speaks to the embedded Go backend on its dynamic port (the one
in `[Sidecar] Backend port detected: NNNNN` in the console log).

**Endpoint:** `POST /api/enable-external-policy`

**Request** (`cmd/edgeview-backend/http-server.go` — `EnableExternalPolicyRequest`):

```go
type EnableExternalPolicyRequest struct {
    NodeID string `json:"nodeId"`
    Enable bool   `json:"enable"`
}
```

**Response:**

```json
{ "success": true, "data": { "externalPolicyEnabled": true } }
```

**Handler chain:** `handleEnableExternalPolicy` (`cmd/edgeview-backend/http-server.go`) →
`App.EnableExternalPolicy` (`cmd/edgeview-backend/app.go`) →
`Client.UpdateEdgeViewExternalPolicy` (`internal/zededa/client.go`).

**Curl example** (replace `49733` with the Sidecar port from the console log):

```bash
curl -X POST http://localhost:49733/api/enable-external-policy \
  -H 'Content-Type: application/json' \
  -d '{"nodeId":"783bf9f2-08e6-49f1-8620-6713c0825e13","enable":true}'
```

---

## Layer 2 — ZEDEDA Cloud REST API (what the backend actually calls)

The launcher does a **read-modify-write** on the full device JSON.
Implementation in `internal/zededa/client.go`:

```go
// UpdateEdgeViewExternalPolicy updates the device configuration to
// enable/disable external policy.
func (c *Client) UpdateEdgeViewExternalPolicy(nodeID string, enable bool) error {
    device, err := c.GetDevice(nodeID)            // GET  /api/v1/devices/id/{nodeID}
    if err != nil {
        return fmt.Errorf("failed to get device: %w", err)
    }

    evConfig, ok := device["edgeviewconfig"].(map[string]interface{})
    if !ok || evConfig == nil {
        evConfig = make(map[string]interface{})
    }

    evConfig["extPolicy"] = map[string]interface{}{
        "allowExt": enable,
    }
    device["edgeviewconfig"] = evConfig

    return c.UpdateDevice(nodeID, device)         // PUT  /api/v1/devices/id/{nodeID}
}
```

The two underlying cloud calls (both authenticated with
`Authorization: Bearer <api-token>`):

| Verb  | URL                                         | Purpose                                                                  |
| ----- | ------------------------------------------- | ------------------------------------------------------------------------ |
| `GET` | `{baseURL}/api/v1/devices/id/{nodeID}`      | Fetch the full device JSON (includes `edgeviewconfig`)                   |
| `PUT` | `{baseURL}/api/v1/devices/id/{nodeID}`      | Write back the device JSON with `edgeviewconfig.extPolicy.allowExt` toggled |

`baseURL` is the cluster URL (e.g. `https://zedcontrol.zededa.net`).

**Curl equivalent (raw cloud API, bypassing the launcher):**

```bash
TOKEN="<your-zededa-api-token>"
BASE="https://zedcontrol.zededa.net"
NODE="783bf9f2-08e6-49f1-8620-6713c0825e13"

# 1. Fetch current device JSON
curl -s "$BASE/api/v1/devices/id/$NODE" \
  -H "Authorization: Bearer $TOKEN" > device.json

# 2. Set extPolicy.allowExt = true (jq does the merge)
jq '.edgeviewconfig.extPolicy.allowExt = true' device.json > device.new.json

# 3. PUT it back
curl -s -X PUT "$BASE/api/v1/devices/id/$NODE" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @device.new.json
```

To **disable**, send `false` (or omit the field — the device defaults to
denied).

---

## Reading the current state

`GET /api/ssh-status` in the launcher returns an `EdgeViewStatus` with the
derived `externalPolicy` boolean. The Go side reads it from the same field
(`internal/zededa/client.go`):

```go
// 2a. Check External Policy (extPolicy)
if evConfig, ok := device["edgeviewconfig"].(map[string]interface{}); ok {
    if extPolicy, ok := evConfig["extPolicy"].(map[string]interface{}); ok {
        if allowExt, ok := extPolicy["allowExt"].(bool); ok {
            status.ExternalPolicy = allowExt
        }
    }
}
```

Frontend usage (`frontend/src/App.jsx`, `handleEnableExternalPolicy`) toggles
between current `sshStatus.externalPolicy` and its inverse, calls
`EnableExternalPolicy(nodeId, newState)`, optimistically updates the React
state, then `loadSSHStatus` refreshes from the cloud.

---

## End-to-end programmatic example (via the launcher backend)

```bash
#!/usr/bin/env bash
# Toggle External Policy for a node through the running launcher.
# Find the local launcher port from console output: "Backend port detected: NNNNN".

LAUNCHER_PORT=49733
NODE_ID="783bf9f2-08e6-49f1-8620-6713c0825e13"
ENABLE=true   # or false

curl -fsS -X POST "http://localhost:$LAUNCHER_PORT/api/enable-external-policy" \
  -H 'Content-Type: application/json' \
  -d "{\"nodeId\":\"$NODE_ID\",\"enable\":$ENABLE}" \
  | jq .
```

Same flow used by the **"Enable Ext. Policy"** button in Device
Configuration.

---

## Quick reference of the relevant files

| File                                                          | What                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------- |
| `frontend/src/tauriAPI.js`                                    | `EnableExternalPolicy(nodeId, enable)` JS wrapper             |
| `frontend/src/App.jsx`                                        | UI toggle handler (`handleEnableExternalPolicy`)              |
| `cmd/edgeview-backend/http-server.go`                         | Request struct, `handleEnableExternalPolicy`, route registration |
| `cmd/edgeview-backend/app.go`                                 | `App.EnableExternalPolicy` thin wrapper                       |
| `internal/zededa/client.go` (`UpdateEdgeViewExternalPolicy`)  | Read-modify-write on the device JSON                          |
| `internal/zededa/client.go` (`GetDevice` / `UpdateDevice`)    | Raw cloud calls                                               |
| `internal/zededa/client.go` (`EdgeViewStatus.ExternalPolicy`) | Parsed from `extPolicy.allowExt`                              |
| `internal/session/manager.go` (`ErrExternalPolicyDenied`)     | User-facing error message that points at the toggle            |
