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
    updateFabPanel();
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

    if (message?.type === 'STATS_CHANGED') {
      fabUnread = Number(message.payload?.unread) || 0;
      updateFabBadge();
      return false;
    }

    return false;
  });

  // ─── 页面内悬浮球（浮出窗按钮） ────────────────────────
  // 用 Shadow DOM 隔离：既不继承宿主页面样式，也不会把 tokens.css 的全局 reset 注入宿主。
  // 图标一律内联 SVG：img[src] 会被上面的 DOM 扫描与 MutationObserver 当成页面资源捕获。

  const FAB_HOST_ID = 'od-floating-ball-host';
  const FAB_EDGE_GAP_PX = 24;
  const FAB_SIZE_PX = 48;
  const FAB_DRAG_THRESHOLD_PX = 5;
  const FAB_BADGE_MAX = 999;

  const DEFAULT_FLOATING_BALL = {
    enabled: false,
    showBadge: true,
    onlyWhenListening: false,
    draggable: true,
    position: { edge: 'right', bottom: 96 },
  };

  const FAB_STYLES = `
    :host {
      all: initial;
      display: block;
      position: fixed;
      z-index: 2147483647;
      right: 24px;
      bottom: 96px;
      width: 48px;
      height: 48px;
      --od-bg: #ffffff;
      --od-bg-hover: #f1f5f9;
      --od-border: #e2e8f0;
      --od-text: #1a202c;
      --od-muted: #5b677d;
      --od-primary: #3b82f6;
      --od-primary-soft: #eaf2fe;
      --od-danger: #ef4444;
      --od-shadow: 0 6px 20px rgba(15, 23, 42, 0.16);
      --od-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
    }
    :host([data-od-theme='dark']) {
      --od-bg: #1a1b26;
      --od-bg-hover: #24283b;
      --od-border: #3a3f55;
      --od-text: #c0caf5;
      --od-muted: #9aa5ce;
      --od-primary: #7aa2f7;
      --od-primary-soft: #22304f;
      --od-shadow: 0 6px 20px rgba(0, 0, 0, 0.5);
    }
    .od-wrap, .od-wrap * { box-sizing: border-box; }
    .od-wrap {
      position: relative;
      width: 48px;
      height: 48px;
      font-family: var(--od-font);
      line-height: 1.4;
    }
    .od-fab {
      display: grid;
      place-items: center;
      width: 48px;
      height: 48px;
      margin: 0;
      padding: 0;
      border: 1px solid var(--od-border);
      border-radius: 50%;
      background: var(--od-bg);
      box-shadow: var(--od-shadow);
      cursor: pointer;
      opacity: 0.82;
      transition: opacity 160ms ease, transform 160ms ease;
      touch-action: none;
      font: inherit;
      color: inherit;
    }
    .od-fab:hover, .od-fab:focus-visible { opacity: 1; transform: scale(1.04); }
    :host([data-od-open='true']) .od-fab { opacity: 1; }
    .od-fab svg { width: 24px; height: 24px; fill: none; stroke: var(--od-primary); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
    .od-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 999px;
      background: var(--od-danger);
      color: #ffffff;
      font-size: 11px;
      font-weight: 600;
      line-height: 18px;
      text-align: center;
      pointer-events: none;
    }
    .od-panel {
      position: absolute;
      right: 0;
      bottom: 60px;
      width: 220px;
      padding: 8px;
      border: 1px solid var(--od-border);
      border-radius: 12px;
      background: var(--od-bg);
      box-shadow: var(--od-shadow);
    }
    :host([data-od-edge='left']) .od-panel { right: auto; left: 0; }
    .od-panel[hidden], .od-badge[hidden], .od-notice[hidden] { display: none; }
    .od-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 2px 6px 8px;
      margin-bottom: 4px;
      border-bottom: 1px solid var(--od-border);
    }
    .od-title { font-size: 12px; font-weight: 600; color: var(--od-text); }
    .od-version { font-size: 10px; color: var(--od-muted); white-space: nowrap; }
    .od-action {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 8px 6px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      font-family: var(--od-font);
      font-size: 12px;
      color: var(--od-text);
      text-align: left;
      cursor: pointer;
    }
    .od-action:hover, .od-action:focus-visible { background: var(--od-bg-hover); }
    .od-action svg { width: 15px; height: 15px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .od-action[data-od-action='site'] { color: var(--od-danger); }
    .od-notice {
      margin: 4px 2px 2px;
      padding: 6px 8px;
      border-radius: 6px;
      background: var(--od-primary-soft);
      font-size: 11px;
      color: var(--od-muted);
      line-height: 1.45;
    }
    @media (prefers-reduced-motion: reduce) {
      .od-fab { transition: none; }
    }
  `;

  const FAB_MARKUP = `
    <div class="od-wrap">
      <button class="od-fab" type="button" data-od-role="fab">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v11"></path>
          <path d="m8 10 4 4 4-4"></path>
          <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"></path>
        </svg>
      </button>
      <span class="od-badge" data-od-role="badge" hidden></span>
      <div class="od-panel" data-od-role="panel" hidden>
        <div class="od-head">
          <span class="od-title" data-od-role="title"></span>
          <span class="od-version" data-od-role="version"></span>
        </div>
        <button class="od-action" type="button" data-od-action="collect">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="m21 15-5-5L5 21"></path></svg>
          <span data-od-role="collect-label"></span>
        </button>
        <button class="od-action" type="button" data-od-action="scroll">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v16"></path><path d="m6 14 6 6 6-6"></path><path d="M6 4h12"></path></svg>
          <span data-od-role="scroll-label"></span>
        </button>
        <button class="od-action" type="button" data-od-action="site">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="m5.6 5.6 12.8 12.8"></path></svg>
          <span data-od-role="site-label"></span>
        </button>
        <button class="od-action" type="button" data-od-action="options">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"></path></svg>
          <span data-od-role="options-label"></span>
        </button>
        <div class="od-notice" data-od-role="notice" hidden></div>
      </div>
    </div>
  `;

  let fabHost = null;
  let fabEls = null;
  let fabSettings = null;
  let fabUnread = 0;
  let fabOpen = false;
  let fabDrag = null;
  let fabSuppressClick = false;
  let fabNoticeTimer = null;
  let fabOutsideListener = null;
  let fabKeyListener = null;

  // content script 是 classic script，不能 import i18n.js；key 仍需双语齐备
  function t(key, ...args) {
    return chrome.i18n.getMessage(key, args.map(String)) || key;
  }

  function normalizeFloatingBall(raw) {
    const fb = { ...DEFAULT_FLOATING_BALL, ...(raw || {}) };
    const p = fb.position || {};
    fb.position = {
      edge: p.edge === 'left' ? 'left' : 'right',
      bottom: Number.isFinite(Number(p.bottom))
        ? Number(p.bottom)
        : DEFAULT_FLOATING_BALL.position.bottom,
    };
    return fb;
  }

  function currentFloatingBall() {
    return normalizeFloatingBall(fabSettings?.ui?.floatingBall);
  }

  function clampFabBottom(value) {
    const max = Math.max(FAB_EDGE_GAP_PX, window.innerHeight - FAB_SIZE_PX - FAB_EDGE_GAP_PX);
    return Math.min(Math.max(Number(value) || 0, FAB_EDGE_GAP_PX), max);
  }

  function clampFabLeft(value) {
    const max = Math.max(FAB_EDGE_GAP_PX, window.innerWidth - FAB_SIZE_PX - FAB_EDGE_GAP_PX);
    return Math.min(Math.max(Number(value) || 0, FAB_EDGE_GAP_PX), max);
  }

  function applyFabPosition(fb) {
    if (!fabHost) return;
    fabHost.style.bottom = `${clampFabBottom(fb.position.bottom)}px`;
    if (fb.position.edge === 'left') {
      fabHost.style.left = `${FAB_EDGE_GAP_PX}px`;
      fabHost.style.right = 'auto';
    } else {
      fabHost.style.right = `${FAB_EDGE_GAP_PX}px`;
      fabHost.style.left = 'auto';
    }
    fabHost.setAttribute('data-od-edge', fb.position.edge);
  }

  function applyFabTheme(theme) {
    if (!fabHost) return;
    const dark = theme === 'dark'
      || (theme !== 'light' && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches));
    fabHost.setAttribute('data-od-theme', dark ? 'dark' : 'light');
  }

  function updateFabBadge() {
    if (!fabEls) return;
    const count = Number(fabUnread) || 0;
    const show = currentFloatingBall().showBadge !== false && count > 0;
    fabEls.badge.hidden = !show;
    if (show) {
      fabEls.badge.textContent = count > FAB_BADGE_MAX ? `${FAB_BADGE_MAX}+` : String(count);
    }
  }

  function updateFabPanel() {
    if (!fabEls) return;
    fabEls.scrollLabel.textContent = scrolling
      ? t('floatingBallScrollStop')
      : t('floatingBallScrollStart');
    const paused = fabSettings?.siteRules?.[location.hostname] === 'block';
    fabEls.siteLabel.textContent = paused
      ? t('floatingBallResumeSite')
      : t('floatingBallPauseSite');
  }

  function updateFabTexts() {
    if (!fabEls) return;
    fabEls.fab.setAttribute('aria-label', t('floatingBallTitle'));
    fabEls.fab.title = t('floatingBallTitle');
    fabEls.title.textContent = t('floatingBallTitle');
    fabEls.version.textContent = `v${chrome.runtime.getManifest?.().version || ''}`;
    fabEls.collectLabel.textContent = t('floatingBallCollect');
    fabEls.optionsLabel.textContent = t('floatingBallOpenOptions');
    updateFabPanel();
  }

  function showFabNotice(message) {
    if (!fabEls) return;
    fabEls.notice.textContent = message;
    fabEls.notice.hidden = false;
    clearTimeout(fabNoticeTimer);
    fabNoticeTimer = setTimeout(() => {
      if (fabEls) fabEls.notice.hidden = true;
    }, 3000);
  }

  function setFabOpen(open) {
    if (!fabEls) return;
    fabOpen = open;
    fabEls.panel.hidden = !open;
    fabHost.setAttribute('data-od-open', String(open));

    if (open) {
      updateFabPanel();
      // closed shadow root 下，外部监听器看到的 target 一律是 host
      fabOutsideListener = (event) => {
        if (event.target !== fabHost) setFabOpen(false);
      };
      fabKeyListener = (event) => {
        if (event.key === 'Escape') setFabOpen(false);
      };
      document.addEventListener('pointerdown', fabOutsideListener, true);
      document.addEventListener('keydown', fabKeyListener, true);
    } else {
      if (fabOutsideListener) document.removeEventListener('pointerdown', fabOutsideListener, true);
      if (fabKeyListener) document.removeEventListener('keydown', fabKeyListener, true);
      fabOutsideListener = null;
      fabKeyListener = null;
    }
  }

  function unmountFab() {
    if (!fabHost) return;
    setFabOpen(false);
    clearTimeout(fabNoticeTimer);
    fabHost.remove();
    fabHost = null;
    fabEls = null;
  }

  function mountFab() {
    if (fabHost) return;
    // 扩展重载后旧 content script 可能留下一个已无事件绑定的 host，先清理再挂载
    document.getElementById(FAB_HOST_ID)?.remove();

    const host = document.createElement('od-floating-ball');
    host.id = FAB_HOST_ID;
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${FAB_STYLES}</style>${FAB_MARKUP}`;

    const byRole = (role) => root.querySelector(`[data-od-role="${role}"]`);
    fabHost = host;
    fabEls = {
      fab: byRole('fab'),
      badge: byRole('badge'),
      panel: byRole('panel'),
      title: byRole('title'),
      version: byRole('version'),
      collectLabel: byRole('collect-label'),
      scrollLabel: byRole('scroll-label'),
      siteLabel: byRole('site-label'),
      optionsLabel: byRole('options-label'),
      notice: byRole('notice'),
    };

    (document.body || document.documentElement).appendChild(host);
    bindFabEvents();
    updateFabTexts();
    updateFabBadge();
  }

  function bindFabEvents() {
    fabEls.fab.addEventListener('click', () => {
      if (fabSuppressClick) {
        fabSuppressClick = false;
        return;
      }
      setFabOpen(!fabOpen);
    });

    fabEls.panel.addEventListener('click', (event) => {
      const button = event.target.closest?.('[data-od-action]');
      if (button) handleFabAction(button.dataset.odAction);
    });

    fabEls.fab.addEventListener('pointerdown', onFabPointerDown);
    fabEls.fab.addEventListener('pointermove', onFabPointerMove);
    fabEls.fab.addEventListener('pointerup', onFabPointerUp);
    fabEls.fab.addEventListener('pointercancel', onFabPointerUp);
  }

  function onFabPointerDown(event) {
    fabSuppressClick = false;
    if (!currentFloatingBall().draggable || event.button !== 0) return;
    const rect = fabHost.getBoundingClientRect();
    fabDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      moved: false,
    };
    fabEls.fab.setPointerCapture?.(event.pointerId);
  }

  function onFabPointerMove(event) {
    if (!fabDrag || event.pointerId !== fabDrag.pointerId) return;
    const dx = event.clientX - fabDrag.startX;
    const dy = event.clientY - fabDrag.startY;
    if (!fabDrag.moved && Math.hypot(dx, dy) < FAB_DRAG_THRESHOLD_PX) return;
    fabDrag.moved = true;

    const top = fabDrag.startTop + dy;
    fabHost.style.left = `${clampFabLeft(fabDrag.startLeft + dx)}px`;
    fabHost.style.right = 'auto';
    fabHost.style.bottom = `${clampFabBottom(window.innerHeight - top - FAB_SIZE_PX)}px`;
  }

  function onFabPointerUp(event) {
    if (!fabDrag || event.pointerId !== fabDrag.pointerId) return;
    const moved = fabDrag.moved;
    fabDrag = null;
    fabEls.fab.releasePointerCapture?.(event.pointerId);
    if (!moved) return;

    fabSuppressClick = true; // 拖拽结束时浏览器仍会派发一次 click
    const rect = fabHost.getBoundingClientRect();
    const fb = currentFloatingBall();
    const next = {
      ...fb,
      position: {
        edge: rect.left + FAB_SIZE_PX / 2 < window.innerWidth / 2 ? 'left' : 'right',
        bottom: clampFabBottom(window.innerHeight - rect.bottom),
      },
    };
    applyFabPosition(next);
    saveFloatingBall(next);
  }

  function saveFloatingBall(fb) {
    chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: { settings: { ui: { floatingBall: fb } } },
    }).catch(() => {});
  }

  function handleFabAction(action) {
    if (action === 'collect') {
      const { images, videos } = collectMediaCandidates();
      const count = images.length + videos.length;
      // bootstrap 的站点计划最长等 500ms，未就绪时 sendMediaUpdate 会跳过本轮
      if (planSettled) {
        sendMediaUpdate(0);
      } else {
        setTimeout(() => sendMediaUpdate(0), 600);
      }
      showFabNotice(count > 0
        ? t('floatingBallCollectDone', count)
        : t('floatingBallCollectNone'));
      return;
    }

    if (action === 'scroll') {
      if (scrolling) stopScrollCapture('stopped');
      else startScrollCapture();
      updateFabPanel();
      return;
    }

    if (action === 'site') {
      const domain = location.hostname;
      if (!domain) return;
      const siteRules = { ...(fabSettings?.siteRules || {}) };
      if (siteRules[domain] === 'block') delete siteRules[domain];
      else siteRules[domain] = 'block';

      chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        payload: { settings: { siteRules } },
      }).then((res) => {
        const next = res?.settings?.siteRules || siteRules;
        fabSettings = { ...(fabSettings || {}), siteRules: next };
        updateFabPanel();
        showFabNotice(next[domain] === 'block'
          ? t('floatingBallSitePaused')
          : t('floatingBallSiteResumed'));
      }).catch(() => {});
      return;
    }

    if (action === 'options') {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }).catch(() => {});
      setFabOpen(false);
    }
  }

  function applyFabSettings(settings) {
    fabSettings = settings || {};
    const fb = currentFloatingBall();
    const visible = Boolean(fb.enabled)
      && (!fb.onlyWhenListening || Boolean(fabSettings.enabled));

    if (!visible) {
      unmountFab();
      return;
    }

    if (!fabHost) mountFab();
    applyFabPosition(fb);
    applyFabTheme(fabSettings.ui?.theme);
    updateFabBadge();
    updateFabPanel();
  }

  function initFloatingBall() {
    // settings 变更没有广播机制，监听 storage 可覆盖 options / popup / 快捷键所有写入方
    if (chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local' || !changes.settings) return;
        applyFabSettings(changes.settings.newValue);
      });
    }

    const themeQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
    themeQuery?.addEventListener?.('change', () => {
      if (fabHost) applyFabTheme(fabSettings?.ui?.theme);
    });

    window.addEventListener('resize', () => {
      if (fabHost) applyFabPosition(currentFloatingBall());
    });

    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })
      .then((res) => {
        if (res?.settings) applyFabSettings(res.settings);
      })
      .catch(() => {});

    chrome.runtime.sendMessage({ type: 'GET_STATUS' })
      .then((res) => {
        fabUnread = Number(res?.stats?.unread) || 0;
        updateFabBadge();
      })
      .catch(() => {});
  }

  initFloatingBall();

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
