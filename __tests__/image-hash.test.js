/**
 * 内容级图像指标测试（V16-03）
 *
 * 全部用构造的像素数组断言，不依赖 DOM / Canvas —— Jest 是 node 环境且没有 jsdom，
 * 这正是算法写成纯函数的目的。
 */

import {
  computePhash,
  computeSharpness,
  groupBySimilarity,
  hammingDistance,
} from '../src/lib/image-hash.js';

/**
 * 按亮度函数生成 RGBA 像素数组（灰度图，alpha 全不透明）
 * @param {number} width - 宽
 * @param {number} height - 高
 * @param {(x: number, y: number) => number} luminance - 返回 0-255 亮度
 */
function pixelsFromLuminance(width, height, luminance) {
  const data = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const value = Math.max(0, Math.min(255, Math.round(luminance(x, y))));
      const offset = (y * width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }

  return data;
}

// 亮度随 x 严格递增：任何宽度（缩放）下相邻区块的大小关系都不变
const ramp = (x, y, width) => (x / width) * 255;
// 同一个渐变但整体加一个亮度偏移（未溢出）
const rampOffset = (x, y, width) => (x / width) * 200 + 20;
// 亮度随 x 递减：与 ramp 逐位相反
const reverseRamp = (x, y, width) => 255 - (x / width) * 255;

function rampPixels(width, height, fn = ramp) {
  return pixelsFromLuminance(width, height, (x, y) => fn(x, y, width));
}

function solidPixels(width, height, value = 128) {
  return pixelsFromLuminance(width, height, () => value);
}

describe('computePhash()', () => {
  test('相同输入应该得到稳定且格式正确的 hash', () => {
    const pixels = rampPixels(64, 64);

    const first = computePhash(pixels, 64, 64);
    const second = computePhash(pixels, 64, 64);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{16}$/);
  });

  test('整体亮度偏移不应该改变 hash', () => {
    const base = computePhash(rampPixels(64, 64), 64, 64);
    const shifted = computePhash(rampPixels(64, 64, rampOffset), 64, 64);

    expect(hammingDistance(base, shifted)).toBe(0);
  });

  test('缩放（同一图案 2 倍尺寸）后仍应判定为相似', () => {
    const small = computePhash(rampPixels(32, 32), 32, 32);
    const large = computePhash(rampPixels(64, 64), 64, 64);

    expect(hammingDistance(small, large)).toBeLessThanOrEqual(4);
  });

  test('方向相反的图应该判为明显不同', () => {
    const ascending = computePhash(rampPixels(64, 64), 64, 64);
    const descending = computePhash(rampPixels(64, 64, reverseRamp), 64, 64);

    // 逐位相反：64 位全部不同
    expect(hammingDistance(ascending, descending)).toBe(64);
  });

  test('像素不可用时应该返回空字符串', () => {
    expect(computePhash(null, 10, 10)).toBe('');
    expect(computePhash(new Uint8ClampedArray(0), 0, 0)).toBe('');
    // 长度不足以覆盖 10×10 的 RGBA
    expect(computePhash(new Uint8ClampedArray(16), 10, 10)).toBe('');
    expect(computePhash(rampPixels(8, 8), 8, 8, { hashSize: 0 })).toBe('');
  });

  test('hashSize 应该决定位数', () => {
    const pixels = rampPixels(32, 32);

    // 4 × 4 = 16 位 → 4 字符
    expect(computePhash(pixels, 32, 32, { hashSize: 4 })).toMatch(/^[0-9a-f]{4}$/);
  });
});

describe('hammingDistance()', () => {
  test('相同 hash 距离为 0', () => {
    expect(hammingDistance('abcdef0123456789', 'abcdef0123456789')).toBe(0);
  });

  test('应该按位统计差异且忽略大小写', () => {
    expect(hammingDistance('0000000000000000', '0000000000000001')).toBe(1);
    expect(hammingDistance('0000000000000000', '000000000000003f')).toBe(6);
    expect(hammingDistance('0000000000000000', 'FFFFFFFFFFFFFFFF')).toBe(64);
  });

  test('不可比较的输入应该返回 Infinity', () => {
    expect(hammingDistance('', 'abcd')).toBe(Number.POSITIVE_INFINITY);
    expect(hammingDistance('abcd', '')).toBe(Number.POSITIVE_INFINITY);
    expect(hammingDistance('abcd', 'abcdef')).toBe(Number.POSITIVE_INFINITY);
    expect(hammingDistance('zzzz', 'abcd')).toBe(Number.POSITIVE_INFINITY);
    expect(hammingDistance(null, undefined)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('computeSharpness()', () => {
  test('纯色图的清晰度应该为 0', () => {
    expect(computeSharpness(solidPixels(32, 32), 32, 32)).toBe(0);
  });

  test('边缘丰富的图分数应该高于低频图', () => {
    // 逐像素 0/255 交错：最高频
    const checker = pixelsFromLuminance(32, 32, (x, y) => ((x + y) % 2 ? 255 : 0));
    // 单周期正弦：低频、近似模糊
    const smooth = pixelsFromLuminance(16, 16, x => 128 + 100 * Math.sin((2 * Math.PI * x) / 16));

    const checkerScore = computeSharpness(checker, 32, 32);
    const smoothScore = computeSharpness(smooth, 16, 16);

    expect(checkerScore).toBeGreaterThan(1000);
    expect(smoothScore).toBeGreaterThan(0);
    expect(smoothScore).toBeLessThan(checkerScore);
  });

  test('尺寸过小或像素不可用时应该返回 0', () => {
    expect(computeSharpness(solidPixels(2, 2), 2, 2)).toBe(0);
    expect(computeSharpness(null, 32, 32)).toBe(0);
  });
});

describe('groupBySimilarity()', () => {
  test('相似 hash 应该并入同组，明显不同的不合并', () => {
    const groups = groupBySimilarity([
      { id: 'a', phash: 'ffffffffffffffff', sharpness: 10 },
      { id: 'b', phash: 'fffffffffffffffe', sharpness: 90 },
      { id: 'c', phash: '0000000000000000', sharpness: 50 },
    ]);

    expect(groups).toHaveLength(2);
    // 组内按清晰度降序：最清晰的在最前
    expect(groups[0].items.map(item => item.id)).toEqual(['b', 'a']);
    expect(groups[1].items.map(item => item.id)).toEqual(['c']);
  });

  test('阈值边界应该按 maxDistance 判定', () => {
    // 距离 6 与 7 的分界（默认阈值 6）
    const groups = groupBySimilarity([
      { id: 'a', phash: '0000000000000000', sharpness: 1 },
      { id: 'b', phash: '000000000000003f', sharpness: 1 },
      { id: 'c', phash: '000000000000007f', sharpness: 1 },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].items.map(item => item.id)).toEqual(['a', 'b']);
    expect(groups[1].items.map(item => item.id)).toEqual(['c']);
  });

  test('空 hash 的条目应该各自成组且不参与比较', () => {
    const groups = groupBySimilarity([
      { id: 'a', phash: '', sharpness: 1 },
      { id: 'b', phash: '', sharpness: 2 },
      { id: 'c', phash: 'abcdabcdabcdabcd', sharpness: 3 },
      { id: 'd', phash: undefined, sharpness: 4 },
    ]);

    expect(groups.map(group => group.items.map(item => item.id)))
      .toEqual([['a'], ['b'], ['c'], ['d']]);
  });

  test('组间应该保持输入顺序，组 key 用组代表 id', () => {
    const groups = groupBySimilarity([
      { id: 'a', phash: '0000000000000000', sharpness: 1 },
      { id: 'b', phash: 'ffffffffffffffff', sharpness: 1 },
      { id: 'c', phash: '0000000000000001', sharpness: 1 },
    ]);

    expect(groups.map(group => group.key)).toEqual(['a', 'b']);
  });

  test('所有输入条目都应该出现在结果里（不丢项）', () => {
    const items = [
      { id: 'a', phash: 'ffffffffffffffff', sharpness: 3 },
      { id: 'b', phash: 'fffffffffffffffe', sharpness: 2 },
      { id: 'c', phash: '', sharpness: 1 },
      { id: 'd', phash: '0000000000000000', sharpness: 0 },
    ];

    const total = groupBySimilarity(items)
      .reduce((sum, group) => sum + group.items.length, 0);

    expect(total).toBe(items.length);
  });

  test('空输入应该返回空数组', () => {
    expect(groupBySimilarity([])).toEqual([]);
    expect(groupBySimilarity()).toEqual([]);
  });
});
