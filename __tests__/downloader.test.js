/**
 * lib/downloader.js 单元测试
 */

import { DownloadManager } from '../src/lib/downloader.js';
import { sleep } from '../src/lib/utils.js';

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
      expect(downloader.activeDownloads).toBeInstanceOf(Map);
      expect(downloader.activeDownloads.size).toBe(0);
      expect(downloader.cancelRequested).toBe(false);
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

  describe('下载超时与并发压制（V15-01 大文件直下）', () => {
    test('setDownloadTimeout 应该接受合法值并对非法值回落 120s', () => {
      expect(downloader.downloadTimeout).toBe(120000);

      downloader.setDownloadTimeout(1800000);
      expect(downloader.downloadTimeout).toBe(1800000);

      downloader.setDownloadTimeout(0);
      expect(downloader.downloadTimeout).toBe(120000);

      downloader.setDownloadTimeout('abc');
      expect(downloader.downloadTimeout).toBe(120000);
    });

    test('downloadBatch 的 maxConcurrency 只向下压制，不能超过用户设置', async () => {
      await downloader.downloadBatch([], { maxConcurrency: 2 });
      expect(downloader.maxConcurrency).toBe(2);

      await downloader.downloadBatch([], { maxConcurrency: 9 });
      expect(downloader.maxConcurrency).toBe(3);

      await downloader.downloadBatch([]);
      expect(downloader.maxConcurrency).toBe(3);
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
      expect(downloader.activeDownloads.size).toBe(0);
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

      try {
        const result = await downloader.downloadImage(image);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Download failed');
      } finally {
        global.chrome.downloads.download = originalDownload;
      }
    });

    test('下载失败时应该把失败原因写回 store', async () => {
      const statusCalls = [];
      mockStore.updateImageStatus = (id, status, errorMsg = '') => statusCalls.push({ id, status, errorMsg });

      const image = {
        id: 'test-id-3',
        url: 'https://invalid-url.com/image.jpg',
        filename: 'image.jpg',
        domain: 'invalid-url.com'
      };

      const originalDownload = global.chrome.downloads.download;
      global.chrome.downloads.download = async () => {
        throw new Error('HTTP 403');
      };

      try {
        await downloader.downloadImage(image);

        expect(statusCalls).toEqual([
          { id: 'test-id-3', status: 'downloading', errorMsg: '' },
          { id: 'test-id-3', status: 'failed', errorMsg: 'HTTP 403' }
        ]);
      } finally {
        global.chrome.downloads.download = originalDownload;
      }
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

    test('视频条目 sequential 命名应该使用 video_ 前缀并按 MIME 兜底扩展名', async () => {
      mockStore.getSettings = () => ({
        concurrency: 1,
        fileNaming: 'sequential',
        savePath: 'OpenDownload'
      });

      const images = [
        { id: 'vid-1', url: 'https://a.com/clip', filename: 'clip', domain: 'a.com', mediaType: 'video', mimeType: 'video/mp4' }
      ];

      await downloader.downloadBatch(images);

      const filenames = Array.from(global.chrome.downloads._downloads.values())
        .map(download => download.filename);

      expect(filenames).toEqual(['OpenDownload/video_0000.mp4']);
    });
  });

  describe('取消下载', () => {
    test('无活动下载时 cancelAll 应该触发 cancelled 事件', async () => {
      const callback = jest.fn();
      downloader.on(callback);

      await downloader.cancelAll();

      expect(callback).toHaveBeenCalledWith('cancelled', {});
      expect(downloader.cancelRequested).toBe(true);
    });

    test('cancelOne 应该取消进行中的下载并将状态回退为 pending', async () => {
      const statusCalls = [];
      mockStore.updateImageStatus = (id, status) => statusCalls.push(status);

      const image = {
        id: 'cancel-1',
        url: 'https://example.com/x.jpg',
        filename: 'x.jpg',
        domain: 'example.com'
      };

      const downloadPromise = downloader.downloadImage(image);
      await sleep(10); // 等待 downloadId 产生

      const downloadId = Number(global.chrome.downloads._downloads.keys().next().value);
      expect(downloader.activeDownloads.get('cancel-1')).toBe(downloadId);

      const cancelled = await downloader.cancelOne('cancel-1');
      expect(cancelled).toBe(true);

      const result = await downloadPromise;
      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
      expect(statusCalls).toEqual(['downloading', 'pending']);
      expect(downloader.activeDownloads.has('cancel-1')).toBe(false);
    });

    test('cancelOne 对无活动下载的条目应该返回 false', async () => {
      const cancelled = await downloader.cancelOne('not-exists');
      expect(cancelled).toBe(false);
    });

    test('下载中断（非用户取消）应该标记为 failed', async () => {
      const statusCalls = [];
      mockStore.updateImageStatus = (id, status) => statusCalls.push(status);

      const image = {
        id: 'interrupt-1',
        url: 'https://example.com/y.jpg',
        filename: 'y.jpg',
        domain: 'example.com'
      };

      const downloadPromise = downloader.downloadImage(image);
      await sleep(10);

      const downloadId = Number(global.chrome.downloads._downloads.keys().next().value);
      global.chrome.downloads._simulateError(downloadId);

      const result = await downloadPromise;
      expect(result.success).toBe(false);
      expect(result.cancelled).toBeUndefined();
      expect(statusCalls).toEqual(['downloading', 'failed']);
    });

    test('cancelAll 应该取消所有进行中的下载并停止批量队列', async () => {
      mockStore.getSettings = () => ({
        concurrency: 1,
        fileNaming: 'original',
        savePath: 'OpenDownload'
      });

      const images = Array.from({ length: 4 }, (_, i) => ({
        id: `batch-cancel-${i}`,
        url: `https://a.com/${i}.jpg`,
        filename: `${i}.jpg`,
        domain: 'a.com'
      }));

      const callback = jest.fn();
      downloader.on(callback);

      const batchPromise = downloader.downloadBatch(images);
      await sleep(10);

      await downloader.cancelAll();
      const results = await batchPromise;

      // 取消后队列停止，未全部跑完
      expect(results.length).toBeLessThan(images.length);
      expect(callback).toHaveBeenCalledWith('cancelled', {});
      expect(downloader.activeDownloads.size).toBe(0);
      // 后续批次不再被旧标志位阻塞
      expect(downloader.cancelRequested).toBe(false);
    });
  });
});
