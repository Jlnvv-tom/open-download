// background/index.js
// Service Worker — 核心监听 + 消息处理

import { MESSAGE_TYPES, IMAGE_MIME_TYPES, DEFAULT_SETTINGS } from '../lib/constants.js';
import { store, ImageStore } from '../lib/store.js';
import { DownloadManager } from '../lib/downloader.js';
import {
  extractFilename,
  extractDomain,
  getExtension,
  isImageUrl,
  generateId
} from '../lib/utils.js';

// ─── 初始化 ────────────────────────────────────────────

const downloader = new DownloadManager(store);

// 图片类型集合（用于快速查找）
const IMAGE_TYPE_SET = new Set(IMAGE_MIME_TYPES);

let isListening = false;

// ─── 网络请求监听 ──────────────────────────────────────

/**
 * 监听所有网络请求完成事件
 * 不区分网站，全局监听 <all_urls>
 */
function onRequestCompleted(details) {
  if (!isListening) return;

  // 仅处理主资源类型为 image 的请求
  if (details.type !== 'image') return;

  // 过滤浏览器内部协议
  if (details.url.startsWith('chrome://') || details.url.startsWith('chrome-extension://')) {
    return;
  }

  // 过滤 data URI 过小的
  if (details.url.startsWith('data:image/')) {
    // data URI 无法获取大小，简单放行
  }

  const filename = extractFilename(details.url);
  const domain = extractDomain(details.url);
  const settings = store.getSettings();

  // 域名过滤
  if (settings.filters.domains.length > 0) {
    if (settings.filters.domains.includes(domain)) return;
  }

  // 扩展名过滤
  if (settings.filters.extensions.length > 0) {
    const ext = getExtension(filename);
    if (!settings.filters.extensions.includes(ext)) return;
  }

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

  // 如果有 MIME 类型，进一步确认是图片
  if (mimeType && !IMAGE_TYPE_SET.has(mimeType.split(';')[0].trim().toLowerCase())) {
    // MIME 不是图片类型，但 resource type 是 image，仍然保留
    // 某些服务器返回错误的 content-type
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
    chrome.tabs.get(details.tabId).then(tab => {
      tabUrl = tab.url || '';
      tabTitle = tab.title || '';
    }).catch(() => {});
  }

  const image = store.addImage({
    url: details.url,
    filename,
    domain,
    mimeType: mimeType || 'image/unknown',
    size: contentLength,
    tabUrl,
    tabTitle,
  });

  if (image) {
    // 通知 popup 有新图片
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.IMAGE_FOUND,
      payload: image,
    }).catch(() => {
      // popup 可能未打开，忽略错误
    });

    // 自动下载
    if (settings.autoDownload) {
      downloader.downloadImage(image);
    }
  }
}

/**
 * 监听响应头接收 — 用于捕获更精确的图片信息
 */
function onHeadersReceived(details) {
  if (!isListening) return;
  if (details.type !== 'image') return;

  // 这里只做被动监听，不拦截
  // 实际图片信息在 onCompleted 中处理
}

// ─── 监听器注册 ────────────────────────────────────────

function startListening() {
  if (isListening) return;

  chrome.webRequest.onCompleted.addListener(
    onRequestCompleted,
    { urls: ['<all_urls>'] },
    ['responseHeaders']
  );

  isListening = true;
  console.log('[OpenDownload] 监听已启动');
}

function stopListening() {
  if (!isListening) return;

  chrome.webRequest.onCompleted.removeListener(onRequestCompleted);
  isListening = false;
  console.log('[OpenDownload] 监听已停止');
}

// ─── 消息处理 ──────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case MESSAGE_TYPES.TOGGLE_LISTENING: {
          await store.init();
          const settings = store.getSettings();
          if (message.payload?.enabled !== undefined) {
            await store.saveSettings({ enabled: message.payload.enabled });
            if (message.payload.enabled) {
              startListening();
            } else {
              stopListening();
            }
          } else {
            if (settings.enabled) {
              startListening();
            } else {
              stopListening();
            }
          }
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
          sendResponse({ success: true });
          break;
        }

        case MESSAGE_TYPES.DOWNLOAD_SELECTED: {
          await store.init();
          const ids = message.payload?.ids || [];
          const images = ids.map(id => store.getImageById(id)).filter(Boolean);
          const results = await downloader.downloadBatch(images);
          const succeeded = results.filter(r => r.success).length;
          const failed = results.filter(r => !r.success).length;
          sendResponse({ success: true, succeeded, failed });
          break;
        }

        case MESSAGE_TYPES.DOWNLOAD_ALL: {
          await store.init();
          const filters = message.payload?.filters || {};
          const images = store.getFilteredImages(filters);
          const results = await downloader.downloadBatch(images);
          const succeeded = results.filter(r => r.success).length;
          const failed = results.filter(r => !r.success).length;
          sendResponse({ success: true, succeeded, failed });
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
          if (newSettings.enabled) {
            startListening();
          } else {
            stopListening();
          }
          sendResponse({ success: true, settings: newSettings });
          break;
        }

        case MESSAGE_TYPES.GET_SETTINGS: {
          await store.init();
          sendResponse({ success: true, settings: store.getSettings() });
          break;
        }

        case MESSAGE_TYPES.EXPORT_IMAGES: {
          await store.init();
          const images = store.getImages();
          const json = JSON.stringify(images, null, 2);
          sendResponse({ success: true, data: json });
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
});

// ─── 扩展安装/更新 ────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await store.init();
  const settings = store.getSettings();

  // 创建右键菜单
  chrome.contextMenus.create({
    id: 'open-download-toggle',
    title: 'Open Download: 开启/关闭监听',
    contexts: ['action'],
  });

  chrome.contextMenus.create({
    id: 'open-download-clear',
    title: 'Open Download: 清空图片列表',
    contexts: ['action'],
  });

  // 如果之前是开启状态，恢复监听
  if (settings.enabled) {
    startListening();
  }

  console.log('[OpenDownload] 扩展已安装');
});

// ─── 右键菜单处理 ──────────────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await store.init();
  switch (info.menuItemId) {
    case 'open-download-toggle': {
      const settings = store.getSettings();
      const newEnabled = !settings.enabled;
      await store.saveSettings({ enabled: newEnabled });
      if (newEnabled) {
        startListening();
      } else {
        stopListening();
      }
      // 通知 popup 更新状态
      chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.TOGGLE_LISTENING,
        payload: { enabled: newEnabled },
      }).catch(() => {});
      break;
    }
    case 'open-download-clear': {
      store.clearAll();
      break;
    }
  }
});

// ─── Service Worker 启动时恢复状态 ─────────────────────

chrome.runtime.onStartup.addListener(async () => {
  await store.init();
  const settings = store.getSettings();
  if (settings.enabled) {
    startListening();
  }
  console.log('[OpenDownload] Service Worker 已启动');
});
