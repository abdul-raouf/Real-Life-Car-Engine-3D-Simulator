import { describe, expect, it } from 'vitest';
import { ENGINES, ENGINE_BY_ID } from '../src/engines/catalog.ts';
import { cents, hzToMidi, midiToHz, noteName, playableRange, rpmForMidi } from '../src/music/notes.ts';

describe('notes', () => {
  it('uses A4 = 440 Hz equal temperament', () => {
    expect(midiToHz(69)).toBe(440);
    expect(midiToHz(57)).toBeCloseTo(220, 9);
    expect(hzToMidi(261.6255653)).toBeCloseTo(60, 6);
    expect(noteName(69)).toBe('A4');
    expect(noteName(60)).toBe('C4');
    expect(noteName(61)).toBe('C♯4');
  });
  it('measures cents', () => {
    expect(cents(880, 440)).toBeCloseTo(1200, 9);
    expect(cents(440 * Math.pow(2, 1 / 1200), 440)).toBeCloseTo(1, 9);
  });
  it('maps notes to RPM per engine', () => {
    expect(rpmForMidi(ENGINE_BY_ID.v8, 57)).toBeCloseTo(3300, 6); // A3 on a V8
    expect(rpmForMidi(ENGINE_BY_ID.v10, 69)).toBeCloseTo(5280, 6); // A4 on a V10
  });
  it.each(ENGINES.map((e) => [e.id, e] as const))('%s has at least two playable octaves', (_, e) => {
    const { low, high } = playableRange(e);
    expect(high - low).toBeGreaterThanOrEqual(24);
    expect(rpmForMidi(e, low)).toBeGreaterThan(e.idleRpm);
    expect(rpmForMidi(e, high)).toBeLessThanOrEqual(e.redlineRpm);
  });
});
