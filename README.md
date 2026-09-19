# Open Download — 网络媒体批量下载器

Chrome 扩展 (Manifest V3) — 全局监听网络请求，自动识别图片和视频资源，并支持按类型筛选、预览和 ZIP 批量下载。

📚 **在线文档与介绍**：https://wujihuan.github.io/open-download/ （由 `docs/` 落地页自动部署）

## 功能

- 🌐 **全局监听** — 不区分网站，监听所有网络请求中的图片和视频资源
- 🔍 **智能识别** — 通过 `webRequest` + `Content-Type` + 文件扩展名三重判断
- 📦 **ZIP 批量下载** — 打包在后台 offscreen document 中进行，关闭弹窗不中断，进度实时显示
- 🎯 **灵活过滤** — 按图片/视频、格式、域名、扩展名、文件大小、图片宽高筛选
- 🖼️ **双视图预览** — Popup 支持列表视图和卡片视图
- ⚙️ **丰富的设置** — 自动下载、保存目录、命名方式、捕获媒体类型等
- 📊 **统计面板** — 捕获数 / 已下载 / 失败数

## 快速开始

### 安装到 Chrome

先生成插件产物：

```bash
npm run build
```

1. 打开 `chrome://extensions`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本项目的 `dist/` 目录

### 使用

1. 点击工具栏中的 Open Download 图标
2. 打开「监听」开关
3. 正常浏览网页，插件会自动捕获图片和视频请求
4. 在 Popup 中通过「图片 / 视频」和格式 Tab 筛选资源
5. 切换列表视图或卡片视图浏览资源
6. 选择需要的资源，点击「下载选中」或「全部下载」生成 ZIP 下载

## 项目结构

```
open-download/
├── src/                   # 扩展源码，会被复制到 dist/
│   ├── manifest.json      # MV3 清单文件
│   ├── background/
│   │   └── index.js       # Service Worker — 核心监听 + 消息处理 + ZIP 打包编排
│   ├── popup/
│   │   ├── index.html     # 弹出窗口 UI
│   │   ├── popup.css      # 弹出窗口样式
│   │   └── popup.js       # 弹出窗口逻辑
│   ├── options/
│   │   ├── index.html     # 设置页面
│   │   ├── options.css    # 设置页面样式
│   │   └── options.js     # 设置页面逻辑
│   ├── offscreen/
│   │   ├── index.html     # Offscreen 文档（ZIP 打包专用）
│   │   └── offscreen.js   # 抓取媒体资源并打包 ZIP
│   ├── content/
│   │   └── index.js       # Content Script — 补充图片尺寸信息
│   ├── lib/
│   │   ├── constants.js   # 常量定义
│   │   ├── utils.js       # 工具函数
│   │   ├── store.js       # 媒体存储管理 (chrome.storage)
│   │   ├── downloader.js  # 批量下载管理器
│   │   └── zip.js         # ZIP 打包工具
│   └── assets/            # 图标资源
├── docs/                  # 官网落地页（GitHub Pages 部署源）
├── .github/workflows/     # CI：docs 部署 + Release 发布
├── scripts/               # 构建、打包、发布、图标生成脚本
├── __tests__/             # Jest 单元测试
└── dist/                  # 构建产物，加载到 Chrome 的目录
```

## 开发命令

```bash
npm run build
```

清理并生成 `dist/` 插件目录。

```bash
npm run dev
```

生成 `dist/`，并提示在 Chrome 中加载该目录。

```bash
npm test
```

运行 Jest 单元测试。

```bash
npm run pack
```

构建 `dist/` 并生成 `packages/open-download-<version>.zip`。

## 发布与部署

### 发布新版本（扩展 Release）

```bash
npm run release
```

该命令会：校验工作区干净 → 运行测试 → `npm run pack` 打包 → 创建并推送 `v<version>` 标签 → 推送 master。

推送标签后，GitHub Actions 的 **Release** 工作流会自动运行测试、打包并把 `packages/open-download-<version>.zip` 发布为 GitHub Release。

> 前提：`package.json` 与 `src/manifest.json` 的 `version` 已同步更新；需要已安装并登录 [GitHub CLI](https://cli.github.com/)（用于部分流程提示）。

### 部署官网落地页（GitHub Pages）

`docs/` 落地页通过 **Deploy Docs** 工作流自动部署：推送到 master 且 `docs/**` 有变更时触发，也支持手动触发：

```bash
npm run deploy:docs
```

首次使用需在仓库 **Settings → Pages → Build and deployment** 中将 Source 设置为 **GitHub Actions**。

本地预览落地页：

```bash
python3 -m http.server 8080 -d docs
# 打开 http://localhost:8080
```

## 技术要点

### 网络请求监听

使用 `chrome.webRequest.onCompleted` 全局监听所有网络请求：

- 监听器在 Service Worker **模块顶层注册**，SW 每次启动同步挂载，休眠期间的请求可唤醒 SW，避免事件丢失；是否捕获由 `settings.enabled` 决定
- `urls: ['<all_urls>']` — 不区分网站
- `details.type === 'image' / 'media'` — 浏览器自动分类的图片或媒体资源
- `responseHeaders` — 获取 `Content-Type` 和 `Content-Length`

### ZIP 打包与 Offscreen Document

- ZIP 打包从 Popup 迁移到后台 [offscreen document](https://developer.chrome.com/docs/extensions/reference/offscreen)（`BLOBS` 用途），Popup 关闭不会中断打包
- 打包完成后 offscreen 文档生成 blob URL，background 调用 `chrome.downloads.download` 保存，下载结束后自动关闭 offscreen 文档
- 需要 Chrome 116+（`chrome.runtime.getContexts`），已在 manifest 中声明 `minimum_chrome_version`

### 权限

```json
{
  "permissions": ["webRequest", "downloads", "storage", "offscreen", "contextMenus"],
  "host_permissions": ["<all_urls>"]
}
```

### Manifest V3 兼容性

- `webRequest.onCompleted` 在 MV3 下仍可用于**观察性监听**（不拦截请求）
- Service Worker 作为后台脚本，需注意生命周期管理
- 使用 `chrome.storage.local` 持久化捕获的媒体数据

## License

MIT
