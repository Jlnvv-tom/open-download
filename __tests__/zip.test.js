/**
 * lib/zip.js 单元测试
 */

import {
  createMediaZip,
  crc32,
  makeZipFilename,
  uniqueZipFilename
} from '../src/lib/zip.js';

describe('zip.js', () => {
  function makeResponse(text, ok = true, status = 200) {
    return {
      ok,
      status,
      async arrayBuffer() {
        return new TextEncoder().encode(text).buffer;
      }
    };
  }

  test('应该计算 CRC32', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
  });

  test('应该生成唯一 ZIP 文件名', () => {
    const used = new Set();
    expect(uniqueZipFilename('photo.jpg', used)).toBe('photo.jpg');
    expect(uniqueZipFilename('photo.jpg', used)).toBe('photo-1.jpg');
    expect(uniqueZipFilename('photo.jpg', used)).toBe('photo-2.jpg');
  });

  test('应该生成稳定的 ZIP 下载文件名', () => {
    expect(makeZipFilename(new Date('2026-07-25T08:09:10'))).toBe('open-download-20260725-080910.zip');
  });

  test('应该创建包含成功条目的 ZIP Blob', async () => {
    const fetchFn = jest.fn(async () => makeResponse('image-data'));
    const result = await createMediaZip([
      {
        id: '1',
        url: 'https://example.com/photo.jpg',
        filename: 'photo.jpg',
        domain: 'example.com'
      }
    ], { fetchFn });

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.blob.type).toBe('application/zip');

    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
  });

  test('单个资源失败时应该跳过并统计失败', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(makeResponse('ok'))
      .mockResolvedValueOnce(makeResponse('', false, 404));

    const result = await createMediaZip([
      { id: '1', url: 'https://example.com/a.jpg', filename: 'a.jpg', domain: 'example.com' },
      { id: '2', url: 'https://example.com/b.jpg', filename: 'b.jpg', domain: 'example.com' }
    ], { fetchFn });

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errors[0].media.id).toBe('2');
  });

  test('sequential 命名下混合类型应该按媒体类型区分前缀', async () => {
    const fetchFn = jest.fn(async () => makeResponse('data'));
    const result = await createMediaZip([
      { id: '1', url: 'https://example.com/pic', filename: 'pic', domain: 'example.com', mediaType: 'image', mimeType: 'image/png' },
      { id: '2', url: 'https://example.com/clip', filename: 'clip', domain: 'example.com', mediaType: 'video', mimeType: 'video/mp4' }
    ], { fetchFn, fileNaming: 'sequential' });

    expect(result.succeeded).toBe(2);
    expect(result.entries.map(entry => entry.name).sort()).toEqual(['img_0000.png', 'video_0001.mp4']);
  });

  test('打包过程应该通过 onProgress 汇报进度', async () => {
    const fetchFn = jest.fn(async () => makeResponse('image-data'));
    const progress = [];

    await createMediaZip([
      { id: '1', url: 'https://example.com/a.jpg', filename: 'a.jpg', domain: 'example.com' },
      { id: '2', url: 'https://example.com/b.jpg', filename: 'b.jpg', domain: 'example.com' }
    ], {
      fetchFn,
      onProgress: (done, total) => progress.push([done, total])
    });

    expect(progress).toEqual([[1, 2], [2, 2]]);
  });
});
