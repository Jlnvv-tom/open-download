// lib/i18n.js
// chrome.i18n 的轻量封装：统一取值与缺失回落，并支持按属性批量替换静态文案
//
// 文案源：src/_locales/{zh_CN,en}/messages.json（新增语言只需新增目录）
// 占位符使用 chrome.i18n 的位置参数 $1/$2，无需声明 placeholders

/**
 * 取一条本地化文案
 * @param {string} key - messages.json 中的键
 * @param {...(string|number)} args - 位置参数，依次替换 $1/$2 ...
 * @returns {string} 本地化文案；缺失时回落返回 key 本身，便于发现漏翻译
 */
export function t(key, ...args) {
  let message = '';
  try {
    message = chrome.i18n?.getMessage(key, args.map(String)) || '';
  } catch {
    message = '';
  }
  return message || key;
}

/**
 * 替换静态 DOM 文案
 * 支持的属性：data-i18n（textContent）、data-i18n-placeholder、data-i18n-title
 * @param {ParentNode} root - 扫描根节点，默认 document
 */
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(node => {
    node.textContent = t(node.dataset.i18n);
  });

  root.querySelectorAll('[data-i18n-placeholder]').forEach(node => {
    node.placeholder = t(node.dataset.i18nPlaceholder);
  });

  root.querySelectorAll('[data-i18n-title]').forEach(node => {
    node.title = t(node.dataset.i18nTitle);
  });
}
