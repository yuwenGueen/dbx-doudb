package main

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestSelectionFeedbackUsesCurrentRulesWithoutMutation(t *testing.T) {
	for _, n := range []int{3, 4} {
		v := View{Room: RoomInfo{Capacity: n}, Phase: "playing", Seat: 0, Current: 0, RoundID: "round", Version: 5, Players: make([]PlayerView, n), Hand: cards(3, 3, 3, 5, 5)}
		before, _ := json.Marshal(v)
		got := assessSelection(&v, []int{0, 1, 2, 3})
		if got.Valid != (n == 3) {
			t.Fatalf("triple single: %d players %+v", n, got)
		}
		got = assessSelection(&v, []int{0, 1, 2, 3, 4})
		if !got.Valid || got.Label != "三带二" {
			t.Fatalf("triple pair: %+v", got)
		}
		for _, ids := range [][]int{{0, 0}, {9999}, {0, 3}, {}} {
			if assessSelection(&v, ids).Valid {
				t.Fatalf("accepted invalid selection %v", ids)
			}
		}
		after, _ := json.Marshal(v)
		if string(before) != string(after) {
			t.Fatal("validation mutated the public game state")
		}
		target := Pattern{Kind: "triple-pair", Rank: 14, Size: 5, Chain: 1}
		v.Target = &target
		if assessSelection(&v, []int{0, 1, 2, 3, 4}).Valid {
			t.Fatal("accepted weaker cards")
		}
		v.Target = nil
		v.Current = 1
		if got = assessSelection(&v, []int{0}); got.Valid || got.Label != "单张" {
			t.Fatal("preselection should identify cards without allowing a turn")
		}
		v.Current = 0
		v.Players[0].Auto = true
		if assessSelection(&v, []int{0}).Valid {
			t.Fatal("autoplay must be cancelled first")
		}
	}
}
func TestPublicEffectsAreOrderedAndDoNotLeakCards(t *testing.T) {
	g := newGame(4)
	g.start()
	g.MaxBid = 3
	g.landlord(0)
	g.Players[0].Hand = cards(3, 3, 3, 3)
	g.Players[1].Hand = cards(4)
	if err := g.act(0, Action{Type: "play", Cards: []int{0, 1, 2, 3}}); err != nil {
		t.Fatal(err)
	}
	kinds := []string{}
	last := 0
	for _, event := range g.Events {
		kinds = append(kinds, event.Kind)
		if event.ID <= last || event.RoundID != g.RoundID {
			t.Fatal("events must be ordered within a round")
		}
		last = event.ID
		encoded, _ := json.Marshal(event)
		var raw map[string]any
		json.Unmarshal(encoded, &raw)
		if len(raw) != 5 {
			t.Fatal("event payload must contain only public metadata")
		}
	}
	if !reflect.DeepEqual(kinds, []string{"deal", "landlord", "bomb", "spring", "finished"}) {
		t.Fatalf("unexpected effect sequence %v", kinds)
	}
	for i := 0; i < 40; i++ {
		g.emit("single", 0, "单张")
	}
	if len(g.Events) != 16 {
		t.Fatal("event history must be bounded")
	}
}
func TestAppearanceCatalogCanGrowWithoutBackendChanges(t *testing.T) {
	dir := t.TempDir()
	s, err := newService(dir)
	if err != nil {
		t.Fatal(err)
	}
	sound := true
	if _, err = s.handle("profile/update", Params{Theme: "future-theme-42", Skin: "future-card-42", Sound: &sound}); err != nil {
		t.Fatal(err)
	}
	reloaded, err := newService(dir)
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.profile.Theme != "future-theme-42" || reloaded.profile.Skin != "future-card-42" || !reloaded.profile.Sound {
		t.Fatal("new skin and sound preferences did not survive reload")
	}
	for _, id := range []string{"../skin", "https://remote", "Bad", "a/b", "a b"} {
		if _, err = s.handle("profile/update", Params{Theme: id}); err == nil {
			t.Fatalf("unsafe identifier accepted: %q", id)
		}
	}
	result, err := s.handle("game/state", Params{})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	var data map[string]any
	json.Unmarshal(raw, &data)
	if value, ok := data["view"]; !ok || value != nil {
		t.Fatal("missing game must explicitly clear stale UI")
	}
}

func TestMusicSettingsPersistIndependentlyAndRejectInvalidVolume(t *testing.T) {
	dir := t.TempDir()
	s, err := newService(dir)
	if err != nil {
		t.Fatal(err)
	}
	if s.profile.Music || s.profile.MusicVolume != 28 {
		t.Fatal("music must start muted at a moderate volume")
	}
	music, volume := true, 35
	if _, err = s.handle("profile/update", Params{Music: &music, MusicVolume: &volume}); err != nil {
		t.Fatal(err)
	}
	r, err := newService(dir)
	if err != nil {
		t.Fatal(err)
	}
	if !r.profile.Music || r.profile.Sound || r.profile.MusicVolume != 35 {
		t.Fatal("music settings must persist independently of effects")
	}
	for _, invalid := range []int{-1, 101} {
		before := r.profile
		disabled := false
		if _, err = r.handle("profile/update", Params{Music: &disabled, MusicVolume: &invalid}); err == nil {
			t.Fatal("invalid music volume accepted")
		}
		if !reflect.DeepEqual(before, r.profile) {
			t.Fatal("rejected update changed profile")
		}
	}
	zero := 0
	if _, err = r.handle("profile/update", Params{MusicVolume: &zero}); err != nil {
		t.Fatal(err)
	}
	again, err := newService(dir)
	if err != nil {
		t.Fatal(err)
	}
	if again.profile.MusicVolume != 0 {
		t.Fatal("intentional zero volume must survive reload")
	}
}
