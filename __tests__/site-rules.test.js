/**
 * lib/site-rules/* 单元测试（V16-01 平台适配器框架）
 *
 * 引擎全部是纯函数，不依赖 DOM，因此可以在 testEnvironment: "node" 下直接覆盖。
 */

import {
  FIELD_NAMES,
  buildExtractPlan,
  hostMatches,
  matchSiteRule,
  normalizeFieldDescriptor,
  validateRule
} from '../src/lib/site-rules/engine.js';
import { SITE_RULES } from '../src/lib/site-rules/registry.js';

const DEMO_RULE = {
  id: 'demo',
  label: 'Demo gallery',
  version: 2,
  match: { hosts: ['*.demo.com'], pathPattern: '^/gallery' },
  exclusive: true,
  itemSelector: '.gallery-item img',
  excludeSelectors: ['.ad img'],
  fields: {
    url: { from: 'prop', name: 'currentSrc', fallback: { from: 'attr', name: 'data-src' } },
    width: { from: 'prop', name: 'naturalWidth' }
  }
};

describe('hostMatches()', () => {
  test('精确域名只匹配自身', () => {
    expect(hostMatches('example.com', 'example.com')).toBe(true);
    expect(hostMatches('example.com', 'www.example.com')).toBe(false);
  });

  test('星号通配同时匹配裸域与子域', () => {
    expect(hostMatches('*.wikipedia.org', 'wikipedia.org')).toBe(true);
    expect(hostMatches('*.wikipedia.org', 'zh.wikipedia.org')).toBe(true);
    expect(hostMatches('*.wikipedia.org', 'deep.zh.wikipedia.org')).toBe(true);
  });

  test('不应该被相似域名误匹配', () => {
    expect(hostMatches('*.example.com', 'notexample.com')).toBe(false);
    expect(hostMatches('*.example.com', 'example.com.evil.com')).toBe(false);
    expect(hostMatches('*.example.com', 'example.org')).toBe(false);
  });

  test('大小写与空值处理', () => {
    expect(hostMatches('*.Example.COM', 'ZH.wikipedia.org')).toBe(false);
    expect(hostMatches('*.Example.COM', 'Zh.Example.com')).toBe(true);
    expect(hostMatches('', 'example.com')).toBe(false);
    expect(hostMatches('example.com', '')).toBe(false);
  });
});

describe('matchSiteRule()', () => {
  test('域名与路径都命中时返回规则', () => {
    const rule = matchSiteRule({ pageUrl: 'https://sub.demo.com/gallery/1' }, [DEMO_RULE]);
    expect(rule).toBe(DEMO_RULE);
  });

  test('优先使用 payload 里的 pageDomain', () => {
    const rule = matchSiteRule({ pageUrl: 'https://ignored.test/x', pageDomain: 'sub.demo.com' }, [DEMO_RULE]);
    // pageDomain 命中域名，但 pageUrl 的路径不匹配 pathPattern
    expect(rule).toBeNull();
  });

  test('路径不匹配时返回 null', () => {
    const rule = matchSiteRule({ pageUrl: 'https://sub.demo.com/about' }, [DEMO_RULE]);
    expect(rule).toBeNull();
  });

  test('excludePathPattern 命中时跳过该规则', () => {
    const rule = { ...DEMO_RULE, match: { ...DEMO_RULE.match, excludePathPattern: '^/gallery/(ad|sponsor)' } };
    expect(matchSiteRule({ pageUrl: 'https://sub.demo.com/gallery/1' }, [rule])).toBe(rule);
    expect(matchSiteRule({ pageUrl: 'https://sub.demo.com/gallery/ad-1' }, [rule])).toBeNull();
  });

  test('多条规则命中时取第一条（顺序即优先级）', () => {
    const first = { ...DEMO_RULE, id: 'first' };
    const second = { ...DEMO_RULE, id: 'second' };
    expect(matchSiteRule({ pageUrl: 'https://sub.demo.com/gallery/1' }, [first, second]).id).toBe('first');
    expect(matchSiteRule({ pageUrl: 'https://sub.demo.com/gallery/1' }, [second, first]).id).toBe('second');
  });

  test('没有 host 约束的规则不生效，避免误命中所有站点', () => {
    const rule = { ...DEMO_RULE, match: { pathPattern: '^/gallery' } };
    expect(matchSiteRule({ pageUrl: 'https://anything.com/gallery/1' }, [rule])).toBeNull();
  });

  test('非法正则不应该抛错，只视为不匹配', () => {
    const rule = { ...DEMO_RULE, match: { ...DEMO_RULE.match, pathPattern: '([' } };
    expect(() => matchSiteRule({ pageUrl: 'https://sub.demo.com/gallery/1' }, [rule])).not.toThrow();
    expect(matchSiteRule({ pageUrl: 'https://sub.demo.com/gallery/1' }, [rule])).toBeNull();
  });

  test('未知规则列表与空上下文安全返回 null', () => {
    expect(matchSiteRule({}, [])).toBeNull();
    expect(matchSiteRule({ pageUrl: 'not a url' }, [DEMO_RULE])).toBeNull();
  });
});

describe('normalizeFieldDescriptor()', () => {
  test('应该补上字段默认值', () => {
    expect(normalizeFieldDescriptor(undefined, 'url')).toEqual({
      selector: '',
      from: 'prop',
      name: 'currentSrc',
      fallback: { from: 'attr', name: 'src' }
    });
    expect(normalizeFieldDescriptor(undefined, 'duration').name).toBe('duration');
  });

  test('非法来源回落默认来源', () => {
    const descriptor = normalizeFieldDescriptor({ from: 'eval', name: 'data-x' }, 'alt');
    expect(descriptor.from).toBe('attr');
    expect(descriptor.name).toBe('data-x');
  });

  test('无 name 的 fallback 应该被丢弃', () => {
    const descriptor = normalizeFieldDescriptor({ from: 'attr', name: 'src', fallback: { from: 'attr' } }, 'url');
    expect(descriptor.fallback).toBeNull();
  });
});

describe('buildExtractPlan()', () => {
  test('计划必须可 JSON 序列化（跨消息传递的硬要求）', () => {
    const plan = buildExtractPlan(DEMO_RULE);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });

  test('应该补齐全部字段的默认值', () => {
    const plan = buildExtractPlan(DEMO_RULE);
    expect(Object.keys(plan.fields).sort()).toEqual([...FIELD_NAMES].sort());
    expect(plan.fields.poster).toMatchObject({ from: 'attr', name: 'poster' });
  });

  test('exclusive 默认 true，显式 false 时保留', () => {
    expect(buildExtractPlan({ ...DEMO_RULE, exclusive: undefined }).exclusive).toBe(true);
    expect(buildExtractPlan({ ...DEMO_RULE, exclusive: false }).exclusive).toBe(false);
  });

  test('lazy.settleMs 非法值回落 800，超上限被截断', () => {
    expect(buildExtractPlan(DEMO_RULE).lazy.settleMs).toBe(800);
    expect(buildExtractPlan({ ...DEMO_RULE, lazy: { settleMs: 0 } }).lazy.settleMs).toBe(800);
    expect(buildExtractPlan({ ...DEMO_RULE, lazy: { settleMs: 1500 } }).lazy.settleMs).toBe(1500);
    expect(buildExtractPlan({ ...DEMO_RULE, lazy: { settleMs: 999999 } }).lazy.settleMs).toBe(10000);
  });

  test('lazy.moreSelector 默认空串，excludeSelectors 默认空数组', () => {
    const plan = buildExtractPlan({ ...DEMO_RULE, lazy: undefined, excludeSelectors: undefined });
    expect(plan.lazy.moreSelector).toBe('');
    expect(plan.excludeSelectors).toEqual([]);
  });

  test('缺少 itemSelector 时返回 null', () => {
    expect(buildExtractPlan({ ...DEMO_RULE, itemSelector: '' })).toBeNull();
    expect(buildExtractPlan(null)).toBeNull();
  });
});

describe('validateRule()', () => {
  test('内置规则必须全部合法', () => {
    expect(SITE_RULES.length).toBeGreaterThan(0);
    SITE_RULES.forEach(rule => {
      expect(validateRule(rule)).toEqual([]);
    });
  });

  test('内置规则的 id 必须唯一', () => {
    const ids = SITE_RULES.map(rule => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('缺必填字段应该报错', () => {
    expect(validateRule({})).toEqual(expect.arrayContaining([
      'id 必填且为字符串',
      'label 必填且为字符串',
      'version 必须为 >= 1 的整数',
      'match 必填',
      'itemSelector 必填且为字符串',
      'fields 至少声明一个字段'
    ]));
  });

  test('fields.url 缺失或字段名未知应该报错', () => {
    const noUrl = { ...DEMO_RULE, fields: { width: { from: 'prop', name: 'naturalWidth' } } };
    expect(validateRule(noUrl)).toContain('fields.url 必填（无 URL 无法下载）');

    const unknownField = { ...DEMO_RULE, fields: { url: DEMO_RULE.fields.url, size: { from: 'attr', name: 'data-size' } } };
    expect(validateRule(unknownField)).toContain('fields.size 不是支持的字段');
  });

  test('非法正则、空 hosts、非数组 excludeSelectors 应该报错', () => {
    const badPath = { ...DEMO_RULE, match: { hosts: ['*.demo.com'], pathPattern: '([' } };
    expect(validateRule(badPath)).toContain('match.pathPattern 不是合法正则');

    const noHosts = { ...DEMO_RULE, match: {} };
    expect(validateRule(noHosts)).toContain('match.hosts 必须为非空数组');

    const badExclude = { ...DEMO_RULE, excludeSelectors: '.ad img' };
    expect(validateRule(badExclude)).toContain('excludeSelectors 必须为数组');
  });

  test('示例规则应该匹配 Wikipedia 条目页而不匹配其它路径', () => {
    const rule = SITE_RULES.find(item => item.id === 'wikipedia');
    expect(rule).toBeDefined();
    expect(matchSiteRule({ pageUrl: 'https://zh.wikipedia.org/wiki/Open_Download' }, SITE_RULES)).toBe(rule);
    expect(matchSiteRule({ pageUrl: 'https://zh.wikipedia.org/w/index.php?title=X' }, SITE_RULES)).toBeNull();
    expect(matchSiteRule({ pageUrl: 'https://example.com/wiki/X' }, SITE_RULES)).toBeNull();
  });
});
