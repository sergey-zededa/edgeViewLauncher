package zededa

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRebootEnumNumbers13And14(t *testing.T) {
	for n, want := range map[string]string{"13": "VAULT_FAILED", "14": "POWEROFF_CMD"} {
		info := BuildDeviceInfo("n", json.RawMessage(`{"deviceRebootReason":`+n+`}`), infoNow)
		if info.LastReboot == nil || info.LastReboot.Code != want || info.LastReboot.Label == "" {
			t.Errorf("%s: %+v", n, info.LastReboot)
		}
	}
}

// memorySummary is always emitted, all zeros when the device never reported:
// usage must be absent while the total can still fall back to dinfo.
func TestBuildDeviceInfo_AllZeroMemorySummary(t *testing.T) {
	doc := `{"memorySummary":{"deviceMemoryMB":0,"usedEveMB":0,"allocatedAppsMB":0,"allocatedEveMB":0},"dinfo":{"memMB":"7800"}}`
	info := BuildDeviceInfo("n", json.RawMessage(doc), infoNow)
	if info.Memory == nil || info.Memory.TotalMB == nil || *info.Memory.TotalMB != 7800 {
		t.Fatalf("total should fall back to dinfo: %+v", info.Memory)
	}
	if info.Memory.UsedEveMB != nil || info.Memory.AllocatedAppsMB != nil || info.Memory.AllocatedEveMB != nil {
		t.Errorf("all-zero usage must be absent: %+v", info.Memory)
	}
	info = BuildDeviceInfo("n", json.RawMessage(`{"memorySummary":{"usedEveMB":0,"allocatedAppsMB":0,"allocatedEveMB":0}}`), infoNow)
	if info.Memory != nil {
		t.Errorf("nothing reported should yield no memory: %+v", info.Memory)
	}
}

// Non-object items (null) carry no deviceId and must be skipped, not returned
// as zero-valued app instances.
func TestGetDeviceAppStatuses_SkipsNonObjectItems(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(`{"list":[null,{"id":"a1","name":"one","deviceId":"dev-1"},{"id":"nodev","name":"x"},7],"next":{"pageToken":""}}`))
	}))
	defer srv.Close()
	c := NewClient(srv.URL, "tok")
	items, err := c.GetDeviceAppStatuses("dev-1", "TO1")
	if err != nil || len(items) != 1 {
		t.Fatalf("items=%d err=%v", len(items), err)
	}
	apps, err := c.GetDeviceAppInstances("dev-1", "TO1")
	if err != nil || len(apps) != 1 || apps[0].Name != "one" {
		t.Fatalf("typed: %+v err=%v", apps, err)
	}
}
