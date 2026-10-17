import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("..", import.meta.url));
const temp = await mkdtemp(join(tmpdir(), "doudb-smoke-"));
const children = [];
async function start(label) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      join(root, "bin", process.platform === "win32" ? "doudb.exe" : "doudb"),
      [
        "--preview",
        "127.0.0.1:0",
        "--ui",
        join(root, "ui"),
        "--data",
        join(temp, label),
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    children.push(child);
    let output = "";
    const timer = setTimeout(
      () => reject(new Error("Preview did not start")),
      10000,
    );
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.stderr.on("data", (data) => {
      output += data;
      const match = output.match(/DouDB preview: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve({ child, url: match[1] });
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (!output.includes("DouDB preview:"))
        reject(new Error(`Preview exited ${code}: ${output}`));
    });
  });
}
async function call(url, method, params = {}) {
  const r = await fetch(url + "/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
    signal: AbortSignal.timeout(7000),
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}
const command = (url, type, extra = {}) =>
  call(url, "game/action", { type, requestId: crypto.randomUUID(), ...extra });
try {
  const a = await start("host"),
    b = await start("guest");
  for (const capacity of [3, 4]) {
    const first = await call(a.url, "game/local", { capacity });
    assert.equal(first.view.hand.length, capacity === 3 ? 17 : 25);
    assert.equal(first.view.bottom.length, 0);
    const called = await command(a.url, "bid", { bid: 3 });
    assert.equal(called.view.hand.length, capacity === 3 ? 20 : 33);
    assert.equal(called.view.bottom.length, capacity === 3 ? 3 : 8);
    const validated = await call(a.url, "game/validate", {
      cards: [called.view.hand.at(-1).id],
    });
    assert.equal(validated.selection.valid, true);
    assert.equal(validated.selection.label, "单张");
    assert.ok(called.view.events.some((event) => event.kind === "landlord"));
    const id = crypto.randomUUID(),
      card = called.view.hand.at(-1).id;
    const played = await call(a.url, "game/action", {
      type: "play",
      cards: [card],
      requestId: id,
    });
    assert.equal(played.view.hand.length, called.view.hand.length - 1);
    const repeat = await call(a.url, "game/action", {
      type: "play",
      cards: [card],
      requestId: id,
    });
    assert.equal(repeat.view.hand.length, played.view.hand.length);
    await call(a.url, "profile/update", { theme: "classic", skin: "classic" });
    const themed = await call(a.url, "game/state");
    assert.equal(themed.view.roundId, first.view.roundId);
    assert.deepEqual(themed.view.hand, played.view.hand);
    assert.equal(themed.profile.theme, "classic");
    await call(a.url, "game/leave");
    console.log(
      `PASS ${capacity}-player deal, landlord bottom, play, command dedup, theme preservation`,
    );
  }
  const room = await call(a.url, "room/create", {
    capacity: 4,
    name: "Smoke LAN",
  });
  const address = room.view.room.addresses.find((x) =>
    x.startsWith("127.0.0.1:"),
  );
  const guest = await call(b.url, "room/join", { address });
  assert.equal(guest.view.seat, 1);
  assert.equal(guest.view.room.mode, "client");
  const rooms = await call(b.url, "lobby/rooms");
  if (room.view.room.discovery)
    assert.ok(rooms.rooms.some((x) => x.id === room.view.room.id));
  await assert.rejects(command(b.url, "start"), /房主/);
  await command(a.url, "start");
  const hostState = await call(a.url, "game/state"),
    guestState = await call(b.url, "game/state");
  assert.equal(hostState.view.hand.length, 25);
  assert.equal(guestState.view.hand.length, 25);
  assert.equal(guestState.view.bottom.length, 0);
  const hostIDs = new Set(hostState.view.hand.map((c) => c.id));
  assert.ok(guestState.view.hand.every((c) => !hostIDs.has(c.id)));
  await command(a.url, "bid", { bid: 3 });
  const reveal = await call(b.url, "game/state");
  assert.equal(reveal.view.bottom.length, 8);
  assert.equal(reveal.view.hand.length, 25);
  assert.ok(reveal.view.events.some((event) => event.kind === "landlord"));
  const untouched = await call(a.url, "game/state");
  assert.equal(untouched.view.hand.length, 33);
  await assert.rejects(command(b.url, "play", { cards: [99999] }));
  const forbidden = await fetch(a.url + "/api", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://example.invalid",
    },
    body: JSON.stringify({ method: "game/leave", params: {} }),
  });
  assert.equal(forbidden.status, 403);
  await call(b.url, "game/leave");
  await call(a.url, "game/leave");
  console.log(
    "PASS LAN discovery, host authority, private hands, public bottom and origin boundary",
  );
  console.log("DouDB integration smoke passed.");
} finally {
  for (const child of children) child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 150));
  await rm(temp, { recursive: true, force: true });
}
