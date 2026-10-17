import {
  appearance,
  activeTheme,
  loadAppearance,
  prepareAppearance,
} from "./appearance.js";
import {
  roleArt,
  observeEvents,
  animateCards,
  positionEffects,
  silenceEffects,
  clearEffects,
  previewEffects,
} from "./effects.js";
import { configureAudio, unlockAudio } from "./audio.js";
import { jokerFace } from "./skins/cards/joker.js";
const app = document.querySelector("#app");
const state = {
  profile: null,
  view: null,
  capacity: 3,
  rooms: [],
  selected: new Set(),
  hints: [],
  hintIndex: 0,
  busy: false,
  polling: false,
  error: "",
  boss: false,
  selection: null,
  validation: 0,
  epoch: 0,
  nextPoll: 0,
  failures: 0,
  animation: {},
  drag: null,
  anchor: null,
};
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const rank = (r) =>
  ({ 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2", 16: "JOKER", 17: "JOKER" })[
    r
  ] || String(r);
const suit = (s) => ["♠", "♥", "♣", "♦", ""][s] || "";
const suitName = (s) => ["黑桃", "红桃", "梅花", "方块", ""][s] || "";
const databaseIcon =
  '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><ellipse cx="16" cy="7" rx="11" ry="4"/><path d="M5 7v18c0 2 5 4 11 4s11-2 11-4V7M5 13c0 2 5 4 11 4s11-2 11-4M5 19c0 2 5 4 11 4s11-2 11-4"/></svg>';
const icon = (name) =>
  ({
    play: "▶",
    users: "♟",
    back: "←",
    settings: "⚙",
    sound: "♫",
    wifi: "⌁",
    plus: "＋",
    refresh: "↻",
    close: "×",
    spade: "♠",
  })[name] || name;
const button = (text, action, cls = "", attrs = "") =>
  `<button class="button ${cls}" data-action="${action}" ${state.busy ? "disabled" : ""} ${attrs}>${text}</button>`;
function notify(message) {
  const el = document.querySelector("#toast");
  el.textContent = message;
  el.classList.add("visible");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => el.classList.remove("visible"), 3500);
}
async function rpc(method, params = {}) {
  if (window.dbxPlugin) {
    await window.dbxPlugin.ready;
    const data = await window.dbxPlugin.invoke(method, params, {
      timeoutMs: 8000,
    });
    await prepareAppearance(data.profile);
    return data;
  }
  if (!["127.0.0.1", "localhost"].includes(location.hostname))
    throw new Error("请在 DBX 插件或本地预览中打开");
  const response = await fetch("/api", {
    signal: AbortSignal.timeout(8000),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  if (!response.ok) throw new Error("请求失败，请检查本地预览服务");
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  await prepareAppearance(data.result?.profile);
  return data.result;
}
function absorb(result, syncView = false) {
  if (result.profile) {
    state.profile = result.profile;
    document.body.dataset.theme = result.profile.theme;
    document.body.dataset.skin = result.profile.skin;
    configureAudio(result.profile);
  }
  if (result.view) {
    const old = state.view,
      next = result.view;
    if (old?.room.id === next.room.id && old.version > next.version) return;
    state.animation = {
      ...state.animation,
      ...observeEvents(next, old, state.profile),
    };
    state.view = next;
    state.capacity = next.room.capacity;
    if (!old || old.roundId !== next.roundId || old.room.id !== next.room.id) {
      state.selected.clear();
      state.anchor = null;
      state.drag = null;
    }
    const ids = new Set(next.hand.map((c) => c.id));
    state.selected = new Set([...state.selected].filter((id) => ids.has(id)));
    if (!old || old.version !== next.version) {
      state.hints = [];
      state.hintIndex = 0;
      state.selection = null;
      scheduleValidation();
    }
  } else if (syncView) {
    const lost = !!state.view;
    state.view = null;
    state.selected.clear();
    state.selection = null;
    observeEvents(null, null, state.profile);
    if (lost) state.drag = null;
  }
  if (Array.isArray(result.rooms)) state.rooms = result.rooms;
}
function messageFor(error) {
  if (error.name === "TimeoutError" || error.name === "AbortError")
    return "连接超时，请重试连接";
  if (error instanceof TypeError) return "预览服务暂时断开，请重试连接";
  return error.message || "操作未完成，请重试";
}
async function run(method, params = {}) {
  if (state.busy) return;
  state.busy = true;
  state.epoch++;
  state.drag = null;
  render();
  try {
    const result = await rpc(method, params);
    absorb(result, method === "game/state" || method === "game/leave");
    if (result.view || method === "game/state" || method === "game/leave") {
      state.error = "";
      state.failures = 0;
      state.nextPoll = 0;
    }
    return result;
  } catch (error) {
    const message = messageFor(error);
    notify(message);
    const field = document.querySelector("[data-form-error]");
    if (field) field.textContent = message;
    if (state.view && method.startsWith("game/")) {
      try {
        absorb(await rpc("game/state"), true);
        state.error = "";
      } catch (e) {
        state.error = messageFor(e);
      }
    }
  } finally {
    state.busy = false;
    render();
    scheduleValidation();
  }
}
function roleBadge(seat, large = false) {
  if (!state.view || state.view.landlord < 0)
    return '<span class="role-pending">待定身份</span>';
  const role = seat === state.view.landlord ? "landlord" : "farmer";
  return `<span class="role-badge ${role} ${large ? "large-role" : ""}">${roleArt[role]}<b>${role === "landlord" ? "地主" : "农民"}</b></span>`;
}
function gameBanner() {
  if (!state.error) return "";
  return `<div class="connection-banner" role="alert"><div><strong>牌局连接暂时中断</strong><span>${esc(state.error)}</span></div>${button("重试连接", "reconnect", "small outline")}</div>`;
}
function selectionKey() {
  return `${state.view?.room.id}:${state.view?.roundId}:${state.view?.version}:${[...state.selected].sort((a, b) => a - b).join(",")}`;
}
function canPlay() {
  return !!(
    state.selection?.valid &&
    state.selection.key === selectionKey() &&
    !state.busy &&
    !state.error &&
    !state.boss
  );
}
function syncSelectionUI() {
  const footer = document.querySelector(".hand-footer>span:first-child");
  if (footer && state.view)
    footer.textContent = `${state.view.hand.length} 张手牌${state.selected.size ? " · 已选 " + state.selected.size + " 张" : ""}`;
  const hint = document.querySelector('button[data-action="hint"]');
  if (hint) hint.textContent = state.hintIndex ? "换一组" : "提示";
  document.querySelectorAll(".hand-card").forEach((el) => {
    const selected = state.selected.has(Number(el.dataset.card));
    el.classList.toggle("selected", selected);
    el.setAttribute("aria-pressed", String(selected));
  });
  const feedback = document.querySelector(".selection-feedback");
  if (feedback) {
    const result =
      state.selection?.key === selectionKey() ? state.selection : null;
    const leading =
      state.view?.current === state.view?.seat && !state.view?.target;
    feedback.dataset.valid = result?.valid ? "true" : "false";
    feedback.innerHTML = state.selected.size
      ? `<strong>${state.selected.size} 张${result?.label ? " · " + esc(result.label) : ""}</strong><span>${esc(result?.message || "正在识别牌型…")}</span>`
      : `<span>${leading ? "本轮由你先出，可选择任意合法牌型" : "点选或拖动选牌 · 双击选中同点数"}</span>`;
  }
  const play = document.querySelector('button[data-action="play"]');
  if (play) {
    play.disabled = !canPlay();
    play.textContent = `出牌${state.selected.size ? " · " + state.selected.size + " 张" : ""}`;
  }
  const clear = document.querySelector('button[data-action="clear"]');
  if (clear) clear.disabled = !state.selected.size || state.busy;
}
function scheduleValidation() {
  clearTimeout(scheduleValidation.timer);
  const ticket = ++state.validation;
  if (!state.selected.size || state.view?.phase !== "playing") {
    state.selection = null;
    return;
  }
  scheduleValidation.timer = setTimeout(async () => {
    const key = selectionKey(),
      epoch = state.epoch;
    try {
      const result = await rpc("game/validate", { cards: [...state.selected] });
      if (
        ticket !== state.validation ||
        key !== selectionKey() ||
        epoch !== state.epoch
      )
        return;
      const selection = result.selection;
      if (
        selection?.roundId !== state.view?.roundId ||
        selection?.version !== state.view?.version
      )
        return;
      state.selection = { ...selection, key };
      syncSelectionUI();
    } catch (error) {
      if (ticket === state.validation && key === selectionKey()) {
        state.selection = { key, valid: false, message: messageFor(error) };
        syncSelectionUI();
      }
    }
  }, 100);
}
function selectionChanged() {
  state.selection = null;
  syncSelectionUI();
  scheduleValidation();
}
function playerName(player) {
  if (!player.bot || activeTheme(state.profile)?.flavor === "database")
    return player.name;
  return ["电脑小明", "电脑小红", "电脑小蓝", "电脑小林"][player.seat % 4];
}
function avatar(player, large = false) {
  const db = activeTheme(state.profile)?.flavor === "database" && player.bot;
  const name = playerName(player);
  return `<span class="avatar ${large ? "large" : ""} bot-${player.seat % 4} ${db ? "database-avatar" : ""}" aria-hidden="true">${db ? databaseIcon : esc(name.slice(0, 1))}</span>`;
}
function card(c, { back = false, mini = false, hero = false } = {}) {
  if (back)
    return `<span class="card-face card-back ${mini ? "mini" : ""} ${hero ? "hero-card" : ""}"><span class="back-emblem">${databaseIcon}<b>♠</b></span><small>DouDB</small></span>`;
  if (c.rank > 15) return jokerFace(c.rank === 17, { mini, hero });
  const red = c.suit === 1 || c.suit === 3;
  return `<span class="card-face ${red ? "red" : ""} ${mini ? "mini" : ""} ${hero ? "hero-card" : ""}"><span class="card-index"><b>${rank(c.rank)}</b><i>${suit(c.suit)}</i></span><span class="card-center">${suit(c.suit)}</span><span class="card-corner">${rank(c.rank) + suit(c.suit)}</span><span class="db-stamp">SELECT *</span></span>`;
}

function header() {
  const p = state.profile;
  return `<header class="topbar"><a class="brand" href="#" data-action="home"><span class="brand-mark">${databaseIcon}<b>♠</b></span><strong>DouDB</strong><span class="brand-caption">斗地主</span></a><div class="top-controls"><div class="theme-switch" role="group" aria-label="界面风格">${appearance.themes
    .slice(0, 2)
    .map(
      (theme) =>
        `<button data-action="theme" data-value="${theme.id}" aria-pressed="${p.theme === theme.id}" ${state.busy ? "disabled" : ""}>${esc(theme.name)}</button>`,
    )
    .join(
      "",
    )}</div>${button("皮肤", "appearance", "quiet")}<button class="profile-button" data-action="settings" title="修改昵称"><span class="user-dot">${esc(p.name.slice(0, 1).toUpperCase())}</span><span>${esc(p.name)}</span></button><span class="beans"><span>◒</span> ${p.beans.toLocaleString()} <small>DB 豆</small></span>${button("老板键 <kbd>⌘/Ctrl ⇧ B</kbd>", "boss", "quiet boss-button")}${button(icon("settings"), "settings", "icon-button", 'aria-label="设置"')}</div></header>`;
}
function cardChoices(limit) {
  return appearance.cards
    .slice(0, limit)
    .map(
      (skin) =>
        `<button class="skin-option" data-action="skin" data-value="${skin.id}" aria-pressed="${state.profile.skin === skin.id}"><span class="skin-sample" style="--preview-bg:${skin.preview.surface};--preview-accent:${skin.preview.accent}"><b>♠</b></span><span>${esc(skin.name)}</span></button>`,
    )
    .join("");
}
function appearancePanel() {
  return `<div data-appearance-panel><p class="appearance-heading">界面主题</p><div class="theme-gallery">${appearance.themes.map((theme) => `<button type="button" class="theme-choice" data-action="theme" data-value="${theme.id}" aria-pressed="${state.profile.theme === theme.id}"><span class="theme-preview" style="--preview-bg:${theme.preview.surface};--preview-accent:${theme.preview.accent}"><i></i><b>♠</b><em></em></span><strong>${esc(theme.name)}</strong><small>${esc(theme.description || "")}</small><span class="theme-selected">已选择 ✓</span></button>`).join("")}</div><p class="appearance-heading">牌面皮肤 <small>可以单独搭配</small></p><div class="skin-options appearance-cards">${cardChoices()}</div><p class="helper">切换保留当前牌局、手牌和选牌。</p></div><div class="modal-actions"><button class="button primary" type="submit">完成</button></div>`;
}
function syncAppearancePanel() {
  const panel = document.querySelector("[data-appearance-panel]");
  if (panel)
    panel
      .querySelectorAll("[data-action]")
      .forEach((el) =>
        el.setAttribute(
          "aria-pressed",
          String(
            el.dataset.value ===
              (el.dataset.action === "theme"
                ? state.profile.theme
                : state.profile.skin),
          ),
        ),
      );
}
function lobby() {
  const database = activeTheme(state.profile)?.flavor === "database";
  return `<main class="lobby"><section class="welcome"><div><p class="eyebrow">${esc(activeTheme(state.profile)?.eyebrow || "DOUDB · 休闲牌局")}</p><h1>来一局？</h1><p>选好人数，随时开打。</p></div><span class="lobby-note"><i class="status-dot"></i> 单机随时玩 · 局域网一起玩</span></section><section class="lobby-hero"><div class="hero-copy"><div class="segmented" role="group" aria-label="斗地主人数">${[3, 4].map((n) => `<button data-action="capacity" data-value="${n}" aria-pressed="${state.capacity === n}">${n} 人</button>`).join("")}</div><h2>斗地主</h2><p class="hero-description">${state.capacity === 3 ? "三人经典，一主两农。" : "四人同乐，热闹加倍。"}</p><div class="mode-facts"><span><b>${state.capacity === 3 ? 54 : 108}</b> 张牌</span><span>手牌 <b>${state.capacity === 3 ? 17 : 25}</b> 张</span><span>底牌 <b>${state.capacity === 3 ? 3 : 8}</b> 张</span>${button("玩法", "rules", "text")}</div><div class="bot-preview">${[
    1,
    2,
    ...(state.capacity === 4 ? [3] : []),
  ]
    .map((seat) => {
      const p = {
        seat,
        name: ["", "MySQL", "Redis", "PostgreSQL"][seat],
        bot: true,
      };
      return `<div>${avatar(p)}<span>${esc(playerName(p))}</span></div>`;
    })
    .join(
      "",
    )}</div><div class="hero-actions">${button(`${icon("play")} 单机开局`, "local", "primary large")}${button(`${icon("users")} 局域网对战`, "create-room", "outline large")}</div><p class="helper">缺人时电脑自动补位</p></div><div class="hero-art" aria-hidden="true"><div class="felt-orbit"></div>${[{ rank: 17, suit: 4 }, { rank: 16, suit: 4 }, { rank: 14, suit: 0 }, { rank: 13, suit: 1 }, { rank: 12, suit: 2 }, null].map((c, i) => `<div class="fan-card" style="--i:${i}">${card(c, { back: !c, hero: true })}</div>`).join("")}<span class="art-suit">♠</span></div></section><div class="lobby-bottom"><section class="panel room-panel"><div class="section-heading"><h3>${icon("wifi")} 局域网房间</h3><div>${button("输入地址加入", "join-address", "text")}${button("↻ 刷新", "scan", "quiet")}</div></div>${state.rooms.length ? `<div class="room-list">${state.rooms.map((r) => `<div class="room-row"><span class="room-icon">♟</span><strong>${esc(r.name)}</strong><span class="tag">${r.capacity} 人局</span><span class="muted">${r.humans} / ${r.capacity} 人</span>${button("加入", "join-room", "small outline", `data-address="${esc(r.address)}"`)}</div>`).join("")}</div>` : '<div class="empty-rooms"><span class="empty-network">⌁</span><div><strong>和同事组一桌</strong><p>创建房间，或刷新查找同一局域网的牌友。</p></div></div>'}</section><section class="panel skins-panel"><div><h3>♧ 牌面皮肤</h3><p class="muted">换个牌背，换个心情。</p></div><div class="skin-options">${cardChoices(3)}</div></section></div></main>`;
}
function waiting() {
  const v = state.view;
  return `<main class="room-waiting"><div class="scene-heading">${button("← 返回大厅", "leave", "quiet")}<span class="tag">${v.room.capacity} 人斗地主</span></div>${gameBanner()}<section class="waiting-content"><p class="eyebrow">${v.host ? "你的房间已准备好" : "已加入房间"}</p><h1>${esc(v.room.name)}</h1><p class="muted">好友可以通过局域网房间列表加入，也可以输入下方地址。</p><div class="address-list">${(v.room.addresses?.length ? v.room.addresses : [v.room.address]).map((a) => `<div class="address-item"><input aria-label="房间地址" readonly value="${esc(a)}">${button("复制", "copy-address", "quiet", `data-address="${esc(a)}"`)}</div>`).join("")}</div>${v.host && !v.room.discovery ? '<p class="helper">自动发现暂不可用，仍可使用上方地址加入。</p>' : ""}<div class="waiting-seats">${v.players.map((p) => `<div class="waiting-seat ${p.bot ? "vacant" : ""}">${avatar(p, true)}<strong>${p.bot ? "电脑补位" : esc(playerName(p))}</strong><small>${p.seat === 0 ? "房主" : p.bot ? "好友加入时替换" : "已入座"}</small></div>`).join("")}</div>${v.host ? button("开始斗地主", "start", "primary large") : '<p class="waiting-message">等待房主开始…</p>'}<p class="helper">不用等满人，空位会由电脑补齐。</p></section></main>`;
}
// Public plays stay with their owner; only the current leader is the target to beat.
function visiblePlay(player) {
  const v = state.view;
  if (v.phase !== "playing" || player.passed) return [];
  return v.target && player.seat === v.leader
    ? v.table || []
    : player.last || [];
}
function seatPlay(player, position) {
  const v = state.view;
  if (v.phase !== "playing") return "";
  const cards = visiblePlay(player);
  const owner = player.seat === v.seat ? "你" : playerName(player);
  if (player.passed)
    return `<section class="seat-play ${position} passed-play" data-seat="${player.seat}" aria-label="${esc(owner)}不出"><span>不出</span></section>`;
  if (!cards.length) return "";
  const current = !!v.target && player.seat === v.leader;
  return `<section class="seat-play ${position} ${current ? "current-play" : "previous-play"}" data-seat="${player.seat}" aria-label="${esc(owner)}出的牌${current ? "，当前待压" : "，已被压过"}" style="--play-columns:${Math.min(8, cards.length)};--narrow-columns:${Math.min(6, cards.length)}">
    <div class="play-caption"><strong>${esc(owner)}出牌</strong><span>${current ? `待压 · ${esc(v.target.label)}` : "已被压"}</span></div>
    <div class="played-cards">${cards.map((c) => card(c, { mini: true })).join("")}</div>
  </section>`;
}
function playLayout(v) {
  const rows = (player, columns = 8) =>
    player
      ? Math.ceil(visiblePlay(player).length / columns) ||
        (player.passed ? 1 : 0)
      : 0;
  const top = v.room.capacity === 4 ? v.players[(v.seat + 2) % 4] : null;
  const sides = [
    v.players[(v.seat + 1) % v.players.length],
    v.players[(v.seat + v.players.length - 1) % v.players.length],
  ];
  return `--top-play-rows:${rows(top)};--self-play-rows:${rows(v.players[v.seat])};--side-play-rows:${Math.max(...sides.map((p) => rows(p)))};--narrow-side-play-rows:${Math.max(...sides.map((p) => rows(p, 6)))}`;
}
function turnStatus(v, me) {
  if (v.phase === "finished")
    return '<span class="identity-rule">本局已结算</span>';
  const current = v.current === v.seat;
  const text =
    me.auto && current
      ? "电脑替你出牌"
      : v.phase === "bidding"
        ? current
          ? "轮到你叫地主"
          : `${playerName(v.players[v.current])} 叫地主`
        : current
          ? "轮到你出牌"
          : `${playerName(v.players[v.current])} 出牌中`;
  return `<div class="turn-status"><div><strong class="turn-label">${esc(text)}</strong><span class="countdown" data-deadline="${v.deadline}"></span></div><div class="turn-progress"><i data-time-bar></i></div></div>`;
}
function opponent(p, position) {
  const v = state.view,
    active = v.current === p.seat && v.phase !== "finished";
  const role =
    v.landlord < 0 ? "pending" : p.seat === v.landlord ? "landlord" : "farmer";
  const status =
    v.phase === "bidding"
      ? p.bid < 0
        ? "等待叫分"
        : p.bid === 0
          ? "不叫"
          : `${p.bid} 分`
      : "";
  return `<section class="opponent ${position} role-${role} ${active ? "active-turn" : ""}" data-seat="${p.seat}">
    <div class="player-info"><span class="avatar-wrap">${avatar(p)}${role !== "pending" ? `<span class="avatar-crest ${role}">${roleArt[role]}</span>` : ""}</span><div><strong>${esc(playerName(p))}</strong>${roleBadge(p.seat)}<small>${p.auto ? "托管中" : p.bot ? "电脑牌友" : "牌友"} · ${p.count} 张</small></div></div>
    <div class="opponent-cards" aria-label="剩余 ${p.count} 张">${Array.from({ length: Math.min(3, p.count) }, () => card(null, { back: true, mini: true })).join("")}<b class="${p.count > 0 && p.count <= 2 ? "low-count" : ""}">${p.count}<small> 张</small></b></div>
    ${p.count > 0 && p.count <= 2 && v.phase === "playing" ? `<span class="low-card-alert">只剩 ${p.count} 张</span>` : ""}
    ${status ? `<span class="player-status">${status}</span>` : ""}
    ${seatPlay(p, position)}
  </section>`;
}
function settlement() {
  const v = state.view,
    delta = v.deltas[v.seat],
    win = delta > 0;
  return `<section class="settlement ${win ? "won" : "lost"}"><p class="eyebrow">第 ${v.roundNumber} 局 · 已结算</p><h2>${win ? "赢得漂亮！" : "再来一局！"}</h2><div class="settlement-delta ${win ? "positive" : "negative"}">${delta > 0 ? "+" : ""}${delta.toLocaleString()}<small> DB 豆</small></div><p>${v.winner === v.landlord ? "地主获胜" : "农民获胜"}${v.spring ? " · 春天" : ""}</p><div class="score-formula">底分 10 × 叫分 ${v.maxBid} × 炸弹 ${2 ** v.bombs}${v.spring ? " × 春天 2" : ""}</div><div class="settlement-scores">${v.players.map((p) => `<div class="${p.seat === v.seat ? "your-score" : ""}"><span>${esc(playerName(p))}<small>${p.seat === v.landlord ? "地主" : "农民"}${p.seat === v.seat ? " · 你" : ""}</small></span><strong class="${v.deltas[p.seat] > 0 ? "positive" : "negative"}">${v.deltas[p.seat] > 0 ? "+" : ""}${v.deltas[p.seat]}</strong></div>`).join("")}</div><div class="settlement-actions">${v.host ? button("再来一局", "start", "primary") : '<span class="muted">等待房主再来一局</span>'}${button("返回大厅", "leave", "quiet")}</div></section>`;
}
function actionBar(v, me) {
  if (v.phase === "finished")
    return '<span class="muted">本局积分已保存</span>';
  if (state.error) return '<span class="muted">连接恢复后可继续操作</span>';
  if (me.auto)
    return `<span class="auto-message">电脑正在替你出牌</span>${button("取消托管，自己来", "auto", "primary")}`;
  if (v.current !== v.seat)
    return `<span class="muted">${v.phase === "bidding" ? "等待其他玩家叫地主…" : "等待其他玩家出牌，可以提前选牌"}</span>`;
  if (v.phase === "bidding")
    return `${button("不叫", "bid", "outline", 'data-value="0"')}${[1, 2, 3].map((n) => button(`${n} 分`, "bid", n === 3 ? "primary" : "outline", `data-value="${n}" ${n <= v.maxBid ? "disabled" : ""}`)).join("")}`;
  return `${button("不出", "pass", "outline", v.target ? "" : 'disabled title="本轮由你先出牌"')}${button(state.hintIndex ? "换一组" : "提示", "hint", "outline")}${button("出牌", "play", "primary", "disabled")}${button("重选", "clear", "quiet", state.selected.size ? "" : "disabled")}`;
}
function game() {
  const v = state.view,
    me = v.players[v.seat],
    current = v.current === v.seat;
  const others = [];
  for (let n = 1; n < v.players.length; n++)
    others.push(v.players[(v.seat + n) % v.players.length]);
  const placements =
    v.players.length === 3 ? ["right", "left"] : ["right", "top", "left"];
  const myRole =
    v.landlord < 0 ? "pending" : v.landlord === v.seat ? "landlord" : "farmer";
  return `<main class="game-scene"><div class="scene-heading">${button("← 返回大厅", "leave", "quiet")}<div class="round-meta"><span>${v.room.capacity} 人斗地主</span><span>第 ${v.roundNumber} 局</span><span>叫分 ${v.maxBid || "—"}</span><span>倍率 × ${2 ** v.bombs * (v.spring ? 2 : 1)}</span></div><div>${button(state.profile.music ? "♫ 音乐开" : "♫ 音乐关", "music", "quiet", `aria-pressed="${!!state.profile.music}"`)} ${button(state.profile.sound ? "音效开" : "音效关", "sound", "quiet", `aria-pressed="${!!state.profile.sound}"`)} ${v.phase !== "finished" ? button(me.auto ? "取消托管" : "托管", "auto", "quiet") : ""} ${button("玩法", "rules", "quiet")}</div></div>
    ${gameBanner()}<div class="identity-strip ${myRole}"><div><span class="identity-label">你的身份</span>${roleBadge(v.seat, true)}<span class="identity-goal">${myRole === "pending" ? "叫地主，争取先出牌" : myRole === "landlord" ? `独立对抗 ${v.room.capacity - 1} 名农民，先出完获胜` : "与其他农民合作，任一农民先出完即获胜"}</span></div>${turnStatus(v, me)}</div>
    <div class="table-wrap"><div class="poker-table ${v.players.some((p) => visiblePlay(p).length) ? "has-plays" : ""}" data-capacity="${v.room.capacity}" style="${playLayout(v)}"><span class="table-brand">${esc(activeTheme(state.profile)?.tableLabel || "DouDB 斗地主")}</span><div class="bottom-cards"><button class="bottom-inspect" data-action="bottom" ${v.landlord < 0 ? "disabled" : ""} title="查看完整底牌">${v.landlord < 0 ? "待揭晓 · " : ""}底牌 ${v.bottomCount} 张${v.landlord >= 0 ? " ↗" : ""}</button><div>${v.bottom.length ? v.bottom.map((c) => card(c, { mini: true })).join("") : Array.from({ length: v.bottomCount }, () => card(null, { back: true, mini: true })).join("")}</div></div>${others.map((p, i) => opponent(p, placements[i])).join("")}${v.phase === "finished" ? settlement() : `<div class="table-idle" aria-hidden="true"><span class="table-watermark">♠</span></div>${seatPlay(me, "self")}`}<div class="own-player role-${myRole} ${current && v.phase !== "finished" ? "active-turn" : ""}"><span class="avatar-wrap">${avatar(me)}${myRole !== "pending" ? `<span class="avatar-crest ${myRole}">${roleArt[myRole]}</span>` : ""}</span><div><strong>${esc(playerName(me))} <span class="you-tag">你</span></strong>${roleBadge(me.seat)}${me.auto ? "<small>托管中</small>" : ""}</div><span class="room-score" aria-label="你的 DB 豆余额">${state.profile.beans.toLocaleString()} <small>DB 豆</small></span></div></div></div>
    <section class="hand-area"><div class="action-bar">${actionBar(v, me)}</div>${v.phase === "playing" ? '<div class="selection-feedback" role="status" aria-live="polite"></div>' : ""}<div class="hand-scroll"><div class="hand" style="--n:${Math.max(1, v.hand.length)}">${v.hand.map((c) => `<button class="hand-card ${state.selected.has(c.id) ? "selected" : ""}" data-card="${c.id}" data-rank="${c.rank}" aria-label="${esc(c.rank > 15 ? (c.rank === 17 ? "大王" : "小王") : suitName(c.suit) + rank(c.rank))}" aria-pressed="${state.selected.has(c.id)}" ${state.busy || v.phase !== "playing" ? "disabled" : ""}>${card(c)}</button>`).join("")}</div></div><div class="hand-footer"><span>${v.hand.length} 张手牌${state.selected.size ? ` · 已选 ${state.selected.size} 张` : ""}</span><span class="hand-instructions">拖动连选 · 双击同点数 · 空格提示 · Enter 出牌</span></div></section></main>`;
}
function render() {
  if (!state.profile) return;
  const focused = document.activeElement,
    focusData = focused?.closest("#app") ? { ...focused.dataset } : null;
  const scroll = document.querySelector(".hand-scroll")?.scrollLeft || 0;
  const tableScroll = document.querySelector(".table-wrap")?.scrollTop || 0;
  const previousMain = app.querySelector("main");
  const mainScroll = previousMain?.scrollTop || 0;
  app.dataset.screen = state.view ? state.view.phase === "waiting" ? "waiting" : "game" : "lobby";
  app.dataset.phase = state.view?.phase || "";
  app.innerHTML =
    header() +
    (state.view
      ? state.view.phase === "waiting"
        ? waiting()
        : game()
      : lobby()) +
    `<footer class="footer"><span><i class="status-dot ${state.error ? "offline" : ""}"></i> ${state.error ? "连接中断" : state.view ? (state.view.room.mode === "local" ? "单机对战" : "局域网对战") : "本地就绪"}</span><span>经典玩法 · 电脑补位 · ${esc(activeTheme(state.profile)?.name)}</span></footer>`;
  const handScroll = document.querySelector(".hand-scroll");
  if (handScroll) handScroll.scrollLeft = scroll;
  const tableWrap = app.querySelector(".table-wrap");
  if (tableWrap) tableWrap.scrollTop = tableScroll;
  const main = app.querySelector("main");
  if (main?.className === previousMain?.className) main.scrollTop = mainScroll;
  app.inert =
    state.boss || !!document.querySelector("#modal-root").children.length;
  if (focusData && !app.inert) {
    const el = [...app.querySelectorAll("button,a")].find((el) =>
      focusData.card
        ? el.dataset.card === focusData.card
        : focusData.action &&
          el.dataset.action === focusData.action &&
          el.dataset.value === focusData.value,
    );
    el?.focus({ preventScroll: true });
  }
  updateCountdown();
  syncSelectionUI();
  positionEffects();
  animateCards(state.animation);
  state.animation = {};
}
function updateCountdown() {
  const v = state.view;
  for (const el of document.querySelectorAll("[data-deadline]")) {
    const left = Math.max(
      0,
      Math.ceil((Number(el.dataset.deadline) - Date.now()) / 1000),
    );
    el.textContent = left ? `${left} 秒` : "即将自动托管";
    el.classList.toggle("urgent", left <= 10);
    const bar = document.querySelector("[data-time-bar]");
    if (bar) {
      bar.style.transform = `scaleX(${Math.min(1, left / 45)})`;
      bar.classList.toggle("urgent", left <= 10);
    }
  }
  if (v?.phase === "finished")
    document.querySelector(".hand-area")?.classList.add("finished-hand");
}
let modalFocus;
function showModal(title, body, onSubmit) {
  const root = document.querySelector("#modal-root");
  modalFocus = { ...document.activeElement?.dataset };
  root.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="section-heading"><h2 id="modal-title">${esc(title)}</h2><button type="button" class="close-button" data-close-modal aria-label="关闭">×</button></div><form>${body}<p class="form-error" data-form-error role="alert"></p></form></section></div>`;
  app.inert = true;
  root.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.busy) return;
    const form = e.currentTarget;
    const submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    const data = Object.fromEntries(new FormData(form));
    try {
      await onSubmit(data);
    } finally {
      if (submit?.isConnected) submit.disabled = false;
    }
  });
  root.querySelector("[data-close-modal]").onclick = closeModal;
  root.querySelector(".modal-backdrop").addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop") && !state.busy)
      closeModal();
  });
  root.querySelector('input,button[type="submit"],button')?.focus();
}
function closeModal() {
  if (state.busy) return;
  document.querySelector("#modal-root").innerHTML = "";
  app.inert = state.boss;
  if (!state.boss && modalFocus?.action)
    [...app.querySelectorAll("[data-action]")]
      .find((el) => el.dataset.action === modalFocus.action)
      ?.focus({ preventScroll: true });
}
function confirmLeave() {
  showModal(
    "返回大厅",
    `<p>${state.view?.host && state.view.room.mode !== "local" ? "你是房主，返回大厅会关闭整个房间。" : state.view?.room.mode === "host" || state.view?.room.mode === "local" ? "当前牌局将结束。" : "离开后会由电脑接替你的座位。"}</p><div class="modal-actions"><button class="button primary" type="submit">返回大厅</button></div>`,
    async () => {
      const result = await run("game/leave");
      if (result) {
        state.view = null;
        state.selected.clear();
        closeModal();
        render();
      }
    },
  );
}
function toggleBoss() {
  state.boss = !state.boss;
  const boss = document.querySelector("#boss");
  boss.hidden = !state.boss;
  app.inert =
    state.boss || !!document.querySelector("#modal-root").children.length;
  document.querySelector("#modal-root").inert = state.boss;
  silenceEffects(state.boss);
  if (state.boss) {
    boss.innerHTML = `<div class="boss-toolbar"><strong>查询结果 · system_performance_metrics</strong><button class="button quiet" data-action="boss">返回 · Esc</button></div><pre>SELECT node_id, service, status, latency_ms, updated_at\nFROM system_performance_metrics ORDER BY updated_at DESC;</pre><table><thead><tr><th>#</th><th>node_id</th><th>service</th><th>status</th><th>latency_ms</th><th>updated_at</th></tr></thead><tbody>${Array.from({ length: 22 }, (_, i) => `<tr><td>${i + 1}</td><td>${1000 + i}</td><td>${["mysql-primary", "redis-cache", "postgres-replica"][i % 3]}</td><td>HEALTHY</td><td>${(1.3 + ((i * 17) % 23) / 10).toFixed(2)}</td><td>${new Date(Date.now() - i * 60000).toLocaleString("sv-SE")}</td></tr>`).join("")}</tbody></table>`;
  }
}
async function handle(action, el) {
  switch (action) {
    case "home":
      if (state.view) confirmLeave();
      break;
    case "capacity":
      state.capacity = Number(el.dataset.value);
      render();
      break;
    case "theme":
      await run("profile/update", {
        theme: el.dataset.value,
        skin: appearance.themes.find((theme) => theme.id === el.dataset.value)
          ?.defaultCard,
      });
      syncAppearancePanel();
      break;
    case "skin":
      await run("profile/update", { skin: el.dataset.value });
      syncAppearancePanel();
      break;
    case "local":
      state.selected.clear();
      await run("game/local", { capacity: state.capacity });
      break;
    case "create-room":
      showModal(
        "创建局域网房间",
        `<label>房间名称<input name="name" maxlength="24" value="午休牌局" required></label><p class="muted">${state.capacity} 人斗地主 · 空位由电脑补齐</p><div class="modal-actions"><button class="button primary" type="submit">创建房间</button></div>`,
        async (data) => {
          const res = await run("room/create", {
            capacity: state.capacity,
            name: data.name,
          });
          if (res) closeModal();
        },
      );
      break;
    case "join-address":
      showModal(
        "输入地址加入",
        `<label>房间地址<input name="address" placeholder="192.168.1.8:5199" autocomplete="off" required></label><p class="muted">使用房主界面上显示的地址。</p><div class="modal-actions"><button class="button primary" type="submit">加入房间</button></div>`,
        async (data) => {
          const res = await run("room/join", { address: data.address.trim() });
          if (res) closeModal();
        },
      );
      break;
    case "join-room":
      await run("room/join", { address: el.dataset.address });
      break;
    case "scan":
      await run("lobby/rooms");
      if (!state.rooms.length) notify("未发现房间，可以输入房主地址加入");
      break;
    case "start":
      state.selected.clear();
      await run("game/action", {
        type: "start",
        requestId: crypto.randomUUID(),
      });
      break;
    case "bid":
      await run("game/action", {
        type: "bid",
        bid: Number(el.dataset.value),
        requestId: crypto.randomUUID(),
      });
      break;
    case "play":
      if (!canPlay()) {
        notify(state.selection?.message || "先选择可以出的牌");
        return;
      }
      await run("game/action", {
        type: "play",
        cards: [...state.selected],
        requestId: crypto.randomUUID(),
      });
      break;
    case "pass":
      await run("game/action", {
        type: "pass",
        requestId: crypto.randomUUID(),
      });
      break;
    case "auto":
      await run("game/action", {
        type: "auto",
        requestId: crypto.randomUUID(),
      });
      break;
    case "clear":
      state.selected.clear();
      selectionChanged();
      break;
    case "hint":
      if (!state.hints.length) {
        const r = await run("game/hint");
        if (!r) return;
        state.hints = r.hints || [];
        state.hintIndex = 0;
      }
      if (!state.hints.length) {
        notify("没有能压过的牌，可以选择不出");
        break;
      }
      state.selected = new Set(
        state.hints[state.hintIndex++ % state.hints.length],
      );
      selectionChanged();
      break;
    case "leave":
      confirmLeave();
      break;
    case "reconnect":
      await run("game/state");
      break;
    case "boss":
      toggleBoss();
      break;
    case "appearance":
      showModal("选择皮肤", appearancePanel(), closeModal);
      break;
    case "settings":
      showModal(
        "个人设置",
        `<label>昵称<input name="name" value="${esc(state.profile.name)}" maxlength="24" required></label><label class="switch-setting"><span><strong>游戏音效</strong><small>发牌、炸弹和胜负提示；默认静音</small></span><input type="checkbox" name="sound" ${state.profile.sound ? "checked" : ""}></label><label class="switch-setting"><span><strong>背景音乐</strong><small>午后牌局 · 原创钢琴与贝斯循环</small></span><input type="checkbox" name="music" ${state.profile.music ? "checked" : ""}></label><label class="music-volume"><span>音乐音量</span><input type="range" name="musicVolume" min="0" max="100" value="${state.profile.musicVolume ?? 28}" aria-label="背景音乐音量"><output>${state.profile.musicVolume ?? 28}%</output></label><div class="effects-setting">${button("预览游戏特效", "preview-effects", "outline")}<small>动画预览不会改变牌局</small></div><div class="modal-actions"><button type="submit" class="button primary">保存</button></div>`,
        async (data) => {
          configureAudio({
            ...state.profile,
            sound: data.sound === "on",
            music: data.music === "on",
            musicVolume: Number(data.musicVolume),
          });
          unlockAudio();
          const r = await run("profile/update", {
            name: data.name,
            sound: data.sound === "on",
            music: data.music === "on",
            musicVolume: Number(data.musicVolume),
          });
          if (r) {
            closeModal();
            notify("设置已保存");
          } else configureAudio(state.profile);
        },
      );
      break;
    case "music": {
      const music = !state.profile.music;
      configureAudio({ ...state.profile, music });
      void unlockAudio();
      const r = await run("profile/update", { music });
      if (r) notify(music ? "背景音乐已开启 · 午后牌局" : "背景音乐已关闭");
      else configureAudio(state.profile);
      break;
    }
    case "sound": {
      const enabled = !state.profile.sound;
      configureAudio({ ...state.profile, sound: enabled });
      unlockAudio();
      const r = await run("profile/update", { sound: enabled });
      if (r) notify(enabled ? "游戏音效已开启" : "游戏音效已关闭");
      else configureAudio(state.profile);
      break;
    }
    case "preview-effects":
      closeModal();
      previewEffects();
      break;
    case "copy-address": {
      try {
        await navigator.clipboard.writeText(el.dataset.address);
        notify("房间地址已复制");
      } catch {
        const input = el.parentElement.querySelector("input");
        input?.focus();
        input?.select();
        notify("已选中地址，按 Ctrl/Cmd + C 复制");
      }
      break;
    }
    case "bottom": {
      const v = state.view;
      if (v?.bottom.length)
        showModal(
          `本局底牌 · ${v.bottomCount} 张`,
          `<p class="muted">底牌已交给地主，所有玩家均可查看。</p><div class="bottom-detail">${v.bottom.map((c) => card(c)).join("")}</div><div class="modal-actions"><button class="button primary" type="submit">知道了</button></div>`,
          closeModal,
        );
      break;
    }
    case "rules": {
      const n = state.view?.room.capacity || state.capacity;
      showModal(
        `${n} 人斗地主 · 固定玩法`,
        `<div class="rules-deck"><strong>${n === 3 ? "54" : "108"}</strong><div>${n === 3 ? "一副扑克牌" : "两副扑克牌"}<span>每人 ${n === 3 ? "17" : "25"} 张 · 底牌 ${n === 3 ? "3" : "8"} 张</span></div></div><div class="rules-list"><p><b>如何获胜</b>地主先出完获胜；任一农民先出完，农民共同获胜。</p><p><b>叫地主</b>不叫或叫 1 / 2 / 3 分，叫分必须递增，3 分直接成为地主。</p><p><b>支持牌型</b>单张、对子、三张、三带二、顺子、连对、飞机、飞机带对${n === 3 ? "，以及三带一、飞机带单、四带二、四带两对。" : "。四人局不使用三带一、飞机带单和四带二。"}</p><p><b>炸弹与王炸</b>${n === 3 ? "4 张同点数为炸弹；一大王加一小王为王炸。" : "4～8 张同点数为炸弹，张数优先；两大王加两小王为四王天炸。"}</p><p><b>顺子限制</b>顺子、连对和飞机主体都不能包含 2 或王。</p><p><b>积分与托管</b>底分 10 豆，乘以叫分，炸弹和春天翻倍；每回合 45 秒，超时由电脑托管。</p></div><p class="rules-note">四人规则有地区差异，本插件采用以上固定版本。</p><div class="modal-actions"><button class="button primary" type="submit">知道了</button></div>`,
        closeModal,
      );
      break;
    }
  }
}

function toggleCard(el, shift = false) {
  if (state.busy || state.view?.phase !== "playing") return;
  const id = Number(el.dataset.card),
    hand = state.view.hand;
  if (shift && state.anchor != null) {
    const a = hand.findIndex((c) => c.id === state.anchor),
      b = hand.findIndex((c) => c.id === id);
    if (a >= 0 && b >= 0)
      hand
        .slice(Math.min(a, b), Math.max(a, b) + 1)
        .forEach((c) => state.selected.add(c.id));
  } else if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  state.anchor = id;
  selectionChanged();
}
document.addEventListener("click", async (e) => {
  unlockAudio();
  const card = e.target.closest("[data-card]");
  if (card) {
    if (Date.now() < (state.suppressClick || 0)) return;
    toggleCard(card, e.shiftKey);
    return;
  }
  const el = e.target.closest("[data-action]");
  if (el && !el.disabled) {
    e.preventDefault();
    await handle(el.dataset.action, el);
  }
});
document.addEventListener("dblclick", (e) => {
  const el = e.target.closest("[data-card]");
  if (!el || state.busy || state.view?.phase !== "playing") return;
  state.view.hand
    .filter((c) => c.rank === Number(el.dataset.rank))
    .forEach((c) => state.selected.add(c.id));
  selectionChanged();
});
document.addEventListener("pointerdown", (e) => {
  const el = e.target.closest("[data-card]");
  if (
    !el ||
    el.disabled ||
    e.pointerType === "touch" ||
    e.button !== 0 ||
    e.shiftKey
  )
    return;
  const elements = [...document.querySelectorAll(".hand-card")],
    index = elements.indexOf(el);
  state.drag = {
    id: e.pointerId,
    start: index,
    x: e.clientX,
    y: e.clientY,
    base: new Set(state.selected),
    select: !state.selected.has(Number(el.dataset.card)),
    slots: elements.map((el) => ({
      id: Number(el.dataset.card),
      x: el.getBoundingClientRect().left,
    })),
    moved: false,
  };
});
document.addEventListener("pointermove", (e) => {
  const d = state.drag;
  if (!d || d.id !== e.pointerId) return;
  if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
  d.moved = true;
  e.preventDefault();
  let end = d.slots.findLastIndex((c) => e.clientX >= c.x);
  end = Math.max(0, end);
  state.selected = new Set(d.base);
  for (let i = Math.min(d.start, end); i <= Math.max(d.start, end); i++) {
    const id = d.slots[i].id;
    if (d.select) state.selected.add(id);
    else state.selected.delete(id);
  }
  state.selection = null;
  syncSelectionUI();
});
function endDrag() {
  if (state.drag?.moved) {
    state.suppressClick = Date.now() + 250;
    selectionChanged();
  }
  state.drag = null;
}
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);
window.addEventListener("blur", endDrag);
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "b") {
    e.preventDefault();
    toggleBoss();
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    if (state.boss) toggleBoss();
    else if (document.querySelector("#modal-root").children.length)
      closeModal();
    else {
      state.selected.clear();
      selectionChanged();
    }
    return;
  }
  const modal = document.querySelector('[role="dialog"]');
  if (modal) {
    if (e.key === "Tab") {
      const items = [...modal.querySelectorAll("input,button,a[href]")].filter(
        (el) => !el.disabled,
      );
      const first = items[0],
        last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    return;
  }
  if (
    e.target.closest("input,textarea,select,a,[contenteditable]") ||
    state.busy ||
    state.boss
  )
    return;
  // Enter plays a selected hand; other buttons keep native keyboard activation.
  if (e.target.closest(".hand-card") && e.key === "Enter" && canPlay()) {
    e.preventDefault();
    handle("play", {});
    return;
  }
  if (e.target.closest("button")) return;
  if (
    state.view?.phase === "playing" &&
    state.view.current === state.view.seat &&
    !state.view.players[state.view.seat].auto
  ) {
    if (e.key === " ") {
      e.preventDefault();
      handle("hint", {});
    }
    if (e.key === "Enter" && canPlay()) {
      e.preventDefault();
      handle("play", {});
    }
  }
});
document.addEventListener("input", (event) => {
  if (event.target.matches('input[name="musicVolume"]'))
    event.target.nextElementSibling.textContent = `${event.target.value}%`;
});
async function boot() {
  try {
    await loadAppearance();
    absorb(await rpc("profile/get"));
    absorb(await rpc("game/state"), true);
    render();
  } catch (e) {
    app.innerHTML = `<main class="startup-error"><h1>DouDB 暂时未连接</h1><p>${esc(messageFor(e))}</p><button class="button primary" id="retry-boot">重试</button></main>`;
    document.querySelector("#retry-boot").onclick = boot;
  }
}
setInterval(async () => {
  if (
    !state.view ||
    state.busy ||
    state.polling ||
    state.drag ||
    Date.now() < state.nextPoll
  )
    return;
  const epoch = state.epoch,
    room = state.view.room.id;
  state.polling = true;
  try {
    const result = await rpc("game/state");
    if (epoch !== state.epoch || state.view?.room.id !== room) return;
    const changed =
      !result.view ||
      result.view.version !== state.view.version ||
      result.view.roundId !== state.view.roundId;
    const hadError = !!state.error;
    absorb(result, true);
    state.error = "";
    state.failures = 0;
    if (changed || hadError) render();
  } catch (e) {
    if (epoch !== state.epoch || state.view?.room.id !== room) return;
    const message = messageFor(e);
    state.failures++;
    state.nextPoll =
      Date.now() + Math.min(10000, 1000 * 2 ** Math.min(state.failures, 4));
    if (state.error !== message) {
      state.error = message;
      render();
    }
  } finally {
    state.polling = false;
  }
}, 650);
setInterval(updateCountdown, 250);
boot();
