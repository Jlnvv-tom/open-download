// lib/utils.js
// 通用工具函数

import {
  IMAGE_EXTENSIONS,
  IMAGE_MIME_TYPES,
  MEDIA_TYPES,
  VIDEO_EXTENSIONS,
  VIDEO_MIME_TYPES
} from './constants.js';

/**
 * 从 URL 中提取文件名
 * @param {string} url - 要解析的 URL
 * @returns {string} 提取的文件名，解析失败返回 'unknown'
 */
export function extractFilename(url) {
  try {
    const u = new URL(url);
    const pathname = u.pathname;
    const filename = pathname.split('/').pop() || 'unknown';
    // 去除查询参数
    return decodeURIComponent(filename.split('?')[0]);
  } catch {
    return 'unknown';
  }
}

/**
 * 从 URL 中提取域名
 * @param {string} url - 要解析的 URL
 * @returns {string} 提取的域名，解析失败返回 'unknown'
 */
export function extractDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

/**
 * 获取文件扩展名
 * @param {string} filename - 文件名
 * @returns {string} 扩展名（包含点号），如 '.jpg'，无扩展名返回空字符串
 */
export function getExtension(filename) {
  const parts = filename.split('.');
  return parts.length > 1 ? `.${parts.pop().toLowerCase()}` : '';
}

export function getNormalizedExtension(filenameOrUrl) {
  const filename = filenameOrUrl.includes('://') || filenameOrUrl.startsWith('data:')
    ? extractFilename(filenameOrUrl)
    : filenameOrUrl;
  return getExtension(filename).replace(/^\./, '').toLowerCase();
}

export function extensionFromMimeType(mimeType) {
  const normalized = (mimeType || '').split(';')[0].trim().toLowerCase();
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'image/avif': 'avif',
    'image/tiff': 'tiff',
    'image/apng': 'apng',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-m4v': 'm4v',
    'video/x-msvideo': 'avi',
    'video/x-matroska': 'mkv',
    'video/mpeg': 'mpeg',
    'video/3gpp': '3gp',
    'application/vnd.apple.mpegurl': 'm3u8',
    'application/x-mpegurl': 'm3u8',
    'audio/mpegurl': 'm3u8',
  };
  return map[normalized] || '';
}

export function detectMediaType({ url = '', mimeType = '', resourceType = '' } = {}) {
  const normalizedMime = (mimeType || '').split(';')[0].trim().toLowerCase();
  const ext = `.${getNormalizedExtension(url)}`;

  if (IMAGE_MIME_TYPES.includes(normalizedMime)) return MEDIA_TYPES.IMAGE;
  if (VIDEO_MIME_TYPES.includes(normalizedMime)) return MEDIA_TYPES.VIDEO;
  if (resourceType === 'image') return MEDIA_TYPES.IMAGE;
  if (resourceType === 'media') return MEDIA_TYPES.VIDEO;
  if (IMAGE_EXTENSIONS.includes(ext) || url.startsWith('data:image/')) return MEDIA_TYPES.IMAGE;
  if (VIDEO_EXTENSIONS.includes(ext)) return MEDIA_TYPES.VIDEO;
  return '';
}

/**
 * 判断 URL 是否为图片
 * @param {string} url - 要检查的 URL
 * @returns {boolean} 是否为图片 URL
 */
export function isImageUrl(url) {
  const filename = extractFilename(url);
  const ext = getExtension(filename);
  // 不能仅靠扩展名判断，data URI 也要处理
  return IMAGE_EXTENSIONS.includes(ext) || url.startsWith('data:image/');
}

export function isVideoUrl(url) {
  const filename = extractFilename(url);
  const ext = getExtension(filename);
  return VIDEO_EXTENSIONS.includes(ext);
}

export function isMediaUrl(url) {
  return isImageUrl(url) || isVideoUrl(url);
}

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的文件大小字符串，如 "1.5 MB"
 */
export function formatSize(bytes) {
  if (!bytes || bytes === 0) return '未知';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

/**
 * 生成唯一 ID
 * @returns {string} 唯一的 ID 字符串，格式: '{timestamp}-{random}'
 */
export function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 生成安全的文件名
 * @param {string} filename - 原始文件名
 * @returns {string} 安全的文件名，移除非法字符、限制长度
 */
export function sanitizeFilename(filename) {
  return filename
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 200); // 限制文件名长度
}

/**
 * 根据 URL 生成文件名
 * @param {string} url - 媒体 URL
 * @param {string} namingStrategy - 命名策略: 'original' | 'domain' | 'sequential'
 * @param {number} index - 序号（用于 sequential 策略）
 * @param {string} domain - 域名（用于 domain 策略）
 * @param {Object} [options] - 媒体信息（用于 sequential 前缀与扩展名兜底）
 * @param {string} [options.mediaType='image'] - 媒体类型 'image' | 'video'
 * @param {string} [options.mimeType=''] - MIME 类型（扩展名兜底时推断）
 * @returns {string} 生成的文件名
 */
export function generateFilename(url, namingStrategy, index, domain, options = {}) {
  const mediaType = options.mediaType === MEDIA_TYPES.VIDEO ? MEDIA_TYPES.VIDEO : MEDIA_TYPES.IMAGE;
  const originalName = extractFilename(url);
  const originalExt = getExtension(originalName);
  const mimeExt = extensionFromMimeType(options.mimeType);
  // 扩展名兜底链：URL 扩展名 → MIME 推断 → 按媒体类型的默认扩展名
  const ext = originalExt
    || (mimeExt ? `.${mimeExt}` : (mediaType === MEDIA_TYPES.VIDEO ? '.mp4' : '.jpg'));
  const baseName = originalName.replace(ext, '')
    || (mediaType === MEDIA_TYPES.VIDEO ? 'video' : 'image');
  const filenameWithExtension = originalExt ? originalName : `${baseName}${ext}`;

  switch (namingStrategy) {
    case 'domain':
      return sanitizeFilename(`${domain || extractDomain(url)}_${baseName}${ext}`);
    case 'sequential':
      return sanitizeFilename(`${mediaType === MEDIA_TYPES.VIDEO ? 'video' : 'img'}_${String(index).padStart(4, '0')}${ext}`);
    case 'original':
    default:
      return sanitizeFilename(filenameWithExtension);
  }
}

/**
 * 简单的 URL 去重 key
 * 同一资源的不同签名/裁剪参数视为不同资源，仅丢弃 hash；
 * query 参数排序归一，参数顺序不同仍视为同 key。
 * @param {string} url - 要处理的 URL
 * @returns {string} 去重用的 key（origin + pathname + 排序后的 query）
 */
export function urlDedupeKey(url) {
  try {
    const u = new URL(url);
    u.searchParams.sort();
    return `${u.origin}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/**
 * 格式化视频时长
 * @param {number} seconds - 时长（秒）
 * @returns {string} 'mm:ss' 或 'h:mm:ss'，无效值返回空字符串
 */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * 延迟函数
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>} Promise，在指定时间后 resolve
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
