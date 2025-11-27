# EVE-OS Guacd VNC Authentication Analysis

**Date:** November 26, 2025  
**Question:** Does the eve-os guacd implementation require password authentication for VNC connections to work?

## Answer

**No, VNC connections do NOT require password authentication by default.** Password authentication is optionally supported but not mandatory.

## Detailed Findings

### 1. VNC Configuration in QEMU

**Location:** `/Users/sseper/eve-os/src/pkg/pillar/hypervisor/kvm.go` (lines 230-237)

```
{{if .DomainConfig.EnableVnc}}
[vnc "default"]
  vnc = "0.0.0.0:{{if .DomainConfig.VncDisplay}}{{.DomainConfig.VncDisplay}}{{else}}0{{end}}"
  to = "99"
{{- if .DomainConfig.VncPasswd}}
  password = "on"
{{- end -}}
{{end}}
```

**Key Points:**
- VNC listens on `0.0.0.0` (all network interfaces)
- Port range: 5900-5999 (display 0-99)
- The `password = "on"` directive is **conditionally included** only when `VncPasswd` is set
- Without password configuration, VNC runs **without authentication**

### 2. Optional Password Support via OCI Annotations

**Location:** `/Users/sseper/eve-os/src/pkg/pillar/hypervisor/kvm.go` (lines 1771-1775)

```go
if vncPassword, ok := annotations[containerd.EVEOCIVNCPasswordLabel]; ok && vncPassword != "" {
    if err := execVNCPassword(qmpFile, vncPassword); err != nil {
        return logError("failed to set VNC password %v", err)
    }
}
```

**Password Configuration:**
- Password can be set via OCI annotation: `org.lfedge.eve.vnc_password`
- Password is applied dynamically using QMP (QEMU Monitor Protocol) via `change-vnc-password` command
- This is **entirely optional** - absence of annotation means no password

**Related Files:**
- `/Users/sseper/eve-os/src/pkg/pillar/containerd/containerd.go` (line 71): Defines `EVEOCIVNCPasswordLabel`
- `/Users/sseper/eve-os/src/pkg/pillar/hypervisor/qmp.go` (lines 86-90): Implements `execVNCPassword()`

### 3. Guacd Service Configuration

**Location:** `/Users/sseper/eve-os/src/pkg/guacd/Dockerfile` (line 32)

```dockerfile
CMD ["/usr/sbin/guacd", "-l", "4822", "-b", "0.0.0.0", "-L", "info", "-f"]
```

**Guacd Role:**
- Listens on port 4822 (localhost)
- Acts as a proxy/gateway between remote clients and local VNC servers
- Based on Apache Guacamole daemon
- **Does not enforce authentication** - merely relays connections

### 4. Network Security via IPTables ACLs

**Location:** `/Users/sseper/eve-os/src/pkg/pillar/dpcreconciler/linux.go` (lines 1741-1782)

**VNC Access Control Rules:**

1. **Local VNC (always allowed):**
   - IPv4: `-s 127.0.0.1 -d 127.0.0.1 --dport 5900:5999` → ACCEPT
   - IPv6: `-s ::1 -d ::1 --dport 5900:5999` → ACCEPT

2. **Remote VNC (controlled by config):**
   - Controlled by global config flag: `AllowAppVnc`
   - If enabled: Remote VNC → ACCEPT
   - If disabled: Remote VNC → REJECT

3. **Guacd Port Protection:**
   - Port 4822 is blocked for non-local connections
   - Local Guacamole: `-s 127.0.0.1 -d 127.0.0.1 --dport 4822` → ACCEPT
   - Remote attempts: `--dport 4822` → REJECT

### 5. Connection Flow

```
Remote Client
    ↓
WebSocket Tunnel (wstunnelclient)
    ↓
guacd (localhost:4822)
    ↓
QEMU VNC Server (localhost:5900+)
    ↓
Virtual Machine
```

**Authentication Points:**
- **Tunnel level:** Authenticated via controller certificates
- **Guacd level:** No authentication (local only)
- **VNC level:** Optional password (if configured via OCI annotation)

## Conclusion

The eve-os guacd implementation supports two VNC operation modes:

### Mode 1: Unauthenticated VNC (Default)
- No password required
- VNC server accepts connections without credentials
- Security relies on:
  - Network ACLs (iptables rules)
  - Tunnel authentication (WebSocket with certificates)
  - Localhost-only guacd access

### Mode 2: Authenticated VNC (Optional)
- Password set via OCI image annotation `org.lfedge.eve.vnc_password`
- Password applied dynamically at VM startup via QMP
- Adds an additional security layer

**Default behavior:** VNC connections work **without password authentication**. The primary security mechanism is network-level access control rather than application-level VNC authentication.

## Files Analyzed

1. `/Users/sseper/eve-os/src/pkg/guacd/Dockerfile`
2. `/Users/sseper/eve-os/src/pkg/guacd/build.yml`
3. `/Users/sseper/eve-os/src/pkg/pillar/hypervisor/kvm.go`
4. `/Users/sseper/eve-os/src/pkg/pillar/hypervisor/qmp.go`
5. `/Users/sseper/eve-os/src/pkg/pillar/containerd/containerd.go`
6. `/Users/sseper/eve-os/src/pkg/pillar/dpcreconciler/linux.go`
7. `/Users/sseper/eve-os/src/pkg/pillar/cmd/wstunnelclient/wstunnelclient.go`
8. `/Users/sseper/eve-os/src/pkg/pillar/iptables/connmark.go`
