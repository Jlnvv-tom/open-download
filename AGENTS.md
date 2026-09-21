# AGENTS.md

面向 AI 编码助手的项目指南。修改本仓库时，优先遵循本文档；如果与用户的明确要求冲突，以用户要求为准。

## 项目概览

Open Download 是一个 Chrome Extension Manifest V3 项目，用于全局监听网页网络请求中的图片和视频资源，并在 Popup 中筛选、预览和 ZIP 批量下载。

项目采用轻量构建流程：运行时源码放在 `src/`，`npm run build` 会生成可加载到 Chrome 的 `dist/` 目录。修改源码后需要重新构建，并在 `chrome://extensions` 中重新加载扩展。

## 目录职责

- `src/manifest.json`: MV3 扩展清单，声明权限、后台 service worker、popup、options、content script 和图标。
- `src/background/index.js`: 核心后台逻辑，包括 `webRequest` 监听、右键菜单、消息路由、offscreen ZIP 打包编排和下载触发。
- `src/offscreen/`: offscreen document（`offscreen/index.html` + `offscreen.js`），在完整 DOM 上下文中抓取媒体并打包 ZIP，由 background 按需创建/关闭。
- `src/lib/constants.js`: 全局常量、默认设置和 message type 定义。
- `src/lib/i18n.js`: `chrome.i18n` 的轻量封装，提供 `t(key, ...args)` 与 `applyI18n(root)`。
- `src/_locales/{zh_CN,en}/messages.json`: 中英文案源（`default_locale` 为 `zh_CN`）。新增语言只需新增目录。
- `src/lib/store.js`: `chrome.storage.local` 上的媒体、设置和统计数据管理。
- `src/lib/downloader.js`: 批量下载、并发控制和下载状态更新。
- `src/lib/zip.js`: 无压缩 ZIP 打包工具，由 offscreen 文档调用（支持 `onProgress` 进度回调）。
- `src/lib/utils.js`: URL、文件名、大小格式化、去重 key 等通用工具。
- `src/popup/`: 弹窗页面 UI、样式和交互逻辑。
- `src/options/`: 设置页 UI、样式和交互逻辑。
- `src/content/index.js`: 页面内图片尺寸收集和动态图片观察。
- `src/assets/`: 扩展图标。
- `dist/`: `npm run build` 生成的 Chrome 加载目录，不手动编辑。
- `docs/`: 官网落地页静态站点（无远程资源），通过 Deploy Docs 工作流部署到 GitHub Pages。`privacy.html` 是商店要求的隐私政策页；`store-listing.md` 是商店提交文案与素材清单（不上线，仅作提交依据）。
- `.github/workflows/`: `deploy-docs.yml` 部署 docs 落地页；`release.yml` 在推送 `v*` 标签时测试、打包并发布 GitHub Release。
- `scripts/build.js`: 清理并复制 `src/` 到 `dist/`，同时校验 manifest 引用文件和 offscreen 文件。
- `scripts/pack.js`: 构建后生成 zip 包到 `packages/`。
- `scripts/release.sh`: 本地发布脚本（`npm run release`），测试 → 打包 → 打 tag 推送。
- `scripts/gen-icons.py`: 生成 PNG 图标的脚本。
- `specs/`: 功能、重构和 bugfix 设计文档目录。

## 常用命令

```bash
npm run dev
```

会生成 `dist/`，并提示在 Chrome 中加载 `dist/` 目录；不会启动 dev server。

```bash
npm run build
```

清理并生成 `dist/`。Chrome 应加载该目录，而不是项目根目录。

```bash
npm test
```

运行 Jest 单元测试。当前测试覆盖 `src/lib/` 工具、存储、下载管理器，以及部分 background 消息处理。

```bash
npm run test:watch
npm run test:coverage
```

分别用于监听模式和覆盖率测试。

```bash
python3 scripts/gen-icons.py
```

重新生成 `src/assets/icon-16.png`、`src/assets/icon-48.png`、`src/assets/icon-128.png`。

```bash
npm run pack
```

构建 `dist/` 并生成 `packages/open-download-<version>.zip`。

```bash
npm run release
```

本地发布：校验工作区干净 → 测试 → 打包 → 创建并推送 `v<version>` 标签（触发 Release 工作流发布 GitHub Release）→ 推送 master（触发 docs 部署）。

```bash
npm run deploy:docs
```

手动触发 Deploy Docs 工作流，部署 `docs/` 落地页到 GitHub Pages（首次需在仓库 Settings → Pages 将 Source 设为 GitHub Actions）。

## 开发与验证

1. 在 Chrome 打开 `chrome://extensions`。
2. 开启「开发者模式」。
3. 运行 `npm run build`。
4. 选择本项目的 `dist/` 目录作为「加载已解压的扩展程序」。
5. 修改代码后重新运行 `npm run build`，再点击扩展卡片上的重新加载按钮。
6. 验证 Popup、Options、后台日志和实际下载行为。

当前仓库有 Jest 自动化测试和构建脚本，但没有 lint 或 bundler 配置。做功能变更时，先运行 `npm test` 和 `npm run build`；涉及真实 Chrome API、Popup、Options 或扩展权限时，还需要手动验证：

- Popup 可以打开，监听开关能更新状态。
- 开启监听后浏览普通网页能捕获图片和视频。
- 搜索、大小筛选、媒体类型和扩展名筛选不报错。
- 列表视图和卡片视图切换正常，选择状态不丢失。
- 下载选中和下载全部能生成单个 ZIP 并调用 Chrome downloads API。
- Options 设置保存后 Popup/background 读到的是新配置。

## 代码约定

- 使用原生 ES modules，保持相对路径导入，例如 `../lib/constants.js`。
- 保持轻量构建结构，不引入框架或打包器，除非用户明确要求。
- 面向 Chrome MV3 API 编写代码，后台脚本是 service worker，需注意生命周期和异步消息响应。
- `chrome.runtime.onMessage.addListener` 中如需异步 `sendResponse`，保留 `return true`。
- 新的跨模块消息类型先添加到 `src/lib/constants.js` 的 `MESSAGE_TYPES`，再在发送端和接收端使用。
- 设置默认值放在 `DEFAULT_SETTINGS`，存储键放在 `STORAGE_KEYS`。
- 下载和存储状态应通过 `ImageStore`、`DownloadManager` 这两个边界更新，避免 UI 直接改 storage 结构。
- 避免把大量业务逻辑写进 HTML；Popup 和 Options 的行为分别放在对应 JS 文件。
- 现有代码注释以中文为主；新增注释保持简短，只解释不明显的行为。
- **所有用户可见文案必须走 i18n**：JS 里用 `t('key')`，HTML 里用 `data-i18n` / `data-i18n-placeholder` / `data-i18n-title`（元素不写中文兜底文本），右键菜单标题用 `__MSG_key__`。新增 key 要同时补 `zh_CN` 与 `en`，`npm test` 会校验两份文件的 key 集合一致、被引用的 key 存在，并禁止 popup/options 出现硬编码中文。

## Chrome 扩展注意事项

- `webRequest` 在 MV3 中用于观察请求，不要实现阻塞或拦截式逻辑，除非同步调整权限和架构。
- `src/background/index.js` 的 `webRequest.onCompleted` 监听器在**模块顶层注册**，每次 SW 启动同步挂载；是否捕获由 `settings.enabled` 决定（不再使用 `isListening` 标志和动态增删监听器）。不要把监听器注册改回条件分支内。
- ZIP 打包依赖 background 与 offscreen document 的消息编排（`ZIP_BUILD_*` 消息族），offscreen 文档由 `ensureOffscreenDocument()` 按需创建，下载结束后关闭；修改时注意 blob URL 的生命周期。
- `chrome.storage.local` 是异步 API，但当前 `store.addImage()` 内部有 fire-and-forget 保存行为。涉及一致性或批量更新时要谨慎。
- `src/content/index.js` 向 background 发送 `DOM_MEDIA_UPDATE`（img + video 候选）：已存在的记录只富化尺寸/时长/封面，webRequest 漏捕的资源兜底入库并标注 `source: 'dom'`。content script 不是 ES module，其消息类型是字符串字面量，改名时必须与 `src/lib/constants.js` 同步。
- `src/content/index.js` 同时承载自动滚动抓取（`SCROLL_CAPTURE_START/STOP`），结束时补一次全量扫描以覆盖「懒加载改写既有节点 src」的情况。
- 批量下载由 `src/background/index.js` 的 `planTransfer()` 决定走 ZIP 还是逐条直下：超阈值（`settings.transfer`）改直下并复用 `DownloadManager`，未超阈值按 `maxZipFiles` / `maxZipBytes` 分卷串行打包，每卷结束即回写状态。
- `src/lib/utils.js` 的 `isImageUrl()` 使用 `IMAGE_EXTENSIONS`，如修改该函数，确认常量导入正确。

## UI 修改指南

- Popup 是紧凑工具界面，优先保证信息密度、可扫描性和按钮状态清晰。
- Options 是表单配置页，优先保持字段含义和默认设置一致。
- 变更 DOM id/class 前，同步检查对应的 JS 查询选择器和 CSS。
- 不要加入需要远程资源才能显示的 UI 资产；扩展页面应尽量离线可用。

## 数据模型

捕获媒体对象大致包含：

```js
{
  id,
  mediaType,
  url,
  filename,
  extension,
  domain,
  mimeType,
  size,
  width,
  height,
  duration,
  alt,
  capturedAt,
  tabUrl,
  tabTitle,
  downloaded,
  status
}
```

设置对象以 `DEFAULT_SETTINGS` 为准，常见字段包括：

- `enabled`
- `autoDownload`
- `minImageSize`
- `maxImageSize`
- `concurrency`
- `savePath`
- `dedupe`
- `fileNaming`
- `sendCookies`（打包请求是否携带 Cookie，默认关闭）
- `siteRules`（`{ [domain]: 'block' }`，整表替换语义，无键 = 跟随全局）
- `transfer`（大文件旁路与分卷阈值：`bypassFileSize` / `bypassBatchSize` / `unknownVideoSize` / `maxZipFiles` / `maxZipBytes` / `maxConcurrencyForLarge` / `downloadTimeoutMs`）
- `ui.viewMode`
- `ui.mediaType`
- `ui.groupByPage`
- `ui.sourceFilter`
- `filters.domains`
- `filters.extensions`
- `filters.mediaTypes`
- `filters.minDimensions`

media 记录中与捕获来源相关的字段：`source`（`'network' | 'dom'`，老数据归一为 `network`）、`duration`（视频时长，秒）。

## 变更前检查清单

- 是否需要新增或复用 `MESSAGE_TYPES`？
- 是否影响 `chrome.storage.local` 中已保存的数据兼容性？
- 是否会增加 MV3 权限？如果会，更新 `src/manifest.json` 和 README。
- 是否会改变下载文件名或目录？确认 `chrome.downloads.download` 的限制。
- 是否需要在 Popup、Options、background 三处同步更新？

## 交付说明

完成修改后，在回复用户时说明：

- 改了哪些文件。
- 如何手动验证。
- 哪些自动化检查未运行或当前不存在。
