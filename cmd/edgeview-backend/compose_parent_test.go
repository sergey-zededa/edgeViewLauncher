package main

import "testing"

// Regression for compose apps being nested under the wrong app instance on the
// device-details page. The device runs a docker runtime plus an unrelated K3s VM;
// because IP-less apps used to inherit the runtime's IP, the K3s VM looked like it
// shared an IP with the compose app and — being listed first — won the parent slot.
func TestResolveComposeParents_IgnoresNonDockerRuntimeApps(t *testing.T) {
	apps := []composeAppInfo{
		// Listed first, and shares the runtime's IP, but is a K3s deployment.
		{ID: "k3s", AppType: "APP_TYPE_VM", DeploymentType: "DEPLOYMENT_TYPE_K3S", OwnIPs: []string{"10.5.255.254"}},
		{ID: "compose-app", AppType: appTypeDockerCompose},
		{ID: "runtime", AppType: "APP_TYPE_VM_RUNTIME", DeploymentType: deploymentTypeDockerRuntime, OwnIPs: []string{"10.5.255.254"}},
	}

	parents := resolveComposeParents(apps)

	if got := parents["compose-app"]; got != "runtime" {
		t.Fatalf("compose app parent = %q, want %q", got, "runtime")
	}
	if _, ok := parents["k3s"]; ok {
		t.Errorf("non-compose app should never be assigned a parent, got %q", parents["k3s"])
	}
	if _, ok := parents["runtime"]; ok {
		t.Errorf("runtime should never be assigned a parent, got %q", parents["runtime"])
	}
}

func TestResolveComposeParents_PrefersSharedNetworkInstance(t *testing.T) {
	// Both runtimes report the same IP, so only the network instance distinguishes
	// them. The compose app belongs to runtime-b.
	apps := []composeAppInfo{
		{ID: "runtime-a", DeploymentType: deploymentTypeDockerRuntime, OwnIPs: []string{"10.0.0.1"}, NetInstIDs: []string{"ni-a"}},
		{ID: "runtime-b", DeploymentType: deploymentTypeDockerRuntime, OwnIPs: []string{"10.0.0.1"}, NetInstIDs: []string{"ni-b"}},
		{ID: "compose-app", AppType: appTypeDockerCompose, NetInstIDs: []string{"ni-b"}},
	}

	if got := resolveComposeParents(apps)["compose-app"]; got != "runtime-b" {
		t.Fatalf("compose app parent = %q, want %q", got, "runtime-b")
	}
}

func TestResolveComposeParents_MatchesOnSelfReportedIP(t *testing.T) {
	apps := []composeAppInfo{
		{ID: "runtime-a", DeploymentType: deploymentTypeDockerRuntime, OwnIPs: []string{"10.0.0.1"}},
		{ID: "runtime-b", DeploymentType: deploymentTypeDockerRuntime, OwnIPs: []string{"10.0.0.2"}},
		{ID: "compose-app", AppType: appTypeDockerCompose, OwnIPs: []string{"10.0.0.2"}},
	}

	if got := resolveComposeParents(apps)["compose-app"]; got != "runtime-b" {
		t.Fatalf("compose app parent = %q, want %q", got, "runtime-b")
	}
}

func TestResolveComposeParents_SingleRuntimeNeedsNoEvidence(t *testing.T) {
	// The common case: the compose app reports nothing of its own, but only one
	// runtime on the device could possibly be hosting it.
	apps := []composeAppInfo{
		{ID: "runtime", DeploymentType: deploymentTypeDockerRuntime},
		{ID: "compose-app", AppType: appTypeDockerCompose},
	}

	if got := resolveComposeParents(apps)["compose-app"]; got != "runtime" {
		t.Fatalf("compose app parent = %q, want %q", got, "runtime")
	}
}

func TestResolveComposeParents_AmbiguousStaysUnresolved(t *testing.T) {
	// Two runtimes and no distinguishing evidence. Guessing would put the app
	// under the wrong instance, so it must stay unparented and render top-level.
	apps := []composeAppInfo{
		{ID: "runtime-a", DeploymentType: deploymentTypeDockerRuntime},
		{ID: "runtime-b", DeploymentType: deploymentTypeDockerRuntime},
		{ID: "compose-app", AppType: appTypeDockerCompose},
	}

	if got, ok := resolveComposeParents(apps)["compose-app"]; ok {
		t.Fatalf("ambiguous compose app should stay unresolved, got parent %q", got)
	}
}

func TestResolveComposeParents_NoRuntimeOnDevice(t *testing.T) {
	apps := []composeAppInfo{
		{ID: "vm", AppType: "APP_TYPE_VM", DeploymentType: "DEPLOYMENT_TYPE_STAND_ALONE", OwnIPs: []string{"10.0.0.1"}},
		{ID: "compose-app", AppType: appTypeDockerCompose, OwnIPs: []string{"10.0.0.1"}},
	}

	if got, ok := resolveComposeParents(apps)["compose-app"]; ok {
		t.Fatalf("compose app should stay unresolved without a runtime, got parent %q", got)
	}
}

func TestResolveComposeParents_MultipleComposeAppsShareRuntime(t *testing.T) {
	apps := []composeAppInfo{
		{ID: "runtime", DeploymentType: deploymentTypeDockerRuntime, OwnIPs: []string{"10.0.0.1"}},
		{ID: "compose-a", AppType: appTypeDockerCompose},
		{ID: "compose-b", AppType: appTypeDockerCompose},
	}

	parents := resolveComposeParents(apps)
	for _, id := range []string{"compose-a", "compose-b"} {
		if got := parents[id]; got != "runtime" {
			t.Errorf("%s parent = %q, want %q", id, got, "runtime")
		}
	}
}

func TestStringsOverlap(t *testing.T) {
	cases := []struct {
		name string
		a, b []string
		want bool
	}{
		{"shared value", []string{"x", "y"}, []string{"y"}, true},
		{"disjoint", []string{"x"}, []string{"y"}, false},
		{"empty a", nil, []string{"y"}, false},
		{"empty b", []string{"x"}, nil, false},
		// An empty string is the absence of a value, not a value two apps share.
		{"empty strings do not match", []string{""}, []string{""}, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := stringsOverlap(tc.a, tc.b); got != tc.want {
				t.Errorf("stringsOverlap(%v, %v) = %v, want %v", tc.a, tc.b, got, tc.want)
			}
		})
	}
}
