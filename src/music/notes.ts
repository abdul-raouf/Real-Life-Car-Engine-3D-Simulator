import type { EngineSpec } from '../engines/catalog.ts';
import { firingHz, rpmForHz } from '../engines/kinematics.ts';

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

export function noteName(m: number): string {
  const r = Math.round(m);
  return `${NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
}

/** Cents from hz to the reference (positive = sharp). */
export const cents = (hz: number, refHz: number) => 1200 * Math.log2(hz / refHz);

export const rpmForMidi = (spec: EngineSpec, m: number) => rpmForHz(spec, midiToHz(m));
export const midiAtRpm = (spec: EngineSpec, rpm: number) => hzToMidi(firingHz(spec, rpm));

/** Whole notes the engine can hold between idle and redline. */
export function playableRange(spec: EngineSpec): { low: number; high: number } {
  return {
    low: Math.ceil(midiAtRpm(spec, spec.idleRpm * 1.02)),
    high: Math.floor(midiAtRpm(spec, spec.redlineRpm)),
  };
}

export const isPlayable = (spec: EngineSpec, m: number) => {
  const { low, high } = playableRange(spec);
  return m >= low && m <= high;
};
