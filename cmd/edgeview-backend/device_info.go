package main

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"edgeViewLauncher/internal/zededa"
)

// GetDeviceInfo builds the details-page "Device" panel: EVE version, uptime,
// last reboot and resource use for the device and its app instances.
//
// This is a pure cloud read (device status + app instance status), so it works
// for offline devices and never touches the EdgeView session — it is
// cloud-config class, not live-session class (see CLAUDE.md).
//
// deviceName is optional. With it, the two controller calls run concurrently;
// without it the status call comes first so the name can be read from it.
// A failed device-status call is an error. A failed app-status call is not: the
// device half is returned with Workloads empty and WorkloadsAvailable false.
func (a *App) GetDeviceInfo(nodeID, deviceName string) (*zededa.DeviceInfo, error) {
	if nodeID == "" {
		return nil, fmt.Errorf("nodeId is required")
	}

	var (
		statusRaw json.RawMessage
		statusErr error
		appItems  []json.RawMessage
		appsErr   error
		wg        sync.WaitGroup
	)

	fetchApps := func(name string) {
		appItems, appsErr = a.zededaClient.GetDeviceAppStatuses(nodeID, name)
	}

	if deviceName != "" {
		wg.Add(1)
		go func() {
			defer wg.Done()
			fetchApps(deviceName)
		}()
		statusRaw, statusErr = a.zededaClient.GetDeviceStatusRaw(nodeID)
		wg.Wait()
	} else {
		statusRaw, statusErr = a.zededaClient.GetDeviceStatusRaw(nodeID)
	}
	if statusErr != nil {
		return nil, statusErr
	}

	info := zededa.BuildDeviceInfo(nodeID, statusRaw, time.Now())

	if deviceName == "" {
		if info.Name == "" {
			// App statuses can only be filtered by device name.
			info.WorkloadsError = "device name unavailable"
			return info, nil
		}
		fetchApps(info.Name)
	}
	if appsErr != nil {
		fmt.Printf("DEBUG: device-info: app statuses for %s unavailable: %v\n", nodeID, appsErr)
		info.WorkloadsError = appsErr.Error()
		return info, nil
	}
	info.Workloads = zededa.BuildWorkloads(appItems)
	info.WorkloadsAvailable = true
	return info, nil
}
