# v1.6 差异化放大开发计划

- 日期：2026-09-22
- 状态：已实现（V16-01 ~ V16-05 五项全部落地；V16-05 的商店 ID 占位替换与教程截图待人工补齐）
- 上游计划：[RoadMap.md](../../../RoadMap.md)（v1.6 章节，任务编号 V16-xx 与本文档一致）
- 前置：v1.5 工程强化 + 国际化 + 上架已实现（V15-01/02/03/05/06 完成；V15-04 仓库内准备完成，商店提交待人工），详见 1.4 节
- 分析依据：[竞品对比分析与迭代路线图](../../analysis/competitive-analysis-roadmap/2026-09-19-competitive-analysis-and-roadmap.md)

## 1. 概述

### 1.1 背景

v1.3 ~ v1.5 的主线是「补短板」：把竞品标配补齐（单条下载、真取消、lightbox）、把捕获模型补成双通道（网络观察 + DOM 兜底）、把工程与发行补齐（大文件安全、i18n、上架材料）。到 v1.5 结束时，扩展在「能不能下」这件事上已经没有明显缺口。

v1.6 的定位不同：**从「能用」转向「别人做不到」**。RoadMap 给这一版对应的差距是 G5（平台适配 / 自动翻页）、G7（视频能力）与增长，主题词是「差异化放大」。

现状基线（v1.5 实现后的代码，本文档所有现状描述以此为准）：

1. **捕获是通用的，不感知站点**：`src/content/index.js` 的 `collectMediaElements()` 对全页 `img[src]` 与 `video` 做归一化收集，再通过 `DOM_MEDIA_UPDATE` 交给 `handleDomMediaUpdate()` 入库（`source: 'dom'`）。这套逻辑对任何站点一视同仁——好处是鲁棒，代价是「不够准」：懒加载占位图、低分辨率缩略图、成组的雪碧图与图标都会被一并收进来。
2. **视频与图片走同一条下载路径**：`planTransfer()` 只按 `size` 与两个阈值决定「ZIP 还是逐条直下」，不看媒体类型。视频（尤其是大体积、已能直链访问的）混在 ZIP 里没有收益，反而拖慢整包。
3. **捕获列表是「按时间倒序的平铺」**：有搜索、有类型/格式/大小/宽高/来源筛选、有按页面分组，但没有「内容维度」的判断能力——同一张图的多分辨率版本、同一素材在多个站点的重复出现，用户只能自己肉眼筛。
4. **没有任何增长机制**：扩展图标无角标（用户不知道有没有抓到东西）、无全局快捷键、右键只能对整页操作（不能「就下这一张图」）。
5. **落地页只有一页**：`docs/` 是单页落地站（`index.html` + `privacy.html` + `store-listing.md`），没有面向搜索引擎的场景化教程，也没有评分引导与社区入口。

同时必须正视 RoadMap 第 8 节给出的**高概率风险**：「平台适配器随站点改版失效」。这是 V16-01 一切设计取舍的前提——规则必须是**数据**而不是散落在逻辑里的 if/else，必须有**失效降级**回通用兜底的能力，否则站点一改版就会从「更准」退化为「更少」。

### 1.2 目标

- 把通用 DOM 兜底升级为**站点感知**的捕获：规则与引擎分离、规则可数据化贡献，规则失效时行为回落到今天的通用兜底（V16-01）。
- 视频默认走逐条直链下载，不再混进 ZIP（V16-02）。
- 提供**本地、离线**的内容级筛选能力：相似图归并、清晰度排序（V16-03）。
- 补齐三个增长杠杆：图标角标、全局快捷键、页面右键「下载此图」（V16-04）。
- 把落地页从「一页介绍」扩展为「能带来自然流量的场景化教程」，并建立商店评分与社区反馈入口（V16-05）。
- 全程不新增 npm 依赖、不引入框架或打包器、不新增数据上报。

### 1.3 非目标

明确不做，避免范围蔓延与合规风险：

- **不做 m3u8 / HLS 分片下载与合并**。RoadMap 明确其「工程量大，单独立项评估（含合规边界）」；本文档只做直链视频（`<video src>` 指向的单一资源）。
- **不做接口逆向**：不调用站点私有 API、不解析签名/加密参数、不模拟登录流程。V16-01 的规则只能作用于「页面上已经渲染出来的 DOM」，见 1.5 节合规边界。
- **不绕过登录与付费墙**（RoadMap 第 5 节非目标）。规则不包含任何针对鉴权链路的处理。
- **不做基于外部 API 的智能筛选**。V16-03 只实现本地算法；外部服务选项即使未来要做，也必须默认关闭且单独评审（本文档不含该实现）。
- **不做 Firefox 适配**。可行性评估的结论是「建议做，但不排在 v1.5，先与 v1.6 一并排期」，并明确「等 v1.6 的 V16-01 落地后一并处理」；唯一阻塞点是 offscreen 宿主抽象（`ZipHost`）。因此它属于 v1.6 之后单独立项的工作，不在本期范围，详见 [Firefox 移植可行性评估](../../analysis/firefox-port-feasibility/2026-09-21-firefox-port-feasibility.md)。
- **本期只内置 1 个示例站点规则**（决策见 FR-1）。原因是平台 ToS 与长期维护成本：内置规则越多，越容易随站点改版变成「持续追踪站点结构」的负担，而当前既没有真实用户反馈指明优先级，也没有社区贡献流程。
- 不新增 npm 依赖、不引入 UI 框架或打包器（AGENTS.md 硬约束）。
- 不引入云端存储与任何形式的数据上报；v1.6 的度量目标全部靠本地统计（见 FR-3 与第 9 节）。

### 1.4 前置与现状基线

**v1.5 交付状态**：V15-01（大文件旁路与 ZIP 分卷）、V15-02（打包携带 Cookie）、V15-03（i18n 中英双语）、V15-05（Firefox 可行性评估）、V15-06（UI 样式与可用性打磨）均已实现；V15-04（上架）在仓库内的准备已完成（`docs/privacy.html`、`docs/store-listing.md`、版本号 1.5.0），仅剩人工补截图与提交商店。

**与 v1.6 直接相关的现有实现**（本文档引用现状时以这些符号为锚点）：

| 能力 | 现有实现 | v1.6 的关系 |
|------|---------|------------|
| 请求观察捕获 | `src/background/index.js` 的 `onRequestCompleted()`，站内判定 `isCaptureAllowed(settings, domain)` | 不变 |
| DOM 兜底捕获 | `src/content/index.js` 的 `collectImageElements()` / `collectVideoElements()` / `collectMediaElements()` / `sendMediaUpdate()`；入库 `handleDomMediaUpdate()` | V16-01 在此之上加「站点感知」分支 |
| 批量下载策略 | `planTransfer(items, settings)` / `estimateSize()` / `splitVolumes()` / `handleDirectDownload()` / `handleZipDownload()` | V16-02 在 `planTransfer()` 增加媒体类型维度 |
| 预留的直下通路 | `MESSAGE_TYPES.DOWNLOAD_SELECTED`（`src/lib/constants.js:130`，注释写着「预留给 V16-02」） | V16-02 决定**删除**它（见 FR-2 第 3 条：本任务的实现路径不需要该消息） |
| 来源维度 | `media.source: 'network' \| 'dom'`；`ui.sourceFilter: 'all' \| 'network' \| 'dom'`（`src/lib/constants.js:94`）；popup 的三态按钮 `data-source` | V16-04 的右键入库需在此三态内取值，不得新增第四态（见 FR-4） |
| 站点级开关 | `settings.siteRules` + 右键 `open-download-site-toggle` + `SITE_RULES_CHANGED` | 不变 |
| 滚动抓取 | content script 的 `startScrollCapture()` / `stopScrollCapture()` + `SCROLL_CAPTURE_STATE` | V16-01 的规则可携带 `lazy` 选择器与它配合 |
| i18n | `src/lib/i18n.js` 的 `t()` / `applyI18n()`；`src/_locales/{zh_CN,en}/messages.json`（各 130 key） | 本期所有新增文案必须双语同步 |
| 存储 | `ImageStore`（`src/lib/store.js`），上限 `MAX_CAPTURED_IMAGES = 5000` | V16-03 若新增字段需考虑存储开销 |

**技术约束（写方案时不可违反）**：

1. **content script 是 classic script，不能 `import` ES module**。`src/manifest.json` 的 `content_scripts[0].js` 目前是 `["content/index.js"]`，且项目不引入打包器。这直接决定了 V16-01 规则库的落点（见 FR-1）。
2. **background 是 `type: module`**，可以正常 `import` `src/lib/**`，并且能被 Jest 直接 import 测试。
3. **Jest 环境是 `testEnvironment: "node"`，没有 jsdom**，`moduleFileExtensions` 只有 `["js"]`。任何依赖 DOM 的代码都无法自动化测试——这是 V16-03 算法必须写成纯函数的原因（见 FR-3）。
4. **`collectCoverageFrom` 只统计 `src/lib/**/*.js`**，所以把可测逻辑往 `src/lib/` 收是顺应现状的成本最低做法。
5. 现有测试 155 项必须保持全绿；`__tests__/i18n.test.js` 会强制校验中英 key 集合一致、被引用的 key 存在、popup/options 无硬编码中文（含全角标点）。

### 1.5 合规边界（V16-01 的硬约束）

站点适配器必须落在「**对页面上已渲染内容的更精准定位**」这一能力边界内，具体禁止项：

- 不请求站点私有接口、不解析签名/鉴权参数；
- 不注入脚本改写页面行为，不触发非用户可见的请求；
- 不针对登录态墙、付费墙做任何特殊处理（用户能看到什么就抓什么，与 v1.4/v1.5 的语义一致）；
- 不内置任何需要「绕过」才能访问的资源规则。

示例规则的选择也受此约束：只选**公开页面、无登录墙、结构稳定**的站点，且以「演示框架能力」为目的，不追求覆盖度（见 FR-1 的决策）。

## 2. 任务总览与实现顺序

| 顺序 | 任务 | 优先级 | 预估 | 依赖 | 一句话说明 |
|:---:|------|:---:|:---:|------|-----------|
| 1 | V16-01 平台适配器框架 | P0 | 2.5d | v1.5 已实现 | 规则库与匹配纯函数放 `src/lib/`，content script 只加一层「按 plan 提取」 |
| 2 | V16-04 增长功能 | P1 | 1d | 无 | 图标角标、全局快捷键、右键「下载此图」，三项互相独立 |
| 3 | V16-02 视频直链下载 | P1 | 0.5d | V15-01 已实现 | `planTransfer()` 增加媒体类型维度，并删除无使用场景的 `DOWNLOAD_SELECTED` |
| 4 | V16-03 智能筛选探索 | P1 | 2d | V16-01 | pHash 归并相似图 + 清晰度评分，算法纯函数化以便在 node 环境测试 |
| 5 | V16-05 增长运营 | P2 | 1d | V16-01 ~ V16-04 定型 | docs 场景化教程与 SEO、商店评分引导、Issue 模板 |

合计约 7 人日 + 测试与手动验证缓冲，与 RoadMap 的「4 周+（业余投入）」一致。P0 只有 V16-01，它完成后 v1.6 即具备可发布性；V16-04 与 V16-02 相互独立、可穿插；V16-03 是探索性任务，若算法效果不理想可按 FR-3 的降级方案只交付「清晰度排序」而不交付「相似归并」；V16-05 必须等前面功能定型后再写教程，否则文案会重复返工。

排序理由（与 RoadMap 的 P0→P2 原则一致，但顺序上做了两处调整）：

- **V16-04 提前到第 2 位**：三项都是独立小改动（角标 / 快捷键 / 右键菜单），不依赖适配器，且能立刻改善「装了之后没人用」的问题。让它排在 V16-01 之后而非之前，是因为 V16-01 是 P0，且会改动 `handleDomMediaUpdate()` 的入口，先改完再叠加新增入口可以少一轮冲突。
- **V16-03 排在 V16-02 之后**：相似图归并的阈值调参依赖稳定的捕获集合，而 V16-01 会改变集合构成（更准、更少噪音）。等 V16-01 落地并跑一段时间后再调阈值，返工概率最低。

## 3. 用户场景

**场景 1：站点感知捕获（V16-01）**
**Given** 用户在一个已内置规则的站点（示例规则站点）上浏览图片列表页，监听已开启
**When** 页面渲染出内容列表
**Then** 扩展按规则的 `itemSelector` 定位条目，而不是对全页 `img` 无差别收集：懒加载占位图、站点图标、骨架屏图片不入库；同一张图的多分辨率候选只保留规则声明的目标字段（主图 URL）与真实尺寸；捕获列表里的条目数量明显少于通用兜底，但都是用户想要的。

**场景 2：规则失效不导致能力倒退（V16-01 边界）**
**Given** 示例站点改版，规则里的 `itemSelector` 已匹配不到任何元素
**When** 用户在同一站点浏览并触发捕获
**Then** 扩展检测到规则零命中，自动回落到今天的通用兜底扫描（`collectMediaElements()` 的全页收集），捕获结果与 v1.5 完全一致；控制台留一条可诊断的提示（规则 id 与零命中事实），不向用户报错、不阻塞其它站点。

**场景 3：视频默认不进 ZIP（V16-02）**
**Given** 用户在弹窗里选中了一批媒体，其中既有图片也有视频
**When** 点击「下载选中」
**Then** 视频项走逐条直链下载（`chrome.downloads.download`，复用 `DownloadManager` 并发与状态回传），图片项按 `planTransfer()` 的既有阈值决定打包或逐条；结果提示里说明「视频已改为逐条下载」，用户不会因为「点一次下载却拿到散文件」而困惑。

**场景 4：相似图归并与清晰度排序（V16-03）**
**Given** 列表里有同一张图的 5 个分辨率版本（不同 URL、不同尺寸），以及若干构图相似但内容不同的图片
**When** 用户打开「归并相似图」开关
**Then** 5 个分辨率版本被折叠成一条（默认展示像素最多的那个，可展开查看其余版本）；构图相似但内容不同的图不被误合并；列表底部提示实际归并了几条。用户在筛选面板可以按「清晰度」排序，快速找到分辨率最高的那版。

**场景 5：捕获即时可见与一键下载此图（V16-04）**
**Given** 用户开启了监听并在正常浏览网页
**When** 页面捕获到新媒体
**Then** 扩展图标出现角标显示新增条数；用户打开弹窗后角标清零。用户在某张图上点击右键选择「Open Download: 下载此图」时，该图片直接进入捕获列表并立刻开始下载，无需先打开弹窗。

**场景 6：从搜索到上手（V16-05）**
**Given** 用户因为「怎么批量下载网页图片」之类的需求在搜索引擎里检索
**When** 用户打开落地页的场景化教程（例如「信息流长图站怎么一次抓全」）
**Then** 教程页面离线可读、无外部资源，包含可复制的操作步骤与对应截图位；页面提供商店安装入口与评分引导；仓库侧提供 Issue 模板，用户反馈规则失效时有结构化入口（附站点 URL、规则 id、期望与实际）。

## 4. 功能需求与实现方案

### FR-1（V16-01）平台适配器框架

**需求**：把现有的通用 DOM 兜底捕获升级为站点感知捕获。规则必须是**数据**（便于社区贡献、便于失效时替换），匹配与字段解析必须是**可单测的纯函数**，规则失效时行为必须**回落到 v1.5 的通用兜底**（不是报错、不是变少）。本期只内置 1 个示例规则。

#### 方案一：规则落点决策（本节是全篇最关键的技术决策）

约束回顾：`src/content/index.js` 是 classic script（`src/manifest.json` 的 `content_scripts[0].js = ["content/index.js"]`），**不能 `import` ES module**；background 是 `type: module`，可以 import；项目不引入打包器（AGENTS.md 硬约束）；Jest 只覆盖 `src/lib/**`。

| 候选 | 做法 | 优点 | 缺点 | 结论 |
|:---:|------|------|------|------|
| (a) | 规则作为第二个 content script（`js: ["content/site-rules.js", "content/index.js"]`），挂到 `globalThis` | 零异步、零 manifest 权限变化、同步可用 | 规则文件不能用 `export`，**单测需要 `node:vm` 或 `new Function` 加载**，等于放弃 Jest 的类型/导入链；规则与引擎都被推到无测试覆盖的 content 层；规则随每个页面下发 | 否决 |
| (b) | 规则为 JSON，配 `web_accessible_resources`，content 启动时 `fetch(chrome.runtime.getURL(...))` | 数据文件可直接被 `node:fs` 单测读取 | 引入异步初始化与 manifest 新字段；**把文件暴露给所有页面**（多余的可见面，且商店审核需解释）；解析失败路径要单独处理 | 否决 |
| (c) | 规则与引擎都放 `src/lib/`（ESM），**background 匹配并产出可序列化的提取计划，经消息下发给 content script**；content 只保留「按计划做 `querySelectorAll` 并读字段」的薄层 | 纯函数 100% 落在 Jest 可覆盖的 `src/lib/`；**零 manifest 变更**；零重复实现（匹配逻辑只有一份）；规则改动不需要碰 content script | 多一次消息往返（仅在页面启动时一次）与取不到计划时的降级路径 | **采用** |

选 (c) 的核心理由是**可测性**与**单一实现**：RoadMap 技术债里写着「v1.5 评估 content/offscreen 的可测性」，而 (a) 恰恰把新逻辑推到了最不可测的一层。消息往返的成本是一次性的（页面启动时请求一次计划，之后缓存在 content 内存里），远小于「规则匹配逻辑无法被测试」的长期成本。

#### 方案二：文件落点（遵循 `project-structure` 规范的 colocation 与反模式条款）

按 skill 的两条硬规则确定目录：**按领域切分、不要 catch-all 文件**（不复用 `src/lib/utils.js` 或新建 `helpers.js`），**不要 `index.js` 桶文件**（改用显式命名的聚合模块）。同时遵守现有分层：纯逻辑进 `src/lib/`，DOM 适配留在 `src/content/`。

```
src/lib/site-rules/
├── engine.js       # 纯函数：normalizeHostPattern / matchSiteRule / buildExtractPlan / validateRule
├── registry.js     # SITE_RULES 数组，显式列出内置规则（不用 index.js 自动扫描）
└── wikipedia.js    # 本期唯一内置的示例规则（纯数据）
```

- `engine.js` 不 import 任何规则，`registry.js` import 各规则文件并聚合，避免循环依赖；
- 新增一个站点规则 = 新增一个数据文件 + 在 `registry.js` 加一行 import，**不触碰 content script、不触碰 manifest**；
- `src/content/index.js` 只新增「按 plan 提取」的一层薄分支与一次计划请求。

#### 方案三：规则 schema

规则为纯数据，字段如下（`engine.js` 用 `validateRule()` 校验，内置规则在单测里必须全部通过校验）：

```js
{
  id: 'wikipedia',            // 稳定标识，用于诊断与 Issue 模板回填
  label: 'Wikipedia article', // 面向反馈与日志的可读名
  version: 1,                 // 规则自身版本，站点改版时递增便于追踪
  match: {
    hosts: ['*.wikipedia.org'],   // 精确域名或 *. 后缀通配
    pathPattern: '^/wiki/',       // 可选，正则字符串
    excludePathPattern: '',       // 可选
  },
  // 命中后优先使用规则结果；exclusive 为 true 时不再叠加通用兜底
  exclusive: true,
  itemSelector: '#mw-content-text img',
  excludeSelectors: ['.mw-editsection img', 'img[src*="/static/"]'], // 站点 UI 噪音
  fields: {
    url:     { selector: 'img', from: 'prop', name: 'currentSrc',
               fallback: { from: 'attr', name: 'data-src' } },
    width:   { selector: 'img', from: 'prop', name: 'naturalWidth' },
    height:  { selector: 'img', from: 'prop', name: 'naturalHeight' },
    alt:     { selector: 'img', from: 'attr', name: 'alt' },
    duration:{ selector: 'video', from: 'prop', name: 'duration' },
    poster:  { selector: 'video', from: 'attr', name: 'poster' },
  },
  lazy: {                        // 可选：与既有自动滚动抓取配合
    moreSelector: '',            // 「加载更多」按钮；存在且可见时点它而不是滚动
    settleMs: 800,               // 点击后等待新内容渲染的时间
  },
}
```

字段描述符的 `from` 取值限定为 `'attr' | 'prop' | 'dataset' | 'text'` 四类，这是一个可序列化的迷你 DSL：

- `normalizeFieldDescriptor()`（纯函数，`engine.js`）负责把 schema 归一为带默认值的描述符；
- content script 侧只做「读 `attr` / 读 `prop` / 读 `dataset` / 读 `textContent`」这四种取值动作（约 15 行，无法自动化测试，靠手动验证兜底）。

字段缺省时的行为：`url` 缺失 → 该条目丢弃（无法下载）；`width/height/alt/duration/poster` 缺失 → 回落到通用兜底的默认值（`0` / `''`），不丢条目。

#### 方案四：计划下发与降级

新增消息类型 `GET_SITE_PLAN`（content → background，`sendResponse` 返回计划或 `null`）：

```js
// content 启动时请求一次；URL 变化（SPA 路由）时重新请求
chrome.runtime.sendMessage({ type: 'GET_SITE_PLAN', payload: { pageUrl, pageDomain } })
// → { success: true, plan: { ruleId, ruleVersion, exclusive, itemSelector,
//                            excludeSelectors, fields, lazy } | null }
```

- content script 把 `plan` 缓存在内存（不落存储）；取不到（超时/无规则/后台未就绪）时 `plan = null`，行为与 v1.5 完全一致；
- **命中规则时的取值策略**：先按计划提取；`exclusive: true` 的规则只采信规则结果，若**零命中**则判定规则失效、本次扫描自动退回通用兜底；`exclusive: false` 时规则结果与通用兜底结果合并——因为 `urlDedupeKey` 会按 URL 去重，重复项不会重复入库；
- `DOM_MEDIA_UPDATE` 的 payload 增加两个诊断字段：`ruleId`（本次使用的规则 id，未使用时为 `''`）与 `ruleMiss`（规则零命中而退回兜底时为 `true`）。background 收到 `ruleMiss: true` 时按页面 URL 去重地打一条 `console.warn`（含规则 id），**不向用户报错、不弹窗**——这是「可诊断但不打扰」的原则，也为 V16-05 的规则失效 Issue 模板提供线索；
- SPA 路由变化的判定：每次 `sendMediaUpdate()` 前比较 `location.href` 与上次请求计划时的 URL，不同则重新请求（不监听 history 事件，避免在页面上下文注入额外钩子）。

#### 方案五：与自动滚动抓取的配合

规则可携带 `lazy.moreSelector`。`startScrollCapture()` 的每步逻辑改为：

1. 若存在 `lazy.moreSelector` 且该元素可见且未被禁用 → 点击一次，等待 `lazy.settleMs`；
2. 否则按现有逻辑 `window.scrollBy(0, 600)`；
3. 触底判定（连续 3 次）与 60s 超时不变。

这样「电商列表页」这类「点加载更多」而非「无限滚动」的页面也能抓全。**必填的降级**：`moreSelector` 不存在或点击后条目数不再增长，按触底处理，不允许出现「点了没反应但一直转」的情况。

#### 方案六：示例规则的选择

示例规则选 **Wikipedia 正文图片**（`*.wikipedia.org`，`pathPattern: '^/wiki/'`）：

- 站点**公开、无登录墙、结构长期稳定**，符合 1.5 节的合规边界，不触碰任何平台的高风险区域；
- 它恰好是「通用兜底噪音」的典型场景（编辑链接图标、语言切换图标、UI 图标都会被通用扫描收进来），能直观展示规则化的收益；
- 只内置 1 个，避免「内置规则随站点改版变成长期追踪负担」（见 1.3 节的决策理由）；社区贡献流程与更多规则等真实反馈后再加。

**验收**：`__tests__/site-rules.test.js` 覆盖匹配与计划生成；手动验证场景 1 与场景 2；`npm test` 全绿且原有 155 项不回归。

#### FR-1 的验收细则

1. 示例站点上，捕获列表不再出现站点 UI 图标与编辑链接图标；
2. 把 `itemSelector` 临时改成不存在的选择器（模拟站点改版），捕获结果与 v1.5 的通用兜底一致，且控制台出现一条含规则 id 的 warn；
3. 非示例站点上行为与 v1.5 完全一致（`GET_SITE_PLAN` 返回 `null`，走通用兜底）；
4. SPA 站点内切换路由后，规则按新 URL 重新匹配（示例：手动构造 `pathPattern` 只匹配部分路径，验证跨路由后计划被刷新）。

### FR-2（V16-02）视频直链下载

**需求**：视频默认不走 ZIP，改为逐条直链下载；复用 V15-01 已落地的大文件旁路与 `DownloadManager` 并发队列。m3u8/HLS 不在本期（见 1.3）。

**方案**

1. **设置项**：`DEFAULT_SETTINGS.transfer` 新增 `videoDirect: true`。默认开启即「视频默认不走 ZIP」；用户若想要整包（例如就是想一次性拿一个压缩包），可在 Options 关闭。

2. **策略扩展**：`planTransfer()` 增加媒体类型维度。当前它只看 `size` 与两个阈值，签名已接收 `settings`，扩展成本低。混合批次的处理是本任务的核心决策：

   | 方案 | 做法 | 问题 |
   |:---:|------|------|
   | (i) | 只要批次含视频就整批直下 | 选 1 个视频 + 100 张图会得到 101 个散文件，把 ZIP 的便利性完全丢掉 |
   | (ii) | 视频走直下、图片走既有 ZIP/阈值逻辑，产出两条路径 | 一次操作可能得到「散文件 + 一个 ZIP」两种产物 |
   | (iii) | 视频占多数才拆，否则整批直下 | 规则不可预测，用户无法形成稳定预期 |

   **采用 (ii)**，理由是「按媒体类型拆分」对用户是**可预测**的（用户看得见每条记录的类型，也理解「视频单独下」），而 v15 文档里否决混合产物的原因是「阈值是隐藏的，用户不知道为什么变成散文件」——两者的可解释性不同。对应的编排：

   ```js
   // planTransfer() 返回结构扩展
   { strategy: 'zip' | 'direct' | 'mixed', reason, volumes: Item[][], directItems: Item[] }
   ```

   编排规则：
   - 视频且 `videoDirect` 开启 → 进 `directItems`；
   - 其余条目 → 走既有 `estimateSize` / 阈值判定：超阈值则整批（指这批非视频条目）进 `directItems`，否则按 `maxZipFiles` / `maxZipBytes` 分卷进 `volumes`；
   - 两条路径都为空时按 v15 的原有语义返回单一策略；
   - `handleDownloadZip()` 依次执行「先直下 `directItems`，再打包 `volumes`」——先直下是因为它通常是用户更急的部分，也因为 ZIP 分卷耗时最长；单条失败不影响另一条路径，最终汇总 `{ succeeded, failed, strategy, volumes, failedItems }`，其中 `strategy` 为 `'mixed'` 时 popup 分别报数（「视频 3 个已逐条下载，图片 97 个打包为 1 卷」）。

3. **顺带清理 `DOWNLOAD_SELECTED`（重要）**：`src/lib/constants.js:130` 的注释写着「预留给 V16-02」，但本任务的实现路径是 `planTransfer()` 的 `mixed` 策略，**不需要这条消息**。上一轮审计已经把它标为「无发送方的死代码」，再留一轮就属于长期技术债。决策：**删除 `DOWNLOAD_SELECTED` 消息分支与常量**。

   - 需要「显式整批直下」的场景（如未来做「全部逐条下载」按钮）可以直接发 `DOWNLOAD_ZIP` + `payload.strategy = 'direct'`，该通路已实现且有单测覆盖（`__tests__/background.test.js` 的「DOWNLOAD_ZIP 显式 strategy=direct 时应该跳过阈值判定」）；
   - 需要同步更新的两处：`src/lib/constants.js:130` 的注释（当前写着「预留给 V16-02」，随常量一起删除）与 `RoadMap.md` 第 6 节技术债的 `DOWNLOAD_SELECTED` 条目（当前写着「计划随 V16-02 删除」，实施后改为「已删除」）。

4. **UI 与文案**：
   - Options 的「下载设置」卡片新增 `#video-direct` 复选框，文案说明「开启后视频逐条下载，不参与 ZIP 打包」；
   - popup 的结果汇总按 `strategy === 'mixed'` 分别报数（`formatDownloadSummary()` 扩展）；
   - i18n 新增 key 必须中英同步（见第 5 节清单）。

**验收**：手动验证场景 3；`__tests__/background.test.js` 覆盖 `planTransfer()` 的「纯视频 / 纯图片 / 混合 / videoDirect 关闭」四种分支。

删除 `DOWNLOAD_SELECTED` 时需配套改测试：现有 `__tests__/background.test.js` 里有一条**正面用例**「DOWNLOAD_SELECTED 应该收敛到统一编排并走直下」，删除消息分支后该用例必然失败，必须**改写为「已删除消息命中未知消息分支」的断言**（与现有的 `DOWNLOAD_ALL` / `EXPORT_IMAGES` 断言同一形态），而不是期待它继续通过。实施时已按此改写，其余用例不受影响。

### FR-3（V16-03）智能筛选探索

**需求**：提供本地的内容级筛选能力——相似图归并与清晰度评分/排序。主色聚类本期不做（收益不确定且改动面大，见下）。

**范围裁剪**：RoadMap 列了三项（感知哈希去相似图、清晰度评分、主色聚类）。本期只做前两项：主色聚类的产品价值最模糊（用户很难根据色系做决策），且需要额外的调色板提取与聚类 UI，属于「先验证前两项再说」的部分。

**方案**

1. **可测性优先的算法分层**（这是本任务能落地的前提，因为 Jest 是 `testEnvironment: "node"` 且没有 jsdom）：

   ```js
   // src/lib/image-hash.js —— 全部纯函数，接收像素数组，不碰 DOM
   export function computePhash(rgba, width, height, { hashSize = 8 } = {}) // → 16 位 hex 字符串
   export function hammingDistance(hexA, hexB)                              // → number
   export function computeSharpness(rgba, width, height)                    // → number（Laplacian 方差）
   export function groupBySimilarity(items, { maxDistance = 6 } = {})        // → 分组结果（纯数据）
   ```

   用 16 位 hex 字符串而不是 `BigInt` 存 hash：`chrome.storage.local` 走 JSON 序列化，`BigInt` 不能直接序列化；hex 字符串还能在调试时肉眼比对。

2. **像素来源与触发时机**：放在 **offscreen document**，并且**按需触发**（不在捕获期计算）：

   - 捕获期算 hash 会给每次页面扫描增加 fetch + decode 开销，直接损害 v1.4 建立起来的捕获性能；RoadMap 也没有要求实时；
   - offscreen 已有完整 DOM 与 Canvas，且现有 `ensureOffscreenDocument()` / `closeOffscreenDocument()` 机制可直接复用（复用同一个文档宿主，不新增 offscreen 用途声明）；
   - 触发路径：popup 点击「归并相似图」→ 新增消息 `PHASH_REQUEST` → background 确保 offscreen 存在 → offscreen 逐条 `fetch`（复用 `sendCookies` 设置）→ `createImageBitmap`/`canvas` 取像素 → 调 `computePhash()` / `computeSharpness()` → 分批回传 `PHASH_RESULT`（含 `done/total` 作为进度）→ background 写回 store → 关闭 offscreen；
   - 进度沿用「逐条回传」而不是引入第三套进度协议；失败逐条记录，最后汇总提示（「12 条无法计算，多为跨域或已失效链接」）。

3. **存储开销**：media 记录新增 `phash`（16 字符 hex）与 `sharpness`（number）。

   - 上限 5000 条时新增约 100~200KB，相对 `chrome.storage.local` 的容量可接受；
   - `_normalizeImage()` 与 `addMedia()` 补默认值 `phash: ''` / `sharpness: 0`，老数据经 normalize 自动补空（与 `source` 字段同一模式，**无迁移脚本**）；
   - `phash` 为空的条目各自成组，不参与归并。

4. **UI**：
   - 筛选面板新增「归并相似图」开关（`ui.mergeSimilar`，默认 `false`）。开启后，列表按相似度分组折叠：组内按 `sharpness` 降序，默认展示第一条（最清晰），组头显示「相似 N 张」并可展开；
   - 与已有的「按页面分组」互斥（两套分组语义不能同时生效）——开启相似归并时自动关闭按页面分组，并在按钮 title 里说明，不做静默切换；
   - 「按清晰度排序」选项（`ui.sortBy: 'capturedAt' | 'sharpness'`，默认 `capturedAt`）——排在 `renderListView()` / `renderGroupedListView()` 的排序入口处，实现成本低且对「挑最高清的那版」这个高频诉求直接有效；
   - 新增文案全部走 i18n。

5. **降级**：算法效果不理想时（阈值难调、误合并明显），本任务可只交付「清晰度评分 + 排序」而不交付「相似归并」——两者解耦，归并失败不影响排序。这是本任务的范围兜底。

**验收**：手动验证场景 4；`__tests__/image-hash.test.js` 用**构造的像素数组**做断言（不依赖 DOM）：相同输入的 hash 稳定、旋转/轻微缩放后 hamming 距离小于阈值、纯色图的清晰度分数接近 0、`groupBySimilarity()` 不把明显不同的 hash 合并。

**实现记录（2026-09-22）**：

- `src/lib/image-hash.js`：`computePhash()`（dHash，先按区块平均降采样再逐行比相邻亮度 → 16 字符 hex）、`hammingDistance()`（不可比较的输入返回 `Infinity`，阈值判定天然不相似，调用方无需分支）、`computeSharpness()`（Laplacian 方差，取整存储）、`groupBySimilarity()`（贪心聚类，只看组代表以避免传递性把多张图连成一个大组）。
- 像素来源：`src/offscreen/offscreen.js` 的 `loadPixels()` / `computeMetrics()`。**先缩到 64 边长再算**（dHash 只需低频信息），把大图开销压到常数级；串行逐条而非并发，进度单调、内存平稳。
- 消息与编排：`PHASH_REQUEST`（popup → background → offscreen）/ `PHASH_RESULT`（offscreen → background，含 `done`/`total`，逐条即写回 store）/ `PHASH_STATE`（background → popup，进度与收尾汇总）。`handlePhashRequest()` 有 180s 整体超时，**超时按已拿到的部分结果收尾**（已写入的指标是有效数据，不丢弃重算）。
- 存储：`_normalizeImage()` / `addMedia()` 补 `phash: ''` / `sharpness: 0`，`updateMediaMetrics()` 专用于回写（空值不视为变更，避免把已算出的值改坏）。
- UI：`sortForDisplay()` 作为三个视图共用的排序入口（清晰度降序，同分回落捕获时间）；`renderSimilarListView()` 组内默认只显示最清晰的一张，组头可展开；相似归并开启时「按页面分组」按钮置灰并在 title 说明；`requestContentMetrics()` 只在需要时触发（开启归并 / 切到清晰度排序），缺失才请求，失败条数 > 0 时汇总提示。
- 范围内的取舍：**只分析图片**（视频需解码帧，本期不做，其 `sharpness` 恒为 0，排序时自然回落捕获时间）；跨域图在 `sendCookies` 关闭时按条失败，逐条计入汇总。

### FR-4（V16-04）增长功能

**需求**：三项互相独立的增长入口——扩展图标角标显示新增捕获数、全局快捷键、页面右键「下载此图」。

#### 4.1 图标角标

- API：`chrome.action.setBadgeText()` / `chrome.action.setBadgeBackgroundColor()`。**不需要新增权限**（`action` 已在 manifest 声明）。
- **计数口径（定论）**：显示「自上次打开弹窗以来的新增捕获数」（unread），而不是「总捕获数」或「待下载数」。理由：角标的作用是提示「有新东西」，总捕获数会让角标永久显示、失去意义；待下载数在开启自动下载时恒为 0。
- 存储与清零：`store.stats` 新增 `unread` 计数（`addMedia()` 成功时递增）；新增消息 `MARK_CAPTURED_READ`（popup 打开时发送，background 清零并刷新角标）。
- 刷新时机（实现后细化）：① 两条捕获链路新增记录之后（`onRequestCompleted()` 与 `handleDomMediaUpdate()`，仅在有新增时渲染）；② `MARK_CAPTURED_READ` 之后清空；③ `CLEAR_IMAGES` 之后清空（否则角标会残留一个已不存在的数字）；④ `onInstalled`（扩展重载后角标被清空，按持久化值恢复）与 `onStartup`（浏览器重启）。**SW 休眠/重启不需要重渲染**——角标是浏览器侧状态本就不随 SW 消失，且下次捕获渲染时会带上持久化的正确值。显示规则：`0` → 清空文本；`> 999` → `999+`。
- 角标底色 `#3b82f6` 与 popup 的 `--primary` 保持一致，通过 `setBadgeBackgroundColor()` 设置一次（幂等）。
- 失败处理：`setBadgeText` 是异步 Promise API，调用处需 `.catch(() => {})`，不能因为角标失败影响捕获主链路（与现有 `chrome.runtime.sendMessage(...).catch(() => {})` 的容错风格一致）。

#### 4.2 全局快捷键

- manifest 新增**顶层** `commands` 字段。**须写清：MV3 中 `commands` 不是 `permissions` 条目**，因此不新增权限；但 manifest 变更意味着商店需要重新审核，提审时在说明里写明「仅新增快捷键声明」。
- 声明的命令：

  | command | 建议键 | 行为 |
  |---------|-------|------|
  | `_execute_action` | `Alt+Shift+D` | 打开弹窗（Chrome 内置，无需实现） |
  | `toggle-listening` | `Alt+Shift+L` | 复用现有全局开关逻辑（与 `open-download-toggle` 菜单同一处理） |
  | `scroll-capture` | `Alt+Shift+S` | 复用 `routeScrollCapture()`，对当前活动标签页触发滚动抓取 |

- `description` 使用 `__MSG_*__` 占位（与现有菜单标题一致），需新增 i18n key；
- 实现：background 顶层注册 `chrome.commands.onCommand.addListener()`，按 `command` 分发；`scroll-capture` 复用 `routeScrollCapture(SCROLL_CAPTURE_START)`，失败时静默（用户没在页面上，弹提示反而干扰）。

#### 4.3 右键「下载此图」

- 菜单：`chrome.contextMenus.create({ id: 'open-download-image', title: '__MSG_menuDownloadImage__', contexts: ['image'] })`，在 `onInstalled` 中创建（与现有三个菜单并列）。
- 点击处理（`chrome.contextMenus.onClicked` 新增分支）：
  1. 取 `info.srcUrl`；跳过 `blob:` / `data:`（与捕获链路的 `isCollectableUrl` 判定同一原则）；
  2. **`source` 取值定论：取 `'dom'`**。理由：这个 URL 确实来自页面里的 DOM 元素，语义与 DOM 兜底捕获一致；若取 `'network'` 会让用户在来源筛选里误以为它来自网络观察。**现有来源三态（`all | network | dom`，见 `src/lib/constants.js:94` 与 popup 的 `data-source` 按钮）保持不变，不扩展第四态**——新增取值会连带改 popup HTML/JS 与 `store.getFilteredMedia()`，收益为零；
  3. 已被 `detectMediaType()` 判不出类型时兜底为 `'image'`（`contexts: ['image']` 已确定元素类型，与 FR-1 的 element-type fallback 同一原则）；
  4. **去重与下载语义**：先 `store.findMediaByUrl(url)`；已存在则**不重复入库**，直接对该条记录触发 `downloader.downloadImage()`；不存在则 `store.addMedia()` 后再下载。用户意图是「下载」，不是「登记一条记录」，所以不能因为已存在就什么都不做；
  5. 该操作走单条下载通路，与批量下载的 ZIP/直下编排互不干扰（`batchInProgress` 只约束批量通路）。
  6. **捕获被关闭 / 站点被暂停时（实现后补充的决策）**：既不记录也不改变全局语义——**照常下载，但不入库**。理由是两件事的语义不同：全局开关与站点规则管的是「要不要记录」，而用户右键点「下载此图」是明确的下载指令，拒绝执行不合理；反之，在用户明确关掉捕获的站点上往列表里塞记录，会与「已暂停」的状态自相矛盾。实现上复用 `isCaptureAllowed()` 判定，不入库分支直接用 `downloader.downloadImage()` 处理一个临时对象（`updateImageStatus()` 对不存在的记录是安全的空操作）。

**验收**：手动验证场景 5；角标计数与清零需要覆盖「SW 重启后角标恢复」这一条（无法自动化，列入手动清单）。

### FR-5（V16-05）增长运营

**需求**：把 `docs/` 从「一页介绍 + 隐私政策」扩展为「能带来自然流量的场景化教程」，并建立商店评分引导与社区反馈入口。

**产出边界**：`docs/` 是纯静态站点，**必须保持无远程资源**（现有 `index.html` / `privacy.html` 只用本地 `styles.css` 与 `favicon.svg`，不引入 CDN、字体、统计脚本）。

#### 5.1 站点结构

```
docs/
├── index.html                 # 现有落地页：导航加「教程」入口，页脚加评分链接
├── privacy.html               # 现有
├── store-listing.md           # 现有（不上线，仅作提交依据）
├── robots.txt                 # 新增
├── sitemap.xml                # 新增（绝对 URL，指向 GitHub Pages 域名）
├── guides/
│   ├── index.html             # 教程总览（内链枢纽）
│   ├── batch-download-images.html      # 批量下载网页图片：长列表页怎么一次抓全
│   ├── large-video-batch.html          # 几百 MB 视频批量下载怎么不炸
│   └── pick-highest-resolution.html    # 同一张图多个分辨率，怎么挑最清晰的那版
└── en/guides/index.html       # 英文入口骨架（完整英文教程延后，见 5.5）
```

每篇教程套用「Blog Post」结构（标题 → 100-150 词引言 → 3-5 个 H2 小节 → 结尾 CTA → meta description），小节都对应一个真实功能：长列表页教程讲滚动抓取，大文件教程讲直下与分卷阈值，分辨率教程讲清晰度排序（V16-03）。**教程必须写已经存在的功能**——V16-03 与 V16-04 的教程要等对应功能落地后再写，避免文档承诺了产品没有的能力。

#### 5.2 关键词与 SEO 要素映射（每页一个主关键词 + 2-3 个次关键词）

| 页面 | 主关键词 | 次关键词 | title（≤60 字符） | slug |
|------|---------|---------|------------------|------|
| `guides/index.html` | 网页图片批量下载 | 浏览器扩展、视频下载 | 网页图片与视频批量下载教程 | `/guides/` |
| `batch-download-images.html` | 批量下载网页图片 | 懒加载图片、长列表页抓图 | 批量下载网页图片：长列表页一次抓全 | `/guides/batch-download-images.html` |
| `large-video-batch.html` | 网页视频批量下载 | 大文件下载失败、ZIP 打包 | 网页视频批量下载：几百 MB 也不失败 | `/guides/large-video-batch.html` |
| `pick-highest-resolution.html` | 网页图片最高清 | 相似图去重、图片分辨率 | 同一张图多个分辨率，怎么挑最清晰的 | `/guides/pick-highest-resolution.html` |

标题沿用一个有效句式：「[做什么]：[不用/也能][常见阻碍]」——例如「批量下载网页图片：长列表页一次抓全」比「Open Download 使用教程」更贴近搜索意图。

按 skill 的 on-page checklist 逐项执行：title ≤60 字符含主关键词；meta description ≤160 字符含主关键词并给出点击理由；URL slug 短且含关键词；每页唯一 H1 且与 title 呼应；H2/H3 含次关键词；图片 alt 描述性；**内链 2-3 条**（教程之间与回落地页）；**外链 1-2 条**到权威来源（如 Chrome 扩展权限说明文档；外链仅为 `<a href>`，不加载任何远程资源，不违反离线约束）。

`robots.txt` 允许抓取并指向 `sitemap.xml`；`sitemap.xml` 列出上面 5 个页面（含落地页与隐私政策）。站点目前有 `favicon.svg` 与 `styles.css`，教程页若需截图，**必须用本地文件**（待 V15-04 的商店截图产出后复用同一批 png），不得引用外部图床。

结构化数据可选：教程页可内联 `FAQPage` 的 JSON-LD（内联 `<script type="application/ld+json">`，无远程资源）。本期标为可选，不阻塞发布。

#### 5.3 商店评分引导

**决策：不在每次打开弹窗时打扰用户**——弹窗是高频工具，弹评分请求会直接损伤体验。改为两条低打扰路径：

1. **一次性提示条**：当累计成功下载数首次达到阈值（建议 20）时，在弹窗状态栏位置显示一条可关闭的提示「用得顺手？给个评分」，点击后打开商店详情页；关闭或点击后写 `ui.ratingPromptShown = true`，**此后永不再现**。样式复用现有 `.site-row` 的形态，不新增弹窗层级。
2. **页脚常驻链接**：`docs/index.html` 与教程页页脚常驻「在商店评分」文字链接。

链接必须指向商店详情页 URL（`https://chromewebstore.google.com/detail/<extension-id>`）。**明确禁止**使用已废弃的 `chrome.webstore.install()` 内联安装方式；本扩展不做站内自动安装。

这是 V16-05 中**唯一触碰 `src/` 的部分**（popup HTML/JS/CSS + i18n key + `ui.ratingPromptShown` 设置项），因此它必须遵守 i18n 双语同步与「无硬编码中文」的自动化校验。

#### 5.4 社区反馈入口

`.github/ISSUE_TEMPLATE/` 新增（用 YAML 表单而非纯 Markdown，便于结构化收集）：

| 文件 | 用途 | 关键字段 |
|------|------|---------|
| `config.yml` | 引导分流 | 「规则失效」「功能建议」「不点这里」的外部链接（使用文档） |
| `site-rule-broken.yml` | **规则失效专用**（呼应 FR-1 的诊断设计） | 站点 URL、规则 id、规则版本、期望捕获数、实际捕获数、控制台是否出现含 `ruleId` 的 warn、浏览器版本 |
| `bug_report.yml` | 通用缺陷 | 扩展版本、Chrome 版本、复现步骤、期望/实际、控制台日志、是否可稳定复现 |
| `feature_request.yml` | 功能建议 | 场景描述、当前替代做法、期望形态 |

规则失效模板直接对应 FR-1 的 `ruleId` / `ruleMiss` 诊断字段——这是「规则数据化」在运营侧的收益：用户报告有结构化抓手，维护者能立刻定位是哪条规则失效，而不是收到一句「抓不全了」。

#### 5.5 明确不做

- **不做任何站点埋点或第三方统计**（隐私政策已承诺「无统计上报」，且 RoadMap 第 5 节把云端数据列为非目标）。SEO 效果只能通过商店后台的展示次数与安装量间接观察，不在站点内埋点。
- **本期不做完整英文教程**，只提供 `docs/en/guides/index.html` 英文入口骨架。理由：英文 SEO 竞争激烈、内容成本翻倍，且商店详情页的双语描述（`docs/store-listing.md`）已覆盖英文关键词。完整英文教程与 `hreflang` 标记留到后续版本。
- 不做付费投放、不做社交媒体运营（超出业余投入范围）。

**验收**：手动验证场景 6；`docs/` 下所有新增页面在断网环境下可正常阅读（无远程资源）；每页通过 title 长度与 meta description 长度检查；评分提示条只出现一次且关闭后不再出现。

**实现记录（2026-09-22）**：

- 教程站点：`docs/guides/index.html`（总览 + 四步流程 + 分流入口）、`batch-download-images.html`、`large-video-batch.html`、`pick-highest-resolution.html`、`docs/en/guides/index.html`（英文入口骨架）；`docs/styles.css` 新增 `.guide-*` 段落样式，全部使用本地变量与本地资源。落地页导航加「教程」、页脚加「教程」与「在商店评分」。
- SEO：`docs/robots.txt`（允许抓取并指向 sitemap）、`docs/sitemap.xml`（6 个公开中文页面，**不带 `docs/en/guides/`**——内容较薄，待补齐完整英文教程后再收录，避免薄页拖累站点质量）。
- 评分引导：`DEFAULT_SETTINGS.ui.ratingPromptShown = false`；popup 新增复用 `.site-row` 形态的提示条，累计成功下载数 ≥ 20 时出现一次，关闭或点击后写盘，此后不再出现。商店链接用 `chrome.runtime.id` 拼接（`https://chromewebstore.google.com/detail/<id>`），**无需硬编码扩展 ID**，也避免了废弃的 `chrome.webstore.install()`。
- 社区入口：`.github/ISSUE_TEMPLATE/` 的 `config.yml`（关闭自由格式 issue，3 条外部引导链接）、`site-rule-broken.yml`（9 个字段，含规则 id / 规则版本 / 期望与实捕获数对比 / 是否出现零命中警告）、`bug_report.yml`、`feature_request.yml`。
- 新增 i18n key：`ratingPrompt` / `ratingAction` / `ratingDismiss`（各语言 153 key）。
- 自检（脚本化，非人工）：全部 7 个 HTML 页的 title ≤60、meta description ≤160；所有相对内链目标存在；除 `<a href>` 外无任何远程资源；4 个 YAML 表单与 sitemap.xml 均可被解析器正常解析。
- **遗留（待人工）**：`grep -rn EXTENSION_ID_PLACEHOLDER docs/` 目前命中 6 个页面（页脚评分链接），需在拿到商店分配的真实 ID 后替换；教程页的截图位是 `.guide-figure-slot` 占位块（不引用任何图片文件，因此断网渲染完整），待 V15-04 商店截图产出后补本地 png。这两条已写进 `docs/store-listing.md` 的提交前检查清单。

## 5. 消息类型与数据结构变更汇总

```js
// ── MESSAGE_TYPES 新增 ──
GET_SITE_PLAN: 'GET_SITE_PLAN',            // content → background：请求当前页面的提取计划
MARK_CAPTURED_READ: 'MARK_CAPTURED_READ',  // popup → background：角标计数清零
PHASH_REQUEST: 'PHASH_REQUEST',            // background → offscreen：批量计算相似哈希与清晰度
PHASH_RESULT: 'PHASH_RESULT',              // offscreen → background：分批回传（含 done/total 作进度）

// ── MESSAGE_TYPES 删除 ──
DOWNLOAD_SELECTED   // 无发送方；需要显式直下时用 DOWNLOAD_ZIP + payload.strategy='direct'（已有单测覆盖）

// ── 现有 payload 扩展 ──
DOM_MEDIA_UPDATE: { pageUrl, pageDomain, pageTitle, images, videos, ruleId, ruleMiss }
// ruleId: 本次使用的规则 id（未使用时为 ''）；ruleMiss: 规则零命中而退回通用兜底时为 true

// ── DOWNLOAD_ZIP 的响应结构扩展（V16-02） ──
{ succeeded, failed, strategy: 'zip' | 'direct' | 'mixed', volumes: string[], failedItems, directSucceeded? }
// strategy 为 'mixed' 时 directSucceeded 表示逐条直下的成功数，供 popup 分开报数

// ── DEFAULT_SETTINGS 新增 ──
transfer.videoDirect: true,          // 视频默认不走 ZIP
ui.mergeSimilar: false,              // 归并相似图（默认关闭，需用户显式开启并承担计算耗时）
ui.sortBy: 'capturedAt',             // 'capturedAt' | 'sharpness'
ui.ratingPromptShown: false,         // 评分提示条只出现一次

// ── media 记录新增字段（老数据经 _normalizeImage 补默认值，无迁移脚本） ──
phash: '',                           // 16 位 hex 感知哈希
sharpness: 0,                        // Laplacian 方差（清晰度评分）

// ── stats 新增 ──
unread: 0,                           // 角标计数：自上次打开弹窗以来的新增捕获数

// ── src/manifest.json 新增（注意：commands 是顶层字段，不是 permissions 条目） ──
commands: {
  _execute_action:    { suggested_key: { default: 'Alt+Shift+D' } },                    // 打开弹窗，无需实现
  'toggle-listening': { suggested_key: { default: 'Alt+Shift+L' }, description: '__MSG_commandToggleListening__' },
  'scroll-capture':   { suggested_key: { default: 'Alt+Shift+S' }, description: '__MSG_commandScrollCapture__' },
}

// permissions 不变：webRequest / downloads / storage / offscreen / contextMenus
// host_permissions 不变：["<all_urls>"]
// source 取值不变：仍为 'network' | 'dom' 两态（右键「下载此图」取 'dom'）
```

`ui` 相关新增项会进入 `store._mergeSettings()` 的 `ui` 键级合并分支（现有实现已对 `ui` / `filters` / `transfer` 做键级合并），无需额外改动合并逻辑。

## 6. 边界情况

| 场景 | 处理方式 |
|------|---------|
| `GET_SITE_PLAN` 超时或后台未就绪 | `plan = null`，行为与 v1.5 完全一致（通用兜底），不阻塞首屏扫描 |
| 规则 `exclusive: true` 且零命中 | 判定规则失效，本次扫描退回通用兜底，`ruleMiss: true`；background 按页面 URL 去重地 `console.warn` 一次（含 `ruleId`） |
| 规则 `exclusive: false` 且命中 | 规则结果与通用兜底结果合并；因 `urlDedupeKey` 按 URL 去重，不会重复入库 |
| 规则部分失效（只有部分条目命中） | `exclusive` 规则会漏掉未命中的条目——这是「追求精准」的代价；靠 `ruleMiss` 与 Issue 模板发现并修规则，不做自动部分补偿 |
| 规则的 `url` 字段解析为空 | 丢弃该条目（无 URL 无法下载），不写脏数据 |
| 规则的 `width` / `height` / `alt` / `duration` / `poster` 缺失 | 回落默认值（`0` / `''`），**不丢弃条目** |
| SPA 路由切换（`location.href` 变化） | 下次 `sendMediaUpdate()` 前检测到变化即重新请求计划；不监听 history 事件（避免在页面上下文注入钩子） |
| `pageUrl` 为 `blob:` / `data:` | 跳过（沿用现有 `isCollectableUrl` 判定） |
| `videoDirect` 开启但批次全是图片 | 行为与 v1.5 完全一致（仍走 `size` 阈值 + 分卷） |
| `videoDirect` 开启且批次全是视频 | `strategy: 'direct'`，全部逐条直下 |
| 混合批次（视频 + 图片） | `strategy: 'mixed'`：先直下视频、再打包图片；单条失败不影响另一条路径；汇总分别报数 |
| `videoDirect` 关闭 | 视频回到与图片相同的阈值判定逻辑（等价 v1.5 行为） |
| ZIP 打包进行中又收到 `DOWNLOAD_SELECTED` | 该消息已删除，命中「未知消息类型」分支（与 `DOWNLOAD_ALL` 同样处理） |
| `phash` 计算期间用户关闭弹窗 | 任务在 offscreen 中继续，结果照常写回 store（offscreen 独立于 popup，与 ZIP 打包同一模式） |
| `phash` 计算期间用户清空列表 | 写回时按 id 找不到记录则跳过，不报错 |
| 图片跨域导致 Canvas 取像素失败 | 该条记为计算失败，不写 `phash`；结束后汇总提示「N 条无法计算」 |
| `phash` 为空的条目 | 各自独立成组，不参与归并，不影响其它条目 |
| 同时开启「归并相似图」与「按页面分组」 | 相似归并优先，自动关闭按页面分组；按钮 title 明确说明，不静默切换 |
| 捕获数达 5000 上限 + 新增字段 | 新增存储量约 100~200KB，`MAX_CAPTURED_IMAGES` 上限不变 |
| `unread` 超过 999 | 角标显示 `999+` |
| Service Worker 重启 | 角标是浏览器侧状态不随 SW 消失；`store.init()` 完成后按持久化的 `unread` 重新渲染一次 |
| `chrome.action.setBadgeText()` 失败 | `.catch(() => {})` 吞掉，绝不影响捕获主链路（与现有广播容错风格一致） |
| 在 `chrome://` 页面按 `scroll-capture` 快捷键 | `tabs.sendMessage` 失败，静默返回（用户不在页面上，弹提示反而干扰） |
| 快捷键与浏览器/其它扩展冲突 | Chrome 会标记冲突，用户可在 `chrome://extensions/shortcuts` 自行改键；文档与 FAQ 说明 |
| 右键「下载此图」的 `srcUrl` 为 `blob:` / `data:` | 跳过入库与下载（沿用捕获链路的同一原则） |
| 右键「下载此图」的 URL 已存在于列表 | **不重复入库**，直接对该条记录触发单条下载（用户意图是下载而非登记） |
| `commands` 字段变更 | 不新增权限，但 manifest 变更需商店重新审核；提审说明写明「仅新增快捷键声明」 |

## 7. 涉及文件

| 文件 | 变更 |
|------|------|
| `src/lib/site-rules/engine.js` | **新增**：`normalizeHostPattern()` / `matchSiteRule()` / `buildExtractPlan()` / `normalizeFieldDescriptor()` / `validateRule()` 纯函数 |
| `src/lib/site-rules/registry.js` | **新增**：`SITE_RULES` 聚合（显式 import 各规则，不用 `index.js` 桶文件） |
| `src/lib/site-rules/wikipedia.js` | **新增**：本期唯一内置示例规则（Wikipedia 正文图片，纯数据） |
| `src/lib/image-hash.js` | **新增**：`computePhash()` / `hammingDistance()` / `computeSharpness()` / `groupBySimilarity()` 纯函数 |
| `src/lib/constants.js` | `MESSAGE_TYPES` +4 删 1；`DEFAULT_SETTINGS` +`transfer.videoDirect`、+3 个 `ui` 字段；`STORAGE_KEYS` 不变 |
| `src/lib/store.js` | `_normalizeImage()` / `addMedia()` +`phash`/`sharpness`；`stats` +`unread` 与递增；`getFilteredMedia()` 支持 `sortBy`（若排序放在 store 侧） |
| `src/lib/downloader.js` | 复用现有接口（`downloadImage()` / `downloadBatch()`），预期不改 |
| `src/content/index.js` | +`GET_SITE_PLAN` 请求与缓存、+按 plan 提取的薄分支、+`ruleId`/`ruleMiss` 上报、+`lazy.moreSelector` 与滚动抓取的整合 |
| `src/background/index.js` | +`GET_SITE_PLAN` 路由与计划构建、`planTransfer()` 增加媒体类型维度与 `mixed` 编排、+`MARK_CAPTURED_READ`、+角标渲染、+`PHASH_REQUEST`/`PHASH_RESULT` 编排、+`chrome.commands.onCommand` 监听、+`open-download-image` 菜单创建与点击、删除 `DOWNLOAD_SELECTED` |
| `src/offscreen/offscreen.js` | +处理 `PHASH_REQUEST`（fetch + Canvas 取像素 + 调 `src/lib/image-hash.js`）、分批回传 `PHASH_RESULT` |
| `src/popup/popup.js` | +相似归并与清晰度排序的 UI 与渲染、+`PHASH_RESULT` 进度/失败提示、+`mixed` 结果汇总、+`MARK_CAPTURED_READ` 发送、+评分提示条一次性逻辑 |
| `src/popup/index.html` | +归并相似图开关、+排序选择、+评分提示条容器（复用 `.site-row` 形态） |
| `src/popup/popup.css` | +相似图组头与进度样式（尽量复用 `.list-group-header` / `.site-row`） |
| `src/options/index.html` + `src/options/options.js` | +`#video-direct` 复选框与其读写 |
| `src/manifest.json` | +顶层 `commands` 字段；`permissions` 与 `host_permissions` 不变；`version` 升 `1.6.0` |
| `src/_locales/zh_CN/messages.json` + `src/_locales/en/messages.json` | 新增 key（双语同步，见第 8 节的 i18n 校验） |
| `jest.setup.js` | +`chrome.action`（`setBadgeText` / `setBadgeBackgroundColor`）与 `chrome.commands`（`onCommand` 可触发）mock |
| `__tests__/site-rules.test.js` | **新增**：匹配、计划生成、内置规则校验 |
| `__tests__/image-hash.test.js` | **新增**：hash 稳定性、距离阈值、分组、清晰度 |
| `__tests__/background.test.js` | +`planTransfer` 视频分支与 `mixed` 编排、`GET_SITE_PLAN`、`MARK_CAPTURED_READ`、角标、右键菜单、快捷键、`DOWNLOAD_SELECTED` 已删除 |
| `__tests__/store.test.js` | +新字段默认值与 normalize、`unread` 计数 |
| `docs/index.html` | 导航 +教程入口、页脚 +评分链接与教程内链 |
| `docs/guides/*.html` + `docs/en/guides/index.html` | **新增**：场景化教程（见 FR-5） |
| `docs/robots.txt` + `docs/sitemap.xml` | **新增**：静态 SEO 文件 |
| `.github/ISSUE_TEMPLATE/*.yml` | **新增**：`config.yml` / `site-rule-broken.yml` / `bug_report.yml` / `feature_request.yml` |
| [RoadMap.md](../../../RoadMap.md) | v1.6 章节勾选与技术债条目维护（`DOWNLOAD_SELECTED` 改为「已删除」）、测试数量同步 |

## 8. 测试计划

沿用现有 Jest（`testEnvironment: "node"`、无 jsdom）。可以自动化的部分**全部收敛为 `src/lib/` 下的纯函数**，这是本文档在多处做出取舍时的共同理由。

- **site-rules**（`__tests__/site-rules.test.js`）：
  ① `matchSiteRule()` 精确 host 命中；② `*.example.com` 通配命中与不命中（`example.com` 与 `sub.example.com`）；③ `pathPattern` / `excludePathPattern` 的行为；④ 无匹配返回 `null`；⑤ 多条规则同时匹配时取第一条（顺序即优先级）；⑥ `buildExtractPlan()` 的返回值**可被 `JSON.stringify()` 序列化**（这是跨消息传递的硬要求）；⑦ 字段描述符缺省补默认值；⑧ `validateRule()` 对内置规则全部通过，对缺必填字段的规则报错。
- **image-hash**（`__tests__/image-hash.test.js`）：① 相同像素输入产出相同 hash；② `hammingDistance()` 的对称性与自身距离为 0；③ 构造「轻微变化」的像素数组，距离小于阈值；④ 明显不同的图案距离大于阈值；⑤ `groupBySimilarity()` 正确分组、不误合并、`phash` 为空的条目各自成组；⑥ `computeSharpness()` 对纯色图接近 0、对高对比边缘图显著大于 0。
- **background**：① `planTransfer()` 四个分支（纯视频 / 纯图片 / 混合 / `videoDirect` 关闭）；② `mixed` 的编排顺序（先直下后打包）与结果汇总；③ `GET_SITE_PLAN` 命中规则与未命中（返回 `null`）；④ `DOM_MEDIA_UPDATE` 携带 `ruleId` / `ruleMiss` 时的日志行为；⑤ `MARK_CAPTURED_READ` 清零后角标被清空（断言 `setBadgeText` 调用参数）；⑥ `unread` 递增与 `999+` 截断；⑦ 右键 `open-download-image` 的三个分支（新 URL 入库 `source: 'dom'` / 已存在则直接下载 / `blob:` 跳过）；⑧ `chrome.commands.onCommand` 的 `toggle-listening` 与 `scroll-capture` 分发；⑨ 已删除的 `DOWNLOAD_SELECTED` 命中未知消息分支。
- **store**：① 新字段默认值（`phash` / `sharpness` / `transfer.videoDirect` / `ui.mergeSimilar` / `ui.sortBy` / `ui.ratingPromptShown`）；② 老数据 `_normalizeImage()` 自动补 `phash: ''` / `sharpness: 0`；③ `stats.unread` 递增与清零；④ `ui` 部分提交时其余 `ui` 字段不被清空。
- **i18n**：现有 `__tests__/i18n.test.js` 会自动校验新增 key 的双语一致性与「popup/options 无硬编码中文（含全角标点）」，无需新增用例，但**必须保证新增文案全部走 `t()` / `data-i18n`**。
- **jest.setup.js 需扩展**：`chrome.action.setBadgeText` / `setBadgeBackgroundColor`（记录调用参数以便断言）、`chrome.commands.onCommand`（可触发）。`chrome.contextMenus` 已具备可触发能力（`_trigger`）。
- **PHASH 编排**（第 8 节前述清单未穷尽的部分）：`PHASH_REQUEST` → `ensureOffscreenDocument()` → 分批 `PHASH_RESULT` → 写回 store 的**编排骨架可测**（沿用现有 ZIP 编排用例的 mock 手法：替换 `chrome.runtime.sendMessage` 模拟 offscreen 回包），需覆盖：① 结果按 id 写回 `phash` / `sharpness`；② 写回时记录已被清空则跳过而不报错；③ 有 `failedItems` 时的汇总与提示数据。
- **无法自动化、只能手动验证**：content script 的 DOM 提取（无 jsdom）、offscreen 内部的 Canvas 像素计算（纯函数已覆盖，取像素这一段不能）、popup 的全部 UI、角标在 SW 重启后的恢复、快捷键的实际按键、`docs/` 的离线渲染。这延续了 RoadMap 技术债里「`content` / `offscreen` 可测性」的现状结论：**本期的解法是「把可测部分从不可测层里抽出来」，而不是引入 jsdom 依赖**。

## 9. 交付与手动验证清单

每个任务合入前 `npm test` 全绿 + `npm run build`，并在 `chrome://extensions` 重载 `dist/`。按任务逐条验证：

**V16-01（场景 1 / 2）**

1. 打开 `zh.wikipedia.org` 的一个条目页，开启监听并刷新；打开弹窗，确认列表里**没有**编辑链接图标、语言图标等站点 UI 图片，只保留正文图片。
2. 打开浏览器的 `chrome://extensions` → 该扩展的 Service Worker 控制台，确认没有异常；随后把 `src/lib/site-rules/wikipedia.js` 的 `itemSelector` 临时改成一个不存在的选择器，重新构建并重载，刷新同一页面——捕获结果应回到 v1.5 的通用兜底水平（列表恢复出现更多图片），控制台出现一条含 `ruleId` 的 warn。
3. 打开任意非示例站点（例如一个博客），确认行为与 v1.5 完全一致（`GET_SITE_PLAN` 返回 `null`）。
4. 在示例站点内做 SPA 式跳转（或手动把 `pathPattern` 改成只匹配部分路径），确认跨路由后计划被重新请求（控制台可见第二次请求、或捕获集合随路由变化）。

**V16-02（场景 3）**

5. 在一个页面里同时捕获到图片与视频，弹窗中全选后点「下载选中」：确认浏览器下载列表里视频是**独立文件**、图片被打包成 ZIP，结果提示分别报数（不是一句笼统的「成功 N 个」）。
6. 在 Options 关闭「视频逐条下载」后重复第 5 步，确认视频重新进入 ZIP。
7. 只选视频、只选图片各测一次，确认策略分别为「全部直下」与「按阈值」。

**V16-03（场景 4）**

8. 找一张有多个分辨率版本的图页（或手动构造同图不同尺寸的 URL 列表），开启「归并相似图」，等进度跑完：确认多分辨率版本被折叠成一组、默认展示尺寸最大的那条、展开可见其余版本。
9. 确认组内排序按清晰度降序；切换「按清晰度排序」后列表整体按分数重排。
10. 构造 2-3 张构图相似但内容不同的图，确认**没有被误合并**（若误合并，记下阈值并调整 `maxDistance`）。
11. 断开网络后点击「归并相似图」，确认逐条失败被汇总提示，且不写脏数据（`phash` 保持为空）。

**V16-04（场景 5）**

12. 开启监听后浏览若干页面：扩展图标角标数字随新捕获增长；打开弹窗后角标清空；超过 999 条时显示 `999+`。
13. 在 `chrome://extensions` 里手动点「Service Worker 停止」（或在扩展页 reload），重新浏览页面，确认角标按持久化的 `unread` 正确恢复。
14. `chrome://extensions/shortcuts` 中确认三条快捷键已注册；按 `Alt+Shift+L` 验证监听开关切换；在普通网页上按 `Alt+Shift+S` 验证滚动抓取启动；在 `chrome://` 页按 `Alt+Shift+S` 确认静默失败（无弹窗、无报错）。
15. 在任意网页对一张图片右键 → 「Open Download: 下载此图」：确认该图**立即开始下载**；再次对同一张图右键执行，确认**不会新增重复条目**但仍会下载。
16. 对一张 `blob:` 图片（如某些在线编辑器）右键执行，确认被跳过且不产生条目。

**V16-05（场景 6）**

17. 断网后打开 `docs/guides/index.html` 与三篇教程，确认样式与内容完整（无远程资源导致的白屏/无样式）；确认每页 title 与 meta description 长度符合 5.2 节的约束。
18. 首次成功下载累计到阈值后，确认评分提示条出现一次；关闭后重开弹窗，确认**不再出现**。
19. 在 GitHub 上打开发起 Issue 的入口，确认四个模板可选，且「规则失效」模板的字段能覆盖 FR-1 的诊断信息（站点 URL、规则 id、命中数对比）。

**跨任务回归**

20. v1.5 回归：单条下载 / 取消 / 重试 / lightbox / 导出 / 站点暂停 / 滚动抓取 / 按页面分组 / 来源筛选 / 中英语言切换 / 大文件旁路与分卷 全部不受影响。
21. i18n 回归：把浏览器语言切到 English 与第三种语言（如日本語），确认新增文案全部跟随、无裸露 key、无中文全角标点混入英文。
22. 发版走 `npm run release`（版本升 `1.6.0`），随后按 `docs/store-listing.md` 的检查清单提交商店更新（本次 manifest 新增 `commands` 字段，需在提审说明中注明「仅新增快捷键声明，未新增权限」）。
