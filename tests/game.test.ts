import { describe, expect, it } from 'vitest';
import { ENGINES } from '../src/engines/catalog.ts';
import { playableRange } from '../src/music/notes.ts';
import { SONGS, chartFor, songLength } from '../src/music/songs.ts';
import { LEAD_IN, RevHero } from '../src/game/revHero.ts';

describe('songs', () => {
  const pairs = ENGINES.flatMap((e) => SONGS.map((s) => [e.id, s.id, e, s] as const));
  it.each(pairs)('%s can play %s: every note is between idle and redline', (_, __, engine, song) => {
    const { low, high } = playableRange(engine);
    for (const n of chartFor(song, engine)) {
      expect(n.midi).toBeGreaterThanOrEqual(low);
      expect(n.midi).toBeLessThanOrEqual(high);
    }
  });

  it('charts are back to back with no gaps', () => {
    const chart = chartFor(SONGS[0], ENGINES[0]);
    for (let i = 1; i < chart.length; i++) expect(chart[i].start).toBeCloseTo(chart[i - 1].start + chart[i - 1].dur, 9);
  });
});

describe('Rev Hero scoring', () => {
  const chart = chartFor(SONGS[2], ENGINES[3]);
  const run = (pitch: (t: number, note: number | null) => number, difficulty: 'easy' | 'hard' = 'easy') => {
    const game = new RevHero(chart, difficulty);
    const dt = 1 / 60;
    while (!game.finished) {
      const n = game.current();
      game.update(dt, pitch(game.t, n ? n.midi : null));
    }
    return game;
  };

  it('a perfect player gets an S and a full streak', () => {
    const game = run((_, m) => m ?? 0);
    expect(game.accuracy).toBeGreaterThan(0.97);
    expect(game.grade).toBe('S');
    expect(game.bestStreak).toBe(chart.length);
  });

  it('holding one wrong note scores almost nothing', () => {
    const game = run(() => 20);
    expect(game.accuracy).toBe(0);
    expect(game.grade).toBe('D');
    expect(game.streak).toBe(0);
  });

  it('tolerance: 40 cents off passes both levels, 60 cents off passes easy (±70¢) only', () => {
    expect(run((_, m) => (m ?? 0) - 0.4, 'easy').accuracy).toBeGreaterThan(0.97);
    expect(run((_, m) => (m ?? 0) - 0.4, 'hard').accuracy).toBeGreaterThan(0.97);
    // (A frame of lag at a semitone step can land in the band, hence not exactly zero.)
    expect(run((_, m) => (m ?? 0) - 0.6, 'hard').accuracy).toBeLessThan(0.01);
    expect(run((_, m) => (m ?? 0) - 0.6, 'easy').accuracy).toBeGreaterThan(0.97);
  });

  it('starts with a count-in and ends after the last note', () => {
    const game = new RevHero(chart, 'easy');
    expect(game.t).toBe(-LEAD_IN);
    expect(game.length).toBeCloseTo(songLength(chart), 9);
  });
});
