package main

import (
	"testing"
)

func TestLANJoinPrivacyResumeAndActions(t *testing.T) {
	r, hostToken, e := newRoom(4, "LAN test", Profile{ID: newID(), Name: "host"}, true)
	if e != nil {
		t.Fatal(e)
	}
	defer r.close()
	guestProfile := Profile{ID: newID(), Name: "guest"}
	client, view, e := joinRemote(r.info.Addresses[len(r.info.Addresses)-1], guestProfile)
	if e != nil {
		t.Fatal(e)
	}
	defer client.close()
	if view.Seat != 1 || view.Room.Humans != 2 {
		t.Fatalf("incorrect guest seat: %+v", view)
	}
	if _, e = r.action(hostToken, Action{Type: "start", RequestID: newID()}); e != nil {
		t.Fatal(e)
	}
	view, e = client.state()
	if e != nil {
		t.Fatal(e)
	}
	host, e := r.get(hostToken)
	if e != nil {
		t.Fatal(e)
	}
	if len(view.Hand) != 25 || len(host.Hand) != 25 {
		t.Fatal("four-player deal incorrect")
	}
	hostCards := map[int]bool{}
	for _, c := range host.Hand {
		hostCards[c.ID] = true
	}
	for _, c := range view.Hand {
		if hostCards[c.ID] {
			t.Fatal("private hands overlap")
		}
	}
	if len(view.Bottom) != 0 {
		t.Fatal("unrevealed bottom leaked")
	}
	if _, e = client.call(WireRequest{Method: "action", Token: client.token, Action: Action{Type: "bid", Bid: 3, RequestID: newID()}}); e == nil {
		t.Fatal("guest bid out of turn accepted")
	}
	client.conn.Close()
	client.conn = nil
	view, e = client.state()
	if e != nil {
		t.Fatal(e)
	}
	if view.Seat != 1 || len(view.Hand) != 25 {
		t.Fatal("reconnect lost seat or hand")
	}
	if _, _, e = joinRemote(r.info.Address, Profile{ID: newID(), Name: "late"}); e == nil {
		t.Fatal("new player joined mid-hand")
	}
}
func TestRejectNonLANAddress(t *testing.T) {
	if _, _, e := joinRemote("8.8.8.8:80", Profile{}); e == nil {
		t.Fatal("public address accepted")
	}
	if _, _, e := joinRemote("not-an-address", Profile{}); e == nil {
		t.Fatal("invalid address accepted")
	}
}
