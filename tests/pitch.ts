// Small offline analysis helpers for the audio tests.

import type { EngineSpec } from '../src/engines/catalog.ts';
import { EngineDsp, type DspOptions, type VoiceParams } from '../src/audio/dsp.ts';

export const SR = 48000;

export function render(
  spec: EngineSpec,
  params: Partial<VoiceParams>,
  seconds: number,
  opts: DspOptions = { deterministic: true },
): { l: Float32Array; r: Float32Array; dsp: EngineDsp } {
  const dsp = new EngineDsp(spec, SR, opts);
  dsp.set({ load: 0.5, throttle: 0.5, cut: false, starter: 0, crackle: 0, master: 1, ...params });
  dsp.snap();
  const n = Math.round(seconds * SR);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i += 128) dsp.process(l, r, Math.min(128, n - i), i);
  return { l, r, dsp };
}

/**
 * Fundamental period by normalised autocorrelation: the shortest lag whose correlation
 * reaches `threshold` of the best one, refined with parabolic interpolation.
 */
export function detectPitch(x: Float32Array, sr: number, minHz = 15, maxHz = 2500, threshold = 0.85): number {
  const minLag = Math.floor(sr / maxHz);
  const maxLag = Math.ceil(sr / minHz);
  const n = x.length - maxLag;
  let e0 = 0;
  for (let i = 0; i < n; i++) e0 += x[i] * x[i];
  const r = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag + 1; lag++) {
    let s = 0;
    let e1 = 0;
    for (let i = 0; i < n; i++) {
      s += x[i] * x[i + lag];
      e1 += x[i + lag] * x[i + lag];
    }
    r[lag] = s / Math.sqrt(e0 * e1 + 1e-20);
  }
  let best = 0;
  for (let lag = minLag + 1; lag <= maxLag; lag++) best = Math.max(best, r[lag]);
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    if (r[lag] >= threshold * best && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
      const a = r[lag - 1];
      const b = r[lag];
      const c = r[lag + 1];
      const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
      return sr / (lag + shift);
    }
  }
  return NaN;
}

export function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

export function mono(l: Float32Array, r: Float32Array, from = 0): Float32Array {
  const out = new Float32Array(l.length - from);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (l[from + i] + r[from + i]);
  return out;
}

/** Magnitude of one frequency component (single-bin DFT). */
export function toneMagnitude(x: Float32Array, sr: number, hz: number, n = x.length): number {
  let re = 0;
  let im = 0;
  const w = (2 * Math.PI * hz) / sr;
  for (let i = 0; i < n; i++) {
    re += x[i] * Math.cos(w * i);
    im -= x[i] * Math.sin(w * i);
  }
  return Math.hypot(re, im) / n;
}
