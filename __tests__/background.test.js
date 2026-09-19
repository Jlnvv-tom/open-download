/**
 * background/index.js 单元测试
 */

import { DEFAULT_SETTINGS, MESSAGE_TYPES } from '../src/lib/constants.js';
import { store } from '../src/lib/store.js';
import { sleep } from '../src/lib/utils.js';
import {
  handleRuntimeMessage,
  onRequestCompleted
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
  store.stats = { total: 0, downloaded: 0, failed: 0, truncated: 0 };
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

  test('应该处理 Content Script 图片尺寸更新并写回 Store', async () => {
    await store.init();
    const sendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn(async () => ({ success: true }));

    const image = store.addImage({
      url: 'https://cdn.example.com/images/photo.jpg?cache=1',
      filename: 'photo.jpg',
      domain: 'cdn.example.com'
    });

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.CONTENT_IMAGES_UPDATE,
      payload: {
        images: [
          {
            url: 'https://cdn.example.com/images/photo.jpg?cache=1',
            width: 1024,
            height: 768,
            alt: '产品图',
            previewUrl: 'https://cdn.example.com/images/photo-large.jpg'
          }
        ]
      }
    });

    expect(response).toEqual({ success: true, updated: 1 });
    expect(store.getImageById(image.id)).toMatchObject({
      width: 1024,
      height: 768,
      alt: '产品图',
      previewUrl: 'https://cdn.example.com/images/photo-large.jpg'
    });
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.MEDIA_DETAILS_UPDATED,
      payload: { images: store.getImages() }
    });

    global.chrome.runtime.sendMessage = sendMessage;
  });

  test('Content Script 没有匹配更新时不应该广播媒体详情', async () => {
    await store.init();
    const sendMessage = global.chrome.runtime.sendMessage;
    global.chrome.runtime.sendMessage = jest.fn(async () => ({ success: true }));

    const response = await sendBackgroundMessage({
      type: MESSAGE_TYPES.CONTENT_IMAGES_UPDATE,
      payload: {
        images: [
          {
            url: 'https://cdn.example.com/images/unknown.jpg',
            width: 320,
            height: 240
          }
        ]
      }
    });

    expect(response).toEqual({ success: true, updated: 0 });
    expect(global.chrome.runtime.sendMessage).not.toHaveBeenCalled();

    global.chrome.runtime.sendMessage = sendMessage;
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
