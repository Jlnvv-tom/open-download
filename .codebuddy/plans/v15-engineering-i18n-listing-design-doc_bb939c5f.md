---
name: v15-engineering-i18n-listing-design-doc
overview: 为 v1.5「工程强化 + 国际化 + 上架」编写完整设计文档（覆盖 RoadMap 的 V15-01~V15-05 全部五个任务），并在 RoadMap.md 的 v1.5 章节补充指向该文档的链接，写法与既有 v1.3/v1.4 保持一致的 "* `specs/`" 风格。
todos:
  - id: create-spec-dir
    content: 创建 specs/features/v15-engineering-i18n-listing/ 目录并写好元信息头与第 1 章概述（背景/目标/非目标）
    status: completed
  - id: write-overview-scenarios
    content: 编写第 2 章任务总览表格（V15-01~05 顺序、优先级、预估、依赖）与第 3 章 Given/When/Then 场景
    status: completed
    dependencies:
      - create-spec-dir
  - id: write-fr-transfer
    content: 编写 FR-1 大文件旁路/分卷与 FR-2 打包带 Cookie（保守取向，引用真实函数与消息类型）
    status: completed
    dependencies:
      - write-overview-scenarios
  - id: write-fr-i18n-listing
    content: 编写 FR-3 i18n 双语落地、FR-4 上架 Chrome Web Store、FR-5 Firefox 评估
    status: completed
    dependencies:
      - write-overview-scenarios
  - id: write-tail-sections
    content: 补全第 5 至 9 章：消息/设置变更汇总、边界情况表、涉及文件表、测试计划、交付验证清单
    status: completed
    dependencies:
      - write-fr-transfer
      - write-fr-i18n-listing
  - id: link-roadmap
    content: 在 RoadMap.md v1.5 章节补「详见设计文档」链接，格式与 v1.3/v1.4 一致
    status: completed
    dependencies:
      - write-tail-sections
  - id: doc-self-check
    content: 用 [subagent:code-explorer] 核对文档引用文件路径与符号真实存在，并校验相对链接可达
    status: completed
    dependencies:
      - link-roadmap
---


## 产品概述
为 v1.5「工程强化 + 国际化 + 上架」版本编写一份开发计划设计文档，作为后续实现的唯一依据。文档须覆盖 RoadMap v1.5 章节的全部五个任务，并与 v1.3/v1.4 既有设计文档体例保持一致。

## 核心功能（文档须包含的内容）
- **V15-01（P0）大文件旁路与 ZIP 分卷**：采用保守取向——超阈值（单文件 >50MB 或整包预估 >500MB）自动改为逐条 `chrome.downloads.download`，复用现有 `DownloadManager` 并发路径；`zip.js` 维持单 Blob 结构不变，仅在 `makeZipFilename` 基础上加分卷命名；解决 300s 打包超时静默失败、进度与失败原因不可见的问题。
- **V15-02（P1）打包携带 Cookie 可选**：`ZIP_BUILD_REQUEST` payload 透传 `credentials`，`createMediaZip` 的 fetch 支持 `include`；默认关闭，在 Options 页说明隐私影响。
- **V15-03（P0）i18n 中英双语**：按 `chrome.i18n` 标准落地 `src/_locales/zh_CN`、`src/_locales/en`，manifest 加 `default_locale`；抽离 popup/options/右键菜单文案；预留多语言扩展（新增语言只需加目录）。
- **V15-04（P0）上架 Chrome Web Store**：`docs/` 新增 Privacy Policy 页（保持无远程资源约束）、中英双语商店描述与素材清单、权限使用说明须与实现一致（`webRequest` 仅观察、无远程代码、无上报）。
- **V15-05（P2）Firefox 移植可行性评估**：产出调研结论（webRequest / offscreen / storage 差异），给「做/不做」建议，不实现。

## 交付物
1. 新建 `specs/features/v15-engineering-i18n-listing/2026-09-21-v15-engineering-i18n-listing-design.md`（自包含完整文档，不拆分）。
2. 修改 `RoadMap.md` v1.5 章节，补充指向该文档的相对链接（格式照抄 v1.3/v1.4 章节）。



## 交付形态
本次为文档交付任务，**不改动 `src/` 任何代码**，不执行 `npm run build`（构建不受影响）。文档写入位置严格遵循 `specs/README.md` 规范：分类目录 `specs/features/<kebab-case主题>/`，文件名 `YYYY-MM-DD-<kebab-case>.md`，一个文件一个完整文档。

## 文档结构（对齐既有 v1.4 设计文档体例）
```
# v1.5 工程强化 + 国际化 + 上架开发计划
- 日期 / 状态 / 上游计划 / 前置 / 分析依据      ← 相对链接：../../../RoadMap.md、../../analysis/competitive-analysis-roadmap/...
1. 概述（1.1 背景、1.2 目标、1.3 非目标）
2. 任务总览与实现顺序（表格：顺序|任务|优先级|预估|依赖|一句话说明 + 总人日）
3. 用户场景（Given/When/Then，覆盖 V15-01~05 五个场景 + 上架/语言切换场景）
4. 功能需求与实现方案（FR-1~FR-5，每个含 需求 / 方案 / 验收）
5. 消息类型与数据结构变更汇总（MESSAGE_TYPES、DEFAULT_SETTINGS 新增字段）
6. 边界情况（表格）
7. 涉及文件（表格：文件 | 变更）
8. 测试计划（按 utils / store / background / zip 分组）
9. 交付与手动验证清单
```

## 写作约束（必须遵守，防止文档失真）
- 所有引用的文件路径、函数/常量名必须取自真实代码：`zip.js` 的 `createMediaZip` / `makeZipFilename` / `uniqueZipFilename`、`offscreen.js` 的 `ZIP_BUILD_REQUEST` 处理与 `buildZip`、`background/index.js` 的 `handleDownloadZip` / `ZIP_BUILD_TIMEOUT=300000` / `ensureOffscreenDocument` / `waitForOffscreenReady`、`downloader.js` 的 `DownloadManager.downloadBatch` / `cancelOne` / `cancelAll`、`constants.js` 中已预留的 `DOWNLOAD_SELECTED`（注释明确「保留给 v1.5 大文件旁路（V15-01）复用」）、`DEFAULT_SETTINGS` 现有字段与 `_mergeSettings` 默认值兜底机制。
- V15-01 一律按**保守取向**撰写：不引入传输策略抽象、不改造 `zip.js` 流式写出；新增阈值常量放 `DEFAULT_SETTINGS`，判定逻辑放在 background 编排层，直下复用 `DownloadManager`。
- V15-03 i18n 范围须包含 v1.4 尚未落地的新增 UI 文案（站点行、时长角标、来源筛选、滚动抓取按钮、分组头），避免 v1.4 完成后 i18n 返工。
- 「前置」章节须如实写明：v1.4 五任务整体未完成（已完成底座、未完成接线/UI/测试），至少 V14-01/02/04 完成后进入 v1.5。
- 不得新增 npm 依赖、不得引入框架或打包器（AGENTS.md 硬约束）；`docs/` 新增页面必须无远程资源。
- 不得输出 emoji，全文中文。

## 自检方式
- 文档内所有相对链接（RoadMap.md、analysis 文档）按 `specs/features/<主题>/` 层级核对可达。
- 文档第 7 节列出的每个文件在仓库中真实存在；涉及的函数名/消息类型经 grep 核对。
- 任务编号 V15-01~05 与 RoadMap v1.5 章节逐字一致。


## Agent Extensions
### SubAgent
- **code-explorer**
  - Purpose: 在文档自检阶段核对第 7 节「涉及文件」与实际代码符号的一致性
  - Expected outcome: 输出「文件名 / 引用的函数与常量是否在代码中存在」核对结论，消除文档中的臆造路径与臆造 API
