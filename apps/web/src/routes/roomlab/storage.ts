/**
 * localStorage helpers for the room lab. Resume tokens are keyed by room code and role, so a
 * refresh keeps the seat. Every access is wrapped: storage can be unavailable (private mode,
 * blocked site data) and the pages must still work, just without resume.
 */

import type { Role } from './room-connection';

const PREFIX = 'stemdeck.roomlab';

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // storage unavailable: resume will not survive a refresh
  }
}

const tokenKey = (code: string, role: Role) => `${PREFIX}.token.${code}.${role}`;

export const tokens = {
  get: (code: string, role: Role) => read(tokenKey(code, role)),
  set: (code: string, role: Role, token: string) => write(tokenKey(code, role), token),
  clear: (code: string, role: Role) => write(tokenKey(code, role), null),
};

/** The room this browser last hosted, so `/roomlab` can offer to resume it. */
export const lastHostedRoom = {
  get: () => read(`${PREFIX}.host.last`),
  set: (code: string) => write(`${PREFIX}.host.last`, code),
  clear: () => write(`${PREFIX}.host.last`, null),
};

export interface Profile {
  name: string;
  avatar: string;
}

/** The player's last name and glyph, prefilled on the next join. */
export const profile = {
  get(): Profile | null {
    const raw = read(`${PREFIX}.profile`);
    if (!raw) return null;
    try {
      const p = JSON.parse(raw) as Partial<Profile>;
      return typeof p.name === 'string' && typeof p.avatar === 'string'
        ? { name: p.name, avatar: p.avatar }
        : null;
    } catch {
      return null;
    }
  },
  set: (p: Profile) => write(`${PREFIX}.profile`, JSON.stringify(p)),
};
