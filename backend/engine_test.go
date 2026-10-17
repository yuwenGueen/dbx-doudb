package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"testing"

	sdk "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
)

func cards(ranks ...int) []Card {
	out := []Card{}
	for i, r := range ranks {
		out = append(out, Card{ID: i, Rank: r, Suit: i % 4})
	}
	return out
}
func TestDealAndPrivateViews(t *testing.T) {
	for _, n := range []int{3, 4} {
		for iteration := 0; iteration < 15; iteration++ {
			g := newGame(n)
			g.start()
			expected, bottom := 17, 3
			if n == 4 {
				expected, bottom = 25, 8
			}
			seen := map[int]bool{}
			for _, p := range g.Players {
				if len(p.Hand) != expected {
					t.Fatalf("%d players: hand has %d", n, len(p.Hand))
				}
				for _, c := range p.Hand {
					if seen[c.ID] {
						t.Fatal("duplicate physical card")
					}
					seen[c.ID] = true
				}
			}
			if len(g.Bottom) != bottom {
				t.Fatal("incorrect bottom size")
			}
			for _, c := range g.Bottom {
				if seen[c.ID] {
					t.Fatal("duplicate bottom card")
				}
				seen[c.ID] = true
			}
			if len(seen) != expected*n+bottom {
				t.Fatal("missing cards")
			}
			g.MaxBid = 1
			g.landlord(0)
			if len(g.Players[0].Hand) != expected+bottom {
				t.Fatal("landlord did not receive bottom")
			}
		}
	}
	profile := Profile{ID: newID(), Name: "test"}
	r, token, e := newRoom(3, "test", profile, false)
	if e != nil {
		t.Fatal(e)
	}
	defer r.close()
	if _, e = r.action(token, Action{Type: "start", RequestID: newID()}); e != nil {
		t.Fatal(e)
	}
	v, e := r.get(token)
	if e != nil {
		t.Fatal(e)
	}
	if len(v.Bottom) != 0 || len(v.Hand) != 17 {
		t.Fatal("bottom must remain hidden while bidding")
	}
	encoded, _ := json.Marshal(v)
	var raw map[string]json.RawMessage
	json.Unmarshal(encoded, &raw)
	var opponents []map[string]json.RawMessage
	json.Unmarshal(raw["players"], &opponents)
	for _, p := range opponents {
		if _, ok := p["hand"]; ok {
			t.Fatal("private opponent cards leaked")
		}
		if _, ok := p["token"]; ok {
			t.Fatal("seat token leaked")
		}
	}
}
func TestRuleDifferences(t *testing.T) {
	tests := []struct {
		name        string
		ranks       []int
		three, four bool
	}{
		{"triple single", []int{3, 3, 3, 5}, true, false}, {"triple pair", []int{3, 3, 3, 5, 5}, true, true}, {"plane singles", []int{3, 3, 3, 4, 4, 4, 5, 6}, true, false}, {"plane pairs", []int{3, 3, 3, 4, 4, 4, 5, 5, 6, 6}, true, true}, {"four singles", []int{3, 3, 3, 3, 5, 6}, true, false}, {"four pairs", []int{3, 3, 3, 3, 5, 5, 6, 6}, true, false}, {"straight", []int{3, 4, 5, 6, 7}, true, true}, {"two excluded", []int{11, 12, 13, 14, 15}, false, false}, {"pairs", []int{3, 3, 4, 4, 5, 5}, true, true}, {"short pairs", []int{3, 3, 4, 4}, false, false}, {"mixed jokers", []int{16, 17}, true, false}, {"four jokers", []int{16, 16, 17, 17}, false, true}, {"invalid", []int{3, 5, 7}, false, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			for _, n := range []int{3, 4} {
				_, e := resolve(cards(test.ranks...), n, nil)
				want := test.three
				if n == 4 {
					want = test.four
				}
				if (e == nil) != want {
					t.Fatalf("players=%d cards=%v error=%v", n, test.ranks, e)
				}
			}
		})
	}
	bomb, _ := resolve(cards(15, 15, 15, 15), 4, nil)
	larger, _ := resolve(cards(3, 3, 3, 3, 3), 4, nil)
	if !beats(larger, &bomb) || beats(bomb, &larger) {
		t.Fatal("longer four-player bomb must win")
	}
	rocket, _ := resolve(cards(16, 16, 17, 17), 4, nil)
	if !beats(rocket, &larger) || beats(larger, &rocket) {
		t.Fatal("four jokers must beat any bomb")
	}
}
func TestInvalidActionsAndTurnReset(t *testing.T) {
	g := newGame(4)
	g.start()
	if e := g.act(1, Action{Type: "bid", Bid: 3}); e == nil {
		t.Fatal("out of turn bid accepted")
	}
	g.MaxBid = 1
	g.landlord(0)
	c := g.Players[0].Hand[0]
	if e := g.act(0, Action{Type: "play", Cards: []int{c.ID, c.ID}}); e == nil {
		t.Fatal("duplicate card accepted")
	}
	if e := g.act(0, Action{Type: "play", Cards: []int{999}}); e == nil {
		t.Fatal("unowned card accepted")
	}
	if e := g.act(0, Action{Type: "pass"}); e == nil {
		t.Fatal("leading pass accepted")
	}
	if e := g.act(0, Action{Type: "play", Cards: []int{c.ID}}); e != nil {
		t.Fatal(e)
	}
	for i := 1; i < 4; i++ {
		if e := g.act(i, Action{Type: "pass"}); e != nil {
			t.Fatal(e)
		}
	}
	if g.Target != nil || g.Current != 0 {
		t.Fatal("turn did not reset after all opponents passed")
	}
}
func TestAICompletesBothModes(t *testing.T) {
	for _, n := range []int{3, 4} {
		for round := 0; round < 80; round++ {
			g := newGame(n)
			for i := range g.Players {
				g.Players[i].Name = fmt.Sprint(i)
			}
			g.start()
			steps := 0
			for g.Phase != "finished" && steps < 1500 {
				a := g.aiAction()
				if e := g.act(g.Current, a); e != nil {
					t.Fatalf("players=%d round=%d phase=%s action=%+v error=%v", n, round, g.Phase, a, e)
				}
				steps++
			}
			if g.Phase != "finished" {
				t.Fatal("AI did not finish")
			}
			sum := 0
			for _, d := range g.Deltas {
				sum += d
			}
			if sum != 0 {
				t.Fatalf("settlement not zero sum: %v", g.Deltas)
			}
			if len(g.Players[g.Winner].Hand) != 0 {
				t.Fatal("winner still has cards")
			}
		}
	}
}
func TestSettlementPersistsOnce(t *testing.T) {
	dir := t.TempDir()
	s, e := newService(dir)
	if e != nil {
		t.Fatal(e)
	}
	v := View{Phase: "finished", RoundID: newID(), Seat: 0, Deltas: []int{40, -20, -20}}
	if e = s.settle(&v); e != nil {
		t.Fatal(e)
	}
	if e = s.settle(&v); e != nil {
		t.Fatal(e)
	}
	if s.profile.Beans != 1040 {
		t.Fatal("duplicate settlement")
	}
	s2, e := newService(dir)
	if e != nil {
		t.Fatal(e)
	}
	if e = s2.settle(&v); e != nil {
		t.Fatal(e)
	}
	if s2.profile.Beans != 1040 {
		t.Fatal("duplicate settlement after restart")
	}
}
func TestIdempotentCommands(t *testing.T) {
	r, token, e := newRoom(3, "test", Profile{ID: newID(), Name: "test"}, false)
	if e != nil {
		t.Fatal(e)
	}
	defer r.close()
	a := Action{Type: "start", RequestID: "same-start"}
	v, e := r.action(token, a)
	if e != nil {
		t.Fatal(e)
	}
	v2, e := r.action(token, a)
	if e != nil {
		t.Fatal(e)
	}
	if v.RoundID != v2.RoundID || v2.RoundNumber != 1 {
		t.Fatal("duplicate start replayed")
	}
}
func TestThemeDoesNotChangeGame(t *testing.T) {
	s, e := newService(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.leave()
	result, e := s.handle("game/local", Params{Capacity: 4})
	if e != nil {
		t.Fatal(e)
	}
	before := result.View
	_, e = s.handle("profile/update", Params{Theme: "classic", Skin: "classic"})
	if e != nil {
		t.Fatal(e)
	}
	after, e := s.room.get(s.token)
	if e != nil {
		t.Fatal(e)
	}
	if after.RoundID != before.RoundID || len(after.Hand) != 25 || after.Current != before.Current {
		t.Fatal("theme changed active game")
	}
	if s.profile.Theme != "classic" {
		t.Fatal("theme not saved")
	}
}
func TestSDKHandshake(t *testing.T) {
	s, e := newService(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	var output bytes.Buffer
	input := bytes.NewBufferString("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"plugin/initialize\",\"params\":{\"host\":{\"protocolVersions\":[1]}}}\n{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"profile/get\",\"params\":{}}\n")
	server := sdk.NewServer(sdk.Metadata{ID: "dev.doudb.suite", Version: "0.1.1"}, s).WithIO(input, &output, &bytes.Buffer{})
	if e = server.Serve(); e != nil {
		t.Fatal(e)
	}
	scanner := json.NewDecoder(&output)
	found := false
	for scanner.More() {
		var reply map[string]any
		if e = scanner.Decode(&reply); e != nil {
			break
		}
		if reply["error"] != nil {
			t.Fatalf("SDK response error: %v", reply)
		}
		if reply["id"] == float64(1) {
			raw, _ := json.Marshal(reply)
			if !bytes.Contains(raw, []byte("dev.doudb.suite")) {
				t.Fatal("identity mismatch")
			}
			found = true
		}
	}
	if !found {
		t.Fatal("missing initialize response")
	}
}
