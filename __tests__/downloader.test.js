/**
 * lib/downloader.js 单元测试
 */

import { DownloadManager } from '../src/lib/downloader.js';

describe('DownloadManager', () => {
  let downloader;
  let mockStore;

  beforeEach(() => {
    mockStore = {
      getSettings: () => ({
        concurrency: 3,
        fileNaming: 'original',
        savePath: 'OpenDownload'
      }),
      updateImageStatus: () => {}
    };

    downloader = new DownloadManager(mockStore);
    global.chrome.downloads._reset();
  });

  describe('初始化', () => {
    test('应该正确初始化', () => {
      expect(downloader.maxConcurrency).toBe(3);
      expect(downloader.queue).toEqual([]);
      expect(downloader.active).toBe(0);
    });
  });

  describe('并发控制', () => {
    test('应该设置并发数（范围 1-10）', () => {
      downloader.setConcurrency(5);
      expect(downloader.maxConcurrency).toBe(5);

      downloader.setConcurrency(0);
      expect(downloader.maxConcurrency).toBe(1);

      downloader.setConcurrency(15);
      expect(downloader.maxConcurrency).toBe(10);
    });
  });

  describe('事件系统', () => {
    test('应该注册和触发事件监听器', () => {
      const callback = jest.fn();
      const unsubscribe = downloader.on(callback);

      downloader._emit('test', { message: 'hello' });

      expect(callback).toHaveBeenCalledWith('test', { message: 'hello' });

      unsubscribe();
    });

    test('应该支持多个监听器', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      downloader.on(callback1);
      downloader.on(callback2);

      downloader._emit('event', { data: 'test' });

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });
  });

  describe('单个下载', () => {
    test('应该成功下载图片', async () => {
      const image = {
        id: 'test-id-1',
        url: 'https://example.com/test.jpg',
        filename: 'test.jpg',
        domain: 'example.com'
      };

      const result = await downloader.downloadImage(image);

      expect(result.success).toBe(true);
      expect(result.downloadId).toBeDefined();
    });

    test('应该处理下载失败', async () => {
      const image = {
        id: 'test-id-2',
        url: 'https://invalid-url.com/image.jpg',
        filename: 'image.jpg',
        domain: 'invalid-url.com'
      };

      const originalDownload = global.chrome.downloads.download;
      global.chrome.downloads.download = async () => {
        throw new Error('Download failed');
      };

      const result = await downloader.downloadImage(image);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Download failed');

      global.chrome.downloads.download = originalDownload;
    });
  });

  describe('批量下载', () => {
    test('应该批量下载多个图片', async () => {
      const images = [
        { id: 'batch-1', url: 'https://a.com/1.jpg', filename: '1.jpg', domain: 'a.com' },
        { id: 'batch-2', url: 'https://a.com/2.jpg', filename: '2.jpg', domain: 'a.com' }
      ];

      const results = await downloader.downloadBatch(images);

      expect(results.length).toBe(2);
      expect(results.every(r => r.success)).toBe(true);
    });

    test('应该触发 batch-complete 事件', async () => {
      const callback = jest.fn();
      downloader.on(callback);

      const images = [
        { id: 'batch-event-1', url: 'https://a.com/1.jpg', filename: '1.jpg', domain: 'a.com' }
      ];

      await downloader.downloadBatch(images);

      expect(callback).toHaveBeenCalledWith('batch-complete', expect.any(Object));
    });

    test('sequential 命名策略应该按批量列表序号生成文件名', async () => {
      mockStore.getSettings = () => ({
        concurrency: 2,
        fileNaming: 'sequential',
        savePath: 'OpenDownload'
      });

      const images = [
        { id: 'seq-1', url: 'https://a.com/first', filename: 'first', domain: 'a.com' },
        { id: 'seq-2', url: 'https://a.com/second.png', filename: 'second.png', domain: 'a.com' },
        { id: 'seq-3', url: 'https://a.com/third.webp', filename: 'third.webp', domain: 'a.com' }
      ];

      await downloader.downloadBatch(images);

      const filenames = Array.from(global.chrome.downloads._downloads.values())
        .map(download => download.filename)
        .sort();

      expect(filenames).toEqual([
        'OpenDownload/img_0000.jpg',
        'OpenDownload/img_0001.png',
        'OpenDownload/img_0002.webp'
      ]);
    });
  });

  describe('取消下载', () => {
    test('应该清空队列', () => {
      const callback = jest.fn();
      downloader.on(callback);

      downloader.cancelAll();

      expect(downloader.queue).toEqual([]);
      expect(callback).toHaveBeenCalledWith('cancelled', {});
    });
  });

});
