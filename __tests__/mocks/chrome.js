/**
 * Chrome API Mocks
 * 用于单元测试中模拟 Chrome Extension API
 */

// Mock chrome.storage API
const mockStorage = {
  local: {
    _data: {},

    async get(keys) {
      const result = {};
      if (typeof keys === 'string') {
        result[keys] = mockStorage.local._data[keys];
      } else if (Array.isArray(keys)) {
        keys.forEach(key => {
          result[key] = mockStorage.local._data[key];
        });
      } else if (typeof keys === 'object') {
        Object.keys(keys).forEach(key => {
          result[key] = mockStorage.local._data[key] || keys[key];
        });
      }
      return result;
    },

    async set(items) {
      Object.assign(mockStorage.local._data, items);
    },

    async remove(keys) {
      if (Array.isArray(keys)) {
        keys.forEach(key => delete mockStorage.local._data[key]);
      } else {
        delete mockStorage.local._data[keys];
      }
    },

    async clear() {
      mockStorage.local._data = {};
    },

    // Test helper
    _reset() {
      mockStorage.local._data = {};
    }
  }
};

// Mock chrome.downloads API
const mockDownloads = {
  _downloads: new Map(),
  _listeners: new Set(),
  _idCounter: 1,

  async download(options) {
    const id = mockDownloads._idCounter++;
    mockDownloads._downloads.set(id, {
      id,
      url: options.url,
      filename: options.filename,
      state: 'in_progress'
    });

    // Simulate async download completion
    setTimeout(() => {
      const download = mockDownloads._downloads.get(id);
      if (download) {
        download.state = 'complete';
        mockDownloads._listeners.forEach(listener => {
          listener({ id, state: { current: 'complete' } });
        });
      }
    }, 100);

    return id;
  },

  async cancel(downloadId) {
    const download = mockDownloads._downloads.get(downloadId);
    if (download) {
      download.state = 'interrupted';
      mockDownloads._listeners.forEach(listener => {
        listener({ id: downloadId, state: { current: 'interrupted' } });
      });
    }
  },

  onChanged: {
    addListener(callback) {
      mockDownloads._listeners.add(callback);
    },
    removeListener(callback) {
      mockDownloads._listeners.delete(callback);
    }
  },

  // Test helpers
  _reset() {
    mockDownloads._downloads.clear();
    mockDownloads._listeners.clear();
    mockDownloads._idCounter = 1;
  },

  _simulateComplete(id) {
    const download = mockDownloads._downloads.get(id);
    if (download) {
      download.state = 'complete';
      mockDownloads._listeners.forEach(listener => {
        listener({ id, state: { current: 'complete' } });
      });
    }
  },

  _simulateError(id) {
    const download = mockDownloads._downloads.get(id);
    if (download) {
      download.state = 'interrupted';
      mockDownloads._listeners.forEach(listener => {
        listener({ id, state: { current: 'interrupted' } });
      });
    }
  }
};

// Mock chrome.runtime API
const mockRuntime = {
  _messageListeners: new Set(),

  onMessage: {
    addListener(callback) {
      mockRuntime._messageListeners.add(callback);
    },
    removeListener(callback) {
      mockRuntime._messageListeners.delete(callback);
    }
  },

  async sendMessage(message) {
    // In tests, this would be mocked per test
    return { success: true };
  },

  onInstalled: {
    addListener(callback) {}
  },

  onStartup: {
    addListener(callback) {}
  },

  // Test helper
  _reset() {
    mockRuntime._messageListeners.clear();
  },

  _simulateMessage(message) {
    mockRuntime._messageListeners.forEach(listener => {
      listener(message, {}, () => {});
    });
  }
};

// Mock chrome.webRequest API
const mockWebRequest = {
  _listeners: new Map(),

  onCompleted: {
    addListener(callback, filter, extraInfoSpec) {
      mockWebRequest._listeners.set('onCompleted', callback);
    },
    removeListener(callback) {
      mockWebRequest._listeners.delete('onCompleted');
    }
  },

  onHeadersReceived: {
    addListener(callback, filter, extraInfoSpec) {
      mockWebRequest._listeners.set('onHeadersReceived', callback);
    },
    removeListener(callback) {
      mockWebRequest._listeners.delete('onHeadersReceived');
    }
  },

  // Test helper
  _reset() {
    mockWebRequest._listeners.clear();
  },

  _simulateRequest(details) {
    const listener = mockWebRequest._listeners.get('onCompleted');
    if (listener) {
      listener(details);
    }
  }
};

// Mock chrome.tabs API
const mockTabs = {
  async get(tabId) {
    return {
      id: tabId,
      url: 'https://example.com',
      title: 'Example Page'
    };
  }
};

// Mock chrome.contextMenus API
const mockContextMenus = {
  create(options) {},
  remove(menuItemId) {},
  onClicked: {
    addListener(callback) {}
  }
};

// Global chrome mock
global.chrome = {
  storage: mockStorage,
  downloads: mockDownloads,
  runtime: mockRuntime,
  webRequest: mockWebRequest,
  tabs: mockTabs,
  contextMenus: mockContextMenus
};

// Export for test use
export {
  mockStorage,
  mockDownloads,
  mockRuntime,
  mockWebRequest,
  mockTabs,
  mockContextMenus
};