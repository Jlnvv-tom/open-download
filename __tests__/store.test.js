/**
 * lib/store.js 单元测试
 */

import { ImageStore, store } from '../src/lib/store.js';

describe('ImageStore', () => {
  let testStore;

  beforeEach(() => {
    testStore = new ImageStore();
    global.chrome.storage.local._reset();
  });

  describe('初始化', () => {
    test('应该正确初始化', async () => {
      await testStore.init();
      expect(testStore._loaded).toBe(true);
    });

    test('多次调用 init() 只加载一次', async () => {
      await testStore.init();
      await testStore.init();
      expect(testStore._loaded).toBe(true);
    });
  });

  describe('设置管理', () => {
    beforeEach(async () => {
      await testStore.init();
    });

    test('应该加载默认设置', async () => {
      const settings = testStore.getSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.autoDownload).toBe(false);
      expect(settings.concurrency).toBe(3);
      expect(settings.dedupe).toBe(true);
    });

    test('应该保存和加载设置', async () => {
      await testStore.saveSettings({ enabled: true, concurrency: 5 });
      const settings = testStore.getSettings();
      expect(settings.enabled).toBe(true);
      expect(settings.concurrency).toBe(5);
    });

    test('应该合并部分设置', async () => {
      await testStore.saveSettings({ minImageSize: 10240 });
      const settings = testStore.getSettings();
      expect(settings.minImageSize).toBe(10240);
      expect(settings.concurrency).toBe(3);
    });

    test('应该深度合并过滤设置并保留默认尺寸配置', async () => {
      await testStore.saveSettings({
        filters: {
          domains: ['example.com']
        }
      });

      const settings = testStore.getSettings();
      expect(settings.filters.domains).toEqual(['example.com']);
      expect(settings.filters.extensions).toEqual([]);
      expect(settings.filters.minDimensions).toEqual({ width: 0, height: 0 });
    });
  });

  describe('图片管理', () => {
    beforeEach(async () => {
      await testStore.init();
    });

    test('应该添加图片', () => {
      const image = testStore.addImage({
        url: 'https://example.com/test.jpg',
        filename: 'test.jpg',
        domain: 'example.com',
        mimeType: 'image/jpeg',
        size: 50000
      });

      expect(image).toBeDefined();
      expect(image.id).toBeDefined();
      expect(image.url).toBe('https://example.com/test.jpg');
      expect(image.status).toBe('pending');
      expect(image.downloaded).toBe(false);
    });

    test('应该生成唯一 ID', () => {
      const image1 = testStore.addImage({
        url: 'https://example.com/1.jpg',
        filename: '1.jpg'
      });
      const image2 = testStore.addImage({
        url: 'https://example.com/2.jpg',
        filename: '2.jpg'
      });

      expect(image1.id).not.toBe(image2.id);
    });

    test('应该去重（当 dedupe 为 true）', async () => {
      await testStore.saveSettings({ dedupe: true });

      const image1 = testStore.addImage({
        url: 'https://example.com/same.jpg',
        filename: 'same.jpg'
      });
      const image2 = testStore.addImage({
        url: 'https://example.com/same.jpg?query=123',
        filename: 'same.jpg'
      });

      expect(image1).toBeDefined();
      expect(image2).toBeNull();
      expect(testStore.getImages().length).toBe(1);
    });

    test('应该不去重（当 dedupe 为 false）', async () => {
      await testStore.saveSettings({ dedupe: false });

      testStore.addImage({
        url: 'https://example.com/test.jpg',
        filename: 'test.jpg'
      });
      testStore.addImage({
        url: 'https://example.com/test.jpg',
        filename: 'test.jpg'
      });

      expect(testStore.getImages().length).toBe(2);
    });

    test('应该移除图片', () => {
      const image = testStore.addImage({
        url: 'https://example.com/remove.jpg',
        filename: 'remove.jpg'
      });

      expect(testStore.getImages().length).toBe(1);

      testStore.removeImage(image.id);
      expect(testStore.getImages().length).toBe(0);
      expect(testStore.getImageById(image.id)).toBeUndefined();
    });

    test('应该清空所有图片', () => {
      testStore.addImage({ url: 'https://example.com/1.jpg', filename: '1.jpg' });
      testStore.addImage({ url: 'https://example.com/2.jpg', filename: '2.jpg' });

      expect(testStore.getImages().length).toBe(2);

      testStore.clearAll();
      expect(testStore.getImages().length).toBe(0);
      const stats = testStore.getStats();
      expect(stats.total).toBe(0);
    });
  });

  describe('状态更新', () => {
    beforeEach(async () => {
      await testStore.init();
    });

    test('应该更新图片状态为 downloaded', () => {
      const image = testStore.addImage({
        url: 'https://example.com/test.jpg',
        filename: 'test.jpg'
      });

      testStore.updateImageStatus(image.id, 'downloaded');

      const updated = testStore.getImageById(image.id);
      expect(updated.status).toBe('downloaded');
      expect(updated.downloaded).toBe(true);

      const stats = testStore.getStats();
      expect(stats.downloaded).toBe(1);
    });

    test('应该更新图片状态为 failed', () => {
      const image = testStore.addImage({
        url: 'https://example.com/test.jpg',
        filename: 'test.jpg'
      });

      testStore.updateImageStatus(image.id, 'failed');

      const updated = testStore.getImageById(image.id);
      expect(updated.status).toBe('failed');

      const stats = testStore.getStats();
      expect(stats.failed).toBe(1);
    });

    test('重复设置相同终态不应该重复累计统计', () => {
      const image = testStore.addImage({
        url: 'https://example.com/test.jpg',
        filename: 'test.jpg'
      });

      testStore.updateImageStatus(image.id, 'downloaded');
      testStore.updateImageStatus(image.id, 'downloaded');
      testStore.updateImageStatus(image.id, 'failed');
      testStore.updateImageStatus(image.id, 'failed');

      const stats = testStore.getStats();
      expect(stats.downloaded).toBe(1);
      expect(stats.failed).toBe(1);
    });
  });

  describe('尺寸信息补充', () => {
    beforeEach(async () => {
      await testStore.init();
    });

    test('应该根据 URL 去重 key 更新图片尺寸和 alt', () => {
      const image = testStore.addImage({
        url: 'https://cdn.example.com/path/photo.jpg?cache=1',
        filename: 'photo.jpg'
      });

      const updated = testStore.updateImageDetailsByUrl('https://cdn.example.com/path/photo.jpg?cache=2', {
        width: 800,
        height: 600,
        alt: '封面图'
      });

      expect(updated).toBe(1);
      expect(testStore.getImageById(image.id)).toMatchObject({
        width: 800,
        height: 600,
        alt: '封面图'
      });
    });

    test('未知 URL 不应该更新任何图片', () => {
      testStore.addImage({
        url: 'https://cdn.example.com/path/photo.jpg',
        filename: 'photo.jpg'
      });

      const updated = testStore.updateImageDetailsByUrl('https://other.example.com/photo.jpg', {
        width: 320,
        height: 240
      });

      expect(updated).toBe(0);
    });
  });

  describe('过滤功能', () => {
    beforeEach(async () => {
      await testStore.init();
    });

    test('应该按域名过滤', () => {
      testStore.addImage({ url: 'https://a.com/1.jpg', filename: '1.jpg', domain: 'a.com' });
      testStore.addImage({ url: 'https://b.com/2.jpg', filename: '2.jpg', domain: 'b.com' });

      const filtered = testStore.getFilteredImages({ domains: ['a.com'] });
      expect(filtered.length).toBe(1);
      expect(filtered[0].domain).toBe('a.com');
    });

    test('应该按扩展名过滤', () => {
      testStore.addImage({ url: 'https://a.com/1.jpg', filename: '1.jpg' });
      testStore.addImage({ url: 'https://a.com/2.png', filename: '2.png' });

      const filtered = testStore.getFilteredImages({ extensions: ['.png'] });
      expect(filtered.length).toBe(1);
      expect(filtered[0].filename).toBe('2.png');
    });

    test('应该按最小大小过滤', () => {
      testStore.addImage({ url: 'https://a.com/1.jpg', filename: '1.jpg', size: 1000 });
      testStore.addImage({ url: 'https://a.com/2.jpg', filename: '2.jpg', size: 5000 });

      const filtered = testStore.getFilteredImages({ minSize: 2000 });
      expect(filtered.length).toBe(1);
      expect(filtered[0].size).toBe(5000);
    });

    test('应该按搜索关键词过滤', () => {
      testStore.addImage({ url: 'https://a.com/photo.jpg', filename: 'photo.jpg', domain: 'a.com' });
      testStore.addImage({ url: 'https://b.com/avatar.png', filename: 'avatar.png', domain: 'b.com' });

      const filtered = testStore.getFilteredImages({ search: 'photo' });
      expect(filtered.length).toBe(1);
      expect(filtered[0].filename).toBe('photo.jpg');
    });

    test('应该组合多个过滤条件', () => {
      testStore.addImage({
        url: 'https://a.com/photo.jpg',
        filename: 'photo.jpg',
        domain: 'a.com',
        size: 10000
      });
      testStore.addImage({
        url: 'https://a.com/small.jpg',
        filename: 'small.jpg',
        domain: 'a.com',
        size: 1000
      });

      const filtered = testStore.getFilteredImages({
        domains: ['a.com'],
        minSize: 5000
      });

      expect(filtered.length).toBe(1);
      expect(filtered[0].filename).toBe('photo.jpg');
    });
  });

  describe('统计功能', () => {
    beforeEach(async () => {
      await testStore.init();
    });

    test('应该正确统计总数', () => {
      testStore.addImage({ url: 'https://a.com/1.jpg', filename: '1.jpg' });
      testStore.addImage({ url: 'https://a.com/2.jpg', filename: '2.jpg' });

      const stats = testStore.getStats();
      expect(stats.total).toBe(2);
    });

    test('应该正确统计下载数', () => {
      const image = testStore.addImage({ url: 'https://a.com/1.jpg', filename: '1.jpg' });
      testStore.updateImageStatus(image.id, 'downloaded');

      const stats = testStore.getStats();
      expect(stats.downloaded).toBe(1);
    });
  });

});
