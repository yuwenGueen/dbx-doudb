package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"
)

type RoomInfo struct {
	ID        string   `json:"id"`
	Name      string   `json:"name"`
	Capacity  int      `json:"capacity"`
	Humans    int      `json:"humans"`
	Address   string   `json:"address"`
	Addresses []string `json:"addresses,omitempty"`
	Mode      string   `json:"mode"`
	Discovery bool     `json:"discovery"`
}
type PlayerView struct {
	Seat   int    `json:"seat"`
	Name   string `json:"name"`
	Bot    bool   `json:"bot"`
	Auto   bool   `json:"auto"`
	Count  int    `json:"count"`
	Score  int    `json:"score"`
	Last   []Card `json:"last"`
	Passed bool   `json:"passed"`
	Bid    int    `json:"bid"`
}
type View struct {
	Room        RoomInfo     `json:"room"`
	Version     int          `json:"version"`
	Seat        int          `json:"seat"`
	Host        bool         `json:"host"`
	Phase       string       `json:"phase"`
	Players     []PlayerView `json:"players"`
	Hand        []Card       `json:"hand"`
	Bottom      []Card       `json:"bottom"`
	BottomCount int          `json:"bottomCount"`
	Current     int          `json:"current"`
	Landlord    int          `json:"landlord"`
	Leader      int          `json:"leader"`
	Target      *Pattern     `json:"target"`
	Table       []Card       `json:"table"`
	MaxBid      int          `json:"maxBid"`
	Bombs       int          `json:"bombs"`
	Spring      bool         `json:"spring"`
	Winner      int          `json:"winner"`
	Deltas      []int        `json:"deltas"`
	RoundID     string       `json:"roundId"`
	RoundNumber int          `json:"roundNumber"`
	Message     string       `json:"message"`
	Deadline    int64        `json:"deadline"`
	Events      []GameEvent  `json:"events"`
}
type Room struct {
	mu       sync.Mutex
	game     *Game
	info     RoomInfo
	tokens   map[string]int
	seen     map[string]bool
	active   map[string]net.Conn
	listener net.Listener
	udp      *net.UDPConn
	done     chan struct{}
	once     sync.Once
	closed   bool
}

var botNames = []string{"MySQL", "Redis", "PostgreSQL", "DuckDB"}

func newRoom(capacity int, name string, profile Profile, lan bool) (*Room, string, error) {
	if capacity != 3 && capacity != 4 {
		return nil, "", errors.New("请选择三人或四人斗地主")
	}
	name = cleanName(name, "午休牌局")
	r := &Room{game: newGame(capacity), info: RoomInfo{ID: newID(), Name: name, Capacity: capacity, Mode: "local"}, tokens: map[string]int{}, seen: map[string]bool{}, active: map[string]net.Conn{}, done: make(chan struct{})}
	token := newID()
	r.tokens[token] = 0
	r.game.Players[0] = Player{ID: profile.ID, Name: profile.Name, Score: 1000, Bid: -1}
	if lan {
		listener, e := net.Listen("tcp4", "0.0.0.0:0")
		if e != nil {
			return nil, "", errors.New("无法创建局域网房间，请检查本机网络权限")
		}
		r.listener = listener
		r.info.Mode = "host"
		port := listener.Addr().(*net.TCPAddr).Port
		r.info.Addresses = localAddresses(port)
		r.info.Address = r.info.Addresses[0]
		udp, e := net.ListenUDP("udp4", &net.UDPAddr{Port: 19528})
		if e == nil {
			r.udp = udp
			r.info.Discovery = true
			go r.discovery()
		}
		go r.accept()
	}
	go r.run()
	return r, token, nil
}
func cleanName(name, fallback string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		name = fallback
	}
	r := []rune(name)
	if len(r) > 24 {
		r = r[:24]
	}
	return string(r)
}
func localAddresses(port int) []string {
	addresses := []string{}
	interfaces, _ := net.InterfaceAddrs()
	for _, a := range interfaces {
		ip, _, e := net.ParseCIDR(a.String())
		if e == nil && ip.To4() != nil && !ip.IsLoopback() && ip.IsPrivate() {
			addresses = append(addresses, net.JoinHostPort(ip.String(), strconv.Itoa(port)))
		}
	}
	addresses = append(addresses, net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	return addresses
}
func (r *Room) summary() RoomInfo {
	info := r.info
	info.Humans = 0
	for _, p := range r.game.Players {
		if p.ID != "" && !p.Bot {
			info.Humans++
		}
	}
	return info
}
func (r *Room) view(token string) (View, error) {
	seat, ok := r.tokens[token]
	if !ok {
		return View{}, errors.New("请先加入房间")
	}
	if r.closed {
		return View{}, errors.New("房间已关闭")
	}
	g := r.game
	v := View{Room: r.summary(), Version: g.Version, Seat: seat, Host: seat == 0, Phase: g.Phase, Hand: sorted(g.Players[seat].Hand), Bottom: []Card{}, BottomCount: len(g.Bottom), Current: g.Current, Landlord: g.Landlord, Leader: g.Leader, Target: g.Target, Table: g.Table, MaxBid: g.MaxBid, Bombs: g.Bombs, Spring: g.Spring, Winner: g.Winner, Deltas: g.Deltas, RoundID: g.RoundID, RoundNumber: g.RoundNumber, Message: g.Message, Deadline: g.Deadline.UnixMilli()}
	v.Events = append([]GameEvent{}, g.Events...)
	if g.Landlord >= 0 {
		v.Bottom = g.Bottom
	}
	for i, p := range g.Players {
		name := p.Name
		bot := p.Bot
		if name == "" {
			name = botNames[(i+len(botNames)-1)%len(botNames)]
			bot = true
		}
		v.Players = append(v.Players, PlayerView{i, name, bot, p.Auto, len(p.Hand), p.Score, p.Last, p.Passed, p.Bid})
	}
	return v, nil
}
func (r *Room) get(token string) (View, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.view(token)
}
func (r *Room) action(token string, a Action) (View, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	seat, ok := r.tokens[token]
	if !ok || r.closed {
		return View{}, errors.New("房间已关闭或座位失效")
	}
	if len(a.RequestID) == 0 || len(a.RequestID) > 80 {
		return View{}, errors.New("缺少有效操作编号")
	}
	key := token + ":" + a.RequestID
	if r.seen[key] {
		return r.view(token)
	}
	if a.Type == "start" {
		if seat != 0 {
			return View{}, errors.New("请等待房主开始")
		}
		if r.game.Phase != "waiting" && r.game.Phase != "finished" {
			return View{}, errors.New("牌局已经开始")
		}
		for i := range r.game.Players {
			p := &r.game.Players[i]
			if p.ID == "" {
				*p = Player{ID: fmt.Sprintf("bot:%d", i), Name: botNames[(i+len(botNames)-1)%len(botNames)], Bot: true, Score: 1000, Bid: -1}
			}
		}
		r.game.Players[seat].Auto = false
		r.game.start()
	} else if e := r.game.act(seat, a); e != nil {
		return View{}, e
	}
	if len(r.seen) > 4096 {
		r.seen = map[string]bool{}
	}
	r.seen[key] = true
	return r.view(token)
}
func (r *Room) hints(token string) ([][]int, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	seat, ok := r.tokens[token]
	if !ok {
		return nil, errors.New("请先加入房间")
	}
	g := r.game
	if g.Phase != "playing" || g.Current != seat {
		return nil, errors.New("轮到你出牌时才能提示")
	}
	out := [][]int{}
	for _, m := range legalMoves(g.Players[seat].Hand, g.Capacity, g.Target) {
		ids := []int{}
		for _, c := range m.Cards {
			ids = append(ids, c.ID)
		}
		out = append(out, ids)
		if len(out) == 40 {
			break
		}
	}
	return out, nil
}
func (r *Room) run() {
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-r.done:
			return
		case now := <-ticker.C:
			r.mu.Lock()
			g := r.game
			if (g.Phase == "bidding" || g.Phase == "playing") && g.Current >= 0 {
				p := &g.Players[g.Current]
				if !p.Bot && !p.Auto && now.After(g.Deadline) {
					p.Auto = true
				}
				if (p.Bot || p.Auto) && now.Sub(g.LastAction) > 650*time.Millisecond {
					_ = g.act(g.Current, g.aiAction())
				}
			}
			r.mu.Unlock()
		}
	}
}
func (r *Room) close() {
	r.once.Do(func() {
		r.mu.Lock()
		r.closed = true
		conns := []net.Conn{}
		for _, c := range r.active {
			conns = append(conns, c)
		}
		r.mu.Unlock()
		close(r.done)
		if r.listener != nil {
			r.listener.Close()
		}
		if r.udp != nil {
			r.udp.Close()
		}
		for _, c := range conns {
			c.Close()
		}
	})
}
func (r *Room) leave(token string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if seat, ok := r.tokens[token]; ok && seat != 0 {
		p := &r.game.Players[seat]
		if r.game.Phase == "waiting" || r.game.Phase == "finished" {
			*p = Player{Score: 1000, Bid: -1}
			delete(r.tokens, token)
		} else {
			p.Auto = true
		}
		r.game.touch("有玩家离开，电脑接替")
	}
}

type WireRequest struct {
	Method  string   `json:"method"`
	Token   string   `json:"token"`
	Profile *Profile `json:"profile,omitempty"`
	Action  Action   `json:"action"`
}
type WireResponse struct {
	View  *View   `json:"view,omitempty"`
	Token string  `json:"token,omitempty"`
	Hints [][]int `json:"hints,omitempty"`
	Error string  `json:"error,omitempty"`
}

func (r *Room) accept() {
	limit := make(chan struct{}, 16)
	for {
		c, e := r.listener.Accept()
		if e != nil {
			return
		}
		select {
		case limit <- struct{}{}:
			go func() { defer func() { <-limit }(); r.serve(c) }()
		default:
			c.Close()
		}
	}
}
func (r *Room) serve(c net.Conn) {
	token := ""
	defer func() {
		c.Close()
		r.mu.Lock()
		if token != "" && r.active[token] == c {
			delete(r.active, token)
			if seat, ok := r.tokens[token]; ok {
				r.game.Players[seat].Auto = true
				r.game.touch("连接中断，电脑暂时代打")
			}
		}
		r.mu.Unlock()
	}()
	scanner := bufio.NewScanner(c)
	scanner.Buffer(make([]byte, 4096), 65536)
	encoder := json.NewEncoder(c)
	for {
		c.SetReadDeadline(time.Now().Add(70 * time.Second))
		if !scanner.Scan() {
			return
		}
		var req WireRequest
		if e := json.Unmarshal(scanner.Bytes(), &req); e != nil {
			return
		}
		res := WireResponse{}
		if req.Method == "join" {
			r.mu.Lock()
			if r.closed {
				res.Error = "房间已关闭"
			} else if req.Token != "" {
				if _, ok := r.tokens[req.Token]; ok {
					token = req.Token
					r.active[token] = c
					r.game.Players[r.tokens[token]].Auto = false
					r.game.touch("玩家已重新连接")
				} else {
					res.Error = "重连凭据失效，请重新加入"
				}
			} else if req.Profile == nil || len(req.Profile.ID) < 16 || len(req.Profile.ID) > 64 {
				res.Error = "玩家身份无效"
			} else if r.game.Phase != "waiting" && r.game.Phase != "finished" {
				res.Error = "牌局正在进行，请等本局结束后加入"
			} else {
				seat := -1
				for i, p := range r.game.Players {
					if p.ID == req.Profile.ID {
						res.Error = "该玩家已经在房间中"
						break
					}
					if i > 0 && (p.ID == "" || p.Bot) && seat < 0 {
						seat = i
					}
				}
				if res.Error == "" {
					if seat < 0 {
						res.Error = "房间人数已满"
					} else {
						token = newID()
						r.tokens[token] = seat
						r.active[token] = c
						r.game.Players[seat] = Player{ID: req.Profile.ID, Name: cleanName(req.Profile.Name, "牌友"), Score: 1000, Bid: -1}
						r.game.touch("牌友已加入")
					}
				}
			}
			if res.Error == "" {
				v, e := r.view(token)
				if e != nil {
					res.Error = e.Error()
				} else {
					res.View = &v
					res.Token = token
				}
			}
			r.mu.Unlock()
		} else if token == "" || req.Token != token {
			res.Error = "请先加入房间"
		} else {
			var v View
			var e error
			switch req.Method {
			case "state":
				v, e = r.get(token)
			case "action":
				v, e = r.action(token, req.Action)
			case "hint":
				res.Hints, e = r.hints(token)
			case "leave":
				r.leave(token)
			default:
				e = errors.New("未知请求")
			}
			if e != nil {
				res.Error = e.Error()
			} else if req.Method == "state" || req.Method == "action" {
				res.View = &v
			}
		}
		c.SetWriteDeadline(time.Now().Add(5 * time.Second))
		if encoder.Encode(res) != nil {
			return
		}
		if req.Method == "leave" {
			return
		}
	}
}
func (r *Room) discovery() {
	b := make([]byte, 1024)
	for {
		n, addr, e := r.udp.ReadFromUDP(b)
		if e != nil {
			return
		}
		if string(b[:n]) != "DOUDB_DISCOVER_V1" {
			continue
		}
		r.mu.Lock()
		info := r.summary()
		r.mu.Unlock()
		data, _ := json.Marshal(info)
		r.udp.WriteToUDP(data, addr)
	}
}
func discover() []RoomInfo {
	out := []RoomInfo{}
	conn, e := net.ListenUDP("udp4", &net.UDPAddr{})
	if e != nil {
		return out
	}
	defer conn.Close()
	targets := []string{"255.255.255.255:19528", "127.0.0.1:19528"}
	for _, target := range targets {
		addr, _ := net.ResolveUDPAddr("udp4", target)
		conn.WriteToUDP([]byte("DOUDB_DISCOVER_V1"), addr)
	}
	conn.SetReadDeadline(time.Now().Add(600 * time.Millisecond))
	seen := map[string]bool{}
	b := make([]byte, 4096)
	for {
		n, addr, e := conn.ReadFromUDP(b)
		if e != nil {
			break
		}
		var info RoomInfo
		if json.Unmarshal(b[:n], &info) != nil || info.ID == "" || (info.Capacity != 3 && info.Capacity != 4) {
			continue
		}
		_, port, e := net.SplitHostPort(info.Address)
		if e != nil {
			continue
		}
		info.Address = net.JoinHostPort(addr.IP.String(), port)
		info.Addresses = nil
		if !seen[info.ID] {
			out = append(out, info)
			seen[info.ID] = true
		}
	}
	return out
}

type Remote struct {
	address string
	token   string
	conn    net.Conn
	scanner *bufio.Scanner
	profile Profile
}

func joinRemote(address string, profile Profile) (*Remote, View, error) {
	host, _, e := net.SplitHostPort(strings.TrimSpace(address))
	if e != nil {
		return nil, View{}, errors.New("请输入 IP:端口，例如 192.168.1.8:5199")
	}
	ip := net.ParseIP(host)
	if ip == nil || (!ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast()) {
		return nil, View{}, errors.New("请使用局域网或本机 IP 地址")
	}
	r := &Remote{address: address, profile: profile}
	res, e := r.connect()
	if e != nil {
		return nil, View{}, e
	}
	return r, *res.View, nil
}
func (r *Remote) connect() (WireResponse, error) {
	c, e := net.DialTimeout("tcp", r.address, 3*time.Second)
	if e != nil {
		return WireResponse{}, errors.New("无法连接房间，请检查地址、防火墙或房主是否在线")
	}
	r.conn = c
	r.scanner = bufio.NewScanner(c)
	r.scanner.Buffer(make([]byte, 4096), 65536)
	res, e := r.call(WireRequest{Method: "join", Token: r.token, Profile: &r.profile})
	if e != nil {
		c.Close()
		r.conn = nil
		return res, e
	}
	if res.View == nil {
		c.Close()
		r.conn = nil
		return res, errors.New("房间返回了无效状态")
	}
	r.token = res.Token
	return res, nil
}
func (r *Remote) call(req WireRequest) (WireResponse, error) {
	if r.conn == nil {
		return WireResponse{}, errors.New("连接已断开")
	}
	r.conn.SetDeadline(time.Now().Add(4 * time.Second))
	if e := json.NewEncoder(r.conn).Encode(req); e != nil {
		r.conn.Close()
		r.conn = nil
		return WireResponse{}, errors.New("连接中断，请重试获取状态")
	}
	if !r.scanner.Scan() {
		r.conn.Close()
		r.conn = nil
		return WireResponse{}, errors.New("房主连接已断开，可重试连接")
	}
	var res WireResponse
	if e := json.Unmarshal(r.scanner.Bytes(), &res); e != nil {
		return res, errors.New("房间返回了无效消息")
	}
	if res.Error != "" {
		return res, errors.New(res.Error)
	}
	return res, nil
}
func (r *Remote) state() (View, error) {
	if r.conn == nil {
		res, e := r.connect()
		if e != nil {
			return View{}, e
		}
		return *res.View, nil
	}
	res, e := r.call(WireRequest{Method: "state", Token: r.token})
	if e != nil {
		return View{}, e
	}
	if res.View == nil {
		return View{}, errors.New("房间状态无效")
	}
	return *res.View, nil
}
func (r *Remote) close() {
	if r.conn != nil {
		r.call(WireRequest{Method: "leave", Token: r.token})
		if r.conn != nil {
			r.conn.Close()
			r.conn = nil
		}
	}
}
