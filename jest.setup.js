/**
 * Jest 测试环境设置
 * 全局 Chrome API Mock
 */

import { jest } from '@jest/globals';

// 将 jest 设为全局变量
global.jest = jest;

// Mock Chrome Extension APIs
global.chrome = {
  storage: {
    local: {
      _data: {},
      async get(keys) {
        const result = {};
        if (typeof keys === 'string') {
          result[keys] = global.chrome.storage.local._data[keys];
        } else if (Array.isArray(keys)) {
          keys.forEach(key => {
            result[key] = global.chrome.storage.local._data[key];
          });
        } else if (typeof keys === 'object') {
          Object.keys(keys).forEach(key => {
            result[key] = global.chrome.storage.local._data[key] !== undefined
              ? global.chrome.storage.local._data[key]
              : keys[key];
          });
        }
        return result;
      },
      async set(items) {
        Object.assign(global.chrome.storage.local._data, items);
      },
      async remove(keys) {
        if (Array.isArray(keys)) {
          keys.forEach(key => delete global.chrome.storage.local._data[key]);
        } else {
          delete global.chrome.storage.local._data[keys];
        }
      },
      async clear() {
        global.chrome.storage.local._data = {};
      },
      _reset() {
        global.chrome.storage.local._data = {};
      }
    }
  },

  downloads: {
    _downloads: new Map(),
    _listeners: new Set(),
    _idCounter: 1,

    async download(options) {
      const id = global.chrome.downloads._idCounter++;
      global.chrome.downloads._downloads.set(id, {
        id,
        url: options.url,
        filename: options.filename,
        state: 'in_progress'
      });

      setTimeout(() => {
        const download = global.chrome.downloads._downloads.get(id);
        if (download) {
          download.state = 'complete';
          global.chrome.downloads._listeners.forEach(listener => {
            listener({ id, state: { current: 'complete' } });
          });
        }
      }, 50);

      return id;
    },

    async cancel(downloadId) {
      const download = global.chrome.downloads._downloads.get(downloadId);
      if (download) {
        download.state = 'interrupted';
        global.chrome.downloads._listeners.forEach(listener => {
          listener({ id: downloadId, state: { current: 'interrupted' } });
        });
      }
    },

    onChanged: {
      addListener(callback) {
        global.chrome.downloads._listeners.add(callback);
      },
      removeListener(callback) {
        global.chrome.downloads._listeners.delete(callback);
      }
    },

    _reset() {
      global.chrome.downloads._downloads.clear();
      global.chrome.downloads._listeners.clear();
      global.chrome.downloads._idCounter = 1;
    },

    _simulateComplete(id) {
      const download = global.chrome.downloads._downloads.get(id);
      if (download) {
        download.state = 'complete';
        global.chrome.downloads._listeners.forEach(listener => {
          listener({ id, state: { current: 'complete' } });
        });
      }
    },

    _simulateError(id) {
      const download = global.chrome.downloads._downloads.get(id);
      if (download) {
        download.state = 'interrupted';
        global.chrome.downloads._listeners.forEach(listener => {
          listener({ id, state: { current: 'interrupted' } });
        });
      }
    }
  },

  runtime: {
    _messageListeners: new Set(),
    onMessage: {
      addListener(callback) {
        global.chrome.runtime._messageListeners.add(callback);
      },
      removeListener(callback) {
        global.chrome.runtime._messageListeners.delete(callback);
      }
    },
    async sendMessage(message) {
      return { success: true };
    },
    onInstalled: {
      addListener(callback) {}
    },
    onStartup: {
      addListener(callback) {}
    },
    _reset() {
      global.chrome.runtime._messageListeners.clear();
    }
  },

  webRequest: {
    _listeners: new Map(),
    onCompleted: {
      addListener(callback, filter, extraInfoSpec) {
        global.chrome.webRequest._listeners.set('onCompleted', callback);
      },
      removeListener(callback) {
        global.chrome.webRequest._listeners.delete('onCompleted');
      }
    },
    onHeadersReceived: {
      addListener(callback, filter, extraInfoSpec) {
        global.chrome.webRequest._listeners.set('onHeadersReceived', callback);
      },
      removeListener(callback) {
        global.chrome.webRequest._listeners.delete('onHeadersReceived');
      }
    },
    _reset() {
      global.chrome.webRequest._listeners.clear();
    }
  },

  tabs: {
    async get(tabId) {
      return {
        id: tabId,
        url: 'https://example.com',
        title: 'Example Page'
      };
    }
  },

  contextMenus: {
    create(options) {},
    remove(menuItemId) {},
    onClicked: {
      addListener(callback) {}
    }
  }
};

// 清理函数
beforeEach(() => {
  global.chrome.storage.local._reset();
  global.chrome.downloads._reset();
  global.chrome.runtime._reset();
  global.chrome.webRequest._reset();
});