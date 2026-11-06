// lib/theme.js — 主题解析与应用
//
// 只用一份浅色令牌与一份深色令牌，实际主题写入 <html data-theme>；
// 系统偏好变化时仅对「跟随系统」的页面重新解析，用户显式选择不受影响。

import { DEFAULT_SETTINGS } from './constants.js';

const DARK_QUERY = '(prefers-color-scheme: dark)';

let currentPreference = DEFAULT_SETTINGS.ui.theme;

function resolve(preference) {
  if (preference === 'light' || preference === 'dark') return preference;
  return globalThis.matchMedia?.(DARK_QUERY).matches ? 'dark' : 'light';
}

/**
 * 应用主题偏好，返回实际生效的主题
 * @param {string} preference - 'system' | 'light' | 'dark'
 * @returns {string} 'light' | 'dark'
 */
export function applyTheme(preference = DEFAULT_SETTINGS.ui.theme) {
  currentPreference = preference;
  const theme = resolve(preference);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  return theme;
}

export function getTheme() {
  return document.documentElement.dataset.theme || 'light';
}

/**
 * 跟随系统时监听偏好变化
 * @param {(theme: string) => void} [onChange] - 实际主题变化后的回调
 */
export function watchSystemTheme(onChange) {
  const query = globalThis.matchMedia?.(DARK_QUERY);
  if (!query?.addEventListener) return;

  query.addEventListener('change', () => {
    if (currentPreference !== 'system') return;
    const theme = applyTheme('system');
    onChange?.(theme);
  });
}
