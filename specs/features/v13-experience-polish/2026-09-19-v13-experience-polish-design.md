# v1.3 体验补课开发计划

- 日期：2026-09-19
- 状态：待开发
- 上游计划：[RoadMap.md](../../../RoadMap.md)（v1.3 章节，任务编号 V13-xx 与本文档一致）
- 分析依据：[竞品对比分析与迭代路线图](../../analysis/competitive-analysis-roadmap/2026-09-19-competitive-analysis-and-roadmap.md)、v1.2.0 代码走查（本文所有 `文件:行号` 均以该版本代码为准）

## 1. 概述

### 1.1 背景

v1.3 的目标是「把竞品标配补齐，消除高频误伤」。本文件是它的开发计划：把 RoadMap 中的 7 项任务（V13-01~07）落到具体实现方案，并补充一项走查发现的前置重构（V13-00）。

走查确认了几个决定方案形态的事实：

1. `urlDedupeKey` 是**运行时计算、不落盘**（仅在 `src/lib/store.js:184`、`src/lib/store.js:303` 调用时对 `img.url` 现算），改函数即全局一致，存量数据无需迁移。
2. `downloader.downloadImage()`（`src/lib/downloader.js:93`）是完整的单条下载模板（状态机迁移 + 命名 + `chrome.downloads.download` + `waitForDownload` + 状态写回），生产上已用于 autoDownload（`src/background/index.js:122`）——单条下载不需要新写下载逻辑。
3. downloader 的 `progress/complete/error` 事件**零订阅方**（`background` 从未注册 `downloader.on`），下载状态变化不会推给 popup——重试/取消的状态回传必须补这条广播链。
4. popup 每次广播都整列表 `innerHTML` 重建 + 逐项重绑事件（`MEDIA_FOUND` 处理在 `src/popup/popup.js:222`，`bindMediaItemEvents` 在 `:546`）——v1.3 新增的按钮内联状态会被重渲冲掉，必须先做事件委托与增量更新。

### 1.2 目标

- 签名 URL / 带参数 CDN 图不再被误去重（V13-01）。
- 任意条目可单条下载、失败可重试、下载中可真正取消（V13-02/03）。
- 缩略图可放大预览（lightbox）（V13-04）。
- 命名策略按媒体类型区分，扩展名兜底不再一律 `.jpg`（V13-05）。
- 容量上限从静默截断变为用户可见（V13-06）。
- 搜索/筛选真防抖；导出「所见即所导」（V13-07）。

### 1.3 非目标

- 不做字节级存储配额检测（RoadMap 观察项）。
- 不给 popup/options 补 UI 自动化测试（本期维持 `src/lib` + background 的测试边界，UI 靠手动验证清单）。
- 不引入 `DOWNLOAD_SELECTED` 批量直下路径到 UI（ZIP 仍是批量主路径；该分支保留给 v1.5 大文件旁路复用）。
- 不做 i18n（v1.5 / V15-03）。

## 2. 任务总览与实现顺序

| 顺序 | 任务 | 优先级 | 预估 | 依赖 | 一句话说明 |
|:---:|------|:---:|:---:|------|-----------|
| 1 | V13-00 前置重构 | P0 | 0.5d | 无 | popup 容器事件委托 + `MEDIA_FOUND` 增量插入 |
| 2 | V13-01 去重修复 | P0 | 0.5d | 无 | `urlDedupeKey` 纳入排序后的 query |
| 3 | V13-02 单条下载 | P0 | 1d | V13-00 | `DOWNLOAD_ONE` 消息 + 下载状态广播 + popup 按钮 |
| 4 | V13-03 重试+取消+清理 | P0 | 1.5d | V13-02 | 真取消、失败重试、删除死代码 |
| 5 | V13-05 命名修正 | P1 | 0.5d | 无 | sequential 前缀分类型 + MIME 兜底扩展名 |
| 6 | V13-06 容量提示 | P1 | 0.5d | 无 | 截断计数 + popup 提示条 |
| 7 | V13-04 lightbox | P1 | 1d | V13-00 | popup 内大图/视频预览层 |
| 8 | V13-07 防抖+导出 | P2 | 0.5d | V13-00 | 统一 debounce + 本地导出当前筛选 |

合计约 6 人日 + 测试与手动验证缓冲，与 RoadMap 的「2-3 周业余投入」一致。V13-01/05/06 相互独立，可与 V13-02/03 并行穿插。

## 3. 用户场景

**场景 1：签名图不再消失**
**Given** 监听已开启，`dedupe` 为默认开启，页面加载了 `https://cdn.example.com/a.jpg?sign=abc` 与 `https://cdn.example.com/a.jpg?sign=def` 两张不同签名图
**When** 用户打开 Popup
**Then** 列表中出现 2 条独立记录（v1.2 中只有 1 条）。

**场景 2：单条下载**
**Given** Popup 列表中有一条 `pending` 状态的图片
**When** 用户点击该条目的下载按钮
**Then** 按钮变为「下载中…」且不可再点，状态徽章迁移为 `downloading` → `downloaded`，统计条「已下载」+1；无需选中、无需 ZIP。

**场景 3：失败重试**
**Given** 某条目下载失败（status `failed`）
**When** 用户点击该条目的重试按钮
**Then** 该条目重新走下载流程；悬停重试按钮可见失败原因 tooltip。

**场景 4：真正取消**
**Given** 某条目正在下载（`downloading`）
**When** 用户点击该条目的取消按钮
**Then** 浏览器中该下载任务被 `chrome.downloads.cancel` 终止，条目状态回到 `pending`，统计条「失败」**不**增加。

**场景 5：放大预览**
**Given** Popup 列表展示若干图片/视频
**When** 用户点击缩略图
**Then** Popup 内弹出预览层显示大图（视频内联播放），Esc 关闭、←/→ 在当前筛选结果内翻页；点击条目其余区域仍保持原选中行为。

**场景 6：容量可见**
**Given** 捕获列表已达 4500 条以上（上限 5000）
**When** 用户打开 Popup
**Then** 顶部出现「接近捕获上限」提示；发生截断后提示中包含「已累计移除 N 条」。

## 4. 功能需求与实现方案

### FR-0（V13-00）popup 渲染与事件前置重构

**需求**：为 v1.3 新增的按钮/预览层提供不被全量重渲冲掉的状态承载。

**现状**：

- 渲染：`loadMedia()`（`popup.js:241`）全量拉取 → `getFilteredMedia()`（`:307`）内存过滤 → `renderMedia()`（`:361`）整容器 innerHTML 重建；列表/卡片模板 `renderListView`（`:415`）/ `renderCardView`（`:448`）。
- 事件：渲染后逐项 `bindMediaItemEvents()`（`:546`）addEventListener；`data-action` 已有 `select`/`remove` 两类。
- 广播：`MEDIA_FOUND`（`:222`）push 后 `renderMedia()` 全量重渲；`MEDIA_DETAILS_UPDATED`（`:227`）整体替换后重渲。

**方案**：

1. **容器事件委托**：在 `#image-list` 上注册单个 `click` 监听（`init()` 的 `bindEvents` 阶段），处理函数用 `e.target.closest('[data-action]')` 分流。本期 action 集合：`select`、`remove`（现有）+ `download`、`cancel`、`open`（后续 FR 引入）。删除 `bindMediaItemEvents` 及逐项绑定。
2. **`MEDIA_FOUND` 增量插入**：现有渲染约定是 `[...mediaItems].reverse()`（最新在后显示在前），增量路径为：新记录 push 进 `allMedia` 后，`#image-list` 头部 `insertAdjacentHTML` 插入单个条目模板（列表/卡片两套模板抽成 `listItemTemplate(media)` / `cardTemplate(media)` 纯函数，供全量渲染与增量插入共用），并更新 Tab 计数与统计条，不重建既有 DOM。
3. **lightbox/重渲互斥**：预览层打开期间（FR-4 的 `lightboxOpen` 标志），`MEDIA_FOUND` 只更新数据不插 DOM，`MEDIA_DETAILS_UPDATED` 直接跳过重渲，预览关闭时统一 `loadMedia()` 校准一次。

**约束**：两套模板函数继续使用 `escapeHtml`（`popup.js:634`）；缩略图 eager/lazy 属性由 `getPreviewLoadingAttrs`（`:540`）决定，增量插入的条目恒用 lazy。

**验收**：

- 列表渲染后 `#image-list` 上无逐项 listener（DevTools 验证或代码评审）。
- 捕获新资源时既有条目 DOM 不重建（缩略图不重新请求，`loading=eager` 前 36 张不闪）。
- 点击条目选中、移除按钮行为与 v1.2 一致（回归）。

### FR-1（V13-01）去重 key 修复

**需求**：`https://cdn.example.com/a.jpg?sign=abc` 与 `?sign=def` 不再被判为同一资源。

**现状**：`src/lib/utils.js:189-197`：

```js
export function urlDedupeKey(url) {
  try {
    const u = new URL(url);
    // 去除 hash，保留 pathname + 部分查询参数
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}
```

调用方：`store.js:184`（addMedia 去重，重复返回 `null`）、`store.js:303,307`（`updateImageDetailsByUrl` 匹配）；测试 `__tests__/utils.test.js:197-208`（4 例）、`__tests__/store.test.js:120-135`（「同 URL 加 query 返回 null」用例）。

**方案**：

```js
export function urlDedupeKey(url) {
  try {
    const u = new URL(url);
    u.searchParams.sort(); // 参数顺序不同视为同 key
    return `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
```

- hash 仍丢弃；无 query 时不含 `?`。
- **兼容性**：key 运行时现算、不落盘，新老数据天然一致，无需迁移。行为变化即修复目标：过去被合并的签名 URL 变体，此后捕获会作为新记录入库（已入库的旧记录不拆分）。
- **Tradeoff（接受并记录）**：cache-buster 类参数（`?t=`、`?v=`）会造成同图多条。忽略参数列表做成设置项属于过度设计，留待有真实反馈后再评估（记入 RoadMap 观察项）。

**测试**：改写 `utils.test.js` 的 4 个用例（query 保留、排序归一、hash 丢弃、非法 URL 原样返回）；改写 `store.test.js:120-135` 为「带不同 query 可入库、完全同 URL 仍去重」双断言。

**验收**：`npm test` 全绿；手动验证场景 1。

### FR-2（V13-02）单条直接下载

**需求**：列表/卡片条目可单独下载，无需进入 ZIP 流程。

**现状**：`downloader.downloadImage(image)`（`downloader.js:93-125`）已覆盖全流程；background 无单条消息（`DOWNLOAD_SELECTED`/`DOWNLOAD_ALL` 分支在 `background:333-353` 但 popup 从未发送）；downloader 事件零订阅。

**方案**：

1. **constants.js**：`MESSAGE_TYPES` 新增 `DOWNLOAD_ONE: 'DOWNLOAD_ONE'`、`DOWNLOAD_STATUS_CHANGED: 'DOWNLOAD_STATUS_CHANGED'`（遵循 AGENTS.md：先加常量再接线）。
2. **background**（`handleRuntimeMessage` 新分支）：

   ```js
   case MESSAGE_TYPES.DOWNLOAD_ONE: {
     const image = store.getImageById(payload.id);
     if (!image) return { success: false, error: 'media not found' };
     const result = await downloader.downloadImage(image);
     return { success: result.success, error: result.error };
   }
   ```

   不走 `DOWNLOAD_SELECTED`（`downloadBatch` 有每任务 300ms sleep 与 worker 池开销，单条场景不需要）。同时在模块顶层注册：

   ```js
   downloader.on((event, data) => {
     const status = { progress: 'downloading', complete: 'downloaded', error: 'failed', cancelled: 'pending' }[event];
     if (!status) return;
     chrome.runtime.sendMessage({ type: MESSAGE_TYPES.DOWNLOAD_STATUS_CHANGED,
       payload: { id: data.imageId, status, error: data.error } }).catch(() => {});
   });
   ```

   顶层注册与 `webRequest` 监听器同一策略（SW 每次启动即挂载），`.catch(() => {})` 容忍 popup 未打开。
3. **popup**：
   - 列表模板：`.image-status` 徽章旁新增 `<button class="image-download" data-action="download" data-id="…">`（SVG 图标同 `.image-remove` 风格）；`status === 'failed'` 时该按钮渲染为 `.image-retry`（同 `data-action="download"`，视觉走 `--danger`）。
   - 卡片模板：preview 右上角悬浮同款按钮。
   - 委托分支 `data-action === 'download'` → `sendMessage(DOWNLOAD_ONE, { id })`；点击后按钮置 `disabled` 文案「下载中…」。
   - `DOWNLOAD_STATUS_CHANGED` 监听：按 `data-id` 局部更新该条徽章 class（复用 `.image-status.<status>`，`popup.css:488-514`）与按钮态；`downloaded/failed` 时同步统计条（重拉 `GET_STATUS`）。

**验收**：手动验证场景 2；下载中关闭 Popup 再打开，状态与统计正确（store 已写回）。

### FR-3（V13-03）失败重试 + 真正取消 + 死代码清理

**需求**：failed 可重试（含失败原因）；downloading 可取消且浏览器任务同步终止；清理无人使用的路径。

**现状**：`cancelAll()`（`downloader.js:182-187`）只清空 `this.queue` 并 emit；`this.queue` 全仓库无 enqueue/消费（死代码，`:51`/`:185`）；`waitForDownload`（`:13-37`）对 `interrupted` 固定 reject「下载中断」，不读 `delta.error`；`DOWNLOAD_ALL` 分支（`background:344`）无调用方。

**方案**：

1. **downloader**：
   - 构造器：新增 `this.activeDownloads = new Map()`（imageId → downloadId）与 `this.cancelRequested = false`；**删除 `this.queue`**。
   - `downloadImage`：拿到 `downloadId` 后 `this.activeDownloads.set(image.id, downloadId)`，`finally` 中 delete。
   - `waitForDownload`：`interrupted` 时读取 `delta.error?.current`；模块级维护 `cancelledIds: Set`，`chrome.downloads.cancel` 前先登记 downloadId；reject 时携带 `{ cancelled: boolean, error }`。
   - `downloadImage` catch：`cancelled` 为真 → `updateImageStatus(id, 'pending')`（复用现有防重复累计，`store.js:285-296` 保证 stats 不动）+ `_emit('cancelled', { imageId })`；否则维持现有 failed 路径。
   - 新增 `cancelOne(imageId)`：查 `activeDownloads` → 登记 cancelledIds → `chrome.downloads.cancel(downloadId)`（任务已完成时调用抛错，吞掉即可）。
   - 重写 `cancelAll()`：遍历 `activeDownloads` 逐条取消 + `cancelRequested = true`；`downloadBatch` 的 worker 循环每轮检查 `cancelRequested` 提前退出，batch 收尾复位。`'cancelled'` 事件保留。
2. **store**：`updateMediaStatus(id, status, errorMsg = '')`（`store.js:282`）增加第三参：`img.errorMsg = errorMsg`（成功/取消时清空为 `''`）。记录新增 `errorMsg` 字段，老数据为 `undefined`，显示层兜底。
3. **background**：`MESSAGE_TYPES` 新增 `CANCEL_DOWNLOAD: 'CANCEL_DOWNLOAD'`；分支：`payload.id` 有值 → `downloader.cancelOne(id)`，否则 `downloader.cancelAll()`。**删除 `DOWNLOAD_ALL` 分支与 constants 中对应类型**（grep 确认无调用方）；**`DOWNLOAD_SELECTED` 保留**并加注释：v1.5 大文件旁路（V15-01）复用的批量直下通路。
4. **popup**：`downloading` 条目显示取消按钮（`data-action="cancel"` → `CANCEL_DOWNLOAD { id }`）；failed 条目的重试按钮 `title` 属性显示 `errorMsg`；两者状态刷新均走 `DOWNLOAD_STATUS_CHANGED`（`cancelled` → pending）。

**验收**：手动验证场景 3、4；`npm test` 新增用例全绿（见第 7 节）。

### FR-4（V13-04）lightbox 大图/视频预览

**需求**：点击缩略图在 Popup 内放大预览，支持键盘操作；不引入远程资源。

**现状**：popup 无任何 overlay/modal 元素（`index.html` 全量核查）；`body` 固定 `width:480px`（`popup.css:48`），`.app` `max-height:600px`（`:56`）；options 页的 `#toast` 模式不可复用。

**方案**：

1. **DOM**（`index.html`，`.app` 之后）：

   ```html
   <div id="lightbox" hidden>
     <div id="lightbox-stage"><!-- 动态注入 img / video --></div>
     <div id="lightbox-caption"><!-- 文件名 · 域名 · 大小 · n/N --></div>
     <button id="lightbox-close" class="lightbox-btn">…svg…</button>
     <button id="lightbox-prev" class="lightbox-btn">…svg…</button>
     <button id="lightbox-next" class="lightbox-btn">…svg…</button>
   </div>
   ```

2. **行为**：
   - 打开：以打开瞬间的 `getFilteredMedia()` **快照**（倒序后顺序）为导航序列；图片注入 `<img referrerpolicy="no-referrer">`（onerror 占位），视频注入 `<video controls preload="metadata">`；关闭/切换时移除 `src`（及时释放）。
   - 键盘：`Esc` 关闭、`←`/`→` 翻页；到头时对应按钮 `disabled`，不循环。
   - 触发：FR-0 委托分支 `data-action="open"`——缩略图/卡片预览元素自身携带 `data-action="open"`，点击命中即打开；命中其余区域走 `select` 分支，原选中行为不变。
   - 打开期间：`body.lightbox-open` 锁滚动；`lightboxOpen = true` 联动 FR-0 的重渲互斥。
3. **样式**（`popup.css` 新增独立 section，类名前缀 `lightbox-`）：`position:fixed; inset:0; z-index` 置顶，背景 `--bg` 高透明度叠加；图片 `max-width/max-height:100%; object-fit:contain`；按钮复用图标按钮模式（透明无边框，hover `--border`）。颜色全部走现有 token（含 `@media (prefers-color-scheme: dark)` 自适应）。

**约束说明**：Chrome popup 视口固定约 480×600，lightbox 是「popup 内铺满的遮罩层」，不是浏览器级全屏——这是平台约束，不视为缺陷。

**验收**：手动验证场景 5；暗色/亮色两套系统主题下检查对比度；视频能内联播放、图片加载失败显示占位。

### FR-5（V13-05）命名策略修正

**需求**：sequential 前缀按媒体类型区分；无扩展名时从 MIME 推断，而不是一律 `.jpg`。

**现状**：`generateFilename(url, namingStrategy, index, domain)`（`utils.js:167-182`）：sequential 恒 `img_`（`:177`）；兜底链 `getExtension(originalName) || '.jpg'`（`:169-171`）；`index` 仅来自 `downloadBatch` 下标，autoDownload/单条恒 0。

**方案**：

1. 签名追加可选参：`generateFilename(url, namingStrategy, index, domain, { mediaType = 'image', mimeType = '' } = {})`。
   - sequential：前缀 `mediaType === MEDIA_TYPES.VIDEO ? 'video_' : 'img_'`。
   - 扩展名兜底链：`getExtension(originalName) || extensionFromMimeType(mimeType) || (mediaType === 'video' ? '.mp4' : '.jpg')`。
   - baseName 兜底：`mediaType === 'video' ? 'video' : 'image'`。
2. 调用方同步：
   - `downloader.js:97`：传 `{ mediaType: image.mediaType, mimeType: image.mimeType }`。
   - `zip.js`（`createMediaZip` 内部逐条命名处，`zip.js:113-189`）：传 item 的 `mediaType/mimeType`；ZIP 内重名自动序号逻辑不变。
3. `index` 语义不变（批次内序号）；单条下载恒 0 属可接受行为，持久计数器不在本期（记入边界情况）。

**测试**：utils 命名用例按新签名重写（video 前缀、MIME 兜底、类型化默认扩展）；downloader sequential 用例（`downloader.test.js:150-158` 断言 filename 的方式）扩展视频断言；zip 用例补充混合类型命名。

**验收**：视频条目 sequential 下载文件名为 `video_0000.mp4` 形态；无扩展名 GIF MIME 条目兜底为 `.gif`。

### FR-6（V13-06）容量上限可视化

**需求**：5000 条截断从静默变为可见、可预期。

**现状**：`saveImages()`（`store.js:152-159`）`MAX_IMAGES = 5000` 局部硬编码，超限 `slice(-5000)` 后写 storage；`stats` 结构 `{ total, downloaded, failed }`（`store.js:27`）无截断信息；popup 无提示位。

**方案**：

1. **constants.js**：新增 `MAX_CAPTURED_IMAGES = 5000`、`CAPACITY_WARNING_THRESHOLD = 4500`；store 引用常量替换局部变量。
2. **store**：`saveImages` 截断时 `this.stats.truncated = (this.stats.truncated || 0) + removed`，并确保随后 `saveStats()` 持久化（截断仅发生在 saveImages 内，addImage 的 fire-and-forget 已包含 `saveStats`，实现时保持两者同帧调用）；`stats` 读取处对缺失字段补 0（老数据兼容）。
3. **popup**：统计条（`.stats-bar`，`index.html:30-51`）上方新增 `#capacity-hint`（默认 `hidden`）：
   - `imageCount >= 4500` → 「接近捕获上限（5000），最早的记录将被自动移除」；
   - `stats.truncated > 0` → 追加「已累计移除 N 条」。
   - 数据源为现成的 `GET_STATUS` 返回 `{ enabled, stats, imageCount }`（`background:308-317`），init 与每次 `loadMedia()` 后刷新。

**不做**：字节配额检测；上限值用户可配。

**验收**：手动验证场景 6；老 storage 数据（无 `truncated` 字段）读取不报错。

### FR-7（V13-07）真防抖 + 导出当前筛选

**需求**：筛选输入统一防抖；导出内容 = 当前筛选视图。

**现状**：`popup.js:109-113`（search）与 `:148-161`（min-size/min-width/min-height/extensions）五处各自 `setTimeout(200)`；导出走 `EXPORT_IMAGES` → `background:380-386` 返回 `store.getImages()` **全量**。

**方案**：

1. `popup.js` 模块内新增：

   ```js
   function debounce(fn, ms = 200) {
     let timer;
     return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
   }
   ```

   五处输入的 handler 包一层 `debounce`，删除散落 timer 变量。
2. 导出本地化：`#btn-export` 处理函数改为对 `getFilteredMedia()` 结果 `JSON.stringify(filtered, null, 2)` → Blob → `URL.createObjectURL` 下载（复用现有 `<a download>` 模式），文件名 `open-download-export-YYYYMMDD-HHMMSS.json`；空结果时 `alert` 阻止。
3. **删除 `EXPORT_IMAGES`**：constants.js 类型、`background:380-386` 分支、popup 调用（grep 确认唯一调用方）。

**验收**：连续输入 10 字符只触发 1 次渲染（Performance 面板或断点计数）；导出文件内容与当前筛选/视图一致；`npm test` 全绿。

## 5. 边界情况

| 场景 | 处理方式 |
|------|---------|
| `urlDedupeKey` 收到非法 URL | 维持现状：原样返回整个 URL 作为 key |
| 同资源 query 仅参数顺序不同 | `searchParams.sort()` 归一为同 key，仍去重 |
| cache-buster URL（`?t=` 时间戳） | 各自成条（接受，见 FR-1 tradeoff 记录） |
| 单条下载进行中重复点击 | 按钮 `disabled`，不重入 |
| 下载中关闭 Popup | 后台继续，`downloadImage` 自行写回状态；重开 Popup `loadMedia()` 校准 |
| 取消时任务刚好已完成 | `chrome.downloads.cancel` 抛错 → 吞掉；状态以 store 实际值为准 |
| 取消后立即重试 | `pending → downloading` 为合法迁移（`updateMediaStatus` 无迁移限制） |
| ZIP 打包进行中同时单条下载 | 两条链路独立（offscreen vs downloader），允许并发 |
| lightbox 打开时收到新 `MEDIA_FOUND` | 数据入 `allMedia`，DOM 插入跳过；关闭时 `loadMedia()` 校准 |
| lightbox 导航序列中条目被移除 | 按 `allMedia` 快照容错：目标不存在则跳到下一有效项 |
| `DOWNLOAD_STATUS_CHANGED` 到达时条目已被移除/未渲染 | 按 `data-id` 查 DOM，不存在则忽略 |
| 达到 5000 上限后继续捕获 | 截断最旧、`stats.truncated` 累计、提示条更新（FR-6） |
| 导出时筛选结果为空 | `alert` 阻止，不生成空文件 |
| 老数据缺 `errorMsg`/`truncated` 字段 | 读取处 `|| ''` / `|| 0` 兜底 |
| SW 休眠期间 autoDownload 与用户单条下载并发 | `downloadImage` 各自独立调用，`activeDownloads` 按 imageId 隔离 |

## 6. 涉及文件

| 文件 | 变更 |
|------|------|
| `src/lib/constants.js` | +`DOWNLOAD_ONE`/`DOWNLOAD_STATUS_CHANGED`/`CANCEL_DOWNLOAD`，-`EXPORT_IMAGES`/`DOWNLOAD_ALL`，+`MAX_CAPTURED_IMAGES`/`CAPACITY_WARNING_THRESHOLD` |
| `src/lib/utils.js` | `urlDedupeKey` 重写；`generateFilename` 加可选参 |
| `src/lib/store.js` | `updateMediaStatus` 加 `errorMsg`；`saveImages` 用常量 + `stats.truncated` |
| `src/lib/downloader.js` | `activeDownloads`/`cancelOne`/真 `cancelAll`；`waitForDownload` 读 `delta.error`；删 `queue`；命名传参 |
| `src/lib/zip.js` | 逐条命名传 `mediaType/mimeType` |
| `src/background/index.js` | +`DOWNLOAD_ONE`/`CANCEL_DOWNLOAD` 分支；顶层 `downloader.on` 转发广播；-`EXPORT_IMAGES`/`DOWNLOAD_ALL` |
| `src/popup/index.html` | +`#lightbox` 结构、+`#capacity-hint` |
| `src/popup/popup.js` | 容器委托、模板抽函数、增量插入、下载/取消/重试/预览交互、debounce、本地导出 |
| `src/popup/popup.css` | +`lightbox-*` section、+`.image-download`/`.image-retry`（仿 `.image-remove` 模式，颜色走 token） |
| `__tests__/utils.test.js` | 去重用例重写、命名用例重写 |
| `__tests__/store.test.js` | 去重用例改写、`errorMsg`/`truncated` 用例 |
| `__tests__/downloader.test.js` | 取消/重试/activeDownloads/命名用例 |
| `__tests__/background.test.js` | `DOWNLOAD_ONE`/`CANCEL_DOWNLOAD`/状态广播用例，删 EXPORT 用例（如有） |
| `__tests__/zip.test.js` | 混合类型命名用例 |

## 7. 测试计划

新增/修改用例（沿用 `jest.setup.js` 的 chrome mock：`chrome.downloads.download` 50ms 自动完成、`_simulateError(id)`、`cancel(id)` 置 interrupted 并广播）：

- **utils**：① key 含 query；② query 参数顺序归一；③ hash 丢弃；④ 非法 URL 原样；⑤ sequential video 前缀；⑥ MIME 兜底扩展名；⑦ 类型化默认扩展兜底。
- **store**：① 不同 query 可入库；② 完全同 URL 去重；③ `updateMediaStatus` 写入/清空 `errorMsg`；④ 截断累计 `stats.truncated`；⑤ 老数据缺字段兼容。
- **downloader**：① 下载成功后 `activeDownloads` 清理；② `cancelOne` 触发 `chrome.downloads.cancel` 且状态回 `pending`、failed 计数不变；③ `cancelAll` 取消全部并停止 worker（`cancelled` 事件）；④ interrupted 非 取消错误仍归 `failed`；⑤ 视频命名断言。
- **background**：① `DOWNLOAD_ONE` 成功/条目不存在；② `CANCEL_DOWNLOAD` 带 id/不带 id；③ `DOWNLOAD_STATUS_CHANGED` 广播 payload；④ `EXPORT_IMAGES`/`DOWNLOAD_ALL` 已删除（发送时命中 default 分支）。
- **zip**：混合 image/video 的 sequential 命名。

popup/options/content/offscreen 仍无自动化测试，依赖第 8 节手动验证。

## 8. 交付与手动验证清单

每个任务合入前：`npm test` 全绿 + `npm run build` 通过 → `chrome://extensions` 重载 `dist/`。

v1.3 整体发版前按 AGENTS.md 清单回归，重点关注：

1. Popup 打开、监听开关更新状态；开启监听浏览普通网页捕获图片/视频。
2. 搜索、大小、媒体类型、扩展名筛选不报错；列表/卡片切换、选择状态不丢失。
3. 场景 1-6（第 3 节）逐一验证。
4. ZIP「下载选中/全部下载」不受影响（本版本 ZIP 主路径未改动，但涉及命名传参，需混合类型回归）。
5. Options 保存后 Popup/background 读到新配置；恢复默认不报错。
6. 亮/暗两套主题下新 UI（下载/取消/重试按钮、lightbox、容量提示）显示正常。
7. 发版走 `npm run release`（工作区干净 → 测试 → 打包 → tag）。
