/**
 * WebSocket close codes the room server uses after a fatal `error` frame. Every one is in the
 * 4000–4999 application range; the client treats that whole range as "do not reconnect".
 */

import type { ErrorCode } from '@stemdeck/protocol';

export const CLOSE = {
  badHello: 4000,
  /** The same seat connected again from somewhere else; this socket lost it. */
  replaced: 4001,
  notHost: 4003,
  roomNotFound: 4004,
  unsupportedVersion: 4005,
  roomFull: 4009,
} as const;

export function closeCodeFor(code: ErrorCode): number {
  switch (code) {
    case 'not_host':
      return CLOSE.notHost;
    case 'room_not_found':
      return CLOSE.roomNotFound;
    case 'room_full':
      return CLOSE.roomFull;
    case 'unsupported_version':
      return CLOSE.unsupportedVersion;
    default:
      return CLOSE.badHello;
  }
}
