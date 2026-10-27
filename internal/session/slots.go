package session

import (
	"context"
	"sort"
	"sync"

	"edgeViewLauncher/internal/zededa"
)

// SlotInfo is the dispatcher's view of one EdgeView instance slot.
type SlotInfo struct {
	Inst  int       `json:"inst"`
	State SlotState `json:"state"`
	// Ours marks a busy slot held by one of this launcher's own tunnels.
	// Tunnels don't record which instance slot they won (the winning InstID
	// is applied to a per-attempt copy of the config), so it is always false
	// for now.
	Ours bool `json:"ours"`
}

// SlotSummary counts a device's EdgeView instance slots by state.
type SlotSummary struct {
	// MaxSessions is the number of slots the device allows (at least 1).
	MaxSessions int `json:"maxSessions"`
	// InUse is the number of busy slots.
	InUse   int        `json:"inUse"`
	Free    int        `json:"free"`
	Offline int        `json:"offline"`
	Unknown int        `json:"unknown"`
	Slots   []SlotInfo `json:"slots"`
}

// slotIDs lists the instance IDs of a session: 1..MaxInst in multi-instance
// mode, a single slot 0 otherwise (see initialInstIDFor).
func slotIDs(config *zededa.SessionConfig) []int {
	if config.MaxInst <= 1 {
		return []int{0}
	}
	ids := make([]int, config.MaxInst)
	for i := range ids {
		ids[i] = i + 1
	}
	return ids
}

// ProbeSlots asks the dispatcher about every instance slot of a session
// concurrently, without connecting, and summarizes the result. It is
// read-only (beyond remembering the discovered token-hash form) and bounded
// by ctx: slots whose probe doesn't finish in time come back as unknown.
func (m *Manager) ProbeSlots(ctx context.Context, config *zededa.SessionConfig) *SlotSummary {
	ids := slotIDs(config)
	slots := make([]SlotInfo, len(ids))

	var wg sync.WaitGroup
	for i, id := range ids {
		wg.Add(1)
		go func(i, id int) {
			defer wg.Done()
			state, _ := m.probeSlotAuto(ctx, config, id)
			slots[i] = SlotInfo{Inst: id, State: state}
		}(i, id)
	}
	wg.Wait()

	sort.Slice(slots, func(i, j int) bool { return slots[i].Inst < slots[j].Inst })
	sum := &SlotSummary{MaxSessions: len(ids), Slots: slots}
	for _, s := range slots {
		switch s.State {
		case SlotBusy:
			sum.InUse++
		case SlotFree:
			sum.Free++
		case SlotOffline:
			sum.Offline++
		default:
			sum.Unknown++
		}
	}
	return sum
}
