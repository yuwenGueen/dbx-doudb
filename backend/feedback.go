package main

// Events contain only public actions. A bounded sequence lets slower clients
// show important effects once even when several turns occur between polls.
type GameEvent struct {
	ID      int    `json:"id"`
	RoundID string `json:"roundId"`
	Kind    string `json:"kind"`
	Seat    int    `json:"seat"`
	Label   string `json:"label"`
}

func (g *Game) emit(kind string, seat int, label string) {
	g.EventSerial++
	g.Events = append(g.Events, GameEvent{g.EventSerial, g.RoundID, kind, seat, label})
	if len(g.Events) > 16 {
		g.Events = append([]GameEvent{}, g.Events[len(g.Events)-16:]...)
	}
}

type Selection struct {
	Valid   bool   `json:"valid"`
	Label   string `json:"label"`
	Message string `json:"message"`
	RoundID string `json:"roundId"`
	Version int    `json:"version"`
}

// Use the same resolver as play; never change the turn, timer or hand here.
func assessSelection(v *View, ids []int) *Selection {
	out := &Selection{Message: "请先开局"}
	if v == nil {
		return out
	}
	out.RoundID = v.RoundID
	out.Version = v.Version
	if v.Phase != "playing" {
		out.Message = "叫地主结束后即可选牌出牌"
		return out
	}
	if len(ids) == 0 {
		out.Message = "点选或拖动选牌"
		return out
	}
	wanted := map[int]bool{}
	for _, id := range ids {
		if wanted[id] {
			out.Message = "不能重复选择同一张牌"
			return out
		}
		wanted[id] = true
	}
	selected := []Card{}
	for _, card := range v.Hand {
		if wanted[card.ID] {
			selected = append(selected, card)
		}
	}
	if len(selected) != len(ids) {
		out.Message = "手牌已变化，请重新选择"
		return out
	}
	possible := patterns(selected, v.Room.Capacity)
	if len(possible) > 0 {
		out.Label = possible[0].Label
	}
	if v.Current != v.Seat {
		out.Message = "已预选，等待轮到你"
		if len(possible) == 0 {
			out.Message = "这些牌不能组成有效牌型"
		}
		return out
	}
	pattern, err := resolve(selected, v.Room.Capacity, v.Target)
	if err != nil {
		out.Message = err.Error()
		return out
	}
	out.Label = pattern.Label
	if v.Players[v.Seat].Auto {
		out.Message = "托管中，取消托管后可出牌"
		return out
	}
	out.Valid = true
	out.Message = "可以出牌"
	return out
}

// The UI catalog owns available skins; storage accepts stable, path-free IDs.
func validAppearanceID(id string) bool {
	if len(id) < 1 || len(id) > 48 || id[0] < 'a' || id[0] > 'z' {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
			return false
		}
	}
	return true
}
