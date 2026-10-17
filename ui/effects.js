import { activeTheme } from "./appearance.js";
import { playGameSound as playSound, setAudioHidden } from "./audio.js";
const stage = document.querySelector("#game-effects");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let queue = [],
  active = false,
  timer,
  muted = false,
  previewing = false,
  roomID = "",
  seen = 0;
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const roleArt = {
  landlord:
    '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m6 14 9 7 9-15 9 15 9-7-5 24H11Z" fill="currentColor"/><path d="M13 43h22" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="28" r="4" fill="#664416"/></svg>',
  farmer:
    '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 43V8m0 17C11 26 8 18 8 12c9 0 16 5 16 13Zm0 10c13 1 16-7 16-13-9 0-16 5-16 13Zm0-20c7 0 9-6 9-11-6 0-9 4-9 11Z" fill="currentColor" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>',
};
const art = {
  bomb: '<svg viewBox="0 0 160 140" aria-hidden="true"><path d="m96 36 7-14c5-9 18-8 20 0" fill="none" stroke="#ffce74" stroke-width="5"/><path d="m121 19 5-12m2 17 13-4m-14 9 9 8" stroke="#fff1b5" stroke-width="4"/><path d="m84 40 7-14 20 9-8 16" fill="#ffd27e"/><circle cx="73" cy="85" r="43" fill="#291c21" stroke="#ffbb57" stroke-width="6"/><path d="M46 82c0-14 11-26 26-27" fill="none" stroke="#fff0b4" stroke-width="6" stroke-linecap="round"/><path d="m116 72 21-10-8 21 20 6-19 11 9 18-27-3" fill="#ff8c45"/></svg>',
  rocket:
    '<svg viewBox="0 0 160 170" aria-hidden="true"><path class="rocket-flame" d="M63 119q-2 34 17 48 19-19 17-48" fill="#ff9c49"/><path class="rocket-flame" d="M72 122q1 23 8 31 9-12 8-31" fill="#fff3b5"/><path d="m59 88-24 23 2 26 26-12m38-37 24 23-2 26-26-12" fill="#e4ac57"/><path d="M80 7q-40 32-21 114h42Q120 39 80 7" fill="#fff4d3" stroke="#eac16e" stroke-width="4"/><circle cx="80" cy="63" r="16" fill="#245c69" stroke="#d59e43" stroke-width="5"/></svg>',
  plane:
    '<svg viewBox="0 0 180 120" aria-hidden="true"><path d="m15 59 55-11 21-38 19 1-10 37 56 4q27 7 0 14l-56 5 10 37-19 1-21-38-55-11Z" fill="#c8f1ff" stroke="#61b8d8" stroke-width="3"/><path d="m30 58-16-25h15l28 21m-27 7-16 25h15l28-21" fill="#61b8d8"/></svg>',
  spring: roleArt.farmer,
  landlord: roleArt.landlord,
  finished:
    '<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M35 18h50v34c0 24-50 24-50 0Z" fill="#f5cc78"/><path d="M35 26H18v17q0 21 25 21m42-38h17v17q0 21-25 21" fill="none" stroke="#f5cc78" stroke-width="8"/><path d="M60 72v23M38 102h44" stroke="#f5cc78" stroke-width="9" stroke-linecap="round"/><path d="m60 29 5 11 13 1-10 8 3 12-11-7-11 7 3-12-10-8 13-1Z" fill="#9b6b2f"/></svg>',
};
export function positionEffects() {
  const box = (
    document.querySelector(".poker-table") ||
    document.querySelector(".lobby-hero")
  )?.getBoundingClientRect();
  if (box)
    Object.assign(stage.style, {
      top: `${box.top}px`,
      left: `${box.left}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
    });
}
export function silenceEffects(hidden) {
  muted = hidden;
  setAudioHidden(hidden);
  if (hidden) clearEffects();
}
export function clearEffects() {
  previewing = false;
  queue = [];
  clearTimeout(timer);
  active = false;
  stage.innerHTML = "";
}
function next() {
  if (!queue.length && !active) previewing = false;
  if (active || !queue.length || muted || document.hidden) return;
  const effect = queue.shift();
  active = true;
  positionEffects();
  playSound(effect.sound || effect.kind);
  stage.innerHTML = `<div class="fx-scene fx-${effect.kind}"><div class="fx-halo"></div><div class="fx-shockwaves"><i></i><i></i></div><div class="fx-smoke">${Array.from({ length: 5 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div><div class="fx-sparks">${Array.from({ length: 18 }, (_, i) => `<i style="--i:${i};--distance:${115 + (i % 4) * 28}px;--delay:${(i % 5) * 0.025}s"></i>`).join("")}</div><div class="fx-trail"></div><div class="fx-rays">${Array.from({ length: 10 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div><div class="fx-art">${art[effect.kind] || ""}</div><div class="fx-caption"><strong>${escape(effect.title)}</strong><span>${escape(effect.subtitle)}</span></div></div>`;
  document.querySelector("#game-announcer").textContent =
    effect.title + "，" + effect.subtitle;
  timer = setTimeout(
    () => {
      stage.innerHTML = "";
      active = false;
      next();
    },
    reduced.matches ? 1100 : effect.kind === "rocket" ? 1850 : 1600,
  );
}
export function observeEvents(view, previous, profile) {
  const flags = { deal: false, play: false };
  if (!view) {
    clearEffects();
    roomID = "";
    seen = 0;
    return flags;
  }
  const events = view.events || [];
  if (roomID !== view.room.id || !previous) {
    roomID = view.room.id;
    seen = Math.max(0, ...events.map((e) => e.id));
    clearEffects();
    flags.deal = view.phase === "bidding";
    if (flags.deal) playSound("deal");
    return flags;
  }
  const fresh = events.filter((e) => e.id > seen && e.roundId === view.roundId);
  seen = Math.max(seen, ...events.map((e) => e.id));
  if (previous.roundId !== view.roundId) clearEffects();
  for (const e of fresh) {
    if (e.kind === "deal") {
      flags.deal = true;
      playSound("deal");
      continue;
    }
    let kind = e.kind;
    if (["triples", "plane-singles", "plane-pairs"].includes(kind))
      kind = "plane";
    if (
      !["landlord", "bomb", "rocket", "plane", "spring", "finished"].includes(
        kind,
      )
    ) {
      flags.play = true;
      playSound("play");
      continue;
    }
    if (["bomb", "rocket", "plane"].includes(kind)) flags.play = true;
    const p = view.players[e.seat];
    const name =
      e.seat === view.seat
        ? "你"
        : p?.bot && activeTheme(profile)?.flavor !== "database"
          ? ["电脑小明", "电脑小红", "电脑小蓝", "电脑小林"][e.seat % 4]
          : p?.name || "牌友";
    const won = view.deltas?.[view.seat] > 0;
    const effect = { kind, title: e.label, subtitle: name };
    if (kind === "landlord") {
      effect.title = e.seat === view.seat ? "你是地主" : "地主登场";
      effect.subtitle = `${name} · 一主${view.room.capacity === 4 ? "三" : "两"}农，正式开局`;
    }
    if (kind === "bomb" || kind === "rocket")
      effect.subtitle = `${name} 出牌 · 倍率 × 2`;
    if (kind === "plane") effect.title = "飞机";
    if (kind === "spring") effect.subtitle = "一气呵成 · 倍率 × 2";
    if (kind === "finished") {
      effect.title = won ? "胜利！" : "下局再战";
      effect.sound = won ? "finished" : "loss";
      effect.subtitle = `${e.label} · ${won ? "+" : ""}${view.deltas?.[view.seat] || 0} DB 豆`;
    }
    if (!muted && !document.hidden && !previewing) queue.push(effect);
  }
  // Keep a short tail when returning from a slow connection; never replay an entire game.
  if (!previewing && queue.length > 3) queue = queue.slice(-3);
  requestAnimationFrame(next);
  return flags;
}
export function animateCards(flags) {
  if (reduced.matches) return;
  if (flags.deal)
    document.querySelectorAll(".hand-card").forEach((el, i) =>
      el.animate(
        [
          { opacity: 0, transform: "translate(22px,-34px) rotate(4deg)" },
          { opacity: 1, transform: "translate(0,0) rotate(0deg)" },
        ],
        {
          duration: 280,
          delay: Math.min(i * 18, 500),
          fill: "backwards",
          easing: "ease-out",
        },
      ),
    );
  if (flags.play)
    document.querySelector(".current-play .played-cards")?.animate(
      [
        { opacity: 0, transform: "translateY(15px) scale(.9)" },
        { opacity: 1, transform: "translateY(0) scale(1)" },
      ],
      { duration: 230, easing: "ease-out" },
    );
}
window.addEventListener("resize", positionEffects);
window.addEventListener("scroll", positionEffects, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) clearEffects();
});

export function previewEffects() {
  clearEffects();
  previewing = true;
  queue = [
    {
      kind: "landlord",
      title: "地主登场",
      subtitle: "特效预览 · 不影响当前牌局",
    },
    { kind: "bomb", title: "6 张炸弹", subtitle: "特效预览 · 倍率 × 2" },
    { kind: "rocket", title: "王炸", subtitle: "特效预览 · 四王天炸" },
    { kind: "plane", title: "飞机", subtitle: "特效预览 · 连续三张" },
    { kind: "spring", title: "春天", subtitle: "特效预览 · 一气呵成" },
    { kind: "finished", title: "胜利！", subtitle: "特效预览 · 不改变积分" },
  ];
  next();
}
