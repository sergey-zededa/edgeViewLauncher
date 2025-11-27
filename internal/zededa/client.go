package zededa

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type Node struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Project  string `json:"project"`  // Changed from projectId to match frontend
	Status   string `json:"status"`   // Corrected JSON tag for frontend
	EdgeView bool   `json:"edgeview"` // Check if this field exists or we need to check config
}

// API Response structures
type DeviceListResponse struct {
	List []Device `json:"list"`
}

type Device struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	ProjectID  string `json:"projectId"`
	AdminState string `json:"adminState"`
	RunState   string `json:"runState"`
	// Add other fields as necessary
}

type AppInstance struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	AppType    string `json:"appType"`
	RunState   string `json:"runState"`
	AdminState string `json:"adminState"` // Add adminState
	ProjectID  string `json:"projectId"`
	DeviceID   string `json:"deviceId"` // Device UUID this app belongs to
}

type AppInstanceListResponse struct {
	List []AppInstance `json:"list"`
}

type Enterprise struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Project struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type ProjectListResponse struct {
	List []Project `json:"list"`
}

type Client struct {
	BaseURL    string
	Token      string
	HTTPClient *http.Client
}

func NewClient(baseURL, token string) *Client {
	return &Client{
		BaseURL: baseURL,
		Token:   token,
		HTTPClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// UpdateConfig updates the client's base URL and token
func (c *Client) UpdateConfig(baseURL, token string) {
	c.BaseURL = baseURL
	c.Token = token
}

func (c *Client) SearchNodes(query string) ([]Node, error) {
	if c.Token == "" {
		return nil, fmt.Errorf("API token not configured")
	}

	// Use status endpoint to get runtime state
	url := fmt.Sprintf("%s/api/v1/devices/status", c.BaseURL)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("API request failed with status: %d", resp.StatusCode)
	}

	var deviceResp DeviceListResponse
	if err := json.NewDecoder(resp.Body).Decode(&deviceResp); err != nil {
		return nil, err
	}

	var results []Node
	query = strings.ToLower(query)
	for _, d := range deviceResp.List {
		// Simple client-side filter for MVP
		if query != "" && !strings.Contains(strings.ToLower(d.Name), query) && !strings.Contains(strings.ToLower(d.ProjectID), query) {
			continue
		}

		runState := strings.TrimSpace(d.RunState)
		status := "offline"
		if runState == "RUN_STATE_ONLINE" || runState == "ONLINE" {
			status = "online"
		} else {
			// Cleanup status string for display (e.g. RUN_STATE_REBOOTING -> REBOOTING)
			status = strings.TrimPrefix(runState, "RUN_STATE_")
			status = strings.ToLower(status)
		}

		results = append(results, Node{
			ID:       d.ID,
			Name:     d.Name,
			Project:  d.ProjectID, // TODO: Resolve project name
			Status:   status,
			EdgeView: true, // TODO: Check actual EdgeView status
		})
	}
	return results, nil
}

// GetDeviceAppInstances fetches the list of app instances for a specific device
func (c *Client) GetDeviceAppInstances(deviceId string) ([]AppInstance, error) {
	if c.Token == "" {
		return nil, fmt.Errorf("API token not configured")
	}

	// Use apps/instances/status endpoint
	// We use the device name here because the API likely expects it for the deviceId filter
	url := fmt.Sprintf("%s/api/v1/apps/instances/status?deviceId=%s", c.BaseURL, deviceId)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("API request failed with status: %d", resp.StatusCode)
	}

	var appResp AppInstanceListResponse
	if err := json.NewDecoder(resp.Body).Decode(&appResp); err != nil {
		return nil, err
	}

	// Client-side filter: API ignores deviceId query param, so filter manually
	filteredApps := []AppInstance{}
	for _, app := range appResp.List {
		if app.DeviceID == deviceId {
			filteredApps = append(filteredApps, app)
		}
	}

	return filteredApps, nil
}

// AppInstanceDetails contains detailed app instance information including network adapters
type VMInfo struct {
	VNC        bool `json:"vnc"`
	VNCDisplay int  `json:"vncDisplay"`
}

type AppInstanceDetails struct {
	ID              string                   `json:"id"`
	Name            string                   `json:"name"`
	NetworkAdapters []map[string]interface{} `json:"interfaces"`
	AppType         string                   `json:"appType"`
	DeploymentType  string                   `json:"deploymentType"`
	VMInfo          VMInfo                   `json:"vminfo"`
}

// GetAppInstanceDetails fetches detailed app instance information including network adapters
func (c *Client) GetAppInstanceDetails(appInstanceID string) (*AppInstanceDetails, error) {
	if c.Token == "" {
		return nil, fmt.Errorf("API token not configured")
	}

	url := fmt.Sprintf("%s/api/v1/apps/instances/id/%s", c.BaseURL, appInstanceID)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API request failed with status %d: %s", resp.StatusCode, string(body))
	}

	var details AppInstanceDetails
	if err := json.NewDecoder(resp.Body).Decode(&details); err != nil {
		return nil, err
	}

	return &details, nil
}

// GetEnterprise fetches the enterprise information
func (c *Client) GetEnterprise() (*Enterprise, error) {
	url := fmt.Sprintf("%s/api/v1/enterprises/self", c.BaseURL)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("API request failed with status: %d", resp.StatusCode)
	}

	var enterprise Enterprise
	if err := json.NewDecoder(resp.Body).Decode(&enterprise); err != nil {
		return nil, err
	}

	return &enterprise, nil
}

// GetProjects fetches all projects
func (c *Client) GetProjects() ([]Project, error) {
	url := fmt.Sprintf("%s/api/v1/projects", c.BaseURL)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("API request failed with status: %d", resp.StatusCode)
	}

	var projectResp ProjectListResponse
	if err := json.NewDecoder(resp.Body).Decode(&projectResp); err != nil {
		return nil, err
	}

	return projectResp.List, nil
}

// EdgeView Request/Response structures
type EdgeViewConfig struct {
	DebugKnob bool   `json:"debugKnob"`
	Expiry    string `json:"expiry"` // minutes
}

type EdgeViewScriptResponse struct {
	ClientScript string `json:"client_script"`
}

// StartEdgeView enables EdgeView on the device
func (c *Client) StartEdgeView(nodeID string) error {
	url := fmt.Sprintf("%s/api/v1/devices/id/%s/edgeview/enable", c.BaseURL, nodeID)

	payload := EdgeViewConfig{
		DebugKnob: true,
		Expiry:    "60", // 60 minutes
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("PUT", url, bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to enable EdgeView (status %d): %s", resp.StatusCode, string(body))
	}

	return nil
}

// StopEdgeView disables EdgeView on the device
func (c *Client) StopEdgeView(nodeID string) error {
	url := fmt.Sprintf("%s/api/v1/devices/id/%s/edgeview/enable", c.BaseURL, nodeID)

	payload := EdgeViewConfig{
		DebugKnob: false,
		Expiry:    "60",
	}

	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("PUT", url, bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to disable EdgeView (status %d): %s", resp.StatusCode, string(body))
	}

	return nil
}

// GetEdgeViewScript retrieves the client script
func (c *Client) GetEdgeViewScript(nodeID string) (string, error) {
	url := fmt.Sprintf("%s/api/v1/devices/id/%s/edgeview/clientscript", c.BaseURL, nodeID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("failed to get script (status %d)", resp.StatusCode)
	}

	var scriptResp EdgeViewScriptResponse
	if err := json.NewDecoder(resp.Body).Decode(&scriptResp); err != nil {
		return "", err
	}

	return scriptResp.ClientScript, nil
}

type SessionConfig struct {
	URL     string
	Token   string
	UUID    string
	InstID  int
	MaxInst int
	Key     string // JWT Key (Nonce)
}

// ParseEdgeViewScript extracts the WebSocket URL, Token, and Session Details from the script
func (c *Client) ParseEdgeViewScript(script string) (*SessionConfig, error) {
	// 1. Extract Token
	tokenRegex := regexp.MustCompile(`-token\s+([a-zA-Z0-9\-\._~+/]+=*)`)
	tokenMatches := tokenRegex.FindStringSubmatch(script)

	if len(tokenMatches) < 2 {
		// Fallback
		tokenRegex = regexp.MustCompile(`Authorization: Bearer ([a-zA-Z0-9\-\._~+/]+=*)`)
		tokenMatches = tokenRegex.FindStringSubmatch(script)
	}

	if len(tokenMatches) < 2 {
		return nil, fmt.Errorf("could not find auth token in script")
	}
	token := tokenMatches[1]

	// 2. Extract Details from Token (JWT)
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, fmt.Errorf("invalid token format (not JWT)")
	}

	// Decode payload
	payloadSegment := parts[1]
	if l := len(payloadSegment) % 4; l > 0 {
		payloadSegment += strings.Repeat("=", 4-l)
	}

	payloadBytes, err := base64.URLEncoding.DecodeString(payloadSegment)
	if err != nil {
		payloadBytes, err = base64.StdEncoding.DecodeString(payloadSegment)
		if err != nil {
			return nil, fmt.Errorf("failed to decode JWT payload: %w", err)
		}
	}

	var claims struct {
		Dep string `json:"dep"` // Dispatcher endpoint
		Sub string `json:"sub"` // Device UUID
		Num int    `json:"num"` // Max instances
		Key string `json:"key"` // Nonce key
	}
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JWT claims: %w", err)
	}

	if claims.Dep == "" {
		return nil, fmt.Errorf("JWT payload missing 'dep' field")
	}

	// Construct WebSocket URL
	url := claims.Dep
	if !strings.HasPrefix(url, "ws://") && !strings.HasPrefix(url, "wss://") {
		if strings.HasPrefix(url, "http://") {
			url = "ws" + strings.TrimPrefix(url, "http")
		} else if strings.HasPrefix(url, "https://") {
			url = "wss" + strings.TrimPrefix(url, "https")
		} else {
			url = "wss://" + url
		}
	}

	// Determine Instance ID
	// Default logic from edgeview client:
	// If Num > 1, default to inst 1. If Num == 1, default to inst 0.
	instID := 0
	if claims.Num > 1 {
		instID = 1
	}

	return &SessionConfig{
		URL:     url,
		Token:   token,
		UUID:    claims.Sub,
		InstID:  instID,
		MaxInst: claims.Num,
		Key:     claims.Key,
	}, nil
}

func (c *Client) InitSession(targetID string) (string, error) {
	// 1. Enable EdgeView
	fmt.Printf("Enabling EdgeView for %s...\n", targetID)
	if err := c.StartEdgeView(targetID); err != nil {
		return "", err
	}

	// 2. Poll for script
	fmt.Printf("Waiting for EdgeView script...\n")
	timeout := time.After(30 * time.Second)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			return "", fmt.Errorf("timeout waiting for EdgeView script")
		case <-ticker.C:
			script, err := c.GetEdgeViewScript(targetID)
			if err == nil && script != "" {
				return script, nil
			}
		}
	}
}

// Device Configuration Structures
type ConfigItem struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// GetDevice fetches the full device configuration
func (c *Client) GetDevice(nodeID string) (map[string]interface{}, error) {
	url := fmt.Sprintf("%s/api/v1/devices/id/%s", c.BaseURL, nodeID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("failed to get device (status %d)", resp.StatusCode)
	}

	var device map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&device); err != nil {
		return nil, err
	}
	return device, nil
}

// UpdateDevice updates the device configuration
func (c *Client) UpdateDevice(nodeID string, device map[string]interface{}) error {
	url := fmt.Sprintf("%s/api/v1/devices/id/%s", c.BaseURL, nodeID)

	data, err := json.Marshal(device)
	if err != nil {
		return err
	}

	req, err := http.NewRequest("PUT", url, bytes.NewBuffer(data))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("failed to update device (status %d): %s", resp.StatusCode, string(body))
	}

	return nil
}

// AddSSHKeyToDevice adds the public key to the device configuration
func (c *Client) AddSSHKeyToDevice(nodeID, publicKey string) error {
	// 1. Get Device
	device, err := c.GetDevice(nodeID)
	if err != nil {
		return fmt.Errorf("failed to get device: %w", err)
	}

	// 2. Update Config Items
	// configItem is a list of objects
	configItems, ok := device["configItem"].([]interface{})
	if !ok {
		// If missing, create it
		configItems = []interface{}{}
	}

	keyFound := false
	for i, item := range configItems {
		if cfg, ok := item.(map[string]interface{}); ok {
			if cfg["key"] == "debug.enable.ssh" {
				// Update existing key
				cfg["stringValue"] = publicKey
				configItems[i] = cfg
				keyFound = true
				break
			}
		}
	}

	if !keyFound {
		// Add new key
		configItems = append(configItems, map[string]interface{}{
			"key":         "debug.enable.ssh",
			"stringValue": publicKey,
		})
	}

	device["configItem"] = configItems

	// 3. Update Device
	if err := c.UpdateDevice(nodeID, device); err != nil {
		return fmt.Errorf("failed to update device config: %w", err)
	}

	return nil
}

// GetSSHKeyFromDevice returns the current SSH public key on the device, if any
func (c *Client) GetSSHKeyFromDevice(nodeID string) (string, error) {
	device, err := c.GetDevice(nodeID)
	if err != nil {
		return "", fmt.Errorf("failed to get device: %w", err)
	}

	configItems, ok := device["configItem"].([]interface{})
	if !ok {
		return "", nil
	}

	for _, item := range configItems {
		if cfg, ok := item.(map[string]interface{}); ok {
			if cfg["key"] == "debug.enable.ssh" {
				if val, ok := cfg["stringValue"].(string); ok {
					return val, nil
				}
				// Value might be missing or not a string
				return "", nil
			}
		}
	}

	return "", nil
}

// EdgeViewStatus contains detailed status of the EdgeView session
type EdgeViewStatus struct {
	SSHKey      string
	MaxSessions int
	Expiry      string
	DebugKnob   bool
}

// GetEdgeViewStatus returns the detailed EdgeView status from the device
func (c *Client) GetEdgeViewStatus(nodeID string) (*EdgeViewStatus, error) {
	device, err := c.GetDevice(nodeID)
	if err != nil {
		return nil, fmt.Errorf("failed to get device: %w", err)
	}

	status := &EdgeViewStatus{}

	// 1. Get SSH Key from ConfigItems
	if configItems, ok := device["configItem"].([]interface{}); ok {
		for _, item := range configItems {
			if cfg, ok := item.(map[string]interface{}); ok {
				if cfg["key"] == "debug.enable.ssh" {
					if val, ok := cfg["stringValue"].(string); ok {
						status.SSHKey = val
					}
					break
				}
			}
		}
	}

	// 2. Get EdgeView Config (Max Sessions, Expiry)
	if evConfig, ok := device["edgeviewconfig"].(map[string]interface{}); ok {
		// DEBUG: Print full edgeviewconfig
		fmt.Printf("DEBUG: edgeviewconfig: %+v\n", evConfig)

		if jwtInfo, ok := evConfig["jwtInfo"].(map[string]interface{}); ok {
			if num, ok := jwtInfo["numInst"].(float64); ok {
				status.MaxSessions = int(num)
			}
			if exp, ok := jwtInfo["expireSec"].(string); ok {
				status.Expiry = exp
			}
		}
	}

	// 3. Check Debug Knob
	if knob, ok := device["debugKnob"].(bool); ok {
		status.DebugKnob = knob
	}

	return status, nil
}

// DisableSSH removes the SSH key from the device configuration
func (c *Client) DisableSSH(nodeID string) error {
	// 1. Get Device
	device, err := c.GetDevice(nodeID)
	if err != nil {
		return fmt.Errorf("failed to get device: %w", err)
	}

	// 2. Filter Config Items
	configItems, ok := device["configItem"].([]interface{})
	if !ok {
		return nil // Already disabled (no config)
	}

	newConfigItems := []interface{}{}
	found := false
	for _, item := range configItems {
		if cfg, ok := item.(map[string]interface{}); ok {
			if cfg["key"] == "debug.enable.ssh" {
				found = true
				continue // Skip this item to remove it
			}
		}
		newConfigItems = append(newConfigItems, item)
	}

	if !found {
		return nil // Key not present, nothing to do
	}

	device["configItem"] = newConfigItems

	// 3. Update Device
	if err := c.UpdateDevice(nodeID, device); err != nil {
		return fmt.Errorf("failed to update device config: %w", err)
	}

	return nil
}
