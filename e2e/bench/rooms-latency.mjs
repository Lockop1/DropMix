#!/usr/bin/env node
/**
 * Rooms spike latency bench (task 0D).
 *
 * Drives a host page (desktop) and N player pages (360×640 touch emulation) in headless
 * Chromium against an already running web dev server + room server, and reports:
 *   - tap → host DOM update latency (p50 / p95 / max) over --taps taps,
 *   - ping round-trip p50 / p95 per page (measured by the pages themselves),
 *   - time for a refreshed player page / host page to be back in its seat.
 *
 * Usage (from the repo root, with `pnpm dev` and `pnpm dev:rooms` running):
 *   node e2e/bench/rooms-latency.mjs [--base http://localhost:5173] [--taps 300] [--players 3]
 *                                    [--pace 60] [--ping 250] [--reloads 5] [--json out.json]
 *
 * Both timestamps of a tap are taken inside the browser (performance.timeOrigin + now()), so
 * the numbers do not include Playwright's own round trips. On loopback this is a floor: a real
 * phone on Wi-Fi/cellular through a tunnel adds its network round trip on top.
 */

import { writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}

const base = String(arg('base', 'http://localhost:5173')).replace(/\/+$/, '');
const TAPS = Number(arg('taps', 300));
const PLAYERS = Number(arg('players', 3));
const PACE_MS = Number(arg('pace', 60));
const PING_MS = Number(arg('ping', 250));
const RELOADS = Number(arg('reloads', 5));
const jsonOut = arg('json', null);

const MOBILE = {
  viewport: { width: 360, height: 640 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
};

function pct(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? Number.NaN;
}
const median = (v) => pct(v, 50);
const fmt = (n) => (Number.isFinite(n) ? n.toFixed(1) : '–');

async function reachable() {
  try {
    const res = await fetch(`${base}/rooms-api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

async function waitConnected(page) {
  await page.waitForSelector('[data-testid="conn-status"][data-status="connected"]', {
    timeout: 15_000,
  });
}

async function main() {
  if (!(await reachable())) {
    console.error(
      `Cannot reach ${base}/rooms-api/health. Start the web app (pnpm dev) and the room server ` +
        '(pnpm dev:rooms) first.',
    );
    process.exit(1);
  }
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const q = `?ping=${PING_MS}`;
  try {
    const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const host = await hostCtx.newPage();
    await host.goto(`${base}/roomlab`);
    await host.getByRole('button', { name: 'Create room' }).click();
    await host.waitForURL(/\/roomlab\/host\/[A-Z]{4}/);
    const code = new URL(host.url()).pathname.split('/').at(-1);
    await host.goto(`${base}/roomlab/host/${code}${q}`);
    await waitConnected(host);

    const players = [];
    for (let i = 0; i < PLAYERS; i++) {
      const ctx = await browser.newContext(MOBILE);
      const page = await ctx.newPage();
      await page.goto(`${base}/roomlab/join/${code}${q}`);
      await page.getByLabel('Your name').fill(`Bench ${i + 1}`);
      await page.getByRole('button', { name: 'Join' }).tap();
      await waitConnected(page);
      players.push(page);
    }

    await host.evaluate(() => {
      window.__seen = new Map();
      const el = document.querySelector('[data-testid="last-tap"]');
      new MutationObserver(() => {
        const id = el.dataset.tapId;
        if (id && !window.__seen.has(id)) {
          window.__seen.set(id, performance.timeOrigin + performance.now());
        }
      }).observe(el, { attributes: true, attributeFilter: ['data-tap-id'] });
    });

    const latencies = [];
    for (let i = 0; i < TAPS; i++) {
      const page = players[i % players.length];
      const { t0, tapId } = await page.evaluate(() => {
        const b = document.querySelector('[data-testid="tap"]');
        const start = performance.timeOrigin + performance.now();
        b.click();
        return { t0: start, tapId: b.dataset.lastTapId ?? '' };
      });
      if (!tapId) throw new Error(`tap ${i} was not sent`);
      await host.waitForFunction((id) => window.__seen.has(id), tapId, { timeout: 10_000 });
      const t1 = await host.evaluate((id) => window.__seen.get(id), tapId);
      latencies.push(t1 - t0);
      await host.waitForTimeout(PACE_MS);
    }

    const pages = [['host', host], ...players.map((p, i) => [`player ${i + 1}`, p])];
    const pings = [];
    for (const [label, page] of pages) {
      const s = await page.getByTestId('ping').evaluate((el) => ({
        p50: Number(el.getAttribute('data-p50')),
        p95: Number(el.getAttribute('data-p95')),
        n: Number(el.getAttribute('data-n')),
      }));
      pings.push({ page: label, ...s });
    }

    // Reconnect: time from reload() until the page is back in its seat with the right count.
    const playerReload = [];
    const p0 = players[0];
    const taps0 = await p0.getByTestId('my-taps').textContent();
    for (let i = 0; i < RELOADS; i++) {
      const t = performance.now();
      await p0.reload();
      await waitConnected(p0);
      await p0.waitForFunction(
        (n) => document.querySelector('[data-testid="my-taps"]')?.textContent === n,
        taps0,
      );
      playerReload.push(performance.now() - t);
    }
    const hostReload = [];
    for (let i = 0; i < RELOADS; i++) {
      const t = performance.now();
      await host.reload();
      await waitConnected(host);
      await host.waitForFunction(
        (n) => document.querySelectorAll('[data-testid="player-row"]').length === n,
        PLAYERS,
      );
      hostReload.push(performance.now() - t);
    }

    const result = {
      measuredAt: new Date().toISOString(),
      base,
      players: PLAYERS,
      taps: latencies.length,
      paceMs: PACE_MS,
      pingIntervalMs: PING_MS,
      tapToHostMs: {
        p50: pct(latencies, 50),
        p95: pct(latencies, 95),
        max: Math.max(...latencies),
      },
      pingRttMs: pings,
      reloadToSeatMs: {
        player: { median: median(playerReload), max: Math.max(...playerReload), n: RELOADS },
        host: { median: median(hostReload), max: Math.max(...hostReload), n: RELOADS },
      },
    };

    console.log(`\nRooms latency bench — ${result.measuredAt}, ${base}, room ${code}\n`);
    console.log('| Metric | p50 | p95 | max | n |');
    console.log('|---|---|---|---|---|');
    console.log(
      `| tap → host DOM update | ${fmt(result.tapToHostMs.p50)} ms | ${fmt(result.tapToHostMs.p95)} ms | ${fmt(result.tapToHostMs.max)} ms | ${result.taps} |`,
    );
    for (const p of pings) {
      console.log(`| ping RTT (${p.page}) | ${fmt(p.p50)} ms | ${fmt(p.p95)} ms | – | ${p.n} |`);
    }
    console.log(
      `| player reload → back in seat | ${fmt(result.reloadToSeatMs.player.median)} ms | – | ${fmt(result.reloadToSeatMs.player.max)} ms | ${RELOADS} |`,
    );
    console.log(
      `| host reload → room reclaimed | ${fmt(result.reloadToSeatMs.host.median)} ms | – | ${fmt(result.reloadToSeatMs.host.max)} ms | ${RELOADS} |`,
    );
    if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify(result, null, 2)}\n`);
    for (const page of [host, ...players]) await page.goto('about:blank');
  } finally {
    await browser.close();
  }
}

await main();
