/**
 * Per-connection rate limit: at most `limit` accepted messages in any sliding window of
 * `windowMs`. Excess messages are dropped. The caller tells the client once per window (not once
 * per dropped frame, so a flood cannot be turned into an outbound flood). Pure: time is passed in.
 */

import { LIMITS } from '@stemdeck/protocol';

export type RateDecision = 'ok' | 'drop' | 'drop_and_notify';

export class RateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  /** Times of accepted messages, oldest first. Never longer than `limit`. */
  readonly #accepted: number[] = [];
  #lastNotifiedAt = Number.NEGATIVE_INFINITY;

  constructor(limit: number = LIMITS.rateLimitPerSecond, windowMs = 1000) {
    this.#limit = limit;
    this.#windowMs = windowMs;
  }

  take(now: number): RateDecision {
    while (this.#accepted.length > 0 && (this.#accepted[0] ?? 0) <= now - this.#windowMs) {
      this.#accepted.shift();
    }
    if (this.#accepted.length < this.#limit) {
      this.#accepted.push(now);
      return 'ok';
    }
    if (now - this.#lastNotifiedAt >= this.#windowMs) {
      this.#lastNotifiedAt = now;
      return 'drop_and_notify';
    }
    return 'drop';
  }
}
