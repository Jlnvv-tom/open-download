#!/usr/bin/env node

import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function validateDist() {
  const manifestPath = path.join(distDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const requiredPaths = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_page,
    // offscreen 文档由 background 运行时按需创建，manifest 不静态引用，这里显式校验
    'offscreen/index.html',
    'offscreen/offscreen.js',
    // i18n：default_locale 对应目录必须存在，否则 manifest 的 __MSG_*__ 会解析失败
    manifest.default_locale ? `_locales/${manifest.default_locale}/messages.json` : null,
    ...(manifest.content_scripts || []).flatMap(script => script.js || []),
    ...Object.values(manifest.action?.default_icon || {}),
    ...Object.values(manifest.icons || {}),
  ].filter(Boolean);

  const missing = [];
  for (const relativePath of requiredPaths) {
    if (!await exists(path.join(distDir, relativePath))) {
      missing.push(relativePath);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Build output is missing manifest files: ${missing.join(', ')}`);
  }
}

async function build() {
  if (!await exists(path.join(srcDir, 'manifest.json'))) {
    throw new Error('src/manifest.json not found');
  }

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await cp(srcDir, distDir, {
    recursive: true,
    filter: source => !source.includes(`${path.sep}node_modules${path.sep}`),
  });

  await validateDist();
  console.log('Built Chrome extension to dist/');
}

build().catch(error => {
  console.error(error.message);
  process.exit(1);
});
