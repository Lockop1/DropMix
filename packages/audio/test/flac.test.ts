/// <reference types="node" />
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BitWriter,
  crc8,
  crc16,
  encodeFlac,
  encodeFlacFromFloat,
  quantize,
  utf8CodedNumber,
} from '../src/flac/encoder';
import { generateSignal } from '../src/signals/generators';

const ascii = (s: string) => new TextEncoder().encode(s);

describe('FLAC CRCs', () => {
  it('CRC-8 (poly 0x07) matches the standard check value', () => {
    expect(crc8(ascii('123456789'))).toBe(0xf4);
  });
  it('CRC-16 (poly 0x8005, init 0) matches the standard check value', () => {
    expect(crc16(ascii('123456789'))).toBe(0xfee8);
  });
  it('a frame including its own CRC-16 checks to zero', () => {
    const { flac } = encodeFlacFromFloat([new Float32Array(100).fill(0.25)], { sampleRate: 44100 });
    const frame = flac.subarray(42);
    expect(crc16(frame)).toBe(0);
  });
});

describe('FLAC bit writer and coded numbers', () => {
  it('writes MSB-first across byte boundaries', () => {
    const w = new BitWriter(2);
    w.write(0b101, 3);
    w.write(0b11111, 5);
    w.write(0xabc, 12);
    w.align();
    expect([...w.bytes()]).toEqual([0b10111111, 0xab, 0xc0]);
  });
  it('codes frame numbers like UTF-8', () => {
    expect([...utf8CodedNumber(0x7f)]).toEqual([0x7f]);
    expect([...utf8CodedNumber(0x80)]).toEqual([0xc2, 0x80]);
    expect([...utf8CodedNumber(0x7ff)]).toEqual([0xdf, 0xbf]);
    expect([...utf8CodedNumber(0x800)]).toEqual([0xe0, 0xa0, 0x80]);
    expect([...utf8CodedNumber(0xffff)]).toEqual([0xef, 0xbf, 0xbf]);
    expect(utf8CodedNumber(2 ** 36 - 1).length).toBe(7);
  });
});

describe('FLAC stream structure', () => {
  const sig = generateSignal('pad', { bars: 1, handleBars: 0 });
  const { flac, pcm } = encodeFlacFromFloat(sig.channels, { sampleRate: 44100 });
  const frames = Math.ceil(sig.layout.totalFrames / 4096);

  it('starts with fLaC and a last-block STREAMINFO of 34 bytes', () => {
    expect([...flac.subarray(0, 4)]).toEqual([0x66, 0x4c, 0x61, 0x43]);
    expect(flac[4]).toBe(0x80);
    expect((flac[5] as number) * 65536 + (flac[6] as number) * 256 + (flac[7] as number)).toBe(34);
  });

  it('STREAMINFO carries sample rate, channels, bits and the exact total sample count', () => {
    const si = flac.subarray(8, 42);
    const bits = [...si].map((b) => b.toString(2).padStart(8, '0')).join('');
    const field = (from: number, len: number) => Number.parseInt(bits.slice(from, from + len), 2);
    expect(field(0, 16)).toBe(4096);
    expect(field(80, 20)).toBe(44100);
    expect(field(100, 3) + 1).toBe(2);
    expect(field(103, 5) + 1).toBe(16);
    expect(field(108, 36)).toBe(sig.layout.totalFrames);
  });

  it('VERBATIM size: every frame is header + 2 × (1 + 2n) + CRC', () => {
    const payload = 2 * (1 + 2 * sig.layout.totalFrames);
    const overhead = flac.length - 42 - payload;
    // 6–9 header bytes (+2 for an explicit last block size) and 2 CRC bytes per frame.
    expect(overhead).toBeGreaterThanOrEqual(frames * 8);
    expect(overhead).toBeLessThanOrEqual(frames * 11 + 2);
  });

  it('quantizes deterministically with clamping', () => {
    expect([...quantize(Float32Array.of(-1.5, -1, 0, 0.5, 1, 2), 16)]).toEqual([
      -32768, -32768, 0, 16384, 32767, 32767,
    ]);
    expect(pcm[0]?.length).toBe(sig.layout.totalFrames);
  });

  it('rejects bad input', () => {
    expect(() => encodeFlac([], { sampleRate: 44100 })).toThrow(RangeError);
    expect(() =>
      encodeFlac([new Int32Array(10), new Int32Array(9)], { sampleRate: 44100 }),
    ).toThrow(RangeError);
  });
});

const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

describe.skipIf(!hasFfmpeg)('FLAC round-trip through ffmpeg', () => {
  for (const [label, frames] of [
    ['several full blocks plus a short last block', 4096 * 5 + 123],
    ['a single short block', 1000],
  ] as const) {
    it(`decodes sample-exact: ${label}`, () => {
      const dir = mkdtempSync(join(tmpdir(), 'stemdeck-flac-'));
      try {
        const sig = generateSignal('drums', { bars: 2, handleBars: 0 });
        const channels = sig.channels.map((c) => c.slice(0, frames));
        const { flac, pcm } = encodeFlacFromFloat(channels, { sampleRate: 44100 });
        const file = join(dir, 'test.flac');
        writeFileSync(file, flac);
        const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 's16le', '-'], {
          maxBuffer: 64 * 1024 * 1024,
        });
        const decoded = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength / 2);
        expect(decoded.length).toBe(frames * 2);
        for (let i = 0; i < frames; i++) {
          expect(decoded[2 * i]).toBe(pcm[0]?.[i]);
          expect(decoded[2 * i + 1]).toBe(pcm[1]?.[i]);
        }
        // ffmpeg's own FLAC parser validates the CRCs: a strict decode must also be clean.
        const strict = spawnSync('ffmpeg', [
          '-v',
          'error',
          '-err_detect',
          'crccheck+explode',
          '-i',
          file,
          '-f',
          'null',
          '-',
        ]);
        expect(strict.status).toBe(0);
        expect(strict.stderr.toString()).toBe('');
        // …and that check is real: one flipped sample bit must fail it.
        const corrupt = flac.slice();
        corrupt[200] = (corrupt[200] as number) ^ 0x01;
        writeFileSync(file, corrupt);
        const bad = spawnSync('ffmpeg', [
          '-v',
          'error',
          '-err_detect',
          'crccheck+explode',
          '-i',
          file,
          '-f',
          'null',
          '-',
        ]);
        expect(bad.stderr.toString()).toMatch(/crc|error|invalid/i);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
