package zededa

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
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
	// Clone default transport to keep proxy settings etc.
	transport := http.DefaultTransport.(*http.Transport).Clone()

	// Force IPv4 for dual-stack environments where IPv6 might be flaky
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		return (&net.Dialer{
			Timeout:   30 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext(ctx, "tcp4", addr)
	}

	// Disable HTTP/2
	transport.ForceAttemptHTTP2 = false
	transport.TLSNextProto = make(map[string]func(string, *tls.Conn) http.RoundTripper)
	transport.TLSClientConfig = &tls.Config{
		NextProtos: []string{"http/1.1"},
	}

	return &Client{
		BaseURL: strings.TrimSuffix(baseURL, "/"),
		Token:   token,
		HTTPClient: &http.Client{
			Timeout:   30 * time.Second,
			Transport: transport,
		},
	}
}

// UpdateConfig updates the client's base URL and token
func (c *Client) UpdateConfig(baseURL, token string) {
	c.BaseURL = strings.TrimSuffix(baseURL, "/")
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

	// fmt.Printf("DEBUG: API Request: [%s] %s\n", req.Method, req.URL.String())
	// fmt.Printf("DEBUG: API Auth: %s\n", req.Header.Get("Authorization"))

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

	// fmt.Printf("DEBUG: API Request: [%s] %s\n", req.Method, req.URL.String())
	// fmt.Printf("DEBUG: API Auth: %s\n", req.Header.Get("Authorization"))

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

type NetStatus struct {
	Up        bool     `json:"up"`
	IfName    string   `json:"ifName"`
	IPs       []string `json:"ipAddrs"`
	NetworkID string   `json:"networkId"`
}

type PortMap struct {
	IP          string `json:"ip"`
	PrivatePort int    `json:"privatePort"`
	PublicPort  int    `json:"publicPort"`
	Type        string `json:"type"`
	RuntimeIP   string `json:"runtimeIp"`
}

type ContainerInfo struct {
	Name     string    `json:"containerName"`
	Image    string    `json:"containerImage"`
	State    string    `json:"containerState"`
	Uptime   string    `json:"uptime"`
	PortMaps []PortMap `json:"portMaps"`
}

// AppInstanceConfig matches the configuration schema for an edge app instance
type AppInstanceConfig struct {
	ID            string                   `json:"id"`
	Name          string                   `json:"name"`
	Activate      bool                     `json:"activate"`
	VMInfo        VMInfo                   `json:"vminfo,omitempty"`
	Interfaces    []map[string]interface{} `json:"interfaces,omitempty"`
	DockerCompose string                   `json:"dockerComposeYamlText,omitempty"`
}

// AppInstanceStatus matches the AppInstStatusMsg schema for an edge app instance
type AppInstanceStatus struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	AdminState     string          `json:"adminState"`
	RunState       string          `json:"runState"`
	NetStatusList  []NetStatus     `json:"netStatusList,omitempty"`
	AppType        string          `json:"appType"`
	DeploymentType string          `json:"deploymentType"`
	Containers     []ContainerInfo `json:"containerStatusList,omitempty"`
}

// AppInstanceDetails is kept for compatibility and represents the status message
// It now matches AppInstanceStatus exactly.
type AppInstanceDetails AppInstanceStatus

// GetAppInstanceDetails fetches detailed app instance status information
func (c *Client) GetAppInstanceDetails(appInstanceID string) (*AppInstanceDetails, error) {
	if c.Token == "" {
		return nil, fmt.Errorf("API token not configured")
	}

	url := fmt.Sprintf("%s/api/v1/apps/instances/id/%s/status", c.BaseURL, appInstanceID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API failed with status %d: %s", resp.StatusCode, string(body))
	}

	var details AppInstanceDetails
	if err := json.NewDecoder(resp.Body).Decode(&details); err != nil {
		return nil, fmt.Errorf("failed to decode response: %v", err)
	}

	return &details, nil
}

// NetworkInstanceStatus matches the NetworkInstanceStatusMsg schema
type NetworkInstanceStatus struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"` // e.g. "NETWORK_INSTANCE_KIND_LOCAL"
	Type string `json:"type"`
}

// GetNetworkInstanceDetails fetches detailed network instance status information
func (c *Client) GetNetworkInstanceDetails(niID string) (*NetworkInstanceStatus, error) {
	if c.Token == "" {
		return nil, fmt.Errorf("API token not configured")
	}

	url := fmt.Sprintf("%s/api/v1/netinsts/id/%s/status", c.BaseURL, niID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API failed with status %d: %s", resp.StatusCode, string(body))
	}

	var status NetworkInstanceStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return nil, fmt.Errorf("failed to decode response: %v", err)
	}

	return &status, nil
}

// GetAppInstanceConfig fetches the configuration for an edge app instance
func (c *Client) GetAppInstanceConfig(appInstanceID string) (*AppInstanceConfig, error) {
	if c.Token == "" {
		return nil, fmt.Errorf("API token not configured")
	}

	url := fmt.Sprintf("%s/api/v1/apps/instances/id/%s", c.BaseURL, appInstanceID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API failed with status %d: %s", resp.StatusCode, string(body))
	}

	var config AppInstanceConfig
	if err := json.NewDecoder(resp.Body).Decode(&config); err != nil {
		return nil, fmt.Errorf("failed to decode response: %v", err)
	}

	return &config, nil
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

// DeviceStatus matches the DeviceStatusMsg schema
type DeviceStatus struct {
	ID            string      `json:"id"`
	Name          string      `json:"name"`
	ProjectID     string      `json:"projectId"`
	AdminState    string      `json:"adminState"`
	RunState      string      `json:"runState"`
	NetStatusList []NetStatus `json:"netStatusList,omitempty"`
}

// GetDeviceStatus fetches detailed device status information including network interfaces
func (c *Client) GetDeviceStatus(nodeID string) (*DeviceStatus, error) {
	if c.Token == "" {
		return nil, fmt.Errorf("API token not configured")
	}

	url := fmt.Sprintf("%s/api/v1/devices/id/%s/status", c.BaseURL, nodeID)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %v", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API failed with status %d: %s", resp.StatusCode, string(body))
	}

	var status DeviceStatus
	if err := json.NewDecoder(resp.Body).Decode(&status); err != nil {
		return nil, fmt.Errorf("failed to decode response: %v", err)
	}

	return &status, nil
}

// EdgeView Request/Response structures
type EdgeViewConfig struct {
	DebugKnob bool `json:"debugKnob"`
	Expiry    int  `json:"expiry"` // minutes
}

type EdgeViewScriptResponse struct {
	ClientScript string `json:"client_script"`
}

// StartEdgeView enables EdgeView on the device
func (c *Client) StartEdgeView(nodeID string) error {
	url := fmt.Sprintf("%s/api/v1/devices/id/%s/edgeview/enable", c.BaseURL, nodeID)

	payload := EdgeViewConfig{
		DebugKnob: true,
		Expiry:    60, // 60 minutes
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
		Expiry:    60,
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

// UpdateEdgeViewExternalPolicy updates the device configuration to enable/disable external policy
func (c *Client) UpdateEdgeViewExternalPolicy(nodeID string, enable bool) error {
	// 1. Get Device
	device, err := c.GetDevice(nodeID)
	if err != nil {
		return fmt.Errorf("failed to get device: %w", err)
	}

	// 2. Update edgeviewconfig
	evConfig, ok := device["edgeviewconfig"].(map[string]interface{})
	if !ok || evConfig == nil {
		evConfig = make(map[string]interface{})
	}

	// Update extPolicy
	// We want to set extPolicy: { "allowExt": true/false }
	evConfig["extPolicy"] = map[string]interface{}{
		"allowExt": enable,
	}
	// Also include other required fields if they are missing, based on user request example
	// "generationId" might be needed? The API usually handles it, but let's be safe.
	// The user example provided full config. Here we just merge extPolicy.

	device["edgeviewconfig"] = evConfig

	// 3. Update Device
	if err := c.UpdateDevice(nodeID, device); err != nil {
		return fmt.Errorf("failed to update device config: %w", err)
	}

	return nil
}

type SessionConfig struct {
	URL     string
	Token   string
	UUID    string
	InstID  int
	MaxInst int
	Key     string // JWT Key (Nonce)
	Enc     bool   // Encryption enabled
}

// ParseEdgeViewToken extracts Session Details from the JWT token
func (c *Client) ParseEdgeViewToken(token string) (*SessionConfig, error) {
	// Extract Details from Token (JWT)
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
		Enc bool   `json:"enc"` // Encryption enabled
	}
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, fmt.Errorf("failed to unmarshal JWT claims: %w", err)
	}

	// fmt.Printf("DEBUG: JWT Claims: Dep=%s, Sub=%s, Num=%d, Key=%s, Enc=%v\n", claims.Dep, claims.Sub, claims.Num, claims.Key, claims.Enc)

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
		Enc:     claims.Enc,
	}, nil
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

	return c.ParseEdgeViewToken(token)
}

func (c *Client) InitSession(targetID string) (string, error) {
	// 1. Enable EdgeView
	// fmt.Printf("Enabling EdgeView for %s...\n", targetID)
	if err := c.StartEdgeView(targetID); err != nil {
		return "", err
	}

	// 2. Poll for edgeviewconfig in device details
	// fmt.Printf("Waiting for EdgeView token...\n")
	timeout := time.After(30 * time.Second)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-timeout:
			return "", fmt.Errorf("timeout waiting for EdgeView token")
		case <-ticker.C:
			device, err := c.GetDevice(targetID)
			if err != nil {
				continue
			}

			if evConfig, ok := device["edgeviewconfig"].(map[string]interface{}); ok {
				if token, ok := evConfig["token"].(string); ok && token != "" {
					// We have the token, we can return it directly.
					// The caller expects the "script", but actually the caller (main.go)
					// immediately calls ParseEdgeViewScript.
					// To maintain compatibility without changing main.go yet, we can construct a fake script
					// OR better, we should update the caller to handle the token directly.
					// However, InitSession returns (string, error).
					// If we return the token, ParseEdgeViewScript needs to handle it.
					// Let's check if we can just return the token and have ParseEdgeViewScript handle it?
					// ParseEdgeViewScript expects regex match.
					// Let's return a dummy script string that ParseEdgeViewScript can parse.
					return fmt.Sprintf("edge-view -token %s", token), nil
				}
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

	// fmt.Printf("DEBUG: API Request: [%s] %s\n", req.Method, req.URL.String())
	// fmt.Printf("DEBUG: API Auth (partial): %s...\n", c.Token[:min(len(c.Token), 10)])

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

	// Clean all boolean config items before sending to API
	cleanBooleanConfigItems(configItems)

	// 3. Update Device
	if err := c.UpdateDevice(nodeID, device); err != nil {
		return fmt.Errorf("failed to update device config: %w", err)
	}

	return nil
}

// cleanBooleanConfigItems removes extraneous fields from boolean config items
// This ensures that items set by previous versions don't cause parsing errors
func cleanBooleanConfigItems(configItems []interface{}) {
	booleanKeys := []string{"debug.enable.vga", "debug.enable.usb", "debug.enable.console"}

	for i, item := range configItems {
		if cfg, ok := item.(map[string]interface{}); ok {
			key, _ := cfg["key"].(string)

			// Check if this is one of our boolean config items
			for _, boolKey := range booleanKeys {
				if key == boolKey {
					// Get the current boolean value from stringValue field
					strVal, hasStr := cfg["stringValue"].(string)
					if hasStr && (strVal == "true" || strVal == "false") {
						// Replace with clean config item using stringValue
						configItems[i] = map[string]interface{}{
							"key":         key,
							"stringValue": strVal,
						}
					}
					break
				}
			}
		}
	}
}

// SetVGAEnabled enables or disables VGA access on the device
func (c *Client) SetVGAEnabled(nodeID string, enabled bool) error {
	// 1. Get Device
	device, err := c.GetDevice(nodeID)
	if err != nil {
		return fmt.Errorf("failed to get device: %w", err)
	}

	// 2. Update Config Items
	configItems, ok := device["configItem"].([]interface{})
	if !ok {
		configItems = []interface{}{}
	}

	keyFound := false
	for i, item := range configItems {
		if cfg, ok := item.(map[string]interface{}); ok {
			if cfg["key"] == "debug.enable.vga" {
				// Replace with a clean config item using stringValue for booleans
				var strVal string
				if enabled {
					strVal = "true"
				} else {
					strVal = "false"
				}
				configItems[i] = map[string]interface{}{
					"key":         "debug.enable.vga",
					"stringValue": strVal,
				}
				keyFound = true
				break
			}
		}
	}

	if !keyFound {
		var strVal string
		if enabled {
			strVal = "true"
		} else {
			strVal = "false"
		}
		configItems = append(configItems, map[string]interface{}{
			"key":         "debug.enable.vga",
			"stringValue": strVal,
		})
	}

	device["configItem"] = configItems

	// Clean all boolean config items before sending to API
	cleanBooleanConfigItems(configItems)

	// 3. Update Device
	if err := c.UpdateDevice(nodeID, device); err != nil {
		return fmt.Errorf("failed to update device config: %w", err)
	}

	return nil
}

// SetUSBEnabled enables or disables USB access on the device
func (c *Client) SetUSBEnabled(nodeID string, enabled bool) error {
	// 1. Get Device
	device, err := c.GetDevice(nodeID)
	if err != nil {
		return fmt.Errorf("failed to get device: %w", err)
	}

	// 2. Update Config Items
	configItems, ok := device["configItem"].([]interface{})
	if !ok {
		configItems = []interface{}{}
	}

	keyFound := false
	for i, item := range configItems {
		if cfg, ok := item.(map[string]interface{}); ok {
			if cfg["key"] == "debug.enable.usb" {
				// Replace with a clean config item using stringValue for booleans
				var strVal string
				if enabled {
					strVal = "true"
				} else {
					strVal = "false"
				}
				configItems[i] = map[string]interface{}{
					"key":         "debug.enable.usb",
					"stringValue": strVal,
				}
				keyFound = true
				break
			}
		}
	}

	if !keyFound {
		var strVal string
		if enabled {
			strVal = "true"
		} else {
			strVal = "false"
		}
		configItems = append(configItems, map[string]interface{}{
			"key":         "debug.enable.usb",
			"stringValue": strVal,
		})
	}

	device["configItem"] = configItems

	// Clean all boolean config items before sending to API
	cleanBooleanConfigItems(configItems)

	// 3. Update Device
	if err := c.UpdateDevice(nodeID, device); err != nil {
		return fmt.Errorf("failed to update device config: %w", err)
	}

	return nil
}

// SetConsoleEnabled enables or disables Console access on the device
func (c *Client) SetConsoleEnabled(nodeID string, enabled bool) error {
	// 1. Get Device
	device, err := c.GetDevice(nodeID)
	if err != nil {
		return fmt.Errorf("failed to get device: %w", err)
	}

	// 2. Update Config Items
	configItems, ok := device["configItem"].([]interface{})
	if !ok {
		configItems = []interface{}{}
	}

	keyFound := false
	for i, item := range configItems {
		if cfg, ok := item.(map[string]interface{}); ok {
			if cfg["key"] == "debug.enable.console" {
				// Replace with a clean config item using stringValue for booleans
				var strVal string
				if enabled {
					strVal = "true"
				} else {
					strVal = "false"
				}
				configItems[i] = map[string]interface{}{
					"key":         "debug.enable.console",
					"stringValue": strVal,
				}
				keyFound = true
				break
			}
		}
	}

	if !keyFound {
		configItems = append(configItems, map[string]interface{}{
			"key":       "debug.enable.console",
			"boolValue": enabled,
		})
	}

	device["configItem"] = configItems

	// Clean all boolean config items before sending to API
	cleanBooleanConfigItems(configItems)

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
	SSHKey         string
	MaxSessions    int
	Expiry         string
	DebugKnob      bool
	VGAEnabled     bool
	USBEnabled     bool
	ConsoleEnabled bool
	Token          string // Active EdgeView JWT token
	DispURL        string // Dispatcher URL
	IsEncrypted    bool   // Encryption enabled in JWT info
	ExternalPolicy bool   // New field
}

// GetEdgeViewStatus returns the current EdgeView status of the node
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

	// 2. Get EdgeView Config (Max Sessions, Expiry, Token, DispUrl)
	if evConfig, ok := device["edgeviewconfig"].(map[string]interface{}); ok {
		if token, ok := evConfig["token"].(string); ok {
			status.Token = token
		}
		if dispUrl, ok := evConfig["dispUrl"].(string); ok {
			status.DispURL = dispUrl
		}

		if jwtInfo, ok := evConfig["jwtInfo"].(map[string]interface{}); ok {
			// Debug: Log jwtInfo to verify "enc" field presence and type
			// fmt.Printf("DEBUG: jwtInfo map: %+v\n", jwtInfo)

			if num, ok := jwtInfo["numInst"].(float64); ok {
				status.MaxSessions = int(num)
			}
			if exp, ok := jwtInfo["expireSec"].(string); ok {
				status.Expiry = exp
			}
			if enc, ok := jwtInfo["encrypt"].(bool); ok {
				status.IsEncrypted = enc
			}
			// Fallback: DispURL might be in jwtInfo too
			if status.DispURL == "" {
				if dispUrl, ok := jwtInfo["dispUrl"].(string); ok {
					status.DispURL = dispUrl
				}
			}
		}
	}

	// 2a. Check External Policy (extPolicy)
	if evConfig, ok := device["edgeviewconfig"].(map[string]interface{}); ok {
		if extPolicy, ok := evConfig["extPolicy"].(map[string]interface{}); ok {
			if allowExt, ok := extPolicy["allowExt"].(bool); ok {
				status.ExternalPolicy = allowExt
			}
		}
	}

	// 3. Check Debug Knob
	if knob, ok := device["debugKnob"].(bool); ok {
		status.DebugKnob = knob
	}

	// 4. Get VGA, USB, and Console status from ConfigItems
	if configItems, ok := device["configItem"].([]interface{}); ok {
		for _, item := range configItems {
			if cfg, ok := item.(map[string]interface{}); ok {
				if cfg["key"] == "debug.enable.vga" {
					// Controller uses stringValue for boolean config items
					if val, ok := cfg["stringValue"].(string); ok {
						status.VGAEnabled = (val == "true")
					}
				} else if cfg["key"] == "debug.enable.usb" {
					if val, ok := cfg["stringValue"].(string); ok {
						status.USBEnabled = (val == "true")
					}
				} else if cfg["key"] == "debug.enable.console" {
					if val, ok := cfg["stringValue"].(string); ok {
						status.ConsoleEnabled = (val == "true")
					}
				}
			}
		}
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

// TokenInfo contains information about a session token
type TokenInfo struct {
	Valid     bool                   `json:"valid"`
	ExpiresAt time.Time              `json:"expiresAt"`
	Subject   string                 `json:"subject"` // Usually the user email or ID
	UserID    string                 `json:"userId,omitempty"`
	Username  string                 `json:"username,omitempty"`
	Email     string                 `json:"email,omitempty"`
	Role      string                 `json:"role,omitempty"`
	CreatedAt time.Time              `json:"createdAt,omitempty"`
	LastLogin time.Time              `json:"lastLogin,omitempty"`
	Error     string                 `json:"error,omitempty"`
	RawData   map[string]interface{} `json:"rawData,omitempty"` // Store full response for debugging
}

// GetRoleName fetches the role name from the API given a roleId
func (c *Client) GetRoleName(roleId string) (string, error) {
	if roleId == "" {
		return "", fmt.Errorf("roleId is empty")
	}

	url := fmt.Sprintf("%s/api/v1/roles/id/%s", c.BaseURL, roleId)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("API returned status %d", resp.StatusCode)
	}

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	// Extract role name
	if name, ok := result["name"].(string); ok {
		return name, nil
	}

	return "", fmt.Errorf("role name not found in response")
}

// extractJWTExpiry tries to extract the expiry time from a JWT token
func extractJWTExpiry(token string) (time.Time, error) {
	// ZEDEDA API tokens are in format: enterpriseId:jwtToken
	// Extract the JWT part
	if idx := strings.Index(token, ":"); idx > 0 && idx < len(token)-1 {
		token = token[idx+1:]
	}

	// JWT format: header.payload.signature
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return time.Time{}, fmt.Errorf("invalid JWT format: expected 3 parts, got %d", len(parts))
	}

	// Decode the payload (second part)
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		// Try with standard base64
		payload, err = base64.RawStdEncoding.DecodeString(parts[1])
		if err != nil {
			return time.Time{}, fmt.Errorf("failed to decode JWT payload: %w", err)
		}
	}

	// Parse the JSON payload
	var claims map[string]interface{}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return time.Time{}, fmt.Errorf("failed to parse JWT claims: %w", err)
	}

	// Get the exp claim (Unix timestamp)
	if exp, ok := claims["exp"].(float64); ok {
		return time.Unix(int64(exp), 0), nil
	}

	return time.Time{}, fmt.Errorf("no exp claim found in JWT")
}

// VerifyToken checks if a session token is valid by calling the IAM API
func (c *Client) VerifyToken(token string) (*TokenInfo, error) {
	// First, try to extract expiry from the JWT token itself
	var jwtExpiry time.Time
	if exp, err := extractJWTExpiry(token); err == nil {
		jwtExpiry = exp
	}

	// Use the /api/v1/users/self endpoint to get current user info
	url := fmt.Sprintf("%s/api/v1/users/self", c.BaseURL)

	// Debug: Print curl command for manual testing
	// fmt.Printf("DEBUG: VerifyToken curl command:\ncurl -X GET '%s' -H 'Authorization: Bearer %s'\n", url, token)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)

	// fmt.Printf("DEBUG: API Request: [%s] %s\n", req.Method, req.URL.String())
	// fmt.Printf("DEBUG: API Auth (partial): %s...\n", token[:min(len(token), 10)])

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		// fmt.Printf("DEBUG: VerifyToken HTTP error: %v\n", err)
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return &TokenInfo{Valid: false, Error: fmt.Sprintf("API returned status %d", resp.StatusCode)}, nil
	}

	// Response structure from ZEDEDA IAM API - using generic map to capture all fields
	var result map[string]interface{}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// Extract known fields with type assertions
	var expiresAt, createdAt, lastLogin time.Time

	// Try to get expiresAt from API response
	if expiryStr, ok := result["expiresAt"].(string); ok && expiryStr != "" {
		if t, err := time.Parse(time.RFC3339, expiryStr); err == nil {
			expiresAt = t
		}
	}
	// If API didn't provide expiresAt, use the JWT expiry we extracted earlier
	if expiresAt.IsZero() && !jwtExpiry.IsZero() {
		expiresAt = jwtExpiry
	}

	if createdStr, ok := result["createdAt"].(string); ok && createdStr != "" {
		if t, err := time.Parse(time.RFC3339, createdStr); err == nil {
			createdAt = t
		}
	}

	// API uses LastLoginTime, not lastLogin
	if lastLoginStr, ok := result["LastLoginTime"].(string); ok && lastLoginStr != "" {
		if t, err := time.Parse(time.RFC3339, lastLoginStr); err == nil {
			lastLogin = t
		}
	}

	// Use subject, or fallback to email or username
	subject, _ := result["subject"].(string)
	if subject == "" {
		subject, _ = result["email"].(string)
	}
	if subject == "" {
		subject, _ = result["username"].(string)
	}

	userID, _ := result["userId"].(string)
	if userID == "" {
		userID, _ = result["id"].(string)
	}

	email, _ := result["email"].(string)
	username, _ := result["username"].(string)

	// Try to get role name from allowedEnterprises array
	role := ""
	if allowedEnterprises, ok := result["allowedEnterprises"].([]interface{}); ok && len(allowedEnterprises) > 0 {
		if firstEnt, ok := allowedEnterprises[0].(map[string]interface{}); ok {
			if roleId, ok := firstEnt["roleId"].(string); ok && roleId != "" {
				// Try to fetch the role name from the API
				if roleName, err := c.GetRoleName(roleId); err == nil {
					role = roleName
				} else {
					// If we can't fetch the role name, use the roleId
					role = roleId
				}
			}
		}
	}
	// Fallback to direct role field if it exists
	if role == "" {
		role, _ = result["role"].(string)
	}

	return &TokenInfo{
		Valid:     true,
		ExpiresAt: expiresAt,
		Subject:   subject,
		UserID:    userID,
		Username:  username,
		Email:     email,
		Role:      role,
		CreatedAt: createdAt,
		LastLogin: lastLogin,
		RawData:   result, // Store full response for future use
	}, nil
}
