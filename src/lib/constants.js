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

export const VIDEO_EXTENSIONS = [
  '.mp4', '.webm', '.mov', '.m4v', '.avi', '.mkv',
  '.mpeg', '.mpg', '.3gp', '.m3u8'
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

export const VIDEO_MIME_TYPES = [
  'video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v',
  'video/x-msvideo', 'video/x-matroska', 'video/mpeg',
  'video/3gpp', 'application/vnd.apple.mpegurl',
  'application/x-mpegurl', 'audio/mpegurl'
];

export const MEDIA_TYPES = {
  IMAGE: 'image',
  VIDEO: 'video',
};

export const IMAGE_FORMAT_TABS = [
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp',
  'svg', 'ico', 'avif', 'tiff', 'tif', 'apng'
];

export const VIDEO_FORMAT_TABS = [
  'mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv',
  'mpeg', 'mpg', '3gp', 'm3u8'
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
 * 捕获列表容量上限与预警阈值
 * @type {number}
 */
export const MAX_CAPTURED_IMAGES = 5000;
export const CAPACITY_WARNING_THRESHOLD = 4500;

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
  ui: {
    viewMode: 'list',
    mediaType: 'image',
    contentSize: 104,
    groupByPage: false,   // 列表视图按来源页面分组
    sourceFilter: 'all',  // 来源筛选: 'all' | 'network' | 'dom'
  },
  filters: {
    domains: [],          // 排除的域名列表
    extensions: [],       // 只下载的扩展名 (空 = 全部)
    mediaTypes: [],
    minDimensions: { width: 0, height: 0 }, // 最小尺寸
  },
  // 批量下载策略阈值（V15-01）：超阈值改为逐条直下，规避 ZIP 全内存构建
  transfer: {
    bypassFileSize: 50 * 1024 * 1024,     // 单文件超过此值：整批改直下
    bypassBatchSize: 500 * 1024 * 1024,   // 整批预估超过此值：整批改直下
    // size 未知（DOM 源，无 Content-Length）的视频按此值保守估算；
    // 默认取值高于 bypassFileSize，确保这类视频走直下而不是赌它很小
    unknownVideoSize: 60 * 1024 * 1024,
    maxZipFiles: 200,                     // 单卷最大文件数
    maxZipBytes: 500 * 1024 * 1024,       // 单卷预估字节上限
    maxConcurrencyForLarge: 2,            // 直下大文件时的并发上限
    downloadTimeoutMs: 1800000,           // 直下单文件等待超时（30 分钟）
  },
  // ZIP 打包是否携带 Cookie（V15-02）：默认关闭，需用户显式开启
  sendCookies: false,
  // 站点级捕获规则：{ [domain]: 'block' | 'allow' }，缺省（无键）= 跟随全局开关
  // saveSettings 对该表整表替换，调用方需发送完整表
  siteRules: {},
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
  DOWNLOAD_SELECTED: 'DOWNLOAD_SELECTED', // 批量直下通路，保留给 v1.5 大文件旁路（V15-01）复用
  DOWNLOAD_ONE: 'DOWNLOAD_ONE',
  CANCEL_DOWNLOAD: 'CANCEL_DOWNLOAD',
  DOWNLOAD_ZIP: 'DOWNLOAD_ZIP',
  REMOVE_IMAGE: 'REMOVE_IMAGE',
  UPDATE_SETTINGS: 'UPDATE_SETTINGS',
  GET_SETTINGS: 'GET_SETTINGS',
  DOM_MEDIA_UPDATE: 'DOM_MEDIA_UPDATE',
  SITE_RULES_CHANGED: 'SITE_RULES_CHANGED',
  SCROLL_CAPTURE_START: 'SCROLL_CAPTURE_START',
  SCROLL_CAPTURE_STOP: 'SCROLL_CAPTURE_STOP',
  SCROLL_CAPTURE_STATE: 'SCROLL_CAPTURE_STATE',
  MEDIA_FOUND: 'MEDIA_FOUND',
  MEDIA_DETAILS_UPDATED: 'MEDIA_DETAILS_UPDATED',
  DOWNLOAD_STATUS_CHANGED: 'DOWNLOAD_STATUS_CHANGED',
  UPDATE_MEDIA_STATUSES: 'UPDATE_MEDIA_STATUSES',
  ZIP_OFFSCREEN_READY: 'ZIP_OFFSCREEN_READY',
  ZIP_BUILD_REQUEST: 'ZIP_BUILD_REQUEST',
  ZIP_BUILD_PROGRESS: 'ZIP_BUILD_PROGRESS',
  ZIP_BUILD_RESULT: 'ZIP_BUILD_RESULT',
  ZIP_PROGRESS: 'ZIP_PROGRESS',
};
