// background/index.js
// Service Worker — 核心监听 + 消息处理

import { DEFAULT_SETTINGS, MEDIA_TYPES, MESSAGE_TYPES } from '../lib/constants.js';
import { store } from '../lib/store.js';
import { DownloadManager, waitForDownload } from '../lib/downloader.js';
import { makeZipFilename } from '../lib/zip.js';
import { t } from '../lib/i18n.js';
import { buildExtractPlan, matchSiteRule } from '../lib/site-rules/engine.js';
import { SITE_RULES } from '../lib/site-rules/registry.js';
import {
  detectMediaType,
  extensionFromMimeType,
  extractFilename,
  extractDomain,
  getNormalizedExtension,
} from '../lib/utils.js';

// ─── 初始化 ────────────────────────────────────────────

const downloader = new DownloadManager(store);

/**
 * 站点级捕获判定（webRequest 与 DOM 两条链路共用）
 * 全局开关优先：站点规则不能在全局关闭时反向打开捕获
 * @param {Object} settings - 完整设置对象
 * @param {string} domain - 来源页域名，空值表示无站点上下文（如 tabId -1），跟随全局
 * @returns {boolean} 是否允许捕获
 */
function isCaptureAllowed(settings, domain) {
  if (!settings.enabled) return false;
  if (!domain) return true;
  return settings.siteRules?.[domain] !== 'block';
}

// downloader 事件 → 广播给 popup（下载状态变化目前没有其他回传通道）
// 顶层注册与 webRequest 监听器同一策略：SW 每次启动即挂载
const DOWNLOAD_EVENT_STATUS = {
  progress: 'downloading',
  complete: 'downloaded',
  error: 'failed',
  cancelled: 'pending',
};

downloader.on((event, data) => {
  const status = DOWNLOAD_EVENT_STATUS[event];
  if (!status || !data?.imageId) return;
  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.DOWNLOAD_STATUS_CHANGED,
    payload: { id: data.imageId, status, error: data.error || '' },
  }).catch(() => {
    // popup 可能未打开，忽略错误
  });
});

// ─── 扩展图标角标（V16-04） ────────────────────────────

const BADGE_MAX = 999;
const BADGE_BACKGROUND = '#3b82f6'; // 与 popup 的 --primary 保持一致

let badgeStyleReady = false;

function ensureBadgeStyle() {
  if (badgeStyleReady || !chrome.action?.setBadgeBackgroundColor) return;
  badgeStyleReady = true;
  chrome.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND }).catch(() => {});
}

/**
 * 渲染未读角标
 * 角标是浏览器侧状态、不随 SW 休眠消失，但 SW 重启/扩展重载后需要按持久化值重渲染一次
 * @param {number} unread - 自上次打开弹窗以来的新增捕获数
 */
function renderBadge(unread) {
  if (!chrome.action?.setBadgeText) return;

  const count = Number(unread) || 0;
  const text = count <= 0 ? '' : (count > BADGE_MAX ? `${BADGE_MAX}+` : String(count));

  ensureBadgeStyle();
  // 角标失败绝不能影响捕获主链路
  chrome.action.setBadgeText({ text }).catch(() => {});
}

/**
 * 切换全局监听开关（右键菜单与全局快捷键共用）
 * @returns {Promise<boolean>} 切换后的状态
 */
async function toggleListening() {
  const settings = store.getSettings();
  const enabled = !settings.enabled;
  await store.saveSettings({ enabled });

  // 通知 popup 更新状态
  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.TOGGLE_LISTENING,
    payload: { enabled },
  }).catch(() => {});

  return enabled;
}

// ─── 网络请求监听 ──────────────────────────────────────

/**
 * 监听所有网络请求完成事件
 * 不区分网站，全局监听 <all_urls>
 *
 * 注意：监听器在模块顶层注册（而非开关控制注册），SW 每次启动都会重新挂载，
 * 休眠期间的请求可唤醒 SW，避免事件丢失；是否捕获由 settings.enabled 决定。
 */
async function onRequestCompleted(details) {
  // 过滤浏览器内部协议
  if (details.url.startsWith('chrome://') || details.url.startsWith('chrome-extension://')) {
    return;
  }

  await store.init();
  const settings = store.getSettings();
  if (!settings.enabled) return;

  // 获取响应头中的 Content-Type 和 Content-Length
  let mimeType = '';
  let contentLength = 0;

  if (details.responseHeaders) {
    for (const header of details.responseHeaders) {
      const name = header.name.toLowerCase();
      if (name === 'content-type') {
        mimeType = header.value;
      } else if (name === 'content-length') {
        contentLength = parseInt(header.value, 10) || 0;
      }
    }
  }

  const mediaType = detectMediaType({
    url: details.url,
    mimeType,
    resourceType: details.type,
  });
  if (!mediaType) return;

  // 媒体类型白名单（空 = 全部捕获）
  if (settings.filters.mediaTypes.length > 0 && !settings.filters.mediaTypes.includes(mediaType)) {
    return;
  }

  const filename = extractFilename(details.url);
  const domain = extractDomain(details.url);
  const extension = getNormalizedExtension(filename || details.url) || extensionFromMimeType(mimeType);

  // 域名过滤
  if (settings.filters.domains.length > 0) {
    if (settings.filters.domains.includes(domain)) return;
  }

  // 扩展名过滤
  if (settings.filters.extensions.length > 0) {
    const allowedExtensions = settings.filters.extensions.map(ext => ext.replace(/^\./, '').toLowerCase());
    if (!allowedExtensions.includes(extension)) return;
  }

  // 大小过滤
  if (settings.minImageSize > 0 && contentLength > 0 && contentLength < settings.minImageSize) {
    return;
  }
  if (settings.maxImageSize > 0 && contentLength > 0 && contentLength > settings.maxImageSize) {
    return;
  }

  // 获取标签页信息
  let tabUrl = '';
  let tabTitle = '';

  if (details.tabId && details.tabId !== -1) {
    await chrome.tabs.get(details.tabId).then(tab => {
      tabUrl = tab.url || '';
      tabTitle = tab.title || '';
    }).catch(() => {});
  }

  // 站点级规则：按来源页域名判定（无站点上下文时跟随全局）
  if (!isCaptureAllowed(settings, tabUrl ? extractDomain(tabUrl) : '')) {
    return;
  }

  const media = store.addMedia({
    mediaType,
    url: details.url,
    filename,
    extension,
    domain,
    mimeType: mimeType || `${mediaType}/unknown`,
    size: contentLength,
    tabUrl,
    tabTitle,
  });

  if (media) {
    // 通知 popup 有新媒体
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.MEDIA_FOUND,
      payload: media,
    }).catch(() => {
      // popup 可能未打开，忽略错误
    });

    renderBadge(store.getStats().unread);

    // 自动下载
    if (settings.autoDownload) {
      downloader.downloadImage(media);
    }
  }
}

// 监听器顶层注册：SW 每次启动同步挂载，开关只影响捕获逻辑本身
chrome.webRequest.onCompleted.addListener(
  onRequestCompleted,
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// ─── Offscreen ZIP 打包 ────────────────────────────────
// ZIP 在 offscreen document 中构建，Popup 关闭不会中断打包。

const ZIP_BUILD_TIMEOUT = 300000; // 打包超时（毫秒）

let zipBuild = null;         // 进行中的打包任务 { resolve, reject }
let batchInProgress = false; // 批量下载（含多卷）进行中：卷与卷之间 zipBuild 会短暂为 null，需要独立标记
let offscreenReady = false;  // offscreen 文档是否已发送就绪握手
let offscreenReadyWaiters = [];

function markOffscreenReady() {
  offscreenReady = true;
  offscreenReadyWaiters.forEach(resolve => resolve());
  offscreenReadyWaiters = [];
}

/**
 * 等待 offscreen 文档就绪。
 * SW 重启后文档可能早已就绪但握手已丢失，超时后直接放行，
 * 由后续发送失败重试兜底。
 */
function waitForOffscreenReady(timeoutMs = 5000) {
  if (offscreenReady) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      offscreenReadyWaiters = offscreenReadyWaiters.filter(waiter => waiter !== done);
      resolve();
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    offscreenReadyWaiters.push(done);
  });
}

async function ensureOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (contexts && contexts.length > 0) return;
  }

  offscreenReady = false;
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/index.html',
      reasons: ['BLOBS'],
      justification: '批量打包媒体资源为 ZIP',
    });
  } catch (error) {
    // 并发创建时可能报"已存在"，此时文档同样可用
    if (!/single offscreen document|already exists/i.test(error.message || '')) {
      throw error;
    }
  }
}

async function closeOffscreenDocument() {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (!contexts || contexts.length === 0) return;
  }
  offscreenReady = false;
  await chrome.offscreen.closeDocument();
}

// ─── 批量下载策略编排（V15-01） ────────────────────────

const FAILURE_SUMMARY_LIMIT = 5; // 回传 UI 的失败原因条数上限

/**
 * 估算单条媒体的字节数
 * DOM 兜底捕获（source='dom'）没有 Content-Length、size 为 0：
 * 视频按保守值估算（避免漏判大文件），图片按 0 计
 */
function estimateSize(media, limits) {
  const size = Number(media?.size) || 0;
  if (size > 0) return size;
  return media?.mediaType === MEDIA_TYPES.VIDEO ? limits.unknownVideoSize : 0;
}

/**
 * 按卷上限切分批次（maxZipFiles 与 maxZipBytes 任一先到即切开）
 */
function splitVolumes(items, sizes, limits) {
  const volumes = [];
  let current = [];
  let currentBytes = 0;

  items.forEach((item, index) => {
    const size = sizes[index];
    const wouldExceed = current.length > 0
      && (current.length + 1 > limits.maxZipFiles || currentBytes + size > limits.maxZipBytes);

    if (wouldExceed) {
      volumes.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(item);
    currentBytes += size;
  });

  if (current.length > 0) volumes.push(current);
  return volumes;
}

/**
 * 决定批量下载策略（导出供单测）
 *
 * 两个维度共同决定产物：
 * 1. 媒体类型（V16-02）：`transfer.videoDirect` 开启时视频单独走逐条直下；
 * 2. 体积阈值（V15-01）：非视频条目里单文件超阈值、或整批预估超阈值 → 这批也改直下，
 *    否则按 `maxZipFiles` / `maxZipBytes` 分卷打包。
 *
 * 只有一种产物时收敛为 `direct` / `zip`；两种产物并存才返回 `mixed`，
 * 便于 UI 分开报数而不是给用户一个含糊的「成功 N 个」。
 *
 * @param {Object[]} items - 媒体记录
 * @param {Object} settings - 完整设置对象
 * @returns {{strategy: 'direct'|'zip'|'mixed', reason: string, volumes: Object[][], directItems: Object[]}}
 */
function planTransfer(items = [], settings = {}) {
  if (items.length === 0) {
    return { strategy: 'zip', reason: '', volumes: [], directItems: [] };
  }

  const limits = { ...DEFAULT_SETTINGS.transfer, ...(settings.transfer || {}) };

  // 1. 按媒体类型分流
  const videos = [];
  const others = [];
  for (const item of items) {
    if (limits.videoDirect && item?.mediaType === MEDIA_TYPES.VIDEO) {
      videos.push(item);
    } else {
      others.push(item);
    }
  }

  // 2. 非视频条目沿用 v1.5 的阈值判定
  const sizes = others.map(item => estimateSize(item, limits));
  const totalBytes = sizes.reduce((sum, size) => sum + size, 0);
  const oversized = sizes.some(size => size > limits.bypassFileSize);
  const largeReason = oversized ? 'large-file' : 'large-batch';

  const directItems = [...videos];
  let volumes = [];

  if (others.length > 0) {
    if (oversized || totalBytes > limits.bypassBatchSize) {
      directItems.push(...others);
    } else {
      volumes = splitVolumes(others, sizes, limits);
    }
  }

  // 3. 收敛结论
  if (volumes.length === 0) {
    // 整批直下：reason 说明触发原因（视频拆分 / 大文件 / 大批量）
    const reason = videos.length > 0 && directItems.length === videos.length
      ? 'video'
      : largeReason;
    return { strategy: 'direct', reason, volumes: [], directItems };
  }

  if (directItems.length === 0) {
    return { strategy: 'zip', reason: '', volumes, directItems: [] };
  }

  return { strategy: 'mixed', reason: 'video', volumes, directItems };
}

/**
 * 逐条直下：复用 downloader 并发队列，浏览器流式落盘不占用扩展内存
 */
async function handleDirectDownload(items, settings) {
  const limits = { ...DEFAULT_SETTINGS.transfer, ...(settings.transfer || {}) };
  const previousTimeout = downloader.downloadTimeout;

  // 大文件要放宽等待超时，避免被默认 120s 误判失败
  downloader.setDownloadTimeout(limits.downloadTimeoutMs);

  try {
    const results = await downloader.downloadBatch(items, {
      maxConcurrency: limits.maxConcurrencyForLarge,
    });
    const failures = results.filter(result => !result.success && !result.cancelled);

    return {
      succeeded: results.filter(result => result.success).length,
      failed: failures.length,
      strategy: 'direct',
      volumes: [],
      failedItems: failures
        .slice(0, FAILURE_SUMMARY_LIMIT)
        .map(result => ({ id: result.image.id, error: result.error || '' })),
    };
  } finally {
    downloader.setDownloadTimeout(previousTimeout);
  }
}

/**
 * 向 offscreen 发起一次打包并等待结果
 * 超时错误带上卷号与资源数，避免「点了没反应」
 */
function requestZipBuild({ zipName, items, settings, volume, volumes }) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (zipBuild) {
        zipBuild = null;
        reject(new Error(
          volumes > 1
            ? t('errorZipTimeoutVolume', volume, volumes, items.length)
            : t('errorZipTimeout', items.length)
        ));
      }
    }, ZIP_BUILD_TIMEOUT);

    zipBuild = {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    };

    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.ZIP_BUILD_REQUEST,
      payload: {
        zipName,
        fileNaming: settings.fileNaming || 'original',
        sendCookies: Boolean(settings.sendCookies),
        volume,
        volumes,
        items,
      },
    }).catch(error => {
      if (zipBuild) {
        const { reject: rejectBuild } = zipBuild;
        zipBuild = null;
        rejectBuild(error);
      }
    });
  });
}

/**
 * 打包并下载单个 ZIP 卷
 * 每卷结束后立即回写该卷条目状态，前序卷结果不因后续失败而丢失
 */
async function buildZipVolume(items, settings, { volume, volumes }) {
  await ensureOffscreenDocument();
  await waitForOffscreenReady();

  const zipName = makeZipFilename(new Date(), { volume, volumes });

  let result;
  try {
    result = await requestZipBuild({ zipName, items, settings, volume, volumes });
  } catch (error) {
    // 超时/发送失败时文档内可能仍有进行中的打包，关闭以复位，避免下一轮复用脏文档
    await closeOffscreenDocument().catch(() => {});
    throw error;
  }

  if (result?.error) {
    await closeOffscreenDocument().catch(() => {});
    throw new Error(result.error);
  }

  const downloadId = await chrome.downloads.download({
    url: result.blobUrl,
    filename: `${settings.savePath || 'OpenDownload'}/${result.zipName || zipName}`,
    saveAs: false,
    conflictAction: 'uniquify',
  });

  let downloadError = null;
  try {
    await waitForDownload(downloadId);
  } catch (error) {
    downloadError = error;
  } finally {
    // blob URL 随 offscreen 文档销毁失效，确保下载结束后再关闭文档
    await closeOffscreenDocument().catch(() => {});
  }

  (result.succeededIds || []).forEach(id => store.updateMediaStatus(id, 'downloaded'));
  (result.failedItems || []).forEach(item => store.updateMediaStatus(item.id, 'failed'));

  if (downloadError) throw downloadError;

  return {
    zipName: result.zipName || zipName,
    succeeded: result.succeeded,
    failed: result.failed,
    failedItems: result.failedItems || [],
  };
}

/**
 * ZIP 分卷打包：逐卷串行（offscreen 同一时刻只有一个打包任务）
 * @param {Object} settings - 完整设置对象
 * @param {Object[][]} volumes - 已切分好的卷
 */
async function handleZipDownload(settings, volumes) {
  let succeeded = 0;
  let failed = 0;
  const failures = [];
  const volumeNames = [];

  for (let index = 0; index < volumes.length; index++) {
    const result = await buildZipVolume(volumes[index], settings, {
      volume: index + 1,
      volumes: volumes.length,
    });

    volumeNames.push(result.zipName);
    succeeded += result.succeeded;
    failed += result.failed;
    failures.push(...result.failedItems);
  }

  return {
    succeeded,
    failed,
    strategy: 'zip',
    volumes: volumeNames,
    failedItems: failures.slice(0, FAILURE_SUMMARY_LIMIT),
  };
}

/**
 * 混合批次：视频逐条直下 + 其余条目打包（V16-02）
 * 先直下后打包——直下部分通常是用户等着看的结果，而分卷打包耗时最长；
 * 两条路径互不阻断，任一失败仍继续另一条，最后合并计数
 * @returns {Promise<{succeeded, failed, strategy, volumes, directSucceeded, failedItems}>}
 */
async function handleMixedDownload(plan, settings) {
  const directResult = await handleDirectDownload(plan.directItems, settings);
  const zipResult = await handleZipDownload(settings, plan.volumes);

  return {
    succeeded: directResult.succeeded + zipResult.succeeded,
    failed: directResult.failed + zipResult.failed,
    strategy: 'mixed',
    volumes: zipResult.volumes,
    // 供 UI 分开报数（「视频 N 个已逐条下载，图片打包为 M 卷」）
    directSucceeded: directResult.succeeded,
    failedItems: [...directResult.failedItems, ...zipResult.failedItems]
      .slice(0, FAILURE_SUMMARY_LIMIT),
  };
}

/**
 * 批量下载入口：按 planTransfer 结果选择逐条直下、ZIP 分卷或两者的混合
 * @param {Object} payload - { ids: string[], strategy?: 'auto'|'zip'|'direct' }
 * @returns {Promise<{succeeded, failed, strategy, volumes, failedItems}>}
 */
async function handleDownloadZip(payload) {
  await store.init();
  if (batchInProgress || zipBuild) {
    throw new Error(t('errorZipInProgress'));
  }

  const ids = payload?.ids || [];
  const items = ids.map(id => store.getImageById(id)).filter(Boolean);
  if (items.length === 0) {
    throw new Error(t('errorNothingToDownload'));
  }

  const settings = store.getSettings();
  const requested = payload?.strategy || 'auto';

  let plan;
  if (requested === 'direct') {
    plan = { strategy: 'direct', volumes: [] };
  } else if (requested === 'zip') {
    // 显式要求打包时不做分卷，保持既有单包行为
    plan = { strategy: 'zip', volumes: [items] };
  } else {
    plan = planTransfer(items, settings);
  }

  batchInProgress = true;
  try {
    if (plan.strategy === 'direct') {
      // directItems 覆盖全部条目（要么全是视频，要么超阈值整批直下），缺省时退回整批
      return await handleDirectDownload(plan.directItems?.length ? plan.directItems : items, settings);
    }
    if (plan.strategy === 'mixed') {
      return await handleMixedDownload(plan, settings);
    }
    return await handleZipDownload(settings, plan.volumes);
  } finally {
    batchInProgress = false;
  }
}

// ─── 内容级图像指标（V16-03） ──────────────────────────

// 计算通道整体超时：超时按已拿到的部分结果收尾，不回滚
// （已写入的指标本身就是有效数据，丢弃重算的代价更大）
const PHASH_TIMEOUT = 180000;
let phashRun = null;

/**
 * 广播分析进度/结果给 popup
 * running 由 phashRun 是否存在推导，避免两处状态各写一半
 */
function broadcastPhashState(extra = {}) {
  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.PHASH_STATE,
    payload: {
      running: Boolean(phashRun),
      done: phashRun ? phashRun.done : 0,
      total: phashRun ? phashRun.total : 0,
      ...extra,
    },
  }).catch(() => {});
}

/**
 * 处理 offscreen 逐条回传的指标结果
 * 每条都立刻写回 store 并转发进度：popup 不必等全部完成才有反馈，
 * 中途失败或超时也不会丢掉已完成的部分
 */
function handlePhashResult(payload = {}) {
  if (!phashRun) return;

  const { id, phash, sharpness, error } = payload;

  if (error) {
    phashRun.failed++;
  } else if (id) {
    store.updateMediaMetrics(id, { phash, sharpness });
  }

  phashRun.done++;
  broadcastPhashState({ running: true });

  if (phashRun.done >= phashRun.total) {
    phashRun.settle({ done: phashRun.done, failed: phashRun.failed });
  }
}

/**
 * 请求计算缺失的内容级指标（按需触发，不在捕获期计算）
 * 只接受图片：视频要先解码帧，本期不纳入（其 sharpness 保持 0，
 * 排序时自然回落到捕获时间，不会打乱视频列表）
 *
 * @param {Object} payload - { ids: string[] }
 * @returns {Promise<{total, analyzed, failed, timedOut}>}
 */
async function handlePhashRequest(payload) {
  await store.init();
  if (phashRun) throw new Error(t('errorPhashInProgress'));

  const ids = payload?.ids || [];
  const items = ids
    .map(id => store.getImageById(id))
    .filter(item => item && item.mediaType === MEDIA_TYPES.IMAGE);
  if (items.length === 0) throw new Error(t('errorNothingToAnalyze'));

  const settings = store.getSettings();
  await ensureOffscreenDocument();
  await waitForOffscreenReady();

  const summary = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (phashRun) {
        const run = phashRun;
        phashRun = null;
        resolve({ done: run.done, failed: run.failed, timedOut: true });
      }
    }, PHASH_TIMEOUT);

    phashRun = {
      total: items.length,
      done: 0,
      failed: 0,
      settle: extra => {
        clearTimeout(timer);
        phashRun = null;
        resolve(extra);
      },
      reject: error => {
        clearTimeout(timer);
        phashRun = null;
        reject(error);
      },
    };

    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.PHASH_REQUEST,
      payload: {
        items: items.map(item => ({ id: item.id, url: item.url })),
        sendCookies: Boolean(settings.sendCookies),
      },
    }).catch(error => {
      if (phashRun) phashRun.reject(error);
    });
  });

  // 指标已写回 store，offscreen 无需留存（与 ZIP 的 blob URL 不同）
  await closeOffscreenDocument().catch(() => {});
  broadcastPhashState({
    running: false,
    done: summary.done,
    failed: summary.failed,
    total: items.length,
    timedOut: Boolean(summary.timedOut),
  });

  return {
    total: items.length,
    analyzed: summary.done - summary.failed,
    failed: summary.failed,
    timedOut: Boolean(summary.timedOut),
  };
}

// ─── 站点适配器（V16-01） ──────────────────────────────

// 规则零命中的告警按页面 URL 去重，避免同一页面反复扫描刷屏
const ruleMissWarnedUrls = new Set();
const RULE_MISS_WARN_CACHE_LIMIT = 200;

function warnRuleMissOnce(pageUrl, ruleId) {
  if (!pageUrl || ruleMissWarnedUrls.has(pageUrl)) return;

  if (ruleMissWarnedUrls.size >= RULE_MISS_WARN_CACHE_LIMIT) {
    ruleMissWarnedUrls.clear();
  }
  ruleMissWarnedUrls.add(pageUrl);

  // 仅开发者可见的诊断信息：规则可能已随站点改版失效，需要修规则而不是打扰用户
  console.warn(
    `[OpenDownload] 站点规则 ${ruleId || 'unknown'} 在本页零命中，已退回通用兜底：${pageUrl}`
  );
}

/**
 * 为页面解析站点规则并编译为可序列化的提取计划
 * content script 是 classic script 无法 import，因此规则匹配统一在这里完成
 * @param {{pageUrl?: string, pageDomain?: string}} payload - 页面上下文
 * @returns {{ruleId: string}|null} 提取计划，无规则命中返回 null
 */
function resolveSitePlan(payload = {}) {
  const rule = matchSiteRule(
    { pageUrl: payload.pageUrl || '', pageDomain: payload.pageDomain || '' },
    SITE_RULES
  );
  return rule ? buildExtractPlan(rule) : null;
}

// ─── DOM 兜底捕获（content script 扫描结果入库） ───────

/**
 * 处理 content script 上报的页面媒体元素：
 * 已存在记录只富化尺寸/时长/封面；webRequest 漏捕的资源兜底入库（source='dom'）。
 * @param {Object} payload - { pageUrl, pageDomain, pageTitle, images: [], videos: [], ruleId, ruleMiss }
 * @returns {Promise<{added: number, updated: number}>}
 */
async function handleDomMediaUpdate(payload) {
  await store.init();
  const settings = store.getSettings();

  // 生效判定：全局开关 + 站点规则（与 webRequest 链路同一函数）
  if (!isCaptureAllowed(settings, payload?.pageDomain || '')) {
    return { added: 0, updated: 0 };
  }

  // 规则零命中说明站点结构可能已变，留一条诊断线索（按页面去重；关闭捕获时不产生噪音）
  if (payload?.ruleMiss) {
    warnRuleMissOnce(payload.pageUrl || '', payload.ruleId || '');
  }

  const pageUrl = payload?.pageUrl || '';
  const pageTitle = payload?.pageTitle || '';
  const candidates = [
    ...(payload?.images || []).map(item => ({ ...item, elementMediaType: 'image' })),
    ...(payload?.videos || []).map(item => ({
      ...item,
      // poster 映射为预览封面
      previewUrl: item.poster || item.previewUrl || '',
      elementMediaType: 'video',
    })),
  ];

  let added = 0;
  let enriched = 0;

  for (const candidate of candidates) {
    const url = candidate.url || '';
    // blob:/data: 不可重复下载或体积不可控；空 URL（如 blob 流媒体视频仅剩 poster）跳过
    if (!url || url.startsWith('blob:') || url.startsWith('data:')) continue;

    const mediaType = detectMediaType({ url }) || candidate.elementMediaType;
    if (!mediaType) continue;

    // 捕获期过滤沿用设置；DOM 无 Content-Length，大小过滤不适用
    if (settings.filters.mediaTypes.length > 0 && !settings.filters.mediaTypes.includes(mediaType)) continue;

    const domain = extractDomain(url);
    if (settings.filters.domains.length > 0 && settings.filters.domains.includes(domain)) continue;

    const extension = getNormalizedExtension(url);
    if (settings.filters.extensions.length > 0) {
      // 与 webRequest 链路一致：过滤列表允许带前导点
      const allowedExtensions = settings.filters.extensions.map(ext => ext.replace(/^\./, '').toLowerCase());
      if (!allowedExtensions.includes(extension)) continue;
    }

    const details = {
      width: candidate.width,
      height: candidate.height,
      alt: candidate.alt,
      previewUrl: candidate.previewUrl,
      duration: candidate.duration,
    };
    enriched += store.updateImageDetailsByUrl(url, details);

    if (store.findMediaByUrl(url)) continue;

    const media = store.addMedia({
      mediaType,
      url,
      filename: extractFilename(url),
      extension: extension || extensionFromMimeType(''),
      domain,
      mimeType: '',
      size: 0,
      width: candidate.width || 0,
      height: candidate.height || 0,
      duration: candidate.duration || 0,
      alt: candidate.alt || '',
      previewUrl: candidate.previewUrl || url,
      tabUrl: pageUrl,
      tabTitle: pageTitle,
      source: 'dom',
    });

    if (media) {
      added++;
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.MEDIA_FOUND,
        payload: media,
      }).catch(() => {});
    }
  }

  if (added > 0) {
    renderBadge(store.getStats().unread);
  }

  if (enriched > 0) {
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.MEDIA_DETAILS_UPDATED,
      payload: { images: store.getImages() },
    }).catch(() => {});
  }

  return { added, updated: enriched };
}

// ─── 自动滚动抓取路由（popup → content script） ────────

async function routeScrollCapture(type) {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return { success: false, error: t('errorNoActiveTab') };
  }
  if (!tab?.id) {
    return { success: false, error: t('errorNoActiveTab') };
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type });
    return { success: true };
  } catch {
    // 页面无 content script（chrome:// 等）
    return { success: false, error: t('errorScrollUnsupported') };
  }
}

// ─── 消息处理 ──────────────────────────────────────────

function handleRuntimeMessage(message, sender, sendResponse) {
  (async () => {
    try {
      switch (message.type) {
        case MESSAGE_TYPES.TOGGLE_LISTENING: {
          await store.init();
          const enabled = message.payload?.enabled !== undefined
            ? message.payload.enabled
            : !store.getSettings().enabled;
          await store.saveSettings({ enabled });
          sendResponse({ success: true, enabled: store.getSettings().enabled });
          break;
        }

        case MESSAGE_TYPES.GET_STATUS: {
          await store.init();
          sendResponse({
            success: true,
            enabled: store.getSettings().enabled,
            stats: store.getStats(),
            imageCount: store.getImages().length,
          });
          break;
        }

        case MESSAGE_TYPES.GET_IMAGES: {
          await store.init();
          const filters = message.payload?.filters || {};
          const images = store.getFilteredImages(filters);
          sendResponse({ success: true, images, total: store.getImages().length });
          break;
        }

        case MESSAGE_TYPES.CLEAR_IMAGES: {
          store.clearAll();
          // 清空列表同时清空角标，避免残留一个已不存在的数字
          renderBadge(0);
          sendResponse({ success: true });
          break;
        }

        case MESSAGE_TYPES.MARK_CAPTURED_READ: {
          await store.init();
          store.markCapturedRead();
          renderBadge(0);
          sendResponse({ success: true, unread: 0 });
          break;
        }

        // DOWNLOAD_SELECTED 已随 V16-02 删除：其唯一用途（显式整批直下）由
        // DOWNLOAD_ZIP + payload.strategy='direct' 覆盖，无需单独维护一条消息通路

        case MESSAGE_TYPES.DOWNLOAD_ONE: {
          await store.init();
          const image = store.getImageById(message.payload?.id);
          if (!image) {
            sendResponse({ success: false, error: 'media not found' });
            break;
          }
          const result = await downloader.downloadImage(image);
          sendResponse({ success: result.success, error: result.error, cancelled: result.cancelled });
          break;
        }

        case MESSAGE_TYPES.CANCEL_DOWNLOAD: {
          await store.init();
          const id = message.payload?.id;
          const cancelled = id
            ? await downloader.cancelOne(id)
            : (await downloader.cancelAll(), true);
          sendResponse({ success: true, cancelled });
          break;
        }

        case MESSAGE_TYPES.DOWNLOAD_ZIP: {
          const result = await handleDownloadZip(message.payload);
          sendResponse({ success: true, ...result });
          break;
        }

        case MESSAGE_TYPES.REMOVE_IMAGE: {
          store.removeImage(message.payload?.id);
          sendResponse({ success: true });
          break;
        }

        case MESSAGE_TYPES.UPDATE_SETTINGS: {
          await store.init();
          const newSettings = await store.saveSettings(message.payload?.settings || {});
          sendResponse({ success: true, settings: newSettings });
          break;
        }

        case MESSAGE_TYPES.GET_SETTINGS: {
          await store.init();
          sendResponse({ success: true, settings: store.getSettings() });
          break;
        }

        case MESSAGE_TYPES.DOM_MEDIA_UPDATE: {
          const result = await handleDomMediaUpdate(message.payload);
          sendResponse({ success: true, ...result });
          break;
        }

        case MESSAGE_TYPES.PHASH_REQUEST: {
          const result = await handlePhashRequest(message.payload);
          sendResponse({ success: true, ...result });
          break;
        }

        case MESSAGE_TYPES.PHASH_RESULT: {
          // offscreen 逐条回传：写回 store 并转发进度，本身不需要等待
          handlePhashResult(message.payload);
          sendResponse({ success: true });
          break;
        }

        case MESSAGE_TYPES.SCROLL_CAPTURE_START:
        case MESSAGE_TYPES.SCROLL_CAPTURE_STOP: {
          const result = await routeScrollCapture(message.type);
          sendResponse(result);
          break;
        }

        case MESSAGE_TYPES.SCROLL_CAPTURE_STATE: {
          // content script 广播给 popup 的状态消息，background 只需确认接收
          sendResponse({ success: true });
          break;
        }

        case MESSAGE_TYPES.GET_SITE_PLAN: {
          // 规则匹配在 background 完成，content script 只消费可序列化的计划
          sendResponse({ success: true, plan: resolveSitePlan(message.payload) });
          break;
        }

        case MESSAGE_TYPES.UPDATE_MEDIA_STATUSES: {
          await store.init();
          const ids = message.payload?.ids || [];
          const status = message.payload?.status || 'downloaded';
          ids.forEach(id => store.updateMediaStatus(id, status));
          sendResponse({ success: true, updated: ids.length, stats: store.getStats() });
          break;
        }

        case MESSAGE_TYPES.ZIP_OFFSCREEN_READY: {
          markOffscreenReady();
          sendResponse({ success: true });
          break;
        }

        case MESSAGE_TYPES.ZIP_BUILD_PROGRESS: {
          // 转播打包进度给 popup
          chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.ZIP_PROGRESS,
            payload: message.payload,
          }).catch(() => {});
          sendResponse({ success: true });
          break;
        }

        case MESSAGE_TYPES.ZIP_BUILD_RESULT: {
          if (zipBuild) {
            const { resolve } = zipBuild;
            zipBuild = null;
            resolve(message.payload);
          }
          sendResponse({ success: true });
          break;
        }

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('[OpenDownload] 消息处理错误:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // 保持 channel 开通用于异步响应
}

chrome.runtime.onMessage.addListener(handleRuntimeMessage);

// ─── 扩展安装/更新 ────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await store.init();

  // 创建右键菜单
  // 菜单标题用 __MSG_*__ 占位，由 chrome.i18n 按浏览器语言解析
  chrome.contextMenus.create({
    id: 'open-download-toggle',
    title: '__MSG_menuToggleListening__',
    contexts: ['action'],
  });

  chrome.contextMenus.create({
    id: 'open-download-clear',
    title: '__MSG_menuClearList__',
    contexts: ['action'],
  });

  chrome.contextMenus.create({
    id: 'open-download-site-toggle',
    title: '__MSG_menuSiteToggle__',
    contexts: ['page'],
  });

  chrome.contextMenus.create({
    id: 'open-download-image',
    title: '__MSG_menuDownloadImage__',
    contexts: ['image'],
  });

  // 扩展重载后角标会被清空，按持久化的未读数恢复
  renderBadge(store.getStats().unread);

  console.log('[OpenDownload] 扩展已安装');
});

// ─── 全局快捷键（V16-04） ──────────────────────────────
// 注意：manifest 的 commands 是顶层字段，不是 permissions 条目，因此没有新增权限

chrome.commands.onCommand.addListener(async (command) => {
  await store.init();

  switch (command) {
    case 'toggle-listening': {
      await toggleListening();
      break;
    }
    case 'scroll-capture': {
      // 用户可能停在不可抓取的页面（chrome:// 等），静默失败即可
      await routeScrollCapture(MESSAGE_TYPES.SCROLL_CAPTURE_START);
      break;
    }
    default:
      break;
  }
});

// ─── 扩展启动（浏览器重启） ────────────────────────────

chrome.runtime.onStartup.addListener(async () => {
  await store.init();
  // 角标是浏览器侧状态，重启后按持久化的未读数重新渲染
  renderBadge(store.getStats().unread);
});

/**
 * 右键「下载此图」：显式下载用户点击的那张图
 * 语义要点（见 v1.6 设计文档 FR-4.3）：
 * - 已存在的记录不重复入库，直接对该条记录触发下载（用户意图是下载，不是登记）
 * - 站点被暂停或全局关闭时不入库，但下载照常执行（用户是显式要求）
 * @param {Object} info - 右键菜单点击信息（使用 info.srcUrl）
 * @param {Object} tab - 来源标签页
 */
async function downloadImageFromContextMenu(info, tab) {
  const url = info?.srcUrl || '';
  // 与捕获链路同一原则：blob:/data: 不可重复下载或体积不可控
  if (!url || url.startsWith('blob:') || url.startsWith('data:')) return;

  // 右键菜单来自 contexts: ['image']，元素类型已知；判不出类型时兜底为图片
  const mediaType = detectMediaType({ url }) || MEDIA_TYPES.IMAGE;

  if (!isCaptureAllowed(store.getSettings(), extractDomain(info?.pageUrl || ''))) {
    // downloadImage 对「记录不存在」是安全的（状态更新会被 store 忽略）
    await downloader.downloadImage({
      id: `context-menu-${Date.now()}`,
      mediaType,
      url,
      domain: extractDomain(url),
      mimeType: '',
    });
    return;
  }

  let media = store.findMediaByUrl(url);
  if (!media) {
    media = store.addMedia({
      mediaType,
      url,
      filename: extractFilename(url),
      extension: getNormalizedExtension(url),
      domain: extractDomain(url),
      mimeType: '',
      size: 0,
      tabUrl: info?.pageUrl || '',
      tabTitle: tab?.title || '',
      // 该 URL 来自页面里的 DOM 元素，与 DOM 兜底捕获同源
      source: 'dom',
    });

    if (media) {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.MEDIA_FOUND,
        payload: media,
      }).catch(() => {});
      renderBadge(store.getStats().unread);
    }
  }

  if (media) {
    await downloader.downloadImage(media);
  }
}

// ─── 右键菜单处理 ──────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await store.init();
  switch (info.menuItemId) {
    case 'open-download-toggle': {
      await toggleListening();
      break;
    }
    case 'open-download-clear': {
      store.clearAll();
      renderBadge(0);
      break;
    }
    case 'open-download-image': {
      await downloadImageFromContextMenu(info, tab);
      break;
    }
    case 'open-download-site-toggle': {
      const domain = tab?.url ? extractDomain(tab.url) : '';
      if (!domain || domain === 'unknown') break;

      // 整表替换语义：存在 block 键即删除（恢复跟随全局），否则置 block
      const siteRules = { ...(store.getSettings().siteRules || {}) };
      if (siteRules[domain] === 'block') {
        delete siteRules[domain];
      } else {
        siteRules[domain] = 'block';
      }

      const settings = await store.saveSettings({ siteRules });
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SITE_RULES_CHANGED,
        payload: { siteRules: settings.siteRules },
      }).catch(() => {});
      break;
    }
  }
});

export {
  handleRuntimeMessage,
  onRequestCompleted,
  ensureOffscreenDocument,
  isCaptureAllowed,
  handleDomMediaUpdate,
  routeScrollCapture,
  planTransfer,
  resolveSitePlan,
};
