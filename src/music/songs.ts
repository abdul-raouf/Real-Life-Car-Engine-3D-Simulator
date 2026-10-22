// Public-domain melodies, written in C major around middle C and transposed by whole
// octaves to fit each engine. Each entry is [midi note, length in beats].

import type { EngineSpec } from '../engines/catalog.ts';
import { playableRange } from './notes.ts';

export interface Song {
  id: string;
  title: string;
  credit: string;
  bpm: number;
  phrase: [number, number][];
}

export interface ChartNote {
  midi: number;
  /** Start and length in seconds. */
  start: number;
  dur: number;
  index: number;
}

const C4 = 60;
const D4 = 62;
const E4 = 64;
const F4 = 65;
const G4 = 67;
const A4 = 69;

export const SONGS: Song[] = [
  {
    id: 'saints',
    title: 'When the Saints Go Marching In',
    credit: 'Traditional. The tune an F1 V10 played in 2003.',
    bpm: 112,
    phrase: [
      [C4, 1], [E4, 1], [F4, 1], [G4, 4],
      [C4, 1], [E4, 1], [F4, 1], [G4, 4],
      [C4, 1], [E4, 1], [F4, 1], [G4, 2], [E4, 2], [C4, 2], [E4, 2], [D4, 4],
      [E4, 1], [E4, 1], [D4, 1], [C4, 3], [E4, 2], [G4, 2], [G4, 1], [F4, 4],
      [E4, 1], [F4, 1], [G4, 2], [E4, 2], [C4, 2], [D4, 2], [C4, 4],
    ],
  },
  {
    id: 'ode',
    title: 'Ode to Joy',
    credit: 'Ludwig van Beethoven, Symphony No. 9 (1824).',
    bpm: 108,
    phrase: [
      [E4, 1], [E4, 1], [F4, 1], [G4, 1], [G4, 1], [F4, 1], [E4, 1], [D4, 1],
      [C4, 1], [C4, 1], [D4, 1], [E4, 1], [E4, 1.5], [D4, 0.5], [D4, 2],
      [E4, 1], [E4, 1], [F4, 1], [G4, 1], [G4, 1], [F4, 1], [E4, 1], [D4, 1],
      [C4, 1], [C4, 1], [D4, 1], [E4, 1], [D4, 1.5], [C4, 0.5], [C4, 2],
    ],
  },
  {
    id: 'twinkle',
    title: 'Twinkle, Twinkle, Little Star',
    credit: 'Traditional French melody (1761).',
    bpm: 100,
    phrase: [
      [C4, 1], [C4, 1], [G4, 1], [G4, 1], [A4, 1], [A4, 1], [G4, 2],
      [F4, 1], [F4, 1], [E4, 1], [E4, 1], [D4, 1], [D4, 1], [C4, 2],
      [G4, 1], [G4, 1], [F4, 1], [F4, 1], [E4, 1], [E4, 1], [D4, 2],
      [G4, 1], [G4, 1], [F4, 1], [F4, 1], [E4, 1], [E4, 1], [D4, 2],
      [C4, 1], [C4, 1], [G4, 1], [G4, 1], [A4, 1], [A4, 1], [G4, 2],
      [F4, 1], [F4, 1], [E4, 1], [E4, 1], [D4, 1], [D4, 1], [C4, 2],
    ],
  },
];

/**
 * Octave shift that places the song in the upper-middle of the engine's range, where
 * it sounds most like itself, while keeping every note playable.
 */
export function octaveShiftFor(song: Song, spec: EngineSpec): number {
  const notes = song.phrase.map(([m]) => m);
  const lo = Math.min(...notes);
  const hi = Math.max(...notes);
  const range = playableRange(spec);
  const sweet = range.low + 0.58 * (range.high - range.low);
  let best = 0;
  let bestScore = Infinity;
  for (let k = -5; k <= 5; k++) {
    const s = k * 12;
    if (lo + s < range.low + 1 || hi + s > range.high - 1) continue;
    const score = Math.abs((lo + hi) / 2 + s - sweet);
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

export function chartFor(song: Song, spec: EngineSpec): ChartNote[] {
  const shift = octaveShiftFor(song, spec);
  const beat = 60 / song.bpm;
  let t = 0;
  return song.phrase.map(([midi, beats], index) => {
    const note = { midi: midi + shift, start: t, dur: beats * beat, index };
    t += beats * beat;
    return note;
  });
}

export const songLength = (chart: ChartNote[]) => {
  const last = chart[chart.length - 1];
  return last.start + last.dur;
};
