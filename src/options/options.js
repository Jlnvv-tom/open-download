// options/options.js — 设置页面逻辑

import { MESSAGE_TYPES, DEFAULT_SETTINGS } from '../lib/constants.js';

const $ = (sel) => document.querySelector(sel);

const fields = {
  autoDownload: $('#auto-download'),
  savePath: $('#save-path'),
  fileNaming: $('#file-naming'),
  concurrency: $('#concurrency'),
  minSize: $('#min-size'),
  maxSize: $('#max-size'),
  excludeDomains: $('#exclude-domains'),
  filterExtensions: $('#filter-extensions'),
  dedupe: $('#dedupe'),
};

function sendMessage(type, payload = {}) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, resolve);
  });
}

async function loadSettings() {
  const res = await sendMessage(MESSAGE_TYPES.GET_SETTINGS);
  if (!res.success) return;
  const s = res.settings;

  fields.autoDownload.checked = s.autoDownload;
  fields.savePath.value = s.savePath;
  fields.fileNaming.value = s.fileNaming;
  fields.concurrency.value = s.concurrency;
  fields.minSize.value = s.minImageSize ? (s.minImageSize / 1024).toFixed(0) : '';
  fields.maxSize.value = s.maxImageSize ? (s.maxImageSize / 1024).toFixed(0) : '';
  fields.excludeDomains.value = (s.filters.domains || []).join('\n');
  fields.filterExtensions.value = (s.filters.extensions || []).join(',');
  fields.dedupe.checked = s.dedupe;
}

function collectSettings() {
  const domains = fields.excludeDomains.value
    .split('\n')
    .map(d => d.trim())
    .filter(Boolean);

  const extensions = fields.filterExtensions.value
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  const minKB = parseInt(fields.minSize.value, 10) || 0;
  const maxKB = parseInt(fields.maxSize.value, 10) || 0;

  return {
    autoDownload: fields.autoDownload.checked,
    savePath: fields.savePath.value || 'OpenDownload',
    fileNaming: fields.fileNaming.value,
    concurrency: Math.max(1, Math.min(10, parseInt(fields.concurrency.value, 10) || 3)),
    minImageSize: minKB * 1024,
    maxImageSize: maxKB * 1024,
    dedupe: fields.dedupe.checked,
    filters: {
      domains,
      extensions,
    },
  };
}

function showToast(msg) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
}

$('#btn-save').addEventListener('click', async () => {
  const settings = collectSettings();
  const res = await sendMessage(MESSAGE_TYPES.UPDATE_SETTINGS, { settings });
  if (res.success) {
    showToast('设置已保存');
  } else {
    showToast('保存失败: ' + (res.error || ''));
  }
});

$('#btn-reset').addEventListener('click', async () => {
  if (!confirm('确定恢复默认设置？')) return;
  const res = await sendMessage(MESSAGE_TYPES.UPDATE_SETTINGS, {
    settings: DEFAULT_SETTINGS,
  });
  if (res.success) {
    await loadSettings();
    showToast('已恢复默认设置');
  }
});

loadSettings();
