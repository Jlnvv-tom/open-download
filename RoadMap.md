# Open Download RoadMap（迭代开发计划）

> 基于 2026-09-19 的代码走查与竞品分析制定，分析依据与数据来源见
> [specs/analysis/competitive-analysis-roadmap/2026-09-19-competitive-analysis-and-roadmap.md](specs/analysis/competitive-analysis-roadmap/2026-09-19-competitive-analysis-and-roadmap.md)。
> 任务使用复选框跟踪，完成一项勾选一项；开发约定遵循 [AGENTS.md](AGENTS.md)。

- 当前版本基线：v1.2.0
- 计划制定日期：2026-09-19
- 文档性质：活文档，每个版本发布后更新进度与下一版本明细

## 1. 产品定位与愿景

**定位**：网络层全局监听网页图片/视频资源，Popup 内筛选、预览、ZIP 批量下载的一站式媒体捕获工具。

**愿景**：做「干净、透明、开发者友好」的媒体下载扩展——在头部竞品普遍闭源、带广告、权限焦虑的市场里，以开源零依赖和高工程质量占据信任空位；以网络层捕获 + DOM 扫描双模型实现「网络里出现过的、页面上看得到的，都能下」。

**差异化主张（长期不变）**：

1. 网络层被动监听：能捕获 DOM 中不出现的资源（预加载图、轮播后台原图、JS 动态请求）。
2. 图片 + 视频双类型一站式（两个竞品赛道几乎互不跨界）。
3. 零依赖、无远程资源、无统计上报、MIT 开源、235 个测试用例的工程质量。

## 2. 现状基线（v1.2.0）

**已有能力**：webRequest 全局监听（MIME/类型/扩展名三级识别）→ 捕获期过滤（类型/域名/扩展名/大小）→ Popup 双层 Tab + 搜索 + 大小/宽高筛选 → 列表/卡片视图 → offscreen ZIP 打包下载（零依赖手写 writer）→ 设置页完整配置。

**关键差距（按用户影响排序，详见分析文档 4.3 节）**：

| # | 差距 | 影响 |
|---|------|------|
| G1 | 无 DOM 扫描兜底，缓存命中资源漏捕 | 达不到「看到的都能下」的用户预期 |
| G2 | ZIP 整包内存构建、fetch 不带 Cookie | 视频批量打包数百 MB 即失败 |
| G3 | 无单条下载 / lightbox / 失败重试 / 真取消 | 竞品标配缺项 |
| G4 | `urlDedupeKey` 丢弃 query 参数 | 签名 URL 被误去重，「捕获数变少」难自查 |
| G5 | 无平台适配 / 自动翻页 | Pinterest、电商、社媒场景抓不全 |
| G6 | 无 i18n、未上架 Chrome Web Store | 国际市场不可见，自然流量为零 |
| G7 | 视频能力薄弱（无缩略图/duration/直链下载） | 类型标签有名无实 |

## 3. 迭代策略

- **顺序**：先补齐用户预期基线（G3/G4，v1.3）→ 补捕获模型（G1/G5，v1.4）→ 工程安全与发行（G2/G6，v1.5）→ 差异化放大（v1.6）。
- **每个版本可独立发布**，发布前 `npm test` + `npm run build` 必须通过，并按 AGENTS.md 清单手动验证。
- **时间均为预估**（按每周 5-10 小时业余投入），以任务完成为准而非日期。

| 版本 | 主题 | 预估周期 | 对应差距 | 预计发布 |
|------|------|---------|---------|---------|
| v1.3 | 体验补课 | 2-3 周 | G3、G4 | 2026-10 |
| v1.4 | 捕获增强 | 3-4 周 | G1、G5（部分）、G7（部分） | 2026-11 |
| v1.5 | 工程强化 + 国际化 + 上架 | 2-3 周 | G2、G6 | 2026-12 |
| v1.6 | 差异化放大 | 4 周+ | G5（完整）、G7、增长 | 2027 Q1 |

## 4. 版本计划

### v1.3 体验补课（目标：把竞品标配补齐，消除高频误伤）

> 逐任务实现方案、边界情况与测试计划详见
> [specs/features/v13-experience-polish/2026-09-19-v13-experience-polish-design.md](specs/features/v13-experience-polish/2026-09-19-v13-experience-polish-design.md)。

- [x] **V13-00（P0）popup 前置重构：容器事件委托 + `MEDIA_FOUND` 增量插入**（走查新增，所有 UI 任务的地基，详见设计文档 FR-0）
- [x] **V13-01（P0）修复 `urlDedupeKey` 丢 query 误伤**
  - 涉及：`src/lib/utils.js:189`、`src/lib/store.js`、`tests/`
  - 方案：去重 key 纳入完整 URL 指纹（或「保留关键参数」策略）；存量数据兼容——仅对新条目启用新 key，不做迁移脚本
  - 验收：同路径不同参数的两张 CDN 图不再合并；`npm test` 全绿，新增去重回归用例
- [x] **V13-02（P0）单条直接下载**
  - 涉及：`src/popup/`、`src/lib/constants.js`（新增 MESSAGE_TYPES，如 `DOWNLOAD_ONE`）、`src/background/index.js`
  - 验收：列表/卡片项可单独下载，状态徽章 pending → downloading → downloaded/failed 正确流转，与统计去重逻辑不冲突
- [x] **V13-03（P0）失败重试 + 真正取消**
  - 涉及：`src/lib/downloader.js:182`（重写 `cancelAll`）、popup 状态列
  - 方案：重试复用单条下载路径；取消调用 `chrome.downloads.cancel(downloadId)` 并清理队列
  - 验收：失败条目一键重试成功；批量下载中止后浏览器下载任务同步取消
- [x] **V13-04（P1）lightbox 大图/视频预览**
  - 涉及：`src/popup/`（HTML/CSS/JS）
  - 验收：点击缩略图放大、视频内联播放；支持 Esc 关闭、←/→ 翻页；不引入远程资源
- [x] **V13-05（P1）命名策略修正**
  - 涉及：`src/lib/utils.js:169`
  - 验收：sequential 前缀按媒体类型区分（`img_`/`video_`）；无扩展名时从 MIME 推断而非一律 `.jpg`
- [x] **V13-06（P1）容量上限可视化**
  - 涉及：`src/lib/store.js:152`、popup 顶部提示条
  - 验收：达到 4500 条时出现提示；发生截断时用户可见截断数量
- [x] **V13-07（P2）搜索真防抖 + 导出当前筛选结果**
  - 涉及：`src/popup/popup.js`
  - 验收：连续输入只触发一次渲染（200ms 防抖）；导出 JSON 内容与当前筛选视图一致

### v1.4 捕获增强（目标：对齐「看到的都能下」，补视频信息）

> 逐任务实现方案、边界情况与测试计划详见
> [specs/features/v14-capture-enhancement/2026-09-20-v14-capture-enhancement-design.md](specs/features/v14-capture-enhancement/2026-09-20-v14-capture-enhancement-design.md)。

- [x] **V14-01（P0）DOM 扫描兜底捕获**
  - 涉及：`src/content/index.js`（从「仅回填尺寸」扩展为「未捕获资源入库」）、`src/background/index.js`（`CONTENT_IMAGES_UPDATE` 处理扩展）、`src/lib/store.js`（记录增加 `source: 'dom' | 'network'` 字段）
  - 方案：content script 扫描 `img[src]`、`video[src/poster]`，与已捕获记录按 URL 合并去重；`filters.minDimensions` 等捕获期过滤沿用设置
  - 验收：禁网缓存场景下刷新页面仍能捕获可见图片；popup 可按来源筛选；体积膨胀可控（仍受 5000 条上限约束）
- [x] **V14-02（P0）站点级监听开关**
  - 涉及：`src/lib/constants.js`（`DEFAULT_SETTINGS.siteRules`）、popup 顶部、background 捕获链
  - 方案：`siteRules` 支持按域名「总是允许/总是拦截/跟随全局」，Popup 显示当前站点状态并可一键暂停
  - 验收：在拦截域名下不捕获任何资源；设置在 SW 重启后仍生效
- [x] **V14-03（P1）自动滚动/翻页抓取**
  - 涉及：`src/content/`（可选滚动注入器）、popup 触发入口
  - 方案：用户显式触发（不自动滚动），配合 V14-01 的 DOM 兜底捕获长列表页
  - 验收：长列表页滚动到底后新增图片均入库，可随时停止
- [x] **V14-04（P1）视频信息补齐**
  - 涉及：`src/content/index.js`、`src/lib/store.js`（激活 duration 字段）、popup 卡片
  - 验收：视频卡片显示时长角标与 poster 缩略图（有 poster 时）
- [x] **V14-05（P2）按页面/Tab 分组**
  - 涉及：`src/popup/`
  - 验收：列表可按 `tabUrl` 分组折叠，多标签页场景可扫读，分组状态不影响选择

### v1.5 工程强化 + 国际化 + 上架（目标：大文件安全、面向全球市场发行）

> 逐任务实现方案、边界情况与测试计划详见
> [specs/features/v15-engineering-i18n-listing/2026-09-21-v15-engineering-i18n-listing-design.md](specs/features/v15-engineering-i18n-listing/2026-09-21-v15-engineering-i18n-listing-design.md)。

- [x] **V15-01（P0）大文件旁路与 ZIP 分卷**
  - 涉及：`src/lib/zip.js`、`src/background/index.js`（offscreen 编排）、`src/lib/downloader.js`
  - 方案：单文件 >50MB 或整包预估 >500MB 时自动改为逐条 `chrome.downloads.download`（复用并发路径）；ZIP 侧评估按 N 个文件分卷，替代单 Blob 全内存
  - 验收：1GB 量级批量下载不再崩溃/不再 OOM；打包超时（300s）不再静默失败，进度与失败原因可见
- [x] **V15-02（P1）打包携带 Cookie 可选**
  - 涉及：`src/offscreen/offscreen.js`（fetch `credentials`）、`src/options/`
  - 验收：登录态资源（如需 Cookie 的 CDN 图）勾选后可打包；默认关闭并在设置页说明隐私影响
- [x] **V15-03（P0）i18n 中英双语**
  - 涉及：`src/_locales/`、`src/manifest.json`（`default_locale`）、popup/options 文案抽离
  - 验收：切换浏览器语言 Popup/Options/右键菜单全部跟随；不遗留硬编码中文
- [ ] **V15-04（P0）上架 Chrome Web Store**
  - 涉及：`docs/`（新增 Privacy Policy 页）、商店素材（截图/描述，中英）、权限使用说明
  - 验收：审核通过上架；权限声明与实际一致（webRequest 仅观察、无远程代码）
  - 进度：仓库内准备已完成（[docs/privacy.html](docs/privacy.html)、[docs/store-listing.md](docs/store-listing.md)、版本号升 1.5.0）；**待人工完成**：补 3 张 1280×800 截图与 promo tile、提交开发者后台、等待审核通过
- [x] **V15-05（P2）Firefox 移植可行性评估**
  - 产出：调研文档（webRequest、offscreen、storage 差异），给「做/不做」结论，不实现
  - 结论文档：[specs/analysis/firefox-port-feasibility/2026-09-21-firefox-port-feasibility.md](specs/analysis/firefox-port-feasibility/2026-09-21-firefox-port-feasibility.md)（建议做，但排在 v1.6，唯一阻塞点是 offscreen 宿主抽象）
- [x] **V15-06（P1）UI 样式与可用性打磨**
  - 涉及：`src/popup/popup.css`、`src/options/options.css`（纯 CSS，不改 DOM 结构与 JS 行为）
  - 方案：表单控件字体继承；列表元信息溢出保护；弹窗总高裁剪修复（站点行与容量提示叠加后超出 600px）；筛选面板换行；`:focus-visible` 焦点环与条目操作按钮键盘可见；禁用态与 hover 守卫；`prefers-reduced-motion` 降级；合并重复的 `.media-card-check` 规则
  - 验收：亮/暗主题下弹窗与设置页无内容裁剪；键盘可完整操作列表条目；系统「减少动态效果」开启后无持续动画
  - 时序：**先于 V15-04 的商店截图执行**（截图需要稳定、无明显缺陷的界面）
  - 方案细节见 [v1.5 设计文档 FR-6](specs/features/v15-engineering-i18n-listing/2026-09-21-v15-engineering-i18n-listing-design.md)

### v1.6 差异化放大（已立项，方案见设计文档）

> 逐任务实现方案、边界情况与测试计划详见
> [specs/features/v16-differentiation-expansion/2026-09-22-v16-differentiation-expansion-design.md](specs/features/v16-differentiation-expansion/2026-09-22-v16-differentiation-expansion-design.md)。

- [x] **V16-01 平台适配器框架（P0）**：数据驱动的站点抓取规则（Pinterest、小红书、微博、电商列表页），规则文件可社区贡献；把 V14-01 的通用 DOM 兜底升级为站点感知
  - 立项调整：**本期只内置 1 个示例规则**（Wikipedia 正文图片），框架与规则 schema 一次做对，其余站点等真实反馈与社区贡献；规则库与匹配纯函数落 `src/lib/site-rules/`，由 background 匹配后把可序列化的提取计划下发给 content script
  - 合规边界：规则只做「页面上已渲染内容的更精准定位」，不逆向接口、不绕过登录与付费墙
  - 实现：`src/lib/site-rules/{engine,registry,wikipedia}.js` + 新消息 `GET_SITE_PLAN` + `DOM_MEDIA_UPDATE` 增加 `ruleId`/`ruleMiss` 诊断字段；规则零命中时自动退回通用兜底并按页面去重告警。**待手动验证**：Wikipedia 页面的噪音过滤、规则失效降级、SPA 路由后计划刷新（`lazy.moreSelector` 路径已实现但示例规则未使用，仅单测覆盖归一化）
- [x] **V16-02 视频直链下载（P1）**：大文件旁路复用 V15-01，视频默认不走 ZIP；m3u8 分片合并工程量大，单独立项评估（含合规边界）
  - 立项调整：混合批次按媒体类型拆分（视频直下 + 图片打包，`strategy: 'mixed'`），而非整批改直下；`DOWNLOAD_SELECTED` 经确认无使用场景，**随本任务删除**
  - 实现：`transfer.videoDirect`（默认开启）驱动 `planTransfer()` 的媒体类型维度；`handleMixedDownload()` 先直下视频再打包图片，结果带 `directSucceeded` 供 UI 分开报数；Options 新增「视频逐条下载（不打包）」开关；删除 `DOWNLOAD_SELECTED` 常量与消息分支（其正面用例改写为「命中未知消息分支」）
  - **待手动验证**：混合批次的两种产物实际落盘、关闭开关后视频重新进 ZIP、纯视频/纯图片两种边界
- [x] **V16-03 智能筛选探索（P1）**：感知哈希去相似图、清晰度评分、主色聚类；本地优先，可选外部 API 且默认关闭
  - 立项调整：本期只做感知哈希与清晰度评分，**主色聚类延后**；算法为纯函数（接收像素数组）以便在无 jsdom 的测试环境下覆盖，像素计算放在 offscreen 且按需触发
  - 实现：`src/lib/image-hash.js`（`computePhash` dHash / `hammingDistance` / `computeSharpness` Laplacian 方差 / `groupBySimilarity` 贪心聚类）；消息 `PHASH_REQUEST` → offscreen 串行取像素（先缩到 64 边长再算）→ 逐条 `PHASH_RESULT` → background 即时写回 store 并转发 `PHASH_STATE`；popup 筛选面板新增「排序（捕获时间/清晰度）」与「归并相似图」（与按页面分组互斥，按钮置灰并说明）；media 新增 `phash`/`sharpness`（老数据经 normalize 补空，无迁移）
  - **待手动验证**：真实站点上归并的误合并率与阈值（6）是否需要调参、跨域图失败后的汇总提示、几十张大图时的整体耗时；**只分析图片**，视频需解码帧，本期不纳入
- [x] **V16-04 增长功能（P1）**：扩展图标角标显示新捕获数（对标 CocoCut）、全局快捷键、右键「下载此图」菜单
  - 实现：`stats.unread` + `MARK_CAPTURED_READ`（打开弹窗清零，清空列表同时清空）；manifest 新增顶层 `commands`（`_execute_action` / `toggle-listening` / `scroll-capture`，**未新增权限**）；`contexts: ['image']` 的「下载此图」菜单（已存在记录复用不重复入库，站点暂停时只下载不入库）。版本号升 1.6.0
  - **待手动验证**：角标在 SW 重启与扩展重载后的恢复、三条快捷键的实际按键与冲突提示、右键下载此图的实际下载行为
- [x] **V16-05 增长运营（P2）**：docs 落地页 SEO 与场景化教程、评分引导、开源社区 Issue 模板
  - 立项调整：本期只写中文教程（英文仅入口骨架）；评分引导改为一次性提示条（不每次弹窗打扰）
  - 实现：`docs/guides/` 四页教程（总览 + 长列表抓图 / 大文件批量下载 / 挑选最清晰版本）与 `docs/en/guides/` 英文入口骨架，全部无远程资源；`docs/robots.txt` + `docs/sitemap.xml`；落地页导航与页脚加教程与评分入口；评分提示条（`ui.ratingPromptShown`，累计成功下载 ≥20 时出现一次，入口用 `chrome.runtime.id` 拼接商店详情页）；`.github/ISSUE_TEMPLATE/` 四个 YAML 表单（含「规则失效专属模板」，对应 V16-01 的 `ruleId`/`ruleMiss` 诊断字段）
  - **待人工**：`grep -rn EXTENSION_ID_PLACEHOLDER docs/` 应在拿到商店 ID 后清空（占位在 6 个页面的页脚评分链接里）；教程的截图位待 V15-04 商店截图产出后补本地 png；`docs/en/guides/` 未纳入 sitemap（内容较薄，待补齐完整英文教程再收录）

## 5. 非目标（Non-goals）

明确不做，避免范围蔓延与合规风险：

1. DRM 保护内容的解密/下载。
2. 阻塞/拦截式 webRequest（MV3 架构约束，AGENTS.md 已明确）。
3. 绕过登录/付费墙抓取非公开资源。
4. 云端存储用户捕获数据（隐私主张：一切数据留在本地 `chrome.storage.local`）。
5. 引入 UI 框架/打包器（保持轻量构建，除非明确需要）。

## 6. 技术债专项（穿插在各版本）

| 事项 | 说明 | 计划归入 |
|------|------|---------|
| popup/options/content/offscreen 无测试 | Jest coverage 仅覆盖 `src/lib/**` | v1.3 起每个版本为新增逻辑补测试；v1.5 评估 content/offscreen 的可测性 |
| UI 硬编码中文 | 与 i18n 任务合并 | V15-03 |
| `DOWNLOAD_SELECTED` 消息路径 | **已随 V16-02 删除**（无任何发送方）。需要显式整批直下时用 `DOWNLOAD_ZIP` + `strategy:'direct'`，该通路有单测覆盖 | 已关闭 |
| 存储无字节级配额检测 | 上限提示先行，配额检测视 v1.4 数据量决定 | 观察项 |

## 7. 度量指标（每个版本发布后回顾）

| 指标 | 现状 | v1.5 目标 | v1.6 目标 |
|------|------|-----------|-----------|
| 下载成功率（本地统计） | 未统计 | ≥95% | ≥97% |
| 大批量（>200 条或 >500MB）打包失败率 | 高（内存） | <1%（旁路生效） | <0.5% |
| Chrome Web Store 评分 | 未上架 | ≥4.5★ | ≥4.6★ |
| 商店用户数 | 未上架 | 首批自然流量 | 1 万+ |
| 捕获覆盖率（可见媒体中被捕获比例，人工抽测） | 缓存场景漏 | ≈100%（DOM 兜底） | 站点适配场景 ≈100% |

说明：本地统计仅在本地呈现；是否收集匿名数据在上架后单独决策，默认关闭。

## 8. 风险与应对

| 风险 | 概率 | 应对 |
|------|------|------|
| Chrome 收紧 webRequest 权限政策 | 中 | 保持「仅观察」用法与权限声明透明；V15-05 评估 Firefox 作为备份渠道 |
| 平台适配器随站点改版失效 | 高（v1.6） | 规则数据化 + 社区共建 + 失效降级为通用 DOM 兜底 |
| 去重 key 变更引入数据兼容问题 | 中 | 仅对新条目启用新 key，不做存量迁移；回归用例锁定 |
| 大文件旁路与 ZIP 并存导致逻辑分叉 | 中 | 统一走 downloader 边界，ZIP/直下只是传输策略差异（依赖倒置，符合 specs 规范的 SOLID 原则） |
| 商店审核被拒（权限/隐私） | 中 | 权限最小化清单预审；隐私政策与「无上报」主张保持一致 |
| 业余投入时间波动 | 高 | 以任务完成度为发布标准，版本内任务按 P0→P2 排序，P0 齐即可发版 |

## 9. 变更记录

| 日期 | 版本计划变更 | 备注 |
|------|-------------|------|
| 2026-09-19 | 初版：v1.3 ~ v1.6 路线制定 | 依据竞品分析与 v1.2.0 代码走查 |
| 2026-09-21 | v1.3 / v1.4 / v1.5（除 V15-04）勾选完成 | 补齐 v1.4 全部缺口（含 `CONTENT_IMAGES_UPDATE` 回归修复），并落地 V15-01/02/03/05；测试 83 → 154；版本号升 1.5.0 |
| 2026-09-22 | v1.5 新增 V15-06「UI 样式与可用性打磨」（P1） | 补齐 v1.4 新增的站点行/来源筛选/分组头等 UI 带来的排版与可用性缺口；作为 V15-04 商店截图的前置；审计另修复 i18n 全角标点泄漏、`.tab span` 样式回归、`DOWNLOAD_SELECTED` 收敛、ZIP 超时未关闭 offscreen 四处缺陷 |
| 2026-09-22 | v1.6 完成立项细化，去掉「方向性，待细化」标注 | 五任务全部展开为可执行方案：[v1.6 设计文档](specs/features/v16-differentiation-expansion/2026-09-22-v16-differentiation-expansion-design.md)。三处范围收敛：V16-01 只内置 1 个示例规则、V16-03 延后主色聚类、V16-05 只写中文教程；`DOWNLOAD_SELECTED` 计划随 V16-02 删除。同日审计补 1 项用例，测试数 154 → 155 |
| 2026-09-22 | V16-01 平台适配器框架实现完成 | 新增 `src/lib/site-rules/`（引擎纯函数 + 规则注册表 + Wikipedia 示例规则）、消息 `GET_SITE_PLAN`、`DOM_MEDIA_UPDATE` 的 `ruleId`/`ruleMiss` 诊断字段与失效降级；测试数 155 → 187 |
| 2026-09-22 | V16-04 增长功能实现完成 | 未读角标（`stats.unread` + `MARK_CAPTURED_READ`）、manifest 顶层 `commands` 三个快捷键（未新增权限）、右键「下载此图」；版本号 1.5.0 → 1.6.0；测试数 187 → 200 |
| 2026-09-22 | V16-02 视频直链下载实现完成 | `transfer.videoDirect` 驱动媒体类型维度、`mixed` 策略与先直下后打包编排、Options 开关、`directSucceeded` 分开报数；删除 `DOWNLOAD_SELECTED` 常量与消息分支并改写其用例；测试数 200 → 208 |
| 2026-09-22 | V16-03 智能筛选探索实现完成 | 新增 `src/lib/image-hash.js`（dHash + 汉明距离 + Laplacian 方差 + 相似聚类，纯函数可在 node 环境测试）、`PHASH_REQUEST/RESULT/STATE` 消息与 offscreen 串行取像素通路、popup 清晰度排序与相似归并视图；media 新增 `phash`/`sharpness`；测试数 208 → 234 |
| 2026-09-22 | V16-05 增长运营实现完成，**v1.6 五个任务全部落地** | `docs/guides/` 四页教程 + 英文入口骨架 + robots/sitemap + 落地页导航与页脚入口；popup 一次性评分提示条（`ui.ratingPromptShown`）；`.github/ISSUE_TEMPLATE/` 四个 YAML 表单（含规则失效专属模板）；测试数 234 → 235；**遗留**：商店真实 ID 待上架后替换 `EXTENSION_ID_PLACEHOLDER`，教程截图位待补 |
| 2026-09-25 | 版本号重置为 1.0.0（用户决策） | `manifest.json` 与 `package.json` 同步 1.6.0 → 1.0.0，`docs/index.html` 徽标与 `store-listing.md` 目标版本随改；**理由：上架前重置版本基线**。历史变更记录中的 1.6.0 为当时事实，不回改。注意：一旦在 Chrome Web Store 上架，版本号不可再低于已发布版本，1.0.0 必须是首个提交的版本 |
| 2026-09-25 | 弹窗与设置页界面重构（精致极简） | 宽度 480 → 640px；新增 `src/styles/tokens.css` 共享设计令牌；统计/状态/站点三处合并为紧凑条、筛选面板改浮层、列表去高度上限自适应（可见高度约 240 → 约 380px）；图标统一 24 网格线性风格、视图切换改分段控件；修复卡片视图预览高度回归（恢复正方形预览 + 操作按钮绝对定位）；Options 页同一设计语言；测试数 235 保持全绿 |
