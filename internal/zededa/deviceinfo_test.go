package zededa

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

var infoNow = time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)

// Realistic device status as grpc-gateway emits it: proto-declared casing
// (Cpu/Memory/Storage capitalized, memorySummary lower camel), uint64 as
// strings, enum names.
const deviceStatusFixture = `{
  "id": "node-1",
  "name": "TO952963",
  "runState": "RUN_STATE_ONLINE",
  "upTime": "1970-01-01T00:00:00Z",
  "bootTime": "2026-10-25T09:30:00Z",
  "swInfo": [
    {"activated": false, "partitionLabel": "IMGB", "partitionState": "unused", "shortVersion": "14.5.1-lts", "longVersion": "14.5.1-lts-abc-generic"},
    {"activated": true, "partitionLabel": "IMGA", "partitionState": "active", "shortVersion": "16.6.0-lts", "longVersion": "16.6.0-lts-def-generic"}
  ],
  "lastRebootReason": "NORMAL: baseos update\nreboot",
  "lastRebootTime": "2026-10-25T09:29:00Z",
  "deviceRebootReason": "DEVICE_BOOT_REASON_UPDATE",
  "Cpu": {"Utilization": 12.5},
  "memorySummary": {"deviceMemoryMB": 7800, "allocatedAppsMB": 2048, "allocatedEveMB": 800, "usedEveMB": 640.5, "availableForNewApps": 4900},
  "Storage": {"TotalMB": 120000, "UsedMB": 33000.5},
  "dinfo": {"nCpu": 4, "memMB": "7800", "storageMB": "120000"}
}`

func TestBuildDeviceInfo_OnlineFull(t *testing.T) {
	info := BuildDeviceInfo("node-1", json.RawMessage(deviceStatusFixture), infoNow)

	if !info.Online || info.Name != "TO952963" {
		t.Fatalf("online/name: %+v", info)
	}
	if info.EveVersion != "16.6.0-lts" || info.Partition != "IMGA" {
		t.Errorf("active image: %q %q", info.EveVersion, info.Partition)
	}
	if info.OtherVersion != "14.5.1-lts" || info.OtherPartition != "IMGB" || info.OtherState != "unused" {
		t.Errorf("other image: %q %q %q", info.OtherVersion, info.OtherPartition, info.OtherState)
	}
	if info.BootTime != "2026-10-25T09:30:00Z" {
		t.Errorf("bootTime: %q", info.BootTime)
	}
	wantUp := int64(infoNow.Sub(time.Date(2026, 10, 25, 9, 30, 0, 0, time.UTC)).Seconds())
	if info.UptimeSec == nil || *info.UptimeSec != wantUp {
		t.Errorf("uptime: %v want %d", info.UptimeSec, wantUp)
	}
	lr := info.LastReboot
	if lr == nil || lr.Code != "UPDATE" || lr.Label != "Update" || lr.Time != "2026-10-25T09:29:00Z" || !strings.HasPrefix(lr.Reason, "NORMAL: baseos update") {
		t.Errorf("lastReboot: %+v", lr)
	}
	if info.CPU == nil || info.CPU.Percent == nil || *info.CPU.Percent != 12.5 || info.CPU.Cores == nil || *info.CPU.Cores != 4 {
		t.Errorf("cpu: %+v", info.CPU)
	}
	m := info.Memory
	if m == nil || *m.TotalMB != 7800 || *m.AllocatedAppsMB != 2048 || *m.AllocatedEveMB != 800 || *m.UsedEveMB != 640.5 {
		t.Errorf("memory: %+v", m)
	}
	st := info.Storage
	if st == nil || *st.TotalMB != 120000 || *st.UsedMB != 33000.5 {
		t.Errorf("storage: %+v", st)
	}
}

// The same document with every key in the other casing the gateway might use.
func TestBuildDeviceInfo_AlternateCasing(t *testing.T) {
	doc := `{
	  "name": "d", "runState": "RUN_STATE_ONLINE", "bootTime": "2026-10-27T11:00:00Z",
	  "cpu": {"utilization": 3},
	  "MemorySummary": {"DeviceMemoryMB": "4096", "UsedEveMB": 100, "AllocatedAppsMB": 1024, "AllocatedEveMB": 512},
	  "storage": {"totalMB": 1000, "usedMB": 250},
	  "DInfo": {"NCPU": 2}
	}`
	info := BuildDeviceInfo("n", json.RawMessage(doc), infoNow)
	if info.CPU == nil || *info.CPU.Percent != 3 || *info.CPU.Cores != 2 {
		t.Errorf("cpu: %+v", info.CPU)
	}
	if info.Memory == nil || *info.Memory.TotalMB != 4096 || *info.Memory.UsedEveMB != 100 {
		t.Errorf("memory: %+v", info.Memory)
	}
	if info.Storage == nil || *info.Storage.TotalMB != 1000 || *info.Storage.UsedMB != 250 {
		t.Errorf("storage: %+v", info.Storage)
	}
	if info.UptimeSec == nil || *info.UptimeSec != 3600 {
		t.Errorf("uptime: %v", info.UptimeSec)
	}
}

func TestBuildDeviceInfo_MissingFields(t *testing.T) {
	info := BuildDeviceInfo("n", json.RawMessage(`{"name":"d","runState":"RUN_STATE_ONLINE"}`), infoNow)
	if info.EveVersion != "" || info.BootTime != "" || info.UptimeSec != nil || info.LastReboot != nil ||
		info.CPU != nil || info.Memory != nil || info.Storage != nil {
		t.Errorf("expected everything optional absent: %+v", info)
	}
	if info.Workloads == nil || len(info.Workloads) != 0 {
		t.Errorf("workloads should be an empty (non-nil) list, got %#v", info.Workloads)
	}

	// Garbage and non-object documents degrade, never panic.
	for _, doc := range []string{``, `null`, `[]`, `"x"`, `{"swInfo":"nope","Cpu":[],"memorySummary":5,"bootTime":7}`} {
		got := BuildDeviceInfo("n", json.RawMessage(doc), infoNow)
		if got == nil || got.NodeID != "n" {
			t.Errorf("doc %q: %+v", doc, got)
		}
	}
}

func TestBuildDeviceInfo_Uptime(t *testing.T) {
	cases := []struct {
		name    string
		doc     string
		wantUp  int64 // -1: none
		wantBot string
	}{
		{"bootTime wins over upTime", `{"runState":"RUN_STATE_ONLINE","bootTime":"2026-10-27T11:59:00Z","upTime":"1970-01-02T00:00:00Z"}`, 60, "2026-10-27T11:59:00Z"},
		{"epoch-zero upTime is no data", `{"runState":"RUN_STATE_ONLINE","upTime":"1970-01-01T00:00:00Z"}`, -1, ""},
		{"year-1 zero time is no data", `{"runState":"RUN_STATE_ONLINE","bootTime":"0001-01-01T00:00:00Z","upTime":"0001-01-01T00:00:00Z"}`, -1, ""},
		{"upTime fallback is a delta from epoch", `{"runState":"RUN_STATE_ONLINE","upTime":"1970-01-01T01:00:00Z"}`, 3600, "2026-10-27T11:00:00Z"},
		{"absolute-looking upTime rejected", `{"runState":"RUN_STATE_ONLINE","upTime":"2026-10-27T10:00:00Z"}`, -1, ""},
		{"future bootTime rejected", `{"runState":"RUN_STATE_ONLINE","bootTime":"2027-01-01T00:00:00Z"}`, -1, ""},
		{"offline keeps boot time, drops uptime", `{"runState":"RUN_STATE_OFFLINE","bootTime":"2026-10-20T00:00:00Z"}`, -1, "2026-10-20T00:00:00Z"},
		{"offline never uses upTime", `{"runState":"RUN_STATE_SUSPECT","upTime":"1970-01-01T01:00:00Z"}`, -1, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			info := BuildDeviceInfo("n", json.RawMessage(tc.doc), infoNow)
			if tc.wantUp < 0 {
				if info.UptimeSec != nil {
					t.Errorf("uptime = %d, want none", *info.UptimeSec)
				}
			} else if info.UptimeSec == nil || *info.UptimeSec != tc.wantUp {
				t.Errorf("uptime = %v, want %d", info.UptimeSec, tc.wantUp)
			}
			if info.BootTime != tc.wantBot {
				t.Errorf("bootTime = %q, want %q", info.BootTime, tc.wantBot)
			}
		})
	}
}

func TestBuildDeviceInfo_ActivePartitionSelection(t *testing.T) {
	// activated wins even when listed second; longVersion is the fallback.
	info := BuildDeviceInfo("n", json.RawMessage(`{"swInfo":[
	  {"activated":false,"partitionLabel":"IMGA","shortVersion":"1.0.0"},
	  {"activated":true,"partitionLabel":"IMGB","longVersion":"2.0.0-long"}]}`), infoNow)
	if info.EveVersion != "2.0.0-long" || info.Partition != "IMGB" || info.OtherVersion != "1.0.0" || info.OtherPartition != "IMGA" {
		t.Errorf("%+v", info)
	}

	// Same version on both partitions: no "other" line.
	info = BuildDeviceInfo("n", json.RawMessage(`{"swInfo":[
	  {"activated":true,"partitionLabel":"IMGA","shortVersion":"1.0.0"},
	  {"activated":false,"partitionLabel":"IMGB","shortVersion":"1.0.0"}]}`), infoNow)
	if info.OtherVersion != "" {
		t.Errorf("same version should not be reported as other: %+v", info)
	}

	// No activated entry: use the one whose partitionState is "active".
	info = BuildDeviceInfo("n", json.RawMessage(`{"swInfo":[
	  {"partitionLabel":"IMGA","partitionState":"inprogress","shortVersion":"2.0.0"},
	  {"partitionLabel":"IMGB","partitionState":"active","shortVersion":"1.0.0"}]}`), infoNow)
	if info.EveVersion != "1.0.0" || info.Partition != "IMGB" || info.OtherVersion != "2.0.0" || info.OtherState != "inprogress" {
		t.Errorf("%+v", info)
	}

	// Nothing identifiable as running: no version rather than a guess.
	info = BuildDeviceInfo("n", json.RawMessage(`{"swInfo":[{"partitionLabel":"IMGA","shortVersion":"2.0.0"}]}`), infoNow)
	if info.EveVersion != "" {
		t.Errorf("must not guess a running version: %+v", info)
	}
}

func TestRebootEnumMapping(t *testing.T) {
	cases := map[string]string{
		"DEVICE_BOOT_REASON_REBOOT_CMD":    "Reboot command",
		"DEVICE_BOOT_REASON_UPDATE":        "Update",
		"DEVICE_BOOT_REASON_FATAL":         "Fatal error",
		"DEVICE_BOOT_REASON_OOM":           "Out of memory",
		"DEVICE_BOOT_REASON_WATCHDOG_HUNG": "Watchdog (hung)",
		"DEVICE_BOOT_REASON_POWER_FAIL":    "Power failure",
		"DEVICE_BOOT_REASON_KERNEL":        "Kernel panic",
		"DEVICE_BOOT_REASON_POWEROFF_CMD":  "Power off command",
		"DEVICE_BOOT_REASON_FIRST":         "First boot",
		"DEVICE_BOOT_REASON_VAULT_FAILED":  "Vault failed",
		"DEVICE_BOOT_REASON_BROWNOUT_DIP":  "Brownout dip", // unknown -> humanized tail
	}
	for enum, want := range cases {
		doc := `{"deviceRebootReason":"` + enum + `"}`
		lr := BuildDeviceInfo("n", json.RawMessage(doc), infoNow).LastReboot
		if lr == nil || lr.Label != want {
			t.Errorf("%s: got %+v, want label %q", enum, lr, want)
		}
	}

	// UNSPECIFIED carries no information; the free text alone still shows.
	info := BuildDeviceInfo("n", json.RawMessage(`{"deviceRebootReason":"DEVICE_BOOT_REASON_UNSPECIFIED"}`), infoNow)
	if info.LastReboot != nil {
		t.Errorf("UNSPECIFIED alone should yield no reboot info: %+v", info.LastReboot)
	}
	info = BuildDeviceInfo("n", json.RawMessage(`{"deviceRebootReason":"DEVICE_BOOT_REASON_UNSPECIFIED","lastRebootReason":"power cycled"}`), infoNow)
	if info.LastReboot == nil || info.LastReboot.Label != "" || info.LastReboot.Reason != "power cycled" {
		t.Errorf("free text only: %+v", info.LastReboot)
	}

	// Numeric enum.
	info = BuildDeviceInfo("n", json.RawMessage(`{"deviceRebootReason":7}`), infoNow)
	if info.LastReboot == nil || info.LastReboot.Code != "OOM" {
		t.Errorf("numeric enum: %+v", info.LastReboot)
	}

	// Long free text is capped.
	long := strings.Repeat("x", 5000)
	info = BuildDeviceInfo("n", json.RawMessage(`{"lastRebootReason":"`+long+`"}`), infoNow)
	if n := len([]rune(info.LastReboot.Reason)); n > maxRebootReasonLen+1 {
		t.Errorf("reason not capped: %d", n)
	}
}

func TestBuildDeviceInfo_ZeroTotalsAreMissing(t *testing.T) {
	// proto3 zero doubles mean "not reported"; totals fall back to dinfo.
	info := BuildDeviceInfo("n", json.RawMessage(`{
	  "memorySummary": {"deviceMemoryMB": 0}, "Memory": {"TotalMB": 0},
	  "Storage": {"TotalMB": 0, "UsedMB": 0}, "dinfo": {"memMB": "2048", "storageMB": "64000"}}`), infoNow)
	if info.Memory == nil || *info.Memory.TotalMB != 2048 {
		t.Errorf("memory fallback: %+v", info.Memory)
	}
	if info.Storage == nil || *info.Storage.TotalMB != 64000 {
		t.Errorf("storage fallback: %+v", info.Storage)
	}
}

func TestBuildWorkloads(t *testing.T) {
	items := []json.RawMessage{
		// AppInstStatusMsg shape.
		json.RawMessage(`{"id":"a1","name":"web","runState":"RUN_STATE_ONLINE","Cpu":{"Utilization":7.25},
		   "memorySummary":{"AllocatedMB":1024,"UsedMB":300.5,"AvailableMB":723.5}}`),
		// Summary shape (flat cpuUtilization), lower-case memory keys, nothing else.
		json.RawMessage(`{"id":"a2","name":"db","runState":"RUN_STATE_HALTED","cpuUtilization":0,"memorySummary":{"allocatedMB":"512"}}`),
		// Barely anything: falls back to id for the name.
		json.RawMessage(`{"id":"a3"}`),
		json.RawMessage(`"junk"`),
	}
	got := BuildWorkloads(items)
	if len(got) != 3 {
		t.Fatalf("got %d workloads: %+v", len(got), got)
	}
	if got[0].Name != "web" || got[0].RunState != "RUN_STATE_ONLINE" || *got[0].CPUPercent != 7.25 || *got[0].MemUsedMB != 300.5 || *got[0].MemAllocatedMB != 1024 {
		t.Errorf("web: %+v", got[0])
	}
	if got[1].CPUPercent == nil || *got[1].CPUPercent != 0 || got[1].MemUsedMB != nil || *got[1].MemAllocatedMB != 512 {
		t.Errorf("db: %+v", got[1])
	}
	if got[2].Name != "a3" || got[2].CPUPercent != nil || got[2].MemAllocatedMB != nil {
		t.Errorf("a3: %+v", got[2])
	}
	if out := BuildWorkloads(nil); out == nil || len(out) != 0 {
		t.Errorf("nil input should give empty non-nil slice: %#v", out)
	}
}

func TestPageTokenHelpers(t *testing.T) {
	cursor := json.RawMessage(`{"pageToken":"200","pageNum":1,"pageSize":200,"totalPages":3}`)
	tok := nextCursorToken(cursor)
	if tok == "" || pageTokenParam(tok) != "200" {
		t.Errorf("tok=%q param=%q", tok, pageTokenParam(tok))
	}
	last := json.RawMessage(`{"pageToken":"","pageNum":3,"pageSize":200,"totalPages":3}`)
	if nextCursorToken(last) != "" || nextCursorToken(json.RawMessage(`null`)) != "" || nextCursorToken(nil) != "" {
		t.Error("last page / null / absent must end paging")
	}
	if got := nextCursorToken(json.RawMessage(`"opaque"`)); got != "opaque" || pageTokenParam(got) != "opaque" {
		t.Errorf("opaque string cursor: %q", got)
	}
}

// The raw status call must surface auth errors as the shared sentinels, like
// the typed calls do.
func TestGetDeviceStatusRaw_AuthAndBody(t *testing.T) {
	status := http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/devices/id/node-1/status" {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		w.WriteHeader(status)
		w.Write([]byte(`{"name":"d"}`))
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "tok")

	raw, err := c.GetDeviceStatusRaw("node-1")
	if err != nil || string(raw) != `{"name":"d"}` {
		t.Fatalf("raw=%s err=%v", raw, err)
	}
	status = http.StatusUnauthorized
	if _, err := c.GetDeviceStatusRaw("node-1"); !errors.Is(err, ErrUnauthorized) {
		t.Errorf("want ErrUnauthorized, got %v", err)
	}
	status = http.StatusForbidden
	if _, err := c.GetDeviceStatusRaw("node-1"); !errors.Is(err, ErrForbidden) {
		t.Errorf("want ErrForbidden, got %v", err)
	}
}

// App statuses are walked page by page and filtered to the device by id; the
// existing typed call keeps working on top of the same walk.
func TestGetDeviceAppStatuses_PagesAndFilters(t *testing.T) {
	var tokens []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("deviceName") != "TO1" {
			t.Errorf("deviceName filter missing: %s", r.URL.RawQuery)
		}
		tok := r.URL.Query().Get("next.pageToken")
		tokens = append(tokens, tok)
		switch tok {
		case "":
			w.Write([]byte(`{"list":[{"id":"a1","name":"one","deviceId":"dev-1","Cpu":{"Utilization":1}},{"id":"x","name":"other","deviceId":"dev-2"}],
			  "next":{"pageToken":"2","pageNum":1,"totalPages":2}}`))
		case "2":
			w.Write([]byte(`{"list":[{"id":"a2","name":"two","deviceId":"dev-1"}],"next":{"pageToken":"","pageNum":2,"totalPages":2}}`))
		default:
			t.Errorf("unexpected page token %q", tok)
		}
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "tok")

	items, err := c.GetDeviceAppStatuses("dev-1", "TO1")
	if err != nil {
		t.Fatal(err)
	}
	got := BuildWorkloads(items)
	if len(got) != 2 || got[0].Name != "one" || got[1].Name != "two" {
		t.Fatalf("workloads: %+v", got)
	}
	if !reflect.DeepEqual(tokens, []string{"", "2"}) {
		t.Errorf("page tokens requested: %q", tokens)
	}

	tokens = nil
	apps, err := c.GetDeviceAppInstances("dev-1", "TO1")
	if err != nil || len(apps) != 2 || apps[1].Name != "two" {
		t.Fatalf("typed call: %+v err=%v", apps, err)
	}
}

// A cursor that never advances must not loop forever.
func TestGetDeviceAppStatuses_StuckCursorTerminates(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Write([]byte(`{"list":[],"next":{"pageToken":"same","pageNum":1,"totalPages":9}}`))
	}))
	defer srv.Close()
	if _, err := NewClient(srv.URL, "tok").GetDeviceAppStatuses("d", "n"); err != nil {
		t.Fatal(err)
	}
	if calls > 2 {
		t.Errorf("stuck cursor fetched %d pages", calls)
	}
}
