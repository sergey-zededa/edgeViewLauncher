package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"edgeViewLauncher/internal/zededa"
)

const infoStatusDoc = `{
  "id": "node-1", "name": "TO952963", "runState": "RUN_STATE_ONLINE",
  "bootTime": "2026-10-25T09:30:00Z",
  "swInfo": [{"activated": true, "partitionLabel": "IMGA", "shortVersion": "16.6.0-lts"}],
  "deviceRebootReason": "DEVICE_BOOT_REASON_REBOOT_CMD",
  "Cpu": {"Utilization": 9}
}`

var infoAppDocs = []json.RawMessage{
	json.RawMessage(`{"id":"a1","name":"web","runState":"RUN_STATE_ONLINE","Cpu":{"Utilization":4},"memorySummary":{"AllocatedMB":512,"UsedMB":128}}`),
}

func TestGetDeviceInfo_Success(t *testing.T) {
	fake := &fakeZededaClient{statusRaw: json.RawMessage(infoStatusDoc), appStatusItems: infoAppDocs}
	a := newTestApp(fake, &fakeSessionManager{})

	info, err := a.GetDeviceInfo("node-1", "TO952963")
	if err != nil {
		t.Fatal(err)
	}
	if info.EveVersion != "16.6.0-lts" || info.Partition != "IMGA" || !info.Online || info.UptimeSec == nil {
		t.Errorf("device half: %+v", info)
	}
	if info.LastReboot == nil || info.LastReboot.Label != "Reboot command" {
		t.Errorf("reboot: %+v", info.LastReboot)
	}
	if !info.WorkloadsAvailable || len(info.Workloads) != 1 || info.Workloads[0].Name != "web" ||
		*info.Workloads[0].CPUPercent != 4 || *info.Workloads[0].MemAllocatedMB != 512 {
		t.Errorf("workloads: %+v", info.Workloads)
	}
	if !reflect.DeepEqual(fake.appStatusCalls, [][2]string{{"node-1", "TO952963"}}) {
		t.Errorf("app status calls: %v", fake.appStatusCalls)
	}
}

// With no name from the caller the status is read first and its name drives
// the app lookup.
func TestGetDeviceInfo_NameFromStatus(t *testing.T) {
	fake := &fakeZededaClient{statusRaw: json.RawMessage(infoStatusDoc), appStatusItems: infoAppDocs}
	a := newTestApp(fake, &fakeSessionManager{})

	info, err := a.GetDeviceInfo("node-1", "")
	if err != nil || !info.WorkloadsAvailable {
		t.Fatalf("info=%+v err=%v", info, err)
	}
	if !reflect.DeepEqual(fake.appStatusCalls, [][2]string{{"node-1", "TO952963"}}) {
		t.Errorf("app status calls: %v", fake.appStatusCalls)
	}

	// Neither a name from the caller nor from the status: device half only.
	fake = &fakeZededaClient{statusRaw: json.RawMessage(`{"runState":"RUN_STATE_ONLINE"}`)}
	a = newTestApp(fake, &fakeSessionManager{})
	info, err = a.GetDeviceInfo("node-1", "")
	if err != nil || info.WorkloadsAvailable || info.WorkloadsError == "" || len(fake.appStatusCalls) != 0 {
		t.Errorf("info=%+v err=%v calls=%v", info, err, fake.appStatusCalls)
	}
}

// The app call failing must not lose the device half.
func TestGetDeviceInfo_AppsFailDeviceStillReturned(t *testing.T) {
	fake := &fakeZededaClient{statusRaw: json.RawMessage(infoStatusDoc), appStatusErr: errors.New("boom")}
	a := newTestApp(fake, &fakeSessionManager{})

	info, err := a.GetDeviceInfo("node-1", "TO952963")
	if err != nil {
		t.Fatalf("app failure must not fail the call: %v", err)
	}
	if info.EveVersion != "16.6.0-lts" {
		t.Errorf("device half lost: %+v", info)
	}
	if info.WorkloadsAvailable || len(info.Workloads) != 0 || info.WorkloadsError != "boom" {
		t.Errorf("workloads flag: avail=%v n=%d err=%q", info.WorkloadsAvailable, len(info.Workloads), info.WorkloadsError)
	}
}

func TestGetDeviceInfo_StatusErrorPropagates(t *testing.T) {
	fake := &fakeZededaClient{statusRawErr: zededa.ErrUnauthorized}
	a := newTestApp(fake, &fakeSessionManager{})
	if _, err := a.GetDeviceInfo("node-1", "TO952963"); !errors.Is(err, zededa.ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized, got %v", err)
	}
	if _, err := a.GetDeviceInfo("", ""); err == nil {
		t.Fatal("empty nodeId must be rejected")
	}
}

// Cloud read: an offline device works, gets no uptime, and never involves the
// EdgeView session layer.
func TestGetDeviceInfo_OfflineDeviceNoSession(t *testing.T) {
	fake := &fakeZededaClient{statusRaw: json.RawMessage(`{"name":"d","runState":"RUN_STATE_OFFLINE","bootTime":"2026-10-20T00:00:00Z"}`)}
	sess := &fakeSessionManager{}
	a := newTestApp(fake, sess)

	info, err := a.GetDeviceInfo("node-1", "d")
	if err != nil {
		t.Fatal(err)
	}
	if info.Online || info.UptimeSec != nil || info.BootTime != "2026-10-20T00:00:00Z" {
		t.Errorf("offline: %+v", info)
	}
	if fake.edgeStatusCalls != 0 {
		t.Errorf("device info must not read EdgeView status (%d calls)", fake.edgeStatusCalls)
	}
}

func postDeviceInfo(t *testing.T, srv *HTTPServer, body string) (*httptest.ResponseRecorder, APIResponse) {
	t.Helper()
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/device-info", bytes.NewBufferString(body))
	srv.handleGetDeviceInfo(rr, req)
	var resp APIResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("bad response %q: %v", rr.Body.String(), err)
	}
	return rr, resp
}

func TestHandleGetDeviceInfo(t *testing.T) {
	fake := &fakeZededaClient{statusRaw: json.RawMessage(infoStatusDoc), appStatusItems: infoAppDocs}
	srv := &HTTPServer{app: newTestApp(fake, &fakeSessionManager{})}

	rr, resp := postDeviceInfo(t, srv, `{"nodeId":"node-1","nodeName":"TO952963"}`)
	if rr.Code != http.StatusOK || !resp.Success {
		t.Fatalf("status %d: %+v", rr.Code, resp)
	}
	data := resp.Data.(map[string]interface{})
	for _, key := range []string{"nodeId", "eveVersion", "partition", "bootTime", "uptimeSec", "lastReboot", "cpu", "workloads", "workloadsAvailable", "online"} {
		if _, ok := data[key]; !ok {
			t.Errorf("response missing %q: %v", key, data)
		}
	}
	// Optional values absent from the source are omitted, not zero-filled.
	for _, key := range []string{"memory", "storage", "otherVersion", "workloadsError"} {
		if _, ok := data[key]; ok {
			t.Errorf("response should omit %q: %v", key, data)
		}
	}
	if wl := data["workloads"].([]interface{}); len(wl) != 1 || wl[0].(map[string]interface{})["name"] != "web" {
		t.Errorf("workloads: %v", data["workloads"])
	}
}

func TestHandleGetDeviceInfo_AuthErrorsMapToCodes(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
		code   string
	}{
		{fmt.Errorf("wrapped: %w", zededa.ErrUnauthorized), http.StatusUnauthorized, "UNAUTHORIZED"},
		{&zededa.ForbiddenError{Permission: "PermissionDeviceRead"}, http.StatusForbidden, "FORBIDDEN"},
	} {
		srv := &HTTPServer{app: newTestApp(&fakeZededaClient{statusRawErr: tc.err}, &fakeSessionManager{})}
		rr, resp := postDeviceInfo(t, srv, `{"nodeId":"node-1"}`)
		if rr.Code != tc.status || resp.Success || resp.Code != tc.code {
			t.Errorf("%v: status=%d resp=%+v", tc.err, rr.Code, resp)
		}
	}
}
