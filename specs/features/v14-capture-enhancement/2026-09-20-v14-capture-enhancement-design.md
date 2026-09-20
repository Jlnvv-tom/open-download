# v1.4 捕获增强开发计划

- 日期：2026-09-20
- 状态：待开发
- 上游计划：[RoadMap.md](../../../RoadMap.md)（v1.4 章节，任务编号 V14-xx 与本文档一致）
- 前置：v1.3 体验补课已实现（popup 容器事件委托、增量渲染、`DOWNLOAD_STATUS_CHANGED` 广播、状态局部更新等基础可直接复用）
- 分析依据：[竞品对比分析与迭代路线图](../../analysis/competitive-analysis-roadmap/2026-09-19-competitive-analysis-and-roadmap.md)

## 1. 概述

### 1.1 背景

v1.2 竞品分析确认的最大差距（G1）：Open Download 只靠 `webRequest` 被动监听捕获，缓存命中等不发网络请求的资源会漏捕，达不到竞品「看到的都能下」的用户预期；此外视频只有 URL 记录（无时长/封面/尺寸），类型标签有名无实。v1.4 的目标就是补齐这两块，并给捕获加上站点粒度控制。

现状要点（v1.3 实现后的代码）：

1. content script（`src/content/index.js`，98 行）只收集 `<img>` 的尺寸/alt 并通过 `CONTENT_IMAGES_UPDATE` 回填**已存在**的记录（`store.updateImageDetailsByUrl`，`src/lib/store.js:305`），**不会把 DOM 中 webRequest 漏捕的资源入库**。
2. content script 没有任何 `chrome.runtime.onMessage` 监听（无法被反向控制），这是自动滚动（V14-03）的前置缺口。
3. 捕获链路只有全局开关 `settings.enabled`（`src/background/index.js:57`），没有站点粒度。
4. media 记录的 `duration` 字段从未赋值；popup 视频无时长角标、无缩略图。

### 1.2 目标

- 页面上看得到的图片/视频（即使缓存命中未发网络请求）都能进列表（V14-01）。
- 视频条目有时长、封面与尺寸，卡片视图显示时长角标（V14-04）。
- 站点级「暂停/恢复捕获」，右键菜单与 Popup 均可操作（V14-02）。
- 用户显式触发的自动滚动，配合 DOM 兜底抓长列表页（V14-03）。
- 列表视图按来源页面分组折叠（V14-05）。

### 1.3 非目标

- 不抓 CSS `background-image`、`srcset` 多分辨率候选、`<canvas>`/`<picture>`（有真实反馈后再评估）。
- 不做 iframe 内扫描（保持仅主框架，与现状一致）。
- 不做「仅允许以下站点」的 allowlist 模式 UI（数据模型保留 `allow` 值供未来扩展，本期 UI 只暴露暂停/恢复）。
- 不在 Options 页管理站点规则（Popup 按当前站点操作即可）。
- 卡片视图不做分组（仅列表视图，见 V14-05 边界）。
- 不做 m3u8/HLS 下载（v1.6 立项评估）。

## 2. 任务总览与实现顺序

| 顺序 | 任务 | 优先级 | 预估 | 依赖 | 一句话说明 |
|:---:|------|:---:|:---:|------|-----------|
| 1 | V14-01 DOM 扫描兜底捕获 | P0 | 1.5d | 无 | content script 扫描结果入库，记录标注 `source` |
| 2 | V14-04 视频信息补齐 | P1 | 0.5d | V14-01 | 采集 video duration/poster/尺寸并回填，UI 时长角标 |
| 3 | V14-02 站点级监听开关 | P0 | 1d | 无 | `siteRules` + 双链路生效 + 右键菜单 + Popup 站点行 |
| 4 | V14-03 自动滚动抓取 | P1 | 0.5d | V14-01 | content script 滚动控制器 + Popup 触发按钮 |
| 5 | V14-05 按页面分组 | P2 | 1d | V14-01 | 列表视图按 tabUrl 分组折叠 |

合计约 4.5 人日 + 测试与手动验证缓冲，与 RoadMap 的「3-4 周业余投入」一致。V14-02 与 V14-01 相互独立可并行；V14-03/04/05 都建立在 V14-01 的 DOM 媒体通路上。

## 3. 用户场景

**场景 1：缓存图也能捕获**
**Given** 监听已开启，用户刷新一个图片已进浏览器缓存的页面
**When** 页面渲染完成
**Then** content script 扫描到的图片 URL 即便没有对应的网络请求，也出现在 Popup 列表中，记录来源标注为 DOM。

**场景 2：视频有时长与封面**
**Given** 页面内有一个带 poster 且元数据已加载的 `<video>`
**When** 打开 Popup 切到视频 Tab
**Then** 该条目显示时长角标（如 `03:24`）、列表 meta 中有尺寸；卡片视图封面来自 poster。

**场景 3：暂停当前站点**
**Given** 监听全局开启，用户正在 example.com 浏览
**When** 用户在 Popup 中点击「暂停此站点」（或在页面右键菜单选择暂停）
**Then** 此后 example.com 的网络请求与 DOM 资源都不再入列表；其他站点不受影响；站点行显示「已暂停」。

**场景 4：长列表页滚动抓取**
**Given** 一个信息流长列表页，图片随滚动懒加载
**When** 用户点击 Popup 的「滚动抓取」按钮
**Then** 页面自动向下滚动直至底部（或用户再点停止/超时 60s），期间新增图片均实时入列表，按钮恢复原状。

**场景 5：按页面分组查看**
**Given** 已在多个标签页捕获过资源
**When** 用户开启「按页面分组」
**Then** 列表按来源页面折叠分组，组头显示页面标题/域名与条目数，可展开收起；全选仍作用于当前筛选结果。

## 4. 功能需求与实现方案

### FR-1（V14-01）DOM 扫描兜底捕获

**需求**：content script 把页面中 webRequest 漏捕的图片/视频入库，与网络捕获统一去重；记录标注来源。

**消息通道**：以 `DOM_MEDIA_UPDATE` **取代** `CONTENT_IMAGES_UPDATE`（发送方只有 content script、消费方只有 background，两处都在仓库内，直接替换并同步删除旧类型）。payload：

```js
{
  pageUrl: location.href,          // 来源页
  pageDomain: location.hostname,   // 站点规则判定用
  images: [{ url, previewUrl, width, height, alt, complete }],
  videos: [{ url, poster, width, height, duration }],
}
```

**content script 改造**（`src/content/index.js`）：

1. `collectImageElements()` 扩展为 `collectMediaElements()`：图片沿用现有逻辑；新增 `document.querySelectorAll('video')` 收集 `currentSrc || src`、`poster`、`videoWidth/videoHeight`、`duration`（仅 `Number.isFinite(d) && d > 0` 时带上）。`blob:` 与 `data:` URL 一律跳过（不可重复下载/体积不可控）。
2. `sendImageUpdate()` → `sendMediaUpdate()`，消息类型改为 `DOM_MEDIA_UPDATE`，同时携带 images 与 videos 两个数组。
3. MutationObserver 的命中判定扩展到 `<video>`/`<source>` 节点（当前只查 `IMG`）。

**store 改造**（`src/lib/store.js`）：

1. `findMediaByUrl(url)`：按 `urlDedupeKey` 返回第一条匹配记录（`updateImageDetailsByUrl` 已有同款匹配逻辑，抽公共谓词 `_matchesUrl(img, key)`）。
2. `_normalizeImage` / `addMedia` 增加字段 `source: image.source || 'network'`——**老数据经 normalize 自动补 `network`，无迁移**。
3. `updateImageDetailsByUrl` 可更新白名单从 `{width, height, alt, previewUrl}` 扩为 `{width, height, alt, previewUrl, duration}`（duration 仅 `> 0` 且原值为 0 时写入，避免覆盖已有值）。

**background 改造**（`src/background/index.js`）：

`CONTENT_IMAGES_UPDATE` 分支替换为 `DOM_MEDIA_UPDATE`，处理流程 `handleDomMediaUpdate(payload)`：

1. `store.init()` → 读 settings。
2. **生效判定**（与 webRequest 链路共用，V14-02 落地后接入）：`settings.enabled` 为假 → 直接返回；站点规则拦截 → 返回。
3. 逐条处理 images + videos（videos 归一为统一 media 候选，poster 映射 previewUrl）：
   - 跳过 `blob:`/`data:`；`detectMediaType({ url })` 判不出类型的跳过（DOM 无响应头，MIME 不可知，仅扩展名/元素类型可靠）；
   - 捕获期过滤沿用：`filters.mediaTypes` / `filters.domains` / `filters.extensions`（**大小过滤不适用**——无 Content-Length，跳过）；
   - 先 `store.updateImageDetailsByUrl(url, details)` 富化已有记录；`updated === 0` 且 `!store.findMediaByUrl(url)` 时 `store.addMedia({ ...candidate, source: 'dom' })`；
   - 新增成功则按现有约定广播 `MEDIA_FOUND`（popup 增量插入已就绪）。
4. 汇总后有富化更新（updated > 0）时广播一次 `MEDIA_DETAILS_UPDATED`（整列表快照，保持现有节流约定）。

**popup**：无需新逻辑（`MEDIA_FOUND` 增量插入、`MEDIA_DETAILS_UPDATED` 全量刷新在 v1.3 已实现）。来源筛选见第 5 节说明。

**验收**：禁用网络（DevTools Offline + 缓存可用）刷新页面，列表仍能捕获可见图片；`npm test` 新增用例全绿。

### FR-2（V14-04）视频信息补齐

**需求**：视频条目具备时长、封面与尺寸。

**方案**：

1. 采集端：V14-01 的 `videos` 数组已含 `poster/videoWidth/videoHeight/duration`，本任务消费它。
2. background：新增记录时带入 `duration/poster`（poster 映射到 `previewUrl`，无 poster 则用视频 URL）；富化路径白名单已含 duration，poster 映射 previewUrl 同理（原值为空才写）。
3. popup（`src/popup/popup.js`）：
   - 新增 `formatDuration(seconds)` → `'mm:ss'` / `'h:mm:ss'`，`duration <= 0` 返回空；
   - 列表模板 `listItemTemplate`：meta 区在媒体类型为 video 且有时长时插入 `<span>03:24</span>`；
   - 卡片模板 `cardTemplate`/`renderCardPreview`：preview 右下角叠加时长角标 `<span class="duration-badge">03:24</span>`；
   - `normalizeMedia` 无需改动（duration 随记录透传）。
4. `popup.css`：`.duration-badge`（绝对定位右下角、半透明 `--bg` 底、`--text` 字色、圆角）。

**验收**：手动验证场景 2；无 poster 的视频回退占位图标，不报错。

### FR-3（V14-02）站点级监听开关

**需求**：按域名暂停/恢复捕获；右键菜单与 Popup 两个入口；网络与 DOM 两条链路统一生效。

**数据模型**：`DEFAULT_SETTINGS.siteRules = {}`——`{ [domain]: 'block' | 'allow' }`，**缺省（无键）= 跟随全局**。数据模型保留 `allow` 供未来 allowlist 扩展，本期 UI 不产生该值。

**生效语义**（两条链路共用判定函数）：

```js
// background 内新增纯函数（导出供单测）
function isCaptureAllowed(settings, domain) {
  if (!settings.enabled) return false;               // 全局开关优先，站点规则不能反向打开
  if (!domain) return true;                          // 无站点上下文（如 tabId -1 的请求）跟随全局
  return settings.siteRules?.[domain] !== 'block';
}
```

**存储合并**：`saveSettings` 对 `siteRules` 做**整表替换**（不做键级深合并）——popup 始终从 `GET_SETTINGS` 读取完整表、本地修改后整体发回；「恢复跟随」= 从表中删除该键。options 页本期不写 siteRules，无冲突面。

**background 改造**：

1. `onRequestCompleted`（`src/background/index.js:49`）：在拿到 tab 信息（`:114` 的 `chrome.tabs.get`）后、`store.addMedia` 前插入 `isCaptureAllowed(settings, extractDomain(tabUrl))` 判定；tabId 为 -1 时跳过站点判定（domain 为空，函数放行）。注意现有过滤链在 tab 获取之前，需把顺序整理为：通用过滤 → tab 信息 → 站点判定 → addMedia。
2. DOM 链路（FR-1 的 `handleDomMediaUpdate`）：用 `payload.pageDomain` 走同一判定。
3. contextMenus：新增 `contexts: ['page']` 菜单项「Open Download: 暂停/恢复此站点捕获」（`id: 'open-download-site-toggle'`），点击时取 `tab.url` 域名：存在 `block` 键则删除（恢复跟随），否则置 `block`；变更后广播 `SITE_RULES_CHANGED { siteRules }` 让 Popup 刷新。
4. `onInstalled` 中补充该菜单的 create。

**popup 改造**：

1. 初始化时 `chrome.tabs.query({ active: true, currentWindow: true })` 取当前 tab（`<all_urls>` host 权限已允许读 `tab.url`），计算 `currentDomain`；`chrome://` 等内部页/取不到 url 时不显示站点行。
2. 状态区（`#status-indicator` 上方）新增「站点行」：`当前站点 example.com · 跟随全局/已暂停` + 操作按钮：
   - 跟随全局态 → 显示「暂停此站点」；
   - 已暂停态 → 显示「恢复跟随」。
   点击后更新本地 siteRules 表（改键或删键）并 `UPDATE_SETTINGS` 全量发送。
3. 监听 `SITE_RULES_CHANGED`（右键菜单触发时同步刷新站点行）。
4. `popup.css`：`.site-row`（复用 `.status-indicator` 的字号与间距体系）。

**测试注意**：jest.setup.js 的 `chrome.tabs.get` 为固定 mock，需扩展 `chrome.tabs.query`（可配置的 active tab）与 `chrome.tabs.sendMessage` mock，并给 `chrome.contextMenus.onClicked` 增加可触发能力（当前为空注册）。

**验收**：手动验证场景 3；`npm test` 覆盖 `isCaptureAllowed` 三态与两条链路的拦截行为。

### FR-4（V14-03）自动滚动抓取

**需求**：用户显式触发页面自动滚动，配合 DOM 兜底捕获懒加载长列表。

**消息**：新增 `SCROLL_CAPTURE_START` / `SCROLL_CAPTURE_STOP`（popup → background → content）与 `SCROLL_CAPTURE_STATE`（content → 广播，popup 消费）。

**content script**：新增 `chrome.runtime.onMessage` 监听（当前没有，这是本任务的前置改造）：

```js
// 滚动控制器：150ms 步进 600px；连续 3 次触底即认为到底；硬上限 60s
let scrollTimer = null;
function startScrollCapture() { ... }
function stopScrollCapture(reason) { ... }  // 'stopped' | 'bottom' | 'timeout'
```

- START：已在滚动中则幂等返回；开启定时器，每步 `window.scrollBy(0, 600)`，`scrollY + innerHeight >= scrollHeight - 2` 连续 3 次判到底；60s 超时兜底；
- 结束/停止时广播 `SCROLL_CAPTURE_STATE { running: false, reason }`，开始时广播 `{ running: true }`；
- 滚动过程本身不新增采集逻辑——MutationObserver（FR-1 改造后含 video）会自然捕获新插入的节点。

**background**：两个路由 case——popup 无法直接定位 tab，由 background `chrome.tabs.query({ active: true, currentWindow: true })` 后 `chrome.tabs.sendMessage(tabId, ...)`；发送失败（页面无 content script，如 chrome:// 页）时返回 `{ success: false, error: '当前页面不支持滚动抓取' }`。

**popup**：工具栏新增「滚动抓取」按钮（`#btn-scroll`，`btn-icon` 模式，仅 `isListening` 时可用）：未运行 → 发 START 并进入「停止」态；运行中 → 发 STOP；收 `SCROLL_CAPTURE_STATE(running:false)` 后还原按钮。运行中按钮 title「停止抓取」。

**边界**：内滚动容器（body 不滚动）的页面触底判定立即成立——表现为「点了立即结束」，属预期行为，不做容器嗅探；`chrome://` 页点击后 alert 提示。

**验收**：手动验证场景 4。

### FR-5（V14-05）按页面分组

**需求**：列表视图按来源页面分组折叠，多标签页场景可扫读。

**方案**：

1. 数据：`settings.ui.groupByPage`（默认 `false`）持久化；组键 = `media.tabUrl`，空值归入「未知来源」组；组标题 = 组内首条记录的 `tabTitle || extractDomain(tabUrl) || '未知来源'`。
2. popup：
   - 工具栏新增「按页面分组」切换按钮（active 态复用 `btn-icon.active`），切换后 `saveUiSettings()`；
   - 新增 `renderGroupedListView(filtered)`：按组键聚组 → 组间按组内最新 `capturedAt` 倒序 → 每组渲染组头（`div.list-group-header`：标题 + 计数 + 折叠箭头，`data-group` 属性）+ 组内条目（复用 `listItemTemplate`，组内按现有倒序约定）；
   - 折叠状态为内存态 `collapsedGroups = new Set()`（不持久化），组头点击切换组条目容器的 `hidden`；
   - **分组模式下放弃增量插入**：`handleMediaFound` 在 `groupByPage` 开启时直接 `renderMedia()`（组结构变化频繁，增量维护组序不值得）；
   - 事件委托无需改动（`data-id`/`data-action` 仍在条目上，组头走 `data-group` 分支）。
3. 全选/下载选中/ZIP 语义不变：仍作用于当前筛选结果（跨组）。

**边界**：卡片视图保持平铺（不分组）；筛选后为空的组不渲染；「未知来源」组参与全局排序。

**验收**：手动验证场景 5；分组开关状态重启 Popup 后保持。

## 5. 消息类型与数据结构变更汇总

```js
// MESSAGE_TYPES 新增
DOM_MEDIA_UPDATE: 'DOM_MEDIA_UPDATE',         // content → background：DOM 媒体候选
SITE_RULES_CHANGED: 'SITE_RULES_CHANGED',     // background → popup：站点规则变更
SCROLL_CAPTURE_START: 'SCROLL_CAPTURE_START', // popup → background → content
SCROLL_CAPTURE_STOP: 'SCROLL_CAPTURE_STOP',
SCROLL_CAPTURE_STATE: 'SCROLL_CAPTURE_STATE', // content → popup

// MESSAGE_TYPES 删除
CONTENT_IMAGES_UPDATE  // 被 DOM_MEDIA_UPDATE 取代

// DEFAULT_SETTINGS 新增
siteRules: {},                  // { [domain]: 'block' | 'allow' }
ui.groupByPage: false,
ui.sourceFilter: 'all',         // 'all' | 'network' | 'dom'（展示层来源筛选，见下）

// media 记录新增/激活字段
source: 'network' | 'dom',      // 老数据 normalize 为 'network'
duration: number,               // 本期真正开始赋值（视频）
```

来源筛选（全部/网络/DOM）为展示层能力：`getFilteredMedia` 增加 `source` 维度，筛选面板加三态切换并持久化到 `ui.sourceFilter`；实现中发现体积膨胀可降级为非持久化（记入边界）。

## 6. 边界情况

| 场景 | 处理方式 |
|------|---------|
| `blob:`/`data:` URL 的媒体元素 | content script 直接跳过，不入库 |
| DOM 资源与 webRequest 记录同 URL | 只富化（尺寸/时长/poster），不重复入库 |
| DOM 资源 URL 扩展名无法判型 | 跳过（`detectMediaType` 返回空） |
| DOM 捕获时 `settings.enabled` 为假 | 整批丢弃，不判站点规则 |
| 站点规则为 `block` 时的 webRequest 请求 | 不入库、不广播、不触发 autoDownload |
| tabId 为 -1 的请求（预加载等） | 无站点上下文，跟随全局开关 |
| 老数据无 `source` 字段 | `_normalizeImage` 补 `'network'` |
| 老 settings 无 `siteRules`/`ui.groupByPage` | `_mergeSettings` 默认值兜底 |
| 自动滚动页面到底后继续滚 | 连续 3 次触底判定结束，避免无限滚动页永不停止 |
| 自动滚动中标签页被关闭/跳转 | content script 销毁即停止；STATE 广播失败被 `.catch` 吞掉，Popup 以 60s 超时或下次交互校准 |
| content script 未注入（chrome:// 等） | `tabs.sendMessage` 失败 → Popup alert「当前页面不支持」 |
| 内滚动容器页面 | 触底判定立即成立，滚动立即结束（预期行为，不做容器嗅探） |
| 视频无 poster / duration 不可用 | previewUrl 回退视频 URL；不渲染时长角标 |
| 分组模式下新捕获到达 | 直接全量重渲（组序需重排），放弃增量插入 |
| 分组开启时清空列表 | 空态渲染，`collapsedGroups` 清空 |
| Popup 打在无 host 权限的特殊页 | `tabs.query` 拿不到 url → 站点行隐藏 |

## 7. 涉及文件

| 文件 | 变更 |
|------|------|
| `src/lib/constants.js` | +5 消息类型，-1 消息类型；`DEFAULT_SETTINGS` +`siteRules`/`ui.groupByPage`/`ui.sourceFilter` |
| `src/lib/store.js` | +`findMediaByUrl`；`source` 字段；`updateImageDetailsByUrl` 白名单 +duration/poster |
| `src/lib/utils.js` | +`formatDuration`（放 utils 便于单测） |
| `src/background/index.js` | `DOM_MEDIA_UPDATE` 捕获管线；`isCaptureAllowed` 双链路接入；page 右键菜单；滚动消息路由；`SITE_RULES_CHANGED` 广播 |
| `src/content/index.js` | 重写为媒体收集（img+video）；`DOM_MEDIA_UPDATE`；onMessage 监听 + 滚动控制器 |
| `src/popup/popup.js` | 站点行、来源筛选、时长角标、滚动按钮、分组渲染 |
| `src/popup/index.html` | 站点行、`#btn-scroll`、分组切换按钮、筛选面板来源切换 |
| `src/popup/popup.css` | `.site-row`/`.duration-badge`/`.list-group-header` 等 |
| `__tests__/store.test.js` | findMediaByUrl/source/duration 富化/新设置合并 |
| `__tests__/background.test.js` | DOM 捕获（新增+富化+过滤+blob 排除）、站点规则拦截、滚动路由、旧消息删除断言 |
| `__tests__/utils.test.js` | `formatDuration` 用例 |
| `jest.setup.js` | `chrome.tabs.query`、`chrome.tabs.sendMessage`、`contextMenus.onClicked` 可触发 mock |

## 8. 测试计划

沿用 jest.setup.js 的 chrome mock 扩展（tabs.query/sendMessage 可配置返回）：

- **utils**：`formatDuration`（0 / 59 / 61 / 3661 秒，负值返回空）。
- **store**：① `findMediaByUrl` 命中/未命中；② `source` 缺省归一 `network`、DOM 记录保留 `dom`；③ duration/poster 富化（仅原值缺省时写）；④ `siteRules` 整表替换合并；⑤ `ui.groupByPage`/`ui.sourceFilter` 默认值。
- **background**：① `DOM_MEDIA_UPDATE` 新增入库并广播 `MEDIA_FOUND`（source='dom'）；② 已存在 URL 只富化不新增；③ `blob:`/无法判型跳过；④ `enabled=false` 整批丢弃；⑤ 站点 `block` 同时拦截 webRequest 与 DOM 两链路；⑥ `SCROLL_CAPTURE_START/STOP` 路由到当前 tab；⑦ 发送 `CONTENT_IMAGES_UPDATE` 命中未知消息分支。
- content script / popup / offscreen 仍无自动化测试，依赖第 9 节手动验证。

## 9. 交付与手动验证清单

每任务合入前 `npm test` 全绿 + `npm run build` → 重载 `dist/`。v1.4 整体发版前：

1. 场景 1-5 逐一验证（含亮/暗主题下站点行、时长角标、分组头样式）。
2. v1.3 回归：单条下载/取消/重试/lightbox/导出不受影响（消息类型变更新增为主，唯一删除的 `CONTENT_IMAGES_UPDATE` 不在 popup 使用面内）。
3. 捕获准确性抽测：普通图文页、懒加载信息流页、视频站（无扩展名的 blob 视频应不入库）、chrome:// 页（站点行隐藏、滚动按钮提示不支持）。
4. 站点暂停后确认 autoDownload 也随之停用（同一判定函数）。
5. 发版走 `npm run release`（版本升 1.4.0）。
