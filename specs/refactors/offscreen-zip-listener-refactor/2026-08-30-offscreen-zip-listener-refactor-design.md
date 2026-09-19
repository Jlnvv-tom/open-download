# Offscreen ZIP 打包与监听器重构设计文档

## 1. 概述

### 1.1 背景

v1.1.2 存在以下已知缺口（见功能文档的"后续改进建议"与代码审查结论）：

1. **ZIP 打包依赖 Popup 生命周期**：`createMediaZip` 在 Popup 中执行，Popup 关闭即中断打包。
2. **webRequest 监听器条件注册**：监听器在 `startListening()` 内注册，Service Worker（SW）休眠期间事件丢失，且依赖 `onStartup`/`onInstalled` 恢复，存在重复注册风险。
3. **预留配置未接入**：`DEFAULT_SETTINGS.filters.mediaTypes`（媒体类型白名单）与 `filters.minDimensions`（最小宽高）已定义但无处使用。
4. **死代码**：`onHeadersReceived`（定义未注册）、`IMAGE_FOUND`/`DOWNLOAD_COMPLETE`/`DOWNLOAD_ERROR` 消息类型（定义未使用）、`COLLECT_IMAGES` 预留监听（无调用方）、`downloader.js` 尾部的 `downloader` 单例导出（store 为 null）。
5. **权限冗余**：manifest 声明了 `notifications` 权限但未使用。

### 1.2 目标

- ZIP 打包迁移到 offscreen document，Popup 关闭不中断任务，并向 Popup 实时推送进度。
- 监听器改为 SW 模块顶层注册，捕获开关由 `settings.enabled` 决定，消除事件丢失窗口与重复注册风险。
- 接入 `filters.mediaTypes`（Options 捕获类型复选组）与 `filters.minDimensions`（Popup 筛选面板最小宽高，持久化）。
- 清理全部死代码与冗余权限。

### 1.3 非目标

- 不做 HLS/m3u8 分片下载合并（沿用既有决策）。
- 不改变逐个下载路径（`DOWNLOAD_SELECTED`/`DOWNLOAD_ALL`）的行为。
- data: URI 缩略图：经核查 `popup.js` 的 `getPreviewUrl` 已直接使用 data: URL 作为预览，功能可用，不引入额外改动。

## 2. 方案设计

### 2.1 Offscreen ZIP 打包

**职责划分**：

- `background/index.js`：`DOWNLOAD_ZIP` 消息入口 → `ensureOffscreenDocument()`（`chrome.runtime.getContexts` 检查 + `chrome.offscreen.createDocument`，reasons: `['BLOBS']`）→ 等待 `ZIP_OFFSCREEN_READY` 握手（5s 超时兜底，应对 SW 重启后握手丢失）→ 发送 `ZIP_BUILD_REQUEST {zipName, fileNaming, items}` → 等待 `ZIP_BUILD_RESULT`（300s 超时）→ `chrome.downloads.download(blobUrl)` → 监听下载完成 → 回写媒体状态 → `closeOffscreenDocument()`。
- `offscreen/offscreen.js`：加载即发送 `ZIP_OFFSCREEN_READY`；收到 `ZIP_BUILD_REQUEST` 后复用 `src/lib/zip.js` 的 `createMediaZip` 串行抓取打包（`onProgress` 回调逐项上报 `ZIP_BUILD_PROGRESS`），完成后 `URL.createObjectURL` 并回发 `ZIP_BUILD_RESULT {zipName, blobUrl, succeeded, failed, succeededIds, failedItems}`。
- `zip.js`：`createMediaZip` 新增可选 `onProgress(done, total)`，向后兼容。

**关键决策**：

- **blob URL 传递而非 base64**：offscreen 文档与 popup 同属扩展 origin，`chrome.downloads.download` 消费 blob URL 的机制与原 Popup 内实现一致（浏览器下载系统解析 blob），避免大 ZIP 的 base64 内存膨胀。文档在下载完成前保持存活以维持 blob URL 有效。
- **同一时刻仅允许一个打包任务**：background 以 `zipBuild` pending promise 做互斥，重复请求返回错误，避免状态混乱。
- **新增消息类型**：`DOWNLOAD_ZIP`、`ZIP_OFFSCREEN_READY`、`ZIP_BUILD_REQUEST`、`ZIP_BUILD_PROGRESS`、`ZIP_BUILD_RESULT`、`ZIP_PROGRESS`（background 转播给 Popup 的进度广播）。
- **manifest**：新增 `offscreen` 权限与 `minimum_chrome_version: 116`（`getContexts` 要求）；移除 `notifications`。

### 2.2 webRequest 顶层注册

- `chrome.webRequest.onCompleted.addListener(...)` 移至模块顶层，SW 每次启动同步挂载；休眠期间的事件可唤醒 SW。
- 移除 `isListening` 标志与 `startListening()`/`stopListening()`，`onRequestCompleted` 内 `await store.init()` 后直接读 `settings.enabled` 决定是否捕获（内存缓存，无额外 I/O）。
- 代价：监听关闭时事件仍会唤醒 SW，但处理函数立即返回，属可接受的权衡。

### 2.3 预留配置接入

- `filters.mediaTypes`：background 捕获链在 `detectMediaType` 之后增加白名单判断（空 = 全部捕获）；Options 新增「捕获媒体类型」复选组（图片/视频），全不勾选保存为 `[]` 即捕获全部。
- `filters.minDimensions`：`store.getFilteredMedia` 新增宽高过滤（尺寸未知的条目保留，不误伤）；Popup 筛选面板新增「最小宽/最小高」输入框，初始值读自设置，变更后通过 `UPDATE_SETTINGS` 持久化。`saveSettings` 的 filters 浅合并保证 Options 保存（不携带 minDimensions）不会误清该字段。

## 3. 数据流

```
Popup ──DOWNLOAD_ZIP {ids}──▶ background ──ZIP_BUILD_REQUEST──▶ offscreen
                                   ▲                               │
                                   │◀──ZIP_OFFSCREEN_READY(握手)────┘
                                   │◀──ZIP_BUILD_PROGRESS(逐项)────
                                   │◀──ZIP_BUILD_RESULT(blobUrl)───
Popup ◀──ZIP_PROGRESS(转播)── background ──downloads.download(blobUrl)──▶ 落盘
                                   └─ 回写媒体状态 → 关闭 offscreen
```

## 4. 边界情况

- 打包任务进行中重复请求：返回「已有打包任务进行中」。
- offscreen 握手丢失（SW 重启但文档存活）：等待 5s 超时后放行，由发送失败重试兜底。
- 打包超时：300s 后拒绝并释放 `zipBuild`。
- 全部资源抓取失败：`createMediaZip` 抛错，`ZIP_BUILD_RESULT` 携带 error，background 不调用 downloads，直接关闭 offscreen。
- ZIP 下载中断/超时：抛错给 Popup，且不将任何条目标记为 downloaded。
- `createDocument` 并发竞态：捕获 "already exists" 类错误忽略。

## 5. 测试

- `zip.test.js`：onProgress 进度序列。
- `store.test.js`：minDimensions 过滤（含尺寸未知条目保留）。
- `background.test.js`：mediaTypes 白名单捕获过滤；DOWNLOAD_ZIP 成功路径（mock offscreen 握手与结果回发，断言 downloads.download 参数、状态回写、offscreen 创建/关闭）；打包失败路径（不触发下载、状态不回写）。
- 测试环境扩展 `chrome.offscreen` 与 `chrome.runtime.getContexts` mock。

## 6. 验收标准

1. Popup 发起 ZIP 下载后关闭弹窗，打包与下载在后台完成。
2. 打包期间按钮实时显示「打包中 n/total」。
3. Options 中取消勾选「视频」后，浏览页面不再捕获视频。
4. Popup 筛选面板设置最小宽高后列表实时过滤，重开弹窗仍生效。
5. `npm test` 与 `npm run build` 全部通过。
