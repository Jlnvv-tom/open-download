/**
 * background/index.js 单元测试
 */

import { DEFAULT_SETTINGS, MESSAGE_TYPES } from '../src/lib/constants.js';
import { store } from '../src/lib/store.js';
import { sleep } from '../src/lib/utils.js';
import {
  handleRuntimeMessage,
  onRequestCompleted,
  isCaptureAllowed,
  planTransfer,
  resolveSitePlan
} from '../src/background/index.js';

function resetStoreSingleton() {
  store.images = [];
  store.settings = {
    ...DEFAULT_SETTINGS,
    filters: {
      ...DEFAULT_SETTINGS.filters,
      minDimensions: {
        ...DEFAULT_SETTINGS.filters.minDimensions
      }
    }
  };
  store.stats = { total: 0, downloaded: 0, failed: 0, truncated: 0, unread: 0 };
  store._loaded = false;
}

function sendBackgroundMessage(message) {
  return new Promise(resolve => {
    handleRuntimeMessage(message, {}, resolve);
  });
}

function dispatchToBackground(message) {
  // 模拟扩展内其他上下文（offscreen 等）向 background 发送消息
  handleRuntimeMessage(message, { id: 'test-extension-id' }, () => {});
}

describe('background message handler', () => {
  let consoleLog;

  beforeEach(() => {
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    resetStoreSingleton();
  });

  afterEach(() => {
    consoleLog.mockRestore();
  });

  test('DOM_MEDIA_UPDATE 应该富化已存在的记录且不重复入库', async () => {
    await store.init();
    await store.saveSettings({ enabled: true });
    const sendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn(async () => ({ success: true }));

    const image = store.addImage({
      url: 'https://cdn.example.com/images/photo.jpg?cache=1',
      filename: 'photo.jpg',
      domain: 'cdn.example.com'
    });

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOM_MEDIA_UPDATE,
      payload: {
        pageUrl: 'https://example.com/page',
        pageDomain: 'example.com',
        pageTitle: 'Example Page',
        images: [
          {
            url: 'https://cdn.example.com/images/photo.jpg?cache=1',
            width: 1024,
            height: 768,
            alt: '产品图',
            previewUrl: 'https://cdn.example.com/images/photo-large.jpg'
          }
        ],
        videos: []
      }
    });

    expect(response).toEqual({ success: true, added: 0, updated: 1 });
    expect(store.getImageById(image.id)).toMatchObject({
      width: 1024,
      height: 768,
      alt: '产品图',
      previewUrl: 'https://cdn.example.com/images/photo-large.jpg',
      source: 'network'
    });
    expect(store.getImages()).toHaveLength(1);
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.MEDIA_DETAILS_UPDATED,
      payload: { images: store.getImages() }
    });

    global.chrome.runtime.sendMessage = sendMessage;
  });

  test('DOM_MEDIA_UPDATE 应该兜底入库缓存命中图片并标注 source=dom', async () => {
    await store.init();
    await store.saveSettings({ enabled: true });
    const sendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn(async () => ({ success: true }));

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOM_MEDIA_UPDATE,
      payload: {
        pageUrl: 'https://example.com/gallery',
        pageDomain: 'example.com',
        pageTitle: '图库',
        images: [{ url: 'https://cdn.example.com/images/cached.jpg', width: 320, height: 240, alt: '' }],
        videos: []
      }
    });

    expect(response).toEqual({ success: true, added: 1, updated: 0 });

    const images = store.getImages();
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      source: 'dom',
      mediaType: 'image',
      url: 'https://cdn.example.com/images/cached.jpg',
      tabUrl: 'https://example.com/gallery',
      tabTitle: '图库',
      width: 320,
      height: 240
    });
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.MEDIA_FOUND,
      payload: images[0]
    });
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MESSAGE_TYPES.MEDIA_DETAILS_UPDATED })
    );

    global.chrome.runtime.sendMessage = sendMessage;
  });

  test('DOM_MEDIA_UPDATE 视频应该带入时长并把 poster 映射为预览图', async () => {
    await store.init();
    await store.saveSettings({ enabled: true });
    const sendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn(async () => ({ success: true }));

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOM_MEDIA_UPDATE,
      payload: {
        pageUrl: 'https://example.com/watch',
        pageDomain: 'example.com',
        pageTitle: '播放页',
        images: [],
        videos: [
          {
            url: 'https://cdn.example.com/video/clip.mp4',
            poster: 'https://cdn.example.com/video/clip.jpg',
            width: 1920,
            height: 1080,
            duration: 204.4
          }
        ]
      }
    });

    expect(response).toEqual({ success: true, added: 1, updated: 0 });
    expect(store.getImages()[0]).toMatchObject({
      mediaType: 'video',
      source: 'dom',
      duration: 204.4,
      previewUrl: 'https://cdn.example.com/video/clip.jpg',
      width: 1920,
      height: 1080
    });

    global.chrome.runtime.sendMessage = sendMessage;
  });

  test('DOM_MEDIA_UPDATE 无扩展名的图片应该按元素类型入库', async () => {
    await store.init();
    await store.saveSettings({ enabled: true });
    const sendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn(async () => ({ success: true }));

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOM_MEDIA_UPDATE,
      payload: {
        pageUrl: 'https://example.com/page',
        pageDomain: 'example.com',
        images: [{ url: 'https://cdn.example.com/render?id=7', width: 100, height: 100 }],
        videos: []
      }
    });

    expect(response).toEqual({ success: true, added: 1, updated: 0 });
    expect(store.getImages()[0]).toMatchObject({
      mediaType: 'image',
      source: 'dom',
      url: 'https://cdn.example.com/render?id=7'
    });

    global.chrome.runtime.sendMessage = sendMessage;
  });

  test('DOM_MEDIA_UPDATE 应该跳过 blob: 与 data: 资源', async () => {
    await store.init();
    await store.saveSettings({ enabled: true });
    const sendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn(async () => ({ success: true }));

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOM_MEDIA_UPDATE,
      payload: {
        pageUrl: 'https://example.com/page',
        pageDomain: 'example.com',
        images: [
          { url: 'blob:https://example.com/6f1c', width: 100, height: 100 },
          { url: 'data:image/png;base64,iVBORw0KGgo', width: 100, height: 100 }
        ],
        videos: [{ url: 'blob:https://example.com/stream', duration: 30 }]
      }
    });

    expect(response).toEqual({ success: true, added: 0, updated: 0 });
    expect(store.getImages()).toHaveLength(0);

    global.chrome.runtime.sendMessage = sendMessage;
  });

  test('DOM_MEDIA_UPDATE 在全局关闭时应该整批丢弃', async () => {
    await store.init();
    const sendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn(async () => ({ success: true }));

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOM_MEDIA_UPDATE,
      payload: {
        pageUrl: 'https://example.com/page',
        pageDomain: 'example.com',
        images: [{ url: 'https://cdn.example.com/images/a.jpg', width: 10, height: 10 }],
        videos: []
      }
    });

    expect(response).toEqual({ success: true, added: 0, updated: 0 });
    expect(store.getImages()).toHaveLength(0);
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();

    global.chrome.runtime.sendMessage = sendMessage;
  });

  test('站点规则 block 应该同时拦截 DOM 与 webRequest 两条链路', async () => {
    await store.init();
    await store.saveSettings({ enabled: true, siteRules: { 'example.com': 'block' } });
    const sendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn(async () => ({ success: true }));

    const domResponse = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOM_MEDIA_UPDATE,
      payload: {
        pageUrl: 'https://example.com/page',
        pageDomain: 'example.com',
        images: [{ url: 'https://cdn.example.com/images/a.jpg', width: 10, height: 10 }],
        videos: []
      }
    });

    // chrome.tabs.get mock 返回 https://example.com，命中同一站点规则
    await onRequestCompleted({
      type: 'image',
      url: 'https://cdn.example.com/assets/blocked.jpg',
      tabId: 7,
      responseHeaders: [{ name: 'Content-Type', value: 'image/jpeg' }]
    });

    expect(domResponse).toEqual({ success: true, added: 0, updated: 0 });
    expect(store.getImages()).toHaveLength(0);
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();

    global.chrome.runtime.sendMessage = sendMessage;
  });

  test('isCaptureAllowed 应该覆盖全局开关与站点规则三态', async () => {
    const base = { ...DEFAULT_SETTINGS, enabled: true, siteRules: { 'blocked.com': 'block' } };

    expect(isCaptureAllowed({ ...base, enabled: false }, 'example.com')).toBe(false);
    // 全局关闭时站点规则不能反向打开
    expect(isCaptureAllowed({ ...base, enabled: false }, 'allowed.com')).toBe(false);
    expect(isCaptureAllowed(base, 'example.com')).toBe(true);
    expect(isCaptureAllowed(base, 'blocked.com')).toBe(false);
    // 无站点上下文（tabId -1 等）跟随全局
    expect(isCaptureAllowed(base, '')).toBe(true);
    expect(isCaptureAllowed(base, undefined)).toBe(true);
  });

  test('SCROLL_CAPTURE_START/STOP 应该路由到当前活动标签页', async () => {
    global.chrome.tabs._setActiveTab({ id: 42, url: 'https://example.com/list', title: 'List' });

    const startResponse = await sendBackgroundMessage({ type: MESSAGE_TYPES.SCROLL_CAPTURE_START });
    const stopResponse = await sendBackgroundMessage({ type: MESSAGE_TYPES.SCROLL_CAPTURE_STOP });

    expect(startResponse).toEqual({ success: true });
    expect(stopResponse).toEqual({ success: true });
    expect(global.chrome.tabs._sentMessages).toEqual([
      { tabId: 42, message: { type: MESSAGE_TYPES.SCROLL_CAPTURE_START } },
      { tabId: 42, message: { type: MESSAGE_TYPES.SCROLL_CAPTURE_STOP } }
    ]);
  });

  test('SCROLL_CAPTURE 在页面无 content script 时应该返回不支持', async () => {
    global.chrome.tabs._sendMessageError = 'Could not establish connection';

    const response = await sendBackgroundMessage({ type: MESSAGE_TYPES.SCROLL_CAPTURE_START });

    expect(response).toEqual({ success: false, error: '当前页面不支持滚动抓取' });
  });

  describe('站点适配器（V16-01）', () => {
    test('GET_SITE_PLAN 命中规则时应该返回可序列化的提取计划', async () => {
      const response = await sendBackgroundMessage({
        type: MESSAGE_TYPES.GET_SITE_PLAN,
        payload: {
          pageUrl: 'https://zh.wikipedia.org/wiki/Open_Download',
          pageDomain: 'zh.wikipedia.org'
        }
      });

      expect(response.success).toBe(true);
      expect(response.plan).toMatchObject({ ruleId: 'wikipedia', exclusive: true });
      expect(response.plan.itemSelector).toContain('#mw-content-text');
      // 计划要跨消息传递，必须能被 JSON 序列化
      expect(JSON.parse(JSON.stringify(response.plan))).toEqual(response.plan);
    });

    test('GET_SITE_PLAN 未命中规则时应该返回 null', async () => {
      const response = await sendBackgroundMessage({
        type: MESSAGE_TYPES.GET_SITE_PLAN,
        payload: { pageUrl: 'https://example.com/', pageDomain: 'example.com' }
      });

      expect(response).toEqual({ success: true, plan: null });
    });

    test('resolveSitePlan 对缺失 payload 应该安全返回 null', () => {
      expect(resolveSitePlan()).toBeNull();
      expect(resolveSitePlan({})).toBeNull();
      expect(resolveSitePlan({ pageUrl: 'not a url', pageDomain: '' })).toBeNull();
    });

    test('DOM_MEDIA_UPDATE 上报 ruleMiss 时应该入库并按页面去重地告警', async () => {
      await store.init();
      await store.saveSettings({ enabled: true });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const sendMessage = global.chrome.runtime.sendMessage;
      global.chrome.runtime.sendMessage = jest.fn(async () => ({ success: true }));

      const payload = {
        pageUrl: 'https://zh.wikipedia.org/wiki/Broken',
        pageDomain: 'zh.wikipedia.org',
        pageTitle: 'Broken',
        images: [{ url: 'https://upload.wikimedia.org/images/fallback.jpg', width: 10, height: 10 }],
        videos: [],
        ruleId: 'wikipedia',
        ruleMiss: true
      };

      const first = await sendBackgroundMessage({ type: MESSAGE_TYPES.DOM_MEDIA_UPDATE, payload });
      await sendBackgroundMessage({ type: MESSAGE_TYPES.DOM_MEDIA_UPDATE, payload });

      // 规则失效也照样完成兜底入库，能力不倒退
      expect(first).toEqual({ success: true, added: 1, updated: 0 });
      expect(store.getImages()).toHaveLength(1);
      expect(store.getImages()[0]).toMatchObject({ source: 'dom' });

      // 同一页面只告警一次
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('wikipedia');
      expect(warnSpy.mock.calls[0][0]).toContain('https://zh.wikipedia.org/wiki/Broken');

      warnSpy.mockRestore();
      global.chrome.runtime.sendMessage = sendMessage;
    });

    test('关闭捕获时不应该产生 ruleMiss 告警', async () => {
      await store.init();
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await sendBackgroundMessage({
        type: MESSAGE_TYPES.DOM_MEDIA_UPDATE,
        payload: {
          pageUrl: 'https://zh.wikipedia.org/wiki/Disabled',
          pageDomain: 'zh.wikipedia.org',
          images: [],
          videos: [],
          ruleId: 'wikipedia',
          ruleMiss: true
        }
      });

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  test('已删除的 CONTENT_IMAGES_UPDATE 应该命中未知消息分支', async () => {
    expect(MESSAGE_TYPES.CONTENT_IMAGES_UPDATE).toBeUndefined();

    const response = await sendBackgroundMessage({
      type: 'CONTENT_IMAGES_UPDATE',
      payload: { images: [] }
    });

    expect(response).toEqual({ success: false, error: 'Unknown message type' });
  });

  test('站点右键菜单应该切换暂停并广播 SITE_RULES_CHANGED', async () => {
    await store.init();
    const realSendMessage = global.chrome.runtime.sendMessage;
    const sendMessage = jest.fn(async () => ({ success: true }));
    global.chrome.runtime.sendMessage = sendMessage;

    global.chrome.contextMenus._trigger(
      { menuItemId: 'open-download-site-toggle' },
      { url: 'https://blocked-site.com/page' }
    );
    await sleep(20);

    expect(store.getSettings().siteRules).toEqual({ 'blocked-site.com': 'block' });
    expect(sendMessage).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.SITE_RULES_CHANGED,
      payload: { siteRules: { 'blocked-site.com': 'block' } }
    });

    // 再次触发即恢复跟随（删除该键）
    global.chrome.contextMenus._trigger(
      { menuItemId: 'open-download-site-toggle' },
      { url: 'https://blocked-site.com/page' }
    );
    await sleep(20);

    expect(store.getSettings().siteRules).toEqual({});

    global.chrome.runtime.sendMessage = realSendMessage;
  });

  test('未知消息类型应该返回失败响应', async () => {
    const response = await sendBackgroundMessage({
      type: 'UNKNOWN_MESSAGE'
    });

    expect(response).toEqual({
      success: false,
      error: 'Unknown message type'
    });
  });

  test('应该捕获图片请求并记录响应头和来源标签页信息', async () => {
    await store.init();
    await store.saveSettings({ enabled: true });
    const sendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn(async () => ({ success: true }));

    await onRequestCompleted({
      type: 'image',
      url: 'https://cdn.example.com/assets/photo.jpg',
      tabId: 7,
      responseHeaders: [
        { name: 'Content-Type', value: 'image/jpeg' },
        { name: 'Content-Length', value: '2048' }
      ]
    });

    const images = store.getImages();
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      mediaType: 'image',
      extension: 'jpg',
      url: 'https://cdn.example.com/assets/photo.jpg',
      filename: 'photo.jpg',
      domain: 'cdn.example.com',
      mimeType: 'image/jpeg',
      size: 2048,
      tabUrl: 'https://example.com',
      tabTitle: 'Example Page'
    });
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.MEDIA_FOUND,
      payload: images[0]
    });

    global.chrome.runtime.sendMessage = sendMessage;
  });

  test('应该捕获视频媒体请求', async () => {
    await store.init();
    await store.saveSettings({ enabled: true });
    const sendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn(async () => ({ success: true }));

    await onRequestCompleted({
      type: 'media',
      url: 'https://cdn.example.com/video/demo.mp4',
      tabId: 7,
      responseHeaders: [
        { name: 'Content-Type', value: 'video/mp4' },
        { name: 'Content-Length', value: '4096' }
      ]
    });

    const media = store.getMedia();
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({
      mediaType: 'video',
      extension: 'mp4',
      mimeType: 'video/mp4',
      size: 4096
    });

    global.chrome.runtime.sendMessage = sendMessage;
  });

  test('应该批量更新媒体下载状态', async () => {
    await store.init();
    const media = store.addMedia({
      mediaType: 'video',
      url: 'https://cdn.example.com/video/demo.mp4',
      filename: 'demo.mp4',
      mimeType: 'video/mp4'
    });

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.UPDATE_MEDIA_STATUSES,
      payload: {
        ids: [media.id],
        status: 'downloaded'
      }
    });

    expect(response.success).toBe(true);
    expect(store.getMediaById(media.id)).toMatchObject({
      status: 'downloaded',
      downloaded: true
    });
  });

  test('filters.mediaTypes 白名单应该过滤捕获类型', async () => {
    await store.init();
    await store.saveSettings({ enabled: true, filters: { mediaTypes: ['image'] } });
    const sendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn(async () => ({ success: true }));

    await onRequestCompleted({
      type: 'media',
      url: 'https://cdn.example.com/video/demo.mp4',
      tabId: -1,
      responseHeaders: [
        { name: 'Content-Type', value: 'video/mp4' },
        { name: 'Content-Length', value: '4096' }
      ]
    });

    await onRequestCompleted({
      type: 'image',
      url: 'https://cdn.example.com/img/photo.jpg',
      tabId: -1,
      responseHeaders: [
        { name: 'Content-Type', value: 'image/jpeg' },
        { name: 'Content-Length', value: '2048' }
      ]
    });

    const media = store.getMedia();
    expect(media).toHaveLength(1);
    expect(media[0]).toMatchObject({ mediaType: 'image', filename: 'photo.jpg' });

    global.chrome.runtime.sendMessage = sendMessage;
  });

  test('DOWNLOAD_ONE 应该下载单个媒体并广播状态变化', async () => {
    await store.init();
    const realSendMessage = global.chrome.runtime.sendMessage;
    const sendMessage = jest.fn(async () => ({ success: true }));
    global.chrome.runtime.sendMessage = sendMessage;

    const media = store.addMedia({
      url: 'https://cdn.example.com/images/single.jpg',
      filename: 'single.jpg',
      domain: 'cdn.example.com'
    });

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOWNLOAD_ONE,
      payload: { id: media.id }
    });

    expect(response).toMatchObject({ success: true });
    expect(store.getMediaById(media.id)).toMatchObject({ status: 'downloaded', downloaded: true });

    const statuses = sendMessage.mock.calls
      .filter(([message]) => message.type === MESSAGE_TYPES.DOWNLOAD_STATUS_CHANGED)
      .map(([message]) => message.payload.status);
    expect(statuses).toEqual(['downloading', 'downloaded']);

    global.chrome.runtime.sendMessage = realSendMessage;
  });

  test('DOWNLOAD_ONE 条目不存在时应该返回错误', async () => {
    await store.init();

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOWNLOAD_ONE,
      payload: { id: 'not-exists' }
    });

    expect(response).toEqual({ success: false, error: 'media not found' });
  });

  test('CANCEL_DOWNLOAD 应该取消进行中的单条下载且不计入失败', async () => {
    await store.init();
    const media = store.addMedia({
      url: 'https://cdn.example.com/images/cancel.jpg',
      filename: 'cancel.jpg',
      domain: 'cdn.example.com'
    });

    const downloadPromise = sendBackgroundMessage({
      type: MESSAGE_TYPES.DOWNLOAD_ONE,
      payload: { id: media.id }
    });
    await sleep(10);

    const cancelResponse = await sendBackgroundMessage({
      type: MESSAGE_TYPES.CANCEL_DOWNLOAD,
      payload: { id: media.id }
    });
    expect(cancelResponse).toMatchObject({ success: true, cancelled: true });

    const response = await downloadPromise;
    expect(response).toMatchObject({ success: false, cancelled: true });
    expect(store.getMediaById(media.id)).toMatchObject({ status: 'pending' });
    expect(store.getStats().failed).toBe(0);
  });

  test('已移除的 DOWNLOAD_ALL / EXPORT_IMAGES 应该命中未知消息分支', async () => {
    const downloadAllRes = await sendBackgroundMessage({
      type: 'DOWNLOAD_ALL',
      payload: { filters: {} }
    });
    const exportRes = await sendBackgroundMessage({
      type: 'EXPORT_IMAGES'
    });

    expect(downloadAllRes).toEqual({ success: false, error: 'Unknown message type' });
    expect(exportRes).toEqual({ success: false, error: 'Unknown message type' });
  });

  describe('planTransfer（批量下载策略）', () => {
    test('普通批次应该走 ZIP 单卷', () => {
      const plan = planTransfer([{ id: '1', size: 1024 }, { id: '2', size: 2048 }], {});

      expect(plan.strategy).toBe('zip');
      expect(plan.volumes).toHaveLength(1);
      expect(plan.volumes[0]).toHaveLength(2);
      expect(plan.directItems).toEqual([]);
    });

    test('单文件超阈值应该整批改直下', () => {
      const items = [{ id: '1', size: 1024 }, { id: '2', size: 60 * 1024 * 1024 }];
      const plan = planTransfer(items, {});

      expect(plan).toEqual({
        strategy: 'direct',
        reason: 'large-file',
        volumes: [],
        directItems: items
      });
    });

    test('空批次应该安全返回空计划', () => {
      expect(planTransfer([], {})).toEqual({
        strategy: 'zip',
        reason: '',
        volumes: [],
        directItems: []
      });
    });

    test('整批预估超阈值应该改直下', () => {
      // 每条约 20MB（低于单文件阈值），30 条合计约 600MB 超过整包阈值
      const items = Array.from({ length: 30 }, (_, index) => ({
        id: String(index),
        size: 20 * 1024 * 1024
      }));

      const plan = planTransfer(items, {});
      expect(plan.strategy).toBe('direct');
      expect(plan.reason).toBe('large-batch');
    });

    test('大小恰好等于阈值时仍走 ZIP', () => {
      const plan = planTransfer([{ id: '1', size: 50 * 1024 * 1024, mediaType: 'image' }], {});

      expect(plan.strategy).toBe('zip');
    });

    test('videoDirect 开启时 size 未知的 DOM 视频按视频拆分走直下', () => {
      const plan = planTransfer([{ id: '1', size: 0, mediaType: 'video', source: 'dom' }], {});

      expect(plan.strategy).toBe('direct');
      expect(plan.reason).toBe('video');
      expect(plan.directItems.map(item => item.id)).toEqual(['1']);
    });

    test('关闭 videoDirect 后 size 未知的 DOM 视频回到保守估算并触发旁路', () => {
      const plan = planTransfer(
        [{ id: '1', size: 0, mediaType: 'video', source: 'dom' }],
        { transfer: { videoDirect: false } }
      );

      expect(plan.strategy).toBe('direct');
      expect(plan.reason).toBe('large-file');
    });

    test('size 未知的图片按 0 计，不触发旁路', () => {
      const plan = planTransfer([{ id: '1', size: 0, mediaType: 'image', source: 'dom' }], {});

      expect(plan.strategy).toBe('zip');
    });

    test('应该按 maxZipFiles 切分多卷', () => {
      const items = Array.from({ length: 5 }, (_, index) => ({ id: String(index), size: 10 }));
      const plan = planTransfer(items, { transfer: { maxZipFiles: 2 } });

      expect(plan.strategy).toBe('zip');
      expect(plan.volumes.map(volume => volume.length)).toEqual([2, 2, 1]);
    });

    test('应该按 maxZipBytes 切分多卷', () => {
      const items = [
        { id: '1', size: 300 },
        { id: '2', size: 300 },
        { id: '3', size: 100 }
      ];
      const plan = planTransfer(items, { transfer: { maxZipBytes: 500 } });

      expect(plan.volumes.map(volume => volume.map(item => item.id))).toEqual([['1'], ['2', '3']]);
    });

    test('settings.transfer 应该覆盖默认阈值', () => {
      const items = [{ id: '1', size: 2048 }];

      expect(planTransfer(items, {}).strategy).toBe('zip');
      expect(planTransfer(items, { transfer: { bypassFileSize: 1024 } }).strategy).toBe('direct');
    });

    test('videoDirect 默认开启时纯视频批次整批直下', () => {
      const video = { id: 'v1', size: 10 * 1024 * 1024, mediaType: 'video' };
      const plan = planTransfer([video], {});

      expect(plan.strategy).toBe('direct');
      expect(plan.reason).toBe('video');
      expect(plan.volumes).toEqual([]);
      expect(plan.directItems).toEqual([video]);
    });

    test('混合批次应该拆成视频直下 + 图片打包', () => {
      const video = { id: 'v1', size: 10 * 1024 * 1024, mediaType: 'video' };
      const first = { id: 'i1', size: 1024, mediaType: 'image' };
      const second = { id: 'i2', size: 2048, mediaType: 'image' };

      const plan = planTransfer([video, first, second], {});

      expect(plan.strategy).toBe('mixed');
      expect(plan.reason).toBe('video');
      expect(plan.directItems).toEqual([video]);
      expect(plan.volumes).toHaveLength(1);
      expect(plan.volumes[0]).toEqual([first, second]);
    });

    test('混合批次里出现超大图片时应该整批直下，不再产出两种产物', () => {
      const video = { id: 'v1', size: 10 * 1024 * 1024, mediaType: 'video' };
      const huge = { id: 'i1', size: 60 * 1024 * 1024, mediaType: 'image' };

      const plan = planTransfer([video, huge], {});

      expect(plan.strategy).toBe('direct');
      expect(plan.reason).toBe('large-file');
      expect(plan.directItems).toEqual([video, huge]);
      expect(plan.volumes).toEqual([]);
    });

    test('关闭 videoDirect 后视频回到与图片相同的阈值逻辑', () => {
      const items = [
        { id: 'v1', size: 10 * 1024 * 1024, mediaType: 'video' },
        { id: 'i1', size: 1024, mediaType: 'image' }
      ];

      const plan = planTransfer(items, { transfer: { videoDirect: false } });

      expect(plan.strategy).toBe('zip');
      expect(plan.directItems).toEqual([]);
      expect(plan.volumes[0]).toEqual(items);
    });

    test('混合批次的分卷上限只约束图片部分', () => {
      const video = { id: 'v1', size: 1024, mediaType: 'video' };
      const images = Array.from({ length: 3 }, (_, index) => ({
        id: `i${index}`,
        size: 10,
        mediaType: 'image'
      }));

      const plan = planTransfer([video, ...images], { transfer: { maxZipFiles: 2 } });

      expect(plan.strategy).toBe('mixed');
      expect(plan.directItems).toEqual([video]);
      expect(plan.volumes.map(volume => volume.length)).toEqual([2, 1]);
    });
  });

  test('DOWNLOAD_ZIP 在超阈值批次应该改走逐条直下', async () => {
    await store.init();
    await store.saveSettings({ transfer: { bypassFileSize: 1024 } });

    const realDownload = global.chrome.downloads.download;
    const downloadSpy = jest.fn(realDownload.bind(global.chrome.downloads));
    global.chrome.downloads.download = downloadSpy;

    const big = store.addMedia({
      mediaType: 'video',
      url: 'https://cdn.example.com/video/big.mp4',
      filename: 'big.mp4',
      size: 8 * 1024 * 1024
    });
    const small = store.addMedia({
      url: 'https://cdn.example.com/images/small.jpg',
      filename: 'small.jpg',
      size: 2048
    });

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOWNLOAD_ZIP,
      payload: { ids: [big.id, small.id] }
    });

    expect(response).toMatchObject({ success: true, strategy: 'direct', succeeded: 2, failed: 0 });
    // 直下不经过 offscreen 打包
    expect(global.chrome.offscreen._created).toBe(0);
    expect(downloadSpy.mock.calls.map(call => call[0].url).sort()).toEqual([big.url, small.url].sort());
    expect(store.getMediaById(big.id)).toMatchObject({ status: 'downloaded' });

    global.chrome.downloads.download = realDownload;
  });

  test('DOWNLOAD_ZIP 应该按卷串行打包并输出分卷命名', async () => {
    await store.init();
    await store.saveSettings({ transfer: { maxZipFiles: 1 } });

    const first = store.addMedia({ url: 'https://cdn.example.com/images/a.jpg', filename: 'a.jpg' });
    const second = store.addMedia({ url: 'https://cdn.example.com/images/b.jpg', filename: 'b.jpg' });

    const realCreate = global.chrome.offscreen.createDocument.bind(global.chrome.offscreen);
    global.chrome.offscreen.createDocument = async (options) => {
      await realCreate(options);
      dispatchToBackground({ type: MESSAGE_TYPES.ZIP_OFFSCREEN_READY });
    };

    const requestedNames = [];
    const realSendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = async (message) => {
      if (message.type === MESSAGE_TYPES.ZIP_BUILD_REQUEST) {
        requestedNames.push(message.payload.zipName);
        dispatchToBackground({
          type: MESSAGE_TYPES.ZIP_BUILD_RESULT,
          payload: {
            zipName: message.payload.zipName,
            blobUrl: `blob:mock-volume-${message.payload.volume}`,
            succeeded: 1,
            failed: 0,
            succeededIds: message.payload.items.map(item => item.id),
            failedItems: []
          }
        });
        return { received: true };
      }
      return { success: true };
    };

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOWNLOAD_ZIP,
      payload: { ids: [first.id, second.id] }
    });

    expect(requestedNames).toHaveLength(2);
    expect(requestedNames[0]).toMatch(/_part1\.zip$/);
    expect(requestedNames[1]).toMatch(/_part2\.zip$/);
    expect(response).toMatchObject({ success: true, succeeded: 2, failed: 0, strategy: 'zip' });
    expect(response.volumes).toHaveLength(2);
    // 每卷结束即回写状态
    expect(store.getMediaById(first.id)).toMatchObject({ status: 'downloaded' });
    expect(store.getMediaById(second.id)).toMatchObject({ status: 'downloaded' });

    global.chrome.runtime.sendMessage = realSendMessage;
    global.chrome.offscreen.createDocument = realCreate;
  });

  test('ZIP_BUILD_REQUEST 应该透传 sendCookies 设置', async () => {
    await store.init();
    await store.saveSettings({ sendCookies: true });

    const media = store.addMedia({ url: 'https://cdn.example.com/images/cookie.jpg', filename: 'cookie.jpg' });

    const realCreate = global.chrome.offscreen.createDocument.bind(global.chrome.offscreen);
    global.chrome.offscreen.createDocument = async (options) => {
      await realCreate(options);
      dispatchToBackground({ type: MESSAGE_TYPES.ZIP_OFFSCREEN_READY });
    };

    let zipRequest = null;
    const realSendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = async (message) => {
      if (message.type === MESSAGE_TYPES.ZIP_BUILD_REQUEST) {
        zipRequest = message.payload;
        dispatchToBackground({
          type: MESSAGE_TYPES.ZIP_BUILD_RESULT,
          payload: {
            zipName: message.payload.zipName,
            blobUrl: 'blob:mock-cookie',
            succeeded: 1,
            failed: 0,
            succeededIds: [media.id],
            failedItems: []
          }
        });
        return { received: true };
      }
      return { success: true };
    };

    await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOWNLOAD_ZIP,
      payload: { ids: [media.id] }
    });

    expect(zipRequest).toMatchObject({ sendCookies: true, volume: 1, volumes: 1 });

    global.chrome.runtime.sendMessage = realSendMessage;
    global.chrome.offscreen.createDocument = realCreate;
  });

  test('DOWNLOAD_ZIP 显式 strategy=direct 时应该跳过阈值判定', async () => {
    await store.init();

    const realDownload = global.chrome.downloads.download;
    global.chrome.downloads.download = jest.fn(realDownload.bind(global.chrome.downloads));

    const media = store.addMedia({
      url: 'https://cdn.example.com/images/forced.jpg',
      filename: 'forced.jpg'
    });

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOWNLOAD_ZIP,
      payload: { ids: [media.id], strategy: 'direct' }
    });

    expect(response).toMatchObject({ success: true, strategy: 'direct', succeeded: 1 });
    expect(global.chrome.offscreen._created).toBe(0);

    global.chrome.downloads.download = realDownload;
  });

  test('已删除的 DOWNLOAD_SELECTED 应该命中未知消息分支', async () => {
    // V16-02 起该消息被删除：显式整批直下改由 DOWNLOAD_ZIP + strategy='direct' 承担
    expect(MESSAGE_TYPES.DOWNLOAD_SELECTED).toBeUndefined();

    const response = await sendBackgroundMessage({
      type: 'DOWNLOAD_SELECTED',
      payload: { ids: ['whatever'] }
    });

    expect(response).toEqual({ success: false, error: 'Unknown message type' });
  });

  test('DOWNLOAD_ZIP 混合批次应该先直下视频再打包图片', async () => {
    await store.init();
    await store.saveSettings({ enabled: true });

    const realDownload = global.chrome.downloads.download;
    const downloadSpy = jest.fn(realDownload.bind(global.chrome.downloads));
    global.chrome.downloads.download = downloadSpy;

    const video = store.addMedia({
      mediaType: 'video',
      url: 'https://cdn.example.com/v/clip.mp4',
      filename: 'clip.mp4',
      size: 10 * 1024 * 1024
    });
    const image = store.addMedia({
      url: 'https://cdn.example.com/i/pic.jpg',
      filename: 'pic.jpg',
      size: 2048
    });

    const realCreate = global.chrome.offscreen.createDocument.bind(global.chrome.offscreen);
    global.chrome.offscreen.createDocument = async (options) => {
      await realCreate(options);
      dispatchToBackground({ type: MESSAGE_TYPES.ZIP_OFFSCREEN_READY });
    };

    const realSendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = async (message) => {
      if (message.type === MESSAGE_TYPES.ZIP_BUILD_REQUEST) {
        // 打包请求里只应该出现图片，视频已经单独直下
        expect(message.payload.items.map(item => item.id)).toEqual([image.id]);
        dispatchToBackground({
          type: MESSAGE_TYPES.ZIP_BUILD_RESULT,
          payload: {
            zipName: message.payload.zipName,
            blobUrl: 'blob:mock-mixed',
            succeeded: 1,
            failed: 0,
            succeededIds: [image.id],
            failedItems: []
          }
        });
        return { received: true };
      }
      return { success: true };
    };

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOWNLOAD_ZIP,
      payload: { ids: [video.id, image.id] }
    });

    expect(response).toMatchObject({
      success: true,
      strategy: 'mixed',
      succeeded: 2,
      failed: 0,
      directSucceeded: 1
    });
    expect(response.volumes).toHaveLength(1);
    // 先直下视频、再触发一次 offscreen 打包
    expect(downloadSpy.mock.calls[0][0].url).toBe(video.url);
    expect(downloadSpy.mock.calls[1][0].url).toBe('blob:mock-mixed');
    expect(global.chrome.offscreen._created).toBe(1);
    expect(store.getMediaById(video.id)).toMatchObject({ status: 'downloaded' });
    expect(store.getMediaById(image.id)).toMatchObject({ status: 'downloaded' });

    global.chrome.runtime.sendMessage = realSendMessage;
    global.chrome.offscreen.createDocument = realCreate;
    global.chrome.downloads.download = realDownload;
  });

  test('单次批量下载超过 500 条时应该截断到前 500 条', async () => {
    await store.init();

    // 走 ZIP 路径验证截断：直下路径会真实跑 500 次 mock 下载，超出 5s 测试超时
    const ids = [];
    for (let index = 0; index < 501; index++) {
      const media = store.addMedia({
        url: `https://cdn.example.com/cap/${index}.jpg`,
        filename: `cap-${index}.jpg`,
        size: 1024
      });
      ids.push(media.id);
    }

    const realCreate = global.chrome.offscreen.createDocument.bind(global.chrome.offscreen);
    global.chrome.offscreen.createDocument = async (options) => {
      await realCreate(options);
      dispatchToBackground({ type: MESSAGE_TYPES.ZIP_OFFSCREEN_READY });
    };

    const volumeSizes = [];
    const realSendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = async (message) => {
      if (message.type === MESSAGE_TYPES.ZIP_BUILD_REQUEST) {
        volumeSizes.push(message.payload.items.length);
        dispatchToBackground({
          type: MESSAGE_TYPES.ZIP_BUILD_RESULT,
          payload: {
            zipName: message.payload.zipName,
            blobUrl: `blob:mock-cap-${volumeSizes.length}`,
            succeeded: message.payload.items.length,
            failed: 0,
            succeededIds: message.payload.items.map(item => item.id),
            failedItems: []
          }
        });
        return { received: true };
      }
      return { success: true };
    };

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOWNLOAD_ZIP,
      payload: { ids }
    });

    expect(response).toMatchObject({
      success: true,
      capped: true,
      cappedFrom: 501,
      succeeded: 500,
      failed: 0
    });
    // 三卷合计恰好 500 条，第 501 条未进包
    expect(volumeSizes.reduce((sum, count) => sum + count, 0)).toBe(500);
    expect(store.getMediaById(ids[499])).toMatchObject({ status: 'downloaded' });
    expect(store.getMediaById(ids[500])).toMatchObject({ status: 'pending' });

    global.chrome.runtime.sendMessage = realSendMessage;
    global.chrome.offscreen.createDocument = realCreate;
  });

  test('单次批量不超过上限时不应该带截断标记', async () => {
    await store.init();

    const ids = [
      store.addMedia({ url: 'https://cdn.example.com/small/a.jpg' }),
      store.addMedia({ url: 'https://cdn.example.com/small/b.jpg' }),
      store.addMedia({ url: 'https://cdn.example.com/small/c.jpg' })
    ].map(media => media.id);

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOWNLOAD_ZIP,
      payload: { ids, strategy: 'direct' }
    });

    expect(response).toMatchObject({ success: true, succeeded: 3, failed: 0 });
    expect(response.capped).toBeUndefined();
    expect(response.cappedFrom).toBeUndefined();
  });

  test('PHASH_REQUEST 应该驱动 offscreen 计算并写回指标', async () => {
    await store.init();

    const image = store.addMedia({
      url: 'https://cdn.example.com/images/similar.jpg',
      filename: 'similar.jpg'
    });

    const realCreate = global.chrome.offscreen.createDocument.bind(global.chrome.offscreen);
    global.chrome.offscreen.createDocument = async (options) => {
      await realCreate(options);
      dispatchToBackground({ type: MESSAGE_TYPES.ZIP_OFFSCREEN_READY });
    };

    const broadcasts = [];
    const realSendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = async (message) => {
      if (message.type === MESSAGE_TYPES.PHASH_REQUEST) {
        expect(message.payload.items).toEqual([{ id: image.id, url: image.url }]);
        dispatchToBackground({
          type: MESSAGE_TYPES.PHASH_RESULT,
          payload: { id: image.id, phash: 'abcdef0123456789', sharpness: 42, done: 1, total: 1 }
        });
        return { received: true };
      }
      if (message.type === MESSAGE_TYPES.PHASH_STATE) {
        broadcasts.push(message.payload);
      }
      return { success: true };
    };

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.PHASH_REQUEST,
      payload: { ids: [image.id] }
    });

    expect(response).toEqual({ success: true, total: 1, analyzed: 1, failed: 0, timedOut: false });
    expect(store.getMediaById(image.id)).toMatchObject({ phash: 'abcdef0123456789', sharpness: 42 });
    expect(global.chrome.offscreen._created).toBe(1);
    // 进度先报 running=true，收尾时再报一次 running=false
    expect(broadcasts[0]).toMatchObject({ running: true, done: 1, total: 1 });
    expect(broadcasts.at(-1)).toMatchObject({ running: false, done: 1, total: 1, failed: 0 });

    global.chrome.runtime.sendMessage = realSendMessage;
    global.chrome.offscreen.createDocument = realCreate;
  });

  test('PHASH_REQUEST 只应该接受图片', async () => {
    await store.init();
    const video = store.addMedia({
      mediaType: 'video',
      url: 'https://cdn.example.com/v/clip.mp4',
      filename: 'clip.mp4'
    });

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.PHASH_REQUEST,
      payload: { ids: [video.id] }
    });

    expect(response.success).toBe(false);
    expect(response.error).toBeTruthy();
    // 没有可分析的图片时不应该白创建 offscreen 文档
    expect(global.chrome.offscreen._created).toBe(0);
  });

  test('已有分析进行中时应该拒绝新请求', async () => {
    await store.init();
    const image = store.addMedia({ url: 'https://cdn.example.com/images/pending.jpg' });

    const realCreate = global.chrome.offscreen.createDocument.bind(global.chrome.offscreen);
    global.chrome.offscreen.createDocument = async (options) => {
      await realCreate(options);
      dispatchToBackground({ type: MESSAGE_TYPES.ZIP_OFFSCREEN_READY });
    };

    const realSendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = async () => ({ received: true });

    const first = sendBackgroundMessage({
      type: MESSAGE_TYPES.PHASH_REQUEST,
      payload: { ids: [image.id] }
    });
    // 等第一次请求完成 offscreen 准备并挂起
    await sleep(0);

    const second = await sendBackgroundMessage({
      type: MESSAGE_TYPES.PHASH_REQUEST,
      payload: { ids: [image.id] }
    });

    expect(second.success).toBe(false);
    expect(second.error).toBeTruthy();

    // 收尾第一次请求，避免留下悬挂的定时器
    dispatchToBackground({
      type: MESSAGE_TYPES.PHASH_RESULT,
      payload: { id: image.id, phash: 'ffffffffffffffff', sharpness: 7 }
    });
    await expect(first).resolves.toMatchObject({ success: true, analyzed: 1 });

    global.chrome.runtime.sendMessage = realSendMessage;
    global.chrome.offscreen.createDocument = realCreate;
  });

  test('计算失败的条目应该计入失败且不影响其它条目', async () => {
    await store.init();

    const ok = store.addMedia({ url: 'https://cdn.example.com/images/ok.jpg' });
    const bad = store.addMedia({ url: 'https://cdn.example.com/images/bad.jpg' });

    const realCreate = global.chrome.offscreen.createDocument.bind(global.chrome.offscreen);
    global.chrome.offscreen.createDocument = async (options) => {
      await realCreate(options);
      dispatchToBackground({ type: MESSAGE_TYPES.ZIP_OFFSCREEN_READY });
    };

    const realSendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = async (message) => {
      if (message.type === MESSAGE_TYPES.PHASH_REQUEST) {
        dispatchToBackground({
          type: MESSAGE_TYPES.PHASH_RESULT,
          payload: { id: ok.id, phash: 'abcdef0123456789', sharpness: 12, done: 1, total: 2 }
        });
        dispatchToBackground({
          type: MESSAGE_TYPES.PHASH_RESULT,
          payload: { id: bad.id, error: 'HTTP 403', done: 2, total: 2 }
        });
        return { received: true };
      }
      return { success: true };
    };

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.PHASH_REQUEST,
      payload: { ids: [ok.id, bad.id] }
    });

    expect(response).toEqual({ success: true, total: 2, analyzed: 1, failed: 1, timedOut: false });
    expect(store.getMediaById(ok.id)).toMatchObject({ phash: 'abcdef0123456789', sharpness: 12 });
    expect(store.getMediaById(bad.id).phash).toBe('');

    global.chrome.runtime.sendMessage = realSendMessage;
    global.chrome.offscreen.createDocument = realCreate;
  });

  describe('增长功能（V16-04）', () => {
    function spyDownloads() {
      const realDownload = global.chrome.downloads.download;
      const spy = jest.fn(realDownload.bind(global.chrome.downloads));
      global.chrome.downloads.download = spy;
      return { spy, restore: () => { global.chrome.downloads.download = realDownload; } };
    }

    test('捕获到新媒体应该更新角标，超过 999 显示 999+', async () => {
      await store.init();
      await store.saveSettings({ enabled: true });
      const sendMessage = global.chrome.runtime.sendMessage;
      global.chrome.runtime.sendMessage = jest.fn(async () => ({ success: true }));

      await onRequestCompleted({
        type: 'image',
        url: 'https://cdn.example.com/assets/badge.jpg',
        tabId: 7,
        responseHeaders: [{ name: 'Content-Type', value: 'image/jpeg' }]
      });
      expect(global.chrome.action._badgeText).toBe('1');

      store.stats.unread = 999;
      await onRequestCompleted({
        type: 'image',
        url: 'https://cdn.example.com/assets/badge-2.jpg',
        tabId: 7,
        responseHeaders: [{ name: 'Content-Type', value: 'image/jpeg' }]
      });
      expect(global.chrome.action._badgeText).toBe('999+');

      global.chrome.runtime.sendMessage = sendMessage;
    });

    test('MARK_CAPTURED_READ 应该清零未读并清空角标', async () => {
      await store.init();
      store.addMedia({ url: 'https://cdn.example.com/images/unread.jpg' });
      expect(store.getStats().unread).toBe(1);

      const response = await sendBackgroundMessage({ type: MESSAGE_TYPES.MARK_CAPTURED_READ });

      expect(response).toEqual({ success: true, unread: 0 });
      expect(store.getStats().unread).toBe(0);
      expect(global.chrome.action._badgeText).toBe('');
    });

    test('清空列表应该同时清空格标', async () => {
      await store.init();
      store.addMedia({ url: 'https://cdn.example.com/images/to-clear.jpg' });
      global.chrome.action._badgeText = '1';

      await sendBackgroundMessage({ type: MESSAGE_TYPES.CLEAR_IMAGES });

      expect(global.chrome.action._badgeText).toBe('');
      expect(store.getStats().unread).toBe(0);
    });

    test('右键「下载此图」应该入库并立即下载', async () => {
      await store.init();
      await store.saveSettings({ enabled: true });
      const { spy, restore } = spyDownloads();
      const realSendMessage = global.chrome.runtime.sendMessage;
      const sendMessage = jest.fn(async () => ({ success: true }));
      global.chrome.runtime.sendMessage = sendMessage;

      global.chrome.contextMenus._trigger(
        {
          menuItemId: 'open-download-image',
          srcUrl: 'https://cdn.example.com/pic/hero.jpg',
          pageUrl: 'https://example.com/page'
        },
        { title: 'Example Page' }
      );
      await sleep(200);

      expect(store.getImages()).toHaveLength(1);
      expect(store.getImages()[0]).toMatchObject({
        source: 'dom',
        mediaType: 'image',
        url: 'https://cdn.example.com/pic/hero.jpg',
        tabUrl: 'https://example.com/page',
        tabTitle: 'Example Page'
      });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].url).toBe('https://cdn.example.com/pic/hero.jpg');
      expect(sendMessage).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.MEDIA_FOUND,
        payload: store.getImages()[0]
      });

      global.chrome.runtime.sendMessage = realSendMessage;
      restore();
    });

    test('右键「下载此图」对已存在的资源应该复用记录而不重复入库', async () => {
      await store.init();
      await store.saveSettings({ enabled: true });
      const existing = store.addMedia({
        url: 'https://cdn.example.com/pic/dup.jpg',
        filename: 'dup.jpg'
      });
      const { spy, restore } = spyDownloads();

      global.chrome.contextMenus._trigger(
        {
          menuItemId: 'open-download-image',
          srcUrl: 'https://cdn.example.com/pic/dup.jpg',
          pageUrl: 'https://example.com/page'
        },
        {}
      );
      await sleep(200);

      expect(store.getImages()).toHaveLength(1);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(store.getImageById(existing.id)).toMatchObject({ status: 'downloaded' });

      restore();
    });

    test('右键「下载此图」对 blob:/data: 资源应该跳过', async () => {
      await store.init();
      await store.saveSettings({ enabled: true });
      const { spy, restore } = spyDownloads();

      global.chrome.contextMenus._trigger(
        { menuItemId: 'open-download-image', srcUrl: 'blob:https://example.com/6f1c', pageUrl: 'https://example.com/' },
        {}
      );
      global.chrome.contextMenus._trigger(
        { menuItemId: 'open-download-image', srcUrl: 'data:image/png;base64,iVBORw0KGgo', pageUrl: 'https://example.com/' },
        {}
      );
      await sleep(50);

      expect(store.getImages()).toHaveLength(0);
      expect(spy).not.toHaveBeenCalled();

      restore();
    });

    test('站点被暂停时右键下载应该只下载不入库', async () => {
      await store.init();
      await store.saveSettings({ enabled: true, siteRules: { 'example.com': 'block' } });
      const { spy, restore } = spyDownloads();

      global.chrome.contextMenus._trigger(
        {
          menuItemId: 'open-download-image',
          srcUrl: 'https://cdn.example.com/pic/paused.jpg',
          pageUrl: 'https://example.com/page'
        },
        {}
      );
      await sleep(200);

      expect(store.getImages()).toHaveLength(0);
      expect(spy).toHaveBeenCalledTimes(1);

      restore();
    });

    test('快捷键 toggle-listening 应该切换监听并广播状态', async () => {
      await store.init();
      const realSendMessage = global.chrome.runtime.sendMessage;
      const sendMessage = jest.fn(async () => ({ success: true }));
      global.chrome.runtime.sendMessage = sendMessage;

      global.chrome.commands._trigger('toggle-listening');
      await sleep(20);
      expect(store.getSettings().enabled).toBe(true);
      expect(sendMessage).toHaveBeenCalledWith({
        type: MESSAGE_TYPES.TOGGLE_LISTENING,
        payload: { enabled: true }
      });

      global.chrome.commands._trigger('toggle-listening');
      await sleep(20);
      expect(store.getSettings().enabled).toBe(false);

      global.chrome.runtime.sendMessage = realSendMessage;
    });

    test('快捷键 scroll-capture 应该路由到活动标签页', async () => {
      await store.init();
      global.chrome.tabs._setActiveTab({ id: 88, url: 'https://example.com/list', title: 'List' });

      global.chrome.commands._trigger('scroll-capture');
      await sleep(20);

      expect(global.chrome.tabs._sentMessages).toEqual([
        { tabId: 88, message: { type: MESSAGE_TYPES.SCROLL_CAPTURE_START } }
      ]);
    });

    test('未知快捷键命令应该被忽略', async () => {
      await store.init();

      global.chrome.commands._trigger('not-a-command');
      await sleep(10);

      expect(store.getSettings().enabled).toBe(false);
    });
  });

  test('DOWNLOAD_ZIP 应该在 offscreen 打包并触发下载', async () => {
    await store.init();
    await store.saveSettings({ savePath: 'OpenDownload' });
    const media = store.addMedia({
      url: 'https://cdn.example.com/images/photo.jpg',
      filename: 'photo.jpg',
      domain: 'cdn.example.com'
    });

    // 模拟 offscreen 文档：创建完成后发送就绪握手
    const realCreate = global.chrome.offscreen.createDocument.bind(global.chrome.offscreen);
    global.chrome.offscreen.createDocument = async (options) => {
      await realCreate(options);
      dispatchToBackground({ type: MESSAGE_TYPES.ZIP_OFFSCREEN_READY });
    };

    const realDownload = global.chrome.downloads.download;
    const downloadSpy = jest.fn(realDownload.bind(global.chrome.downloads));
    global.chrome.downloads.download = downloadSpy;

    const realSendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = async (message) => {
      if (message.type === MESSAGE_TYPES.ZIP_BUILD_REQUEST) {
        // 模拟 offscreen 文档：回发打包结果
        dispatchToBackground({
          type: MESSAGE_TYPES.ZIP_BUILD_RESULT,
          payload: {
            zipName: message.payload.zipName,
            blobUrl: 'blob:mock-zip',
            succeeded: 1,
            failed: 0,
            succeededIds: message.payload.items.map(item => item.id),
            failedItems: []
          }
        });
        return { received: true };
      }
      return { success: true };
    };

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOWNLOAD_ZIP,
      payload: { ids: [media.id] }
    });

    expect(response).toMatchObject({ success: true, succeeded: 1, failed: 0 });
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    const downloadOptions = downloadSpy.mock.calls[0][0];
    expect(downloadOptions.url).toBe('blob:mock-zip');
    expect(downloadOptions.filename).toMatch(/^OpenDownload\/open-download-\d{8}-\d{6}\.zip$/);
    expect(store.getMediaById(media.id)).toMatchObject({ status: 'downloaded' });
    expect(global.chrome.offscreen._created).toBe(1);
    expect(global.chrome.offscreen._closed).toBe(1);

    global.chrome.runtime.sendMessage = realSendMessage;
    global.chrome.downloads.download = realDownload;
    global.chrome.offscreen.createDocument = realCreate;
  });

  test('DOWNLOAD_ZIP 打包全部失败时应该返回错误', async () => {
    await store.init();
    const media = store.addMedia({
      url: 'https://cdn.example.com/images/photo.jpg',
      filename: 'photo.jpg',
      domain: 'cdn.example.com'
    });

    const realCreate = global.chrome.offscreen.createDocument.bind(global.chrome.offscreen);
    global.chrome.offscreen.createDocument = async (options) => {
      await realCreate(options);
      dispatchToBackground({ type: MESSAGE_TYPES.ZIP_OFFSCREEN_READY });
    };

    const realSendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = async (message) => {
      if (message.type === MESSAGE_TYPES.ZIP_BUILD_REQUEST) {
        dispatchToBackground({
          type: MESSAGE_TYPES.ZIP_BUILD_RESULT,
          payload: { error: '所有资源打包失败' }
        });
        return { received: true };
      }
      return { success: true };
    };

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.DOWNLOAD_ZIP,
      payload: { ids: [media.id] }
    });

    expect(response).toEqual({ success: false, error: '所有资源打包失败' });
    expect(store.getMediaById(media.id)).toMatchObject({ status: 'pending' });
    expect(global.chrome.downloads._downloads.size).toBe(0);

    global.chrome.runtime.sendMessage = realSendMessage;
    global.chrome.offscreen.createDocument = realCreate;
  });
});
