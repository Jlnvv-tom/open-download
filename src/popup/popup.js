// popup/popup.js — Popup 交互逻辑

import {
  CAPACITY_WARNING_THRESHOLD,
  IMAGE_FORMAT_TABS,
  MAX_CAPTURED_IMAGES,
  MEDIA_TYPES,
  MESSAGE_TYPES,
  VIDEO_FORMAT_TABS
} from '../lib/constants.js';
import { groupBySimilarity } from '../lib/image-hash.js';
import { extractDomain, formatDuration, formatSize, getNormalizedExtension } from '../lib/utils.js';
import { applyI18n, t } from '../lib/i18n.js';

// ─── DOM 引用 ──────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

const el = {
  toggle: $('#toggle-listening'),
  statusDot: $('#status-dot'),
  statusText: $('#status-text'),
  siteRow: $('#site-row'),
  siteInfo: $('#site-info'),
  btnSiteToggle: $('#btn-site-toggle'),
  ratingRow: $('#rating-row'),
  btnRatingOpen: $('#btn-rating-open'),
  btnRatingClose: $('#btn-rating-close'),
  capacityHint: $('#capacity-hint'),
  statTotal: $('#stat-total'),
  statDownloaded: $('#stat-downloaded'),
  statFailed: $('#stat-failed'),
  statMatching: $('#stat-matching'),
  statSelected: $('#stat-selected'),
  mediaTabs: $('#media-tabs'),
  formatTabs: $('#format-tabs'),
  searchInput: $('#search-input'),
  btnFilter: $('#btn-filter'),
  btnViewList: $('#btn-view-list'),
  btnViewCard: $('#btn-view-card'),
  btnGroup: $('#btn-group'),
  btnScroll: $('#btn-scroll'),
  btnClear: $('#btn-clear'),
  filterPanel: $('#filter-panel'),
  sourceFilter: $('#source-filter'),
  sortControl: $('#sort-control'),
  mergeSimilar: $('#merge-similar'),
  mergeSimilarHint: $('#merge-similar-hint'),
  filterMinSize: $('#filter-min-size'),
  filterMinWidth: $('#filter-min-width'),
  filterMinHeight: $('#filter-min-height'),
  contentSizeRange: $('#content-size-range'),
  contentSizeInput: $('#content-size-input'),
  filterExtensions: $('#filter-extensions'),
  imageList: $('#image-list'),
  btnSelectAll: $('#btn-select-all'),
  btnExport: $('#btn-export'),
  btnDownloadSelected: $('#btn-download-selected'),
  btnDownloadAll: $('#btn-download-all'),
  lightbox: $('#lightbox'),
  lightboxStage: $('#lightbox-stage'),
  lightboxCaption: $('#lightbox-caption'),
  lightboxClose: $('#lightbox-close'),
  lightboxPrev: $('#lightbox-prev'),
  lightboxNext: $('#lightbox-next'),
};

// ─── 状态 ──────────────────────────────────────────────

let allMedia = [];
let selectedIds = new Set();
let isListening = false;
let activeMediaType = MEDIA_TYPES.IMAGE;
let activeFormat = 'all';
let viewMode = 'list';
let settings = null;
let groupByPage = false;
let sourceFilter = 'all';
let siteRules = {};
let currentDomain = '';
let scrollRunning = false;
// 内容级筛选（V16-03）
let mergeSimilar = false;
let sortBy = 'capturedAt';
let metricsRunning = false;
let metricsDone = 0;
let metricsTotal = 0;
// 折叠状态为内存态，不持久化
const collapsedGroups = new Set();
// 相似组默认只显示最清晰的一张，展开过的组记在这里（与页面分组的默认展开语义相反，故分开存）
const expandedGroups = new Set();
// 累计成功下载数达到该值后才考虑展示一次评分引导（V16-05）
const RATING_PROMPT_THRESHOLD = 20;
const DEFAULT_CONTENT_SIZE = 104;
let contentSize = DEFAULT_CONTENT_SIZE;
const EAGER_PREVIEW_COUNT = 36;

// lightbox 预览层状态（快照导航，不受列表重渲影响）
let lightboxOpen = false;
let lightboxItems = [];
let lightboxIndex = -1;

// ─── 消息通信 ──────────────────────────────────────────

function sendMessage(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      resolve(response || { success: false });
    });
  });
}

// ─── 工具 ──────────────────────────────────────────────

function debounce(fn, ms = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function makeStamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// ─── 初始化 ────────────────────────────────────────────

async function init() {
  // 静态文案先本地化，避免首屏闪现默认语言
  applyI18n(document);

  const settingsRes = await sendMessage(MESSAGE_TYPES.GET_SETTINGS);
  if (settingsRes.success) {
    settings = settingsRes.settings;
    activeMediaType = settings.ui?.mediaType || MEDIA_TYPES.IMAGE;
    viewMode = settings.ui?.viewMode || 'list';
    groupByPage = Boolean(settings.ui?.groupByPage);
    sourceFilter = settings.ui?.sourceFilter || 'all';
    mergeSimilar = Boolean(settings.ui?.mergeSimilar);
    sortBy = settings.ui?.sortBy === 'sharpness' ? 'sharpness' : 'capturedAt';
    el.mergeSimilar.checked = mergeSimilar;
    siteRules = settings.siteRules || {};
    const savedContentSize = settings.ui?.contentSize;
    contentSize = savedContentSize === undefined || savedContentSize === 132
      ? DEFAULT_CONTENT_SIZE
      : normalizeContentSize(savedContentSize);
    const savedMinDimensions = settings.filters?.minDimensions || {};
    el.filterMinWidth.value = savedMinDimensions.width ? String(savedMinDimensions.width) : '';
    el.filterMinHeight.value = savedMinDimensions.height ? String(savedMinDimensions.height) : '';
  }

  const status = await sendMessage(MESSAGE_TYPES.GET_STATUS);
  if (status.success) {
    isListening = status.enabled;
    el.toggle.checked = status.enabled;
    updateStatusUI(status.enabled);
    updateStats(status.stats);
    updateCapacityHint(status);
    maybeShowRatingPrompt(status.stats);
  }

  // 打开弹窗即视为「已查看」，清空扩展图标角标
  await sendMessage(MESSAGE_TYPES.MARK_CAPTURED_READ);

  await loadCurrentSite();
  await loadMedia();
  bindEvents();
}

/**
 * 读取当前标签页站点，用于站点级捕获开关（chrome:// 等特殊页不显示站点行）
 */
async function loadCurrentSite() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || '';
    // <all_urls> host 权限下可读 tab.url；非 http(s) 页面拿不到有效站点
    currentDomain = /^https?:/i.test(url) ? extractDomain(url) : '';
  } catch {
    currentDomain = '';
  }
  updateSiteRow();
}

// ─── 事件绑定 ──────────────────────────────────────────

function bindEvents() {
  el.toggle.addEventListener('change', async () => {
    const enabled = el.toggle.checked;
    const res = await sendMessage(MESSAGE_TYPES.TOGGLE_LISTENING, { enabled });
    if (res.success) {
      isListening = res.enabled;
      updateStatusUI(res.enabled);
    }
  });

  // 搜索与筛选输入统一防抖，避免连续输入触发多次渲染
  const renderMediaDebounced = debounce(renderMedia, 200);
  const renderAndSaveDimensionsDebounced = debounce(() => {
    renderMedia();
    saveMinDimensions();
  }, 200);

  el.searchInput.addEventListener('input', renderMediaDebounced);
  el.filterMinSize.addEventListener('input', renderMediaDebounced);
  el.filterMinWidth.addEventListener('input', renderAndSaveDimensionsDebounced);
  el.filterMinHeight.addEventListener('input', renderAndSaveDimensionsDebounced);
  el.filterExtensions.addEventListener('input', renderMediaDebounced);

  el.mediaTabs.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-media-type]');
    if (!button) return;
    activeMediaType = button.dataset.mediaType;
    activeFormat = 'all';
    await saveUiSettings();
    renderMedia();
  });

  el.formatTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-format]');
    if (!button) return;
    activeFormat = button.dataset.format;
    renderMedia();
  });

  el.btnViewList.addEventListener('click', async () => {
    viewMode = 'list';
    await saveUiSettings();
    renderMedia();
  });

  el.btnViewCard.addEventListener('click', async () => {
    viewMode = 'card';
    await saveUiSettings();
    renderMedia();
  });

  el.btnFilter.addEventListener('click', () => {
    const visible = el.filterPanel.style.display !== 'none';
    el.filterPanel.style.display = visible ? 'none' : 'flex';
  });

  el.sourceFilter.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-source]');
    if (!button) return;
    sourceFilter = button.dataset.source;
    await saveUiSettings();
    renderMedia();
  });

  el.sortControl.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-sort]');
    if (!button) return;
    sortBy = button.dataset.sort;
    await saveUiSettings();
    renderMedia();
    // 清晰度排序需要分数：缺失时才触发分析，完成后再由 PHASH_STATE 拉回并重渲
    if (sortBy === 'sharpness') requestContentMetrics();
  });

  el.mergeSimilar.addEventListener('change', async () => {
    mergeSimilar = el.mergeSimilar.checked;

    // 两套分组语义互斥：相似归并优先，按页面分组置为不可用（按钮 title 里说明，不静默切换）
    if (mergeSimilar) groupByPage = false;
    expandedGroups.clear();

    await saveUiSettings();
    renderMedia();
    if (mergeSimilar) requestContentMetrics();
  });

  el.btnGroup.addEventListener('click', async () => {
    groupByPage = !groupByPage;
    await saveUiSettings();
    renderMedia();
  });

  el.btnScroll.addEventListener('click', async () => {
    const type = scrollRunning
      ? MESSAGE_TYPES.SCROLL_CAPTURE_STOP
      : MESSAGE_TYPES.SCROLL_CAPTURE_START;
    const res = await sendMessage(type);
    if (!res.success) {
      alert(res.error || t('errorScrollUnsupported'));
      return;
    }
    if (type === MESSAGE_TYPES.SCROLL_CAPTURE_START) {
      setScrollRunning(true);
    }
  });

  el.btnRatingOpen.addEventListener('click', openStorePage);
  el.btnRatingClose.addEventListener('click', dismissRatingPrompt);

  el.btnSiteToggle.addEventListener('click', async () => {
    if (!currentDomain) return;

    // siteRules 为整表替换语义：恢复跟随 = 从表中删除该键
    const next = { ...siteRules };
    if (next[currentDomain] === 'block') {
      delete next[currentDomain];
    } else {
      next[currentDomain] = 'block';
    }

    const res = await sendMessage(MESSAGE_TYPES.UPDATE_SETTINGS, {
      settings: { siteRules: next },
    });
    if (res.success) {
      siteRules = res.settings?.siteRules || next;
      updateSiteRow();
    }
  });

  el.contentSizeRange.addEventListener('input', () => updateContentSize(el.contentSizeRange.value, false));
  el.contentSizeRange.addEventListener('change', () => saveUiSettings());
  el.contentSizeInput.addEventListener('input', () => updateContentSize(el.contentSizeInput.value, false));
  el.contentSizeInput.addEventListener('change', () => {
    updateContentSize(el.contentSizeInput.value, true);
    saveUiSettings();
  });

  el.btnClear.addEventListener('click', async () => {
    if (!confirm(t('confirmClear'))) return;
    await sendMessage(MESSAGE_TYPES.CLEAR_IMAGES);
    allMedia = [];
    selectedIds.clear();
    collapsedGroups.clear();
    expandedGroups.clear();
    closeLightbox();
    renderMedia();
    updateStats({ total: 0, downloaded: 0, failed: 0 });
  });

  el.btnSelectAll.addEventListener('click', () => {
    const filtered = getFilteredMedia();
    const allCurrentSelected = filtered.length > 0 && filtered.every(media => selectedIds.has(media.id));

    if (allCurrentSelected) {
      filtered.forEach(media => selectedIds.delete(media.id));
    } else {
      filtered.forEach(media => selectedIds.add(media.id));
    }
    renderMedia();
  });

  // 导出当前筛选结果（所见即所导）
  el.btnExport.addEventListener('click', () => {
    const filtered = getFilteredMedia();
    if (filtered.length === 0) {
      alert(t('alertNoExport'));
      return;
    }
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `open-download-export-${makeStamp()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  el.btnDownloadSelected.addEventListener('click', async () => {
    const selected = allMedia.filter(media => selectedIds.has(media.id));
    if (selected.length === 0) {
      alert(t('alertNoSelection'));
      return;
    }
    await downloadMediaAsZip(selected, el.btnDownloadSelected, t('btnDownloadSelected'));
  });

  el.btnDownloadAll.addEventListener('click', async () => {
    const filtered = getFilteredMedia();
    if (filtered.length === 0) {
      alert(t('alertNoDownloadable'));
      return;
    }
    await downloadMediaAsZip(filtered, el.btnDownloadAll, t('btnDownloadAll'));
  });

  // 列表容器事件委托：渲染替换 innerHTML 后监听依然有效
  el.imageList.addEventListener('click', (event) => {
    // 相似组头：展开/收起到「只看最清晰」
    const similarHeader = event.target.closest('[data-similar]');
    if (similarHeader) {
      toggleSimilarGroup(similarHeader);
      return;
    }

    // 分组头：切换组内容折叠（组头不是条目的祖先，先于 data-id 判定）
    const groupHeader = event.target.closest('[data-group]');
    if (groupHeader) {
      toggleGroupCollapse(groupHeader);
      return;
    }

    const actionEl = event.target.closest('[data-action]');
    const item = event.target.closest('[data-id]');
    if (!actionEl) {
      // 点击条目空白区域 = 切换选中
      if (item) toggleSelection(item.dataset.id);
      return;
    }
    const id = item?.dataset.id;
    switch (actionEl.dataset.action) {
      case 'select':
        if (id) toggleSelection(id);
        break;
      case 'open':
        if (id) openLightbox(id);
        break;
      case 'download':
        if (id) downloadOne(id, actionEl);
        break;
      case 'cancel':
        if (id) cancelOne(id);
        break;
      case 'remove':
        if (id) removeMedia(id);
        break;
    }
  });

  // lightbox 交互
  el.lightboxClose.addEventListener('click', closeLightbox);
  el.lightboxPrev.addEventListener('click', () => lightboxNav(-1));
  el.lightboxNext.addEventListener('click', () => lightboxNav(1));
  el.lightbox.addEventListener('click', (event) => {
    if (event.target === el.lightbox) closeLightbox();
  });
  document.addEventListener('keydown', (event) => {
    if (!lightboxOpen) return;
    if (event.key === 'Escape') closeLightbox();
    else if (event.key === 'ArrowLeft') lightboxNav(-1);
    else if (event.key === 'ArrowRight') lightboxNav(1);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === MESSAGE_TYPES.MEDIA_FOUND) {
      handleMediaFound(normalizeMedia(message.payload));
    }
    if (message.type === MESSAGE_TYPES.MEDIA_DETAILS_UPDATED) {
      allMedia = (message.payload?.images || allMedia).map(normalizeMedia);
      // 预览打开期间跳过重渲，关闭时统一校准
      if (!lightboxOpen) renderMedia();
    }
    if (message.type === MESSAGE_TYPES.ZIP_PROGRESS) {
      if (activeZipButton) {
        const { done = 0, total = 0, volume, volumes } = message.payload || {};
        zipProgressSeen = true;
        const volumePrefix = volumes > 1 ? `${t('progressVolume', volume, volumes)} ` : '';
        activeZipButton.textContent = `${volumePrefix}${t('progressPacking', done, total)}`;
      }
    }
    if (message.type === MESSAGE_TYPES.DOWNLOAD_STATUS_CHANGED) {
      const { id, status, error } = message.payload || {};
      if (id && status) setItemStatusUI(id, status, error || '');
      if (['downloaded', 'failed', 'pending'].includes(status)) {
        refreshStats();
      }
      // 逐条直下没有 ZIP 进度事件，用状态流转驱动按钮计数
      if (activeZipButton && !zipProgressSeen && ['downloaded', 'failed'].includes(status)) {
        activeZipCompleted = Math.min(activeZipCompleted + 1, activeZipTotal);
        activeZipButton.textContent = t('progressProcessing', activeZipCompleted, activeZipTotal);
      }
    }
    if (message.type === MESSAGE_TYPES.SITE_RULES_CHANGED) {
      // 右键菜单触发的站点规则变更，同步站点行
      siteRules = message.payload?.siteRules || {};
      updateSiteRow();
    }
    if (message.type === MESSAGE_TYPES.SCROLL_CAPTURE_STATE) {
      setScrollRunning(Boolean(message.payload?.running));
    }
    if (message.type === MESSAGE_TYPES.PHASH_STATE) {
      // 只负责进度反馈：数据回填统一由发起方在请求结束时 loadMedia() 完成，
      // 避免「广播重渲 + 请求返回重渲」两份渲染
      const { running, done = 0, total = 0 } = message.payload || {};
      metricsRunning = Boolean(running);
      metricsDone = done;
      metricsTotal = total;
      updateMetricsHint();
    }
  });
}

// ─── 数据加载与筛选 ────────────────────────────────────

async function loadMedia() {
  el.imageList.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const res = await sendMessage(MESSAGE_TYPES.GET_IMAGES);
  if (res.success) {
    allMedia = res.images.map(normalizeMedia);
    renderMedia();
    updateStats({ total: res.total });
  }
  await refreshStats();
}

async function refreshStats() {
  const status = await sendMessage(MESSAGE_TYPES.GET_STATUS);
  if (status.success) {
    updateStats(status.stats);
    updateCapacityHint(status);
  }
}

function normalizeMedia(media) {
  return {
    ...media,
    mediaType: media.mediaType || MEDIA_TYPES.IMAGE,
    previewUrl: media.previewUrl || media.url || '',
    extension: (media.extension || getNormalizedExtension(media.filename || media.url || '')).replace(/^\./, ''),
  };
}

function saveUiSettings() {
  return sendMessage(MESSAGE_TYPES.UPDATE_SETTINGS, {
    settings: {
      ui: {
        mediaType: activeMediaType,
        viewMode,
        contentSize,
        groupByPage,
        sourceFilter,
        mergeSimilar,
        sortBy,
      },
    },
  });
}

function saveMinDimensions() {
  return sendMessage(MESSAGE_TYPES.UPDATE_SETTINGS, {
    settings: {
      filters: {
        minDimensions: {
          width: parseInt(el.filterMinWidth.value, 10) || 0,
          height: parseInt(el.filterMinHeight.value, 10) || 0,
        },
      },
    },
  });
}

function normalizeContentSize(value) {
  const parsed = parseInt(value, 10);
  const size = Number.isFinite(parsed) ? parsed : DEFAULT_CONTENT_SIZE;
  return Math.max(84, Math.min(180, size));
}

function updateContentSize(value, clampInput) {
  contentSize = normalizeContentSize(value);
  document.documentElement.style.setProperty('--content-size', `${contentSize}px`);
  el.contentSizeRange.value = String(contentSize);
  if (clampInput || document.activeElement !== el.contentSizeInput) {
    el.contentSizeInput.value = String(contentSize);
  }
}

function getManualExtensions() {
  const raw = el.filterExtensions.value.trim();
  return raw
    ? raw.split(',').map(ext => ext.trim().replace(/^\./, '').toLowerCase()).filter(Boolean)
    : [];
}

function getFilteredMedia() {
  const search = el.searchInput.value.trim().toLowerCase();
  const minSize = parseInt(el.filterMinSize.value, 10) || 0;
  const minWidth = parseInt(el.filterMinWidth.value, 10) || 0;
  const minHeight = parseInt(el.filterMinHeight.value, 10) || 0;
  const manualExtensions = getManualExtensions();

  return allMedia.filter(media => {
    if (media.mediaType !== activeMediaType) return false;
    // 来源筛选：老数据无 source 字段，归一为网络捕获
    if (sourceFilter !== 'all' && (media.source || 'network') !== sourceFilter) return false;
    if (activeFormat !== 'all' && media.extension !== activeFormat) return false;
    if (manualExtensions.length > 0 && !manualExtensions.includes(media.extension)) return false;
    if (minSize > 0 && media.size < minSize * 1024) return false;
    // 最小宽高：尺寸未知的条目不参与该过滤
    if (minWidth > 0 && media.width > 0 && media.width < minWidth) return false;
    if (minHeight > 0 && media.height > 0 && media.height < minHeight) return false;
    if (search) {
      const haystack = `${media.url} ${media.filename} ${media.domain} ${media.extension}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

// ─── 单条下载 / 取消 ───────────────────────────────────

async function downloadOne(id, button) {
  if (button) button.disabled = true;
  setItemStatusUI(id, 'downloading', '');
  const res = await sendMessage(MESSAGE_TYPES.DOWNLOAD_ONE, { id });
  // 状态流转由 DOWNLOAD_STATUS_CHANGED 广播驱动；
  // 条目已不存在时不会有广播，这里回退状态
  if (res.success === false && res.error === 'media not found') {
    setItemStatusUI(id, 'pending');
  }
}

async function cancelOne(id) {
  const res = await sendMessage(MESSAGE_TYPES.CANCEL_DOWNLOAD, { id });
  // 取消成功时状态回退由广播（cancelled → pending）驱动；
  // 后台无进行中任务时重新拉取，同步真实状态
  if (res.success && res.cancelled === false) {
    await loadMedia();
  }
}

async function removeMedia(id) {
  await sendMessage(MESSAGE_TYPES.REMOVE_IMAGE, { id });
  selectedIds.delete(id);
  allMedia = allMedia.filter(media => media.id !== id);
  renderMedia();
}

// ─── ZIP 下载（打包在 background 的 offscreen document 中进行） ──

let activeZipButton = null;
let activeZipTotal = 0;
let activeZipCompleted = 0;
let zipProgressSeen = false;

async function downloadMediaAsZip(mediaItems, button, defaultText) {
  button.disabled = true;
  activeZipButton = button;
  activeZipTotal = mediaItems.length;
  activeZipCompleted = 0;
  zipProgressSeen = false;
  button.textContent = t('progressProcessing', 0, activeZipTotal);

  try {
    const result = await sendMessage(MESSAGE_TYPES.DOWNLOAD_ZIP, {
      ids: mediaItems.map(media => media.id),
    });

    if (result.success) {
      alert(formatDownloadSummary(result));
      await loadMedia();
    } else {
      alert(t('downloadFailed', result.error || t('unknownError')));
    }
  } catch (error) {
    alert(t('downloadFailed', error.message));
  } finally {
    activeZipButton = null;
    button.disabled = false;
    button.textContent = defaultText;
  }
}

/**
 * 汇总批量下载结果：传输策略、分卷数与失败原因（V15-01）
 */
function formatDownloadSummary(result) {
  const parts = [
    t('summarySucceeded', result.succeeded),
    t('summaryFailed', result.failed),
  ];

  if (result.strategy === 'direct') {
    parts.push(t('summaryDirect'));
  } else if (result.strategy === 'mixed') {
    // 混合批次：分别报数，避免用户以为「点一次下载却只拿到散文件」
    parts.push(t('summaryVideoDirect', result.directSucceeded || 0));
    if (result.volumes?.length > 1) {
      parts.push(t('summaryVolumes', result.volumes.length));
    }
  } else if (result.volumes?.length > 1) {
    parts.push(t('summaryVolumes', result.volumes.length));
  }

  let message = t('downloadDone', parts.join(t('listComma')));

  const reasons = (result.failedItems || [])
    .map(item => item.error)
    .filter(Boolean)
    .slice(0, 3);

  if (reasons.length > 0) {
    message += `\n${t('summaryFailureReasons', reasons.join(t('listSemicolon')))}`;
  }

  return message;
}

// ─── 渲染 ──────────────────────────────────────────────

function renderMedia() {
  const filtered = getFilteredMedia();
  updateContentSize(contentSize, false);
  renderMediaTabs();
  renderFormatTabs();
  updateViewButtons();
  updateGroupButton();
  updateSourceFilterUI();
  updateSortControlUI();
  updateSelectionButton(filtered);
  updateStats({
    total: allMedia.length,
    matching: filtered.length,
    selected: allMedia.filter(media => selectedIds.has(media.id)).length,
  });

  el.imageList.classList.toggle('card-mode', viewMode === 'card');

  if (filtered.length === 0) {
    renderEmptyState();
    return;
  }

  if (viewMode === 'card') {
    renderCardView(filtered);
  } else if (mergeSimilar) {
    renderSimilarListView(filtered);
  } else if (groupByPage) {
    renderGroupedListView(filtered);
  } else {
    renderListView(filtered);
  }
}

/**
 * 列表展示顺序
 * 默认按捕获时间倒序（存储是升序追加，反转即最新在前）；
 * 选清晰度时按分数降序，同分（多为未分析）回落到捕获时间，避免顺序随机
 */
function sortForDisplay(mediaItems) {
  const items = [...mediaItems];

  if (sortBy === 'sharpness') {
    return items.sort((a, b) => (
      (b.sharpness || 0) - (a.sharpness || 0) || (b.capturedAt || 0) - (a.capturedAt || 0)
    ));
  }

  return items.reverse();
}

function renderMediaTabs() {
  const counts = countBy(allMedia, 'mediaType');
  el.mediaTabs.querySelectorAll('[data-media-type]').forEach(button => {
    const mediaType = button.dataset.mediaType;
    button.classList.toggle('active', mediaType === activeMediaType);
    button.querySelector('.tab-count').textContent = counts[mediaType] || 0;
  });
}

function renderFormatTabs() {
  const formats = activeMediaType === MEDIA_TYPES.VIDEO ? VIDEO_FORMAT_TABS : IMAGE_FORMAT_TABS;
  const currentMedia = allMedia.filter(media => media.mediaType === activeMediaType);
  const counts = countBy(currentMedia, 'extension');
  const total = currentMedia.length;
  const tabs = ['all', ...formats];

  if (activeFormat !== 'all' && !tabs.includes(activeFormat)) {
    activeFormat = 'all';
  }

  el.formatTabs.innerHTML = tabs.map(format => {
    const label = format === 'all' ? t('tabAll') : format;
    const count = format === 'all' ? total : (counts[format] || 0);
    return `<button class="tab ${format === activeFormat ? 'active' : ''}" data-format="${format}">${escapeHtml(label)}<span class="tab-count">${count}</span></button>`;
  }).join('');
}

function renderListView(mediaItems) {
  el.imageList.innerHTML = sortForDisplay(mediaItems)
    .map((media, index) => listItemTemplate(media, index))
    .join('');
}

function renderCardView(mediaItems) {
  el.imageList.innerHTML = sortForDisplay(mediaItems)
    .map((media, index) => cardTemplate(media, index))
    .join('');
}

/**
 * 列表视图按来源页面分组渲染
 * 组间按组内最新 capturedAt 倒序，组内沿用「最新在前」
 */
function renderGroupedListView(mediaItems) {
  const groups = new Map();

  sortForDisplay(mediaItems).forEach(media => {
    const key = media.tabUrl || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(media);
  });

  const ordered = [...groups.entries()]
    .sort((a, b) => latestCapturedAt(b[1]) - latestCapturedAt(a[1]));

  el.imageList.innerHTML = ordered.map(([key, items]) => {
    const collapsed = collapsedGroups.has(key);
    return `
      <div class="list-group">
        <div class="list-group-header" data-group="${escapeAttr(key)}">
          <span class="group-arrow">${collapsed ? '▸' : '▾'}</span>
          <span class="group-title">${escapeHtml(groupTitleOf(items))}</span>
          <span class="group-count">${items.length}</span>
        </div>
        <div class="list-group-body"${collapsed ? ' hidden' : ''}>
          ${items.map((media, index) => listItemTemplate(media, index)).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function latestCapturedAt(items) {
  return items.reduce((max, media) => Math.max(max, media.capturedAt || 0), 0);
}

function groupTitleOf(items) {
  const first = items[0] || {};
  if (first.tabTitle) return first.tabTitle;
  return first.tabUrl ? extractDomain(first.tabUrl) : t('groupUnknownSource');
}

function toggleGroupCollapse(groupHeader) {
  const key = groupHeader.dataset.group || '';
  const collapsed = !collapsedGroups.has(key);

  if (collapsed) {
    collapsedGroups.add(key);
  } else {
    collapsedGroups.delete(key);
  }

  const body = groupHeader.nextElementSibling;
  if (body) body.hidden = collapsed;
  const arrow = groupHeader.querySelector('.group-arrow');
  if (arrow) arrow.textContent = collapsed ? '▸' : '▾';
}

/**
 * 相似图归并视图（V16-03）
 * 组内按清晰度降序、默认只展示最清晰的一张，点组头展开看全部；
 * 无法比较（phash 为空，多为未分析或计算失败）的条目各自成组，按普通条目平铺
 */
function renderSimilarListView(mediaItems) {
  const groups = groupBySimilarity(sortForDisplay(mediaItems));

  el.imageList.innerHTML = groups.map(group => {
    if (group.items.length === 1) {
      return listItemTemplate(group.items[0], 0);
    }

    const expanded = expandedGroups.has(group.key);
    const visible = expanded ? group.items : group.items.slice(0, 1);

    return `
      <div class="list-group">
        <div class="list-group-header similar-header" data-similar="${escapeAttr(group.key)}" title="${escapeAttr(t(expanded ? 'tooltipCollapseSimilar' : 'tooltipExpandSimilar'))}">
          <span class="group-arrow">${expanded ? '▾' : '▸'}</span>
          <span class="group-title">${escapeHtml(t('groupSimilarCount', group.items.length))}</span>
        </div>
        <div class="list-group-body">
          ${visible.map((media, index) => listItemTemplate(media, index)).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function toggleSimilarGroup(header) {
  const key = header.dataset.similar || '';

  if (expandedGroups.has(key)) {
    expandedGroups.delete(key);
  } else {
    expandedGroups.add(key);
  }

  // 组的构成与顺序都不变，只有组内可见条数变化；整体重渲比局部插删更不容易出错
  renderMedia();
}

/**
 * 请求补齐缺失的内容级指标（V16-03）
 * 只在需要时触发（开启相似归并 / 切到清晰度排序），不在捕获期计算；
 * 仅针对图片——视频需要解码帧，本期不纳入
 */
async function requestContentMetrics() {
  if (metricsRunning) return;

  const targets = allMedia.filter(media => media.mediaType === MEDIA_TYPES.IMAGE && !media.phash);
  if (targets.length === 0) return;

  metricsRunning = true;
  metricsDone = 0;
  metricsTotal = targets.length;
  updateMetricsHint();

  const res = await sendMessage(MESSAGE_TYPES.PHASH_REQUEST, {
    ids: targets.map(media => media.id),
  });

  metricsRunning = false;
  updateMetricsHint();

  if (!res.success) {
    alert(res.error || t('errorNothingToAnalyze'));
    return;
  }

  // 指标已写回 store，重新拉取后再渲染，保证列表用的是一份一致数据
  await loadMedia();

  if (res.failed > 0) {
    alert(t('mergeSimilarSummary', res.analyzed, res.failed));
  }
}

function updateMetricsHint() {
  el.mergeSimilarHint.textContent = metricsRunning
    ? t('mergeSimilarProgress', metricsDone, metricsTotal)
    : t('filterMergeSimilarHint');
}

// ─── 条目模板（全量渲染与增量插入共用） ────────────────

function listItemTemplate(media, index = 0) {
  const isSelected = selectedIds.has(media.id);
  const statusClass = media.status || 'pending';
  const duration = media.mediaType === MEDIA_TYPES.VIDEO ? formatDuration(media.duration) : '';

  return `
    <div class="image-item ${isSelected ? 'selected' : ''}" data-id="${media.id}">
      <div class="checkbox" data-action="select"></div>
      ${renderThumb(media, index)}
      <div class="image-info">
        <div class="image-name" title="${escapeHtml(media.filename)}">${escapeHtml(media.filename || media.url)}</div>
        <div class="image-meta">
          <span>${escapeHtml(media.domain)}</span>
          <span>${formatSize(media.size)}</span>
          ${duration ? `<span>${duration}</span>` : ''}
          <span>${escapeHtml(media.mimeType || media.extension || '')}</span>
        </div>
      </div>
      <span class="image-status ${statusClass}">${getStatusText(statusClass)}</span>
      <span class="item-action">${actionButtonHtml(media)}</span>
      <button class="image-remove" data-action="remove" title="${escapeAttr(t('tooltipRemove'))}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `;
}

function cardTemplate(media, index = 0) {
  const isSelected = selectedIds.has(media.id);

  return `
    <div class="media-card ${isSelected ? 'selected' : ''}" data-id="${media.id}" title="${escapeHtml(media.filename || media.url)}">
      <div class="media-card-check">✓</div>
      <span class="item-action">${actionButtonHtml(media)}</span>
      ${renderCardPreview(media, index)}
      ${renderCardInfo(media)}
    </div>
  `;
}

function actionButtonHtml(media) {
  const status = media.status || 'pending';

  if (status === 'downloading') {
    return `
      <button class="image-cancel" data-action="cancel" title="${escapeAttr(t('tooltipCancelDownload'))}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="6" y="6" width="12" height="12" rx="1"/>
        </svg>
      </button>
    `;
  }
  if (status === 'failed') {
    const tip = media.errorMsg
      ? t('tooltipRetryWithReason', media.errorMsg)
      : t('tooltipRetryDownload');
    return `
      <button class="image-retry" data-action="download" title="${escapeAttr(tip)}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
      </button>
    `;
  }
  if (status === 'pending') {
    return `
      <button class="image-download" data-action="download" title="${escapeAttr(t('tooltipDownload'))}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
      </button>
    `;
  }
  return ''; // downloaded 无操作按钮
}

function renderThumb(media, index = 0) {
  if (media.mediaType === MEDIA_TYPES.VIDEO) {
    return `
      <div class="image-thumb-placeholder" data-action="open">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z"/>
        </svg>
      </div>
    `;
  }

  const previewUrl = getPreviewUrl(media);
  const loading = getPreviewLoadingAttrs(index);

  return `
    <img class="image-thumb" data-action="open" src="${escapeHtml(previewUrl)}" alt="" ${loading} decoding="async" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
    <div class="image-thumb-placeholder" data-action="open" style="display:none;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
    </div>
  `;
}

function renderCardPreview(media, index = 0) {
  const previewUrl = getPreviewUrl(media);
  const loading = getPreviewLoadingAttrs(index);

  if (media.mediaType === MEDIA_TYPES.VIDEO) {
    const duration = formatDuration(media.duration);
    return `
      <div class="media-card-preview" data-action="open">
        <video src="${escapeHtml(previewUrl)}" muted preload="${index < EAGER_PREVIEW_COUNT ? 'metadata' : 'none'}"></video>
        ${duration ? `<span class="duration-badge">${duration}</span>` : ''}
        <div class="media-card-placeholder" style="display:none;">${escapeHtml(`${t('mediaVideoLabel')} ${media.extension || ''}`)}</div>
      </div>
    `;
  }

  return `
    <div class="media-card-preview" data-action="open">
      <img src="${escapeHtml(previewUrl)}" alt="" ${loading} decoding="async" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="media-card-placeholder" style="display:none;">${escapeHtml(`${t('mediaImageLabel')} ${media.extension || ''}`)}</div>
    </div>
  `;
}

function renderCardInfo(media) {
  const dimensions = getDimensionsText(media);
  const size = formatSize(media.size);
  const type = (media.extension || media.mediaType || '').toUpperCase();

  return `
    <div class="media-card-info">
      <div class="media-card-name">${escapeHtml(media.filename || media.url || t('mediaUnknownName'))}</div>
      <div class="media-card-meta">
        <span>${escapeHtml(dimensions)}</span>
        <span>${escapeHtml(size)}</span>
        <span>${escapeHtml(type)}</span>
      </div>
    </div>
  `;
}

function getDimensionsText(media) {
  if (media.width > 0 && media.height > 0) {
    return `${media.width}x${media.height}`;
  }
  return t('dimensionUnknown');
}

function getPreviewUrl(media) {
  return media.previewUrl || media.url || '';
}

function getPreviewLoadingAttrs(index) {
  return index < EAGER_PREVIEW_COUNT
    ? 'loading="eager" fetchpriority="high"'
    : 'loading="lazy" fetchpriority="low"';
}

function renderEmptyState() {
  const label = activeMediaType === MEDIA_TYPES.VIDEO ? t('mediaVideoLabel') : t('mediaImageLabel');
  const message = allMedia.length === 0 ? t('emptyStateIdle') : t('emptyStateNoMatch', label);

  el.imageList.innerHTML = `
    <div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

// ─── MEDIA_FOUND 增量更新 ──────────────────────────────

function handleMediaFound(media) {
  allMedia.push(media);
  renderMediaTabs();
  renderFormatTabs();

  if (lightboxOpen) {
    // 预览打开期间只更新数据，关闭时统一校准
    updateStats({ total: allMedia.length });
    return;
  }

  // 列表视图的分组/相似归并，以及任何视图下的清晰度排序（新条目可能插到中间），
  // 都无法靠「插到最前」得到正确顺序，直接全量重渲
  if (sortBy === 'sharpness' || (viewMode === 'list' && (groupByPage || mergeSimilar))) {
    renderMedia();
    return;
  }

  const passesFilter = getFilteredMedia().includes(media);
  const hasItems = el.imageList.querySelector('[data-id]');

  if (passesFilter && hasItems) {
    // 增量插入：新条目显示在最前，不重建既有 DOM（缩略图不闪、按钮状态不丢）
    const template = viewMode === 'card' ? cardTemplate(media, EAGER_PREVIEW_COUNT) : listItemTemplate(media, EAGER_PREVIEW_COUNT);
    el.imageList.insertAdjacentHTML('afterbegin', template);
    updateStats({ total: allMedia.length, matching: getFilteredMedia().length });
  } else if (passesFilter && !hasItems) {
    renderMedia(); // 空态 → 有数据
  } else {
    updateStats({ total: allMedia.length, matching: getFilteredMedia().length });
  }
}

// ─── 条目状态局部更新 ──────────────────────────────────

function findItemEl(id) {
  return el.imageList.querySelector(`[data-id="${CSS.escape(id)}"]`);
}

function setItemStatusUI(id, status, errorMsg = '') {
  const media = allMedia.find(m => m.id === id);
  if (!media) return;
  media.status = status;
  media.errorMsg = errorMsg || '';

  const item = findItemEl(id);
  if (!item) return;

  const badge = item.querySelector('.image-status');
  if (badge) {
    badge.className = `image-status ${status}`;
    badge.textContent = getStatusText(status);
  }
  const actionWrap = item.querySelector('.item-action');
  if (actionWrap) actionWrap.innerHTML = actionButtonHtml(media);
}

// ─── Lightbox 预览层 ───────────────────────────────────

function openLightbox(id) {
  lightboxItems = getFilteredMedia();
  lightboxIndex = lightboxItems.findIndex(media => media.id === id);
  if (lightboxIndex === -1) return;

  lightboxOpen = true;
  el.lightbox.hidden = false;
  document.body.classList.add('lightbox-open');
  renderLightbox();
}

function renderLightbox() {
  const media = lightboxItems[lightboxIndex];
  if (!media) {
    closeLightbox();
    return;
  }

  el.lightboxStage.innerHTML = media.mediaType === MEDIA_TYPES.VIDEO
    ? `<video src="${escapeHtml(getPreviewUrl(media))}" controls preload="metadata" playsinline></video>`
    : `<img src="${escapeHtml(getPreviewUrl(media))}" alt="${escapeHtml(media.alt || '')}" referrerpolicy="no-referrer">`;
  el.lightboxCaption.textContent = `${media.filename || media.url} · ${media.domain} · ${formatSize(media.size)} · ${lightboxIndex + 1}/${lightboxItems.length}`;
  el.lightboxPrev.disabled = lightboxIndex <= 0;
  el.lightboxNext.disabled = lightboxIndex >= lightboxItems.length - 1;
}

function closeLightbox() {
  lightboxOpen = false;
  lightboxItems = [];
  lightboxIndex = -1;
  el.lightbox.hidden = true;
  // 及时释放媒体引用
  el.lightboxStage.innerHTML = '';
  document.body.classList.remove('lightbox-open');
}

function lightboxNav(delta) {
  const next = lightboxIndex + delta;
  if (next < 0 || next >= lightboxItems.length) return;
  lightboxIndex = next;
  renderLightbox();
}

// ─── UI 更新 ───────────────────────────────────────────

function toggleSelection(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    selectedIds.add(id);
  }
  // 局部更新选中态，不重建整列表
  const item = findItemEl(id);
  if (item) item.classList.toggle('selected', selectedIds.has(id));
  updateSelectionButton(getFilteredMedia());
  updateStats({ selected: allMedia.filter(media => selectedIds.has(media.id)).length });
}

function updateViewButtons() {
  el.btnViewList.classList.toggle('active', viewMode === 'list');
  el.btnViewCard.classList.toggle('active', viewMode === 'card');
}

function updateSelectionButton(filtered) {
  const allCurrentSelected = filtered.length > 0 && filtered.every(media => selectedIds.has(media.id));
  el.btnSelectAll.textContent = allCurrentSelected ? t('btnDeselectAll') : t('btnSelectAll');
}

function updateStatusUI(enabled) {
  el.statusDot.classList.toggle('active', enabled);
  el.statusText.textContent = enabled ? t('statusListening') : t('statusStopped');
  // 滚动抓取依赖监听通路，未开启监听时不可用
  el.btnScroll.disabled = !enabled;
}

function updateSiteRow() {
  if (!currentDomain) {
    el.siteRow.hidden = true;
    return;
  }

  const blocked = siteRules?.[currentDomain] === 'block';
  el.siteRow.hidden = false;
  el.siteInfo.textContent = blocked
    ? `${t('siteCurrent', currentDomain)} · ${t('sitePaused')}`
    : `${t('siteCurrent', currentDomain)} · ${t('siteFollowGlobal')}`;
  el.btnSiteToggle.textContent = blocked ? t('siteResumeAction') : t('sitePauseAction');
}

/**
 * 评分引导（V16-05）：累计成功下载数首次达到阈值时展示一次
 * 弹窗是高频工具，每次打开都请求评分会直接损伤体验，因此只在写盘前出现一次
 */
function maybeShowRatingPrompt(stats = {}) {
  // 设置没读到就不弹：宁可漏弹一次，也不要重复打扰
  if (!settings || settings.ui?.ratingPromptShown) return;
  if ((stats.downloaded || 0) < RATING_PROMPT_THRESHOLD) return;

  el.ratingRow.hidden = false;
}

function dismissRatingPrompt() {
  el.ratingRow.hidden = true;
  // 关闭与点击「去评分」都写入同一标记，此后永不再现
  sendMessage(MESSAGE_TYPES.UPDATE_SETTINGS, {
    settings: { ui: { ratingPromptShown: true } },
  });
}

function openStorePage() {
  // 商店详情页只需扩展自身 id，避免硬编码占位 id
  // （开发态以「加载已解压」安装时 id 是随机值，打开会是 404，属预期）
  chrome.tabs.create({
    url: `https://chromewebstore.google.com/detail/${chrome.runtime.id}`,
  });
  dismissRatingPrompt();
}

function setScrollRunning(running) {
  scrollRunning = running;
  el.btnScroll.classList.toggle('active', running);
  el.btnScroll.title = running ? t('tooltipScrollStop') : t('tooltipScrollCapture');
}

function updateGroupButton() {
  // 相似归并与按页面分组互斥：置灰而不是静默把用户的选择改掉
  el.btnGroup.disabled = mergeSimilar;
  el.btnGroup.classList.toggle('active', groupByPage && !mergeSimilar);
  el.btnGroup.title = mergeSimilar
    ? t('tooltipGroupDisabledByMerge')
    : (groupByPage ? t('tooltipUngroupByPage') : t('tooltipGroupByPage'));
}

function updateSourceFilterUI() {
  el.sourceFilter.querySelectorAll('[data-source]').forEach(button => {
    button.classList.toggle('active', button.dataset.source === sourceFilter);
  });
}

function updateSortControlUI() {
  el.sortControl.querySelectorAll('[data-sort]').forEach(button => {
    button.classList.toggle('active', button.dataset.sort === sortBy);
  });
}

function updateStats(stats) {
  if (stats.total !== undefined) el.statTotal.textContent = stats.total;
  if (stats.downloaded !== undefined) el.statDownloaded.textContent = stats.downloaded;
  if (stats.failed !== undefined) el.statFailed.textContent = stats.failed;
  if (stats.matching !== undefined) el.statMatching.textContent = stats.matching;
  if (stats.selected !== undefined) el.statSelected.textContent = stats.selected;
}

function updateCapacityHint(statusInfo) {
  const count = statusInfo?.imageCount ?? allMedia.length;
  const truncated = statusInfo?.stats?.truncated || 0;

  if (count < CAPACITY_WARNING_THRESHOLD && truncated === 0) {
    el.capacityHint.hidden = true;
    el.capacityHint.textContent = '';
    return;
  }

  const parts = [];
  if (count >= CAPACITY_WARNING_THRESHOLD) {
    parts.push(t('capacityNearLimit', MAX_CAPTURED_IMAGES));
  }
  if (truncated > 0) {
    parts.push(t('capacityTruncated', truncated));
  }
  el.capacityHint.textContent = parts.join(t('listSemicolon'));
  el.capacityHint.hidden = false;
}

function getStatusText(status) {
  return {
    pending: t('statusPending'),
    downloading: t('statusDownloading'),
    downloaded: t('statusDownloaded'),
    failed: t('statusFailed'),
  }[status] || t('statusPending');
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || '';
    if (!value) return acc;
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// 用于 HTML 属性值（escapeHtml 不处理引号，URL 可能含单双引号）
function escapeAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── 启动 ──────────────────────────────────────────────

init();
