import type { Pack } from '../src';

/** A minimal, valid schemaVersion 1 manifest (text metadata only; no audio). */
export function minimalPack(): Pack {
  return {
    schemaVersion: 1,
    packId: 'test-pack',
    name: 'Test pack',
    createdAt: '2026-11-11T12:00:00Z',
    songs: [
      {
        songId: 'song-1',
        title: 'Synthetic Song',
        artist: 'Test Artist',
        nativeBpm: 120,
        key: { tonic: 0, mode: 'major', confidence: 0.9 },
      },
    ],
    cards: [
      {
        cardId: 'card-1',
        songId: 'song-1',
        kind: 'beat',
        level: 2,
        title: 'Synthetic Song',
        artist: 'Test Artist',
      },
    ],
    stems: [
      {
        stemId: 'stem-1',
        songId: 'song-1',
        role: 'beat',
        file: 'audio/stem-1.flac',
        sampleRate: 44100,
        handleSamples: 88200,
        loopStartSample: 88200,
        loopEndSample: 88200 + 352800,
        bars: 4,
        bpm: 120,
        pcs: 0,
        mode: 'major',
        chroma: [],
        entryEvery: 1,
        gainDb: 0,
        lufs: -14,
      },
    ],
    playlists: [{ id: 'all', name: 'All', cardIds: ['card-1'] }],
  };
}
