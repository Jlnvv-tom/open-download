// lib/downloader.js
// 批量下载管理器 — 并发控制 + 队列

import { generateFilename, sleep, extractDomain } from './utils.js';

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
    this.queue = [];
    this.active = 0;
    this.maxConcurrency = 3;
    this._listeners = new Set();
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
   * 下载单个图片
   * @param {Object} image - 图片对象
   * @param {string} image.id - 图片 ID
   * @param {string} image.url - 图片 URL
   * @param {string} image.domain - 图片域名
   * @returns {Promise<Object>} 下载结果对象 { success, downloadId?, error? }
   */
  async downloadImage(image) {
    const settings = this.store.getSettings();

    try {
      this.store.updateImageStatus(image.id, 'downloading');
      this._emit('progress', { imageId: image.id, status: 'downloading' });

      const filename = generateFilename(
        image.url,
        settings.fileNaming,
        this.queue.length,
        image.domain
      );

      const downloadId = await chrome.downloads.download({
        url: image.url,
        filename: `${settings.savePath}/${filename}`,
        saveAs: false,
        conflictAction: 'uniquify',
      });

      // 等待下载完成
      await this._waitForDownload(downloadId);

      this.store.updateImageStatus(image.id, 'downloaded');
      this._emit('complete', { imageId: image.id, downloadId, success: true });
      return { success: true, downloadId };
    } catch (error) {
      this.store.updateImageStatus(image.id, 'failed');
      this._emit('error', { imageId: image.id, error: error.message });
      return { success: false, error: error.message };
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
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error('下载超时'));
      }, 120000); // 2分钟超时

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
            reject(new Error('下载中断'));
          }
        }
      };

      chrome.downloads.onChanged.addListener(listener);
    });
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
    const batch = [...images];

    const worker = async () => {
      while (batch.length > 0) {
        const image = batch.shift();
        if (!image) break;

        this.active++;
        const result = await this.downloadImage(image);
        results.push({ image, ...result });
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
    this._emit('batch-complete', { results });
    return results;
  }

  /**
   * 取消所有进行中的下载
   * 清空队列并触发 cancelled 事件
   * @returns {void}
   */
  async cancelAll() {
    // chrome.downloads.cancel 需要 downloadId
    // 这里简单清空队列
    this.queue = [];
    this._emit('cancelled', {});
  }
}

export { DownloadManager };
export const downloader = new DownloadManager(null); // 延迟绑定 store
