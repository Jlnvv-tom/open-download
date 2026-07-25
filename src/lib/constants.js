// lib/constants.js
// 全局常量定义

/**
 * 图片文件扩展名列表
 * @type {string[]}
 */
export const IMAGE_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.svg', '.ico', '.avif', '.tiff', '.tif', '.apng'
];

/**
 * 图片 MIME 类型列表
 * @type {string[]}
 */
export const IMAGE_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'image/bmp', 'image/svg+xml', 'image/x-icon',
  'image/avif', 'image/tiff', 'image/apng'
];

/**
 * 存储键名常量
 * @type {Object.<string, string>}
 */
export const STORAGE_KEYS = {
  CAPTURED_IMAGES: 'captured_images',
  SETTINGS: 'settings',
  STATS: 'stats'
};

/**
 * 默认设置配置
 * @type {Object}
 * @property {boolean} enabled - 是否开启监听
 * @property {boolean} autoDownload - 是否自动下载
 * @property {number} minImageSize - 最小文件大小（字节）
 * @property {number} maxImageSize - 最大文件大小（字节）
 * @property {number} concurrency - 并发下载数
 * @property {string} savePath - 保存目录
 * @property {boolean} dedupe - 是否去重
 * @property {string} fileNaming - 文件命名策略
 * @property {Object} filters - 过滤配置
 */
export const DEFAULT_SETTINGS = {
  enabled: false,
  autoDownload: false,
  minImageSize: 0,        // 最小文件大小 (bytes), 0 = 不限制
  maxImageSize: 0,        // 最大文件大小 (bytes), 0 = 不限制
  concurrency: 3,         // 同时下载数
  savePath: 'OpenDownload', // 下载目录
  dedupe: true,           // 去重
  fileNaming: 'original',  // original | domain | sequential
  filters: {
    domains: [],          // 排除的域名列表
    extensions: [],       // 只下载的扩展名 (空 = 全部)
    minDimensions: { width: 0, height: 0 }, // 最小尺寸
  }
};

/**
 * 消息类型常量
 * @type {Object.<string, string>}
 */
export const MESSAGE_TYPES = {
  TOGGLE_LISTENING: 'TOGGLE_LISTENING',
  GET_STATUS: 'GET_STATUS',
  GET_IMAGES: 'GET_IMAGES',
  CLEAR_IMAGES: 'CLEAR_IMAGES',
  DOWNLOAD_SELECTED: 'DOWNLOAD_SELECTED',
  DOWNLOAD_ALL: 'DOWNLOAD_ALL',
  REMOVE_IMAGE: 'REMOVE_IMAGE',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  GET_SETTINGS: 'GET_SETTINGS',
  IMAGE_FOUND: 'IMAGE_FOUND',
  DOWNLOAD_COMPLETE: 'DOWNLOAD_COMPLETE',
  DOWNLOAD_ERROR: 'DOWNLOAD_ERROR',
  EXPORT_IMAGES: 'EXPORT_IMAGES',
  CONTENT_IMAGES_UPDATE: 'CONTENT_IMAGES_UPDATE',
};
