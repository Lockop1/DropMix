/**
 * Idle expiry. A room is deleted once nothing has arrived on it for `idleMs`
 * (`LIMITS.idleExpiryMs` by default; the `ROOM_IDLE_EXPIRY_MS` var overrides it for tests).
 *
 * To avoid a storage write per message, activity is recorded (and the alarm moved) at most once
 * per `throttleMs`. The alarm is set to `lastRecorded + idleMs + throttleMs`, so a room never
 * expires early; it may expire up to `throttleMs` late.
 */

import { LIMITS } from '@stemdeck/protocol';

export const MIN_IDLE_EXPIRY_MS = 100;

export function resolveIdleExpiryMs(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return LIMITS.idleExpiryMs;
  return Math.max(MIN_IDLE_EXPIRY_MS, Math.floor(n));
}

export function activityThrottleMs(idleMs: number): number {
  return Math.min(10_000, Math.floor(idleMs / 10));
}

/** Whether activity at `now` should be recorded, given when it was last recorded. */
export function shouldRecordActivity(now: number, lastRecorded: number, idleMs: number): boolean {
  return now - lastRecorded >= activityThrottleMs(idleMs);
}

export function alarmTimeFor(lastActivity: number, idleMs: number): number {
  return lastActivity + idleMs + activityThrottleMs(idleMs);
}

export type AlarmDecision = { expire: true } | { expire: false; nextAlarmAt: number };

/** What to do when the alarm fires at `now`, given the latest known activity. */
export function decideOnAlarm(now: number, lastActivity: number, idleMs: number): AlarmDecision {
  if (now - lastActivity >= idleMs) return { expire: true };
  return { expire: false, nextAlarmAt: alarmTimeFor(lastActivity, idleMs) };
}
