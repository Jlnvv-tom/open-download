/**
 * Jest 测试环境设置
 * 全局 Chrome API Mock
 */

import { jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// 用真实的中文文案驱动 chrome.i18n mock，保证断言的是实际用户可见文本
const LOCALE = 'zh_CN';
const messages = JSON.parse(
  readFileSync(path.join(process.cwd(), 'src/_locales', LOCALE, 'messages.json'), 'utf8')
);

function substitute(template, args) {
  return template.replace(/\$(\d+)/g, (match, index) => {
    const value = args[Number(index) - 1];
    return value === undefined ? match : String(value);
  });
}

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
    async getContexts(filter = {}) {
      if (filter.contextTypes && !filter.contextTypes.includes('OFFSCREEN_DOCUMENT')) {
        return [];
      }
      return global.chrome.offscreen._exists ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : [];
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

  offscreen: {
    _exists: false,
    _created: 0,
    _closed: 0,

    async createDocument(options) {
      global.chrome.offscreen._created++;
      global.chrome.offscreen._exists = true;
    },

    async closeDocument() {
      global.chrome.offscreen._closed++;
      global.chrome.offscreen._exists = false;
    },

    _reset() {
      global.chrome.offscreen._exists = false;
      global.chrome.offscreen._created = 0;
      global.chrome.offscreen._closed = 0;
    }
  },

  i18n: {
    _locale: LOCALE,

    getMessage(key, args = []) {
      const entry = messages[key];
      if (!entry) return '';
      const list = Array.isArray(args) ? args : [args];
      return substitute(entry.message, list);
    },

    getUILanguage() {
      return LOCALE.replace('_', '-');
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
    _activeTab: { id: 1, url: 'https://example.com', title: 'Example Page' },
    _sentMessages: [],
    _sendMessageError: null,
    _queryError: null,

    async get(tabId) {
      return {
        id: tabId,
        url: 'https://example.com',
        title: 'Example Page'
      };
    },

    async query(queryInfo) {
      if (global.chrome.tabs._queryError) throw new Error(global.chrome.tabs._queryError);
      return [{ ...global.chrome.tabs._activeTab }];
    },

    async sendMessage(tabId, message) {
      if (global.chrome.tabs._sendMessageError) throw new Error(global.chrome.tabs._sendMessageError);
      global.chrome.tabs._sentMessages.push({ tabId, message });
      return { success: true };
    },

    _setActiveTab(tab) {
      global.chrome.tabs._activeTab = tab;
    },

    _reset() {
      global.chrome.tabs._activeTab = { id: 1, url: 'https://example.com', title: 'Example Page' };
      global.chrome.tabs._sentMessages = [];
      global.chrome.tabs._sendMessageError = null;
      global.chrome.tabs._queryError = null;
    }
  },

  contextMenus: {
    _created: [],
    _clickListeners: new Set(),

    create(options) {
      global.chrome.contextMenus._created.push(options);
    },

    remove(menuItemId) {
      global.chrome.contextMenus._created =
        global.chrome.contextMenus._created.filter(item => item.id !== menuItemId);
    },

    onClicked: {
      addListener(callback) {
        global.chrome.contextMenus._clickListeners.add(callback);
      },
      removeListener(callback) {
        global.chrome.contextMenus._clickListeners.delete(callback);
      }
    },

    _trigger(info, tab) {
      global.chrome.contextMenus._clickListeners.forEach(callback => callback(info, tab));
    },

    // 注意：不清空 _clickListeners —— 监听器在模块顶层注册，由模块导入时挂载一次
    _reset() {
      global.chrome.contextMenus._created = [];
    }
  }
};

// 清理函数
beforeEach(() => {
  global.chrome.storage.local._reset();
  global.chrome.downloads._reset();
  global.chrome.runtime._reset();
  global.chrome.webRequest._reset();
  global.chrome.offscreen._reset();
  global.chrome.tabs._reset();
  global.chrome.contextMenus._reset();
});