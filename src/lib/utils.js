// lib/utils.js
// 通用工具函数

import { IMAGE_EXTENSIONS } from './constants.js';

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
 * @param {string} url - 图片 URL
 * @param {string} namingStrategy - 命名策略: 'original' | 'domain' | 'sequential'
 * @param {number} index - 序号（用于 sequential 策略）
 * @param {string} domain - 域名（用于 domain 策略）
 * @returns {string} 生成的文件名
 */
export function generateFilename(url, namingStrategy, index, domain) {
  const originalName = extractFilename(url);
  const ext = getExtension(originalName) || '.jpg';
  const baseName = originalName.replace(ext, '') || 'image';
  const filenameWithExtension = getExtension(originalName) ? originalName : `${baseName}${ext}`;

  switch (namingStrategy) {
    case 'domain':
      return sanitizeFilename(`${domain || extractDomain(url)}_${baseName}${ext}`);
    case 'sequential':
      return sanitizeFilename(`img_${String(index).padStart(4, '0')}${ext}`);
    case 'original':
    default:
      return sanitizeFilename(filenameWithExtension);
  }
}

/**
 * 简单的 URL 去重 key
 * @param {string} url - 要处理的 URL
 * @returns {string} 去重用的 key（去除 hash 和部分查询参数）
 */
export function urlDedupeKey(url) {
  try {
    const u = new URL(url);
    // 去除 hash，保留 pathname + 部分查询参数
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * 延迟函数
 * @param {number} ms - 延迟毫秒数
 * @returns {Promise<void>} Promise，在指定时间后 resolve
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
