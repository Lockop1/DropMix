import { describe, expect, it } from 'vitest';
import { joinUrl, resolveRoomsEndpoint } from './config';
import { qrPath } from './QrCode';
import { percentile, summarize } from './stats';

describe('room server endpoint', () => {
  it('defaults to the same-origin /rooms-api proxy path', () => {
    expect(resolveRoomsEndpoint('', 'http://localhost:5173/roomlab')).toEqual({
      http: 'http://localhost:5173/rooms-api',
      host: 'localhost:5173',
      prefix: 'rooms-api/parties',
      protocol: 'ws',
    });
  });

  it('uses wss behind an https tunnel', () => {
    expect(resolveRoomsEndpoint('', 'https://abc.trycloudflare.com/roomlab/join/ABCD')).toEqual({
      http: 'https://abc.trycloudflare.com/rooms-api',
      host: 'abc.trycloudflare.com',
      prefix: 'rooms-api/parties',
      protocol: 'wss',
    });
  });

  it('VITE_ROOMS_URL can point straight at wrangler dev', () => {
    expect(resolveRoomsEndpoint('http://localhost:8787', 'http://localhost:5173/')).toEqual({
      http: 'http://localhost:8787',
      host: 'localhost:8787',
      prefix: 'parties',
      protocol: 'ws',
    });
    expect(resolveRoomsEndpoint('https://rooms.example/api/', 'http://x/').prefix).toBe(
      'api/parties',
    );
  });

  it('builds the join link for the QR code', () => {
    expect(joinUrl('ABCD', 'https://abc.trycloudflare.com')).toBe(
      'https://abc.trycloudflare.com/roomlab/join/ABCD',
    );
  });
});

describe('stats', () => {
  it('nearest-rank percentiles', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 95)).toBe(95);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
    expect(summarize([3, 1, 2])).toEqual({ last: 2, p50: 2, p95: 3, n: 3 });
  });
});

describe('QR code', () => {
  it('is generated locally as a square module grid', () => {
    const { size, d } = qrPath('https://abc.trycloudflare.com/roomlab/join/ABCD');
    expect(size).toBeGreaterThanOrEqual(21);
    expect((size - 17) % 4).toBe(0); // QR sizes are 17 + 4·version
    expect(d).toMatch(/^M\d+ \d+h1v1h-1z/);
  });
});
