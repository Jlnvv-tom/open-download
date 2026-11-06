// popup/popup.js — Popup 交互逻辑
//
// 交互结构：捕获状态 → 挑选 → 确认下载计划 → 结果追溯。
// 下载前把范围、产物、策略与上限说清楚；下载后用可复制、可重试的结果层替代一次性 alert。

import {
  CAPACITY_WARNING_THRESHOLD,
  IMAGE_FORMAT_TABS,
  MAX_BATCH_DOWNLOAD,
  MAX_CAPTURED_IMAGES,
  MEDIA_TYPES,
  MESSAGE_TYPES,
  VIDEO_FORMAT_TABS
} from '../lib/constants.js';
import { groupBySimilarity } from '../lib/image-hash.js';
import { extractDomain, formatDuration, formatSize, getNormalizedExtension } from '../lib/utils.js';
import { applyI18n, t } from '../lib/i18n.js';
import { applyTheme, getTheme, watchSystemTheme } from '../lib/theme.js';

// ─── DOM 引用 ──────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

const el = {
  toggle: $('#toggle-listening'),
  statusDot: $('#status-dot'),
  statusText: $('#status-text'),
  statusIndicator: $('#status-indicator'),
  siteRow: $('#site-row'),
  siteInfo: $('#site-info'),
  btnSiteToggle: $('#btn-site-toggle'),
  sitePause: $('.site-pause'),
  siteResume: $('.site-resume'),
  btnTheme: $('#btn-theme'),
  themeSun: $('.theme-icon-sun'),
  themeMoon: $('.theme-icon-moon'),
  ratingRow: $('#rating-row'),
  btnRatingOpen: $('#btn-rating-open'),
  btnRatingClose: $('#btn-rating-close'),
  btnSettings: $('#btn-settings'),
  selectionSummary: $('#selection-summary'),
  selectionSummaryText: $('#selection-summary-text'),
  capacityHint: $('#capacity-hint'),
  statTotal: $('#stat-total'),
  statDownloaded: $('#stat-downloaded'),
  statFailed: $('#stat-failed'),
  statMatching: $('#stat-matching'),
  statSelected: $('#stat-selected'),
  statsBadge: $('#stats-badge'),
  mediaTabs: $('#media-tabs'),
  formatTabs: $('#format-tabs'),
  searchInput: $('#search-input'),
  btnFilter: $('#btn-filter'),
  filterCount: $('#filter-count'),
  btnViewList: $('#btn-view-list'),
  btnViewCard: $('#btn-view-card'),
  btnGroup: $('#btn-group'),
  btnScroll: $('#btn-scroll'),
  btnClear: $('#btn-clear'),
  filterPanel: $('#filter-panel'),
  btnFilterReset: $('#btn-filter-reset'),
  btnFilterClose: $('#btn-filter-close'),
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
  btnDownload: $('#btn-download'),
  btnDownloadLabel: $('#btn-download-label'),
  btnDownloadCount: $('#btn-download-count'),
  guide: $('#guide'),
  btnGuideStart: $('#btn-guide-start'),
  btnGuideLater: $('#btn-guide-later'),
  lastResultRow: $('#last-result-row'),
  lastResultText: $('#last-result-text'),
  btnLastResultView: $('#btn-last-result-view'),
  btnLastResultDismiss: $('#btn-last-result-dismiss'),
  staleRow: $('#stale-row'),
  staleText: $('#stale-text'),
  btnStaleFix: $('#btn-stale-fix'),
  hiddenSelectionBar: $('#hidden-selection-bar'),
  hiddenSelectionText: $('#hidden-selection-text'),
  btnOnlyVisible: $('#btn-only-visible'),
  btnClearHidden: $('#btn-clear-hidden'),
  progressRow: $('#progress-row'),
  progressText: $('#progress-text'),
  btnCancelBatch: $('#btn-cancel-batch'),
  planOverlay: $('#plan-overlay'),
  btnPlanClose: $('#btn-plan-close'),
  planScope: $('#plan-scope'),
  planScopeSelected: $('#plan-scope-selected'),
  planScopeFiltered: $('#plan-scope-filtered'),
  planHiddenNote: $('#plan-hidden-note'),
  planHiddenActions: $('#plan-hidden-actions'),
  btnPlanOnlyVisible: $('#btn-plan-only-visible'),
  btnPlanClearHidden: $('#btn-plan-clear-hidden'),
  planItems: $('#plan-items'),
  planOutput: $('#plan-output'),
  planSavePath: $('#plan-save-path'),
  planStrategy: $('#plan-strategy'),
  planNotes: $('#plan-notes'),
  btnPlanCancel: $('#btn-plan-cancel'),
  btnPlanStart: $('#btn-plan-start'),
  resultOverlay: $('#result-overlay'),
  resultTitle: $('#result-title'),
  btnResultClose: $('#btn-result-close'),
  resultMetrics: $('#result-metrics'),
  resultDetails: $('#result-details'),
  resultFailureList: $('#result-failure-list'),
  btnResultFolder: $('#btn-result-folder'),
  btnResultCopy: $('#btn-result-copy'),
  btnResultRetry: $('#btn-result-retry'),
  btnResultDone: $('#btn-result-done'),
  lightbox: $('#lightbox'),
  lightboxStage: $('#lightbox-stage'),
  lightboxCaption: $('#lightbox-caption'),
  lightboxClose: $('#lightbox-close'),
  lightboxPrev: $('#lightbox-prev'),
  lightboxNext: $('#lightbox-next'),
};

// ─── 状态 ──────────────────────────────────────────────

const DEFAULT_VIEW_FILTERS = { search: '', minSize: '', extensions: '', minWidth: '', minHeight: '' };

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
let mergeSimilar = false;
let sortBy = 'capturedAt';
let metricsRunning = false;
let metricsDone = 0;
let metricsTotal = 0;
const collapsedGroups = new Set();
const expandedGroups = new Set();
const RATING_PROMPT_THRESHOLD = 20;
const DEFAULT_CONTENT_SIZE = 104;
const EAGER_PREVIEW_COUNT = 36;

let contentSize = DEFAULT_CONTENT_SIZE;
let downloadStrategy = 'auto';
let onboardingDone = false;
let viewFilters = { ...DEFAULT_VIEW_FILTERS };
let lastResult = null;

let plan = null;
let currentResult = null;
let downloadInFlight = false;
let activeZipTotal = 0;
let activeZipCompleted = 0;
let zipProgressSeen = false;

let lightboxOpen = false;
let lightboxItems = [];
let lightboxIndex = -1;

// 弹层焦点管理：打开时记住来源，关闭时还原，Tab 在层内循环
let activeOverlay = null;
let focusReturnTo = null;

// ─── 消息通信 ──────────────────────────────────────────

function sendMessage(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      resolve(response || { success: false });
    });
  });
}

function savePref(uiPartial) {
  return sendMessage(MESSAGE_TYPES.UPDATE_SETTINGS, { settings: { ui: uiPartial } });
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
  applyI18n(document);
  // 先用跟随系统的默认主题上色，读到用户偏好后再校准，避免首屏闪一下
  applyTheme();
  watchSystemTheme(updateThemeButton);

  const settingsRes = await sendMessage(MESSAGE_TYPES.GET_SETTINGS);
  if (settingsRes.success) {
    settings = settingsRes.settings;
    applyTheme(settings.ui?.theme || 'system');
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
    downloadStrategy = settings.ui?.downloadStrategy || 'auto';
    onboardingDone = Boolean(settings.ui?.onboardingDone);
    lastResult = settings.ui?.lastDownloadResult || null;

    viewFilters = { ...DEFAULT_VIEW_FILTERS, ...(settings.ui?.viewFilters || {}) };
    el.searchInput.value = viewFilters.search || '';
    el.filterMinSize.value = viewFilters.minSize || '';
    el.filterExtensions.value = viewFilters.extensions || '';
    const savedMinDimensions = settings.filters?.minDimensions || {};
    el.filterMinWidth.value = viewFilters.minWidth || (savedMinDimensions.width ? String(savedMinDimensions.width) : '');
    el.filterMinHeight.value = viewFilters.minHeight || (savedMinDimensions.height ? String(savedMinDimensions.height) : '');
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

  await sendMessage(MESSAGE_TYPES.MARK_CAPTURED_READ);
  await loadCurrentSite();
  await loadMedia();
  bindEvents();
  updateThemeButton();
  updateGuide();
  updateLastResultRow();
  updateStaleRow();
}

async function loadCurrentSite() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab?.url || '';
    currentDomain = /^https?:/i.test(url) ? extractDomain(url) : '';
  } catch {
    currentDomain = '';
  }
  updateSiteRow();
}

async function refreshActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) await chrome.tabs.reload(tab.id);
  } catch {
    // 特殊页面无法刷新时忽略
  }
}

// ─── 事件绑定 ──────────────────────────────────────────

function bindEvents() {
  el.toggle.addEventListener('change', async () => {
    const enabled = el.toggle.checked;
    const res = await sendMessage(MESSAGE_TYPES.TOGGLE_LISTENING, { enabled });
    if (res.success) {
      isListening = res.enabled;
      updateStatusUI(res.enabled);
      if (res.enabled) {
        onboardingDone = true;
        await savePref({ onboardingDone: true });
      }
    }
    updateGuide();
  });

  const renderAndSaveFiltersDebounced = debounce(() => {
    renderMedia();
    persistViewFilters();
  }, 200);
  const renderAndSaveDimensionsDebounced = debounce(() => {
    renderMedia();
    persistViewFilters();
    saveMinDimensions();
  }, 200);

  el.searchInput.addEventListener('input', renderAndSaveFiltersDebounced);
  el.filterMinSize.addEventListener('input', renderAndSaveFiltersDebounced);
  el.filterExtensions.addEventListener('input', renderAndSaveFiltersDebounced);
  el.filterMinWidth.addEventListener('input', renderAndSaveDimensionsDebounced);
  el.filterMinHeight.addEventListener('input', renderAndSaveDimensionsDebounced);

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

  el.btnFilter.addEventListener('click', () => toggleFilterPanel());
  el.btnFilterClose.addEventListener('click', closeFilterPanel);

  document.addEventListener('click', (event) => {
    if (!el.filterPanel.classList.contains('open')) return;
    if (el.filterPanel.contains(event.target) || el.btnFilter.contains(event.target)) return;
    closeFilterPanel();
  });

  el.btnFilterReset.addEventListener('click', resetAllFilters);

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
    if (sortBy === 'sharpness') requestContentMetrics();
  });

  el.mergeSimilar.addEventListener('change', async () => {
    mergeSimilar = el.mergeSimilar.checked;
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
      showInlineNotice(res.error || t('errorScrollUnsupported'));
      return;
    }
    if (type === MESSAGE_TYPES.SCROLL_CAPTURE_START) setScrollRunning(true);
  });

  el.btnRatingOpen.addEventListener('click', openStorePage);
  el.btnRatingClose.addEventListener('click', dismissRatingPrompt);

  el.btnSiteToggle.addEventListener('click', async () => {
    if (!currentDomain) return;
    const next = { ...siteRules };
    if (next[currentDomain] === 'block') delete next[currentDomain];
    else next[currentDomain] = 'block';
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
    if (allCurrentSelected) filtered.forEach(media => selectedIds.delete(media.id));
    else filtered.forEach(media => selectedIds.add(media.id));
    renderMedia();
  });

  el.btnExport.addEventListener('click', () => {
    const filtered = getFilteredMedia();
    if (filtered.length === 0) {
      showInlineNotice(t('alertNoExport'));
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

  el.btnSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());

  el.btnTheme.addEventListener('click', async () => {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    updateThemeButton();
    await savePref({ theme: next });
  });

  el.btnDownload.addEventListener('click', () => openPlanDialog());

  el.btnGuideStart.addEventListener('click', async () => {
    const res = await sendMessage(MESSAGE_TYPES.TOGGLE_LISTENING, { enabled: true });
    if (!res.success) return;
    isListening = true;
    el.toggle.checked = true;
    updateStatusUI(true);
    onboardingDone = true;
    await savePref({ onboardingDone: true });
    updateGuide();
    showInlineNotice(t('guideAfterRefresh'));
    await refreshActiveTab();
  });

  el.btnGuideLater.addEventListener('click', async () => {
    onboardingDone = true;
    await savePref({ onboardingDone: true });
    updateGuide();
  });

  el.btnLastResultView.addEventListener('click', () => {
    if (lastResult) openResultDialog(lastResult);
  });
  el.btnLastResultDismiss.addEventListener('click', async () => {
    lastResult = null;
    await savePref({ lastDownloadResult: null });
    updateLastResultRow();
  });
  el.btnStaleFix.addEventListener('click', resetStaleStatuses);

  el.btnOnlyVisible.addEventListener('click', () => openPlanDialog('filtered'));
  el.btnClearHidden.addEventListener('click', clearHiddenSelection);
  el.btnCancelBatch.addEventListener('click', async () => {
    await sendMessage(MESSAGE_TYPES.CANCEL_DOWNLOAD);
    await loadMedia();
  });

  // 计划层
  el.planScope.addEventListener('change', (event) => {
    if (!plan || event.target.name !== 'plan-scope') return;
    plan.scope = event.target.value;
    renderPlan();
  });
  el.planStrategy.addEventListener('change', async (event) => {
    if (!plan || event.target.name !== 'plan-strategy') return;
    plan.strategy = event.target.value;
    downloadStrategy = plan.strategy;
    await savePref({ downloadStrategy });
    renderPlan();
  });
  el.btnPlanOnlyVisible.addEventListener('click', () => {
    if (!plan) return;
    plan.scope = 'filtered';
    renderPlan();
  });
  el.btnPlanClearHidden.addEventListener('click', () => {
    clearHiddenSelection();
    if (!plan) return;
    plan = { ...plan, ...getCandidates() };
    renderPlan();
  });
  el.btnPlanCancel.addEventListener('click', closePlanDialog);
  el.btnPlanClose.addEventListener('click', closePlanDialog);
  el.btnPlanStart.addEventListener('click', () => {
    if (!plan) return;
    const items = plan.scope === 'selected' ? plan.selected : plan.filtered;
    const strategy = plan.strategy;
    closePlanDialog();
    startDownload(items.map(media => media.id), strategy);
  });

  // 结果层
  el.btnResultClose.addEventListener('click', closeResultDialog);
  el.btnResultDone.addEventListener('click', closeResultDialog);
  el.btnResultFolder.addEventListener('click', () => {
    try { chrome.downloads.showDefaultFolder(); } catch { /* 平台不支持时静默 */ }
  });
  el.btnResultCopy.addEventListener('click', async () => {
    const ok = await copyText(buildResultReport(currentResult));
    if (ok) {
      el.btnResultCopy.textContent = t('resultCopied');
      setTimeout(() => { el.btnResultCopy.textContent = t('resultCopy'); }, 1600);
    }
  });
  el.btnResultRetry.addEventListener('click', () => {
    const ids = (currentResult?.failedItems || []).map(item => item.id).filter(Boolean);
    if (ids.length === 0) return;
    closeResultDialog();
    startDownload(ids, downloadStrategy);
  });

  // 列表容器事件委托：渲染替换 innerHTML 后监听依然有效
  el.imageList.addEventListener('click', (event) => {
    const similarHeader = event.target.closest('[data-similar]');
    if (similarHeader) { toggleSimilarGroup(similarHeader); return; }
    const groupHeader = event.target.closest('[data-group]');
    if (groupHeader) { toggleGroupCollapse(groupHeader); return; }

    const actionEl = event.target.closest('[data-action]');
    const item = event.target.closest('[data-id]');
    if (!actionEl) {
      if (item) toggleSelection(item.dataset.id);
      return;
    }
    const id = item?.dataset.id;
    switch (actionEl.dataset.action) {
      case 'select': if (id) toggleSelection(id); break;
      case 'open': if (id) openLightbox(id); break;
      case 'download': if (id) downloadOne(id, actionEl); break;
      case 'cancel': if (id) cancelOne(id); break;
      case 'remove': if (id) removeMedia(id); break;
      case 'refresh': refreshActiveTab(); break;
      case 'reset-filters': resetAllFilters(); break;
    }
  });

  // 键盘可选中：条目与分组头都支持 Enter / Space
  el.imageList.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('button')) return;
    const header = event.target.closest('[data-similar], [data-group]');
    if (header) {
      event.preventDefault();
      if (header.dataset.similar !== undefined) toggleSimilarGroup(header);
      else toggleGroupCollapse(header);
      return;
    }
    const preview = event.target.closest('[data-action="open"]');
    if (preview) {
      const previewItem = preview.closest('[data-id]');
      if (previewItem) {
        event.preventDefault();
        openLightbox(previewItem.dataset.id);
      }
      return;
    }
    const item = event.target.closest('[data-id]');
    if (item) {
      event.preventDefault();
      toggleSelection(item.dataset.id);
    }
  });

  el.lightboxClose.addEventListener('click', closeLightbox);
  el.lightboxPrev.addEventListener('click', () => lightboxNav(-1));
  el.lightboxNext.addEventListener('click', () => lightboxNav(1));
  el.lightbox.addEventListener('click', (event) => {
    if (event.target === el.lightbox) closeLightbox();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && activeOverlay) {
      trapFocus(event, activeOverlay);
      return;
    }
    if (event.key === 'Escape') {
      if (activeOverlay) {
        event.preventDefault();
        closeActiveOverlay();
        return;
      }
      closeFilterPanel();
      return;
    }
    if (activeOverlay === el.lightbox) {
      if (event.key === 'ArrowLeft') lightboxNav(-1);
      else if (event.key === 'ArrowRight') lightboxNav(1);
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === MESSAGE_TYPES.MEDIA_FOUND) {
      handleMediaFound(normalizeMedia(message.payload));
    }
    if (message.type === MESSAGE_TYPES.MEDIA_DETAILS_UPDATED) {
      allMedia = (message.payload?.images || allMedia).map(normalizeMedia);
      if (!lightboxOpen) renderMedia();
    }
    if (message.type === MESSAGE_TYPES.ZIP_PROGRESS) {
      if (!downloadInFlight) return;
      const { done = 0, total = 0, volume, volumes } = message.payload || {};
      zipProgressSeen = true;
      const volumePrefix = volumes > 1 ? `${t('progressVolume', volume, volumes)} ` : '';
      const text = `${volumePrefix}${t('progressPacking', done, total)}`;
      el.progressText.textContent = text;
      setButtonText(el.btnDownload, text);
      el.btnCancelBatch.hidden = true;
    }
    if (message.type === MESSAGE_TYPES.DOWNLOAD_STATUS_CHANGED) {
      const { id, status, error } = message.payload || {};
      if (id && status) setItemStatusUI(id, status, error || '');
      if (['downloaded', 'failed', 'pending'].includes(status)) refreshStats();
      if (downloadInFlight && !zipProgressSeen && ['downloading', 'downloaded', 'failed'].includes(status)) {
        el.btnCancelBatch.hidden = false;
      }
      if (downloadInFlight && !zipProgressSeen && ['downloaded', 'failed'].includes(status)) {
        activeZipCompleted = Math.min(activeZipCompleted + 1, activeZipTotal);
        const text = t('progressProcessing', activeZipCompleted, activeZipTotal);
        el.progressText.textContent = text;
        setButtonText(el.btnDownload, text);
      }
    }
    if (message.type === MESSAGE_TYPES.SITE_RULES_CHANGED) {
      siteRules = message.payload?.siteRules || {};
      updateSiteRow();
    }
    if (message.type === MESSAGE_TYPES.SCROLL_CAPTURE_STATE) {
      setScrollRunning(Boolean(message.payload?.running));
    }
    if (message.type === MESSAGE_TYPES.PHASH_STATE) {
      const { running, done = 0, total = 0 } = message.payload || {};
      metricsRunning = Boolean(running);
      metricsDone = done;
      metricsTotal = total;
      updateMetricsHint();
    }
  });
}

// ─── 弹层与焦点 ────────────────────────────────────────

function focusableIn(root) {
  return [...root.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
    .filter(node => !node.disabled && node.getClientRects().length > 0);
}

function trapFocus(event, container) {
  const nodes = focusableIn(container);
  if (nodes.length === 0) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openOverlay(overlay, focusTarget) {
  if (!activeOverlay) focusReturnTo = document.activeElement;
  if (activeOverlay && activeOverlay !== overlay) activeOverlay.hidden = true;
  activeOverlay = overlay;
  overlay.hidden = false;
  (focusTarget || focusableIn(overlay)[0])?.focus();
}

function closeOverlay(overlay) {
  overlay.hidden = true;
  if (activeOverlay === overlay) activeOverlay = null;
  const target = focusReturnTo;
  focusReturnTo = null;
  if (target && target.getClientRects().length > 0) target.focus();
}

function closeActiveOverlay() {
  if (activeOverlay === el.planOverlay) closePlanDialog();
  else if (activeOverlay === el.resultOverlay) closeResultDialog();
  else if (activeOverlay === el.lightbox) closeLightbox();
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

function persistViewFilters() {
  viewFilters = {
    search: el.searchInput.value,
    minSize: el.filterMinSize.value,
    extensions: el.filterExtensions.value,
    minWidth: el.filterMinWidth.value,
    minHeight: el.filterMinHeight.value,
  };
  return savePref({ viewFilters });
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
    if (sourceFilter !== 'all' && (media.source || 'network') !== sourceFilter) return false;
    if (activeFormat !== 'all' && media.extension !== activeFormat) return false;
    if (manualExtensions.length > 0 && !manualExtensions.includes(media.extension)) return false;
    if (minSize > 0 && media.size < minSize * 1024) return false;
    if (minWidth > 0 && media.width > 0 && media.width < minWidth) return false;
    if (minHeight > 0 && media.height > 0 && media.height < minHeight) return false;
    if (search) {
      const haystack = `${media.url} ${media.filename} ${media.domain} ${media.extension}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

function getCandidates() {
  return {
    filtered: getFilteredMedia(),
    selected: allMedia.filter(media => selectedIds.has(media.id)),
  };
}

function getHiddenSelectedCount(candidates) {
  const { filtered, selected } = candidates || getCandidates();
  const visible = new Set(filtered.map(media => media.id));
  return selected.filter(media => !visible.has(media.id)).length;
}

async function resetAllFilters() {
  el.searchInput.value = '';
  el.filterMinSize.value = '';
  el.filterExtensions.value = '';
  el.filterMinWidth.value = '';
  el.filterMinHeight.value = '';
  el.mergeSimilar.checked = false;
  activeFormat = 'all';
  sourceFilter = 'all';
  sortBy = 'capturedAt';
  mergeSimilar = false;
  viewFilters = { ...DEFAULT_VIEW_FILTERS };
  await savePref({ viewFilters });
  await saveMinDimensions();
  await saveUiSettings();
  renderMedia();
}

function countActiveFilters() {
  let count = 0;
  if (el.searchInput.value.trim()) count += 1;
  if ((parseInt(el.filterMinSize.value, 10) || 0) > 0) count += 1;
  if ((parseInt(el.filterMinWidth.value, 10) || 0) > 0) count += 1;
  if ((parseInt(el.filterMinHeight.value, 10) || 0) > 0) count += 1;
  if (getManualExtensions().length > 0) count += 1;
  if (sourceFilter !== 'all') count += 1;
  if (sortBy !== 'capturedAt') count += 1;
  if (mergeSimilar) count += 1;
  if (activeFormat !== 'all') count += 1;
  return count;
}

// ─── 引导与状态提示 ────────────────────────────────────

function updateGuide() {
  el.guide.hidden = isListening || allMedia.length > 0 || onboardingDone;
}

function updateThemeButton() {
  const dark = getTheme() === 'dark';
  // SVG 元素没有 HTMLElement.hidden，必须用属性切换才能命中 [hidden] 样式
  el.themeSun.toggleAttribute('hidden', !dark);
  el.themeMoon.toggleAttribute('hidden', dark);
  const tip = dark ? t('themeToLight') : t('themeToDark');
  el.btnTheme.title = tip;
  el.btnTheme.setAttribute('aria-label', tip);
}

function updateLastResultRow() {
  if (!lastResult || downloadInFlight) {
    el.lastResultRow.hidden = true;
    return;
  }
  el.lastResultText.textContent = t('lastResult', lastResult.succeeded || 0, lastResult.failed || 0);
  el.lastResultRow.hidden = false;
}

function updateStaleRow() {
  const stuck = allMedia.filter(media => media.status === 'downloading');
  el.staleRow.hidden = stuck.length === 0 || downloadInFlight;
  el.staleText.textContent = t('staleStatus', stuck.length);
}

async function resetStaleStatuses() {
  const ids = allMedia.filter(media => media.status === 'downloading').map(media => media.id);
  if (ids.length === 0) return;
  await sendMessage(MESSAGE_TYPES.UPDATE_MEDIA_STATUSES, { ids, status: 'pending' });
  ids.forEach(id => {
    const media = allMedia.find(item => item.id === id);
    if (media) media.status = 'pending';
  });
  renderMedia();
  updateStaleRow();
}

function showInlineNotice(message) {
  el.progressRow.hidden = false;
  el.progressText.textContent = message;
  el.btnCancelBatch.hidden = true;
  setTimeout(() => {
    if (!downloadInFlight) el.progressRow.hidden = true;
  }, 4000);
}

// ─── 单条下载 / 取消 ───────────────────────────────────

async function downloadOne(id, button) {
  if (button) button.disabled = true;
  setItemStatusUI(id, 'downloading', '');
  const res = await sendMessage(MESSAGE_TYPES.DOWNLOAD_ONE, { id });
  if (res.success === false && res.error === 'media not found') setItemStatusUI(id, 'pending');
}

async function cancelOne(id) {
  const res = await sendMessage(MESSAGE_TYPES.CANCEL_DOWNLOAD, { id });
  if (res.success && res.cancelled === false) await loadMedia();
}

async function removeMedia(id) {
  await sendMessage(MESSAGE_TYPES.REMOVE_IMAGE, { id });
  selectedIds.delete(id);
  allMedia = allMedia.filter(media => media.id !== id);
  renderMedia();
}

// ─── 下载计划 ──────────────────────────────────────────

function setButtonText(button, text) {
  (button.querySelector('.btn-label') || button).textContent = text;
}

function openPlanDialog(forceScope) {
  if (downloadInFlight) return;
  const candidates = getCandidates();
  if (candidates.selected.length === 0 && candidates.filtered.length === 0) return;
  plan = {
    ...candidates,
    scope: forceScope || (candidates.selected.length > 0 ? 'selected' : 'filtered'),
    strategy: downloadStrategy,
  };
  renderPlan();
  openOverlay(el.planOverlay, el.btnPlanStart);
}

function closePlanDialog() {
  plan = null;
  closeOverlay(el.planOverlay);
}

/**
 * 按 background 的 planTransfer / splitVolumes 规则做同口径估算，
 * 用于下载前展示产物。只是预估，实际以后台返回的结果为准。
 */
function estimatePlan(items, strategy) {
  const transfer = settings?.transfer || {};
  const bypassFileSize = transfer.bypassFileSize ?? 50 * 1024 * 1024;
  const bypassBatchSize = transfer.bypassBatchSize ?? 500 * 1024 * 1024;
  const maxZipFiles = transfer.maxZipFiles ?? 200;
  const maxZipBytes = transfer.maxZipBytes ?? 500 * 1024 * 1024;
  const videoDirect = transfer.videoDirect !== false;

  const cappedFrom = items.length;
  const limited = items.slice(0, MAX_BATCH_DOWNLOAD);
  const totalBytes = limited.reduce((sum, media) => sum + (Number(media.size) || 0), 0);
  const base = { capped: cappedFrom > MAX_BATCH_DOWNLOAD, cappedFrom, totalBytes, count: limited.length };

  if (strategy === 'direct') {
    return { ...base, zipVolumes: 0, directFiles: limited.length };
  }
  if (strategy === 'zip') {
    return { ...base, zipVolumes: limited.length > 0 ? 1 : 0, directFiles: 0 };
  }

  const videos = limited.filter(media => media.mediaType === MEDIA_TYPES.VIDEO);
  const zipCandidates = videoDirect
    ? limited.filter(media => media.mediaType !== MEDIA_TYPES.VIDEO)
    : limited;
  const directFiles = videoDirect ? videos.length : 0;
  const oversized = zipCandidates.some(media => (Number(media.size) || 0) > bypassFileSize);

  if (totalBytes > bypassBatchSize || oversized) {
    return { ...base, zipVolumes: 0, directFiles: limited.length };
  }

  let volumes = 0;
  let fileCount = 0;
  let volumeBytes = 0;
  zipCandidates.forEach(media => {
    const size = Number(media.size) || 0;
    if (fileCount > 0 && (fileCount + 1 > maxZipFiles || volumeBytes + size > maxZipBytes)) {
      volumes += 1;
      fileCount = 0;
      volumeBytes = 0;
    }
    fileCount += 1;
    volumeBytes += size;
  });
  if (fileCount > 0) volumes += 1;

  return { ...base, zipVolumes: volumes, directFiles };
}

function planOutputText(estimate) {
  if (estimate.zipVolumes > 0 && estimate.directFiles > 0) {
    return t('planOutputDescription', estimate.zipVolumes, estimate.directFiles);
  }
  if (estimate.zipVolumes > 0) return t('planOutputZipOnly', estimate.zipVolumes);
  return t('planOutputDirectOnly', estimate.directFiles);
}

function renderPlan() {
  if (!plan) return;

  el.planScopeSelected.textContent = t('planScopeSelected', plan.selected.length);
  el.planScopeFiltered.textContent = t('planScopeFiltered', plan.filtered.length);
  el.planScope.querySelectorAll('input[name="plan-scope"]').forEach(input => {
    input.checked = input.value === plan.scope;
    input.disabled = input.value === 'selected' ? plan.selected.length === 0 : plan.filtered.length === 0;
  });
  el.planStrategy.querySelectorAll('input[name="plan-strategy"]').forEach(input => {
    input.checked = input.value === plan.strategy;
  });

  const hiddenCount = getHiddenSelectedCount(plan);
  el.planHiddenNote.hidden = plan.scope !== 'selected' || hiddenCount === 0;
  el.planHiddenNote.textContent = t('planHiddenSelected', hiddenCount);
  el.planHiddenActions.hidden = hiddenCount === 0;
  el.btnPlanOnlyVisible.textContent = t('planOnlyVisible');
  el.btnPlanClearHidden.textContent = t('planClearHidden');

  const items = plan.scope === 'selected' ? plan.selected : plan.filtered;
  const estimate = estimatePlan(items, plan.strategy);
  el.planItems.textContent = t('planItems', estimate.count, estimate.totalBytes > 0 ? formatSize(estimate.totalBytes) : t('sizeUnknown'));
  el.planOutput.textContent = planOutputText(estimate);
  el.planSavePath.textContent = t('planSavePath', settings?.savePath || 'OpenDownload');

  const notes = [];
  if (estimate.capped) notes.push(t('planCapped', MAX_BATCH_DOWNLOAD));
  if (estimate.zipVolumes > 1) notes.push(t('planRiskVolume'));
  if (!settings?.sendCookies) notes.push(t('planRiskCookies'));
  notes.push(t('planCancelNoZip'));
  el.planNotes.innerHTML = notes.map(note => `<p>${escapeHtml(note)}</p>`).join('');
  el.btnPlanStart.disabled = items.length === 0;
}

// ─── 批量下载与结果 ────────────────────────────────────

async function startDownload(ids, strategy) {
  if (ids.length === 0 || downloadInFlight) return;
  downloadInFlight = true;
  zipProgressSeen = false;
  activeZipTotal = ids.length;
  activeZipCompleted = 0;
  el.btnDownload.disabled = true;
  el.progressRow.hidden = false;
  el.progressText.textContent = t('progressTitle');
  el.btnCancelBatch.hidden = true;
  el.lastResultRow.hidden = true;
  setButtonText(el.btnDownload, t('progressProcessing', 0, ids.length));

  try {
    const payload = { ids };
    if (strategy !== 'auto') payload.strategy = strategy;
    const res = await sendMessage(MESSAGE_TYPES.DOWNLOAD_ZIP, payload);
    await finishDownload(res);
  } catch (error) {
    await finishDownload({ success: false, error: error?.message || t('unknownError') });
  } finally {
    downloadInFlight = false;
    el.progressRow.hidden = true;
    el.btnCancelBatch.hidden = true;
    el.btnDownload.disabled = false;
    updateLastResultRow();
    updateStaleRow();
    updateDownloadButton();
  }
}

function normalizeResult(res) {
  if (!res || !res.success) {
    return {
      ok: false,
      error: res?.error || t('unknownError'),
      succeeded: 0,
      failed: 0,
      strategy: '',
      volumes: [],
      failedItems: [],
      capped: false,
      cappedFrom: 0,
      directSucceeded: 0,
      at: Date.now(),
    };
  }
  return {
    ok: true,
    succeeded: res.succeeded || 0,
    failed: res.failed || 0,
    strategy: res.strategy || '',
    volumes: res.volumes || [],
    failedItems: (res.failedItems || []).map(item => ({ id: item.id || '', error: item.error || '' })),
    capped: Boolean(res.capped),
    cappedFrom: res.cappedFrom || 0,
    directSucceeded: res.directSucceeded || 0,
    at: Date.now(),
  };
}

async function finishDownload(res) {
  const result = normalizeResult(res);
  lastResult = result;
  await savePref({ lastDownloadResult: result });
  await loadMedia();
  openResultDialog(result);
}

function openResultDialog(result) {
  currentResult = result;
  renderResult(result);
  openOverlay(el.resultOverlay, el.btnResultDone);
}

function closeResultDialog() {
  closeOverlay(el.resultOverlay);
}

function resultDetailLines(result) {
  const lines = [];
  if (!result.ok) lines.push(t('downloadFailed', result.error));
  if (result.strategy === 'direct') lines.push(t('resultDirect'));
  if (result.strategy === 'mixed' && result.directSucceeded > 0) {
    lines.push(t('resultVideoDirect', result.directSucceeded));
  }
  if ((result.volumes || []).length > 1) lines.push(t('resultVolumes', result.volumes.length));
  if (result.capped) lines.push(t('resultCapped', result.cappedFrom, MAX_BATCH_DOWNLOAD));
  lines.push(t('planSavePath', settings?.savePath || 'OpenDownload'));
  return lines;
}

function renderResult(result) {
  if (!result) return;
  el.resultTitle.textContent = result.ok ? t('resultTitleDone') : t('resultTitleFailed');
  el.resultMetrics.innerHTML = [
    `<span class="result-metric ok">${escapeHtml(t('resultSucceeded', result.succeeded || 0))}</span>`,
    `<span class="result-metric bad">${escapeHtml(t('resultFailed', result.failed || 0))}</span>`,
  ].join('');
  el.resultDetails.innerHTML = resultDetailLines(result)
    .map(line => `<p>${escapeHtml(line)}</p>`)
    .join('');

  const failures = result.failedItems || [];
  el.resultFailureList.innerHTML = failures.length === 0
    ? `<li class="result-empty">${escapeHtml(t('resultNoFailures'))}</li>`
    : failures.map(item => `<li><strong>${escapeHtml(item.id)}</strong><span>${escapeHtml(item.error || t('unknownError'))}</span></li>`).join('');

  const retryIds = failures.map(item => item.id).filter(Boolean);
  el.btnResultRetry.disabled = retryIds.length === 0;
  el.btnResultRetry.title = retryIds.length === 0 ? t('errorNoItemsToRetry') : '';
  el.btnResultCopy.textContent = t('resultCopy');
}

function buildResultReport(result) {
  if (!result) return '';
  const header = result.ok
    ? t('downloadDone', [t('summarySucceeded', result.succeeded), t('summaryFailed', result.failed)].join(t('listComma')))
    : t('downloadFailed', result.error || t('unknownError'));
  const lines = [header, ...resultDetailLines(result), t('resultFailureList')];
  (result.failedItems || []).forEach(item => lines.push(`${item.id}: ${item.error || ''}`));
  if ((result.failedItems || []).length === 0) lines.push(t('resultNoFailures'));
  return lines.join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { /* 剪贴板不可用时忽略 */ }
    area.remove();
    return copied;
  }
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
  updateSelectionSummary();
  updateDownloadButton();
  updateFilterCount();
  updateHiddenSelectionBar();
  updateGuide();

  // 空态必须脱离卡片网格，否则会被当成 104px 的 grid item 挤成竖排
  const isEmpty = filtered.length === 0;
  el.imageList.classList.toggle('card-mode', viewMode === 'card' && !isEmpty);
  el.imageList.classList.toggle('is-empty', isEmpty);

  if (isEmpty) {
    renderEmptyState();
    return;
  }

  if (viewMode === 'card') renderCardView(filtered);
  else if (mergeSimilar) renderSimilarListView(filtered);
  else if (groupByPage) renderGroupedListView(filtered);
  else renderListView(filtered);
}

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
    const active = button.dataset.mediaType === activeMediaType;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    button.querySelector('.tab-count').textContent = counts[button.dataset.mediaType] || 0;
  });
}

function renderFormatTabs() {
  const formats = activeMediaType === MEDIA_TYPES.VIDEO ? VIDEO_FORMAT_TABS : IMAGE_FORMAT_TABS;
  const currentMedia = allMedia.filter(media => media.mediaType === activeMediaType);
  const counts = countBy(currentMedia, 'extension');
  const total = currentMedia.length;
  // 只显示实际存在的格式，避免一整排 0 计数的 chip 占据顶部
  const tabs = ['all', ...formats.filter(format => (counts[format] || 0) > 0)];

  if (activeFormat !== 'all' && !tabs.includes(activeFormat)) activeFormat = 'all';

  el.formatTabs.innerHTML = tabs.map(format => {
    const label = format === 'all' ? t('tabAll') : format;
    const count = format === 'all' ? total : (counts[format] || 0);
    const active = format === activeFormat;
    return `<button class="tab ${active ? 'active' : ''}" data-format="${format}" aria-pressed="${active}">${escapeHtml(label)}<span class="tab-count">${count}</span></button>`;
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
    const title = groupTitleOf(items);
    return `
      <div class="list-group">
        <div class="list-group-header" data-group="${escapeAttr(key)}" role="button" tabindex="0" aria-expanded="${!collapsed}" aria-label="${escapeAttr(t('ariaToggleGroup', title))}">
          <span class="group-arrow" aria-hidden="true">${collapsed ? '▸' : '▾'}</span>
          <span class="group-title">${escapeHtml(title)}</span>
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
  if (collapsed) collapsedGroups.add(key);
  else collapsedGroups.delete(key);

  const body = groupHeader.nextElementSibling;
  if (body) body.hidden = collapsed;
  const arrow = groupHeader.querySelector('.group-arrow');
  if (arrow) arrow.textContent = collapsed ? '▸' : '▾';
  groupHeader.setAttribute('aria-expanded', String(!collapsed));
}

function renderSimilarListView(mediaItems) {
  const groups = groupBySimilarity(sortForDisplay(mediaItems));

  el.imageList.innerHTML = groups.map(group => {
    if (group.items.length === 1) return listItemTemplate(group.items[0], 0);

    const expanded = expandedGroups.has(group.key);
    const visible = expanded ? group.items : group.items.slice(0, 1);
    const label = t('groupSimilarCount', group.items.length);

    return `
      <div class="list-group">
        <div class="list-group-header similar-header" data-similar="${escapeAttr(group.key)}" role="button" tabindex="0" aria-expanded="${expanded}" aria-label="${escapeAttr(t('ariaToggleGroup', label))}" title="${escapeAttr(t(expanded ? 'tooltipCollapseSimilar' : 'tooltipExpandSimilar'))}">
          <span class="group-arrow" aria-hidden="true">${expanded ? '▾' : '▸'}</span>
          <span class="group-title">${escapeHtml(label)}</span>
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
  if (expandedGroups.has(key)) expandedGroups.delete(key);
  else expandedGroups.add(key);
  renderMedia();
}

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
    showInlineNotice(res.error || t('errorNothingToAnalyze'));
    return;
  }
  await loadMedia();
  if (res.failed > 0) showInlineNotice(t('mergeSimilarSummary', res.analyzed, res.failed));
}

function updateMetricsHint() {
  el.mergeSimilarHint.textContent = metricsRunning
    ? t('mergeSimilarProgress', metricsDone, metricsTotal)
    : t('filterMergeSimilarHint');
}

// ─── 条目模板 ──────────────────────────────────────────

function listItemTemplate(media, index = 0) {
  const isSelected = selectedIds.has(media.id);
  const statusClass = media.status || 'pending';
  const duration = media.mediaType === MEDIA_TYPES.VIDEO ? formatDuration(media.duration) : '';
  const name = media.filename || media.url || t('mediaUnknownName');

  return `
    <div class="image-item ${isSelected ? 'selected' : ''}" data-id="${media.id}" role="checkbox" aria-checked="${isSelected}" tabindex="0" aria-label="${escapeAttr(t('ariaSelectItem', name))}">
      <div class="checkbox" data-action="select" aria-hidden="true"></div>
      ${renderThumb(media, index)}
      <div class="image-info">
        <div class="image-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
        <div class="image-meta">
          <span>${escapeHtml(media.domain)}</span>
          <span>${formatSize(media.size)}</span>
          ${duration ? `<span>${duration}</span>` : ''}
          <span>${escapeHtml(media.mimeType || media.extension || '')}</span>
        </div>
      </div>
      <span class="image-status ${statusClass}">${getStatusText(statusClass)}</span>
      <span class="item-action">${actionButtonHtml(media)}</span>
      <button class="image-remove" data-action="remove" title="${escapeAttr(t('tooltipRemove'))}" aria-label="${escapeAttr(t('tooltipRemove'))}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  `;
}

function cardTemplate(media, index = 0) {
  const isSelected = selectedIds.has(media.id);
  const titleParts = [media.filename || media.url || t('mediaUnknownName')];
  if (media.width > 0 && media.height > 0) titleParts.push(`${media.width}x${media.height}`);

  return `
    <div class="media-card ${isSelected ? 'selected' : ''}" data-id="${media.id}" role="checkbox" aria-checked="${isSelected}" tabindex="0" aria-label="${escapeAttr(t('ariaSelectItem', titleParts[0]))}" title="${escapeAttr(titleParts.join(' · '))}">
      <div class="media-card-check" aria-hidden="true">✓</div>
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
      <button class="image-cancel" data-action="cancel" title="${escapeAttr(t('tooltipCancelDownload'))}" aria-label="${escapeAttr(t('tooltipCancelDownload'))}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
      </button>`;
  }
  if (status === 'failed') {
    const tip = media.errorMsg ? t('tooltipRetryWithReason', media.errorMsg) : t('tooltipRetryDownload');
    return `
      <button class="image-retry" data-action="download" title="${escapeAttr(tip)}" aria-label="${escapeAttr(tip)}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      </button>`;
  }
  if (status === 'pending') {
    return `
      <button class="image-download" data-action="download" title="${escapeAttr(t('tooltipDownload'))}" aria-label="${escapeAttr(t('tooltipDownload'))}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      </button>`;
  }
  return '';
}

function renderThumb(media, index = 0) {
  if (media.mediaType === MEDIA_TYPES.VIDEO) {
    return `
      <div class="image-thumb-placeholder" data-action="open" role="button" tabindex="0" aria-label="${escapeAttr(t('ariaMediaPreview'))}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
      </div>`;
  }

  const previewUrl = getPreviewUrl(media);
  const loading = getPreviewLoadingAttrs(index);

  return `
    <img class="image-thumb" data-action="open" src="${escapeHtml(previewUrl)}" alt="" ${loading} decoding="async" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
    <div class="image-thumb-placeholder" data-action="open" style="display:none;">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    </div>`;
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
      </div>`;
  }

  return `
    <div class="media-card-preview" data-action="open">
      <img src="${escapeHtml(previewUrl)}" alt="" ${loading} decoding="async" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="media-card-placeholder" style="display:none;">${escapeHtml(`${t('mediaImageLabel')} ${media.extension || ''}`)}</div>
    </div>`;
}

function renderCardInfo(media) {
  const type = (media.extension || media.mediaType || '').toUpperCase();
  return `
    <div class="media-card-info">
      <div class="media-card-name">${escapeHtml(media.filename || media.url || t('mediaUnknownName'))}</div>
      <div class="media-card-meta">
        <span class="format-badge">${escapeHtml(type)}</span>
        <span class="media-card-size">${escapeHtml(formatSize(media.size))}</span>
      </div>
    </div>`;
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
  const noRecords = allMedia.length === 0;
  const message = noRecords
    ? (isListening ? t('emptyHintRefresh') : t('emptyStateIdle'))
    : t('emptyStateNoMatch', label);
  const hint = noRecords && isListening ? t('emptyHintRefresh') : (noRecords ? '' : t('emptyHintNoMatch'));
  const action = noRecords && isListening
    ? `<button class="empty-action" data-action="refresh">${escapeHtml(t('emptyActionRefresh'))}</button>`
    : (!noRecords ? `<button class="empty-action" data-action="reset-filters">${escapeHtml(t('emptyActionReset'))}</button>` : '');

  el.imageList.innerHTML = `
    <div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
      </svg>
      <p>${escapeHtml(message)}</p>
      ${hint && hint !== message ? `<small>${escapeHtml(hint)}</small>` : ''}
      ${action}
    </div>`;
}

// ─── 增量更新与局部状态 ────────────────────────────────

function handleMediaFound(media) {
  allMedia.push(media);
  renderMediaTabs();
  renderFormatTabs();

  if (lightboxOpen) {
    updateStats({ total: allMedia.length });
    return;
  }

  if (sortBy === 'sharpness' || (viewMode === 'list' && (groupByPage || mergeSimilar))) {
    renderMedia();
    return;
  }

  const passesFilter = getFilteredMedia().includes(media);
  const hasItems = el.imageList.querySelector('[data-id]');

  if (passesFilter && hasItems) {
    const template = viewMode === 'card'
      ? cardTemplate(media, EAGER_PREVIEW_COUNT)
      : listItemTemplate(media, EAGER_PREVIEW_COUNT);
    el.imageList.insertAdjacentHTML('afterbegin', template);
    updateStats({ total: allMedia.length, matching: getFilteredMedia().length });
    updateDownloadButton();
  } else if (passesFilter && !hasItems) {
    renderMedia();
  } else {
    updateStats({ total: allMedia.length, matching: getFilteredMedia().length });
    updateDownloadButton();
    updateHiddenSelectionBar();
  }
}

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

// ─── Lightbox ──────────────────────────────────────────

function openLightbox(id) {
  lightboxItems = getFilteredMedia();
  lightboxIndex = lightboxItems.findIndex(media => media.id === id);
  if (lightboxIndex === -1) return;

  lightboxOpen = true;
  document.body.classList.add('lightbox-open');
  renderLightbox();
  openOverlay(el.lightbox, el.lightboxClose);
}

function renderLightbox() {
  const media = lightboxItems[lightboxIndex];
  if (!media) { closeLightbox(); return; }

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
  el.lightboxStage.innerHTML = '';
  document.body.classList.remove('lightbox-open');
  if (el.lightbox.hidden) return;

  el.lightbox.hidden = true;
  if (activeOverlay === el.lightbox) activeOverlay = null;
  const returnId = focusReturnTo?.dataset?.id;
  const returnTarget = focusReturnTo;
  focusReturnTo = null;

  // 预览期间跳过重渲，关闭时统一校准；重渲后按 id 把键盘焦点还给原条目
  renderMedia();
  const node = (returnId ? findItemEl(returnId) : returnTarget) || returnTarget;
  if (node && node.getClientRects().length > 0) node.focus();
}

function lightboxNav(delta) {
  const next = lightboxIndex + delta;
  if (next < 0 || next >= lightboxItems.length) return;
  lightboxIndex = next;
  renderLightbox();
}

// ─── UI 更新 ───────────────────────────────────────────

function toggleSelection(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);

  const item = findItemEl(id);
  if (item) {
    item.classList.toggle('selected', selectedIds.has(id));
    item.setAttribute('aria-checked', String(selectedIds.has(id)));
  }
  updateSelectionButton(getFilteredMedia());
  updateStats({ selected: allMedia.filter(media => selectedIds.has(media.id)).length });
  updateSelectionSummary();
  updateDownloadButton();
  updateHiddenSelectionBar();
}

function clearHiddenSelection() {
  const visible = new Set(getFilteredMedia().map(media => media.id));
  [...selectedIds].forEach(id => { if (!visible.has(id)) selectedIds.delete(id); });
  renderMedia();
}

function updateViewButtons() {
  el.btnViewList.classList.toggle('active', viewMode === 'list');
  el.btnViewCard.classList.toggle('active', viewMode === 'card');
  el.btnViewList.setAttribute('aria-pressed', String(viewMode === 'list'));
  el.btnViewCard.setAttribute('aria-pressed', String(viewMode === 'card'));
}

function updateSelectionButton(filtered) {
  const allCurrentSelected = filtered.length > 0 && filtered.every(media => selectedIds.has(media.id));
  el.btnSelectAll.textContent = allCurrentSelected ? t('btnDeselectAll') : t('btnSelectAll');
}

function updateSelectionSummary() {
  const selected = allMedia.filter(media => selectedIds.has(media.id));
  if (selected.length === 0) {
    el.selectionSummary.hidden = true;
    return;
  }
  const totalSize = selected.reduce((sum, media) => sum + (Number(media.size) || 0), 0);
  el.selectionSummary.hidden = false;
  el.selectionSummaryText.textContent = t('footerSelectedSummary', selected.length, formatSize(totalSize));
}

function updateDownloadButton() {
  if (downloadInFlight) return;
  const { filtered, selected } = getCandidates();
  const count = selected.length > 0 ? selected.length : filtered.length;
  el.btnDownloadLabel.textContent = count > 0 ? t('btnDownloadN', count) : t('btnDownloadIdle');
  el.btnDownloadCount.textContent = count > 0 ? `(${count})` : '';
  el.btnDownload.disabled = count === 0;
}

function updateFilterCount() {
  const count = countActiveFilters();
  el.filterCount.hidden = count === 0;
  el.filterCount.textContent = String(count);
  el.filterCount.setAttribute('aria-label', t('filterActiveCount', count));
}

function updateHiddenSelectionBar() {
  const hiddenCount = getHiddenSelectedCount();
  el.hiddenSelectionBar.hidden = hiddenCount === 0;
  el.hiddenSelectionText.textContent = t('planHiddenSelected', hiddenCount);
  el.btnOnlyVisible.textContent = t('planOnlyVisible');
  el.btnClearHidden.textContent = t('planClearHidden');
}

function updateStatusUI(enabled) {
  el.statusDot.classList.toggle('active', enabled);
  el.statusText.textContent = enabled ? t('statusListening') : t('statusStopped');
  el.btnScroll.disabled = !enabled;
  // 说明性文案收进 tip，不再常驻占一行
  const hint = enabled ? t('statusListeningHint') : t('statusStoppedHint');
  el.statusIndicator.title = hint;
  el.toggle.title = hint;
  el.toggle.setAttribute('aria-label', hint);
}

function updateSiteRow() {
  if (!currentDomain) {
    el.siteRow.hidden = true;
    return;
  }
  const blocked = siteRules?.[currentDomain] === 'block';
  el.siteRow.hidden = false;
  el.siteInfo.textContent = currentDomain;
  const statusText = blocked ? t('sitePaused') : t('siteFollowGlobal');
  const actionText = blocked ? t('siteResumeAction') : t('sitePauseAction');
  el.siteRow.title = `${t('siteCurrent', currentDomain)} · ${statusText}`;
  el.btnSiteToggle.title = actionText;
  el.btnSiteToggle.setAttribute('aria-label', actionText);
  el.sitePause.toggleAttribute('hidden', blocked);
  el.siteResume.toggleAttribute('hidden', !blocked);
}

function maybeShowRatingPrompt(stats = {}) {
  if (!settings || settings.ui?.ratingPromptShown) return;
  if ((stats.downloaded || 0) < RATING_PROMPT_THRESHOLD) return;
  el.ratingRow.hidden = false;
}

function dismissRatingPrompt() {
  el.ratingRow.hidden = true;
  sendMessage(MESSAGE_TYPES.UPDATE_SETTINGS, {
    settings: { ui: { ratingPromptShown: true } },
  });
}

function openStorePage() {
  chrome.tabs.create({ url: `https://chromewebstore.google.com/detail/${chrome.runtime.id}` });
  dismissRatingPrompt();
}

function setScrollRunning(running) {
  scrollRunning = running;
  el.btnScroll.classList.toggle('active', running);
  el.btnScroll.title = running ? t('tooltipScrollStop') : t('tooltipScrollCapture');
}

function updateGroupButton() {
  el.btnGroup.disabled = mergeSimilar;
  el.btnGroup.classList.toggle('active', groupByPage && !mergeSimilar);
  el.btnGroup.title = mergeSimilar
    ? t('tooltipGroupDisabledByMerge')
    : (groupByPage ? t('tooltipUngroupByPage') : t('tooltipGroupByPage'));
}

function updateSourceFilterUI() {
  el.sourceFilter.querySelectorAll('[data-source]').forEach(button => {
    const active = button.dataset.source === sourceFilter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function updateSortControlUI() {
  el.sortControl.querySelectorAll('[data-sort]').forEach(button => {
    const active = button.dataset.sort === sortBy;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function toggleFilterPanel(force) {
  const open = force === undefined
    ? !el.filterPanel.classList.contains('open')
    : Boolean(force);
  el.filterPanel.classList.toggle('open', open);
  el.btnFilter.classList.toggle('active', open);
  el.btnFilter.setAttribute('aria-expanded', String(open));
}

function closeFilterPanel() {
  toggleFilterPanel(false);
}

function updateStats(stats) {
  if (stats.total !== undefined) el.statTotal.textContent = stats.total;
  if (stats.downloaded !== undefined) el.statDownloaded.textContent = stats.downloaded;
  if (stats.failed !== undefined) el.statFailed.textContent = stats.failed;
  if (stats.matching !== undefined) {
    el.statMatching.textContent = stats.matching;
    el.statsBadge.textContent = stats.matching;
  }
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
  if (count >= CAPACITY_WARNING_THRESHOLD) parts.push(t('capacityNearLimit', MAX_CAPTURED_IMAGES));
  if (truncated > 0) parts.push(t('capacityTruncated', truncated));
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
