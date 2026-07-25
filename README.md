# Open Download — 网络图片批量下载器

Chrome 扩展 (Manifest V3) — 全局监听网络请求，自动识别并批量下载图片资源。

## 功能

- 🌐 **全局监听** — 不区分网站，监听所有网络请求中的图片资源
- 🔍 **智能识别** — 通过 `webRequest` + `Content-Type` + 文件扩展名三重判断
- 📦 **批量下载** — 支持并发控制、自动去重、文件命名策略
- 🎯 **灵活过滤** — 按域名、扩展名、文件大小筛选
- 🖼️ **缩略图预览** — Popup 中实时查看捕获的图片
- ⚙️ **丰富的设置** — 自动下载、保存目录、命名方式等
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
3. 正常浏览网页，插件会自动捕获图片请求
4. 在 Popup 中选择需要的图片，点击「下载选中」或「全部下载」

## 项目结构

```
open-download/
├── src/                   # 扩展源码，会被复制到 dist/
│   ├── manifest.json      # MV3 清单文件
│   ├── background/
│   │   └── index.js       # Service Worker — 核心监听 + 消息处理
│   ├── popup/
│   │   ├── index.html     # 弹出窗口 UI
│   │   ├── popup.css      # 弹出窗口样式
│   │   └── popup.js       # 弹出窗口逻辑
│   ├── options/
│   │   ├── index.html     # 设置页面
│   │   ├── options.css    # 设置页面样式
│   │   └── options.js     # 设置页面逻辑
│   ├── content/
│   │   └── index.js       # Content Script — 补充图片尺寸信息
│   ├── lib/
│   │   ├── constants.js   # 常量定义
│   │   ├── utils.js       # 工具函数
│   │   ├── store.js       # 图片存储管理 (chrome.storage)
│   │   └── downloader.js  # 批量下载管理器
│   └── assets/            # 图标资源
├── scripts/               # 构建、打包、图标生成脚本
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

## 技术要点

### 网络请求监听

使用 `chrome.webRequest.onCompleted` 全局监听所有网络请求：

- `urls: ['<all_urls>']` — 不区分网站
- `details.type === 'image'` — 浏览器自动分类的图片资源
- `responseHeaders` — 获取 `Content-Type` 和 `Content-Length`

### 权限

```json
{
  "permissions": ["webRequest", "downloads", "storage", "notifications"],
  "host_permissions": ["<all_urls>"]
}
```

### Manifest V3 兼容性

- `webRequest.onCompleted` 在 MV3 下仍可用于**观察性监听**（不拦截请求）
- Service Worker 作为后台脚本，需注意生命周期管理
- 使用 `chrome.storage.local` 持久化捕获的图片数据

## License

MIT
