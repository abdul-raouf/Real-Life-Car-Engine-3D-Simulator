// Rev Hero: hold the engine's pitch inside each note's band as the melody scrolls past.

import type { ChartNote } from '../music/songs.ts';
import { songLength } from '../music/songs.ts';

export type Difficulty = 'easy' | 'hard';

export const TOLERANCE_CENTS: Record<Difficulty, number> = { easy: 70, hard: 50 };
export const LEAD_IN = 3;

export interface NoteResult {
  hit: number;
  judged: boolean;
  good: boolean;
}

export class RevHero {
  readonly chart: ChartNote[];
  readonly difficulty: Difficulty;
  readonly tolerance: number;
  readonly length: number;
  /** Seconds since the first note (negative during the count-in). */
  t = -LEAD_IN;
  score = 0;
  streak = 0;
  bestStreak = 0;
  results: NoteResult[];
  private totalHit = 0;
  private totalPlayed = 0;
  finished = false;

  constructor(chart: ChartNote[], difficulty: Difficulty) {
    this.chart = chart;
    this.difficulty = difficulty;
    this.tolerance = TOLERANCE_CENTS[difficulty];
    this.length = songLength(chart);
    this.results = chart.map(() => ({ hit: 0, judged: false, good: false }));
  }

  get multiplier() {
    return 1 + Math.min(3, Math.floor(this.streak / 4));
  }

  get accuracy() {
    return this.totalPlayed > 0 ? this.totalHit / this.totalPlayed : 0;
  }

  get grade() {
    const a = this.accuracy;
    return a >= 0.9 ? 'S' : a >= 0.75 ? 'A' : a >= 0.6 ? 'B' : a >= 0.4 ? 'C' : 'D';
  }

  current(): ChartNote | null {
    return this.chart.find((n) => this.t >= n.start && this.t < n.start + n.dur) ?? null;
  }

  next(): ChartNote | null {
    return this.chart.find((n) => n.start > this.t) ?? null;
  }

  /** Advance by dt seconds with the engine currently sounding `midiNow`. */
  update(dt: number, midiNow: number) {
    if (this.finished) return;
    this.t += dt;
    const note = this.current();
    if (note) {
      const r = this.results[note.index];
      this.totalPlayed += dt;
      const off = Math.abs(midiNow - note.midi) * 100;
      if (off <= this.tolerance) {
        r.hit += dt;
        this.totalHit += dt;
        this.score += dt * 100 * this.multiplier;
      }
    }
    // Judge notes that have just ended.
    for (const n of this.chart) {
      const r = this.results[n.index];
      if (!r.judged && this.t >= n.start + n.dur) {
        r.judged = true;
        r.good = r.hit >= 0.5 * n.dur;
        if (r.good) {
          this.streak++;
          this.bestStreak = Math.max(this.bestStreak, this.streak);
          this.score += 50 * this.multiplier;
        } else {
          this.streak = 0;
        }
      }
    }
    if (this.t >= this.length + 0.5) this.finished = true;
  }

  /** Pitch range to draw, with some headroom. */
  get span(): { lo: number; hi: number } {
    const ms = this.chart.map((n) => n.midi);
    return { lo: Math.min(...ms) - 4, hi: Math.max(...ms) + 4 };
  }
}
