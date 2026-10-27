package zededa

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"time"
)

// This file turns the controller's device status / app-instance status
// documents into the flat, normalized DeviceInfo the UI renders. The documents
// are read through jsonObj rather than decoded into structs because:
//   - grpc-gateway field casing is not uniform ("Utilization" vs "utilization",
//     "TotalMB" vs "totalMB"), so lookups are case-insensitive;
//   - 64-bit integers can be emitted as JSON strings;
//   - an unexpected shape in one field must not take the whole panel down.

// jsonObj is a decoded JSON object whose values are decoded on demand.
type jsonObj map[string]json.RawMessage

// parseJSONObj decodes raw as an object, returning nil when it is not one.
func parseJSONObj(raw json.RawMessage) jsonObj {
	var o jsonObj
	if err := json.Unmarshal(raw, &o); err != nil || o == nil {
		return nil
	}
	return o
}

// field returns the raw value for the first of names present, matching keys
// case-insensitively (an exact match wins over a differently-cased one).
func (o jsonObj) field(names ...string) (json.RawMessage, bool) {
	for _, name := range names {
		if v, ok := o[name]; ok {
			return v, true
		}
		for k, v := range o {
			if strings.EqualFold(k, name) {
				return v, true
			}
		}
	}
	return nil, false
}

// str returns a string field, or "" when absent or not a string.
func (o jsonObj) str(names ...string) string {
	raw, ok := o.field(names...)
	if !ok {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return ""
	}
	return strings.TrimSpace(s)
}

// num returns a numeric field and whether it was present and numeric. A
// numeric string ("4096", how grpc-gateway emits uint64) counts as numeric.
func (o jsonObj) num(names ...string) (float64, bool) {
	raw, ok := o.field(names...)
	if !ok {
		return 0, false
	}
	var f float64
	if json.Unmarshal(raw, &f) == nil && !math.IsNaN(f) && !math.IsInf(f, 0) {
		return f, true
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		if f, err := strconv.ParseFloat(strings.TrimSpace(s), 64); err == nil && !math.IsNaN(f) && !math.IsInf(f, 0) {
			return f, true
		}
	}
	return 0, false
}

// boolean returns a bool field; the string "true" counts as true.
func (o jsonObj) boolean(names ...string) bool {
	raw, ok := o.field(names...)
	if !ok {
		return false
	}
	var b bool
	if json.Unmarshal(raw, &b) == nil {
		return b
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return strings.EqualFold(strings.TrimSpace(s), "true")
	}
	return false
}

// obj returns a nested object, or nil when absent or not an object.
func (o jsonObj) obj(names ...string) jsonObj {
	raw, ok := o.field(names...)
	if !ok {
		return nil
	}
	return parseJSONObj(raw)
}

// list returns the object elements of an array field.
func (o jsonObj) list(names ...string) []jsonObj {
	raw, ok := o.field(names...)
	if !ok {
		return nil
	}
	var elems []json.RawMessage
	if json.Unmarshal(raw, &elems) != nil {
		return nil
	}
	out := make([]jsonObj, 0, len(elems))
	for _, e := range elems {
		if eo := parseJSONObj(e); eo != nil {
			out = append(out, eo)
		}
	}
	return out
}

// DeviceInfo is the normalized "Device" panel payload. Numbers are MB or
// percent, timestamps are RFC3339 UTC, and every optional value is omitted
// (pointer / empty) when the controller did not report it.
type DeviceInfo struct {
	NodeID   string `json:"nodeId"`
	Name     string `json:"name,omitempty"`
	RunState string `json:"runState,omitempty"` // raw controller enum, e.g. RUN_STATE_ONLINE
	Online   bool   `json:"online"`

	// EveVersion is the running (activated) image; Partition its label
	// (IMGA/IMGB). Other* describe the inactive image when it holds a
	// different version (an update in flight or a fallback image).
	EveVersion     string `json:"eveVersion,omitempty"`
	Partition      string `json:"partition,omitempty"`
	OtherVersion   string `json:"otherVersion,omitempty"`
	OtherPartition string `json:"otherPartition,omitempty"`
	OtherState     string `json:"otherState,omitempty"`

	// BootTime is when the device last booted. UptimeSec is only set while the
	// device is online: an offline device's uptime is stale, so the UI shows
	// "last boot <BootTime>" instead.
	BootTime  string `json:"bootTime,omitempty"`
	UptimeSec *int64 `json:"uptimeSec,omitempty"`

	LastReboot *RebootInfo `json:"lastReboot,omitempty"`

	CPU     *CPUInfo     `json:"cpu,omitempty"`
	Memory  *MemoryInfo  `json:"memory,omitempty"`
	Storage *StorageInfo `json:"storage,omitempty"`

	// Workloads are the device's app instances. WorkloadsAvailable is false
	// when the app status call failed (WorkloadsError says why); the device
	// half of the payload is still valid then.
	Workloads          []WorkloadInfo `json:"workloads"`
	WorkloadsAvailable bool           `json:"workloadsAvailable"`
	WorkloadsError     string         `json:"workloadsError,omitempty"`
}

// RebootInfo describes the device's last reboot.
type RebootInfo struct {
	Code   string `json:"code,omitempty"`   // enum tail, e.g. REBOOT_CMD
	Label  string `json:"label,omitempty"`  // short human label, e.g. "Reboot command"
	Reason string `json:"reason,omitempty"` // free text reported by the device (can be long)
	Time   string `json:"time,omitempty"`
}

type CPUInfo struct {
	Percent *float64 `json:"percent,omitempty"`
	Cores   *int     `json:"cores,omitempty"`
}

// MemoryInfo keeps the controller's own breakdown. UsedEveMB is what EVE
// itself uses, not host-wide usage, so the UI words it accordingly.
type MemoryInfo struct {
	TotalMB         *float64 `json:"totalMB,omitempty"`
	UsedEveMB       *float64 `json:"usedEveMB,omitempty"`
	AllocatedAppsMB *float64 `json:"allocatedAppsMB,omitempty"`
	AllocatedEveMB  *float64 `json:"allocatedEveMB,omitempty"`
}

type StorageInfo struct {
	TotalMB *float64 `json:"totalMB,omitempty"`
	UsedMB  *float64 `json:"usedMB,omitempty"`
}

// WorkloadInfo is one app instance's state and resource use.
type WorkloadInfo struct {
	ID             string   `json:"id,omitempty"`
	Name           string   `json:"name"`
	RunState       string   `json:"runState,omitempty"` // raw controller enum
	CPUPercent     *float64 `json:"cpuPercent,omitempty"`
	MemUsedMB      *float64 `json:"memUsedMB,omitempty"`
	MemAllocatedMB *float64 `json:"memAllocatedMB,omitempty"`
}

// minPlausibleTime filters the zero timestamps protobuf emits for "unset"
// (0001-01-01, 1970-01-01).
var minPlausibleTime = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)

// parseControllerTime parses an RFC3339 timestamp and rejects unset-looking
// values, returning ok=false for them.
func parseControllerTime(s string) (time.Time, bool) {
	if s == "" {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil || t.Before(minPlausibleTime) {
		return time.Time{}, false
	}
	return t.UTC(), true
}

// maxPlausibleUptime guards the upTime fallback: a value that is really an
// absolute timestamp (decades since epoch) is not an uptime.
const maxPlausibleUptime = 20 * 365 * 24 * time.Hour

// rebootLabels maps DEVICE_BOOT_REASON_* enum tails to short labels. Unknown
// tails fall back to humanizeEnum.
var rebootLabels = map[string]string{
	"FIRST":         "First boot",
	"REBOOT_CMD":    "Reboot command",
	"UPDATE":        "Update",
	"FALLBACK":      "Fallback to previous image",
	"DISCONNECT":    "Controller disconnect",
	"FATAL":         "Fatal error",
	"OOM":           "Out of memory",
	"WATCHDOG_HUNG": "Watchdog (hung)",
	"WATCHDOG_PID":  "Watchdog (process died)",
	"KERNEL":        "Kernel panic",
	"POWER_FAIL":    "Power failure",
	"POWEROFF_CMD":  "Power off command",
	"VAULT":         "Vault error",
	"VAULT_FAILED":  "Vault failed",
	"UNKNOWN":       "Unknown",
	"PARSE_FAIL":    "Unparseable reason",
}

// rebootEnumByNumber covers the (unlikely) case of the enum arriving as its
// number rather than its name.
var rebootEnumByNumber = map[int]string{
	1: "FIRST", 2: "REBOOT_CMD", 3: "UPDATE", 4: "FALLBACK", 5: "DISCONNECT",
	6: "FATAL", 7: "OOM", 8: "WATCHDOG_HUNG", 9: "WATCHDOG_PID", 10: "KERNEL",
	11: "POWER_FAIL", 12: "UNKNOWN", 13: "VAULT_FAILED", 14: "POWEROFF_CMD", 255: "PARSE_FAIL",
}

// RebootCode strips the enum prefix from a DeviceBootReason value
// ("DEVICE_BOOT_REASON_UPDATE" -> "UPDATE"). UNSPECIFIED/NONE yield "".
func RebootCode(enum string) string {
	code := strings.ToUpper(strings.TrimSpace(enum))
	for _, p := range []string{"DEVICE_BOOT_REASON_", "BOOT_REASON_"} {
		code = strings.TrimPrefix(code, p)
	}
	if code == "UNSPECIFIED" || code == "NONE" || code == "0" {
		return ""
	}
	return code
}

// RebootLabel returns the short human label for an enum tail.
func RebootLabel(code string) string {
	if code == "" {
		return ""
	}
	if l, ok := rebootLabels[code]; ok {
		return l
	}
	return humanizeEnum(code)
}

// humanizeEnum turns "SOME_NEW_REASON" into "Some new reason".
func humanizeEnum(s string) string {
	s = strings.ToLower(strings.ReplaceAll(strings.TrimSpace(s), "_", " "))
	if s == "" {
		return ""
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// maxRebootReasonLen caps the free-text reboot reason; some devices report
// multi-line dumps.
const maxRebootReasonLen = 1000

func floatPtr(f float64) *float64 { return &f }

// positive returns &f only for a present, positive value (zero totals mean
// "not reported": protobuf omits/zeroes unset doubles).
func positive(f float64, ok bool) *float64 {
	if !ok || f <= 0 {
		return nil
	}
	return &f
}

// nonNegative returns &f for a present, non-negative value.
func nonNegative(f float64, ok bool) *float64 {
	if !ok || f < 0 {
		return nil
	}
	return &f
}

// BuildDeviceInfo normalizes a GET /devices/id/{id}/status document. now is
// injected for testability. Workloads are filled in separately
// (BuildWorkloads). It returns an error-free best effort: an unparseable
// document yields an almost-empty DeviceInfo.
func BuildDeviceInfo(nodeID string, status json.RawMessage, now time.Time) *DeviceInfo {
	info := &DeviceInfo{NodeID: nodeID, Workloads: []WorkloadInfo{}}
	st := parseJSONObj(status)
	if st == nil {
		return info
	}

	info.Name = st.str("name")
	info.RunState = st.str("runState")
	info.Online = info.RunState == "RUN_STATE_ONLINE" || info.RunState == "ONLINE"

	// EVE version: the activated image is the running one.
	sw := st.list("swInfo")
	activeIdx := -1
	for i, e := range sw {
		if e.boolean("activated") {
			activeIdx = i
			break
		}
	}
	if activeIdx < 0 {
		// Fall back to a partition the device itself calls active.
		for i, e := range sw {
			if strings.EqualFold(e.str("partitionState"), "active") {
				activeIdx = i
				break
			}
		}
	}
	swVersion := func(e jsonObj) string {
		if v := e.str("shortVersion"); v != "" {
			return v
		}
		return e.str("longVersion")
	}
	if activeIdx >= 0 {
		info.EveVersion = swVersion(sw[activeIdx])
		info.Partition = sw[activeIdx].str("partitionLabel")
	}
	for i, e := range sw {
		if i == activeIdx {
			continue
		}
		if v := swVersion(e); v != "" && v != info.EveVersion {
			info.OtherVersion = v
			info.OtherPartition = e.str("partitionLabel")
			info.OtherState = strings.ToLower(e.str("partitionState"))
			break
		}
	}

	// Boot time / uptime. bootTime is authoritative. upTime is a timestamp
	// holding the uptime as an offset from the epoch; it is only a fallback
	// and 1970/zero means "no data".
	if bt, ok := parseControllerTime(st.str("bootTime")); ok && !bt.After(now) {
		info.BootTime = bt.Format(time.RFC3339)
		if info.Online {
			up := int64(now.Sub(bt).Seconds())
			info.UptimeSec = &up
		}
	} else if info.Online {
		// (Not parseControllerTime: a real value is, by design, in 1970.)
		if ut, err := time.Parse(time.RFC3339Nano, st.str("upTime")); err == nil {
			d := time.Duration(ut.Unix()) * time.Second
			if d > 0 && d < maxPlausibleUptime {
				up := int64(d.Seconds())
				info.UptimeSec = &up
				info.BootTime = now.Add(-d).UTC().Format(time.RFC3339)
			}
		}
	}

	// Last reboot.
	reboot := &RebootInfo{}
	if raw, ok := st.field("deviceRebootReason"); ok {
		var name string
		var number int
		if json.Unmarshal(raw, &name) == nil {
			reboot.Code = RebootCode(name)
		} else if json.Unmarshal(raw, &number) == nil {
			reboot.Code = rebootEnumByNumber[number]
		}
		reboot.Label = RebootLabel(reboot.Code)
	}
	reason := st.str("lastRebootReason")
	if r := []rune(reason); len(r) > maxRebootReasonLen {
		reason = string(r[:maxRebootReasonLen]) + "…"
	}
	reboot.Reason = reason
	if rt, ok := parseControllerTime(st.str("lastRebootTime")); ok {
		reboot.Time = rt.Format(time.RFC3339)
	}
	if reboot.Code != "" || reboot.Reason != "" || reboot.Time != "" {
		info.LastReboot = reboot
	}

	dinfo := st.obj("dinfo")

	// CPU. Cpu.Utilization is percent of total device capacity (0-100): the
	// controller computes a 1-hour average from cumulative CPU time
	// (last-first over the past hour, clamped at 0) and EVE already scales by
	// CPU count (host busy time / Ncpus, app time / VCpus). Values are shown
	// as-is, not rescaled. With no samples (e.g. offline) the controller
	// returns {Utilization:0}, so the UI hides it for non-online devices.
	// A present-but-empty object is a genuine 0 (proto3 omits zero doubles).
	cpu := &CPUInfo{}
	haveCPU := false
	if c := st.obj("cpu"); c != nil {
		haveCPU = true
		u, _ := c.num("utilization")
		cpu.Percent = floatPtr(math.Max(0, u))
	}
	if dinfo != nil {
		if n, ok := dinfo.num("nCpu"); ok && n > 0 {
			cores := int(n)
			cpu.Cores = &cores
			haveCPU = true
		}
	}
	if haveCPU {
		info.CPU = cpu
	}

	// Memory: memorySummary is current; the legacy Memory object and dinfo
	// only supply a total when memorySummary lacks one.
	mem := &MemoryInfo{}
	if ms := st.obj("memorySummary"); ms != nil {
		mem.TotalMB = positive(ms.num("deviceMemoryMB"))
		// The controller always emits memorySummary, all zeros when the
		// device never reported; treat that as absent, not as "0 MB used".
		used, usedOK := ms.num("usedEveMB")
		apps, appsOK := ms.num("allocatedAppsMB")
		eve, eveOK := ms.num("allocatedEveMB")
		if used != 0 || apps != 0 || eve != 0 {
			mem.UsedEveMB = nonNegative(used, usedOK)
			mem.AllocatedAppsMB = nonNegative(apps, appsOK)
			mem.AllocatedEveMB = nonNegative(eve, eveOK)
		}
	}
	if mem.TotalMB == nil {
		if legacy := st.obj("memory"); legacy != nil {
			mem.TotalMB = positive(legacy.num("totalMB"))
		}
	}
	if mem.TotalMB == nil && dinfo != nil {
		mem.TotalMB = positive(dinfo.num("memMB"))
	}
	if *mem != (MemoryInfo{}) {
		info.Memory = mem
	}

	// Storage.
	stor := &StorageInfo{}
	if s := st.obj("storage"); s != nil {
		stor.TotalMB = positive(s.num("totalMB"))
		stor.UsedMB = nonNegative(s.num("usedMB"))
	}
	if stor.TotalMB == nil && dinfo != nil {
		stor.TotalMB = positive(dinfo.num("storageMB"))
	}
	if *stor != (StorageInfo{}) {
		info.Storage = stor
	}

	return info
}

// BuildWorkloads normalizes app-instance status items. Per-app CPU comes from
// cpu.Utilization (AppInstStatusMsg) or the flat cpuUtilization (the summary
// shape); memory from memorySummary {AllocatedMB, UsedMB}. Same meaning as the
// device CPU: percent of total capacity, 1-hour average.
func BuildWorkloads(items []json.RawMessage) []WorkloadInfo {
	out := make([]WorkloadInfo, 0, len(items))
	for _, item := range items {
		o := parseJSONObj(item)
		if o == nil {
			continue
		}
		w := WorkloadInfo{
			ID:       o.str("id"),
			Name:     o.str("name"),
			RunState: o.str("runState"),
		}
		if w.Name == "" {
			w.Name = w.ID
		}
		if c := o.obj("cpu"); c != nil {
			if u, ok := c.num("utilization"); ok {
				w.CPUPercent = nonNegative(u, true)
			}
		} else if u, ok := o.num("cpuUtilization"); ok {
			w.CPUPercent = nonNegative(u, true)
		}
		if m := o.obj("memorySummary"); m != nil {
			w.MemUsedMB = nonNegative(m.num("usedMB"))
			w.MemAllocatedMB = positive(m.num("allocatedMB"))
		}
		out = append(out, w)
	}
	return out
}
