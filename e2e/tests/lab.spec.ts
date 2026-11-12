import { expect, type Page, test } from '@playwright/test';

/** The subset of the /lab hook (apps/web/src/routes/lab/lab-api.ts) this test uses. */
interface LabResults {
  candidates: { id: string; offlineWorker: boolean | null; error: string | null }[];
  quality: {
    backend: string;
    renders: number;
    exactLength: number;
    onsets: { ratio: number; maxAbsMs: number; missing: number; onsets: number }[];
  }[];
  flac: {
    ok: boolean;
    exactLength: boolean;
    expectedFrames: number;
    decodedFrames: number | null;
    maxErrorLsb: number | null;
    bitExact: boolean;
    error: string | null;
  }[];
}

declare global {
  interface Window {
    __stemdeckLab?: { runAll(options: unknown): Promise<LabResults> };
  }
}

async function openLab(page: Page) {
  await page.goto('/lab');
  await expect(page.getByRole('heading', { level: 1, name: 'Audio lab' })).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__stemdeckLab));
}

async function noHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(clientWidth).toBe(360);
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

test.describe('lab', () => {
  test('short benchmark: Signalsmith renders exact lengths on the grid (±2 ms) and FLAC decodes exactly', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await openLab(page);
    // A real click/tap is the user gesture that unlocks the AudioContext.
    await page.getByTestId('enable-audio').click();
    await expect(page.getByTestId('audio-state')).toContainText('running');

    const r = await page.evaluate(() =>
      (window.__stemdeckLab as NonNullable<Window['__stemdeckLab']>).runAll({
        backends: ['signalsmith'],
        label: 'e2e',
        perf: false,
        quality: { bars: 4, checks: ['onset'], quick: true },
        realtime: false,
        flac: { seconds: [3] },
      }),
    );

    const candidate = r.candidates.find((c) => c.id === 'signalsmith');
    expect(candidate?.error ?? null).toBeNull();
    expect(candidate?.offlineWorker).toBe(true);

    const q = r.quality.find((x) => x.backend === 'signalsmith');
    expect(q).toBeDefined();
    expect(q?.renders).toBeGreaterThan(0);
    expect(q?.exactLength).toBe(q?.renders);
    expect(q?.onsets.length).toBeGreaterThan(0);
    for (const o of q?.onsets ?? []) {
      expect(o.onsets).toBe(16);
      expect(o.missing).toBe(0);
      expect(o.maxAbsMs).toBeLessThanOrEqual(2);
    }

    const flac = r.flac[0];
    expect(flac?.error ?? null).toBeNull();
    expect(flac?.ok).toBe(true);
    expect(flac?.decodedFrames).toBe(flac?.expectedFrames);
    expect(flac?.exactLength).toBe(true);
    // Bit-exact: every decoded float maps back to its original 16-bit value.
    expect(flac?.bitExact).toBe(true);
    expect(flac?.maxErrorLsb ?? 1).toBeLessThan(0.01);

    // The results render into the page.
    await expect(page.getByRole('heading', { name: 'Quality' })).toBeVisible();
  });

  test('A/B: renders variants by touch and switches on the next bar', async ({ page }) => {
    test.setTimeout(120_000);
    await openLab(page);
    await page.getByTestId('enable-audio').click();
    await expect(page.getByTestId('audio-state')).toContainText('running');
    await page.getByRole('button', { name: 'Render variants' }).click();
    const variants = page.getByRole('group', { name: 'Variants' });
    await expect(variants.getByRole('button', { name: /^Original/ })).toBeVisible({
      timeout: 60_000,
    });
    await expect(variants.getByRole('button', { name: 'Signalsmith Stretch' })).toBeVisible();
    await expect(variants.getByRole('button', { name: /realtime/ })).toBeVisible();
    for (const name of [/^Original/, /^Signalsmith Stretch$/, /realtime/]) {
      await variants.getByRole('button', { name }).click();
      await expect(variants.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText(/switches in \d+\.\d+ s \(next bar\)/)).toBeVisible();
    }
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
  });

  test('no horizontal scroll at 360×640, before and after results; controls are on screen', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 360, height: 640 });
    await openLab(page);
    await noHorizontalScroll(page);

    await page.getByTestId('enable-audio').click();
    await page.evaluate(() =>
      (window.__stemdeckLab as NonNullable<Window['__stemdeckLab']>).runAll({
        backends: ['signalsmith'],
        perf: { runs: 1, warmup: 0, cases: [{ bars: 1, ratio: 1.25, semitones: 2 }], poolSize: 1 },
        quality: { bars: 1, checks: ['onset'], quick: true },
        realtime: false,
        flac: { seconds: [1] },
      }),
    );
    await expect(page.getByRole('heading', { name: 'Render time' })).toBeVisible();
    await noHorizontalScroll(page);

    // Every control fits inside the 360 px viewport once scrolled to, and is large enough to tap.
    const controls = page.locator('main button, main select, main input, main summary');
    const count = await controls.count();
    expect(count).toBeGreaterThan(8);
    for (let i = 0; i < count; i++) {
      const c = controls.nth(i);
      if (!(await c.isVisible())) continue;
      await c.scrollIntoViewIfNeeded();
      const box = await c.boundingBox();
      expect(box).not.toBeNull();
      if (!box) continue;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
    }
    for (const name of ['Run benchmark', 'Render variants', 'Play 5 loops', 'Run FLAC test']) {
      const b = page.getByRole('button', { name });
      const box = await b.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});
