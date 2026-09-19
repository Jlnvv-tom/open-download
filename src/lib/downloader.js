// lib/downloader.js
// 批量下载管理器 — 并发控制 + 队列

import { MEDIA_TYPES } from './constants.js';
import { generateFilename, sleep, extractDomain } from './utils.js';

// 用户主动取消的 downloadId 集合，用于区分「取消」与「失败」
const cancelledDownloadIds = new Set();

/**
 * 等待某个下载任务完成
 * @param {number} downloadId - Chrome 下载 ID
 * @param {number} timeoutMs - 超时时间（毫秒）
 * @returns {Promise<void>} 下载完成时 resolve，失败时 reject
 * @throws {Error} 下载超时或中断时抛出错误；用户取消时 error.cancelled 为 true
 */
function waitForDownload(downloadId, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.downloads.onChanged.removeListener(listener);
      reject(new Error('下载超时'));
    }, timeoutMs);

    const listener = (delta) => {
      if (delta.id !== downloadId) return;
      if (delta.state) {
        if (delta.state.current === 'complete') {
          clearTimeout(timeout);
          chrome.downloads.onChanged.removeListener(listener);
          resolve();
        } else if (delta.state.current === 'interrupted') {
          clearTimeout(timeout);
          chrome.downloads.onChanged.removeListener(listener);
          const cancelled = cancelledDownloadIds.delete(downloadId);
          const error = new Error(cancelled ? '下载已取消' : (delta.error?.current || '下载中断'));
          error.cancelled = cancelled;
          reject(error);
        }
      }
    };

    chrome.downloads.onChanged.addListener(listener);
  });
}

/**
 * 下载管理器类
 * 负责批量下载的并发控制、队列管理、状态追踪
 * @class DownloadManager
 */
class DownloadManager {
  /**
   * 构造函数
   * @param {ImageStore} store - 图片存储管理器实例
   */
  constructor(store) {
    this.store = store;
    this.active = 0;
    this.maxConcurrency = 3;
    this._listeners = new Set();
    // 进行中的下载 imageId → downloadId，用于取消
    this.activeDownloads = new Map();
    this.cancelRequested = false;
  }

  /**
   * 设置并发下载数
   * @param {number} n - 并发数，范围 1-10
   */
  setConcurrency(n) {
    this.maxConcurrency = Math.max(1, Math.min(10, n));
  }

  /**
   * 注册事件监听器
   * @param {Function} callback - 回调函数，接收 (event, data) 参数
   * @returns {Function} 取消监听的函数
   */
  on(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  /**
   * 触发事件
   * @private
   * @param {string} event - 事件名称
   * @param {Object} data - 事件数据
   */
  _emit(event, data) {
    this._listeners.forEach(cb => cb(event, data));
  }

  /**
   * 下载单个媒体
   * @param {Object} image - 媒体对象
   * @param {string} image.id - 媒体 ID
   * @param {string} image.url - 媒体 URL
   * @param {string} image.domain - 媒体域名
   * @param {string} [image.mediaType] - 媒体类型
   * @param {string} [image.mimeType] - MIME 类型
   * @returns {Promise<Object>} 下载结果对象 { success, downloadId?, error?, cancelled? }
   */
  async downloadImage(image, index = 0) {
    const settings = this.store.getSettings();

    try {
      this.store.updateImageStatus(image.id, 'downloading');
      this._emit('progress', { imageId: image.id, status: 'downloading' });

      const filename = generateFilename(
        image.url,
        settings.fileNaming,
        index,
        image.domain,
        { mediaType: image.mediaType, mimeType: image.mimeType }
      );

      const downloadId = await chrome.downloads.download({
        url: image.url,
        filename: `${settings.savePath}/${filename}`,
        saveAs: false,
        conflictAction: 'uniquify',
      });

      this.activeDownloads.set(image.id, downloadId);
      // 等待下载完成
      await this._waitForDownload(downloadId);

      this.store.updateImageStatus(image.id, 'downloaded');
      this._emit('complete', { imageId: image.id, downloadId, success: true });
      return { success: true, downloadId };
    } catch (error) {
      if (error.cancelled) {
        // 用户取消不算失败：状态回退 pending，不计入 failed 统计
        this.store.updateImageStatus(image.id, 'pending');
        this._emit('cancelled', { imageId: image.id });
        return { success: false, error: error.message, cancelled: true };
      }
      this.store.updateImageStatus(image.id, 'failed', error.message);
      this._emit('error', { imageId: image.id, error: error.message });
      return { success: false, error: error.message };
    } finally {
      this.activeDownloads.delete(image.id);
    }
  }

  /**
   * 等待下载完成
   * @private
   * @param {number} downloadId - Chrome 下载 ID
   * @returns {Promise<void>} 下载完成时 resolve，失败时 reject
   * @throws {Error} 下载超时或中断时抛出错误
   */
  _waitForDownload(downloadId) {
    return waitForDownload(downloadId);
  }

  /**
   * 批量下载图片
   * 使用 Worker 模式并发下载，自动控制并发数
   * @param {Object[]} images - 图片对象数组
   * @returns {Promise<Object[]>} 下载结果数组，每项包含 { image, success, downloadId?, error? }
   */
  async downloadBatch(images) {
    const settings = this.store.getSettings();
    this.setConcurrency(settings.concurrency);

    const results = [];
    const batch = images.map((image, index) => ({ image, index }));

    const worker = async () => {
      while (batch.length > 0) {
        if (this.cancelRequested) break;
        const item = batch.shift();
        if (!item) break;

        this.active++;
        const result = await this.downloadImage(item.image, item.index);
        results.push({ image: item.image, ...result });
        this.active--;

        // 间隔避免过于频繁
        await sleep(300);
      }
    };

    // 启动并发 workers
    const workers = [];
    for (let i = 0; i < this.maxConcurrency; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
    this.cancelRequested = false;
    this._emit('batch-complete', { results });
    return results;
  }

  /**
   * 取消指定媒体的进行中下载
   * @param {string} imageId - 媒体 ID
   * @returns {Promise<boolean>} 是否发起了取消（无进行中任务返回 false）
   */
  async cancelOne(imageId) {
    const downloadId = this.activeDownloads.get(imageId);
    if (downloadId === undefined) return false;
    return this._cancelDownload(downloadId);
  }

  /**
   * 取消所有进行中的下载并停止批量队列
   * @returns {Promise<void>}
   */
  async cancelAll() {
    this.cancelRequested = true;
    await Promise.all(
      Array.from(this.activeDownloads.values()).map(downloadId => this._cancelDownload(downloadId))
    );
    this._emit('cancelled', {});
  }

  /**
   * 调用 chrome.downloads.cancel 取消下载
   * 先登记 cancelledDownloadIds，让 waitForDownload 能区分用户取消
   * @private
   * @param {number} downloadId - Chrome 下载 ID
   * @returns {Promise<boolean>} 是否成功发起取消
   */
  _cancelDownload(downloadId) {
    cancelledDownloadIds.add(downloadId);
    return chrome.downloads.cancel(downloadId)
      .then(() => true)
      .catch(() => {
        // 任务可能刚好已结束；若 onChanged 未再触发，登记项主动清理
        cancelledDownloadIds.delete(downloadId);
        return false;
      });
  }
}

export { DownloadManager, waitForDownload };
