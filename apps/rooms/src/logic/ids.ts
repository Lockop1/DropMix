/**
 * Room codes, resume tokens and player ids. Pure: the randomness source is injected, and the
 * default is `crypto.getRandomValues` (available in Workers, browsers and Node 22).
 */

import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@stemdeck/protocol';

/** Returns `n` random bytes. */
export type RandomBytes = (n: number) => Uint8Array;

export const cryptoRandomBytes: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

/** Resume tokens carry 192 bits of randomness (the task asks for at least 128). */
export const TOKEN_BYTES = 24;

/**
 * A 4-letter code from `ROOM_CODE_ALPHABET`. Rejection sampling keeps every letter equally
 * likely (no modulo bias).
 */
export function generateRoomCode(random: RandomBytes = cryptoRandomBytes): string {
  const n = ROOM_CODE_ALPHABET.length;
  const limit = Math.floor(256 / n) * n;
  let code = '';
  while (code.length < ROOM_CODE_LENGTH) {
    for (const byte of random(ROOM_CODE_LENGTH * 2)) {
      if (byte >= limit) continue;
      code += ROOM_CODE_ALPHABET[byte % n];
      if (code.length === ROOM_CODE_LENGTH) break;
    }
  }
  return code;
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** A resume token: random, never derived from the player id. 32 base64url characters. */
export function generateToken(random: RandomBytes = cryptoRandomBytes): string {
  return base64url(random(TOKEN_BYTES));
}

/** A public player id (`h_…` for the host seat, `p_…` for players). Independent of the token. */
export function generatePlayerId(
  role: 'host' | 'player',
  random: RandomBytes = cryptoRandomBytes,
): string {
  return `${role === 'host' ? 'h' : 'p'}_${hex(random(8))}`;
}

/** Compares two tokens without an early exit on the first differing character. */
export function tokensEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
