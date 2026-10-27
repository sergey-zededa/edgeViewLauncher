package session

import (
	"context"
	"testing"
)

func slotStates(sum *SlotSummary) map[int]SlotState {
	out := map[int]SlotState{}
	for _, s := range sum.Slots {
		out[s.Inst] = s.State
	}
	return out
}

func TestProbeSlotsMixedStatesFullHash(t *testing.T) {
	token := "header.payload.signature"
	d, cfg := newFakeDispatcher(t, map[string]string{
		tokenHash(token, 1, true): probeBusyMsg,
		tokenHash(token, 2, true): serverConnectedReply,
		// slot 3: not registered -> offline
	})
	cfg.MaxInst = 3
	m := NewManager()

	sum := m.ProbeSlots(context.Background(), cfg)
	if sum.MaxSessions != 3 || sum.InUse != 1 || sum.Free != 1 || sum.Offline != 1 || sum.Unknown != 0 {
		t.Fatalf("unexpected summary: %+v", sum)
	}
	want := []SlotInfo{{1, SlotBusy, false}, {2, SlotFree, false}, {3, SlotOffline, false}}
	if len(sum.Slots) != len(want) {
		t.Fatalf("slots = %+v", sum.Slots)
	}
	for i, w := range want {
		if sum.Slots[i] != w {
			t.Errorf("slot[%d] = %+v, want %+v", i, sum.Slots[i], w)
		}
	}
	if d.probeCount() == 0 {
		t.Fatal("expected probes")
	}
}

func TestProbeSlotsSingleInstanceUsesSlotZero(t *testing.T) {
	token := "header.payload.signature"
	_, cfg := newFakeDispatcher(t, map[string]string{
		tokenHash(token, 0, true): serverConnectedReply,
	})
	cfg.MaxInst = 1
	m := NewManager()

	sum := m.ProbeSlots(context.Background(), cfg)
	if sum.MaxSessions != 1 || sum.Free != 1 || sum.InUse != 0 {
		t.Fatalf("unexpected summary: %+v", sum)
	}
	if len(sum.Slots) != 1 || sum.Slots[0].Inst != 0 || sum.Slots[0].State != SlotFree {
		t.Fatalf("slots = %+v", sum.Slots)
	}

	// MaxInst unset behaves like a single instance too.
	cfg.MaxInst = 0
	if sum := NewManager().ProbeSlots(context.Background(), cfg); len(sum.Slots) != 1 || sum.Slots[0].Inst != 0 {
		t.Fatalf("MaxInst 0: slots = %+v", sum.Slots)
	}
}

func TestProbeSlotsShortHashDevice(t *testing.T) {
	token := "header.payload.signature"
	_, cfg := newFakeDispatcher(t, map[string]string{
		tokenHash(token, 1, false): probeBusyMsg,
		tokenHash(token, 2, false): serverConnectedReply,
	})
	cfg.MaxInst = 2
	m := NewManager()

	sum := m.ProbeSlots(context.Background(), cfg)
	st := slotStates(sum)
	if st[1] != SlotBusy || st[2] != SlotFree || sum.InUse != 1 || sum.Free != 1 {
		t.Fatalf("unexpected summary: %+v", sum)
	}
	if full, ok := m.hashForms.get(token); !ok || full {
		t.Fatalf("expected short form cached, got full=%v ok=%v", full, ok)
	}
}

func TestProbeSlotsWithoutProbeSupportIsAllUnknown(t *testing.T) {
	d, cfg := newFakeDispatcher(t, nil)
	d.noProbes = true
	cfg.MaxInst = 3
	m := NewManager()

	sum := m.ProbeSlots(context.Background(), cfg)
	if sum.Unknown != 3 || sum.InUse != 0 || sum.Free != 0 || sum.Offline != 0 {
		t.Fatalf("unexpected summary: %+v", sum)
	}
	for _, s := range sum.Slots {
		if s.State != SlotUnknown {
			t.Errorf("slot %d = %s, want unknown", s.Inst, s.State)
		}
	}
	if _, ok := m.hashForms.get(cfg.Token); ok {
		t.Fatal("unknown slots must not cache a hash form")
	}
}

func TestProbeSlotsCachesDiscoveredForm(t *testing.T) {
	token := "header.payload.signature"
	d, cfg := newFakeDispatcher(t, map[string]string{
		tokenHash(token, 2, true): serverConnectedReply,
	})
	cfg.MaxInst = 2
	m := NewManager()

	m.ProbeSlots(context.Background(), cfg)
	if full, ok := m.hashForms.get(token); !ok || !full {
		t.Fatalf("expected full form cached, got full=%v ok=%v", full, ok)
	}

	// A later dial reuses the discovered form without probing.
	before := d.probeCount()
	if got := m.sessionTokenHash(context.Background(), cfg, 1); got != tokenHash(token, 1, true) {
		t.Fatalf("sessionTokenHash = %q, want full hash", got)
	}
	if d.probeCount() != before {
		t.Fatal("expected cached form to be reused without probing")
	}
}

func TestProbeSlotsHonoursContext(t *testing.T) {
	_, cfg := newFakeDispatcher(t, nil)
	cfg.MaxInst = 2
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	sum := NewManager().ProbeSlots(ctx, cfg)
	if sum.Unknown != 2 {
		t.Fatalf("cancelled context: %+v", sum)
	}
}
