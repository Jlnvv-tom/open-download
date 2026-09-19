// popup/popup.js — Popup 交互逻辑

import {
  CAPACITY_WARNING_THRESHOLD,
  IMAGE_FORMAT_TABS,
  MAX_CAPTURED_IMAGES,
  MEDIA_TYPES,
  MESSAGE_TYPES,
  VIDEO_FORMAT_TABS
} from '../lib/constants.js';
import { formatSize, getNormalizedExtension } from '../lib/utils.js';

// ─── DOM 引用 ──────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

const el = {
  toggle: $('#toggle-listening'),
  statusDot: $('#status-dot'),
  statusText: $('#status-text'),
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
  btnClear: $('#btn-clear'),
  filterPanel: $('#filter-panel'),
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
  const settingsRes = await sendMessage(MESSAGE_TYPES.GET_SETTINGS);
  if (settingsRes.success) {
    settings = settingsRes.settings;
    activeMediaType = settings.ui?.mediaType || MEDIA_TYPES.IMAGE;
    viewMode = settings.ui?.viewMode || 'list';
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
  }

  await loadMedia();
  bindEvents();
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

  el.contentSizeRange.addEventListener('input', () => updateContentSize(el.contentSizeRange.value, false));
  el.contentSizeRange.addEventListener('change', () => saveUiSettings());
  el.contentSizeInput.addEventListener('input', () => updateContentSize(el.contentSizeInput.value, false));
  el.contentSizeInput.addEventListener('change', () => {
    updateContentSize(el.contentSizeInput.value, true);
    saveUiSettings();
  });

  el.btnClear.addEventListener('click', async () => {
    if (!confirm('确定清空所有已捕获的资源？')) return;
    await sendMessage(MESSAGE_TYPES.CLEAR_IMAGES);
    allMedia = [];
    selectedIds.clear();
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
      alert('当前筛选条件下没有可导出的资源');
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
      alert('请先选择要下载的资源');
      return;
    }
    await downloadMediaAsZip(selected, el.btnDownloadSelected, '下载选中');
  });

  el.btnDownloadAll.addEventListener('click', async () => {
    const filtered = getFilteredMedia();
    if (filtered.length === 0) {
      alert('当前筛选条件下没有可下载的资源');
      return;
    }
    await downloadMediaAsZip(filtered, el.btnDownloadAll, '全部下载');
  });

  // 列表容器事件委托：渲染替换 innerHTML 后监听依然有效
  el.imageList.addEventListener('click', (event) => {
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
        activeZipButton.textContent = `打包中 ${message.payload?.done || 0}/${message.payload?.total || 0}`;
      }
    }
    if (message.type === MESSAGE_TYPES.DOWNLOAD_STATUS_CHANGED) {
      const { id, status, error } = message.payload || {};
      if (id && status) setItemStatusUI(id, status, error || '');
      if (['downloaded', 'failed', 'pending'].includes(status)) {
        refreshStats();
      }
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

async function downloadMediaAsZip(mediaItems, button, defaultText) {
  button.disabled = true;
  activeZipButton = button;
  button.textContent = `打包中 0/${mediaItems.length}`;

  try {
    const result = await sendMessage(MESSAGE_TYPES.DOWNLOAD_ZIP, {
      ids: mediaItems.map(media => media.id),
    });

    if (result.success) {
      alert(`ZIP 已下载: 成功 ${result.succeeded} 个, 失败 ${result.failed} 个`);
      await loadMedia();
    } else {
      alert(`打包失败: ${result.error || '未知错误'}`);
    }
  } catch (error) {
    alert(`打包失败: ${error.message}`);
  } finally {
    activeZipButton = null;
    button.disabled = false;
    button.textContent = defaultText;
  }
}

// ─── 渲染 ──────────────────────────────────────────────

function renderMedia() {
  const filtered = getFilteredMedia();
  updateContentSize(contentSize, false);
  renderMediaTabs();
  renderFormatTabs();
  updateViewButtons();
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
  } else {
    renderListView(filtered);
  }
}

function renderMediaTabs() {
  const counts = countBy(allMedia, 'mediaType');
  el.mediaTabs.querySelectorAll('[data-media-type]').forEach(button => {
    const mediaType = button.dataset.mediaType;
    button.classList.toggle('active', mediaType === activeMediaType);
    button.querySelector('span').textContent = counts[mediaType] || 0;
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
    const label = format === 'all' ? '全部' : format;
    const count = format === 'all' ? total : (counts[format] || 0);
    return `<button class="tab ${format === activeFormat ? 'active' : ''}" data-format="${format}">${label}<span>${count}</span></button>`;
  }).join('');
}

function renderListView(mediaItems) {
  el.imageList.innerHTML = [...mediaItems].reverse()
    .map((media, index) => listItemTemplate(media, index))
    .join('');
}

function renderCardView(mediaItems) {
  el.imageList.innerHTML = [...mediaItems].reverse()
    .map((media, index) => cardTemplate(media, index))
    .join('');
}

// ─── 条目模板（全量渲染与增量插入共用） ────────────────

function listItemTemplate(media, index = 0) {
  const isSelected = selectedIds.has(media.id);
  const statusClass = media.status || 'pending';

  return `
    <div class="image-item ${isSelected ? 'selected' : ''}" data-id="${media.id}">
      <div class="checkbox" data-action="select"></div>
      ${renderThumb(media, index)}
      <div class="image-info">
        <div class="image-name" title="${escapeHtml(media.filename)}">${escapeHtml(media.filename || media.url)}</div>
        <div class="image-meta">
          <span>${escapeHtml(media.domain)}</span>
          <span>${formatSize(media.size)}</span>
          <span>${escapeHtml(media.mimeType || media.extension || '')}</span>
        </div>
      </div>
      <span class="image-status ${statusClass}">${getStatusText(statusClass)}</span>
      <span class="item-action">${actionButtonHtml(media)}</span>
      <button class="image-remove" data-action="remove" title="移除">
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
      <button class="image-cancel" data-action="cancel" title="取消下载">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="6" y="6" width="12" height="12" rx="1"/>
        </svg>
      </button>
    `;
  }
  if (status === 'failed') {
    const tip = media.errorMsg ? `失败: ${media.errorMsg}（点击重试）` : '重试下载';
    return `
      <button class="image-retry" data-action="download" title="${escapeHtml(tip)}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
      </button>
    `;
  }
  if (status === 'pending') {
    return `
      <button class="image-download" data-action="download" title="下载">
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
    return `
      <div class="media-card-preview" data-action="open">
        <video src="${escapeHtml(previewUrl)}" muted preload="${index < EAGER_PREVIEW_COUNT ? 'metadata' : 'none'}"></video>
        <div class="media-card-placeholder" style="display:none;">视频 ${escapeHtml(media.extension || '')}</div>
      </div>
    `;
  }

  return `
    <div class="media-card-preview" data-action="open">
      <img src="${escapeHtml(previewUrl)}" alt="" ${loading} decoding="async" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="media-card-placeholder" style="display:none;">图片 ${escapeHtml(media.extension || '')}</div>
    </div>
  `;
}

function renderCardInfo(media) {
  const dimensions = getDimensionsText(media);
  const size = formatSize(media.size);
  const type = (media.extension || media.mediaType || '').toUpperCase();

  return `
    <div class="media-card-info">
      <div class="media-card-name">${escapeHtml(media.filename || media.url || '未知资源')}</div>
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
  return '未知尺寸';
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
  const label = activeMediaType === MEDIA_TYPES.VIDEO ? '视频' : '图片';
  el.imageList.innerHTML = `
    <div class="empty-state">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
      </svg>
      <p>${allMedia.length === 0 ? '开启监听后，浏览网页时捕获的资源将显示在这里' : `没有匹配筛选条件的${label}`}</p>
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
  el.btnSelectAll.textContent = allCurrentSelected ? '取消当前' : '全选';
}

function updateStatusUI(enabled) {
  el.statusDot.classList.toggle('active', enabled);
  el.statusText.textContent = enabled ? '监听中...' : '监听已关闭';
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
    parts.push(`接近捕获上限（${MAX_CAPTURED_IMAGES}），最早的记录将被自动移除`);
  }
  if (truncated > 0) {
    parts.push(`已累计移除 ${truncated} 条`);
  }
  el.capacityHint.textContent = parts.join('；');
  el.capacityHint.hidden = false;
}

function getStatusText(status) {
  return {
    pending: '待下载',
    downloading: '下载中',
    downloaded: '已下载',
    failed: '失败',
  }[status] || '待下载';
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

// ─── 启动 ──────────────────────────────────────────────

init();
