import { describe, expect, it } from 'vitest';
import { LIMITS, PROTOCOL_VERSION } from '../src';
import {
  spikeClientMessageSchema,
  spikeServerMessageSchema,
  spikeStateSchema,
  spikeTapSchema,
} from '../src/spike';

const player = { playerId: 'p_1', name: 'Ada', avatar: 'star', connected: true, taps: 3 };

describe('spike protocol (task 0D only)', () => {
  it('accepts a tap and rejects a tap that carries a count or bad fields', () => {
    expect(spikeTapSchema.safeParse({ t: 'spike.tap', tapId: 'a1', sentAt: 1 }).success).toBe(true);
    expect(
      spikeTapSchema.safeParse({ t: 'spike.tap', tapId: 'a1', sentAt: 1, taps: 99 }).success,
    ).toBe(false);
    expect(spikeTapSchema.safeParse({ t: 'spike.tap', tapId: '', sentAt: 1 }).success).toBe(false);
    expect(
      spikeTapSchema.safeParse({ t: 'spike.tap', tapId: 'x'.repeat(65), sentAt: 1 }).success,
    ).toBe(false);
    expect(spikeTapSchema.safeParse({ t: 'spike.tap', tapId: 'a', sentAt: '1' }).success).toBe(
      false,
    );
  });

  it('the client union keeps every v1 message and adds spike.tap', () => {
    const hello = { t: 'hello', v: PROTOCOL_VERSION, code: 'ABCD', role: 'player', name: 'Ada' };
    expect(spikeClientMessageSchema.safeParse(hello).success).toBe(true);
    expect(spikeClientMessageSchema.safeParse({ t: 'ping', time: 5 }).success).toBe(true);
    expect(
      spikeClientMessageSchema.safeParse({ t: 'spike.tap', tapId: 'a', sentAt: 1 }).success,
    ).toBe(true);
    expect(spikeClientMessageSchema.safeParse({ t: 'spike.nope' }).success).toBe(false);
    // A client may not send server messages.
    expect(spikeClientMessageSchema.safeParse({ t: 'spike.state', seq: 0 }).success).toBe(false);
  });

  it('validates spike.state strictly', () => {
    const state = {
      t: 'spike.state',
      seq: 4,
      players: [player],
      host: { connected: true },
      lastTap: { playerId: 'p_1', tapId: 'a1', sentAt: 10, serverTime: 12 },
    };
    expect(spikeStateSchema.safeParse(state).success).toBe(true);
    expect(spikeServerMessageSchema.safeParse(state).success).toBe(true);
    const { lastTap: _omit, ...withoutLastTap } = state;
    expect(spikeStateSchema.safeParse(withoutLastTap).success).toBe(true);
    expect(spikeStateSchema.safeParse({ ...state, seq: -1 }).success).toBe(false);
    // A resume token can never ride along on a player entry or on the state.
    const leakyPlayer = { ...player, resumeToken: 'x'.repeat(32) };
    expect(spikeStateSchema.safeParse({ ...state, players: [leakyPlayer] }).success).toBe(false);
    expect(spikeStateSchema.safeParse({ ...state, resumeToken: 'x'.repeat(32) }).success).toBe(
      false,
    );
    const tooMany = Array.from({ length: LIMITS.maxPlayers }, (_, i) => ({
      ...player,
      playerId: `p_${i}`,
    }));
    expect(spikeStateSchema.safeParse({ ...state, players: tooMany }).success).toBe(false);
  });

  it('the server union keeps the v1 messages', () => {
    expect(spikeServerMessageSchema.safeParse({ t: 'pong', time: 1, serverTime: 2 }).success).toBe(
      true,
    );
    expect(spikeServerMessageSchema.safeParse({ t: 'error', code: 'room_full' }).success).toBe(
      true,
    );
    expect(spikeServerMessageSchema.safeParse({ t: 'error', code: 'nope' }).success).toBe(false);
  });
});
