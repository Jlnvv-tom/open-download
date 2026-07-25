# AGENTS.md

面向 AI 编码助手的项目指南。修改本仓库时，优先遵循本文档；如果与用户的明确要求冲突，以用户要求为准。

## 项目概览

Open Download 是一个 Chrome Extension Manifest V3 项目，用于全局监听网页网络请求中的图片和视频资源，并在 Popup 中筛选、预览和 ZIP 批量下载。

项目采用轻量构建流程：运行时源码放在 `src/`，`npm run build` 会生成可加载到 Chrome 的 `dist/` 目录。修改源码后需要重新构建，并在 `chrome://extensions` 中重新加载扩展。

## 目录职责

- `src/manifest.json`: MV3 扩展清单，声明权限、后台 service worker、popup、options、content script 和图标。
- `src/background/index.js`: 核心后台逻辑，包括 `webRequest` 监听、状态恢复、右键菜单、消息路由和下载触发。
- `src/lib/constants.js`: 全局常量、默认设置和 message type 定义。
- `src/lib/store.js`: `chrome.storage.local` 上的媒体、设置和统计数据管理。
- `src/lib/downloader.js`: 批量下载、并发控制和下载状态更新。
- `src/lib/zip.js`: 无压缩 ZIP 打包工具，用于 Popup 中的一次性 ZIP 下载。
- `src/lib/utils.js`: URL、文件名、大小格式化、去重 key 等通用工具。
- `src/popup/`: 弹窗页面 UI、样式和交互逻辑。
- `src/options/`: 设置页 UI、样式和交互逻辑。
- `src/content/index.js`: 页面内图片尺寸收集和动态图片观察。
- `src/assets/`: 扩展图标。
- `dist/`: `npm run build` 生成的 Chrome 加载目录，不手动编辑。
- `scripts/build.js`: 清理并复制 `src/` 到 `dist/`，同时校验 manifest 引用文件。
- `scripts/pack.js`: 构建后生成 zip 包到 `packages/`。
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

## Chrome 扩展注意事项

- `webRequest` 在 MV3 中用于观察请求，不要实现阻塞或拦截式逻辑，除非同步调整权限和架构。
- `src/background/index.js` 中监听器重复注册会造成重复捕获；修改启动/停止逻辑时确认 `isListening` 的语义。
- `chrome.storage.local` 是异步 API，但当前 `store.addImage()` 内部有 fire-and-forget 保存行为。涉及一致性或批量更新时要谨慎。
- `src/content/index.js` 会向 background 发送 `CONTENT_IMAGES_UPDATE`，`src/background/index.js` 会将尺寸信息补充到已捕获图片记录。
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
- `ui.viewMode`
- `ui.mediaType`
- `filters.domains`
- `filters.extensions`

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
