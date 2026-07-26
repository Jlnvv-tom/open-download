// content/index.js — Content Script
// 可选：补充页面内 <img> 标签的尺寸信息，并发送给 background

(function () {
  // 仅在主框架运行
  if (window.top !== window.self && !window.__openDownloadContentScript) return;
  window.__openDownloadContentScript = true;

  /**
   * 收集页面中所有 <img> 标签的 src 和尺寸信息
   * 用于补充 webRequest 监听无法获取的图片尺寸数据
   */
  function collectImageElements() {
    const images = document.querySelectorAll('img[src]');
    const results = [];

    images.forEach(img => {
      const src = img.currentSrc || img.src;
      if (!src) return;

      results.push({
        url: src,
        previewUrl: src,
        width: img.naturalWidth || img.width || 0,
        height: img.naturalHeight || img.height || 0,
        alt: img.alt || '',
        complete: img.complete,
      });
    });

    return results;
  }

  let sendTimer = null;

  function sendImageUpdate(delay = 120) {
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      const images = collectImageElements();
      if (images.length === 0) return;

      chrome.runtime.sendMessage({
        type: 'CONTENT_IMAGES_UPDATE',
        payload: { images, url: location.href },
      }).catch(() => {});
    }, delay);
  }

  // 监听来自 background 的请求
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'COLLECT_IMAGES') {
      const images = collectImageElements();
      sendResponse({ success: true, images });
    }
    return true;
  });

  // 观察动态加载的图片（MutationObserver）
  let observer = null;

  function startObserving() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      let hasNewImages = false;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.tagName === 'IMG' || node.querySelector?.('img')) {
              hasNewImages = true;
              break;
            }
          }
        }
        if (hasNewImages) break;
      }

      if (hasNewImages) {
        sendImageUpdate(500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    document.addEventListener('load', (event) => {
      if (event.target?.tagName === 'IMG') {
        sendImageUpdate(80);
      }
    }, true);

    sendImageUpdate(0);
    setTimeout(() => sendImageUpdate(0), 800);
  }

  // body 可用后尽早启动，避免等整页 load 才同步已显示图片。
  if (document.body) {
    startObserving();
  } else {
    window.addEventListener('DOMContentLoaded', startObserving, { once: true });
  }

  window.addEventListener('load', () => sendImageUpdate(0), { once: true });
})();
