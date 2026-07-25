// lib/store.js
// 图片存储管理 — 使用 chrome.storage.local

import { STORAGE_KEYS, DEFAULT_SETTINGS } from './constants.js';
import { generateId, urlDedupeKey, extractDomain } from './utils.js';

/**
 * 图片存储管理类
 * 负责图片数据的增删改查、持久化存储、状态统计
 * @class ImageStore
 */
class ImageStore {
  /**
   * 构造函数
   * 初始化内存缓存、设置、统计数据
   */
  constructor() {
    this.images = [];       // 内存缓存
    this.settings = this._mergeSettings();
    this.stats = { total: 0, downloaded: 0, failed: 0 };
    this._loaded = false;
  }

  _mergeSettings(partial = {}) {
    return {
      ...DEFAULT_SETTINGS,
      ...partial,
      filters: {
        ...DEFAULT_SETTINGS.filters,
        ...(partial.filters || {}),
        minDimensions: {
          ...DEFAULT_SETTINGS.filters.minDimensions,
          ...(partial.filters?.minDimensions || {}),
        },
      },
    };
  }

  _normalizeImage(image) {
    return {
      id: image.id || generateId(),
      url: image.url || '',
      filename: image.filename || '',
      domain: image.domain || extractDomain(image.url || ''),
      mimeType: image.mimeType || '',
      size: image.size || 0,
      width: image.width || 0,
      height: image.height || 0,
      alt: image.alt || '',
      capturedAt: image.capturedAt || Date.now(),
      tabUrl: image.tabUrl || '',
      tabTitle: image.tabTitle || '',
      downloaded: Boolean(image.downloaded),
      status: image.status || 'pending',
    };
  }

  /**
   * 初始化存储管理器
   * 加载设置、图片列表、统计数据
   * 多次调用只加载一次
   * @returns {Promise<void>}
   */
  async init() {
    if (this._loaded) return;
    await this.loadSettings();
    await this.loadImages();
    await this.loadStats();
    this._loaded = true;
  }

  // ─── Settings ───

  /**
   * 从 chrome.storage 加载设置
   * @returns {Promise<void>}
   */
  async loadSettings() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
    this.settings = this._mergeSettings(result[STORAGE_KEYS.SETTINGS]);
  }

  /**
   * 保存设置到 chrome.storage
   * @param {Object} partial - 部分设置对象
   * @returns {Promise<Object>} 更新后的完整设置对象
   */
  async saveSettings(partial) {
    this.settings = this._mergeSettings({
      ...this.settings,
      ...partial,
      filters: {
        ...(this.settings.filters || {}),
        ...(partial.filters || {}),
      },
    });
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: this.settings });
    return this.settings;
  }

  /**
   * 获取当前设置（返回副本）
   * @returns {Object} 设置对象的副本
   */
  getSettings() {
    return { ...this.settings };
  }

  // ─── Images ───

  /**
   * 从 chrome.storage 加载图片列表
   * @returns {Promise<void>}
   */
  async loadImages() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CAPTURED_IMAGES);
    this.images = (result[STORAGE_KEYS.CAPTURED_IMAGES] || []).map(image => this._normalizeImage(image));
  }

  /**
   * 保存图片列表到 chrome.storage
   * 自动限制最大数量为 5000，防止存储溢出
   * @returns {Promise<void>}
   */
  async saveImages() {
    // 限制最大存储数量，防止 storage 溢出
    const MAX_IMAGES = 5000;
    if (this.images.length > MAX_IMAGES) {
      this.images = this.images.slice(-MAX_IMAGES);
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.CAPTURED_IMAGES]: this.images });
  }

  /**
   * 添加图片到存储
   * @param {Object} imageData - 图片数据对象
   * @param {string} imageData.url - 图片 URL
   * @param {string} imageData.filename - 文件名
   * @param {string} imageData.domain - 域名
   * @param {string} imageData.mimeType - MIME 类型
   * @param {number} imageData.size - 文件大小（字节）
   * @param {number} imageData.width - 图片宽度
   * @param {number} imageData.height - 图片高度
   * @param {string} imageData.tabUrl - 来源页面 URL
   * @param {string} imageData.tabTitle - 来源页面标题
   * @returns {Object|null} 新增的图片对象，如果重复则返回 null
   */
  addImage(imageData) {
    if (this.settings.dedupe) {
      const key = urlDedupeKey(imageData.url);
      if (this.images.some(img => urlDedupeKey(img.url) === key)) {
        return null;
      }
    }

    const image = {
      id: generateId(),
      url: imageData.url,
      filename: imageData.filename || '',
      domain: imageData.domain || extractDomain(imageData.url),
      mimeType: imageData.mimeType || '',
      size: imageData.size || 0,
      width: imageData.width || 0,
      height: imageData.height || 0,
      alt: imageData.alt || '',
      capturedAt: Date.now(),
      tabUrl: imageData.tabUrl || '',
      tabTitle: imageData.tabTitle || '',
      downloaded: false,
      status: 'pending', // pending | downloading | downloaded | failed
    };

    this.images.push(image);
    this.stats.total++;
    this.saveImages(); // fire-and-forget
    this.saveStats();
    return image;
  }

  /**
   * 从存储中移除指定图片
   * @param {string} id - 图片 ID
   */
  removeImage(id) {
    const idx = this.images.findIndex(img => img.id === id);
    if (idx !== -1) {
      this.images.splice(idx, 1);
      this.saveImages();
    }
  }

  /**
   * 清空所有图片和统计数据
   */
  clearAll() {
    this.images = [];
    this.stats = { total: 0, downloaded: 0, failed: 0 };
    this.saveImages();
    this.saveStats();
  }

  /**
   * 获取所有图片列表（返回副本）
   * @returns {Object[]} 图片对象数组
   */
  getImages() {
    return [...this.images];
  }

  /**
   * 根据 ID 获取图片对象
   * @param {string} id - 图片 ID
   * @returns {Object|undefined} 图片对象，未找到返回 undefined
   */
  getImageById(id) {
    return this.images.find(img => img.id === id);
  }

  /**
   * 更新图片的下载状态
   * @param {string} id - 图片 ID
   * @param {string} status - 状态: 'pending' | 'downloading' | 'downloaded' | 'failed'
   */
  updateImageStatus(id, status) {
    const img = this.getImageById(id);
    if (img) {
      const previousStatus = img.status;
      img.status = status;
      if (status === 'downloaded') {
        img.downloaded = true;
        if (previousStatus !== 'downloaded') {
          this.stats.downloaded++;
        }
      } else if (status === 'failed') {
        if (previousStatus !== 'failed') {
          this.stats.failed++;
        }
      }
      this.saveImages();
      this.saveStats();
    }
  }

  updateImageDetailsByUrl(url, details = {}) {
    const key = urlDedupeKey(url);
    let updatedCount = 0;

    for (const img of this.images) {
      if (urlDedupeKey(img.url) !== key) continue;

      let changed = false;
      if (details.width > 0 && img.width !== details.width) {
        img.width = details.width;
        changed = true;
      }
      if (details.height > 0 && img.height !== details.height) {
        img.height = details.height;
        changed = true;
      }
      if (details.alt && img.alt !== details.alt) {
        img.alt = details.alt;
        changed = true;
      }

      if (changed) {
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      this.saveImages();
    }

    return updatedCount;
  }

  // ─── Stats ───

  /**
   * 从 chrome.storage 加载统计数据
   * @returns {Promise<void>}
   */
  async loadStats() {
    const result = await chrome.storage.local.get(STORAGE_KEYS.STATS);
    this.stats = result[STORAGE_KEYS.STATS] || { total: 0, downloaded: 0, failed: 0 };
  }

  /**
   * 保存统计数据到 chrome.storage
   * @returns {Promise<void>}
   */
  async saveStats() {
    await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: this.stats });
  }

  /**
   * 获取统计数据（返回副本）
   * @returns {Object} 统计对象 { total, downloaded, failed }
   */
  getStats() {
    return { ...this.stats };
  }

  // ─── Filtering ───

  /**
   * 根据过滤条件筛选图片
   * @param {Object} filters - 过滤条件对象
   * @param {string[]} filters.domains - 域名白名单
   * @param {string[]} filters.extensions - 扩展名白名单
   * @param {number} filters.minSize - 最小文件大小（字节）
   * @param {string} filters.search - 搜索关键词（匹配 URL、文件名、域名）
   * @returns {Object[]} 过滤后的图片数组
   */
  getFilteredImages(filters = {}) {
    const { domains = [], extensions = [], minSize = 0, search = '' } = filters;
    return this.images.filter(img => {
      // 域名过滤
      if (domains.length > 0 && !domains.includes(img.domain)) {
        return false;
      }
      // 扩展名过滤
      if (extensions.length > 0) {
        const ext = '.' + (img.filename.split('.').pop() || '').toLowerCase();
        if (!extensions.includes(ext)) return false;
      }
      // 最小大小
      if (minSize > 0 && img.size < minSize) return false;
      // 搜索
      if (search) {
        const haystack = `${img.url} ${img.filename} ${img.domain}`.toLowerCase();
        if (!haystack.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }
}

// 单例
export { ImageStore };
export const store = new ImageStore();
