/**
 * Minimal FLAC encoder: STREAMINFO + fixed-blocksize frames with VERBATIM subframes.
 *
 * Purpose: generate FLAC streams in the browser (no committed audio files) to test
 * `decodeAudioData` exactness on each device. The output is a valid FLAC stream
 * (RFC 9639): correct frame headers, CRC-8 header checksums, CRC-16 frame checksums and a
 * STREAMINFO block. It does not compress (VERBATIM ≈ PCM size) and leaves the MD5 at zero,
 * which the format defines as "not computed".
 */

/** CRC-8, polynomial x^8 + x^2 + x + 1 (0x07), init 0 — the FLAC frame-header CRC. */
export function crc8(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc ^= bytes[i] as number;
    for (let b = 0; b < 8; b++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

/** CRC-16, polynomial x^16 + x^15 + x^2 + 1 (0x8005), init 0 — the FLAC frame CRC. */
export function crc16(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc ^= (bytes[i] as number) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** MSB-first bit writer over a growable byte buffer. */
export class BitWriter {
  private buf: Uint8Array;
  private bytePos = 0;
  private bitPos = 0; // bits already used in buf[bytePos]

  constructor(initialBytes = 1024) {
    this.buf = new Uint8Array(initialBytes);
  }

  get byteLength(): number {
    return this.bytePos + (this.bitPos > 0 ? 1 : 0);
  }

  get aligned(): boolean {
    return this.bitPos === 0;
  }

  private ensure(extraBytes: number) {
    if (this.bytePos + extraBytes + 1 <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.bytePos + extraBytes + 1) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf);
    this.buf = next;
  }

  /** Writes the low `bits` bits of `value` (bits ≤ 32; value treated as unsigned). */
  write(value: number, bits: number): void {
    if (bits < 0 || bits > 32) throw new RangeError('BitWriter.write: 0…32 bits');
    this.ensure(5);
    if (this.bitPos === 0 && bits % 8 === 0) {
      // Fast path: whole bytes on a byte boundary (all VERBATIM 16/24-bit samples).
      const v = value >>> 0;
      for (let shift = bits - 8; shift >= 0; shift -= 8) {
        this.buf[this.bytePos++] = (v >>> shift) & 0xff;
      }
      return;
    }
    for (let i = bits - 1; i >= 0; i--) {
      const bit = Math.floor(value / 2 ** i) % 2;
      if (bit) this.buf[this.bytePos] = (this.buf[this.bytePos] as number) | (0x80 >> this.bitPos);
      this.bitPos++;
      if (this.bitPos === 8) {
        this.bitPos = 0;
        this.bytePos++;
      }
    }
  }

  /** Writes a value wider than 32 bits (e.g. the 36-bit total-samples field). */
  writeBig(value: number, bits: number): void {
    if (bits <= 32) {
      this.write(value, bits);
      return;
    }
    const high = Math.floor(value / 2 ** 32);
    this.write(high, bits - 32);
    this.write(value >>> 0, 32);
  }

  writeBytes(bytes: Uint8Array): void {
    if (!this.aligned) throw new Error('BitWriter.writeBytes: not byte-aligned');
    this.ensure(bytes.length);
    this.buf.set(bytes, this.bytePos);
    this.bytePos += bytes.length;
  }

  /** Pads with zero bits to the next byte boundary. */
  align(): void {
    if (this.bitPos > 0) {
      this.bitPos = 0;
      this.bytePos++;
    }
  }

  /** Bytes written so far (a view; copy before writing more). */
  view(): Uint8Array {
    return this.buf.subarray(0, this.byteLength);
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.byteLength);
  }
}

/** FLAC "UTF-8" coded number (frame/sample numbers, up to 36 bits). */
export function utf8CodedNumber(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n >= 2 ** 36) throw new RangeError('utf8CodedNumber');
  if (n < 0x80) return Uint8Array.of(n);
  const bytes: number[] = [];
  let value = n;
  // Number of continuation bytes needed.
  let extra = 1;
  while (value >= 2 ** (6 * extra + (6 - extra))) extra++;
  for (let i = 0; i < extra; i++) {
    bytes.unshift(0x80 | (value % 64));
    value = Math.floor(value / 64);
  }
  const lead = (0xff << (7 - extra)) & 0xff;
  bytes.unshift(lead | value);
  return Uint8Array.from(bytes);
}

export interface FlacEncodeOptions {
  sampleRate: number;
  /** 16 (default) or 24. */
  bitsPerSample?: 16 | 24;
  /** Samples per frame (fixed). Default 4096. */
  blockSize?: number;
}

const SAMPLE_RATE_CODES: Record<number, number> = {
  88200: 0b0001,
  176400: 0b0010,
  192000: 0b0011,
  8000: 0b0100,
  16000: 0b0101,
  22050: 0b0110,
  24000: 0b0111,
  32000: 0b1000,
  44100: 0b1001,
  48000: 0b1010,
  96000: 0b1011,
};

/** Float [-1, 1] → signed integer PCM, rounded and clamped (deterministic). */
export function quantize(channel: Float32Array, bitsPerSample: 16 | 24): Int32Array {
  const max = 2 ** (bitsPerSample - 1);
  const out = new Int32Array(channel.length);
  for (let i = 0; i < channel.length; i++) {
    const v = Math.round((channel[i] as number) * max);
    out[i] = Math.min(max - 1, Math.max(-max, v));
  }
  return out;
}

/**
 * Encodes planar integer PCM (one Int32Array per channel, values within bitsPerSample) to a
 * FLAC byte stream.
 */
export function encodeFlac(channels: Int32Array[], options: FlacEncodeOptions): Uint8Array {
  const nch = channels.length;
  if (nch < 1 || nch > 8) throw new RangeError('encodeFlac: 1…8 channels');
  const total = (channels[0] as Int32Array).length;
  if (channels.some((c) => c.length !== total)) throw new RangeError('encodeFlac: channel lengths');
  if (total === 0) throw new RangeError('encodeFlac: no samples');
  const bps = options.bitsPerSample ?? 16;
  const blockSize = options.blockSize ?? 4096;
  const sr = options.sampleRate;
  if (!Number.isInteger(sr) || sr <= 0 || sr >= 2 ** 20)
    throw new RangeError('encodeFlac: sampleRate');
  if (!Number.isInteger(blockSize) || blockSize < 16 || blockSize > 65535) {
    throw new RangeError('encodeFlac: blockSize 16…65535');
  }

  // Frames first, so STREAMINFO can carry the real min/max frame sizes.
  const frames: Uint8Array[] = [];
  let minFrame = Number.POSITIVE_INFINITY;
  let maxFrame = 0;
  const srCode = SAMPLE_RATE_CODES[sr] ?? 0b0000; // 0000: take it from STREAMINFO
  const bpsCode = bps === 16 ? 0b100 : 0b110;
  for (let frameNo = 0, start = 0; start < total; frameNo++, start += blockSize) {
    const n = Math.min(blockSize, total - start);
    const w = new BitWriter(16 + nch * (1 + (n * bps) / 8));
    w.write(0b11111111111110, 14); // sync
    w.write(0, 1); // reserved
    w.write(0, 1); // fixed blocksize
    // Block size: 4096 has a direct code (1100); other sizes use the explicit 16-bit form.
    const directCodes: Record<number, number> = { 192: 1, 576: 2, 1152: 3, 2304: 4, 4608: 5 };
    for (let k = 8; k <= 15; k++) directCodes[256 * 2 ** (k - 8)] = k;
    const bsCode = directCodes[n] ?? 0b0111;
    w.write(bsCode, 4);
    w.write(srCode, 4);
    w.write(nch - 1, 4); // independent channels
    w.write(bpsCode, 3);
    w.write(0, 1); // reserved
    w.writeBytes(utf8CodedNumber(frameNo));
    if (bsCode === 0b0111) w.write(n - 1, 16);
    w.write(crc8(w.view()), 8);
    for (let c = 0; c < nch; c++) {
      const ch = channels[c] as Int32Array;
      w.write(0, 1); // padding
      w.write(0b000001, 6); // VERBATIM
      w.write(0, 1); // no wasted bits
      const mod = 2 ** bps;
      for (let i = 0; i < n; i++) {
        const v = ch[start + i] as number;
        w.write(v < 0 ? v + mod : v, bps);
      }
    }
    w.align();
    w.write(crc16(w.view()), 16);
    const bytes = w.bytes();
    minFrame = Math.min(minFrame, bytes.length);
    maxFrame = Math.max(maxFrame, bytes.length);
    frames.push(bytes);
  }

  const head = new BitWriter(42);
  head.writeBytes(Uint8Array.of(0x66, 0x4c, 0x61, 0x43)); // "fLaC"
  head.write(1, 1); // last metadata block
  head.write(0, 7); // STREAMINFO
  head.write(34, 24);
  const nominal = Math.min(blockSize, total);
  head.write(Math.max(16, nominal), 16); // min block size (excluding the last block)
  head.write(Math.max(16, nominal), 16); // max block size
  head.write(minFrame, 24);
  head.write(maxFrame, 24);
  head.write(sr, 20);
  head.write(nch - 1, 3);
  head.write(bps - 1, 5);
  head.writeBig(total, 36);
  head.writeBytes(new Uint8Array(16)); // MD5 unknown

  const size = head.byteLength + frames.reduce((a, f) => a + f.length, 0);
  const out = new Uint8Array(size);
  out.set(head.view(), 0);
  let pos = head.byteLength;
  for (const f of frames) {
    out.set(f, pos);
    pos += f.length;
  }
  return out;
}

/** Convenience: float planar audio → 16-bit FLAC, returning the quantized PCM too. */
export function encodeFlacFromFloat(
  channels: Float32Array[],
  options: FlacEncodeOptions,
): { flac: Uint8Array; pcm: Int32Array[] } {
  const bps = options.bitsPerSample ?? 16;
  const pcm = channels.map((c) => quantize(c, bps));
  return { flac: encodeFlac(pcm, options), pcm };
}
