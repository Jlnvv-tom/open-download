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
  // 首屏等站点计划的上限：取不到就按通用兜底跑，不阻塞页面
  const PLAN_WAIT_TIMEOUT_MS = 500;
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

  // ─── 站点适配器消费（V16-01） ───────────────────────────
  // 提取计划由 background 匹配规则后下发（content script 是 classic script，不能 import ES module）。
  // 取不到计划时 sitePlan 为 null，行为与通用兜底完全一致。

  let sitePlan = null;
  let planUrl = '';
  let planRequestCount = 0;
  // 「已拿到后台应答」与「请求失败」都表现为 sitePlan 为 null，需要分开标记：
  // 前者无需重试（该站点本就没有规则），后者补一次以免后台冷启动导致规则整页不生效
  let planResolved = false;
  // 计划未就绪前不扫描：否则首屏会把规则要排除的站点 UI 图片一起入库
  let planSettled = false;

  function requestSitePlan() {
    if (location.href !== planUrl) planRequestCount = 0;

    planUrl = location.href;
    planRequestCount += 1;
    planResolved = false;

    return chrome.runtime.sendMessage({
      type: 'GET_SITE_PLAN',
      payload: { pageUrl: location.href, pageDomain: location.hostname },
    }).then((response) => {
      sitePlan = response?.plan || null;
      planResolved = true;
      return sitePlan;
    }).catch(() => {
      sitePlan = null;
      return null;
    });
  }

  function shouldRefreshPlan() {
    if (location.href !== planUrl) return true; // SPA 路由变化：命中的规则可能不同
    return !planResolved && planRequestCount < 2; // 只在请求失败时补一次
  }

  /**
   * 按字段描述符从元素读值（支持 attr / prop / dataset / text）
   */
  function readFieldValue(element, descriptor) {
    if (!descriptor || !descriptor.name) return '';

    let target = element;
    if (descriptor.selector) {
      try {
        target = element.querySelector(descriptor.selector);
      } catch {
        return '';
      }
    }
    if (!target) return '';

    const read = (from, name) => {
      if (!name) return '';
      if (from === 'attr') return target.getAttribute(name) ?? '';
      if (from === 'prop') return target[name] ?? '';
      if (from === 'dataset') return target.dataset?.[name] ?? '';
      if (from === 'text') return target.textContent ?? '';
      return '';
    };

    const primary = read(descriptor.from, descriptor.name);
    if (primary !== '' && primary !== null) return primary;
    return descriptor.fallback ? read(descriptor.fallback.from, descriptor.fallback.name) : '';
  }

  function toPositiveNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function isExcludedNode(node, selectors = []) {
    return selectors.some(selector => {
      try {
        return node.matches(selector) || Boolean(node.closest(selector));
      } catch {
        // 选择器不合法时忽略该条排除规则，不让整条规则失效
        return false;
      }
    });
  }

  function isVideoNode(node) {
    if (node.tagName === 'VIDEO' || node.tagName === 'SOURCE') return true;
    return Boolean(node.querySelector?.('video'));
  }

  function buildPlannedItem(node, plan) {
    const url = String(readFieldValue(node, plan.fields.url) || '');
    // 空 URL（尚未加载完成的占位图）与 blob:/data: 一律跳过
    if (!isCollectableUrl(url)) return null;

    return {
      url,
      previewUrl: url,
      width: toPositiveNumber(readFieldValue(node, plan.fields.width)),
      height: toPositiveNumber(readFieldValue(node, plan.fields.height)),
      alt: String(readFieldValue(node, plan.fields.alt) || ''),
      poster: String(readFieldValue(node, plan.fields.poster) || ''),
      duration: toPositiveNumber(readFieldValue(node, plan.fields.duration)),
    };
  }

  function collectPlannedCandidates(plan) {
    const images = [];
    const videos = [];

    let nodes = [];
    try {
      nodes = Array.from(document.querySelectorAll(plan.itemSelector));
    } catch {
      return { images, videos };
    }

    for (const node of nodes) {
      if (isExcludedNode(node, plan.excludeSelectors)) continue;

      const item = buildPlannedItem(node, plan);
      if (!item) continue;

      if (isVideoNode(node)) {
        videos.push(item);
      } else {
        images.push(item);
      }
    }

    return { images, videos };
  }

  /**
   * 汇总候选：命中规则时优先采信规则结果，规则失效时退回通用兜底
   * @returns {{images: Object[], videos: Object[], ruleId: string, ruleMiss: boolean}}
   */
  function collectMediaCandidates() {
    const generic = collectMediaElements();
    if (!sitePlan) return { ...generic, ruleId: '', ruleMiss: false };

    const planned = collectPlannedCandidates(sitePlan);

    if (sitePlan.exclusive) {
      const empty = planned.images.length === 0 && planned.videos.length === 0;
      // 零命中判定为规则失效：退回通用兜底，并上报 ruleMiss 供 background 诊断
      return empty
        ? { ...generic, ruleId: sitePlan.ruleId, ruleMiss: true }
        : { ...planned, ruleId: sitePlan.ruleId, ruleMiss: false };
    }

    // 非 exclusive：两者合并，重复 URL 由 background 的 urlDedupeKey 负责去重
    return {
      images: [...planned.images, ...generic.images],
      videos: [...planned.videos, ...generic.videos],
      ruleId: sitePlan.ruleId,
      ruleMiss: false,
    };
  }

  let sendTimer = null;

  function sendMediaUpdate(delay = SEND_DEBOUNCE_MS) {
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      // 计划未就绪（bootstrap 尚未结束）时跳过本轮，由 bootstrap 完成后再开始扫描
      if (!planSettled) return;

      if (shouldRefreshPlan()) requestSitePlan();

      const { images, videos, ruleId, ruleMiss } = collectMediaCandidates();
      if (images.length === 0 && videos.length === 0) return;

      chrome.runtime.sendMessage({
        type: 'DOM_MEDIA_UPDATE',
        payload: {
          pageUrl: location.href,
          pageDomain: location.hostname,
          pageTitle: document.title,
          images,
          videos,
          ruleId,
          ruleMiss,
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
  let lastMoreClickAt = 0;

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
   * 规则声明了 lazy.moreSelector 时优先点「加载更多」而不是滚动
   * @returns {boolean} 是否已触发加载（等待渲染期间也返回 true，避免误判触底）
   */
  function tryTriggerMore() {
    const selector = sitePlan?.lazy?.moreSelector;
    if (!selector) return false;

    let button = null;
    try {
      button = document.querySelector(selector);
    } catch {
      return false;
    }
    if (!button || button.disabled) return false;
    // 不可见的「加载更多」不点（例如被折叠或已隐藏的占位按钮）
    if (button.getClientRects().length === 0) return false;

    const settleMs = Number(sitePlan?.lazy?.settleMs) || 0;
    if (Date.now() - lastMoreClickAt < settleMs) return true; // 等待新内容渲染

    button.click();
    lastMoreClickAt = Date.now();
    return true;
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
    lastMoreClickAt = 0;

    // 懒加载常在滚动中改写既有节点的 src（不产生新增节点），收尾补一次全量上报
    sendMediaUpdate(0);
    broadcastScrollState(false, reason);
  }

  function startScrollCapture() {
    if (scrolling) return false; // 幂等：已在滚动中直接返回

    scrolling = true;
    bottomStrikes = 0;
    lastMoreClickAt = 0;

    scrollTimer = setInterval(() => {
      // 规则声明了「加载更多」的站点：点按钮驱动加载，而不是靠滚动
      if (tryTriggerMore()) {
        bottomStrikes = 0;
        return;
      }

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

  /**
   * 先取站点计划再开始扫描：若在计划到达前扫描，规则要排除的站点 UI 图片会被一起入库。
   * 计划请求带超时兜底，取不到就按通用兜底跑，不阻塞页面。
   */
  function bootstrap() {
    Promise.race([
      requestSitePlan(),
      new Promise(resolve => setTimeout(resolve, PLAN_WAIT_TIMEOUT_MS)),
    ]).then(() => {
      planSettled = true;
      startObserving();
    });
  }

  // body 可用后尽早启动，避免等整页 load 才同步已显示媒体。
  if (document.body) {
    bootstrap();
  } else {
    window.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  }

  window.addEventListener('load', () => sendMediaUpdate(0), { once: true });
})();
