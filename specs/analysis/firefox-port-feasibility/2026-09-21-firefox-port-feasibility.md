# Firefox 移植可行性评估

- 日期：2026-09-21
- 归属：[RoadMap.md](../../../RoadMap.md) v1.5 章节 V15-05（P2）
- 性质：调研结论，不含实现。**结论：建议做，但不排在 v1.5，先与 v1.6 一并排期。**
- 触发背景：RoadMap 第 8 节把「Chrome 收紧 webRequest 权限政策」列为中概率风险，应对措施是评估 Firefox 作为备份渠道。

## 1. 结论摘要

| 问题 | 结论 |
|------|------|
| 是否可行 | 可行。代码结构（原生 ES module、无打包器、`chrome.*` API 用法保守）本身对移植友好 |
| 是否有阻塞点 | 有一个：**Firefox 没有 `chrome.offscreen`**，ZIP 打包宿主需要替换 |
| 预计工作量 | 1-1.5 人日适配 + 0.5 人日打包与 CI 双产物 |
| 建议时机 | 不排在 v1.5。v1.5 的 V15-01 明确不抽象传输宿主（见 3.1），此时移植会导致返工 |
| 建议方式 | v1.6 单独立项，先做「打包宿主抽象」这一项重构，再做平台适配层 |

## 2. 能力差异对照

| 能力 | Chrome MV3（当前实现） | Firefox MV3 | 影响 |
|------|----------------------|-------------|------|
| `webRequest` 观察 | `onCompleted` + `responseHeaders` | 支持观察，**不支持阻塞式** `webRequestBlocking` | 本项目只用观察用法，无影响 |
| 后台形态 | Service Worker（无 DOM、随时可被回收） | Event Page（**有 `window` 与 DOM API**，同样可被回收） | Firefox 侧反而可以直接在后台构建 Blob，不必借助 offscreen |
| `chrome.offscreen` | 有 | **无对应 API** | 主要阻塞点，见 3.1 |
| `chrome.downloads` | 支持，`filename` 只接受相对路径 | 支持，但 `filename` 的路径分隔符与非法字符处理更严格，且不支持绝对路径 | 需按平台分支 sanitize 文件名/目录，见 3.2 |
| `chrome.storage.local` | 支持 | 支持 | 无影响 |
| ES module 后台 | `"type": "module"` 的 service worker | `background.scripts` + `"type": "module"` 的实测支持不稳定，可能需要回退到打包为单文件的经典脚本 | 影响构建脚本，见 3.3 |
| `chrome.contextMenus` | 支持 | 支持 | 无影响 |
| `chrome.tabs.sendMessage` / content script | 支持 | 支持 | 无影响 |
| CSS `color-mix()` | 已用于 `popup.css`（`.duration-badge`、`.media-card-placeholder`） | Firefox 113+ 支持 | 无影响（RoadMap 已把最低版本定在较新的基线） |
| `chrome.i18n` + `_locales` | 支持 | 支持，`default_locale` 语义一致 | 无影响 |

## 3. 主要差异的具体影响

### 3.1 ZIP 打包宿主（唯一实质阻塞）

Chrome 侧现状：`background/index.js` 通过 `ensureOffscreenDocument()` 创建 offscreen 文档承载打包，`offscreen.js` 在完整 DOM 上下文里 `fetch` + `new Blob` + `URL.createObjectURL`，下载结束即 `closeOffscreenDocument()`（blob URL 随文档销毁失效，见 `src/background/index.js` 的 `buildZipVolume`）。

Firefox 侧最自然的替代：

- Event Page 自带 DOM API，**不需要 offscreen**，可直接在后台完成 `fetch` → `Blob` → 下载；
- 因而移植需要的不是「给 Firefox 找 offscreen 替代品」，而是**把「打包并产出 blob URL」这一步从 background 编排里抽象出来**：

```
ZipHost（接口）
├── OffscreenZipHost   // Chrome：ensure → build → close
└── InProcessZipHost   // Firefox：直接调用 createMediaZip
```

这正是 v1.5 明确**不做**的事（v15 设计文档 1.3 节非目标第 2 条：不做传输策略抽象），因为提前为单平台固化抽象层会限制 V16-02（视频默认不走 ZIP）的调整空间。因此移植必须等 `planTransfer` / 分卷编排稳定之后再抽象。

工作量集中在：抽接口（0.5 人日）+ offscreen 逻辑迁入新宿主（0.3 人日）+ 失败/超时路径复查（0.2 人日）。

### 3.2 下载文件名与目录

`DownloadManager.downloadImage()` 使用 `filename: \`${settings.savePath}/${filename}\``。Firefox 侧需要注意：

- 反斜杠会被当作字面字符而非分隔符，`savePath` 需统一为 `/`；
- Firefox 不接受以 `/` 开头的绝对路径，也不允许 `..`；`sanitizeFilename()` 已移除 `\ / : * ? " < > |`，风险可控；
- 需新增 `sanitizeSavePath()`（去掉前导斜杠、压掉空段），对两个平台都更安全。

工作量约 0.1 人日，且该改进对 Chrome 同样有益。

### 3.3 构建与打包

`scripts/build.js` 会把 `src/` 复制为 `dist/`，`scripts/pack.js` 打成 zip。若 Firefox 不能稳定使用 `"type": "module"` 的 service worker：

- 方案 A（推荐）：Firefox 侧改 `background.scripts` 并保留 ESM（需实测目标 Firefox 版本；Firefox 的 MV3 对 module background 支持在 v121 之后已可用）；
- 方案 B：为 Firefox 增加一个仅处理 background 入口的极简拼接步骤，其余文件原样复制。

CI 侧需要产出第二份产物（`open-download-<version>-firefox.zip`），并在 `scripts/pack.js` 增加 `--target=firefox` 分支。

## 4. 迁移清单（供立项时直接使用）

1. `src/manifest.json` 走平台模板：`background` 字段分叉、`browser_specific_settings.gecko.id` 必填。
2. 新增 `ZipHost` 抽象与两个实现，`buildZipVolume()` 改为依赖注入宿主。
3. `sanitizeSavePath()` 落 `src/lib/utils.js` 并补单测。
4. `chrome.*` → 保留 `chrome` 命名空间（Firefox 同时提供 `chrome` 与 `browser`，`chrome` 为回调/Promise 混合风格；本项目已按 Promise 用法编写，无需全局替换）。
5. i18n 文案无需改动，`_locales` 结构两端一致。
6. 打包脚本增加 Firefox 目标，`release.yml` 增加第二份产物附件。
7. 手动验证清单沿用 v1.5 设计文档第 9 节（场景 1-7），另加：Event Page 被回收后重新唤醒时，`planTransfer` 编排与进行中的分卷任务行为是否与 Chrome 一致。

## 5. 不做的风险

- 不做：Chrome 若收紧 `webRequest` 观察权限（例如要求用户显式授权每个站点），会缺少替代渠道，只能依赖「仅观察」用法的合规性说服审核。
- 做：需要长期维护双平台构建与验证清单，对业余投入的项目是持续的注意力成本。
- 综合判断：**做，但延后**。理由是当前 Firefox 侧无用户诉求，先把它作为风险预案保留在 RoadMap 中，等 v1.6 的平台适配器框架（V16-01）落地后一并处理，可复用同一套「平台差异集中在一个模块」的结构。
