// offscreen/offscreen.js — ZIP 打包专用 offscreen 文档
// 在完整 DOM 上下文中 fetch 媒体资源并打包，Popup 关闭不会中断任务。

import { MESSAGE_TYPES } from '../lib/constants.js';
import { createMediaZip } from '../lib/zip.js';
import { computePhash, computeSharpness } from '../lib/image-hash.js';
import { t } from '../lib/i18n.js';

// 通知 background 文档已就绪（createDocument 与监听器注册之间存在竞态）
chrome.runtime.sendMessage({
  type: MESSAGE_TYPES.ZIP_OFFSCREEN_READY,
}).catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 仅接受本扩展上下文的消息
  if (sender.id && sender.id !== chrome.runtime.id) return false;

  if (message?.type === MESSAGE_TYPES.ZIP_BUILD_REQUEST) {
    sendResponse({ received: true });

    buildZip(message.payload || {}).catch(error => {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.ZIP_BUILD_RESULT,
        payload: { error: error.message },
      }).catch(() => {});
    });

    return false;
  }

  if (message?.type === MESSAGE_TYPES.PHASH_REQUEST) {
    sendResponse({ received: true });

    computeMetrics(message.payload || {}).catch(error => {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.PHASH_RESULT,
        payload: { error: error.message },
      }).catch(() => {});
    });

    return false;
  }

  return false;
});

async function buildZip({ zipName, fileNaming, items, sendCookies = false, volume = 1, volumes = 1 }) {
  if (typeof zipName !== 'string' || !Array.isArray(items) || items.length === 0) {
    throw new Error(t('errorInvalidZipParams'));
  }

  const result = await createMediaZip(items, {
    fileNaming,
    sendCookies,
    onProgress: (done, total) => {
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.ZIP_BUILD_PROGRESS,
        payload: { done, total, zipName, volume, volumes },
      }).catch(() => {});
    },
  });

  chrome.runtime.sendMessage({
    type: MESSAGE_TYPES.ZIP_BUILD_RESULT,
    payload: {
      zipName,
      blobUrl: URL.createObjectURL(result.blob),
      succeeded: result.succeeded,
      failed: result.failed,
      succeededIds: result.entries.map(entry => entry.media.id),
      failedItems: result.errors.map(item => ({ id: item.media.id, error: item.error })),
    },
  }).catch(() => {});
}

// ─── 内容级图像指标（V16-03） ──────────────────────────

// 取像素前先缩到 64 边长的缩略图：dHash 只需要低频信息，
// 缩图能把 5000×5000 大图的开销压到常数级（先缩再算，而不是算完再缩）
const SAMPLE_SIDE = 64;

/**
 * 取一张图缩放后的 RGBA 像素
 * 与 zip.js 一致：sendCookies 关闭时不带 credentials（跨域图会因 CORS 失败，
 * 失败逐条记录，不影响其它条目）
 *
 * @param {string} url - 图片 URL
 * @param {boolean} sendCookies - 是否携带 Cookie
 * @returns {Promise<{data: Uint8ClampedArray, width: number, height: number}>}
 */
async function loadPixels(url, sendCookies) {
  const response = await fetch(url, sendCookies ? { credentials: 'include' } : {});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) {
    throw new Error(`Unsupported media: ${blob.type || 'unknown'}`);
  }

  const bitmap = await createImageBitmap(blob);
  if (!bitmap.width || !bitmap.height) throw new Error('Empty image');

  const scale = Math.min(SAMPLE_SIDE / bitmap.width, SAMPLE_SIDE / bitmap.height, 1);
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const { data } = context.getImageData(0, 0, width, height);
  return { data, width, height };
}

/**
 * 逐条计算指标并回传
 * 串行而不是并发：避免瞬时打满网络与内存，也让进度是单调的；
 * 单条失败只记录该条，不影响后续
 */
async function computeMetrics({ items, sendCookies = false }) {
  if (!Array.isArray(items) || items.length === 0) {
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.PHASH_RESULT,
      payload: { error: t('errorInvalidAnalysisParams') },
    }).catch(() => {});
    return;
  }

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const payload = { id: item.id, done: index + 1, total: items.length };

    try {
      const pixels = await loadPixels(item.url, sendCookies);
      payload.phash = computePhash(pixels.data, pixels.width, pixels.height);
      payload.sharpness = computeSharpness(pixels.data, pixels.width, pixels.height);
    } catch (error) {
      payload.error = error.message;
    }

    // 逐条回传：background 侧即时写回 store，进度也随每一条推进
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.PHASH_RESULT,
      payload,
    }).catch(() => {});
  }
}
