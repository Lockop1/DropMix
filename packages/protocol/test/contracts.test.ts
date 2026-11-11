import { describe, expect, it } from 'vitest';
import {
  clientMessageSchema,
  intentSchema,
  PROTOCOL_VERSION,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_CODE_REGEX,
  roomCodeSchema,
} from '../src';

describe('protocol contract', () => {
  it('room codes are 4 letters without I, L or O', () => {
    expect(ROOM_CODE_REGEX.test('ABCD')).toBe(true);
    expect(ROOM_CODE_REGEX.test('ABIO')).toBe(false);
    expect(ROOM_CODE_REGEX.test('abcd')).toBe(false);
    expect(ROOM_CODE_REGEX.test('ABCDE')).toBe(false);
    expect(ROOM_CODE_LENGTH).toBe(4);
    for (const c of 'ILO') expect(ROOM_CODE_ALPHABET).not.toContain(c);
    expect(roomCodeSchema.safeParse('ZZZZ').success).toBe(true);
    expect(roomCodeSchema.safeParse('LOLO').success).toBe(false);
  });

  it('validates intents strictly', () => {
    expect(intentSchema.safeParse({ type: 'card.play', cardId: 'c1', slot: 2 }).success).toBe(true);
    expect(intentSchema.safeParse({ type: 'card.play', cardId: 'c1', slot: 5 }).success).toBe(
      false,
    );
    expect(intentSchema.safeParse({ type: 'board.clear', extra: true }).success).toBe(false);
  });

  it('hello carries the protocol version', () => {
    const hello = { t: 'hello', v: PROTOCOL_VERSION, code: 'ABCD', role: 'host' };
    expect(clientMessageSchema.safeParse(hello).success).toBe(true);
    expect(clientMessageSchema.safeParse({ ...hello, v: PROTOCOL_VERSION + 1 }).success).toBe(
      false,
    );
  });
});
