// content/index.js — Content Script
// 1) 采集页面内 <img>/<video> 媒体并上报 background（DOM 兜底捕获）
// 2) 响应用户触发的自动滚动抓取（长列表页懒加载场景）
//
// content script 不是 ES module（manifest content_scripts 不支持 type: module），
// 这里的消息类型字符串需与 src/lib/constants.js 的 MESSAGE_TYPES 保持一致。

(function () {
  // 仅在主框架运行
  if (window.top !== window.self && !window.__openDownloadContentScript) return;
  window.__openDownloadContentScript = true;

  const SEND_DEBOUNCE_MS = 120;
  const SCROLL_STEP_PX = 600;
  const SCROLL_INTERVAL_MS = 150;
  const SCROLL_BOTTOM_STRIKES = 3;
  const SCROLL_TIMEOUT_MS = 60000;

  // blob:/data: 不可重复下载或体积不可控，一律跳过
  function isCollectableUrl(url) {
    return Boolean(url) && !url.startsWith('blob:') && !url.startsWith('data:');
  }

  /**
   * 收集页面内 <img> 的尺寸/alt 信息
   */
  function collectImageElements() {
    const results = [];

    document.querySelectorAll('img[src]').forEach(img => {
      const src = img.currentSrc || img.src;
      if (!isCollectableUrl(src)) return;

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

  /**
   * 收集页面内 <video> 的地址、封面、尺寸与时长
   * duration 在元数据加载前为 NaN/Infinity，仅在有效正值时上报
   */
  function collectVideoElements() {
    const results = [];

    document.querySelectorAll('video').forEach(video => {
      const src = video.currentSrc || video.src;
      if (!isCollectableUrl(src)) return;

      const duration = Number(video.duration);
      results.push({
        url: src,
        poster: isCollectableUrl(video.poster) ? video.poster : '',
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      });
    });

    return results;
  }

  function collectMediaElements() {
    return {
      images: collectImageElements(),
      videos: collectVideoElements(),
    };
  }

  let sendTimer = null;

  function sendMediaUpdate(delay = SEND_DEBOUNCE_MS) {
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      const { images, videos } = collectMediaElements();
      if (images.length === 0 && videos.length === 0) return;

      chrome.runtime.sendMessage({
        type: 'DOM_MEDIA_UPDATE',
        payload: {
          pageUrl: location.href,
          pageDomain: location.hostname,
          pageTitle: document.title,
          images,
          videos,
        },
      }).catch(() => {});
    }, delay);
  }

  // ─── 动态节点观察（MutationObserver） ───────────────────

  let observer = null;

  // video 的地址可能挂在 <video> 或其 <source> 子节点上
  const MEDIA_SELECTOR = 'img, video, source, picture';

  function containsMediaNode(node) {
    if (node.tagName === 'IMG' || node.tagName === 'VIDEO' || node.tagName === 'SOURCE') {
      return true;
    }
    return Boolean(node.querySelector?.(MEDIA_SELECTOR));
  }

  function startObserving() {
    if (observer) return;

    observer = new MutationObserver((mutations) => {
      let hasNewMedia = false;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && containsMediaNode(node)) {
            hasNewMedia = true;
            break;
          }
        }
        if (hasNewMedia) break;
      }

      if (hasNewMedia) {
        sendMediaUpdate(500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    document.addEventListener('load', (event) => {
      const tagName = event.target?.tagName;
      if (tagName === 'IMG' || tagName === 'VIDEO' || tagName === 'SOURCE') {
        sendMediaUpdate(80);
      }
    }, true);

    sendMediaUpdate(0);
    setTimeout(() => sendMediaUpdate(0), 800);
  }

  // ─── 自动滚动抓取 ──────────────────────────────────────

  let scrollTimer = null;
  let scrollTimeout = null;
  let bottomStrikes = 0;
  let scrolling = false;

  function broadcastScrollState(running, reason = '') {
    chrome.runtime.sendMessage({
      type: 'SCROLL_CAPTURE_STATE',
      payload: { running, reason },
    }).catch(() => {});
  }

  function atBottom() {
    return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
  }

  /**
   * 停止滚动抓取
   * @param {string} reason - 'stopped' | 'bottom' | 'timeout'
   */
  function stopScrollCapture(reason = 'stopped') {
    if (!scrolling) return;

    scrolling = false;
    clearInterval(scrollTimer);
    clearTimeout(scrollTimeout);
    scrollTimer = null;
    scrollTimeout = null;
    bottomStrikes = 0;

    // 懒加载常在滚动中改写既有节点的 src（不产生新增节点），收尾补一次全量上报
    sendMediaUpdate(0);
    broadcastScrollState(false, reason);
  }

  function startScrollCapture() {
    if (scrolling) return false; // 幂等：已在滚动中直接返回

    scrolling = true;
    bottomStrikes = 0;

    scrollTimer = setInterval(() => {
      if (atBottom()) {
        bottomStrikes++;
        if (bottomStrikes >= SCROLL_BOTTOM_STRIKES) {
          stopScrollCapture('bottom');
          return;
        }
      } else {
        bottomStrikes = 0;
      }
      window.scrollBy(0, SCROLL_STEP_PX);
    }, SCROLL_INTERVAL_MS);

    scrollTimeout = setTimeout(() => stopScrollCapture('timeout'), SCROLL_TIMEOUT_MS);

    broadcastScrollState(true);
    return true;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'SCROLL_CAPTURE_START') {
      startScrollCapture();
      sendResponse({ success: true, running: scrolling });
      return false;
    }

    if (message?.type === 'SCROLL_CAPTURE_STOP') {
      stopScrollCapture('stopped');
      sendResponse({ success: true, running: scrolling });
      return false;
    }

    return false;
  });

  // body 可用后尽早启动，避免等整页 load 才同步已显示媒体。
  if (document.body) {
    startObserving();
  } else {
    window.addEventListener('DOMContentLoaded', startObserving, { once: true });
  }

  window.addEventListener('load', () => sendMediaUpdate(0), { once: true });
})();
