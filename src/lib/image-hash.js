// lib/image-hash.js — 内容级图像指标：感知哈希与清晰度评分（V16-03）
//
// 全部为纯函数：只接收 RGBA 像素数组与尺寸，不触碰 DOM / Canvas / fetch。
// 原因：Jest 的 testEnvironment 是 node 且没有 jsdom，任何依赖 DOM 的实现
// 都无法自动化测试。像素的获取（offscreen 的 fetch + Canvas）留在 offscreen 侧。
//
// hash 用 16 字符 hex 字符串而不是 BigInt：chrome.storage.local 走 JSON 序列化，
// BigInt 无法直接序列化；hex 还便于调试时肉眼比对。

const DEFAULT_HASH_SIZE = 8;
const DEFAULT_MAX_DISTANCE = 6;

/**
 * 像素数组是否可用（长度需覆盖 width × height × 4 的 RGBA 数据）
 * @param {Uint8ClampedArray|number[]} rgba - RGBA 像素
 * @param {number} width - 宽
 * @param {number} height - 高
 * @returns {boolean}
 */
function isValidPixels(rgba, width, height) {
  if (!rgba || typeof rgba.length !== 'number') return false;

  const w = Math.floor(Number(width));
  const h = Math.floor(Number(height));
  return w > 0 && h > 0 && rgba.length >= w * h * 4;
}

/**
 * RGBA → 亮度数组
 * 半透明像素按白色底合成：透明 PNG 的 RGB 通道常为全 0，
 * 不合成会让所有透明图挤成同一个 hash
 */
function toGrayscale(rgba, width, height) {
  const total = width * height;
  const gray = new Float64Array(total);

  for (let index = 0; index < total; index++) {
    const offset = index * 4;
    const alpha = (rgba[offset + 3] ?? 255) / 255;
    const luminance = 0.299 * rgba[offset] + 0.587 * rgba[offset + 1] + 0.114 * rgba[offset + 2];
    gray[index] = luminance * alpha + 255 * (1 - alpha);
  }

  return gray;
}

/**
 * 把灰度图按区块平均采样到 cols × rows 的小网格
 * 用平均值而不是取点采样，等效于一次盒子滤波：既降采样又抗噪
 */
function blockAverage(gray, width, height, col, cols, row, rows) {
  const xStart = Math.floor((col * width) / cols);
  const xEnd = Math.max(xStart + 1, Math.floor(((col + 1) * width) / cols));
  const yStart = Math.floor((row * height) / rows);
  const yEnd = Math.max(yStart + 1, Math.floor(((row + 1) * height) / rows));

  let sum = 0;
  let count = 0;

  for (let y = yStart; y < Math.min(yEnd, height); y++) {
    for (let x = xStart; x < Math.min(xEnd, width); x++) {
      sum += gray[y * width + x];
      count++;
    }
  }

  return count > 0 ? sum / count : 0;
}

function bitsToHex(bits) {
  let hex = '';

  for (let index = 0; index < bits.length; index += 4) {
    hex += parseInt(bits.slice(index, index + 4).padEnd(4, '0'), 2).toString(16);
  }

  return hex;
}

/**
 * 归一化 hex 字符串；非 hex（含空串）返回 ''
 * @param {string} value - 待归一化的 hash
 * @returns {string}
 */
function normalizeHex(value) {
  return typeof value === 'string' && /^[0-9a-f]+$/i.test(value) ? value.toLowerCase() : '';
}

/**
 * 计算感知哈希（dHash，差分哈希）
 * 先缩到 (hashSize+1) × hashSize 的灰度网格，再逐行比较相邻区块亮度：
 * 比右侧亮记 1。hashSize=8 时得到 64 位 → 16 字符 hex。
 *
 * 对整体亮度偏移不敏感（只比大小），对缩放 / 轻度重编码稳定。
 *
 * @param {Uint8ClampedArray|number[]} rgba - RGBA 像素
 * @param {number} width - 像素宽
 * @param {number} height - 像素高
 * @param {Object} [options]
 * @param {number} [options.hashSize=8] - 哈希边长（位数 = hashSize²）
 * @returns {string} 16 字符 hex；像素不可用时返回 ''（空 hash 不参与相似归并）
 */
export function computePhash(rgba, width, height, { hashSize = DEFAULT_HASH_SIZE } = {}) {
  const size = Math.floor(Number(hashSize));
  if (!isValidPixels(rgba, width, height) || size < 1) return '';

  const w = Math.floor(width);
  const h = Math.floor(height);
  const gray = toGrayscale(rgba, w, h);
  const cols = size + 1; // 每行需要 cols 个采样点才能比出 cols-1 位

  let bits = '';
  for (let row = 0; row < size; row++) {
    const samples = [];
    for (let col = 0; col < cols; col++) {
      samples.push(blockAverage(gray, w, h, col, cols, row, size));
    }
    for (let col = 0; col < size; col++) {
      bits += samples[col] > samples[col + 1] ? '1' : '0';
    }
  }

  return bitsToHex(bits);
}

/**
 * 两个 hash 的汉明距离（不同位的个数）
 * 任一为空、长度不一致或含非 hex 字符时返回 Infinity，语义为「不可比较」：
 * 这样在 maxDistance 阈值判定里天然被判为不相似，调用方无需额外分支。
 *
 * @param {string} hexA - hash A
 * @param {string} hexB - hash B
 * @returns {number} 距离，或 Infinity（不可比较）
 */
export function hammingDistance(hexA, hexB) {
  const a = normalizeHex(hexA);
  const b = normalizeHex(hexB);
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;

  let distance = 0;
  for (let index = 0; index < a.length; index++) {
    let xor = parseInt(a[index], 16) ^ parseInt(b[index], 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }

  return distance;
}

/**
 * 清晰度评分：灰度图的 Laplacian 方差
 * 纯色与模糊图的高频分量接近 0，边缘丰富的图方差大。
 * 取整存储——5000 条量级下，少一个小数位就少一份存储。
 *
 * @param {Uint8ClampedArray|number[]} rgba - RGBA 像素
 * @param {number} width - 像素宽
 * @param {number} height - 像素高
 * @returns {number} 非负整数；像素不可用或尺寸过小返回 0
 */
export function computeSharpness(rgba, width, height) {
  const w = Math.floor(Number(width));
  const h = Math.floor(Number(height));
  // Laplacian 需要 3×3 邻域，宽高不足则无法计算
  if (!isValidPixels(rgba, width, height) || w < 3 || h < 3) return 0;

  const gray = toGrayscale(rgba, w, h);
  const responses = [];

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      responses.push(
        gray[(y - 1) * w + x] + gray[(y + 1) * w + x]
        + gray[y * w + x - 1] + gray[y * w + x + 1]
        - 4 * gray[y * w + x]
      );
    }
  }

  const mean = responses.reduce((sum, value) => sum + value, 0) / responses.length;
  const variance = responses.reduce((sum, value) => sum + (value - mean) ** 2, 0) / responses.length;

  return Math.round(variance);
}

/**
 * 相似图归并（贪心聚类，纯数据）
 *
 * - 以「组内第一条」为代表进行比较，距离 ≤ maxDistance 即并入；
 *   只看代表而不看全部成员，是为了避免传递性把一串「两两相近」的图连成一个大组；
 * - `phash` 为空的记录无法比较，各自成组；
 * - 组内按 `sharpness` 降序（最清晰在前），组间保持输入顺序——
 *   输入顺序由调用方决定（popup 传入展示顺序，从而沿用「最新在前」）。
 *
 * @param {Object[]} items - 含 { id, phash, sharpness } 的记录
 * @param {Object} [options]
 * @param {number} [options.maxDistance=6] - 相似判定阈值（汉明距离）
 * @returns {{key: string, items: Object[]}[]} key 为组代表的 id，供 UI 做折叠状态的稳定键
 */
export function groupBySimilarity(items = [], { maxDistance = DEFAULT_MAX_DISTANCE } = {}) {
  const threshold = Number.isFinite(Number(maxDistance)) ? Number(maxDistance) : DEFAULT_MAX_DISTANCE;
  const groups = [];

  for (const item of items) {
    const hash = normalizeHex(item?.phash);
    // 空 hash 不参与比较（hash 为 '' 的组也不会被 find 命中，因为代表 hash 为空）
    const target = hash
      ? groups.find(group => group.hash && hammingDistance(group.hash, hash) <= threshold)
      : null;

    if (target) {
      target.items.push(item);
      continue;
    }

    groups.push({
      key: item?.id ?? String(groups.length),
      hash,
      items: [item],
    });
  }

  return groups.map(group => ({
    key: group.key,
    items: [...group.items].sort((a, b) => (b?.sharpness || 0) - (a?.sharpness || 0)),
  }));
}
