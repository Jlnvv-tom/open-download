// popup/popup.js — Popup 交互逻辑

import { MESSAGE_TYPES } from '../lib/constants.js';
import { formatSize } from '../lib/utils.js';

// ─── DOM 引用 ──────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const el = {
  toggle: $('#toggle-listening'),
  statusDot: $('#status-dot'),
  statusText: $('#status-text'),
  statTotal: $('#stat-total'),
  statDownloaded: $('#stat-downloaded'),
  statFailed: $('#stat-failed'),
  searchInput: $('#search-input'),
  btnFilter: $('#btn-filter'),
  btnClear: $('#btn-clear'),
  filterPanel: $('#filter-panel'),
  filterMinSize: $('#filter-min-size'),
  filterExtensions: $('#filter-extensions'),
  imageList: $('#image-list'),
  btnSelectAll: $('#btn-select-all'),
  btnExport: $('#btn-export'),
  btnDownloadSelected: $('#btn-download-selected'),
  btnDownloadAll: $('#btn-download-all'),
};

// ─── 状态 ──────────────────────────────────────────────

let allImages = [];
let selectedIds = new Set();
let isListening = false;
let isSelectAll = false;

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
  const status = await sendMessage(MESSAGE_TYPES.GET_STATUS);
  if (status.success) {
    isListening = status.enabled;
    el.toggle.checked = status.enabled;
    updateStatusUI(status.enabled);
    el.statTotal.textContent = status.stats.total;
    el.statDownloaded.textContent = status.stats.downloaded;
    el.statFailed.textContent = status.stats.failed;
  }

  await loadImages();
  bindEvents();
}

// ─── 事件绑定 ──────────────────────────────────────────

function bindEvents() {
  // 开关监听
  el.toggle.addEventListener('change', async () => {
    const enabled = el.toggle.checked;
    const res = await sendMessage(MESSAGE_TYPES.TOGGLE_LISTENING, { enabled });
    if (res.success) {
      isListening = res.enabled;
      updateStatusUI(res.enabled);
    }
  });

  // 搜索
  let searchTimer;
  el.searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderImages, 200);
  });

  // 筛选面板
  el.btnFilter.addEventListener('click', () => {
    const visible = el.filterPanel.style.display !== 'none';
    el.filterPanel.style.display = visible ? 'none' : 'flex';
  });

  el.filterMinSize.addEventListener('input', () => setTimeout(renderImages, 200));
  el.filterExtensions.addEventListener('input', () => setTimeout(renderImages, 200));

  // 清空
  el.btnClear.addEventListener('click', async () => {
    if (!confirm('确定清空所有已捕获的图片？')) return;
    await sendMessage(MESSAGE_TYPES.CLEAR_IMAGES);
    allImages = [];
    selectedIds.clear();
    renderImages();
    updateStats({ total: 0, downloaded: 0, failed: 0 });
  });

  // 全选
  el.btnSelectAll.addEventListener('click', () => {
    isSelectAll = !isSelectAll;
    if (isSelectAll) {
      getFilteredImages().forEach(img => selectedIds.add(img.id));
      el.btnSelectAll.textContent = '取消全选';
    } else {
      selectedIds.clear();
      el.btnSelectAll.textContent = '全选';
    }
    renderImages();
  });

  // 导出
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

  // 下载选中
  el.btnDownloadSelected.addEventListener('click', async () => {
    if (selectedIds.size === 0) {
      alert('请先选择要下载的图片');
      return;
    }
    el.btnDownloadSelected.disabled = true;
    el.btnDownloadSelected.textContent = '下载中...';
    const res = await sendMessage(MESSAGE_TYPES.DOWNLOAD_SELECTED, {
      ids: Array.from(selectedIds),
    });
    el.btnDownloadSelected.disabled = false;
    el.btnDownloadSelected.textContent = '下载选中';
    if (res.success) {
      alert(`下载完成: 成功 ${res.succeeded} 个, 失败 ${res.failed} 个`);
      await loadImages();
    }
  });

  // 全部下载
  el.btnDownloadAll.addEventListener('click', async () => {
    if (allImages.length === 0) {
      alert('没有可下载的图片');
      return;
    }
    el.btnDownloadAll.disabled = true;
    el.btnDownloadAll.textContent = '下载中...';
    const res = await sendMessage(MESSAGE_TYPES.DOWNLOAD_ALL, {
      filters: getFilters(),
    });
    el.btnDownloadAll.disabled = false;
    el.btnDownloadAll.textContent = '全部下载';
    if (res.success) {
      alert(`下载完成: 成功 ${res.succeeded} 个, 失败 ${res.failed} 个`);
      await loadImages();
    }
  });

  // 监听来自 background 的消息
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === MESSAGE_TYPES.IMAGE_FOUND) {
      allImages.push(message.payload);
      updateStats({ total: allImages.length });
      renderImages();
    }
  });
}

// ─── 图片加载与渲染 ────────────────────────────────────

async function loadImages() {
  el.imageList.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const res = await sendMessage(MESSAGE_TYPES.GET_IMAGES);
  if (res.success) {
    allImages = res.images;
    renderImages();
    updateStats({ total: res.total });
  }
}

function getFilters() {
  const search = el.searchInput.value.trim();
  const minSize = parseInt(el.filterMinSize.value, 10) || 0;
  const extRaw = el.filterExtensions.value.trim();
  const extensions = extRaw
    ? extRaw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
    : [];

  const filters = {};
  if (search) filters.search = search;
  if (minSize > 0) filters.minSize = minSize * 1024; // KB -> bytes
  if (extensions.length > 0) filters.extensions = extensions;
  return filters;
}

function getFilteredImages() {
  const filters = getFilters();
  return allImages.filter(img => {
    if (filters.search) {
      const haystack = `${img.url} ${img.filename} ${img.domain}`.toLowerCase();
      if (!haystack.includes(filters.search.toLowerCase())) return false;
    }
    if (filters.minSize > 0 && img.size < filters.minSize) return false;
    if (filters.extensions && filters.extensions.length > 0) {
      const ext = '.' + (img.filename.split('.').pop() || '').toLowerCase();
      if (!filters.extensions.includes(ext)) return false;
    }
    return true;
  });
}

function renderImages() {
  const filtered = getFilteredImages();

  if (filtered.length === 0) {
    el.imageList.innerHTML = `
      <div class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        <p>${allImages.length === 0 ? '开启监听后，浏览网页时捕获的图片将显示在这里' : '没有匹配筛选条件的图片'}</p>
      </div>
    `;
    return;
  }

  // 倒序显示（最新的在前）
  const html = [...filtered].reverse().map(img => {
    const isSelected = selectedIds.has(img.id);
    const statusClass = img.status || 'pending';
    const statusText = {
      pending: '待下载',
      downloading: '下载中',
      downloaded: '已下载',
      failed: '失败',
    }[statusClass] || '待下载';

    // 缩略图：使用图片 URL 或占位符
    const thumb = img.url.startsWith('data:')
      ? `<img class="image-thumb" src="${img.url.slice(0, 200)}" alt="" loading="lazy">`
      : `<img class="image-thumb" src="${escapeHtml(img.url)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
         <div class="image-thumb-placeholder" style="display:none;">
           <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
             <rect x="3" y="3" width="18" height="18" rx="2"/>
             <circle cx="8.5" cy="8.5" r="1.5"/>
             <polyline points="21 15 16 10 5 21"/>
           </svg>
         </div>`;

    return `
      <div class="image-item ${isSelected ? 'selected' : ''}" data-id="${img.id}">
        <div class="checkbox" data-action="select"></div>
        ${thumb}
        <div class="image-info">
          <div class="image-name" title="${escapeHtml(img.filename)}">${escapeHtml(img.filename)}</div>
          <div class="image-meta">
            <span>${escapeHtml(img.domain)}</span>
            <span>${formatSize(img.size)}</span>
            <span>${img.mimeType || ''}</span>
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

  // 绑定每个图片项的事件
  el.imageList.querySelectorAll('.image-item').forEach(item => {
    const id = item.dataset.id;

    // 点击选择
    item.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="remove"]')) return;
      if (selectedIds.has(id)) {
        selectedIds.delete(id);
        item.classList.remove('selected');
      } else {
        selectedIds.add(id);
        item.classList.add('selected');
      }
    });

    // 移除按钮
    const removeBtn = item.querySelector('[data-action="remove"]');
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await sendMessage(MESSAGE_TYPES.REMOVE_IMAGE, { id });
      selectedIds.delete(id);
      allImages = allImages.filter(img => img.id !== id);
      renderImages();
      updateStats({ total: allImages.length });
    });
  });
}

// ─── UI 更新 ───────────────────────────────────────────

function updateStatusUI(enabled) {
  el.statusDot.classList.toggle('active', enabled);
  el.statusText.textContent = enabled ? '监听中...' : '监听已关闭';
}

function updateStats(stats) {
  if (stats.total !== undefined) el.statTotal.textContent = stats.total;
  if (stats.downloaded !== undefined) el.statDownloaded.textContent = stats.downloaded;
  if (stats.failed !== undefined) el.statFailed.textContent = stats.failed;
}

// ─── 工具 ──────────────────────────────────────────────

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

// ─── 启动 ──────────────────────────────────────────────

init();
