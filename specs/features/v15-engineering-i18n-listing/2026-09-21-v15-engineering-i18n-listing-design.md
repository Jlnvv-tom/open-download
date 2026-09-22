# v1.5 工程强化 + 国际化 + 上架开发计划

- 日期：2026-09-21
- 状态：已实现（V15-01 / V15-02 / V15-03 / V15-05 / V15-06 完成；V15-04 仓库内准备完成，商店提交与截图待人工执行）
- 上游计划：[RoadMap.md](../../../RoadMap.md)（v1.5 章节，任务编号 V15-xx 与本文档一致）
- 前置：v1.4 捕获增强（至少 V14-01 / V14-02 / V14-04）已完成，详见 1.4 节
- 分析依据：[竞品对比分析与迭代路线图](../../analysis/competitive-analysis-roadmap/2026-09-19-competitive-analysis-and-roadmap.md)

## 1. 概述

### 1.1 背景

v1.2 竞品分析把 v1.5 定位为「工程安全与发行」版本，对应两个差距：

- **G2（大文件不安全）**：ZIP 整包在内存中构建、打包 fetch 不带 Cookie，视频批量打包数百 MB 即失败。
- **G6（国际市场不可见）**：无 i18n、未上架 Chrome Web Store，纹理自然流量为零。

代码层面的现状（按本次写作时的 `src/` 实际状态）：

1. `src/lib/zip.js` 的 `createMediaZip()` 逐个 `fetchFn(media.url)` → `await response.arrayBuffer()` → `chunks.push(localHeader, data)`，全部成员累加在内存里，最后 `new Blob([...chunks, ...centralChunks, end], { type: 'application/zip' })` 一次性成包。全过程峰值内存约为待打包资源总字节数的 2 倍以上（原始 `Uint8Array` + Blob 副本），这是 G2 的直接根因。
2. `createMediaZip()` 的 `fetchFn` 注入点默认 `fetch`，未传任何 init，**不带 Cookie**，登录态 CDN 资源必然打包失败（V15-02 的抓手已天然存在）。
3. `src/background/index.js` 的 `ZIP_BUILD_TIMEOUT = 300000`，超时走 `reject(new Error('ZIP 打包超时'))`，但目前只在**整批结束后**才调用 `store.updateMediaStatus()` 回写状态；打包越久，风险敞口越大，已下载成功的部分也不落库。
4. UI 文案全部硬编码中文：`src/popup/popup.js` 899 行内的统计标签、状态文本、`alert`/`confirm`、`getStatusText()`、`updateCapacityHint()`、`renderEmptyState()`，加上 `src/popup/index.html`、`src/options/index.html`、`src/options/options.js` 的静态文本，以及 `src/background/index.js` 里两个右键菜单的中文标题。`src/manifest.json` 的 `name`/`description` 也是中文，且**没有 `default_locale`**，`src/` 下没有 `_locales`。
5. `src/manifest.json` 的 `version` 为 `1.2.0`，`docs/` 落地页只有 `index.html`、`styles.css`、`favicon.svg` 三个文件，**没有隐私政策页**，商店侧素材需要一并准备。

另外一个容易被忽略的背景：RoadMap 第 8 节把「大文件旁路与 ZIP 并存导致逻辑分叉」列为中风险，并给出「统一走 downloader 边界」的应对。本期的取舍是把这条原则限定在**编排层**（由 background 统一决定策略、统一走 `DownloadManager`），而不是去抽象传输接口——见 1.3 的明确取舍。

### 1.2 目标

- 1GB 量级批量下载不再崩溃、不再 OOM（V15-01）。
- 打包超时与单条失败原因对用户可见，已成功部分不丢（V15-01）。
- 登录态资源在用户明确勾选后可打包（V15-02）。
- Popup / Options / 右键菜单 / 商店文案中英双语，跟随浏览器语言（V15-03）。
- 通过 Chrome Web Store 审核完成上架，权限声明与实际实现严格一致（V15-04）。
- 产出 Firefox 移植的做/不做结论与技术差异清单，不实现（V15-05）。

### 1.3 非目标

- **不做流式 ZIP**：`zip.js` 保持「单 Blob 全内存」结构不变，仅通过分卷把单包体积压到安全线以下。不改写 `createMediaZip()` 的写出模型。
- **不做传输策略抽象**：不引入 `TransferStrategy` 之类的接口层（避免与 V15-01 保守取向冲突，也避免为 v1.6 的 V16-02「视频默认不走 ZIP」提前固化错误抽象）。策略判定是 background 里一个纯函数，未来再抽取成本很低。
- 不做断点续传 / 失败自动重打包（本期只做到「失败可见 + 手工重来」）。
- 不做上传云端、不做云端存储用户捕获数据（RoadMap 第 5 节非目标）。
- 不新增 npm 依赖、不引入框架或打包器（AGENTS.md 硬约束）。
- i18n 只交付 `zh_CN` / `en`，不提供 UI 语言切换入口（跟随 `chrome.i18n` 的浏览器语言选择）。
- Firefox 移植只评估，不产出适配代码。
- m3u8/HLS、DRM、绕过付费墙仍属 RoadMap 第 5 节的非目标，不因本期松动。

### 1.4 前置：v1.4 的完成要求

v1.4 是 v1.5 的事实前置，原因是两处数据依赖：

- V15-01 的阈值判定读 media 记录的 `size`；而 v1.4 的 `handleDomMediaUpdate()` 入库的 DOM 兜底记录 `size` 恒为 `0`（无 Content-Length）。因此「size 缺失如何处理」不是一个可选细节，而是必须先有 DOM 捕获链路才能验证的工程决策（见 FR-1 方案第 2 步与第 6 节边界表）。
- V15-03 的 i18n 文案范围必须覆盖 v1.4 的新 UI（站点行、来源筛选、滚动抓取按钮、分组头、时长相关的提示）。若 v1.4 UI 先写死中文再补 i18n，二次返工成本很高。

因此进入 v1.5 的最低要求是 **V14-01（DOM 兜底捕获）、V14-02（站点级开关）、V14-04（视频信息补齐）三个任务已完成**。V14-03（滚动抓取）与 V14-05（按页面分组）只影响文案清单长度，可与 V15-03 并行收口。

## 2. 任务总览与实现顺序

| 顺序 | 任务 | 优先级 | 预估 | 依赖 | 一句话说明 |
|:---:|------|:---:|:---:|------|-----------|
| 1 | V15-01 大文件旁路与 ZIP 分卷 | P0 | 1.5d | v1.4 V14-01 | `planTransfer()` 判定 ZIP / 直下，直下复用 `DownloadManager`，ZIP 侧按卷切分 |
| 2 | V15-03 i18n 中英双语 | P0 | 1.5d | v1.4 UI 定型 | `_locales` + `src/lib/i18n.js`，popup/options/菜单/文案全量抽离 |
| 3 | V15-04 上架 Chrome Web Store | P0 | 1d | V15-03 | 隐私政策页、权限说明、双语商店文案与素材、`npm run pack` 产物 |
| 4 | V15-02 打包携带 Cookie 可选 | P1 | 0.5d | V15-01 | `sendCookies` 经 `ZIP_BUILD_REQUEST` 透传到 `createMediaZip` |
| 5 | V15-05 Firefox 移植可行性评估 | P2 | 0.5d | 无 | 调研文档，给做/不做结论，不实现 |
| 6 | V15-06 UI 样式与可用性打磨 | P1 | 0.5d | v1.4 UI 定型 | 字体/溢出/焦点/动效/禁用态打磨，先于 V15-04 截图 |

合计约 5 人日 + 测试与手动验证缓冲，与 RoadMap 的「2-3 周业余投入」一致。三条 P0（V15-01 / V15-03 / V15-04）齐即可发版，P1/P2 按 RoadMap 第 8 节的「以 P0 为发布标准」顺延。

V15-02 之所以排在 V15-01 之后，是因为两者都会改 `createMediaZip()` 的 options 与 `ZIP_BUILD_REQUEST` payload，合并到同一条代码路径上改，避免两处互相覆盖。V15-03 与 V15-01 互不依赖，可并行；但它依赖 v1.4 UI 定型，实际排期上建议紧跟 v1.4 收尾。V15-04 依赖 V15-03：商店的 `name`/`description` 与截图文案需要双语版本。

## 3. 用户场景

**场景 1：大文件批量自动改直下（V15-01）**
**Given** 用户在一个视频站已捕获 300 条媒体，其中若干条 `size` 超过 50MB
**When** 用户在 Popup 点击「全部下载」
**Then** background 判定为直下策略，逐条走 `chrome.downloads.download`（复用 `DownloadManager` 并发队列）；条目状态为 pending → downloading → downloaded 逐条流转；浏览器下载托盘可见独立文件；扩展进程不因内存溢出被回收。

**场景 2：中大批图片自动分卷打包（V15-01）**
**Given** 用户选中 150 张图片，预估总量 600MB，但没有任何单文件超过 50MB
**When** 用户点击「下载选中」
**Then** 名单被切成多个卷依次打包下载，落盘为 `open-download-<时间戳>_part1.zip`、`_part2.zip` …；每卷完成后该卷条目的下载状态立即落库，中途失败不影响已完成卷。

**场景 3：打包超时与失败原因可见（V15-01）**
**Given** 一次打包因单文件过大或网络问题超过 300s
**When** 触发 `ZIP_BUILD_TIMEOUT`
**Then** Popup 明确提示打包失败与原因、已成功/失败条数，并列出前若干条失败原因；不再是「点了没反应」或只有一句笼统的失败。

**场景 4：登录态资源打包（V15-02）**
**Given** 用户在 Options 勾选「打包时携带 Cookie」并保存
**When** 用户对一批需要登录态的 CDN 图片执行打包
**Then** offscreen 的 fetch 携带凭据，资源可以打包成功；未勾选时行为与今天完全一致（默认关闭）。

**场景 5：切换浏览器语言（V15-03）**
**Given** 用户将浏览器界面语言切换为 English（或任意非中、英文语言）
**When** 用户打开 Popup / Options / 页面右键菜单
**Then** 所有文案（含统计标签、状态文本、按钮、提示、菜单项）切换为英文（非中英文语言回落到 `default_locale`）；不出现中英混排，也不出现裸露的 i18n key。

**场景 6：商店安装与权限确认（V15-04）**
**Given** 用户在 Chrome Web Store 搜索到本扩展并查看详情页
**When** 用户查看描述、权限说明与隐私政策链接后点击安装
**Then** 安装时的权限提示、商店文案与实际实现一致（webRequest 仅观察、无远程代码、无统计上报、数据仅存本地 `chrome.storage.local`）；隐私政策页可访问且与实际行为相符。

**场景 7：Firefox 移植结论（V15-05）**
**Given** RoadMap 把 Firefox 作为 webRequest 政策收紧时的备份渠道
**When** 完成对 webRequest / offscreen / storage / downloads 差异的调研
**Then** 产出一份调研文档，给出「做/不做」结论、主要阻塞点与预估工作量，供 v1.6 排期决策。

## 4. 功能需求与实现方案

### FR-1（V15-01）大文件旁路与 ZIP 分卷

**需求**：批量下载不再因整包内存构建而失败；超阈值场景自动改逐条直下；未超阈值的中大批 ZIP 按卷切分；打包超时与失败原因可见；已成功部分及时落库。

**方案（保守取向：改编排层，不动 zip.js 结构）**

**1. 阈值常量（放 `DEFAULT_SETTINGS`，便于后续 UI 化）**

`src/lib/constants.js` 中 `DEFAULT_SETTINGS` 新增分组：

```js
transfer: {
  bypassFileSize: 50 * 1024 * 1024,     // 单文件超过此值：整批改直下
  bypassBatchSize: 500 * 1024 * 1024,   // 整批预估超过此值：整批改直下
  unknownVideoSize: 60 * 1024 * 1024,   // size 未知（DOM 源）的视频按此值保守估算（须高于 bypassFileSize）
  maxZipFiles: 200,                     // 单卷最大文件数
  maxZipBytes: 500 * 1024 * 1024,       // 单卷预估字节上限
  maxConcurrencyForLarge: 2,            // 直下大文件时的并发上限
},
```

配套改动：`src/lib/store.js` 的 `_mergeSettings()` 目前只对 `ui` 与 `filters` 做键级深合并，其余顶层键走对象展开。要把 `transfer` 加进 `ui` / `filters` 同构的合并分支，否则 Options 若将来提交部分 `transfer` 字段会整组覆盖（今天 Options 的 `collectSettings()` 不收集 `transfer`，不会被触发，但这是埋雷）。

**2. 策略判定纯函数（导出供单测）**

放在 `src/background/index.js`，保持「编排层做决策」：

```js
function estimateSize(media, limits) {
  const size = Number(media.size) || 0;
  if (size > 0) return size;
  // DOM 兜底捕获（v1.4 V14-01）的记录没有 Content-Length：视频按保守值估算，图片按 0
  return media.mediaType === MEDIA_TYPES.VIDEO ? limits.unknownVideoSize : 0;
}

export function planTransfer(items = [], settings = {}) {
  const limits = { ...DEFAULT_SETTINGS.transfer, ...(settings.transfer || {}) };
  const sizes = items.map(item => estimateSize(item, limits));

  if (sizes.some(size => size > limits.bypassFileSize)) {
    return { strategy: 'direct', reason: 'large-file', volumes: [] };
  }
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total > limits.bypassBatchSize) {
    return { strategy: 'direct', reason: 'large-batch', volumes: [] };
  }
  return { strategy: 'zip', reason: '', volumes: splitVolumes(items, sizes, limits) };
}
```

`splitVolumes()` 按 `maxZipFiles` / `maxZipBytes` 两个条件顺序切分（`||` 触发，先到先用），保持原始顺序返回二维数组。空批与单条都返回「一卷」。

> 为什么「有一条超阈值就整批改直下」而不是混合分发：用户的心理模型是「我点了一次下载」，产物却是「一个 ZIP + N 个散文件」会造成困惑；且混合分发会让失败/成功统计分叉。统一走一种策略，语义最简单（第 6 节边界表已记录）。

**3. 直下通路**

`MESSAGE_TYPES.DOWNLOAD_SELECTED` 在 `src/lib/constants.js` 中的注释今天就写着「批量直下通路，保留给 v1.5 大文件旁路（V15-01）复用」，本任务正式启用它：

- background 的 `DOWNLOAD_SELECTED` case 保持现有形态（`store.getImageById` → `downloader.downloadBatch(images)` → 返回成功/失败数）；
- popup 侧不新增入口，`DOWNLOAD_ZIP` 的编排结果决定实际走哪条路——也就是说 **`DOWNLOAD_SELECTED` 本期作为「显式直下」通路被内部复用，同时为 v1.6 的 V16-02（视频默认不走 ZIP）预留了现成钩子**。落地后把该行注释中「保留给 v1.5」的字样更新为实际语义。

`DownloadManager` 需要一个最小增强：现有 `downloadImage()` 内部调用无参的 `_waitForDownload(downloadId)`，走的是 `waitForDownload(downloadId, 120000)` 的默认 120s 超时。大文件（尤其低速源）很容易超过这个窗口而被误判为失败。

```js
// src/lib/downloader.js 新增
setDownloadTimeout(ms) {
  this.downloadTimeout = Math.max(1000, Number(ms) || 120000);
}

_waitForDownload(downloadId) {
  return waitForDownload(downloadId, this.downloadTimeout);
}
```

直下前由 background 设置为更宽松的值（例如 30 分钟），并在 `finally` 语义上恢复默认；大文件的并发同时压制到 `Math.min(settings.concurrency, limits.maxConcurrencyForLarge)`，避免多 tasks 抢占磁盘 IO 把单条任务拖超时。

**4. ZIP 分卷**

`src/lib/zip.js` 只改一处签名——`makeZipFilename(date, { volume, volumes } = {})`：

- 不传第二参数时输出与今天完全一致：`open-download-20260921-153012.zip`（已有单测要保持不变，这是向后兼容的硬要求）；
- 传参且 `volumes > 1` 时输出 `open-download-20260921-153012_part1.zip`、`_part2.zip` …

`createMediaZip()` 本体不动（仍是一次调用产出一卷）。多卷编排在 background 侧串行执行：对每个卷重复「`ensureOffscreenDocument()` → `waitForOffscreenReady()` → `ZIP_BUILD_REQUEST` → 等 `ZIP_BUILD_RESULT` → `waitForDownload()` → `updateMediaStatus` → `closeOffscreenDocument()`」。注意 `zipBuild` 全局互斥变量的存在决定了**卷必须串行**，串行也符合「同一时刻只有一个 offscreen 打包」的现有约束。

关键改进：**每卷完成后立即回写该卷条目的 `downloaded` / `failed` 状态**（现有逻辑是整批结束才回写）。这样第 N 卷失败时，前 N-1 卷的结果不会丢。

**5. 进度与失败可见**

`ZIP_BUILD_PROGRESS` 的 payload 由 `{ done, total, zipName }` 扩展为 `{ done, total, zipName, volume, volumes }`，offscreen 透传、background 转播到 `ZIP_PROGRESS`、popup 按钮文案相应显示为「打包中 第 2/5 卷 12/200」。

`ZIP_BUILD_RESULT` 的 `failedItems` 现成存在（`[{ id, error }]`），本期把前 5 条失败原因拼进 popup 的失败提示里；超时分支的 `reject` 也补上「已完成卷数/已成功条数」再往上抛。

**验收**：见第 9 节；自动化见第 8 节 `planTransfer` 与 `makeZipFilename` 用例。

### FR-2（V15-02）打包携带 Cookie 可选

**需求**：登录态资源可选携带 Cookie 打包；默认关闭并在设置页说明隐私影响。

**方案**

1. `DEFAULT_SETTINGS` 新增 `sendCookies: false`。
2. Options：在「下载设置」卡片新增一个 checkbox `#send-cookies`，`<small>` 里写清「开启后打包请求会携带该站点的 Cookie，用于抓取需要登录的资源；默认关闭」。`src/options/options.js` 的 `fields` 与 `collectSettings()` 同步补 `sendCookies`（`loadSettings()` 补回填）。
3. background 的 `handleDownloadZip()` 在构造 `ZIP_BUILD_REQUEST` payload 时带上 `sendCookies: Boolean(settings.sendCookies)`。
4. offscreen 的 `buildZip({ zipName, fileNaming, items })` 解构补 `sendCookies`，传给 `createMediaZip()`。
5. `createMediaZip()` 的入参 options 新增 `sendCookies = false`，把默认的 `fetchFn = fetch` 包一层：

```js
const doFetch = sendCookies
  ? (url) => fetch(url, { credentials: 'include' })
  : (url) => fetch(url);
```

保持 `fetchFn` 注入参数不变，单测仍可用假实现。

**验收**：勾选后需登录的 CDN 图能打包成功；不勾选时行为与现状完全一致；设置保存后在 SW 重启后仍生效。

### FR-3（V15-03）i18n 中英双语

**需求**：Popup / Options / 右键菜单 / manifest 文案全部抽离为 `zh_CN` + `en`，跟随浏览器语言；留有低成本扩展第三语言的能力。

**方案**

1. **目录**：新增 `src/_locales/zh_CN/messages.json` 与 `src/_locales/en/messages.json`。按 `chrome.i18n` 标准结构（每个 key 为 `{ "message": "...", "placeholders": {...} }`，带参数的用 `$1` / `$count`）。后续加语言只需新增一个目录，不需要改代码。
2. **manifest**：`src/manifest.json` 加 `"default_locale": "zh_CN"`，并把 `name`、`description` 替换为 `__MSG_extName__` / `__MSG_extDesc__` 形式的 key。其余字段（`version`、`permissions` 等）不动。
3. **轻量 helper**：新增 `src/lib/i18n.js`，只做两件事，无依赖：

```js
export function t(key, ...args) {
  const message = chrome.i18n?.getMessage(key, args) || '';
  // 回落显示 key 自身，便于快速发现漏翻译
  return message || key;
}

export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(node => {
    node.textContent = t(node.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(node => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });
  root.querySelectorAll('[data-i18n-title]').forEach(node => {
    node.title = t(node.dataset.i18nTitle);
  });
}
```

HTML 的 `<title>` 不支持 `__MSG__`（那只作用于 manifest 字段），因此两个页面的标题也在 `applyI18n` 里处理（或单独 key）。

4. **静态文案**：`src/popup/index.html` 与 `src/options/index.html` 的可见文本改为属性化（`data-i18n` / `data-i18n-placeholder` / `data-i18n-title`），页面加载时调用一次 `applyI18n(document)`。注意 `<input>` 的 `placeholder`、`title` 属性与标签文本要走不同属性，不可混用。
   - 实现决定：这两个 HTML 里**不再保留中文兜底文本**，元素内容由 `applyI18n()` 填充。原因是兜底文本会让「无硬编码中文」这条约束无法被自动化校验（见第 8 节）；`chrome.i18n` 在缺失语言时会回落到 `default_locale`，不存在取不到文案的情况。
5. **动态文案**：`src/popup/popup.js` 中的 `getStatusText()`、`getDimensionsText()`（「未知尺寸」）、`renderEmptyState()`、`updateCapacityHint()`、`updateStatusUI()`、媒体 Tab 文案（图片/视频/全部）、`downloadMediaAsZip()` 的成功/失败 `alert`、导出文件名前缀等统一改为 `t()`；`src/lib/utils.js` 的 `formatSize()` 返回的「未知」（`src/lib/utils.js:127`）同样改为 `t()`。`src/options/options.js` 的 toast 与 `confirm` 同理。
   - **列表分隔符也要走 i18n**：中英混排时最容易漏掉的是连接标点。`listComma` / `listSemicolon` 两个 key 承载 `，`/`；`（zh）与 `, `/`; `（en），否则英文界面会出现「1 succeeded，0 failed」。同时「无硬编码中文」的自动化校验必须把 CJK 标点与全角字符一并覆盖，否则这类泄漏测不出来。
6. **右键菜单**：`src/background/index.js` 里 `chrome.contextMenus.create()` 的中文 `title` 改为 `__MSG_menuToggleListening__` / `__MSG_menuClearList__`（MV3 的 service worker 可以直接用 `chrome.i18n`，不必在 JS 里手动 `t()`）。
7. **v1.4 UI 的文案约束（重要，避免返工）**：站点行（当前站点 / 跟随全局 / 已暂停 / 暂停此站点 / 恢复跟随）、来源筛选（全部 / 网络 / DOM）、滚动抓取按钮（滚动抓取 / 停止抓取 / 当前页面不支持滚动抓取）、分组视图（按页面分组 / 未知来源）等 v1.4 新增文案，**在 v1.4 UI 落地时必须直接写 `data-i18n` 或 `t()`，不允许再写死中文**。这些 key 在本文档锁定的 key 清单里已经预留。
8. **构建**：`scripts/build.js` 用 `cp(srcDir, distDir, { recursive: true, filter: 排除 node_modules })` 全量复制 `src/`，`_locales` 会被自动带上，无需改复制逻辑；建议在 `validateDist()` 的 `requiredPaths` 里补 `_locales/<default_locale>/messages.json`，防止漏复制或 `default_locale` 写错 locale 码时静默通过（manifest 声明缺失会导致商店审核或运行时回落到意外语言）。

**验收**：手动验证场景 5；新增自动化用例校验中英 key 集合一致且被引用的 key 都存在。

### FR-4（V15-04）上架 Chrome Web Store

**需求**：通过商店审核完成上架；权限声明与实际实现一致。

**方案**

1. **隐私政策页**：在 `docs/` 下新增页面（复用现有 `styles.css`，**保持无远程资源约束**，由现有 Deploy Docs 工作流一起部署到 GitHub Pages）。内容要点：
   - 不收集、不上传任何用户数据，无统计上报、无远程代码；
   - 捕获到的资源元数据与设置**仅保存在本地 `chrome.storage.local`**，随浏览器数据清理而删除；
   - 不触碰 DRM、不做网课/付费内容的绕过付费墙；下载能力仅作用于用户本机浏览器已能正常访问的资源。
2. **权限使用说明**（中英各一份，需逐条对齐 `src/manifest.json`）：

| 权限 | 实际用途 | 说明要点 |
|------|---------|---------|
| `webRequest` | 读取已完成的请求 | **仅观察**：`chrome.webRequest.onCompleted` + `responseHeaders`，不阻塞、不拦截、不修改请求 |
| `downloads` | 触发下载 | 单次直下与 ZIP 下载 |
| `storage` | 本地持久化 | 仅 `chrome.storage.local` |
| `offscreen` | ZIP 打包 | 仅在用户主动打包时按需创建，下载结束即关闭 |
| `contextMenus` | 右键菜单 | 全局开关与站点开关入口 |
| `<all_urls>` | host 权限 | 全局监听所需；不向任何服务器发送数据 |

3. **商店素材清单**：128 图标（已有 `src/assets/icon-128.png`）、Promo tile 待补、1280×800 或 640×400 截图 2-3 张（建议：Popup 列表视图、卡片视图、设置页）、简短与完整描述的中英两份。
4. **打包与发版**：`manifest.version` 升 `1.5.0`；`npm run pack` 产出 `packages/open-download-1.5.0.zip`（现有 Release 工作流会把它 attach 到 GitHub Release）。提交商店前确认产物内不含 `__tests__/`、`docs/`、`node_modules/`、`.git/` 等无关内容。
5. **一致性自检**（最容易导致审核被拒的点）：商店填写的描述、隐私政策内容、manifest 声明的权限三者必须互相一致；RoadMap 第 8 节已把「权限最小化清单预审」列为风险应对，这里就是执行动作。

**验收**：商店审核通过并可安装；安装弹窗权限与说明表一致；隐私政策链接可访问且与实现相符。

### FR-5（V15-05）Firefox 移植可行性评估

**需求**：产出调研结论，给「做/不做」的建议，不实现。

**方案**：产出一份分析文档（建议落在 `specs/analysis/firefox-port-feasibility/`，与 `specs/README.md` 的分析类归口一致，文件名沿用 `YYYY-MM-DD-<主题>.md` 规范），至少覆盖以下差异：

| 能力 | Chrome MV3 | Firefox MV3 | 影响 |
|------|-----------|-------------|------|
| `chrome.webRequest` 观察 | 支持 | 支持（阻塞式不支持） | 本期仅观察用法，风险低 |
| `chrome.offscreen` | 支持 | **无对应 API** | **主要阻塞点**：ZIP 打包需要一个 replaceable 的宿主 |
| background 形态 | service worker（无 DOM） | Event Page（有 `window`/DOM API） | Firefox 反而可以直接在 background 里构建 Blob，不需要 offscreen |
| `chrome.downloads` | 支持 | 支持，但 `filename` 的路径/分隔符行为存在差异 | 文件名策略需要分支 |
| `chrome.storage.local` | 支持 | 支持 | 无影响 |
| ES modules background | `type: module` service worker | `background.scripts` + `type: module` 支持情况需实测 | 可能影响现有 `import` 结构 |

结论倾向：**建议做，但不排在 v1.5**。唯一实质性阻塞是 offscreen 的替代方案（Firefox 侧可在 background event page 内直接打包），这需要把打包宿主从 background 编排里抽象出来——而这恰恰是 V15-01 明确不做的事（见 1.3）。因此先在 v1.6 单独立项评估，预估额外 1-1.5 人日适配 + CI 侧产出第二份打包产物。

**验收**：文档产出且给出明确结论；本期不产生任何 `src/` 代码改动。

### FR-6（V15-06）UI 样式与可用性打磨

**需求**：弹窗与设置页在亮/暗主题下无溢出与裁剪，交互状态完整，键盘可达。全部为 CSS 层改动，不动 DOM 结构与 JS 行为。

**方案**

1. **字体继承**：`<button>`/`input`/`select`/`textarea` 默认不继承页面字体，两个样式表各补 `font-family: inherit`，消除按钮与周围文本的字形/字重不一致。
2. **列表元信息溢出**：`.image-meta` 增加 `min-width: 0; overflow: hidden`，子 `span` 改 `flex: 0 0 auto` + 省略号，仅首个字段（域名）允许收缩（`flex: 0 1 auto`），保证大小/时长/类型始终完整可见；不换行以维持行高稳定（信息密度优先）。
3. **弹窗总高裁剪**：`.image-list` 的 `min-height` 由 200px 降到 120px 并改 `flex: 1 1 auto`。v1.4 新增的站点行（约 29px）与容量提示会与既有固定高度区块叠加，突破 `.app` 的 `max-height: 600px; overflow: hidden` 后底部状态栏被裁掉。
4. **筛选面板换行**：`.filter-panel` 加 `flex-wrap: wrap`，`.filter-row` 改 `flex: 1 1 120px` 并设 `min-width`，避免 5 行筛选在 480px 宽度下被压到不可用。
5. **键盘可用性**：补 `:focus-visible` 焦点环；搜索框用 `:focus-within` + `box-shadow` 提示聚焦（本身无边框，避免加边框导致布局跳动）；条目内的悬浮操作按钮（移除/下载/取消/重试）在 `:focus-within` 时显现——否则 Tab 聚焦到的按钮 `opacity: 0`，键盘用户完全看不到。
6. **禁用态**：hover 伪类加 `:not(:disabled)` 守卫，并补齐 `.btn-secondary:disabled`，避免禁用按钮仍有悬停反馈。
7. **减少动态效果**：两端各加 `@media (prefers-reduced-motion: reduce)`，把动画/过渡压到 `0.001ms` 并取消卡片位移。
8. **设置页 toast 反色**：由固定深底改为 `background: var(--text); color: var(--bg)`，暗色主题下自动反转为浅底深字。
9. **代码卫生**：合并 `popup.css` 中重复的 `.media-card-check` 规则块（同一选择器写了两遍）。

**验收**：亮/暗主题下弹窗与设置页无内容裁剪；键盘可完整操作（Tab 可见焦点环、条目操作按钮可见）；系统开启「减少动态效果」后无持续动画；`npm test` 与 `npm run build` 不受影响。

## 5. 消息类型与数据结构变更汇总

本期的核心取舍之一：**不新增消息类型**。所有编排都复用现有通路，只在 payload 上做扩展。

```js
// MESSAGE_TYPES：新增 0 个，删除 0 个
// DOWNLOAD_SELECTED：收敛为「显式批量直下入口」，内部复用 handleDownloadZip({ strategy: 'direct' })，
//                    不再单独维护一套直下逻辑；popup 暂未发送该消息，预留给 V16-02（视频默认不走 ZIP）
// DOWNLOAD_ZIP：语义扩展为「批量下载（自动选策略：zip | direct）」
// DOWNLOAD_SELECTED / DOWNLOAD_ZIP 的 payload 均追加可选 strategy?: 'auto' | 'zip' | 'direct'

// 现有消息 payload 的扩展（不新增类型）
ZIP_BUILD_REQUEST: { zipName, fileNaming, items, sendCookies? }   // +sendCookies
ZIP_BUILD_PROGRESS: { done, total, zipName, volume?, volumes? }   // +分卷进度
ZIP_BUILD_RESULT: { ...原字段 }                                    // 结构不变

// DEFAULT_SETTINGS 新增
transfer: {
  bypassFileSize: 50 * 1024 * 1024,
  bypassBatchSize: 500 * 1024 * 1024,
  unknownVideoSize: 60 * 1024 * 1024,
  maxZipFiles: 200,
  maxZipBytes: 500 * 1024 * 1024,
  maxConcurrencyForLarge: 2,
  downloadTimeoutMs: 1800000,   // 直下单文件等待超时（30 分钟），默认 120s 对大文件不够
},
sendCookies: false,     // 打包是否携带 Cookie，默认关闭

// src/manifest.json 新增
default_locale: 'zh_CN',
name: '__MSG_extName__',
description: '__MSG_extDesc__',

// media 记录：本期不新增字段（直下/分卷只影响下载行为，不改数据模型）
// DownloadManager 新增实例字段 downloadTimeout（默认 120000，非持久化）
```

注意 `store.saveSettings()` 的合并语义：`ui` / `filters` 做键级深合并、`siteRules` 做整表替换是现有约定；`transfer` 本期加入 ui/filters 同构的键级合并分支，保持行为一致。

## 6. 边界情况

| 场景 | 处理方式 |
|------|---------|
| DOM 兜底记录 `size` 为 0（无 Content-Length） | 图片按 0 参与估算；视频按 `unknownVideoSize` 保守估算，倾向触发旁路 |
| 单个文件大小恰好等于 `bypassFileSize` | 判定用严格大于，等于阈值仍走 ZIP |
| 批次中只有一条超阈值 | 整批统一走直下（避免一次操作出现 ZIP + 散文件两种产物，见 FR-1 第 2 步） |
| 单卷触发 `maxZipFiles` 与 `maxZipBytes` 两个条件 | 任一先到即切卷，`||` 短路，保持原始顺序 |
| 打包被切成 1 卷 | 文件名不带 `_partN` 后缀，与现有格式完全一致（向后兼容硬要求） |
| 第 N 卷失败 | 前 N-1 卷状态已落库保留；提示失败卷数与原因；不做自动重打包 |
| 触发 `ZIP_BUILD_TIMEOUT`（300s） | 抛出带卷号与资源数的错误，popup 展示；不再静默。**同时关闭 offscreen 文档**：超时时文档内可能仍有进行中的打包，不关闭会让下一轮复用脏文档并泄漏 blobUrl |
| 直下单任务超过 `waitForDownload` 默认 120s | 旁路前通过 `DownloadManager.setDownloadTimeout()` 放宽，避免被误判失败 |
| 直下过程中用户取消 | 复用 `cancelOne` / `cancelAll`，用户取消状态回退 pending、不计入 failed（现有语义，不变更） |
| 大文件并发过高抢占 IO | 直下时并发压制到 `Math.min(settings.concurrency, maxConcurrencyForLarge)` |
| 勾选 Cookie 但目标 CDN 未配置 `Access-Control-Allow-Credentials` | 仍会失败；属站点限制，错误落到该条目的 `failed` 与失败原因列表中 |
| Options 未提交 `transfer` | `_mergeSettings` 键级合并保证缺失字段回落默认值 |
| 浏览器语言为 zh_CN / en 之外的语言 | `chrome.i18n` 自动回落到 `default_locale`（zh_CN） |
| i18n key 缺失或漏翻译 | `t()` 回落返回 key 自身，肉眼可辨；新增自动化用例比对中英 key 集合，CI 拦截 |
| `default_locale` 写错或 `_locales` 未复制 | 建议在 `scripts/build.js` 的 `validateDist()` 增加 `_locales/<default_locale>/messages.json` 校验 |
| v1.4 UI 文案后补 | v1.4 UI 落地时必须直接写 `data-i18n` / `t()`，禁止写死中文（FR-3 第 7 步） |
| `chrome://` 等无 content script 页面 | 与打包无关，不在本期范围内变化 |
| Firefox 评估结论 | 只产出文档，不改 `src/` |

## 7. 涉及文件

| 文件 | 变更 |
|------|------|
| `src/lib/constants.js` | `DEFAULT_SETTINGS` +`transfer` 分组、+`sendCookies`；`DOWNLOAD_SELECTED` 注释更新 |
| `src/lib/store.js` | `_mergeSettings()` 补 `transfer` 键级合并（与 `ui`/`filters` 同构） |
| `src/lib/downloader.js` | `DownloadManager` +`setDownloadTimeout()`；`_waitForDownload()` 透传超时 |
| `src/lib/utils.js` | `formatSize()` 的「未知」文案改 `t()` |
| `src/lib/zip.js` | `makeZipFilename(date, { volume, volumes })` 分卷命名（不传参向后兼容）；`createMediaZip()` +`sendCookies` 选项 |
| `src/lib/i18n.js` | **新增**：`t()` 与 `applyI18n()` |
| `src/_locales/zh_CN/messages.json` | **新增**：中英 key 清单本体（中文） |
| `src/_locales/en/messages.json` | **新增**：同上（英文） |
| `src/offscreen/offscreen.js` | `buildZip()` 透传 `sendCookies`；进度广播补 `volume`/`volumes` |
| `src/background/index.js` | +`planTransfer()` / `estimateSize()` / `splitVolumes()`；`DOWNLOAD_ZIP` 改为策略编排（含多卷串行与分卷状态落库）；启用 `DOWNLOAD_SELECTED` 直下；右键菜单 title 改 `__MSG_*__` |
| `src/popup/popup.js` | 下载编排的结果提示（失败原因前若干条）；`ZIP_PROGRESS` 文案支持卷进度；全量文案改 `t()` |
| `src/popup/index.html` | 静态文案属性化（`data-i18n` / `data-i18n-placeholder` / `data-i18n-title`） |
| `src/popup/popup.css` | 站点行/时长角标/分组头/来源筛选样式；V15-06 的字体继承、溢出保护、焦点环、禁用态、动效降级、重复规则合并 |
| `src/options/options.css` | V15-06 的字体继承、焦点环、禁用态、动效降级、toast 反色 |
| `src/options/options.js` | +`sendCookies` 字段读写；toast/confirm 文案改 `t()` |
| `src/options/index.html` | 新增 `#send-cookies` checkbox 与隐私说明；静态文案属性化 |
| `src/manifest.json` | +`default_locale`；`name`/`description` 改 `__MSG_*__`；`version` 升 `1.5.0` |
| `docs/`（隐私政策页） | **新增**：离线可用、无远程资源的中英隐私政策页 |
| `scripts/build.js` | `validateDist()` 建议补 `default_locale` 对应 messages.json 校验 |
| `jest.setup.js` | +`chrome.i18n.getMessage` mock |
| `__tests__/background.test.js` | `planTransfer()` 各分支；直下路由；分卷串行；失败详情 |
| `__tests__/zip.test.js` | `makeZipFilename()` 分卷命名与向后兼容 |
| `__tests__/store.test.js` | `transfer` 默认值兜底与键级合并；`sendCookies` 默认 false |
| `__tests__/downloader.test.js` | `setDownloadTimeout()` 透传行为 |
| `__tests__/i18n.test.js` | **新增**：中英 key 集合一致；源码引用的 key 均存在 |
| `specs/analysis/firefox-port-feasibility/` | **新增**：V15-05 调研产出 |
| `RoadMap.md` | v1.5 章节勾选与链接维护；第 6 节技术债表中「`DOWNLOAD_SELECTED` 死代码，归入 V13-03 清理」一条需同步更新为「V15-01 启用为直下通路」 |

## 8. 测试计划

沿用现有 Jest + `jest.setup.js` 的 chrome mock（`testEnvironment: node`，覆盖率目前只统计 `src/lib/**`）：

- **zip**：`makeZipFilename()` ① 不传第二参数时输出与原格式完全一致；② `volumes === 1` 时不加后缀；③ `volumes > 1` 时输出 `_part1` / `_part2`；④ `createMediaZip()` 在 `sendCookies: true` 时注入的 `fetchFn` 收到 `credentials` 为 `include`（用伪 `fetchFn` 断言 init）。
- **background / transfer**：新用例建议集中在 `__tests__/background.test.js` 或独立的 `__tests__/transfer.test.js`：① 单文件超阈值 → `direct`；② 整包预估超阈值 → `direct`；③ `size` 未知的视频 → 按 `unknownVideoSize` 估算并触发 `direct`；④ `size` 未知的图片按 0 计，不触发；⑤ 阈值相等不触发；⑥ `volumes` 被 `maxZipFiles` 与 `maxZipBytes` 分别切开的两种情况；⑦ `DOWNLOAD_ZIP` 在 direct 策略下调用 `downloadBatch`；⑧ `ZIP_BUILD_REQUEST` 携带 `sendCookies`。
- **store**：① 老 settings 无 `transfer` / `sendCookies` 时落到默认值；② `saveSettings({ transfer: { maxZipFiles: 10 } })` 后其余 `transfer` 字段不被清空；③ `sendCookies` 默认 `false`。
- **downloader**：`setDownloadTimeout()` 后 `_waitForDownload()` 使用新超时（可用 fake timers 对一小一大两个超时值分别断言其行为）。
- **i18n**：`__tests__/i18n.test.js` 用 `node:fs` 读取两个 `messages.json` 后 `JSON.parse`（注意 jest 的 `moduleFileExtensions` 只有 `js`，不能直接 `import` JSON），断言：① 中英 key 集合完全一致；② 遍历 `src/popup`、`src/options`、`src/background`、`src/manifest.json` 中被 `t()` / `data-i18n` / `__MSG_*__` 引用的 key 在两份文件里都存在；③ 各占位符在双语里数量一致；④ manifest 声明 `default_locale` 且 `name`/`description` 使用 `__MSG_*__`；⑤ popup/options 的 HTML 与 JS 在剥离注释后不含中文（强制新文案必须走 i18n）。实现补充：`jest.setup.js` 的 `chrome.i18n.getMessage` mock 直接读取真实的 `zh_CN/messages.json` 并做 `$1` 替换，使其余用例断言的是实际中文文案而非 key。
- **jest.setup.js**：补 `chrome.i18n.getMessage(key, args)` mock（返回空串或 key 自身），否则引入 `t()` 后所有涉及 popup/background 的用例会因 `chrome.i18n` 未定义而报错。
- popup / content / offscreen 仍无自动化测试（既有技术债），依赖第 9 节手动验证。

## 9. 交付与手动验证清单

每任务合入前 `npm test` 全绿 + `npm run build` → 重载 `dist/`。v1.5 整体发版前：

1. 场景 1-7 逐一验证，其中：
   - **场景 1/2**：准备一批含 50MB 以上单文件的媒体与一批 150+ 张图的媒体，分别验证「自动改直下」与「自动分卷」；在普通内存机器上观察不再 OOM（可用 `chrome://extensions` 的 service worker 是否被回收作为佐证）。
   - **场景 3**：用超慢源或临时把阈值/超时调小的方式触发打包超时，确认错误信息、已完成进度与失败原因可见。
   - **场景 4**：找一个需 Cookie 的图片资源（自行搭建或用已有登录态站点，注意合规），勾选前后各测一次。
   - **场景 5**：把浏览器语言切到 English、再切到第三种语言（如 日本語），检查 Popup / Options / 右键菜单无中英混排、无裸露 key。
2. v1.3 / v1.4 回归：单条下载、取消、重试、lightbox、导出列表、站点暂停、滚动抓取、分组视图、来源筛选均不受影响（本期不改 UI 结构，风险集中在 i18n 与下载编排两处）。
3. 打包产物检查：`npm run pack` 后用 `unzip -l` 确认包内无 `__tests__/` / `docs/` / `node_modules/`，且 `_locales` 已包含。
4. i18n 抽取完整性抽测：全局 grep `src/popup`、`src/options` 内剩余的中文字符串常量，确认只剩注释。
5. UI 打磨验证（V15-06）：亮/暗两套主题下分别打开弹窗与设置页，确认无内容被裁剪、列表 meta 不溢出；键盘 Tab 能完整走完列表条目并看到焦点环与操作按钮；打开系统「减少动态效果」后监听状态点不再脉冲。
6. 上架前一致性核对：manifest 权限清单 = 商店权限说明 = 隐私政策描述（三项逐条比对）。
7. 发版走 `npm run release`（版本升 `1.5.0`），随后提交 Chrome Web Store 审核。
