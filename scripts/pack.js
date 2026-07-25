#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const packageDir = path.join(rootDir, 'packages');

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, cwd = rootDir) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}

async function pack() {
  run(process.execPath, ['scripts/build.js']);

  if (!await exists(distDir)) {
    throw new Error('dist/ not found after build');
  }

  const manifest = JSON.parse(await readFile(path.join(distDir, 'manifest.json'), 'utf8'));
  const version = manifest.version || '0.0.0';
  const archivePath = path.join(packageDir, `open-download-${version}.zip`);

  await mkdir(packageDir, { recursive: true });
  await rm(archivePath, { force: true });

  run('zip', ['-r', archivePath, '.'], distDir);
  console.log(`Packed Chrome extension to ${path.relative(rootDir, archivePath)}`);
}

pack().catch(error => {
  console.error(error.message);
  process.exit(1);
});
