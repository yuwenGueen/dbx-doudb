package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"time"
)

type Card struct {
	ID   int `json:"id"`
	Rank int `json:"rank"`
	Suit int `json:"suit"`
}
type Pattern struct {
	Kind  string `json:"kind"`
	Rank  int    `json:"rank"`
	Size  int    `json:"size"`
	Chain int    `json:"chain"`
	Label string `json:"label"`
}
type Move struct {
	Cards   []Card
	Pattern Pattern
}

type Player struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Bot    bool   `json:"bot"`
	Auto   bool   `json:"auto"`
	Score  int    `json:"score"`
	Hand   []Card `json:"-"`
	Last   []Card `json:"last"`
	Passed bool   `json:"passed"`
	Bid    int    `json:"bid"`
	Plays  int    `json:"-"`
}
type Action struct {
	Type      string `json:"type"`
	Cards     []int  `json:"cards"`
	Bid       int    `json:"bid"`
	RequestID string `json:"requestId"`
}
type Game struct {
	Players     []Player
	Capacity    int
	Phase       string
	Version     int
	RoundID     string
	RoundNumber int
	Current     int
	Landlord    int
	Bottom      []Card
	Table       []Card
	Target      *Pattern
	Leader      int
	Passes      int
	MaxBid      int
	Bidder      int
	BidCount    int
	Redeals     int
	Dealer      int
	Bombs       int
	Spring      bool
	Winner      int
	Deltas      []int
	Message     string
	Deadline    time.Time
	LastAction  time.Time
	Events      []GameEvent
	EventSerial int
}

func newID() string {
	b := make([]byte, 16)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func randomN(n int) int {
	v, e := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if e != nil {
		panic(e)
	}
	return int(v.Int64())
}
func newDeck(players int) []Card {
	decks := 1
	if players == 4 {
		decks = 2
	}
	cards := make([]Card, 0, 54*decks)
	for d := 0; d < decks; d++ {
		for rank := 3; rank <= 15; rank++ {
			for suit := 0; suit < 4; suit++ {
				cards = append(cards, Card{len(cards), rank, suit})
			}
		}
		cards = append(cards, Card{len(cards), 16, 4}, Card{len(cards) + 1, 17, 4})
	}
	for i := len(cards) - 1; i > 0; i-- {
		j := randomN(i + 1)
		cards[i], cards[j] = cards[j], cards[i]
	}
	return cards
}
func sorted(cards []Card) []Card {
	out := append([]Card{}, cards...)
	sort.Slice(out, func(i, j int) bool {
		if out[i].Rank != out[j].Rank {
			return out[i].Rank > out[j].Rank
		}
		return out[i].ID < out[j].ID
	})
	return out
}
func groups(cards []Card) map[int][]Card {
	g := map[int][]Card{}
	for _, c := range cards {
		g[c.Rank] = append(g[c.Rank], c)
	}
	return g
}
func sequence(counts map[int][]Card, width int) (int, bool) {
	if len(counts) < 2 {
		return 0, false
	}
	lo, hi := 18, 0
	for r, c := range counts {
		if len(c) != width || r >= 15 {
			return 0, false
		}
		if r < lo {
			lo = r
		}
		if r > hi {
			hi = r
		}
	}
	return hi, hi-lo+1 == len(counts)
}
func patterns(cards []Card, players int) []Pattern {
	n := len(cards)
	if n == 0 {
		return nil
	}
	g := groups(cards)
	out := []Pattern{}
	add := func(kind string, rank, chain int, label string) {
		out = append(out, Pattern{kind, rank, n, chain, label})
	}
	if (players == 3 && n == 2 && len(g[16]) == 1 && len(g[17]) == 1) || (players == 4 && n == 4 && len(g[16]) == 2 && len(g[17]) == 2) {
		label := "王炸"
		if players == 4 {
			label = "四王天炸"
		}
		add("rocket", 17, 1, label)
		return out
	}
	if len(g) == 1 {
		for r := range g {
			switch n {
			case 1:
				add("single", r, 1, "单张")
			case 2:
				add("pair", r, 1, "对子")
			case 3:
				if r <= 15 {
					add("triple", r, 1, "三张")
				}
			default:
				if n >= 4 && r <= 15 {
					add("bomb", r, 1, fmt.Sprintf("%d 张炸弹", n))
				}
			}
		}
		return out
	}
	if n == 4 && players == 3 {
		for r, c := range g {
			if len(c) == 3 {
				add("triple-single", r, 1, "三带一")
			}
		}
	}
	if n == 5 {
		for r, c := range g {
			if len(c) == 3 && len(g) == 2 {
				add("triple-pair", r, 1, "三带二")
			}
		}
	}
	if n >= 5 {
		if hi, ok := sequence(g, 1); ok {
			add("straight", hi, n, "顺子")
		}
	}
	if n >= 6 && n%2 == 0 {
		if hi, ok := sequence(g, 2); ok {
			add("pairs", hi, n/2, "连对")
		}
	}
	if n >= 6 && n%3 == 0 {
		if hi, ok := sequence(g, 3); ok {
			add("triples", hi, n/3, "飞机")
		}
	}
	for m := 2; m <= n/3; m++ {
		single := players == 3 && n == m*4
		paired := n == m*5
		if !single && !paired {
			continue
		}
		for start := 3; start+m-1 <= 14; start++ {
			ok := true
			for r := start; r < start+m; r++ {
				if len(g[r]) != 3 {
					ok = false
					break
				}
			}
			if !ok {
				continue
			}
			rest := 0
			pairCount := 0
			for r, c := range g {
				if r >= start && r < start+m {
					continue
				}
				rest += len(c)
				if len(c) == 2 {
					pairCount++
				} else if paired {
					ok = false
				}
			}
			if single && rest == m {
				add("plane-single", start+m-1, m, "飞机带单")
			}
			if paired && ok && pairCount == m {
				add("plane-pair", start+m-1, m, "飞机带对")
			}
		}
	}
	if players == 3 && (n == 6 || n == 8) {
		for r, c := range g {
			if len(c) != 4 {
				continue
			}
			if n == 6 {
				add("four-single", r, 1, "四带二")
			}
			if n == 8 && len(g) == 3 {
				ok := true
				for k, v := range g {
					if k != r && len(v) != 2 {
						ok = false
					}
				}
				if ok {
					add("four-pair", r, 1, "四带两对")
				}
			}
		}
	}
	return out
}
func beats(p Pattern, target *Pattern) bool {
	if target == nil {
		return true
	}
	if target.Kind == "rocket" {
		return false
	}
	if p.Kind == "rocket" {
		return true
	}
	if p.Kind == "bomb" {
		if target.Kind != "bomb" {
			return true
		}
		if p.Size != target.Size {
			return p.Size > target.Size
		}
		return p.Rank > target.Rank
	}
	return target.Kind != "bomb" && p.Kind == target.Kind && p.Size == target.Size && p.Chain == target.Chain && p.Rank > target.Rank
}
func resolve(cards []Card, players int, target *Pattern) (Pattern, error) {
	for _, p := range patterns(cards, players) {
		if beats(p, target) {
			return p, nil
		}
	}
	if len(patterns(cards, players)) == 0 {
		return Pattern{}, errors.New("这些牌不能组成有效牌型")
	}
	return Pattern{}, errors.New("需要打出同牌型的更大牌，或使用炸弹")
}
func legalMoves(hand []Card, players int, target *Pattern) []Move {
	g := groups(hand)
	moves := []Move{}
	seen := map[string]bool{}
	add := func(cards []Card) {
		p, e := resolve(cards, players, target)
		if e != nil {
			return
		}
		ids := make([]int, len(cards))
		for i, c := range cards {
			ids[i] = c.ID
		}
		sort.Ints(ids)
		key := fmt.Sprint(ids)
		if seen[key] {
			return
		}
		seen[key] = true
		moves = append(moves, Move{append([]Card{}, cards...), p})
	}
	ranks := []int{}
	for r := range g {
		ranks = append(ranks, r)
	}
	sort.Ints(ranks)
	for _, r := range ranks {
		c := g[r]
		for n := 1; n <= len(c); n++ {
			if n <= 3 || n >= 4 {
				add(c[:n])
			}
		}
		if len(c) >= 3 && r < 16 {
			for _, k := range ranks {
				if k == r {
					continue
				}
				if players == 3 {
					add(append(append([]Card{}, c[:3]...), g[k][0]))
				}
				if len(g[k]) >= 2 {
					add(append(append([]Card{}, c[:3]...), g[k][:2]...))
				}
			}
		}
		if len(c) >= 4 && players == 3 {
			singles := []Card{}
			pairs := []Card{}
			for _, k := range ranks {
				if k == r {
					continue
				}
				singles = append(singles, g[k]...)
				if len(g[k]) >= 2 {
					pairs = append(pairs, g[k][:2]...)
				}
			}
			if len(singles) >= 2 {
				add(append(append([]Card{}, c[:4]...), singles[:2]...))
			}
			if len(pairs) >= 4 {
				add(append(append([]Card{}, c[:4]...), pairs[:4]...))
			}
		}
	}
	if len(g[16]) > 0 && len(g[17]) > 0 {
		if players == 3 {
			add([]Card{g[16][0], g[17][0]})
		} else if len(g[16]) == 2 && len(g[17]) == 2 {
			add(append(append([]Card{}, g[16]...), g[17]...))
		}
	}
	for width := 1; width <= 3; width++ {
		minimum := 2
		if width == 1 {
			minimum = 5
		}
		if width == 2 {
			minimum = 3
		}
		for start := 3; start <= 14; start++ {
			run := []Card{}
			for end := start; end <= 14; end++ {
				if len(g[end]) < width {
					break
				}
				run = append(run, g[end][:width]...)
				m := end - start + 1
				if m < minimum {
					continue
				}
				add(run)
				if width == 3 {
					singles := []Card{}
					pairs := []Card{}
					for _, r := range ranks {
						if r >= start && r <= end {
							continue
						}
						singles = append(singles, g[r]...)
						if len(g[r]) >= 2 {
							pairs = append(pairs, g[r][:2]...)
						}
					}
					if players == 3 && len(singles) >= m {
						add(append(append([]Card{}, run...), singles[:m]...))
					}
					if len(pairs) >= 2*m {
						add(append(append([]Card{}, run...), pairs[:2*m]...))
					}
				}
			}
		}
	}
	sort.SliceStable(moves, func(i, j int) bool {
		a, b := moves[i], moves[j]
		ab := a.Pattern.Kind == "bomb" || a.Pattern.Kind == "rocket"
		bb := b.Pattern.Kind == "bomb" || b.Pattern.Kind == "rocket"
		if ab != bb {
			return !ab
		}
		if target != nil {
			if a.Pattern.Rank != b.Pattern.Rank {
				return a.Pattern.Rank < b.Pattern.Rank
			}
			return len(a.Cards) < len(b.Cards)
		}
		av := len(a.Cards)*20 - a.Pattern.Rank
		bv := len(b.Cards)*20 - b.Pattern.Rank
		return av > bv
	})
	return moves
}
func newGame(capacity int) *Game {
	g := &Game{Capacity: capacity, Phase: "waiting", Landlord: -1, Winner: -1, Current: -1, Leader: -1, Players: make([]Player, capacity), Version: 1}
	for i := range g.Players {
		g.Players[i].Score = 1000
		g.Players[i].Bid = -1
	}
	return g
}
func (g *Game) touch(message string) {
	g.Version++
	g.Message = message
	g.LastAction = time.Now()
	g.Deadline = time.Now().Add(45 * time.Second)
}
func (g *Game) start() {
	g.RoundNumber++
	g.RoundID = newID()
	g.Redeals = 0
	g.Dealer = (g.RoundNumber - 1) % g.Capacity
	g.deal()
}
func (g *Game) deal() {
	deck := newDeck(g.Capacity)
	bottom := 3
	if g.Capacity == 4 {
		bottom = 8
	}
	n := (len(deck) - bottom) / g.Capacity
	for i := range g.Players {
		p := &g.Players[i]
		p.Hand = sorted(deck[i*n : (i+1)*n])
		p.Last = nil
		p.Passed = false
		p.Plays = 0
		p.Bid = -1
	}
	g.Bottom = append([]Card{}, deck[len(deck)-bottom:]...)
	g.Phase = "bidding"
	g.Current = g.Dealer
	g.Landlord = -1
	g.Winner = -1
	g.Table = nil
	g.Target = nil
	g.Leader = -1
	g.Passes = 0
	g.MaxBid = 0
	g.Bidder = -1
	g.BidCount = 0
	g.Bombs = 0
	g.Spring = false
	g.Deltas = nil
	g.touch("开始叫地主")
	g.emit("deal", -1, "发牌")
}
func (g *Game) landlord(seat int) {
	g.Landlord = seat
	g.Players[seat].Hand = sorted(append(g.Players[seat].Hand, g.Bottom...))
	g.Current = seat
	g.Phase = "playing"
	g.touch(g.Players[seat].Name + " 成为地主")
	g.emit("landlord", seat, "地主登场")
}
func (g *Game) act(seat int, a Action) error {
	if seat < 0 || seat >= g.Capacity {
		return errors.New("座位无效")
	}
	if a.Type == "auto" {
		g.Players[seat].Auto = !g.Players[seat].Auto
		g.touch("托管状态已更新")
		return nil
	}
	if g.Phase != "bidding" && g.Phase != "playing" {
		return errors.New("当前没有正在进行的牌局")
	}
	if seat != g.Current {
		return errors.New("还没有轮到你")
	}
	if a.Type == "bid" {
		if g.Phase != "bidding" {
			return errors.New("叫地主已经结束")
		}
		if a.Bid < 0 || a.Bid > 3 || (a.Bid > 0 && a.Bid <= g.MaxBid) {
			return errors.New("叫分需要高于当前叫分")
		}
		g.Players[seat].Bid = a.Bid
		g.BidCount++
		if a.Bid > g.MaxBid {
			g.MaxBid = a.Bid
			g.Bidder = seat
		}
		g.touch(fmt.Sprintf("%s 叫 %d 分", g.Players[seat].Name, a.Bid))
		if a.Bid == 3 {
			g.landlord(seat)
			return nil
		}
		if g.BidCount == g.Capacity {
			if g.Bidder < 0 {
				g.Redeals++
				if g.Redeals < 3 {
					g.Dealer = (g.Dealer + 1) % g.Capacity
					g.deal()
					return nil
				}
				g.MaxBid = 1
				g.Bidder = g.Dealer
			}
			g.landlord(g.Bidder)
		} else {
			g.Current = (seat + 1) % g.Capacity
		}
		return nil
	}
	if g.Phase != "playing" {
		return errors.New("请先完成叫地主")
	}
	if a.Type == "pass" {
		if g.Target == nil {
			return errors.New("新一轮由你先出牌，不能不出")
		}
		g.Players[seat].Last = nil
		g.Players[seat].Passed = true
		g.Passes++
		g.Current = (seat + 1) % g.Capacity
		if g.Passes >= g.Capacity-1 {
			g.Current = g.Leader
			g.Target = nil
			g.Table = nil
			g.Passes = 0
			for i := range g.Players {
				g.Players[i].Last = nil
				g.Players[i].Passed = false
			}
		}
		g.touch(g.Players[seat].Name + " 不出")
		return nil
	}
	if a.Type != "play" {
		return errors.New("未知操作")
	}
	if len(a.Cards) == 0 {
		return errors.New("请先选择要出的牌")
	}
	selected := []Card{}
	wanted := map[int]bool{}
	for _, id := range a.Cards {
		if wanted[id] {
			return errors.New("不能重复选择同一张牌")
		}
		wanted[id] = true
	}
	for _, c := range g.Players[seat].Hand {
		if wanted[c.ID] {
			selected = append(selected, c)
		}
	}
	if len(selected) != len(a.Cards) {
		return errors.New("选择的牌不在你的手牌中")
	}
	pattern, e := resolve(selected, g.Capacity, g.Target)
	if e != nil {
		return e
	}
	remaining := []Card{}
	for _, c := range g.Players[seat].Hand {
		if !wanted[c.ID] {
			remaining = append(remaining, c)
		}
	}
	p := &g.Players[seat]
	p.Hand = remaining
	p.Plays++
	p.Last = sorted(selected)
	p.Passed = false
	g.Table = sorted(selected)
	g.Target = &pattern
	g.Leader = seat
	g.Passes = 0
	if pattern.Kind == "bomb" || pattern.Kind == "rocket" {
		g.Bombs++
	}
	g.Current = (seat + 1) % g.Capacity
	g.touch(p.Name + " · " + pattern.Label)
	g.emit(pattern.Kind, seat, pattern.Label)
	if len(p.Hand) == 0 {
		g.finish(seat)
	}
	return nil
}
func (g *Game) finish(winner int) {
	g.Phase = "finished"
	g.Winner = winner
	landlordWins := winner == g.Landlord
	g.Spring = true
	if landlordWins {
		for i, p := range g.Players {
			if i != g.Landlord && p.Plays > 0 {
				g.Spring = false
			}
		}
	} else {
		g.Spring = g.Players[g.Landlord].Plays == 1
	}
	multiplier := 1 << g.Bombs
	if g.Spring {
		multiplier *= 2
	}
	bid := g.MaxBid
	if bid < 1 {
		bid = 1
	}
	unit := 10 * bid * multiplier
	g.Deltas = make([]int, g.Capacity)
	for i := range g.Players {
		d := unit
		if landlordWins {
			d = -unit
		}
		if i == g.Landlord {
			d = -(g.Capacity - 1) * d
		}
		g.Deltas[i] = d
		g.Players[i].Score += d
	}
	message := "农民获胜"
	if landlordWins {
		message = "地主获胜"
	}
	g.touch(message)
	if g.Spring {
		g.emit("spring", winner, "春天")
	}
	g.emit("finished", winner, message)
}
func (g *Game) aiAction() Action {
	seat := g.Current
	p := g.Players[seat]
	if g.Phase == "bidding" {
		strength := 0
		for _, c := range p.Hand {
			if c.Rank >= 15 {
				strength++
			}
		}
		for r, c := range groups(p.Hand) {
			if r <= 15 && len(c) >= 4 {
				strength += 2
			}
		}
		bid := 0
		if strength >= 4 {
			bid = 1
		}
		if strength >= 6 {
			bid = 2
		}
		if strength >= 8 {
			bid = 3
		}
		if bid <= g.MaxBid {
			bid = 0
		}
		return Action{Type: "bid", Bid: bid}
	}
	moves := legalMoves(p.Hand, g.Capacity, g.Target)
	if len(moves) == 0 {
		return Action{Type: "pass"}
	}
	if g.Target != nil && seat != g.Landlord && g.Leader != g.Landlord && g.Leader >= 0 {
		return Action{Type: "pass"}
	}
	move := moves[0]
	ids := []int{}
	for _, c := range move.Cards {
		ids = append(ids, c.ID)
	}
	return Action{Type: "play", Cards: ids}
}
