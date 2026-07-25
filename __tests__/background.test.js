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
      url: 'https://cdn.example.com/assets/photo.jpg',
      filename: 'photo.jpg',
      domain: 'cdn.example.com',
      mimeType: 'image/jpeg',
      size: 2048,
      tabUrl: 'https://example.com',
      tabTitle: 'Example Page'
    });
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: MESSAGE_TYPES.IMAGE_FOUND,
      payload: images[0]
    });

    global.chrome.runtime.sendMessage = sendMessage;
  });
});
