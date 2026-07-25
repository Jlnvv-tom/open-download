/**
 * background/index.js 单元测试
 */

import { DEFAULT_SETTINGS, MESSAGE_TYPES } from '../src/lib/constants.js';
import { store } from '../src/lib/store.js';
import {
  handleRuntimeMessage,
  onRequestCompleted,
  startListening,
  stopListening
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
  store.stats = { total: 0, downloaded: 0, failed: 0 };
  store._loaded = false;
}

function sendBackgroundMessage(message) {
  return new Promise(resolve => {
    handleRuntimeMessage(message, {}, resolve);
  });
}

describe('background message handler', () => {
  let consoleLog;

  beforeEach(() => {
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    stopListening();
    resetStoreSingleton();
  });

  afterEach(() => {
    consoleLog.mockRestore();
  });

  test('应该处理 Content Script 图片尺寸更新并写回 Store', async () => {
    await store.init();
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
            url: 'https://cdn.example.com/images/photo.jpg?cache=2',
            width: 1024,
            height: 768,
            alt: '产品图'
          }
        ]
      }
    });

    expect(response).toEqual({ success: true, updated: 1 });
    expect(store.getImageById(image.id)).toMatchObject({
      width: 1024,
      height: 768,
      alt: '产品图'
    });
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

    startListening();
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

    startListening();
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
});
