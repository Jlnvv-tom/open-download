/**
 * lib/utils.js 单元测试
 */

import {
  extractFilename,
  extractDomain,
  getExtension,
  isImageUrl,
  formatSize,
  detectMediaType,
  getNormalizedExtension,
  generateId,
  isVideoUrl,
  isMediaUrl,
  sanitizeFilename,
  generateFilename,
  urlDedupeKey,
  sleep
} from '../src/lib/utils.js';

describe('utils.js', () => {

  describe('extractFilename()', () => {
    test('应该正确提取 URL 中的文件名', () => {
      expect(extractFilename('https://example.com/path/to/image.jpg')).toBe('image.jpg');
      expect(extractFilename('https://example.com/test.png?query=123')).toBe('test.png');
      expect(extractFilename('https://example.com/a/b/c/photo.webp')).toBe('photo.webp');
    });

    test('应该处理 URL 编码的文件名', () => {
      expect(extractFilename('https://example.com/%E4%B8%AD%E6%96%87.jpg')).toBe('中文.jpg');
    });

    test('应该处理无效 URL 返回 "unknown"', () => {
      expect(extractFilename('invalid-url')).toBe('unknown');
      expect(extractFilename('')).toBe('unknown');
    });

    test('应该处理没有路径的 URL', () => {
      expect(extractFilename('https://example.com')).toBe('unknown');
    });
  });

  describe('extractDomain()', () => {
    test('应该正确提取域名', () => {
      expect(extractDomain('https://www.example.com/path')).toBe('www.example.com');
      expect(extractDomain('http://sub.domain.com/image.jpg')).toBe('sub.domain.com');
    });

    test('应该处理无效 URL 返回 "unknown"', () => {
      expect(extractDomain('invalid')).toBe('unknown');
      expect(extractDomain('')).toBe('unknown');
    });
  });

  describe('getExtension()', () => {
    test('应该正确提取文件扩展名（包含点号）', () => {
      expect(getExtension('image.jpg')).toBe('.jpg');
      expect(getExtension('photo.PNG')).toBe('.png');
      expect(getExtension('test.webp')).toBe('.webp');
    });

    test('应该处理没有扩展名的文件名', () => {
      expect(getExtension('filename')).toBe('');
      expect(getExtension('noext')).toBe('');
    });

    test('应该返回小写扩展名', () => {
      expect(getExtension('image.JPG')).toBe('.jpg');
      expect(getExtension('photo.WebP')).toBe('.webp');
    });
  });

  describe('isImageUrl()', () => {
    test('应该识别常见图片扩展名', () => {
      expect(isImageUrl('https://example.com/image.jpg')).toBe(true);
      expect(isImageUrl('https://example.com/photo.png')).toBe(true);
      expect(isImageUrl('https://example.com/pic.webp')).toBe(true);
      expect(isImageUrl('https://example.com/animation.gif')).toBe(true);
    });

    test('应该识别 data URI 图片', () => {
      expect(isImageUrl('data:image/png;base64,iVBORw0KGgo')).toBe(true);
      expect(isImageUrl('data:image/jpeg;base64,/9j/4AAQSk')).toBe(true);
    });

    test('应该拒绝非图片 URL', () => {
      expect(isImageUrl('https://example.com/video.mp4')).toBe(false);
      expect(isImageUrl('https://example.com/document.pdf')).toBe(false);
      expect(isImageUrl('https://example.com/')).toBe(false);
    });
  });

  describe('媒体类型工具', () => {
    test('应该标准化扩展名', () => {
      expect(getNormalizedExtension('photo.JPG')).toBe('jpg');
      expect(getNormalizedExtension('https://example.com/video.MP4?x=1')).toBe('mp4');
    });

    test('应该识别视频 URL 和媒体 URL', () => {
      expect(isVideoUrl('https://example.com/video.mp4')).toBe(true);
      expect(isMediaUrl('https://example.com/video.webm')).toBe(true);
      expect(isMediaUrl('https://example.com/photo.png')).toBe(true);
      expect(isMediaUrl('https://example.com/app.js')).toBe(false);
    });

    test('应该根据 MIME、resource type 或扩展名判断媒体类型', () => {
      expect(detectMediaType({ mimeType: 'image/png' })).toBe('image');
      expect(detectMediaType({ mimeType: 'video/mp4' })).toBe('video');
      expect(detectMediaType({ resourceType: 'media' })).toBe('video');
      expect(detectMediaType({ url: 'https://example.com/photo.webp' })).toBe('image');
      expect(detectMediaType({ url: 'https://example.com/app.js' })).toBe('');
    });
  });

  describe('formatSize()', () => {
    test('应该正确格式化字节', () => {
      expect(formatSize(500)).toBe('500.0 B');
      expect(formatSize(0)).toBe('未知');
      expect(formatSize(null)).toBe('未知');
    });

    test('应该正确格式化 KB', () => {
      expect(formatSize(1024)).toBe('1.0 KB');
      expect(formatSize(2048)).toBe('2.0 KB');
      expect(formatSize(1536)).toBe('1.5 KB');
    });

    test('应该正确格式化 MB', () => {
      expect(formatSize(1048576)).toBe('1.0 MB');
      expect(formatSize(5242880)).toBe('5.0 MB');
    });

    test('应该正确格式化 GB', () => {
      expect(formatSize(1073741824)).toBe('1.0 GB');
    });
  });

  describe('generateId()', () => {
    test('应该生成唯一 ID', () => {
      const id1 = generateId();
      const id2 = generateId();
      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
    });

    test('应该包含时间戳和随机字符串', () => {
      const id = generateId();
      expect(id).toMatch(/^\d+-[a-z0-9]+$/);
    });
  });

  describe('sanitizeFilename()', () => {
    test('应该移除非法字符', () => {
      expect(sanitizeFilename('file<name>.jpg')).toBe('file_name_.jpg');
      expect(sanitizeFilename('test|file.png')).toBe('test_file.png');
      expect(sanitizeFilename('name"test.webp')).toBe('name_test.webp');
    });

    test('应该将多个空格替换为单个下划线', () => {
      expect(sanitizeFilename('file   name.jpg')).toBe('file_name.jpg');
      expect(sanitizeFilename('test__file.png')).toBe('test_file.png');
    });

    test('应该限制文件名长度', () => {
      const longName = 'a'.repeat(300) + '.jpg';
      const result = sanitizeFilename(longName);
      expect(result.length).toBeLessThanOrEqual(200);
    });
  });

  describe('generateFilename()', () => {
    test('original 策略应该保留原文件名', () => {
      const result = generateFilename('https://example.com/photo.jpg', 'original', 0, 'example.com');
      expect(result).toBe('photo.jpg');
    });

    test('domain 策略应该添加域名前缀', () => {
      const result = generateFilename('https://test.com/img/pic.jpg', 'domain', 0, 'test.com');
      expect(result).toBe('test.com_pic.jpg');
    });

    test('sequential 策略应该使用序号命名', () => {
      const result = generateFilename('https://example.com/any.jpg', 'sequential', 5, 'example.com');
      expect(result).toBe('img_0005.jpg');
    });

    test('应该处理没有扩展名的文件', () => {
      const result = generateFilename('https://example.com/photo', 'original', 0, 'example.com');
      // 当文件没有扩展名时，generateFilename 会添加 .jpg 扩展名
      expect(result).toMatch(/photo.*\.jpg$/);
    });
  });

  describe('urlDedupeKey()', () => {
    test('应该生成去重 key（origin + pathname）', () => {
      expect(urlDedupeKey('https://example.com/path/image.jpg')).toBe('https://example.com/path/image.jpg');
      expect(urlDedupeKey('https://example.com/test.png?query=123')).toBe('https://example.com/test.png');
    });

    test('应该移除 hash', () => {
      expect(urlDedupeKey('https://example.com/photo.jpg#section')).toBe('https://example.com/photo.jpg');
    });

    test('应该处理无效 URL', () => {
      expect(urlDedupeKey('invalid')).toBe('invalid');
    });
  });

  describe('sleep()', () => {
    test('应该延迟指定时间', async () => {
      const start = Date.now();
      await sleep(100);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(90);
    });
  });

});
