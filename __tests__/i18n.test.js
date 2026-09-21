/**
 * i18n 一致性与覆盖率测试（V15-03）
 *
 * 注意：jest 的 moduleFileExtensions 只有 "js"，这里用 node:fs 直接读 messages.json
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const srcDir = path.join(rootDir, 'src');
const localeDir = path.join(srcDir, '_locales');

function readMessages(locale) {
  return JSON.parse(readFileSync(path.join(localeDir, locale, 'messages.json'), 'utf8'));
}

const zh = readMessages('zh_CN');
const en = readMessages('en');

// 只扫描源码与 manifest，跳过 _locales 自身的 JSON
function collectSourceFiles(dir) {
  const results = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      if (entry === '_locales' || entry === 'assets') continue;
      results.push(...collectSourceFiles(fullPath));
    } else if (/\.(js|html|json)$/.test(entry)) {
      results.push(fullPath);
    }
  }

  return results;
}

const sourcedFiles = collectSourceFiles(srcDir).map(file => ({
  relativePath: path.relative(rootDir, file),
  content: readFileSync(file, 'utf8'),
}));

function stripComments(content, isHtml) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // 行尾注释：排除 URL 中的 "://" 与转义斜杠
    .replace(/(^|[^:'"\\])\/\/.*$/gm, '$1')
    .replace(isHtml ? /<!--[\s\S]*?-->/g : /(?!)/g, '');
}

const CJK_PATTERN = /[\u4e00-\u9fa5]/;

describe('i18n 文案', () => {
  test('中英文 key 集合应该完全一致', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });

  test('中英文占位符数量应该一致', () => {
    const mismatched = Object.keys(zh).filter(key => {
      const zhCount = (zh[key].message.match(/\$\d+/g) || []).length;
      const enCount = (en[key].message.match(/\$\d+/g) || []).length;
      return zhCount !== enCount;
    });

    expect(mismatched).toEqual([]);
  });

  test('所有文案都应该有非空 message', () => {
    const empty = Object.keys(zh).filter(key => !zh[key].message || !en[key].message);

    expect(empty).toEqual([]);
  });

  test('源码引用的 i18n key 都应该在双语文件中存在', () => {
    const patterns = [
      /\bt\(\s*'([A-Za-z][A-Za-z0-9]*)'/g,
      /data-i18n(?:-placeholder|-title)?="([A-Za-z][A-Za-z0-9]*)"/g,
      /__MSG_([A-Za-z0-9]+)__/g,
    ];

    const referenced = new Set();
    for (const { content } of sourcedFiles) {
      for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          referenced.add(match[1]);
        }
      }
    }

    expect(referenced.size).toBeGreaterThan(50);

    const missing = [...referenced].filter(key => !zh[key] || !en[key]);
    expect(missing).toEqual([]);
  });

  test('manifest 应该声明 default_locale 并使用 __MSG__ 占位', () => {
    const manifestPath = path.join(srcDir, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

    expect(manifest.default_locale).toBe('zh_CN');
    expect(manifest.name).toBe('__MSG_extName__');
    expect(manifest.description).toBe('__MSG_extDesc__');
  });
});

describe('硬编码文案', () => {
  test('popup / options 的 HTML 不应该残留硬编码中文', () => {
    const offenders = sourcedFiles
      .filter(({ relativePath }) => /src[\\/](popup|options)[\\/].*\.html$/.test(relativePath))
      .flatMap(({ relativePath, content }) => {
        const stripped = stripComments(content, true);
        return stripped.split('\n')
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => CJK_PATTERN.test(line))
          .map(({ line, index }) => `${relativePath}:${index + 1}: ${line.trim()}`);
      });

    expect(offenders).toEqual([]);
  });

  test('popup / options 的 JS 不应该残留硬编码中文', () => {
    const offenders = sourcedFiles
      .filter(({ relativePath }) => /src[\\/](popup|options)[\\/].*\.js$/.test(relativePath))
      .flatMap(({ relativePath, content }) => {
        const stripped = stripComments(content, false);
        return stripped.split('\n')
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => CJK_PATTERN.test(line))
          .map(({ line, index }) => `${relativePath}:${index + 1}: ${line.trim()}`);
      });

    expect(offenders).toEqual([]);
  });
});
