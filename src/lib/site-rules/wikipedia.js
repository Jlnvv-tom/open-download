// lib/site-rules/wikipedia.js
// 本期唯一内置的示例规则：Wikipedia 正文图片
//
// 选它的理由（见 v1.6 设计文档 FR-1 方案六）：
// - 站点公开、无登录墙、结构长期稳定，不触碰任何平台的高风险区域；
// - 它恰好是「通用兜底噪音」的典型场景：编辑链接图标、语言图标、静态 UI 图都会被通用扫描收进来。

export const wikipediaRule = {
  id: 'wikipedia',
  label: 'Wikipedia article',
  version: 1,
  match: {
    hosts: ['*.wikipedia.org'],
    pathPattern: '^/wiki/',
  },
  // 只采信规则结果：命中时不再叠加通用兜底，以排除站点 UI 图片
  exclusive: true,
  itemSelector: '#mw-content-text img',
  excludeSelectors: [
    '.mw-editsection img',
    '.navbox img',
    '.metadata img',
    '.mbox-image img',
    'img[src*="/static/"]',
  ],
  fields: {
    url: {
      from: 'prop',
      name: 'currentSrc',
      // 懒加载图在 currentSrc 就绪前回退读属性
      fallback: { from: 'attr', name: 'src' },
    },
    width: { from: 'prop', name: 'naturalWidth' },
    height: { from: 'prop', name: 'naturalHeight' },
    alt: { from: 'attr', name: 'alt' },
  },
  // 该站点无「加载更多」按钮，不声明 lazy：滚动抓取沿用默认的滚动策略
};
