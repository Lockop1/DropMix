/**
 * Room lab (task 0D, rooms spike). Nested under the `/roomlab/*` splat route:
 *
 *   /roomlab               host: create a room
 *   /roomlab/host/:code    host screen: code, QR, players, taps, ping
 *   /roomlab/join          player: enter a code
 *   /roomlab/join/:code    player: name + glyph, then the Tap button
 *
 * Spike-only: it speaks the `spike.*` messages from `@stemdeck/protocol/spike`, which are deleted
 * in Phase 3 together with this directory's room code.
 */

import { Route, Routes } from 'react-router';
import { HostRoom, HostStart } from './HostPage';
import { JoinEntry, PlayerRoom } from './PlayerPage';

export default function RoomLab() {
  return (
    <Routes>
      <Route index element={<HostStart />} />
      <Route path="host/:code" element={<HostRoom />} />
      <Route path="join" element={<JoinEntry />} />
      <Route path="join/:code" element={<PlayerRoom />} />
      <Route path="*" element={<HostStart />} />
    </Routes>
  );
}
