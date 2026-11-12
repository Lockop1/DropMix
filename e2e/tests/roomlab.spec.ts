/**
 * Rooms spike (task 0D): host (desktop) + players (360×640 touch emulation) against the local
 * room server (`wrangler dev`, started by playwright.config.ts) through the web dev server's
 * `/rooms-api` proxy, exactly as a phone on a tunnel would reach it.
 *
 * Every WebSocket frame each page sends or receives is recorded and checked: only protocol JSON
 * goes over the wire, and nobody ever receives another participant's resume token.
 */

import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  type TestInfo,
  test,
} from '@playwright/test';

const MOBILE = {
  viewport: { width: 360, height: 640 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
} as const;

const CLIENT_TYPES = new Set(['hello', 'ping', 'spike.tap']);
const SERVER_TYPES = new Set(['welcome', 'pong', 'error', 'spike.state']);

interface Participant {
  label: string;
  context: BrowserContext;
  page: Page;
  sent: string[];
  received: string[];
}

function baseURL(info: TestInfo): string {
  return String(info.project.use.baseURL ?? 'http://localhost:5173');
}

async function open(
  browser: Browser,
  info: TestInfo,
  label: string,
  kind: 'desktop' | 'mobile',
): Promise<Participant> {
  const context = await browser.newContext({
    baseURL: baseURL(info),
    ...(kind === 'mobile' ? MOBILE : { viewport: { width: 1280, height: 800 } }),
  });
  const page = await context.newPage();
  const p: Participant = { label, context, page, sent: [], received: [] };
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/rooms-api/parties/room/')) return;
    ws.on('framesent', (f) => p.sent.push(String(f.payload)));
    ws.on('framereceived', (f) => p.received.push(String(f.payload)));
  });
  return p;
}

async function createRoom(host: Participant, query = ''): Promise<string> {
  await host.page.goto(`/roomlab${query}`);
  await host.page.getByRole('button', { name: 'Create room' }).click();
  await expect(host.page).toHaveURL(/\/roomlab\/host\/[A-Z]{4}/);
  if (query) {
    // Keep the query (e.g. ?ping=250) on the host screen.
    await host.page.goto(`${new URL(host.page.url()).pathname}${query}`);
  }
  await expect(host.page.getByTestId('conn-status')).toHaveAttribute('data-status', 'connected');
  const code = (await host.page.getByTestId('room-code').textContent())?.trim() ?? '';
  expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
  return code;
}

async function joinRoom(
  player: Participant,
  code: string,
  name: string,
  glyph: string,
  query = '',
): Promise<string> {
  await player.page.goto(`/roomlab/join/${code}${query}`);
  await player.page.getByLabel('Your name').fill(name);
  await player.page.getByRole('button', { name: glyph, exact: true }).tap();
  await player.page.getByRole('button', { name: 'Join' }).tap();
  await expect(player.page.getByTestId('conn-status')).toHaveAttribute('data-status', 'connected');
  const playerId = await player.page.getByTestId('tap').getAttribute('data-player-id');
  expect(playerId).toMatch(/^p_/);
  return playerId ?? '';
}

/** Navigate away first so each page closes its socket cleanly (pagehide), then drop contexts. */
async function leave(participants: Participant[]) {
  await Promise.all(participants.map((p) => p.page.goto('about:blank')));
  await Promise.all(participants.map((p) => p.context.close()));
}

function hostRow(host: Participant, playerId: string) {
  return host.page.locator(`[data-testid="player-row"][data-player-id="${playerId}"]`);
}

async function noHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(clientWidth).toBe(360);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

/** Every frame is protocol JSON; no one ever receives a token that is not their own. */
function assertWire(participants: Participant[]) {
  const tokenOf = new Map<Participant, Set<string>>();
  for (const p of participants) {
    const mine = new Set<string>();
    for (const raw of p.sent) {
      const msg = JSON.parse(raw) as { t?: unknown; resumeToken?: unknown };
      expect(CLIENT_TYPES.has(String(msg.t)), `${p.label} sent ${raw}`).toBe(true);
    }
    for (const raw of p.received) {
      const msg = JSON.parse(raw) as { t?: unknown; resumeToken?: unknown };
      expect(SERVER_TYPES.has(String(msg.t)), `${p.label} received ${raw}`).toBe(true);
      if (msg.t === 'welcome' && typeof msg.resumeToken === 'string') mine.add(msg.resumeToken);
      else expect(raw, `${p.label}: a token outside welcome`).not.toMatch(/token/i);
    }
    tokenOf.set(p, mine);
  }
  for (const p of participants) {
    for (const [other, tokens] of tokenOf) {
      if (other === p) continue;
      for (const token of tokens) {
        for (const raw of p.received) {
          expect(raw, `${p.label} received ${other.label}'s token`).not.toContain(token);
        }
      }
    }
  }
}

function pct(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? Number.NaN;
}

test.describe('room lab', () => {
  test.describe.configure({ timeout: 120_000 });

  test('taps reach the host, counts match, refreshes keep seats, no token leaks', async ({
    browser,
  }, info) => {
    const host = await open(browser, info, 'host', 'desktop');
    const players = await Promise.all(
      ['p1', 'p2', 'p3'].map((label) => open(browser, info, label, 'mobile')),
    );
    const everyone = [host, ...players];
    const [p1, p2, p3] = players as [Participant, Participant, Participant];

    const code = await createRoom(host);
    await expect(host.page.getByTestId('room-qr')).toHaveAttribute(
      'data-qr-text',
      `${baseURL(info)}/roomlab/join/${code}`,
    );
    const ids = [
      await joinRoom(p1, code, 'Ada', 'Star'),
      await joinRoom(p2, code, 'Bo', 'Wave'),
      await joinRoom(p3, code, 'Cy', 'Moon'),
    ];
    await expect(host.page.getByTestId('player-row')).toHaveCount(3);

    // (a) one tap shows up on the host, highlighted as the last tap.
    await p1.page.getByTestId('tap').tap();
    await expect(hostRow(host, ids[0] ?? '')).toHaveAttribute('data-taps', '1');
    await expect(hostRow(host, ids[0] ?? '')).toHaveAttribute('data-last', 'true');
    await expect(host.page.getByTestId('last-tap')).toHaveAttribute('data-player-id', ids[0] ?? '');

    // More taps; every page agrees on every count.
    for (let i = 0; i < 2; i++) await p1.page.getByTestId('tap').tap();
    for (let i = 0; i < 2; i++) await p2.page.getByTestId('tap').tap();
    await p3.page.getByTestId('tap').tap();
    const expected = [3, 2, 1];
    for (const [i, player] of players.entries()) {
      await expect(hostRow(host, ids[i] ?? '')).toHaveAttribute('data-taps', String(expected[i]));
      await expect(player.page.getByTestId('my-taps')).toHaveText(String(expected[i]));
    }
    await expect(hostRow(host, ids[2] ?? '')).toHaveAttribute('data-last', 'true');

    // 360×640: no horizontal scroll on the player page or the host page.
    await noHorizontalScroll(p1.page);
    await host.page.setViewportSize({ width: 360, height: 640 });
    await noHorizontalScroll(host.page);
    await host.page.setViewportSize({ width: 1280, height: 800 });

    // (c) a player refresh keeps seat, name and taps.
    await p1.page.reload();
    await expect(p1.page.getByTestId('conn-status')).toHaveAttribute('data-status', 'connected');
    await expect(p1.page.getByTestId('tap')).toHaveAttribute('data-player-id', ids[0] ?? '');
    await expect(p1.page.getByTestId('my-name')).toHaveText('Ada');
    await expect(p1.page.getByTestId('my-taps')).toHaveText('3');
    await expect(host.page.getByTestId('player-row')).toHaveCount(3);
    await expect(hostRow(host, ids[0] ?? '')).toHaveAttribute('data-connected', 'true');
    await p1.page.getByTestId('tap').tap();
    await expect(hostRow(host, ids[0] ?? '')).toHaveAttribute('data-taps', '4');

    // (d) a host refresh reclaims the room and shows the same state.
    await host.page.reload();
    await expect(host.page.getByTestId('conn-status')).toHaveAttribute('data-status', 'connected');
    await expect(host.page.getByTestId('room-code')).toHaveText(code);
    await expect(host.page.getByTestId('player-row')).toHaveCount(3);
    for (const [i, n] of [4, 2, 1].entries()) {
      await expect(hostRow(host, ids[i] ?? '')).toHaveAttribute('data-taps', String(n));
    }
    await expect(hostRow(host, ids[1] ?? '').getByTestId('player-name')).toHaveText('Bo');
    await p2.page.getByTestId('tap').tap();
    await expect(hostRow(host, ids[1] ?? '')).toHaveAttribute('data-taps', '3');
    // And /roomlab offers to go back to the hosted room.
    await host.page.goto('/roomlab');
    await expect(host.page.getByTestId('resume-room')).toHaveText(`Back to room ${code}`);

    // (f) wire check over everything above.
    assertWire(everyone);
    await leave(everyone);
  });

  test('a second host is refused and a 9th participant gets room_full', async ({
    browser,
  }, info) => {
    const host = await open(browser, info, 'host', 'desktop');
    const code = await createRoom(host);

    // (e) another device opening the host screen without the host token.
    const intruder = await open(browser, info, 'intruder', 'desktop');
    await intruder.page.goto(`/roomlab/host/${code}`);
    await expect(intruder.page.getByTestId('refused')).toHaveAttribute('data-code', 'not_host');
    await expect(intruder.page.getByTestId('conn-status')).toHaveAttribute(
      'data-status',
      'refused',
    );
    // The real host is unaffected.
    await expect(host.page.getByTestId('conn-status')).toHaveAttribute('data-status', 'connected');

    const seated: Participant[] = [];
    for (let i = 0; i < 7; i++) {
      const p = await open(browser, info, `p${i + 1}`, 'mobile');
      await joinRoom(p, code, `Player ${i + 1}`, 'Dot');
      seated.push(p);
    }
    await expect(host.page.getByTestId('player-row')).toHaveCount(7);

    const ninth = await open(browser, info, 'ninth', 'mobile');
    await ninth.page.goto(`/roomlab/join/${code}`);
    await noHorizontalScroll(ninth.page);
    await ninth.page.getByLabel('Your name').fill('Nine');
    await ninth.page.getByRole('button', { name: 'Join' }).tap();
    await expect(ninth.page.getByTestId('refused')).toHaveAttribute('data-code', 'room_full');
    await noHorizontalScroll(ninth.page);
    await expect(host.page.getByTestId('player-row')).toHaveCount(7);

    // The entry screens fit at 360×640 too.
    await ninth.page.goto('/roomlab/join');
    await noHorizontalScroll(ninth.page);
    await ninth.page.goto('/roomlab');
    await noHorizontalScroll(ninth.page);

    const everyone = [host, intruder, ninth, ...seated];
    assertWire(everyone);
    await leave(everyone);
  });

  test('latency: tap → host DOM update over 200 taps, plus ping round-trip', async ({
    browser,
  }, info) => {
    const TAPS = 200;
    // ≥60 ms between taps keeps each player far below the 20 msg/s rate limit.
    const PACE_MS = 60;
    const query = '?ping=250';
    const host = await open(browser, info, 'host', 'desktop');
    const players = await Promise.all(
      ['p1', 'p2', 'p3'].map((label) => open(browser, info, label, 'mobile')),
    );
    const code = await createRoom(host, query);
    for (const [i, p] of players.entries()) {
      await joinRoom(p, code, `Lat ${i + 1}`, 'Bolt', query);
    }
    await expect(host.page.getByTestId('player-row')).toHaveCount(3);

    // Timestamp each new last-tap id the moment the host's DOM shows it.
    await host.page.evaluate(() => {
      const w = window as unknown as { __seen: Map<string, number> };
      w.__seen = new Map();
      const el = document.querySelector('[data-testid="last-tap"]') as HTMLElement;
      new MutationObserver(() => {
        const id = el.dataset.tapId;
        if (id && !w.__seen.has(id)) w.__seen.set(id, performance.timeOrigin + performance.now());
      }).observe(el, { attributes: true, attributeFilter: ['data-tap-id'] });
    });

    const latencies: number[] = [];
    for (let i = 0; i < TAPS; i++) {
      const player = players[i % players.length] as Participant;
      const { t0, tapId } = await player.page.evaluate(() => {
        const b = document.querySelector('[data-testid="tap"]') as HTMLButtonElement;
        const start = performance.timeOrigin + performance.now();
        b.click();
        return { t0: start, tapId: b.dataset.lastTapId ?? '' };
      });
      expect(tapId).not.toBe('');
      await host.page.waitForFunction(
        (id) => (window as unknown as { __seen: Map<string, number> }).__seen.has(id),
        tapId,
      );
      const t1 = await host.page.evaluate(
        (id) => (window as unknown as { __seen: Map<string, number> }).__seen.get(id) ?? 0,
        tapId,
      );
      latencies.push(t1 - t0);
      await host.page.waitForTimeout(PACE_MS);
    }

    // Counts still agree everywhere after the run.
    const total = await host.page
      .getByTestId('player-row')
      .evaluateAll((rows) => rows.reduce((s, r) => s + Number(r.getAttribute('data-taps')), 0));
    expect(total).toBe(TAPS);
    for (const p of players) {
      const id = (await p.page.getByTestId('tap').getAttribute('data-player-id')) ?? '';
      const onHost = await hostRow(host, id).getAttribute('data-taps');
      await expect(p.page.getByTestId('my-taps')).toHaveText(onHost ?? '');
    }

    const pings = await Promise.all(
      [host, ...players].map((p) =>
        p.page.getByTestId('ping').evaluate((el) => ({
          p50: Number(el.getAttribute('data-p50')),
          p95: Number(el.getAttribute('data-p95')),
          n: Number(el.getAttribute('data-n')),
        })),
      ),
    );
    const result = {
      taps: latencies.length,
      tapToHost: {
        p50: pct(latencies, 50),
        p95: pct(latencies, 95),
        max: Math.max(...latencies),
      },
      ping: pings.map((p, i) => ({ page: i === 0 ? 'host' : `p${i}`, ...p })),
    };
    const fmt = (n: number) => n.toFixed(1);
    console.log(
      `[roomlab latency, ${info.project.name}] tap→host over ${result.taps} taps: p50 ${fmt(result.tapToHost.p50)} ms, p95 ${fmt(result.tapToHost.p95)} ms, max ${fmt(result.tapToHost.max)} ms; ping ${result.ping
        .map((p) => `${p.page} p50 ${fmt(p.p50)}/p95 ${fmt(p.p95)} (n=${p.n})`)
        .join(', ')}`,
    );
    await info.attach('rooms-latency.json', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    });

    expect(latencies.length).toBeGreaterThanOrEqual(200);
    // Budget (BUILD_PROMPT §16.2): p95 intent → host board ≤ 250 ms. Loopback must beat it easily.
    expect(result.tapToHost.p95).toBeLessThanOrEqual(250);
    for (const p of pings) expect(p.n).toBeGreaterThan(0);

    assertWire([host, ...players]);
    await leave([host, ...players]);
  });
});
