// popup/popup.js — Popup 交互逻辑

import {
  IMAGE_FORMAT_TABS,
  MEDIA_TYPES,
  MESSAGE_TYPES,
  VIDEO_FORMAT_TABS
} from '../lib/constants.js';
import { formatSize, getNormalizedExtension } from '../lib/utils.js';
import { createMediaZip, makeZipFilename } from '../lib/zip.js';

// ─── DOM 引用 ──────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

const el = {
  toggle: $('#toggle-listening'),
  statusDot: $('#status-dot'),
  statusText: $('#status-text'),
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
  contentSizeRange: $('#content-size-range'),
  contentSizeInput: $('#content-size-input'),
  filterExtensions: $('#filter-extensions'),
  imageList: $('#image-list'),
  btnSelectAll: $('#btn-select-all'),
  btnExport: $('#btn-export'),
  btnDownloadSelected: $('#btn-download-selected'),
  btnDownloadAll: $('#btn-download-all'),
};

// ─── 状态 ──────────────────────────────────────────────

let allMedia = [];
let selectedIds = new Set();
let isListening = false;
let activeMediaType = MEDIA_TYPES.IMAGE;
let activeFormat = 'all';
let viewMode = 'list';
let settings = null;
let contentSize = 132;
const EAGER_PREVIEW_COUNT = 36;

// ─── 消息通信 ──────────────────────────────────────────

function sendMessage(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      resolve(response || { success: false });
    });
  });
}

// ─── 初始化 ────────────────────────────────────────────

async function init() {
  const settingsRes = await sendMessage(MESSAGE_TYPES.GET_SETTINGS);
  if (settingsRes.success) {
    settings = settingsRes.settings;
    activeMediaType = settings.ui?.mediaType || MEDIA_TYPES.IMAGE;
    viewMode = settings.ui?.viewMode || 'list';
    contentSize = normalizeContentSize(settings.ui?.contentSize || 132);
  }

  const status = await sendMessage(MESSAGE_TYPES.GET_STATUS);
  if (status.success) {
    isListening = status.enabled;
    el.toggle.checked = status.enabled;
    updateStatusUI(status.enabled);
    updateStats(status.stats);
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

  let searchTimer;
  el.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderMedia, 200);
  });

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

  el.filterMinSize.addEventListener('input', () => setTimeout(renderMedia, 200));
  el.filterExtensions.addEventListener('input', () => setTimeout(renderMedia, 200));
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

  el.btnExport.addEventListener('click', async () => {
    const res = await sendMessage(MESSAGE_TYPES.EXPORT_IMAGES);
    if (res.success) {
      const blob = new Blob([res.data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `open-download-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
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

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === MESSAGE_TYPES.MEDIA_FOUND || message.type === MESSAGE_TYPES.IMAGE_FOUND) {
      allMedia.push(normalizeMedia(message.payload));
      renderMedia();
    }
    if (message.type === MESSAGE_TYPES.MEDIA_DETAILS_UPDATED) {
      allMedia = (message.payload?.images || allMedia).map(normalizeMedia);
      renderMedia();
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

function normalizeContentSize(value) {
  const parsed = parseInt(value, 10) || 132;
  return Math.max(88, Math.min(220, parsed));
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
  const manualExtensions = getManualExtensions();

  return allMedia.filter(media => {
    if (media.mediaType !== activeMediaType) return false;
    if (activeFormat !== 'all' && media.extension !== activeFormat) return false;
    if (manualExtensions.length > 0 && !manualExtensions.includes(media.extension)) return false;
    if (minSize > 0 && media.size < minSize * 1024) return false;
    if (search) {
      const haystack = `${media.url} ${media.filename} ${media.domain} ${media.extension}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

// ─── ZIP 下载 ──────────────────────────────────────────

async function downloadMediaAsZip(mediaItems, button, defaultText) {
  button.disabled = true;
  button.textContent = '打包中...';

  try {
    const currentSettings = settings || (await sendMessage(MESSAGE_TYPES.GET_SETTINGS)).settings || {};
    const result = await createMediaZip(mediaItems, {
      fileNaming: currentSettings.fileNaming || 'original',
    });

    const zipUrl = URL.createObjectURL(result.blob);
    const zipName = makeZipFilename();
    const savePath = currentSettings.savePath || 'OpenDownload';
    await chrome.downloads.download({
      url: zipUrl,
      filename: `${savePath}/${zipName}`,
      saveAs: false,
      conflictAction: 'uniquify',
    });
    setTimeout(() => URL.revokeObjectURL(zipUrl), 60000);

    const succeededIds = result.entries.map(entry => entry.media.id);
    if (succeededIds.length > 0) {
      await sendMessage(MESSAGE_TYPES.UPDATE_MEDIA_STATUSES, {
        ids: succeededIds,
        status: 'downloaded',
      });
    }
    if (result.errors.length > 0) {
      await sendMessage(MESSAGE_TYPES.UPDATE_MEDIA_STATUSES, {
        ids: result.errors.map(item => item.media.id),
        status: 'failed',
      });
    }

    alert(`ZIP 已生成: 成功 ${result.succeeded} 个, 失败 ${result.failed} 个`);
    await loadMedia();
  } catch (error) {
    alert(`打包失败: ${error.message}`);
  } finally {
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
  const html = [...mediaItems].reverse().map((media, index) => {
    const isSelected = selectedIds.has(media.id);
    const statusClass = media.status || 'pending';
    const statusText = getStatusText(statusClass);

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
        <span class="image-status ${statusClass}">${statusText}</span>
        <button class="image-remove" data-action="remove" title="移除">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `;
  }).join('');

  el.imageList.innerHTML = html;
  bindMediaItemEvents('.image-item');
}

function renderCardView(mediaItems) {
  const html = [...mediaItems].reverse().map((media, index) => {
    const isSelected = selectedIds.has(media.id);
    const badge = media.width > 0 && media.height > 0
      ? `${media.width}x${media.height}`
      : `${media.extension || media.mediaType} ${formatSize(media.size)}`;

    return `
      <div class="media-card ${isSelected ? 'selected' : ''}" data-id="${media.id}" title="${escapeHtml(media.filename || media.url)}">
        <div class="media-card-check">✓</div>
        ${renderCardPreview(media, index)}
        <div class="media-card-badge">${escapeHtml(badge)}</div>
      </div>
    `;
  }).join('');

  el.imageList.innerHTML = html;
  bindMediaItemEvents('.media-card');
}

function renderThumb(media, index = 0) {
  if (media.mediaType === MEDIA_TYPES.VIDEO) {
    return `
      <div class="image-thumb-placeholder">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z"/>
        </svg>
      </div>
    `;
  }

  const previewUrl = getPreviewUrl(media);
  const loading = getPreviewLoadingAttrs(index);

  return `
    <img class="image-thumb" src="${escapeHtml(previewUrl)}" alt="" ${loading} decoding="async" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
    <div class="image-thumb-placeholder" style="display:none;">
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
      <div class="media-card-preview">
        <video src="${escapeHtml(previewUrl)}" muted preload="${index < EAGER_PREVIEW_COUNT ? 'metadata' : 'none'}"></video>
        <div class="media-card-placeholder" style="display:none;">视频 ${escapeHtml(media.extension || '')}</div>
      </div>
    `;
  }

  return `
    <div class="media-card-preview">
      <img src="${escapeHtml(previewUrl)}" alt="" ${loading} decoding="async" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <div class="media-card-placeholder" style="display:none;">图片 ${escapeHtml(media.extension || '')}</div>
    </div>
  `;
}

function getPreviewUrl(media) {
  return media.previewUrl || media.url || '';
}

function getPreviewLoadingAttrs(index) {
  return index < EAGER_PREVIEW_COUNT
    ? 'loading="eager" fetchpriority="high"'
    : 'loading="lazy" fetchpriority="low"';
}

function bindMediaItemEvents(selector) {
  el.imageList.querySelectorAll(selector).forEach(item => {
    const id = item.dataset.id;

    item.addEventListener('click', (event) => {
      if (event.target.closest('[data-action="remove"]')) return;
      toggleSelection(id);
    });

    const removeBtn = item.querySelector('[data-action="remove"]');
    if (removeBtn) {
      removeBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        await sendMessage(MESSAGE_TYPES.REMOVE_IMAGE, { id });
        selectedIds.delete(id);
        allMedia = allMedia.filter(media => media.id !== id);
        renderMedia();
      });
    }
  });
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

// ─── UI 更新 ───────────────────────────────────────────

function toggleSelection(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    selectedIds.add(id);
  }
  renderMedia();
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
