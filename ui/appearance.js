import catalog from "./skins/catalog.js";
// Skins are local resources registered in one catalog. No rule or gameplay code
// needs to know how many skins exist or which identifiers they use.
const base = new URL("./skins/", import.meta.url);
export const appearance = { themes: [], cards: [] };
const loaded = new Map();
const safeID = /^[a-z][a-z0-9-]{0,47}$/;
function validate(entries, kind) {
  if (!Array.isArray(entries) || !entries.length)
    throw new Error(`皮肤清单缺少 ${kind}`);
  const ids = new Set();
  return entries.map((entry) => {
    if (
      !safeID.test(entry.id) ||
      ids.has(entry.id) ||
      typeof entry.name !== "string"
    )
      throw new Error("皮肤清单的名称或 ID 无效");
    ids.add(entry.id);
    const url = new URL(entry.module, base);
    if (
      !url.href.startsWith(base.href) ||
      !url.pathname.endsWith(".js") ||
      url.search ||
      url.hash
    )
      throw new Error("皮肤模块必须位于 skins 目录");
    const preview = entry.preview || {};
    for (const value of [preview.surface, preview.accent])
      if (!/^#[a-f0-9]{6}$/i.test(value))
        throw new Error("皮肤预览色需要使用六位十六进制颜色");
    return { ...entry, url: url.href };
  });
}
export async function loadAppearance() {
  if (catalog.version !== 1) throw new Error("不支持此皮肤清单版本");
  appearance.themes = validate(catalog.themes, "界面主题");
  appearance.cards = validate(catalog.cards, "牌面皮肤");
  for (const theme of appearance.themes)
    if (!appearance.cards.some((card) => card.id === theme.defaultCard))
      throw new Error("主题默认牌面未登记");
}
export function activeTheme(profile) {
  return (
    appearance.themes.find((t) => t.id === profile?.theme) ||
    appearance.themes[0]
  );
}
function ensureStylesheet(entry) {
  if (loaded.has(entry.url)) return loaded.get(entry.url);
  let timeout;
  const module = Promise.race([
    import(entry.url),
    new Promise((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error(`皮肤“${entry.name}”加载超时，请重试`)),
        6000,
      );
    }),
  ])
    .then((module) => {
      if (typeof module.default !== "string")
        throw new Error(`皮肤“${entry.name}”未提供 CSS`);
      const style = document.createElement("style");
      style.dataset.skinResource = entry.id;
      style.textContent = module.default;
      document.head.append(style);
    })
    .catch((error) => {
      loaded.delete(entry.url);
      throw error;
    })
    .finally(() => clearTimeout(timeout));
  loaded.set(entry.url, module);
  return module;
}
export async function prepareAppearance(profile) {
  if (!profile) return;
  const theme = activeTheme(profile),
    card =
      appearance.cards.find((c) => c.id === profile.skin) ||
      appearance.cards.find((c) => c.id === theme.defaultCard);
  if (!theme || !card) throw new Error("皮肤清单尚未加载");
  await Promise.all([ensureStylesheet(theme), ensureStylesheet(card)]);
  profile.theme = theme.id;
  profile.skin = card.id;
}
