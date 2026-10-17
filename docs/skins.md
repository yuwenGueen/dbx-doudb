# 皮肤与特效维护

皮肤、牌面和动效已经从牌局规则中分开。新增外观不需要修改 Go 规则引擎或 `app.js` 的选项列表。

## 文件分工

| 文件                   | 负责内容                                                 |
| ---------------------- | -------------------------------------------------------- |
| `ui/skins/catalog.js`  | 可选界面主题、牌面皮肤、展示名称、预览色和资源地址       |
| `ui/skins/themes/*.js` | 整体颜色、字体、牌桌造型、装饰以及特效配色               |
| `ui/skins/cards/*.js`  | 牌面、牌背、图案和标记；可独立搭配主题                   |
| `ui/appearance.js`     | 校验清单、按需加载皮肤模块、注入 CSS、缺失皮肤回退与缓存 |
| `ui/effects.js`        | 发牌和公开出牌事件驱动的动效、SVG 图形与音效触发         |
| `ui/effects.css`       | 炸弹、王炸、飞机、身份登场、春天和结算的动画样式         |
| `ui/audio.js`          | 原创背景音乐编排、音色合成、独立混音与静音生命周期       |
| `ui/table-layout.css`  | 按玩家座位布局出牌、长牌型换行、窄窗口适配               |
| `ui/viewport.css`    | 宿主宽高、自适应大厅、固定手牌区和局部滚动，所有主题共用 |
| `ui/style.css`         | 通用布局、交互状态、身份标识和响应式适配                 |

DBX 沙箱禁止 `fetch` 和外链样式表。本项目通过允许的包内 ES 模块加载清单与皮肤，再将 CSS 注入 `<style>`，无需添加 `host.network` 权限。`catalog.js` 默认导出一个配置对象；每个皮肤模块默认导出 CSS 字符串。

## 新增界面主题

1. 复制一个相近主题，如 `themes/database.js` 到 `themes/ocean.js`。
2. 将选择器中的 `body[data-theme="database"]` 改成 `body[data-theme="ocean"]`，再调整颜色、字体或桌面样式。模块默认导出 `String.raw` 包裹的 CSS 字符串；图片等配套文件可放在同目录，并用 `new URL("./texture.svg", import.meta.url).href` 插入 CSS 中，确保内联后路径仍正确。
3. 在清单模块的 `themes` 数组中增加条目：

```json
{
  "id": "ocean",
  "name": "深海牌桌",
  "description": "深蓝桌面与暖金牌边。",
  "module": "themes/ocean.js",
  "defaultCard": "database",
  "flavor": "poker",
  "eyebrow": "DOUDB · 深海牌桌",
  "tableLabel": "DouDB 斗地主",
  "preview": { "surface": "#142e46", "accent": "#efcc91" }
}
```

刷新预览即可在“皮肤”面板中看到新主题。列表由清单生成，支持超过两个主题；顶部保留前两个主题的快捷入口。`flavor` 为 `database` 时显示数据库电脑牌友，`poker` 时显示普通电脑牌友。

## 新增牌面皮肤

复制 `cards/classic.js` 或 `cards/database.js`，将选择器中的 `data-skin` 改为新的 ID，再登记到清单的 `cards` 数组：

```json
{
  "id": "ocean-cards",
  "name": "深海蓝金",
  "description": "深蓝纹理与金色徽章。",
  "module": "cards/ocean.js",
  "preview": { "surface": "#142e46", "accent": "#efcc91" }
}
```

选择主题时切换至该主题的 `defaultCard`；随后可以单独选择其他牌面。切换只保存外观偏好，不改变手牌、阵营、牌局或已选牌。

## 大小王牌面

`ui/skins/cards/joker.js` 单独维护竖排 JOKER 与原创小丑 SVG，手牌、出牌、底牌共用，隐藏文字仍提供“大王 / 小王”无障碍名称。牌面皮肤用 `.joker-big` / `.joker-small` 的 `color`、`--joker-main`、`--joker-light` 修改红金与黑灰配色；字号和缩略牌布局在 `style.css` 中维护。避免将 Joker 缩写为单个 J，叠牌时要保留完整竖排标记。

## 调整特效

通用特效跟随后端公开事件序列触发。同一事件只播放一次；轮询错过一个中间状态也能拿到近期事件，避免只靠比较最终桌面漏播炸弹。切到老板键或后台时停止展示，恢复后不补播整局。

主题可以覆盖这些变量：

```css
body[data-theme="ocean"] {
  --fx-primary: #efcc91;
  --fx-secondary: #72b4df;
  --fx-text: #fff4dc;
}
```

若需替换某个动画或图形，可在主题 CSS 中用 `body[data-theme="ocean"] .fx-bomb` 等选择器覆盖。通用动画只改 `effects.css`；所有皮肤共用的图形改 `effects.js`，音色和背景音乐改 `audio.js`。素材随 `ui/` 一起打包，不需要外部 CDN。

设置里提供“预览游戏特效”，不会改动牌局或积分。音乐和音效默认关闭，可分别开启；音乐音量默认 28%，偏好由插件后端保存。系统启用减少动态效果时改用静态提示。

## 约定

- ID 采用小写字母开头，后续为小写字母、数字或短横线，最多 48 个字符；重命名展示名称时保留 ID。
- 模块地址必须位于 `ui/skins/` 内。预览颜色用六位十六进制色值。
- 主题选择器必须带 `body[data-theme="自己的 ID"]`；牌面选择器必须带 `body[data-skin="自己的 ID"]`，避免已加载资源互相覆盖。
- 地主保持皇冠与“地主”文字，农民保持麦穗与“农民”文字；外观变化不要削弱阵营辨识度。
- 新文件会被现有 `ui` 打包规则自动收录。发布前刷新预览并检查宽屏、窄窗口、完整 33 张手牌和特效不挡按钮。

## 面板布局约定

不要在主题里固定页面高度或用 `zoom` 缩放整个游戏。大厅标题和说明使用 `--lobby-title-size` / `--lobby-description-size`，尺寸由 `viewport.css` 按面板高度控制。主题保留颜色、字体、桌面形状；可操作区域的高度和滚动归公共布局管理。
