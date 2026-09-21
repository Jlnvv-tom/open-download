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

  describe('来源与时长字段', () => {
    beforeEach(async () => {
      await testStore.init();
    });

    test('findMediaByUrl 应该按去重 key 命中记录', () => {
      const image = testStore.addMedia({ url: 'https://cdn.example.com/a.jpg?size=2&v=1' });

      expect(testStore.findMediaByUrl('https://cdn.example.com/a.jpg?v=1&size=2')).toBe(image);
      expect(testStore.findMediaByUrl('https://cdn.example.com/b.jpg')).toBeUndefined();
    });

    test('缺少 source 的老数据应该归一为 network', async () => {
      await global.chrome.storage.local.set({
        captured_images: [{ id: 'legacy-1', url: 'https://cdn.example.com/legacy.jpg', filename: 'legacy.jpg' }]
      });

      const legacyStore = new ImageStore();
      await legacyStore.init();

      expect(legacyStore.getImageById('legacy-1').source).toBe('network');
    });

    test('source=dom 的记录应该保留 dom', () => {
      const media = testStore.addMedia({ url: 'https://cdn.example.com/dom.jpg', source: 'dom' });
      expect(media.source).toBe('dom');
    });

    test('updateImageDetailsByUrl 应该富化 duration 且不覆盖已有值', () => {
      const media = testStore.addMedia({ mediaType: 'video', url: 'https://cdn.example.com/v.mp4' });

      expect(testStore.updateImageDetailsByUrl(media.url, { duration: 120 })).toBe(1);
      expect(testStore.getImageById(media.id).duration).toBe(120);

      expect(testStore.updateImageDetailsByUrl(media.url, { duration: 999 })).toBe(0);
      expect(testStore.getImageById(media.id).duration).toBe(120);
    });

    test('getFilteredMedia 应该支持 source 维度', () => {
      testStore.addMedia({ url: 'https://cdn.example.com/net.jpg' });
      testStore.addMedia({ url: 'https://cdn.example.com/dom.jpg', source: 'dom' });

      const domOnly = testStore.getFilteredMedia({ source: 'dom' });
      expect(domOnly).toHaveLength(1);
      expect(domOnly[0].url).toBe('https://cdn.example.com/dom.jpg');
      expect(testStore.getFilteredMedia({ source: 'network' })).toHaveLength(1);
      expect(testStore.getFilteredMedia()).toHaveLength(2);
    });
  });

  describe('站点规则与分组设置', () => {
    beforeEach(async () => {
      await testStore.init();
    });

    test('默认应该没有站点规则且不按页面分组', () => {
      const settings = testStore.getSettings();
      expect(settings.siteRules).toEqual({});
      expect(settings.ui.groupByPage).toBe(false);
      expect(settings.ui.sourceFilter).toBe('all');
    });

    test('siteRules 应该整表替换而不是键级合并', async () => {
      await testStore.saveSettings({ siteRules: { 'a.com': 'block', 'b.com': 'block' } });
      await testStore.saveSettings({ siteRules: { 'a.com': 'block' } });

      expect(testStore.getSettings().siteRules).toEqual({ 'a.com': 'block' });
    });

    test('默认应该带传输阈值且不携带 Cookie', () => {
      const settings = testStore.getSettings();
      expect(settings.sendCookies).toBe(false);
      expect(settings.transfer.bypassFileSize).toBe(50 * 1024 * 1024);
      expect(settings.transfer.bypassBatchSize).toBe(500 * 1024 * 1024);
      expect(settings.transfer.maxZipFiles).toBe(200);
    });

    test('transfer 部分提交不应该清空其他阈值', async () => {
      await testStore.saveSettings({ transfer: { maxZipFiles: 10 } });

      const settings = testStore.getSettings();
      expect(settings.transfer.maxZipFiles).toBe(10);
      expect(settings.transfer.bypassFileSize).toBe(50 * 1024 * 1024);
    });

    test('sendCookies 应该可持久化', async () => {
      await testStore.saveSettings({ sendCookies: true });
      expect(testStore.getSettings().sendCookies).toBe(true);
    });

    test('ui.groupByPage / ui.sourceFilter 应该持久化且不影响其他 ui 字段', async () => {
      await testStore.saveSettings({ ui: { groupByPage: true, sourceFilter: 'dom' } });

      const settings = testStore.getSettings();
      expect(settings.ui.groupByPage).toBe(true);
      expect(settings.ui.sourceFilter).toBe('dom');
      expect(settings.ui.viewMode).toBe('list');
    });
  });

  describe('图片管理', () => {
    beforeEach(async () => {
      await testStore.init();
    });

    test('应该添加图片', () => {
      const image = testStore.addImage({
        url: 'https://example.com/test.jpg',
        previewUrl: 'https://example.com/preview.jpg',
        filename: 'test.jpg',
        domain: 'example.com',
        mimeType: 'image/jpeg',
        size: 50000
      });

      expect(image).toBeDefined();
      expect(image.id).toBeDefined();
      expect(image.url).toBe('https://example.com/test.jpg');
      expect(image.previewUrl).toBe('https://example.com/preview.jpg');
      expect(image.mediaType).toBe('image');
      expect(image.extension).toBe('jpg');
      expect(image.status).toBe('pending');
      expect(image.downloaded).toBe(false);
    });

    test('应该添加视频媒体', () => {
      const media = testStore.addMedia({
        mediaType: 'video',
        url: 'https://example.com/video.mp4',
        filename: 'video.mp4',
        mimeType: 'video/mp4'
      });

      expect(media.mediaType).toBe('video');
      expect(media.extension).toBe('mp4');
      expect(testStore.getMedia()).toHaveLength(1);
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

    test('相同 URL 应该去重，不同 query 视为不同资源（当 dedupe 为 true）', async () => {
      await testStore.saveSettings({ dedupe: true });

      const image1 = testStore.addImage({
        url: 'https://example.com/same.jpg?sign=abc',
        filename: 'same.jpg'
      });
      const image2 = testStore.addImage({
        url: 'https://example.com/same.jpg?sign=def',
        filename: 'same.jpg'
      });

      // 签名/参数不同的同路径 URL 是不同资源
      expect(image1).toBeDefined();
      expect(image2).toBeDefined();
      expect(testStore.getImages().length).toBe(2);

      // 完全相同的 URL 仍然去重
      const image3 = testStore.addImage({
        url: 'https://example.com/same.jpg?sign=abc',
        filename: 'same.jpg'
      });
      expect(image3).toBeNull();
      expect(testStore.getImages().length).toBe(2);
    });

    test('query 参数顺序不同应该视为同一资源（当 dedupe 为 true）', async () => {
      await testStore.saveSettings({ dedupe: true });

      testStore.addImage({
        url: 'https://example.com/same.jpg?b=2&a=1',
        filename: 'same.jpg'
      });
      const image2 = testStore.addImage({
        url: 'https://example.com/same.jpg?a=1&b=2',
        filename: 'same.jpg'
      });

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

    test('应该更新图片状态为 failed 并记录失败原因', () => {
      const image = testStore.addImage({
        url: 'https://example.com/test.jpg',
        filename: 'test.jpg'
      });

      testStore.updateImageStatus(image.id, 'failed', 'HTTP 403');

      const updated = testStore.getImageById(image.id);
      expect(updated.status).toBe('failed');
      expect(updated.errorMsg).toBe('HTTP 403');

      const stats = testStore.getStats();
      expect(stats.failed).toBe(1);
    });

    test('状态离开 failed 时应该清空失败原因', () => {
      const image = testStore.addImage({
        url: 'https://example.com/test.jpg',
        filename: 'test.jpg'
      });

      testStore.updateImageStatus(image.id, 'failed', 'HTTP 403');
      testStore.updateImageStatus(image.id, 'pending');

      expect(testStore.getImageById(image.id).errorMsg).toBe('');
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

      const updated = testStore.updateImageDetailsByUrl('https://cdn.example.com/path/photo.jpg?cache=1', {
        width: 800,
        height: 600,
        alt: '封面图',
        previewUrl: 'https://cdn.example.com/path/photo-large.jpg'
      });

      expect(updated).toBe(1);
      expect(testStore.getImageById(image.id)).toMatchObject({
        width: 800,
        height: 600,
        alt: '封面图',
        previewUrl: 'https://cdn.example.com/path/photo-large.jpg'
      });
    });

    test('不同 query 的 URL 不应该跨条目更新', () => {
      testStore.addImage({
        url: 'https://cdn.example.com/path/photo.jpg?sign=abc',
        filename: 'photo.jpg'
      });

      const updated = testStore.updateImageDetailsByUrl('https://cdn.example.com/path/photo.jpg?sign=xyz', {
        width: 320,
        height: 240
      });

      expect(updated).toBe(0);
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

    test('应该按媒体类型过滤', () => {
      testStore.addImage({ url: 'https://a.com/1.jpg', filename: '1.jpg' });
      testStore.addMedia({
        mediaType: 'video',
        url: 'https://a.com/clip.mp4',
        filename: 'clip.mp4'
      });

      const filtered = testStore.getFilteredMedia({ mediaType: 'video' });
      expect(filtered.length).toBe(1);
      expect(filtered[0].filename).toBe('clip.mp4');
    });

    test('应该按最小大小过滤', () => {
      testStore.addImage({ url: 'https://a.com/1.jpg', filename: '1.jpg', size: 1000 });
      testStore.addImage({ url: 'https://a.com/2.jpg', filename: '2.jpg', size: 5000 });

      const filtered = testStore.getFilteredImages({ minSize: 2000 });
      expect(filtered.length).toBe(1);
      expect(filtered[0].size).toBe(5000);
    });

    test('应该按最小宽高过滤且保留尺寸未知的条目', () => {
      testStore.addImage({ url: 'https://a.com/1.jpg', filename: '1.jpg', width: 800, height: 600 });
      testStore.addImage({ url: 'https://a.com/2.jpg', filename: '2.jpg', width: 64, height: 64 });
      testStore.addImage({ url: 'https://a.com/3.jpg', filename: '3.jpg' });

      const filtered = testStore.getFilteredMedia({ minDimensions: { width: 300, height: 300 } });
      expect(filtered.length).toBe(2);
      expect(filtered.map(img => img.filename).sort()).toEqual(['1.jpg', '3.jpg']);
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

    test('超过上限时应该截断并累计 truncated 统计', async () => {
      // 直接构造超过上限的列表，避免逐条 addImage
      const now = Date.now();
      for (let i = 0; i < 5010; i++) {
        testStore.images.push({
          id: `id-${i}`,
          mediaType: 'image',
          url: `https://a.com/${i}.jpg`,
          filename: `${i}.jpg`,
          domain: 'a.com',
          status: 'pending',
          capturedAt: now + i,
        });
      }

      await testStore.saveImages();

      expect(testStore.getImages().length).toBe(5000);
      expect(testStore.getStats().truncated).toBe(10);
    });
  });

});
