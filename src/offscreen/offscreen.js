// offscreen/offscreen.js — ZIP 打包专用 offscreen 文档
// 在完整 DOM 上下文中 fetch 媒体资源并打包，Popup 关闭不会中断任务。

import { MESSAGE_TYPES } from '../lib/constants.js';
import { createMediaZip } from '../lib/zip.js';
import { t } from '../lib/i18n.js';

// 通知 background 文档已就绪（createDocument 与监听器注册之间存在竞态）
chrome.runtime.sendMessage({
  type: MESSAGE_TYPES.ZIP_OFFSCREEN_READY,
}).catch(() => {});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 仅接受本扩展上下文的消息
  if (sender.id && sender.id !== chrome.runtime.id) return false;
  if (message?.type !== MESSAGE_TYPES.ZIP_BUILD_REQUEST) return false;

  sendResponse({ received: true });

  buildZip(message.payload || {}).catch(error => {
    chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.ZIP_BUILD_RESULT,
      payload: { error: error.message },
    }).catch(() => {});
  });

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
