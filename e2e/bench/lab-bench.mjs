#!/usr/bin/env node
/**
 * Runs the /lab audio benchmark in headless Chromium and prints the results
 * (JSON, then the markdown tables) to stdout. Progress goes to stderr.
 *
 * Usage (from the repo root):
 *   node e2e/bench/lab-bench.mjs [options]
 *
 * Options:
 *   --url <base>        use an already running app (e.g. http://localhost:5173); default: start
 *                       a Vite dev server for apps/web on --port
 *   --port <n>          dev-server port when --url is not given (default 5180)
 *   --nonpermissive     start the dev server with VITE_ENABLE_NONPERMISSIVE_STRETCHERS=1
 *                       (SoundTouch LGPL + Rubber Band GPL; personal use only)
 *   --backends a,b      backends to run (default: every backend the build has)
 *   --runs <n>          timed runs per perf case (default 5)
 *   --warmup <n>        warm-up renders per perf case (default 1)
 *   --bars 8,16         perf loop lengths (default 8,16)
 *   --pool <n>          pool size for the pool column (default 3)
 *   --quick             quick quality suite, perf 8 bars only, short realtime/FLAC
 *   --no-perf | --no-quality | --no-realtime | --no-flac   skip a part
 *   --label <text>      environment label for the report header
 *   --json <file>       also write the JSON to this file
 *
 * Example (what docs/spikes/audio.md was produced with):
 *   node e2e/bench/lab-bench.mjs --nonpermissive \
 *     --label "cloud container (4 vCPU, headless Chromium)" --json lab-bench.json
 */

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

function parseArgs(argv) {
  const a = {
    port: 5180,
    runs: 5,
    warmup: 1,
    bars: [8, 16],
    pool: 3,
    perf: true,
    quality: true,
    realtime: true,
    flac: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--') continue;
    else if (k === '--url') a.url = next();
    else if (k === '--port') a.port = Number(next());
    else if (k === '--nonpermissive') a.nonpermissive = true;
    else if (k === '--backends') a.backends = next().split(',');
    else if (k === '--runs') a.runs = Number(next());
    else if (k === '--warmup') a.warmup = Number(next());
    else if (k === '--bars') a.bars = next().split(',').map(Number);
    else if (k === '--pool') a.pool = Number(next());
    else if (k === '--quick') a.quick = true;
    else if (k === '--no-perf') a.perf = false;
    else if (k === '--no-quality') a.quality = false;
    else if (k === '--no-realtime') a.realtime = false;
    else if (k === '--no-flac') a.flac = false;
    else if (k === '--label') a.label = next();
    else if (k === '--json') a.json = next();
    else throw new Error(`unknown option ${k}`);
  }
  return a;
}

const log = (...m) => process.stderr.write(`${m.join(' ')}\n`);

async function waitForServer(url, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`server at ${url} did not start within ${timeoutMs} ms`);
}

function startDevServer(port, nonpermissive) {
  const env = { ...process.env };
  if (nonpermissive) env.VITE_ENABLE_NONPERMISSIVE_STRETCHERS = '1';
  else delete env.VITE_ENABLE_NONPERMISSIVE_STRETCHERS;
  const child = spawn(
    'pnpm',
    ['--filter', '@stemdeck/web', 'exec', 'vite', '--port', String(port), '--strictPort'],
    { cwd: repoRoot, env, stdio: ['ignore', 'ignore', 'pipe'], detached: true },
  );
  child.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
  return child;
}

function perfCases(bars) {
  return bars.flatMap((b) => [
    { bars: b, ratio: 0.8, semitones: -5 },
    { bars: b, ratio: 0.8, semitones: 5 },
    { bars: b, ratio: 1.25, semitones: -5 },
    { bars: b, ratio: 1.25, semitones: 5 },
    { bars: b, ratio: 1, semitones: 0 },
  ]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let server = null;
  let base = args.url;
  if (!base) {
    base = `http://localhost:${args.port}`;
    log(
      `starting dev server on ${base}${args.nonpermissive ? ' (non-permissive backends ON)' : ''}`,
    );
    server = startDevServer(args.port, args.nonpermissive);
  }
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  let browser;
  try {
    await waitForServer(base, 120_000);
    browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      args: ['--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') log(`[page] ${m.text()}`);
    });
    await page.exposeFunction('__benchProgress', (msg, frac) =>
      log(`${(frac * 100).toFixed(0).padStart(3)}% ${msg}`),
    );
    await page.goto(`${base}/lab`);
    await page.waitForFunction(() => Boolean(window.__stemdeckLab));
    await page.getByTestId('enable-audio').click();
    const options = {
      label: args.label ?? 'headless Chromium',
      ...(args.backends ? { backends: args.backends } : {}),
      perf: args.perf
        ? {
            runs: args.runs,
            warmup: args.warmup,
            poolSize: args.pool,
            cases: perfCases(args.quick ? [8] : args.bars),
          }
        : false,
      quality: args.quality ? { quick: Boolean(args.quick) } : false,
      realtime: args.realtime
        ? { seconds: args.quick ? 8 : 20, live: true, liveSeconds: args.quick ? 4 : 10 }
        : false,
      flac: args.flac ? { seconds: args.quick ? [3] : [3, 30] } : false,
    };
    log(`running ${JSON.stringify(options)}`);
    const t0 = Date.now();
    const results = await page.evaluate(
      (opts) => window.__stemdeckLab.runAll(opts, (m, f) => window.__benchProgress(m, f)),
      options,
    );
    log(`finished in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    const markdown = await page.evaluate((r) => window.__stemdeckLab.toMarkdown(r), results);
    const json = JSON.stringify(results, null, 2);
    if (args.json) writeFileSync(args.json, json);
    process.stdout.write(`${json}\n\n${markdown}\n`);
  } finally {
    await browser?.close();
    if (server) {
      try {
        process.kill(-server.pid, 'SIGTERM');
      } catch {
        server.kill('SIGTERM');
      }
    }
  }
}

main().catch((err) => {
  log(err?.stack ?? String(err));
  process.exit(1);
});
