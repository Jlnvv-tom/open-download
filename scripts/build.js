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
