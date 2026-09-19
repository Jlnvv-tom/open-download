# Open Download 竞品对比分析与迭代路线图

- 日期：2026-09-19
- 分析对象：Open Download v1.2.0（本仓库）
- 竞品数据口径：Chrome Web Store 公开页面与第三方统计（chrome-stats、评测站），用户数/评分为检索时点的近似值，仅用于量级判断。

## 1. 概述

### 1.1 背景

Open Download 的定位是「全局监听网页网络请求中的图片/视频资源，Popup 内筛选、预览并 ZIP 批量下载」。本文回答三个问题：

1. 当前产品功能处于什么水平；
2. 与市场上排名前十的同类扩展相比，优势与差距在哪；
3. 下一阶段迭代应该做什么、按什么顺序做。

### 1.2 方法

- 代码走查：覆盖 manifest、background、lib、popup、options、content、offscreen 与测试（要点见第 2 节，结论与 `src/` 内实现一致，引用了具体文件行号）。
- 联网调研：检索 Chrome Web Store 在售的头部图片批量下载与视频下载扩展，取 10 个代表产品（第 3 节）。
- 对比：从捕获方式、筛选、打包、体验、工程质量等 14 个维度做功能矩阵（第 4 节），并输出 SWOT。
- 产出：结构化分析数据（JSON，第 5 节）与版本化迭代路线图（第 6 节）。

## 2. 本产品现状（v1.2.0）

### 2.1 功能清单

| 模块 | 功能 |
|------|------|
| 捕获 | `webRequest.onCompleted` 全局被动监听 `<all_urls>`；MIME > resourceType > 扩展名三级识别图片/视频；捕获期过滤（媒体类型、排除域名、扩展名白名单、Content-Length 大小区间）；可选 autoDownload |
| 信息补齐 | content script 收集页面 `<img>` 的 naturalWidth/Height、alt、previewUrl 并回填；MutationObserver + load 事件监听动态图片 |
| 筛选 | Popup 双层 Tab（图片/视频 → 扩展名，带实时计数）、搜索、最小大小、最小宽高、扩展名输入；Options 侧捕获期过滤（大小区间、类型、排除域名、扩展名、去重开关） |
| 视图 | 列表/卡片双视图、卡片尺寸滑杆（84-180px）、缩略图防盗链规避（no-referrer）、占位图 |
| 下载 | 「下载选中/全部」统一走 ZIP 打包下载；offscreen 文档执行打包；并发 1-10（单文件路径）；保存路径与三种命名策略（original/domain/sequential） |
| ZIP | 零依赖手写 ZIP writer（CRC32 表 + UTF-8 文件名标志），存储模式（不压缩），整包内存构建，进度回调，重名自动序号 |
| 其他 | 右键菜单（开关监听/清空）、列表导出 JSON、统计条、全部 UI 偏好持久化、MV3 生命周期处理（SW 常驻监听、offscreen 握手与超时兜底） |

### 2.2 技术画像

- 零运行时依赖，无打包器，原生 ES modules；Manifest V3，`minimum_chrome_version: 116`，权限仅 5 项 + `<all_urls>`。
- 测试：Jest 83 个用例，覆盖 `src/lib/` 全部模块与 background 消息路由（含 offscreen ZIP 全链路）；popup/options/content/offscreen 无 UI 测试。
- 数据：`chrome.storage.local` 三键（`captured_images` / `settings` / `stats`），5000 条硬上限静默截断。

### 2.3 代码层面的已知短板

1. `urlDedupeKey` 丢弃全部查询参数（`src/lib/utils.js:189`）：签名 URL / 带裁剪参数的 CDN 图会被误去重，高频实际坑。
2. ZIP 全内存串行 fetch（`src/lib/zip.js:129`）：大视频批量打包易爆内存；offscreen fetch 默认不带跨域 Cookie，需登录资源打包失败。
3. downloader 半残：无失败重试；`cancelAll()` 不真正取消下载（`src/lib/downloader.js:182`）；`DOWNLOAD_SELECTED`/`DOWNLOAD_ALL` 消息存在但 UI 只用 ZIP 路径。
4. 命名：sequential 策略对视频也硬编码 `img_` 前缀；无扩展名兜底 `.jpg`（`src/lib/utils.js:169`）。
5. 硬编码限制：5000 条静默截断（`src/lib/store.js:152`）、单文件下载超时 120s、打包超时 300s，均无用户提示。
6. 视频能力薄弱：无缩略图（占位图标）、duration 字段从未赋值、m3u8 只按 URL 收录无法下载。
7. 体验缺口：无单条直接下载、无大图 lightbox、无按页面/Tab 分组、无失败重试入口、导出 JSON 是全量而非当前筛选结果。
8. 无 i18n，中文文案硬编码；搜索筛选用 `setTimeout(200)` 非真防抖；监听开关只有全局粒度，无站点级开关。

## 3. 竞品调研（Top 10）

说明：取「图片批量下载」与「视频下载」两类头部产品共 10 个。用户数为各来源公开口径的近似值。

| # | 产品 | 类别 | 用户量级（约） | 评分 | 核心能力 |
|---|------|------|--------------|------|----------|
| 1 | Video DownloadHelper | 视频下载 | 500 万+ | 4.5★（3.5 万+ 评分） | 1000+ 网站、HLS/DASH 拼接、聚合下载，老牌 |
| 2 | Video Downloader Professional | 视频下载 | 200 万+（历史峰值，第三方口径 30-40 万） | 4.5★（22.9 万评分） | 播放中视频嗅探、MP4 直下 |
| 3 | Fatkun Batch Image Downloader | 图片批量 | 100 万+ | ~4.x | 平台定制抓取（Pinterest/Instagram/Amazon）、自动翻页、ZIP |
| 4 | Imageye | 图片批量 | 100 万+ | 4.9★（1.67 万评分） | DOM 扫描全图、大小/URL 筛选、格式转换、文件夹归类 |
| 5 | CocoCut | 视频下载 | 百万级 | ~4.4★ | HLS/m3u8、直播录制、任意格式音视频 |
| 6 | FetchV: m3u8 & HLS | 视频下载（HLS 专精） | 30 万 | 4.74★（1.7K 评分） | TS 分片嗅探、合并为 MP4、直播支持 |
| 7 | Image Downloader | 图片下载 | 百万级（老牌） | 3.7★（2.6K 评分） | 页面图片浏览、按 URL/尺寸过滤，功能简单 |
| 8 | Download All Images | 图片批量 | 15 万+ | 4.3★（286 评分） | 智能 ZIP 批量打包 + 筛选，主打速度与简洁 |
| 9 | Image Downloader Plus (Pic-Grabber) | 图片下载 | 数十万级 | ~4.5★ | 开源，可抓动态加载/受保护图片 |
| 10 | StreamFab Video Downloader (Browser) | 视频下载（付费） | — | ~4.x | 320p-8K MP4/MKV、站点深度适配，订阅制 |

两类之外的观察：

- **SaveFrom.net Helper** 知名度高但因政策原因商店外分发，安全口碑差，不列入正式榜单。
- 头部产品趋同点：DOM 扫描（保证「看到的都能下」）+ 站点深度适配 + ZIP/流式打包 + 国际化。
- 头部产品共性痛点（用户差评来源）：权限焦虑（`<all_urls>` + 广告注入）、闭源不透明、订阅收费、大文件失败率高。

## 4. 对比分析

### 4.1 功能矩阵（✅ 支持 / ⚠️ 部分支持 / ❌ 缺失）

| 维度 | Open Download | 图片类头部（Imageye/Fatkun） | 视频类头部（VDH/CocoCut） |
|------|:---:|:---:|:---:|
| 被动网络监听捕获（含 DOM 外资源） | ✅ | ❌ | ✅ |
| DOM 扫描兜底（看到的都能下） | ❌（仅回填尺寸） | ✅ | ⚠️ |
| 图片 + 视频双类型统一 | ✅ | ❌（多数仅图片） | ❌（多数仅视频） |
| 平台定制抓取（Pinterest/IG/微博等） | ❌ | ✅ | ⚠️（按站点适配） |
| 自动翻页 / 滚动加载抓取 | ❌ | ✅ | ⚠️ |
| 尺寸/类型/扩展名/域名筛选 | ✅ | ✅ | ✅ |
| 大图 lightbox 预览 | ❌ | ✅ | — |
| 单条直接下载 / 失败重试 | ❌ | ✅ | ✅ |
| ZIP 打包 | ✅（内存态） | ✅ | ✅ |
| 大文件/流式处理 | ❌ | ✅ | ✅（HLS 分片合并） |
| HLS/m3u8 支持 | ❌（仅收录 URL） | — | ✅ |
| 视频 duration/缩略图 | ❌ | — | ✅ |
| i18n | ❌（中文硬编码） | ✅ | ✅ |
| 零依赖 / 开源 / 无广告无上报 | ✅ | ⚠️/❌ | ❌ |

### 4.2 差异化优势

1. **捕获模型不同**：竞品图片类全部是 DOM 扫描（页面渲染后找 `<img>`），Open Download 是网络层被动监听——能捕获 DOM 中不出现或已卸载的资源（预加载图、轮播后台图、JS 动态请求的原图），且与页面加载时序解耦。这是核心差异化定位，不是缺陷。
2. **图片 + 视频一站式**：两个赛道的头部产品几乎互不跨界，本产品同时覆盖，筛选体系（类型/扩展名/大小/宽高/域名）比多数竞品细。
3. **工程质量与隐私**：零依赖、无远程资源、无统计上报、MIT 开源、83 个测试用例；竞品中闭源 + 广告 + 权限滥用（如 Video Downloader Professional 出现在恶意扩展研究报告中）是普遍现象，这是可宣传的信任点。
4. **MV3 工程处理讲究**：SW 顶层常驻监听防丢事件、offscreen ZIP 生命周期管理（握手/超时兜底/下载完才销毁），同类开源项目少见。
5. **UI 偏好全持久化**：视图模式、Tab、卡片尺寸、筛选条件均可持久，竞品普遍不做到这个细度。

### 4.3 不足与差距（按影响排序）

1. **捕获盲区**：被动监听对「缓存命中不发出网络请求」的图会漏捕；content script 只补尺寸不把 DOM 中未捕获的图入库。竞品「看到的都能下」的直觉预期我们达不到——这是与用户预期差距最大的一条。
2. **无平台适配与翻页**：Fatkun 类产品的核心壁垒在 Pinterest/电商/社媒的定制抓取与自动翻页，本产品完全没有， Pinterest/小红书/微博等高频场景抓不全。
3. **大文件风险**：ZIP 整包内存 + 串行 fetch，视频批量打包在几百 MB 量级就会崩；需登录（Cookie）的资源打包失败。
4. **基础体验缺项**：无单条下载、无 lightbox、无失败重试、无真正取消——每一条都是竞品的标配。
5. **去重误伤**：签名 URL/裁剪参数被去重合并，表现为「捕获数量比实际少」，用户难自查。
6. **国际化缺失**：中文硬编码，Chrome Web Store 的国际市场基本不可见。
7. **商店发行缺失**：未上架（需隐私政策、权限说明），自然流量入口为零。

### 4.4 SWOT

| | 有利 | 不利 |
|---|------|------|
| **内部** | S：网络层捕获模型差异化；图片+视频一站式；零依赖开源、隐私友好；测试与 MV3 工程质量高 | W：捕获盲区无兜底；无平台适配/翻页；大文件内存风险；基础体验缺项；无 i18n；去重误伤 |
| **外部** | O：竞品权限焦虑与广告滥用留下「干净工具」空位；MV3 迁移淘汰了一批老扩展；AI 选图/分类是行业新方向 | T：头部产品生态位稳固、平台适配成本高；Chrome 对 webRequest 权限政策持续收紧；DRM 站点法律风险 |

## 5. 分析数据结构（JSON）

以下 JSON 是本次分析的机器可读版本，可作为后续迭代跟踪的输入（维度评分 1-5，5 为最佳）：

```json
{
  "meta": {
    "date": "2026-09-19",
    "productVersion": "1.2.0",
    "dataSource": "Chrome Web Store 公开数据 + chrome-stats + 第三方评测，用户数为近似量级"
  },
  "product": {
    "name": "Open Download",
    "positioning": "网络层全局监听图片/视频捕获 + 筛选预览 + ZIP 批量下载",
    "techProfile": {
      "manifest": "MV3",
      "runtimeDeps": 0,
      "tests": 83,
      "permissions": ["webRequest", "downloads", "storage", "offscreen", "contextMenus", "<all_urls>"]
    },
    "capabilityScores": {
      "capturePassive": 5,
      "captureDomFallback": 1,
      "platformAdapters": 1,
      "paginationScroll": 1,
      "filtering": 4,
      "preview": 2,
      "selectionUX": 3,
      "zipPackaging": 4,
      "largeFileHandling": 1,
      "videoSupport": 2,
      "retryCancel": 1,
      "i18n": 1,
      "privacyTrust": 5,
      "engineeringQuality": 5
    }
  },
  "competitors": [
    { "rank": 1, "name": "Video DownloadHelper", "category": "video", "usersApprox": "5M+", "rating": 4.5, "reviews": 35200, "keyFeatures": ["1000+ 站点", "HLS/DASH 合并", "聚合下载"], "learnFrom": "分片流式处理大视频" },
    { "rank": 2, "name": "Video Downloader Professional", "category": "video", "usersApprox": "2M+", "rating": 4.5, "reviews": 229600, "keyFeatures": ["播放嗅探", "MP4 直下"], "learnFrom": "负例：曾被安全研究报告点名，权限透明度是反差点" },
    { "rank": 3, "name": "Fatkun Batch Image Downloader", "category": "image", "usersApprox": "1M+", "rating": 4.0, "reviews": null, "keyFeatures": ["Pinterest/IG/Amazon 定制抓取", "自动翻页", "ZIP"], "learnFrom": "平台适配器与翻页抓取" },
    { "rank": 4, "name": "Imageye", "category": "image", "usersApprox": "1M+", "rating": 4.9, "reviews": 16700, "keyFeatures": ["DOM 全图扫描", "大小/URL 筛选", "格式转换"], "learnFrom": "筛选体验与评分运营" },
    { "rank": 5, "name": "CocoCut", "category": "video", "usersApprox": "1M+", "rating": 4.4, "reviews": null, "keyFeatures": ["HLS/直播", "任意格式"], "learnFrom": "图标角标显示已捕获数量" },
    { "rank": 6, "name": "FetchV", "category": "video", "usersApprox": "300K", "rating": 4.74, "reviews": 1765, "keyFeatures": ["m3u8 分片合并 MP4"], "learnFrom": "专精垂直场景打透" },
    { "rank": 7, "name": "Image Downloader", "category": "image", "usersApprox": "1M+", "rating": 3.7, "reviews": 2600, "keyFeatures": ["页面图片浏览", "URL/尺寸过滤"], "learnFrom": "负例：功能停滞导致评分下滑，体验补课的必要性" },
    { "rank": 8, "name": "Download All Images", "category": "image", "usersApprox": "150K+", "rating": 4.3, "reviews": 286, "keyFeatures": ["智能 ZIP 打包", "快速筛选"], "learnFrom": "ZIP 打包作为核心卖点直接对标" },
    { "rank": 9, "name": "Image Downloader Plus (Pic-Grabber)", "category": "image", "usersApprox": "数百K", "rating": 4.5, "reviews": null, "keyFeatures": ["开源", "动态加载图抓取"], "learnFrom": "开源社区运营" },
    { "rank": 10, "name": "StreamFab Video Downloader (Browser)", "category": "video", "usersApprox": "未知", "rating": 4.0, "reviews": null, "keyFeatures": ["8K MP4/MKV", "站点深度适配"], "learnFrom": "付费档位验证了高级功能的付费意愿" }
  ],
  "swot": {
    "strengths": ["网络层捕获差异化", "图片+视频一站式", "零依赖/开源/隐私友好", "测试与 MV3 工程质量", "UI 偏好持久化"],
    "weaknesses": ["无 DOM 扫描兜底", "无平台适配与翻页", "ZIP 全内存大文件风险", "无单条下载/lightbox/重试/取消", "去重丢 query 误伤", "无 i18n", "未上架商店"],
    "opportunities": ["竞品权限焦虑留下干净工具空位", "MV3 淘汰老旧扩展", "AI 选图/分类新方向"],
    "threats": ["头部生态位稳固", "Chrome 对 webRequest 政策收紧", "DRM 站点法律风险"]
  },
  "roadmap": "见第 6 节，与 specs/analysis 保持同步"
}
```

## 6. 迭代计划

原则：先补齐「用户预期基线」（竞品标配），再放大「差异化优势」，最后做增长。每个版本保持可独立发布。

### 6.1 路线图总览

| 版本 | 主题 | 周期（估） | 目标 |
|------|------|-----------|------|
| v1.3 | 体验补课 + 去重修复 | 2-3 周 | 把竞品标配补齐，消除高频误伤 |
| v1.4 | 捕获增强 | 3-4 周 | DOM 兜底 + 站点级控制 + 翻页抓取 |
| v1.5 | 工程强化 + 国际化 | 2-3 周 | 大文件安全、i18n、上架 Chrome Web Store |
| v1.6 | 差异化放大 | 4 周+ | 平台适配器、视频能力、AI 选图探索 |

### 6.2 v1.3 体验补课（优先级 P0/P1）

| # | 任务 | 优先级 | 涉及文件 | 验收标准 |
|---|------|--------|----------|----------|
| 1 | `urlDedupeKey` 保留 query 参数（或「保留关键参数」策略，去重 key 加入完整 URL 指纹） | P0 | `src/lib/utils.js:189`、`src/lib/store.js`、测试 | 签名 URL 不再被误合并；现有 5000 条数据兼容（key 变更需迁移或仅对新条目生效） |
| 2 | 单条直接下载按钮（列表/卡片项 + 右键） | P0 | `src/popup/`、`src/lib/constants.js`（消息类型）、background | 任意条目可单独下载，状态徽章正确流转 |
| 3 | 失败项重试 + 真正取消（`chrome.downloads.cancel`） | P0 | `src/lib/downloader.js` | 失败条目可一键重试；批量下载可中止且浏览器下载任务被取消 |
| 4 | lightbox 大图/视频预览（点击缩略图，支持键盘翻页） | P1 | `src/popup/` | 图片放大查看、视频内联播放，Esc/方向键可用 |
| 5 | sequential 命名按类型区分前缀（`img_`/`video_`），无扩展名兜底从 MIME 推断 | P1 | `src/lib/utils.js:169` | 视频不再被命名为 `img_0001` |
| 6 | 5000 条上限与配额：接近上限时 Popup 顶部提示，非静默截断 | P1 | `src/lib/store.js:152`、popup | 达到 4500 条时出现提示；截断数可见 |
| 7 | 搜索输入真防抖 + 导出 JSON 改为当前筛选结果 | P2 | `src/popup/popup.js` | 连续输入只渲染一次；导出内容与当前视图一致 |

### 6.3 v1.4 捕获增强

| # | 任务 | 优先级 | 说明 |
|---|------|--------|------|
| 1 | DOM 扫描兜底捕获 | P0 | content script 将页面 `<img src>`、`<video src/poster>` 中未被 webRequest 捕获的资源入库（与现有记录按 URL 合并、标注来源 `dom|network`）。解决缓存命中漏捕，对齐「看到的都能下」预期 |
| 2 | 站点级监听开关 | P0 | `DEFAULT_SETTINGS` 增加 `siteRules`（白/黑名单 + 按域名暂停），Popup 顶部显示当前站点状态，替代现在只有全局开关的粒度 |
| 3 | 自动滚动/翻页抓取 | P1 | 可选注入滚动器（用户显式触发），配合 DOM 兜底捕获长列表页 |
| 4 | 视频信息补齐 | P1 | content script 采集 `<video>` 的 duration/poster/尺寸，回填现有 duration 字段；卡片视图显示时长角标 |
| 5 | 按页面/Tab 分组 | P2 | 列表支持按 `tabUrl` 分组折叠，多标签页场景可扫读 |

### 6.4 v1.5 工程强化 + 国际化

| # | 任务 | 优先级 | 说明 |
|---|------|--------|------|
| 1 | ZIP 分卷 / 大文件旁路 | P0 | 超过阈值（如单文件 >50MB 或整包 >500MB）自动改为逐条 `chrome.downloads.download`（复用 downloader 并发路径）；ZIP 侧评估分卷（每 N 个文件一个 zip）替代全内存 |
| 2 | offscreen fetch 带 credentials 可选 | P1 | 设置项「打包时携带 Cookie」，解决需登录资源 |
| 3 | i18n（中英） | P0 | `_locales/` + `chrome.i18n`，manifest `default_locale`；文案抽离 |
| 4 | 上架 Chrome Web Store | P0 | 隐私政策页（docs 落地页增加）、权限使用说明、商店素材；上线后开启评分引导 |
| 5 | Firefox 移植评估 | P2 | webRequest/BrowserButtons 差异调研，出可行性结论即可 |

### 6.5 v1.6 差异化放大（方向性）

1. **平台适配器框架**：按站点注册抓取规则（Pinterest、小红书、微博、电商列表页），把 v1.4 的 DOM 兜底升级为站点感知；规则做成数据驱动，便于社区贡献。
2. **视频能力**：直链视频一键下载（大文件旁路复用）；m3u8 收录条目给出「需要专用工具」的明确提示或引入分片合并（工程量大，需单独立项）。
3. **AI 选图探索**：本地/可选 API 对捕获图做清晰度评分、主色聚类、去重相似图（感知哈希），形成「智能筛选」卖点，回应行业 AI 化趋势。
4. **增长**：图标角标显示新捕获数（对标 CocoCut）、快捷键、落地页 SEO 与场景化教程内容。

### 6.6 度量与验收

- 功能验收沿用 `AGENTS.md` 的手动验证清单；每个版本发布前 `npm test` + `npm run build` 必须通过。
- 建议新增：popup 内匿名化的本地统计（已捕获/下载成功率/打包失败率），先本地呈现，上架后再评估是否收集（默认关闭）。
- 竞品基线复测节奏：每半年更新一次第 3 节数据（用户数与评分变化）。

## 7. 参考来源

- [Image Downloader - Chrome Web Store](https://chromewebstore.google.com/detail/image-downloader/cnpniohnfphhjihaiiggeabnkjhpaldj)
- [Image downloader - Imageye - Chrome Web Store](https://chromewebstore.google.com/detail/image-downloader-imageye/agionbommeaifngbhincahgmoflcikhm)（[imageye.net](https://imageye.net)）
- [Image Downloader - Fatkun AI Batch Save - Chrome Web Store](https://chromewebstore.google.com/detail/image-downloader-fatkun-a/mojcdcedhidldcgaokbelcmffoaengkj)
- [Download All Images - Chrome Web Store](https://chromewebstore.google.com/detail/download-all-images/nnffbdeachhbpfapjklmpnmjcgamcdmm)
- [Video Download Helper - Chrome Web Store](https://chromewebstore.google.com/detail/video-download-helper/lmjnegcaeklhafolokijcfjliaokphfk)
- [video downloader - CocoCut - Chrome Web Store](https://chromewebstore.google.com/detail/video-downloader-cococut/ekhbcipncbkfpkaianbjbcbmfehjflpf)
- [FetchV - Video Downloader for m3u8 & hls - Chrome Web Store](https://chromewebstore.google.com/detail/fetchv-video-downloader-f/nfmmmhanepmpifddlkkmihkalkoekpfd)（[fetchv.net](https://fetchv.net)）
- [Video Downloader Professional - Chrome Web Store](https://chromewebstore.google.com/detail/video-downloader-professi/elicpjhcidhpjomhibiffojpinpmmpil)
- [TaskLabs vs Imageye & Fatkun 对比文章](https://www.cmdos.app/blogs/tasklabs-vs-imageye-fatkun-more-than-downloading)
- [chrome-stats.com](https://chrome-stats.com)（用户量级参考）
- [Cisdem 2026 视频下载扩展评测](https://www.cisdem.com)、[Vidow.io 排名](https://vidow.io)、TechPP 评测
- [palant.info：扩展商店搜索操纵与恶意扩展研究](https://palant.info)（Video Downloader Professional 相关背景）
