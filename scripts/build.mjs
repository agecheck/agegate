#!/usr/bin/env node
/**
 * Copyright (c) 2026 ReallyMe LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Build AgeGate browser bundles for CDN distribution.
 *
 * Why a Node script instead of a shell one-liner:
 * - Cross-platform (macOS/Linux/Windows) path handling
 * - One source of truth for entrypoints/output naming
 * - Explicit failure modes and non-zero exit codes for CI
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const DIST_DIR = path.join(REPO_ROOT, 'dist'); // reserved for future ESM artifacts
const V1_DIR = path.join(REPO_ROOT, 'v1');

const ENTRYPOINTS = [
  { in: path.join(SRC_DIR, 'agegate.js'), outBase: 'agegate' },
  { in: path.join(SRC_DIR, 'easy-agegate.js'), outBase: 'easy-agegate' },
];

const BANNER = [
  '/*',
  ' * AgeCheck AgeGate (CDN bundle)',
  ' * Copyright (c) 2026 ReallyMe LLC',
  ' * SPDX-License-Identifier: Apache-2.0',
  ' * See LICENSE.txt',
  ' * Third-party notices: THIRD_PARTY_NOTICES.txt (includes pako)',
  ' */',
].join('\n');

async function pathExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDistDir() {
  await fs.mkdir(DIST_DIR, { recursive: true });
}

async function ensureV1Dir() {
  await fs.mkdir(V1_DIR, { recursive: true });
}

async function cleanV1Dir({ keepSourcemaps }) {
  // v1/ is intended to be uploaded as-is to the CDN. Keep it free of:
  // - OS/editor junk files
  // - stale sourcemaps from previous local debug builds
  const entries = await fs.readdir(V1_DIR).catch(() => []);
  await Promise.all(
    entries.map(async (name) => {
      if (name === '.DS_Store') {
        await fs.rm(path.join(V1_DIR, name), { force: true });
        return;
      }
      if (!keepSourcemaps && name.endsWith('.map')) {
        await fs.rm(path.join(V1_DIR, name), { force: true });
      }
    })
  );
}

function parseArgs(argv) {
  const out = { minify: false, esm: false, iife: false, sourcemap: false };
  for (const a of argv) {
    if (a === '--minify') out.minify = true;
    else if (a === '--no-minify') out.minify = false;
    else if (a === '--esm') out.esm = true;
    else if (a === '--iife') out.iife = true;
    else if (a === '--sourcemap') out.sourcemap = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else return { error: `unknown arg: ${a}` };
  }
  return out;
}

function usage() {
  // Keep this short; it is shown on CI failures.
  console.log(
    'usage: node scripts/build.mjs [--iife|--esm] [--minify|--no-minify] [--sourcemap]'
  );
}

async function buildOneIife({ in: inputPath, outBase }, minify, sourcemap) {
  // CDN path: historically served at /agegate/v1/*.js
  const outfile = path.join(V1_DIR, `${outBase}${minify ? '.min' : ''}.js`);

  await build({
    entryPoints: [inputPath],
    bundle: true,
    format: 'iife',
    globalName: 'AgeCheck',
    platform: 'browser',
    target: ['es2020'],
    outfile,
    // Sourcemaps are intentionally off by default because v1/ is the CDN upload directory.
    // Keeping maps off reduces recon value and prevents accidental public disclosure of sources.
    sourcemap,
    minify,
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'info',
    banner: {
      js: BANNER,
    },
  });
}

async function buildOneEsm({ in: inputPath, outBase }, minify, sourcemap) {
  // Future-friendly artifact for SDKs; not the default to avoid module/CORS friction.
  const outfile = path.join(DIST_DIR, `${outBase}${minify ? '.min' : ''}.esm.js`);

  await build({
    entryPoints: [inputPath],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    outfile,
    sourcemap,
    minify,
    legalComments: 'none',
    charset: 'utf8',
    logLevel: 'info',
    banner: {
      js: BANNER.replace('(CDN bundle)', '(ESM bundle)'),
    },
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error);
    usage();
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    usage();
    return;
  }

  // Default build is the CDN-friendly IIFE into v1/.
  const doIife = args.iife || (!args.iife && !args.esm);
  const doEsm = args.esm;

  if (doIife) await ensureV1Dir();
  if (doEsm) await ensureDistDir();

  if (doIife) await cleanV1Dir({ keepSourcemaps: args.sourcemap });

  for (const ep of ENTRYPOINTS) {
    if (!(await pathExists(ep.in))) {
      console.error(`missing entrypoint: ${ep.in}`);
      process.exitCode = 2;
      return;
    }
  }

  // Always produce both variants unless the caller explicitly requests one.
  // This keeps CDN deployments simple and prevents accidental "debug builds".
  if (process.argv.includes('--minify') || process.argv.includes('--no-minify')) {
    if (doIife)
      await Promise.all(ENTRYPOINTS.map((ep) => buildOneIife(ep, args.minify, args.sourcemap)));
    if (doEsm)
      await Promise.all(ENTRYPOINTS.map((ep) => buildOneEsm(ep, args.minify, args.sourcemap)));
    return;
  }

  if (doIife) {
    await Promise.all(ENTRYPOINTS.map((ep) => buildOneIife(ep, false, args.sourcemap)));
    await Promise.all(ENTRYPOINTS.map((ep) => buildOneIife(ep, true, args.sourcemap)));
  }
  if (doEsm) {
    await Promise.all(ENTRYPOINTS.map((ep) => buildOneEsm(ep, false, args.sourcemap)));
    await Promise.all(ENTRYPOINTS.map((ep) => buildOneEsm(ep, true, args.sourcemap)));
  }
}

main().catch((err) => {
  console.error('build failed:', err);
  process.exitCode = 1;
});
