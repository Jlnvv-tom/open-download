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
3. 零依赖、无远程资源、无统计上报、MIT 开源、154 个测试用例的工程质量。

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

### v1.6 差异化放大（方向性，立项时再细化）

- [ ] **V16-01 平台适配器框架（P0）**：数据驱动的站点抓取规则（Pinterest、小红书、微博、电商列表页），规则文件可社区贡献；把 V14-01 的通用 DOM 兜底升级为站点感知
- [ ] **V16-02 视频直链下载（P1）**：大文件旁路复用 V15-01，视频默认不走 ZIP；m3u8 分片合并工程量大，单独立项评估（含合规边界）
- [ ] **V16-03 智能筛选探索（P1）**：感知哈希去相似图、清晰度评分、主色聚类；本地优先，可选外部 API 且默认关闭
- [ ] **V16-04 增长功能（P1）**：扩展图标角标显示新捕获数（对标 CocoCut）、全局快捷键、右键「下载此图」菜单
- [ ] **V16-05 增长运营（P2）**：docs 落地页 SEO 与场景化教程、评分引导、开源社区 Issue 模板

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
| `DOWNLOAD_SELECTED` 消息路径 | 已随 V15-01 收敛为「显式批量直下入口」（内部复用 `DOWNLOAD_ZIP` 的统一编排，不再单独维护直下逻辑）；popup 暂未发送，预留给 V16-02；同批移除的 `DOWNLOAD_ALL` 保持删除状态 | 已随 V15-01 关闭 |
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
