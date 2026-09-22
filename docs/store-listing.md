# Chrome Web Store 提交材料（V15-04）

本文件是上架提交时的文案与素材清单，内容必须与 `src/manifest.json` 的权限声明、`docs/privacy.html` 的隐私政策保持一致。**任何一项改动后需要同步核对另外两项。**

- 目标版本：1.6.0
- 隐私政策 URL：`https://<GitHub Pages 域名>/privacy.html`（由 Deploy Docs 工作流部署 `docs/` 目录后可得）
- 单一用途说明：在浏览器本地捕获网页加载的图片与视频资源，并提供筛选、预览与批量下载。

## 1. 名称与简短描述

| 字段 | 中文 | English |
|------|------|---------|
| 名称 | Open Download - 网络图片批量下载器 | Open Download - Network Media Batch Downloader |
| 简短描述（≤132 字符） | 全局监听网页图片与视频，筛选预览后一键打包 ZIP 下载。数据仅存本地，无上报、离线可用。 | Capture images and videos from any site, filter and preview them, then batch download as a ZIP. Local-only, no telemetry. |

## 2. 详细描述

### 中文

Open Download 在浏览器后台观察网页的网络请求，把加载过的图片与视频记录下来，让你在弹窗里一次性筛完、预览完、打包带走。

**核心能力**

- 双通道捕获：网络请求观察（含预加载图、轮播后台原图等 DOM 中不出现的资源）+ 页面元素扫描（缓存命中、未发请求的图片也照样入库），两侧按 URL 自动去重合并。
- 图片与视频一站式：视频条目带时长与封面，图片带真实宽高，卡片视图可直接预览。
- 多维筛选：媒体类型、扩展名、文件大小、最小宽高、来源（网络 / 页面）、关键词搜索，以及按来源页面分组折叠。
- 批量下载不担心大文件：单文件超过 50MB 或整包预估超过 500MB 时自动改为逐条直接下载；其余情况按卷拆分 ZIP，打包在后台完成，关闭弹窗不中断。
- 站点级开关：弹窗或页面右键菜单即可单独暂停某个站点的捕获，其余站点不受影响。
- 一键滚动抓取：长列表页由扩展自动向下滚动，懒加载的图片随滚动进列表。

**隐私承诺**

- 不收集、不上传任何数据，无统计上报、无广告、无远程代码；
- 所有记录与设置仅保存在本地 `chrome.storage.local`；
- 网络请求仅观察，不拦截、不修改；不解密 DRM、不绕过登录或付费墙；
- 权限仅用于上述功能，逐项说明见隐私政策页。

### English

Open Download watches network activity in the background and records every image and video a page loads, so you can filter, preview, and pack them in one go.

**Highlights**

- Two capture paths: request observation (catches preloaded and background-fetched assets that never appear in the DOM) plus DOM scanning (catches cached media that issues no request), merged by URL.
- Images and videos together: video entries carry duration and poster, cards preview inline.
- Rich filtering: media type, extension, size, minimum dimensions, source (network / DOM), keyword search, and per-page grouping.
- Large batches that do not blow up: files over 50MB or batches over 500MB fall back to individual downloads; everything else is packed as sequenced ZIP volumes, built in the background so closing the popup does not interrupt it.
- Per-site switch: pause capture for one site from the popup or the page context menu without affecting others.
- One-click auto-scroll capture for lazy-loading feeds.

**Privacy**

- No data collection, no uploads, no analytics, no ads, no remote code.
- Records and settings stay in local `chrome.storage.local`.
- Requests are observed only — never blocked or modified. No DRM circumvention, no paywall bypass.

## 3. 权限使用理由（Privacy practices → Justification）

| 权限 | 提交时填写理由 |
|------|---------------|
| `webRequest` | Used only to observe completed requests (`onCompleted`) and read response headers so media URLs can be identified locally. Requests are never blocked, redirected, or modified, and no request data leaves the device. |
| `downloads` | Saves the media files the user explicitly chooses to download, and the ZIP archives produced by the packing flow. |
| `storage` | Persists the captured media list and user settings in `chrome.storage.local`. No remote or synced storage is used. |
| `offscreen` | Creates a short-lived background document to build ZIP archives so packing survives the popup being closed; the document is closed as soon as the download finishes. |
| `contextMenus` | Adds right-click entries to toggle capture globally and to pause or resume capture for the current site. |
| `host_permissions: <all_urls>` | Required to observe media requests on any website the user visits, which is the core function of the extension. The data is processed locally only. |

## 4. 数据使用声明（Privacy practices 表单）

- Does the extension collect user data? **No.**
- 具体勾选：不收集个人身份信息、健康信息、财务信息、认证信息、个人通信、位置、网页浏览记录、用户活动、网站内容。
- 说明：即使捕获记录中包含媒体 URL 与来源页面标题，这些数据也只写入本地存储，不会传输给开发者或任何第三方。

## 5. 截图与素材清单

| 素材 | 规格 | 内容建议 | 状态 |
|------|------|---------|------|
| 扩展图标 | 128×128 PNG | 复用 `src/assets/icon-128.png` | 已有 |
| 截图 1 | 1280×800 | 弹窗列表视图：筛选面板展开 + 站点暂停行 | 待补 |
| 截图 2 | 1280×800 | 弹窗卡片视图：视频条目带时长角标 | 待补 |
| 截图 3 | 1280×800 | 设置页：保存目录、命名策略、携带 Cookie 开关 | 待补 |
| Small promo tile | 440×280 | Logo + 「批量下载网页图片与视频」 | 待补 |
| Marquee promo tile | 1400×560 | 可选，用于首页推荐位 | 待补 |

截图要求：不得包含真人面部、第三方版权素材或误导性界面；中英文描述与截图内容需一致。

## 6. 提交前检查清单

1. `npm test` 全绿、`npm run build` 通过、`npm run pack` 产物解压后不含 `__tests__/`、`docs/`、`node_modules/`。
2. `src/manifest.json` 的 `version` 为 `1.6.0`，`default_locale` 为 `zh_CN`，权限清单与第 3 节逐条一致（`commands` 是顶层字段，不计入 `permissions`）。
3. `docs/privacy.html` 已部署且可访问，内容与第 3、4 节自洽。
4. 商店描述、截图文案与实际功能一致（尤其是「大文件旁路」「分卷」「携带 Cookie 默认关闭」三处表述）。
5. 构建产物在 Chrome 中加载后，Popup / Options / 右键菜单在英文与中文环境下均无裸露 i18n key。
6. **替换商店 ID 占位**：`grep -rn EXTENSION_ID_PLACEHOLDER docs/` 应无输出。拿到商店分配的扩展 ID 后，把占位符换成真实 ID（涉及 `docs/index.html`、`docs/guides/*.html`、`docs/en/guides/index.html` 的页脚评分链接）。扩展内部的评分入口不需要替换：它用 `chrome.runtime.id` 拼接，上架后自动指向正确页面。
7. **提交后回填**：把商店详情页 URL 写进 `docs/index.html` 的安装区块（当前安装方式一/方式二为源码与 Releases 安装，上架后可增加「商店安装」方式一）。
8. 教程内容与实际功能一致：`docs/guides/` 三篇教程只写已发布功能；若截图尚未产出，保留 `.guide-figure-slot` 的截图位（不得引用外链图片）。
