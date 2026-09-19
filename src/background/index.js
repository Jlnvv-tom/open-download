// background/index.js
// Service Worker — 核心监听 + 消息处理

import { MESSAGE_TYPES } from '../lib/constants.js';
import { store } from '../lib/store.js';
import { DownloadManager, waitForDownload } from '../lib/downloader.js';
import { makeZipFilename } from '../lib/zip.js';
import {
  detectMediaType,
  extensionFromMimeType,
  extractFilename,
  extractDomain,
  getNormalizedExtension,
} from '../lib/utils.js';

// ─── 初始化 ────────────────────────────────────────────

const downloader = new DownloadManager(store);

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

/**
 * 在 offscreen document 中打包并触发 ZIP 下载
 * @param {Object} payload - { ids: string[] }
 * @returns {Promise<{succeeded: number, failed: number}>}
 */
async function handleDownloadZip(payload) {
  await store.init();
  if (zipBuild) {
    throw new Error('已有打包任务进行中，请稍后再试');
  }

  const ids = payload?.ids || [];
  const items = ids.map(id => store.getImageById(id)).filter(Boolean);
  if (items.length === 0) {
    throw new Error('没有可下载的资源');
  }

  const settings = store.getSettings();
  await ensureOffscreenDocument();
  await waitForOffscreenReady();

  const zipName = makeZipFilename();
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (zipBuild) {
        zipBuild = null;
        reject(new Error('ZIP 打包超时'));
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
  if (downloadError) {
    throw downloadError;
  }

  if (result.succeededIds?.length) {
    result.succeededIds.forEach(id => store.updateMediaStatus(id, 'downloaded'));
  }
  if (result.failedItems?.length) {
    result.failedItems.forEach(item => store.updateMediaStatus(item.id, 'failed'));
  }

  return { succeeded: result.succeeded, failed: result.failed };
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

        case MESSAGE_TYPES.CONTENT_IMAGES_UPDATE: {
          await store.init();
          const images = message.payload?.images || [];
          const updated = images.reduce((count, image) => (
            count + store.updateImageDetailsByUrl(image.url, {
              width: image.width,
              height: image.height,
              alt: image.alt,
              previewUrl: image.previewUrl,
            })
          ), 0);

          if (updated > 0) {
            chrome.runtime.sendMessage({
              type: MESSAGE_TYPES.MEDIA_DETAILS_UPDATED,
              payload: { images: store.getImages() },
            }).catch(() => {});
          }

          sendResponse({ success: true, updated });
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

export {
  handleRuntimeMessage,
  onRequestCompleted,
  ensureOffscreenDocument,
};
