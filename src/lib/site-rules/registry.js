// lib/site-rules/registry.js
// 内置站点规则聚合
//
// 不使用 index.js 桶文件（project-structure 规范的反模式条款）：显式命名更利于检索。
// 新增一个站点规则 = 新增一个数据文件 + 在此加一行 import，顺序即匹配优先级。

import { wikipediaRule } from './wikipedia.js';

/** @type {Object[]} 内置规则列表（先匹配者生效） */
export const SITE_RULES = [
  wikipediaRule,
];
