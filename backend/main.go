package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"

	sdk "github.com/t8y2/dbx/plugins/sdk/go/dbx-plugin-sdk"
)

type Profile struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Beans       int      `json:"beans"`
	Theme       string   `json:"theme"`
	Skin        string   `json:"skin"`
	Sound       bool     `json:"sound"`
	Music       bool     `json:"music"`
	MusicVolume int      `json:"musicVolume"`
	Settled     []string `json:"settled,omitempty"`
}
type Service struct {
	mu      sync.Mutex
	profile Profile
	file    string
	room    *Room
	token   string
	remote  *Remote
}
type Result struct {
	Profile   Profile    `json:"profile"`
	View      *View      `json:"view"`
	Rooms     []RoomInfo `json:"rooms"`
	Hints     [][]int    `json:"hints,omitempty"`
	Selection *Selection `json:"selection,omitempty"`
}
type Params struct {
	Capacity    int    `json:"capacity"`
	Name        string `json:"name"`
	Address     string `json:"address"`
	Theme       string `json:"theme"`
	Skin        string `json:"skin"`
	Sound       *bool  `json:"sound"`
	Music       *bool  `json:"music"`
	MusicVolume *int   `json:"musicVolume"`
	Action
}

func newService(dir string) (*Service, error) {
	if e := os.MkdirAll(dir, 0700); e != nil {
		return nil, e
	}
	s := &Service{file: filepath.Join(dir, "profile.json"), profile: Profile{MusicVolume: 28}}
	b, e := os.ReadFile(s.file)
	if e == nil {
		if e = json.Unmarshal(b, &s.profile); e != nil {
			return nil, errors.New("玩家资料损坏，请备份后检查 profile.json")
		}
		if s.profile.ID == "" {
			return nil, errors.New("玩家资料缺少身份")
		}
	} else if os.IsNotExist(e) {
		s.profile = Profile{ID: newID(), Name: "developer", Beans: 1000, Theme: "database", Skin: "database", MusicVolume: 28}
		if e = s.save(s.profile); e != nil {
			return nil, e
		}
	} else {
		return nil, e
	}
	if !validAppearanceID(s.profile.Theme) {
		s.profile.Theme = "database"
	}
	if !validAppearanceID(s.profile.Skin) {
		s.profile.Skin = "database"
	}
	return s, nil
}
func (s *Service) save(p Profile) error {
	b, e := json.MarshalIndent(p, "", "  ")
	if e != nil {
		return e
	}
	tmp := s.file + ".tmp"
	if e = os.WriteFile(tmp, b, 0600); e != nil {
		return e
	}
	return os.Rename(tmp, s.file)
}
func (s *Service) settle(v *View) error {
	if v == nil || v.Phase != "finished" || v.Seat < 0 || v.Seat >= len(v.Deltas) || v.RoundID == "" {
		return nil
	}
	for _, id := range s.profile.Settled {
		if id == v.RoundID {
			return nil
		}
	}
	p := s.profile
	p.Beans += v.Deltas[v.Seat]
	p.Settled = append(append([]string{}, p.Settled...), v.RoundID)
	if len(p.Settled) > 512 {
		p.Settled = p.Settled[len(p.Settled)-512:]
	}
	if e := s.save(p); e != nil {
		return errors.New("积分保存失败，请检查插件数据目录")
	}
	s.profile = p
	return nil
}
func (s *Service) leave() {
	if s.room != nil {
		s.room.close()
		s.room = nil
	}
	if s.remote != nil {
		s.remote.close()
		s.remote = nil
	}
	s.token = ""
}
func (s *Service) Handle(_ sdk.RequestContext, method string, raw json.RawMessage, _ *sdk.Emitter) (any, *sdk.PluginError) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var p Params
	if len(raw) > 0 && string(raw) != "null" {
		if e := json.Unmarshal(raw, &p); e != nil {
			return nil, sdk.NewError(-32602, "参数格式无效")
		}
	}
	result, e := s.handle(method, p)
	if e != nil {
		return nil, sdk.NewError(-32000, e.Error())
	}
	if s.remote != nil && result.View != nil {
		result.View.Room.Mode = "client"
		result.View.Room.Address = s.remote.address
		result.View.Room.Addresses = nil
	}
	if e = s.settle(result.View); e != nil {
		return nil, sdk.NewError(-32000, e.Error())
	}
	result.Profile = s.profile
	result.Profile.Settled = nil
	return result, nil
}
func (s *Service) handle(method string, p Params) (Result, error) {
	result := Result{}
	switch method {
	case "profile/get":
	case "profile/update":
		next := s.profile
		if p.Name != "" {
			next.Name = cleanName(p.Name, "developer")
		}
		if p.Theme != "" {
			if !validAppearanceID(p.Theme) {
				return result, errors.New("界面风格无效")
			}
			next.Theme = p.Theme
		}
		if p.Skin != "" {
			if !validAppearanceID(p.Skin) {
				return result, errors.New("牌面风格无效")
			}
			next.Skin = p.Skin
		}
		if p.Sound != nil {
			next.Sound = *p.Sound
		}
		if p.Music != nil {
			next.Music = *p.Music
		}
		if p.MusicVolume != nil {
			if *p.MusicVolume < 0 || *p.MusicVolume > 100 {
				return result, errors.New("音乐音量需在 0 到 100 之间")
			}
			next.MusicVolume = *p.MusicVolume
		}
		if e := s.save(next); e != nil {
			return result, e
		}
		s.profile = next
	case "profile/rescue":
		if s.profile.Beans < 1000 {
			next := s.profile
			next.Beans = 1000
			if e := s.save(next); e != nil {
				return result, e
			}
			s.profile = next
		}
	case "lobby/rooms":
		result.Rooms = discover()
	case "game/local", "room/create":
		if s.room != nil || s.remote != nil {
			return result, errors.New("请先离开当前牌局")
		}
		room, token, e := newRoom(p.Capacity, p.Name, s.profile, method == "room/create")
		if e != nil {
			return result, e
		}
		s.room = room
		s.token = token
		if method == "game/local" {
			_, e = room.action(token, Action{Type: "start", RequestID: newID()})
			if e != nil {
				s.leave()
				return result, e
			}
		}
		v, e := room.get(token)
		result.View = &v
		return result, e
	case "room/join":
		if s.room != nil || s.remote != nil {
			return result, errors.New("请先离开当前牌局")
		}
		remote, v, e := joinRemote(p.Address, Profile{ID: s.profile.ID, Name: s.profile.Name})
		if e != nil {
			return result, e
		}
		s.remote = remote
		result.View = &v
	case "game/state":
		var v View
		var e error
		if s.room != nil {
			v, e = s.room.get(s.token)
		} else if s.remote != nil {
			v, e = s.remote.state()
		} else {
			return result, nil
		}
		if e != nil {
			return result, e
		}
		result.View = &v
	case "game/action":
		var v View
		var e error
		if s.room != nil {
			v, e = s.room.action(s.token, p.Action)
		} else if s.remote != nil {
			var res WireResponse
			res, e = s.remote.call(WireRequest{Method: "action", Token: s.remote.token, Action: p.Action})
			if res.View != nil {
				v = *res.View
			}
		} else {
			return result, errors.New("请先开局")
		}
		if e != nil {
			return result, e
		}
		result.View = &v
	case "game/validate":
		current, e := s.handle("game/state", Params{})
		if e != nil {
			return result, e
		}
		result.Selection = assessSelection(current.View, p.Cards)
	case "game/hint":
		if s.room != nil {
			hints, e := s.room.hints(s.token)
			result.Hints = hints
			return result, e
		}
		if s.remote != nil {
			res, e := s.remote.call(WireRequest{Method: "hint", Token: s.remote.token})
			result.Hints = res.Hints
			return result, e
		}
		return result, errors.New("请先开局")
	case "game/leave":
		if s.room != nil {
			if v, e := s.room.get(s.token); e == nil {
				if e = s.settle(&v); e != nil {
					return result, e
				}
			}
		}
		if s.remote != nil {
			if v, e := s.remote.state(); e == nil {
				if e = s.settle(&v); e != nil {
					return result, e
				}
			}
		}
		s.leave()
	default:
		return result, errors.New("未提供此功能")
	}
	return result, nil
}
func main() {
	preview := flag.String("preview", "", "Serve local browser preview on 127.0.0.1:port")
	ui := flag.String("ui", "../ui", "UI directory for preview")
	data := flag.String("data", "", "Plugin data directory")
	flag.Parse()
	dir := *data
	if dir == "" {
		dir = os.Getenv("DBX_PLUGIN_DATA_DIR")
	}
	if dir == "" {
		base, e := os.UserConfigDir()
		if e != nil {
			log.Fatal(e)
		}
		dir = filepath.Join(base, "DouDB")
	}
	service, e := newService(dir)
	if e != nil {
		log.Fatal(e)
	}
	defer func() {
		service.mu.Lock()
		defer service.mu.Unlock()
		service.leave()
	}()
	if *preview != "" {
		if e = servePreview(*preview, *ui, service); e != nil {
			log.Fatal(e)
		}
		return
	}
	metadata := sdk.Metadata{ID: "dev.doudb.suite", Version: "0.1.4", Capabilities: []string{"doudb"}}
	if e = sdk.NewServer(metadata, service).Serve(); e != nil {
		log.Fatal(e)
	}
}
func servePreview(address, ui string, s *Service) error {
	host, _, e := net.SplitHostPort(address)
	if e != nil || host != "127.0.0.1" {
		return errors.New("预览服务仅支持 127.0.0.1")
	}
	listener, e := net.Listen("tcp4", address)
	if e != nil {
		return e
	}
	root, e := filepath.Abs(ui)
	if e != nil {
		return e
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		if r.Method != "POST" {
			http.Error(w, "POST required", 405)
			return
		}
		if r.Host != listener.Addr().String() || (r.Header.Get("Origin") != "" && r.Header.Get("Origin") != "http://"+r.Host) {
			http.Error(w, "origin rejected", 403)
			return
		}
		var req struct {
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if json.NewDecoder(http.MaxBytesReader(w, r.Body, 65536)).Decode(&req) != nil {
			http.Error(w, "invalid request", 400)
			return
		}
		result, err := s.Handle(sdk.RequestContext{}, req.Method, req.Params, nil)
		if err != nil {
			json.NewEncoder(w).Encode(map[string]any{"error": err.Message})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"result": result})
	})
	mux.Handle("/assets/", http.StripPrefix("/assets/", http.FileServer(http.Dir(filepath.Join(filepath.Dir(root), "assets")))))
	mux.Handle("/", http.FileServer(http.Dir(root)))
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Host != listener.Addr().String() {
			http.Error(w, "host rejected", 403)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if !strings.HasPrefix(r.URL.Path, "/api") {
			w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'")
		}
		mux.ServeHTTP(w, r)
	})}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(stop)
	go func() { <-stop; server.Close() }()
	fmt.Fprintf(os.Stderr, "DouDB preview: http://%s\n", listener.Addr().String())
	e = server.Serve(listener)
	if errors.Is(e, http.ErrServerClosed) {
		return nil
	}
	return e
}
