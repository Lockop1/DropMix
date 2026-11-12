/**
 * Frame codec for the room WebSocket. Every inbound frame goes through `decodeClientFrame`
 * (size, then JSON, then the zod schema); every outbound frame goes through `encodeServerFrame`,
 * which validates it too, so a field that is not in the schema (a resume token on a player entry,
 * say) can never be sent by accident.
 */

import { type ErrorCode, LIMITS, PROTOCOL_VERSION } from '@stemdeck/protocol';
import {
  type SpikeClientMessage,
  type SpikeServerMessage,
  spikeClientMessageSchema,
  spikeServerMessageSchema,
} from '@stemdeck/protocol/spike';

export type RawFrame = string | ArrayBuffer | ArrayBufferView;

export type DecodeResult =
  | { ok: true; msg: SpikeClientMessage }
  | {
      ok: false;
      code: Extract<ErrorCode, 'bad_message' | 'too_large' | 'unsupported_version'>;
      message: string;
    };

/**
 * UTF-8 byte length of a string, without encoding it. A surrogate pair counts 4 bytes; a lone
 * surrogate is over-counted by one byte, which only makes the size check stricter.
 */
export function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

export function frameByteLength(raw: RawFrame): number {
  return typeof raw === 'string' ? utf8ByteLength(raw) : raw.byteLength;
}

export function decodeClientFrame(
  raw: RawFrame,
  maxBytes: number = LIMITS.maxMessageBytes,
): DecodeResult {
  if (frameByteLength(raw) > maxBytes) {
    return { ok: false, code: 'too_large', message: `frames are limited to ${maxBytes} bytes` };
  }
  if (typeof raw !== 'string') {
    return { ok: false, code: 'bad_message', message: 'binary frames are not accepted' };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'bad_message', message: 'frame is not JSON' };
  }
  const parsed = spikeClientMessageSchema.safeParse(json);
  if (parsed.success) return { ok: true, msg: parsed.data };
  if (isHelloWithOtherVersion(json)) {
    return {
      ok: false,
      code: 'unsupported_version',
      message: `server speaks protocol v${PROTOCOL_VERSION}`,
    };
  }
  return { ok: false, code: 'bad_message', message: 'frame does not match the protocol' };
}

function isHelloWithOtherVersion(json: unknown): boolean {
  if (typeof json !== 'object' || json === null) return false;
  const o = json as Record<string, unknown>;
  return o.t === 'hello' && typeof o.v === 'number' && o.v !== PROTOCOL_VERSION;
}

/** Serializes a server message after validating it. Throws on a message the schema rejects. */
export function encodeServerFrame(msg: SpikeServerMessage): string {
  return JSON.stringify(spikeServerMessageSchema.parse(msg));
}

export function errorFrame(code: ErrorCode, message?: string): string {
  return encodeServerFrame(
    message === undefined ? { t: 'error', code } : { t: 'error', code, message },
  );
}
