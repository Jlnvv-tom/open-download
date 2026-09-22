// lib/site-rules/engine.js
// 站点适配器引擎 — 全部为纯函数，不触碰 DOM，可在 node 测试环境下直接覆盖
//
// 设计要点（见 v1.6 设计文档 FR-1）：
// - content script 是 classic script，不能 import ES module，因此规则匹配在 background 侧完成，
//   产出的「提取计划」必须是可 JSON 序列化的纯数据，经消息下发给 content script；
// - content script 只保留「按计划做 querySelectorAll 并读字段」的薄层，规则逻辑不重复实现。

/** 字段描述符支持的取值来源 */
export const FIELD_SOURCES = ['attr', 'prop', 'dataset', 'text'];

/** 支持的字段名与默认描述符（规则未声明时使用） */
const FIELD_DEFAULTS = {
  url: { selector: '', from: 'prop', name: 'currentSrc', fallback: { from: 'attr', name: 'src' } },
  width: { selector: '', from: 'prop', name: 'naturalWidth', fallback: null },
  height: { selector: '', from: 'prop', name: 'naturalHeight', fallback: null },
  alt: { selector: '', from: 'attr', name: 'alt', fallback: null },
  duration: { selector: '', from: 'prop', name: 'duration', fallback: null },
  poster: { selector: '', from: 'attr', name: 'poster', fallback: null },
};

export const FIELD_NAMES = Object.keys(FIELD_DEFAULTS);

const DEFAULT_SETTLE_MS = 800;
const MAX_SETTLE_MS = 10000;

/**
 * 归一化取值来源描述
 * @param {Object} source - { from, name }
 * @returns {{from: string, name: string}|null} 非法来源返回 null
 */
function normalizeSource(source) {
  if (!source || typeof source !== 'object' || !source.name) return null;
  const from = FIELD_SOURCES.includes(source.from) ? source.from : 'attr';
  return { from, name: String(source.name) };
}

/**
 * 归一化单个字段描述符（补默认值、校验来源）
 * @param {Object} descriptor - 规则中声明的字段描述符
 * @param {string} fieldName - 字段名，用于取默认值
 * @returns {{selector: string, from: string, name: string, fallback: Object|null}}
 */
export function normalizeFieldDescriptor(descriptor = {}, fieldName = '') {
  const base = FIELD_DEFAULTS[fieldName] || { selector: '', from: 'attr', name: '', fallback: null };
  const source = descriptor || {};

  // 区分「未声明 fallback」（用默认值）与「声明了但非法」（丢弃），
  // 后者若回落到默认值会去读一个规则作者没要求的属性
  const hasFallback = source.fallback !== undefined && source.fallback !== null;

  return {
    selector: source.selector || base.selector,
    from: FIELD_SOURCES.includes(source.from) ? source.from : base.from,
    name: source.name ? String(source.name) : base.name,
    fallback: hasFallback ? normalizeSource(source.fallback) : base.fallback,
  };
}

/**
 * 域名匹配：支持精确域名与 `*.` 后缀通配
 * `*.example.com` 同时匹配裸域 example.com 与任意子域（宽容策略，避免漏掉裸域）
 * @param {string} pattern - 规则中的域名模式
 * @param {string} host - 待匹配的域名
 * @returns {boolean} 是否匹配
 */
export function hostMatches(pattern = '', host = '') {
  const normalizedHost = String(host || '').toLowerCase();
  const normalizedPattern = String(pattern || '').toLowerCase().trim();
  if (!normalizedPattern || !normalizedHost) return false;

  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(2);
    if (!suffix) return false;
    return normalizedHost === suffix || normalizedHost.endsWith(`.${suffix}`);
  }

  return normalizedHost === normalizedPattern;
}

/**
 * 安全地测试正则，非法正则返回 false 而不是抛错
 */
function safeTest(pattern, value) {
  if (!pattern) return false;
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return false;
  }
}

function safeHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function safePathname(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

/**
 * 匹配站点规则（顺序即优先级，返回第一条命中的规则）
 * @param {{pageUrl?: string, pageDomain?: string}} target - 页面上下文
 * @param {Object[]} rules - 规则列表
 * @returns {Object|null} 命中的规则，未命中返回 null
 */
export function matchSiteRule(target = {}, rules = []) {
  const host = String(target.pageDomain || '').toLowerCase() || safeHostname(target.pageUrl);
  const path = safePathname(target.pageUrl);

  for (const rule of rules) {
    const match = rule?.match;
    if (!match) continue;

    const hosts = Array.isArray(match.hosts) ? match.hosts : [];
    // 无 host 约束的规则视为不生效：避免一条规则误命中所有站点
    if (hosts.length === 0) continue;
    if (!hosts.some(pattern => hostMatches(pattern, host))) continue;

    if (match.pathPattern && !safeTest(match.pathPattern, path)) continue;
    if (match.excludePathPattern && safeTest(match.excludePathPattern, path)) continue;

    return rule;
  }

  return null;
}

function normalizeSettleMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_SETTLE_MS;
  return Math.min(parsed, MAX_SETTLE_MS);
}

/**
 * 把规则编译为可序列化的提取计划（content script 消费）
 * @param {Object} rule - 命中规则
 * @returns {Object|null} 计划对象；规则缺少 itemSelector 时返回 null
 */
export function buildExtractPlan(rule) {
  if (!rule || typeof rule.itemSelector !== 'string' || !rule.itemSelector) return null;

  const fields = {};
  for (const fieldName of FIELD_NAMES) {
    fields[fieldName] = normalizeFieldDescriptor(rule.fields?.[fieldName], fieldName);
  }

  return {
    ruleId: String(rule.id || ''),
    ruleVersion: Number(rule.version) || 1,
    // 默认 true：命中规则即只采信规则结果，追求精准；声明 false 时与通用兜底结果合并
    exclusive: rule.exclusive !== false,
    itemSelector: rule.itemSelector,
    excludeSelectors: Array.isArray(rule.excludeSelectors) ? [...rule.excludeSelectors] : [],
    fields,
    lazy: {
      moreSelector: rule.lazy?.moreSelector || '',
      settleMs: normalizeSettleMs(rule.lazy?.settleMs),
    },
  };
}

/**
 * 校验规则是否合法（内置规则在单测中必须全部通过）
 * @param {Object} rule - 规则对象
 * @returns {string[]} 错误列表，空数组表示合法
 */
export function validateRule(rule = {}) {
  const errors = [];

  if (!rule || typeof rule !== 'object') return ['规则必须是对象'];
  if (!rule.id || typeof rule.id !== 'string') errors.push('id 必填且为字符串');
  if (!rule.label || typeof rule.label !== 'string') errors.push('label 必填且为字符串');
  if (!Number.isInteger(rule.version) || rule.version < 1) errors.push('version 必须为 >= 1 的整数');

  const match = rule.match;
  if (!match || typeof match !== 'object') {
    errors.push('match 必填');
  } else {
    if (!Array.isArray(match.hosts) || match.hosts.length === 0) {
      errors.push('match.hosts 必须为非空数组');
    }
    for (const key of ['pathPattern', 'excludePathPattern']) {
      const pattern = match[key];
      if (!pattern) continue;
      try {
        new RegExp(pattern);
      } catch {
        errors.push(`match.${key} 不是合法正则`);
      }
    }
  }

  if (!rule.itemSelector || typeof rule.itemSelector !== 'string') {
    errors.push('itemSelector 必填且为字符串');
  }
  if (rule.excludeSelectors !== undefined) {
    if (!Array.isArray(rule.excludeSelectors)) {
      errors.push('excludeSelectors 必须为数组');
    } else {
      rule.excludeSelectors.forEach((selector, index) => {
        if (!selector || typeof selector !== 'string') {
          errors.push(`excludeSelectors[${index}] 必须为非空字符串`);
        }
      });
    }
  }

  const fields = rule.fields;
  if (!fields || typeof fields !== 'object' || Object.keys(fields).length === 0) {
    errors.push('fields 至少声明一个字段');
  } else {
    if (!fields.url) errors.push('fields.url 必填（无 URL 无法下载）');
    for (const fieldName of Object.keys(fields)) {
      if (!FIELD_NAMES.includes(fieldName)) errors.push(`fields.${fieldName} 不是支持的字段`);
    }
    if (fields.url) {
      const urlDescriptor = normalizeFieldDescriptor(fields.url, 'url');
      if (!urlDescriptor.name) errors.push('fields.url 必须能解析出取值名');
    }
  }

  return errors;
}
