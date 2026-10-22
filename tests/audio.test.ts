import { describe, expect, it } from 'vitest';
import { ENGINES, ENGINE_BY_ID } from '../src/engines/catalog.ts';
import { firingHz } from '../src/engines/kinematics.ts';
import { SR, detectPitch, mono, render, rms, toneMagnitude } from './pitch.ts';

const WARMUP = 0.3;

describe('engine voice pitch', () => {
  // The whole premise: what you hear is the firing frequency, RPM × cylinders ÷ 120.
  // The boxer is checked separately below: its unequal headers deliberately break the
  // even spacing, which is the whole point of its rumble.
  const even = ENGINES.filter((e) => e.id !== 'b4');
  const cases = even.flatMap((e) => {
    const lo = e.idleRpm * 1.6;
    const mid = (e.idleRpm + e.redlineRpm) / 2;
    const hi = e.redlineRpm * 0.92;
    return [lo, mid, hi].map((rpm) => [e.id, Math.round(rpm)] as const);
  });

  it.each(cases)('%s at %i rpm sounds at its firing frequency (deterministic voice)', (id, rpm) => {
    const spec = ENGINE_BY_ID[id];
    const { l, r } = render(spec, { rpm }, WARMUP + 0.35);
    const x = mono(l, r, Math.round(WARMUP * SR));
    const expected = firingHz(spec, rpm);
    const got = detectPitch(x, SR, expected / 3, Math.min(4000, expected * 3));
    expect(Math.abs(got / expected - 1)).toBeLessThan(0.01);
  });

  it.each(even.map((e) => [e.id, e] as const))(
    '%s keeps its pitch with the full, randomised voice',
    (_, spec) => {
      const rpm = Math.round((spec.idleRpm + spec.redlineRpm) / 2);
      const { l, r } = render(spec, { rpm, load: 0.6, throttle: 0.6 }, WARMUP + 0.5, { seed: 7 });
      const x = mono(l, r, Math.round(WARMUP * SR));
      const expected = firingHz(spec, rpm);
      const got = detectPitch(x, SR, expected / 3, Math.min(4000, expected * 3), 0.8);
      expect(Math.abs(got / expected - 1)).toBeLessThan(0.02);
    },
  );
});

describe('boxer rumble', () => {
  // Spectral lines at engine orders 0.5, 1 and 1.5 are the "lope" between firing pulses.
  const subharmonics = (id: 'b4' | 'i4', rpm: number) => {
    const spec = ENGINE_BY_ID[id];
    const { l, r } = render(spec, { rpm }, WARMUP + 0.6);
    const x = mono(l, r, Math.round(WARMUP * SR));
    const cycleHz = rpm / 120;
    const n = Math.floor(Math.floor((x.length * cycleHz) / SR) * (SR / cycleHz));
    const fire = toneMagnitude(x, SR, firingHz(spec, rpm), n);
    const subs = [1, 2, 3].map((k) => toneMagnitude(x, SR, k * cycleHz, n));
    return { fire, subs };
  };

  it.each([1200, 3000, 5500])('at %i rpm the firing note still dominates its sub-harmonics', (rpm) => {
    const { fire, subs } = subharmonics('b4', rpm);
    for (const s of subs) expect(s).toBeLessThan(fire);
  });

  it('the unequal headers create sub-harmonics an equal-length inline-4 does not have', () => {
    const b4 = subharmonics('b4', 3000);
    const i4 = subharmonics('i4', 3000);
    const strongest = (s: { fire: number; subs: number[] }) => Math.max(...s.subs) / s.fire;
    expect(strongest(b4)).toBeGreaterThan(0.05);
    expect(strongest(i4)).toBeLessThan(0.01);
  });
});

describe('engine voice behaviour', () => {
  it.each(ENGINES.map((e) => [e.id, e] as const))('%s output is finite and never clips', (_, spec) => {
    for (const rpm of [spec.idleRpm, spec.redlineRpm]) {
      for (const load of [0, 1]) {
        const { l, r } = render(spec, { rpm, load, throttle: load, cut: load === 0 }, 0.4, { seed: 3 });
        for (const ch of [l, r]) {
          let peak = 0;
          for (let i = 0; i < ch.length; i++) {
            expect(Number.isFinite(ch[i])).toBe(true);
            peak = Math.max(peak, Math.abs(ch[i]));
          }
          expect(peak).toBeLessThanOrEqual(0.9);
        }
      }
    }
  });

  it('fuel cut makes the engine much quieter (the limiter stutter)', () => {
    const spec = ENGINE_BY_ID.v8;
    const on = render(spec, { rpm: 6000, load: 1 }, WARMUP + 0.3);
    const cut = render(spec, { rpm: 6000, load: 1, cut: true }, WARMUP + 0.3);
    const from = Math.round(WARMUP * SR);
    expect(rms(cut.l, from)).toBeLessThan(0.6 * rms(on.l, from));
  });

  it('fires exactly one exhaust pulse per cylinder every two revolutions', () => {
    const spec = ENGINE_BY_ID.v12;
    const rpm = 3000;
    const seconds = 1;
    const { dsp } = render(spec, { rpm }, seconds);
    const expected = (rpm / 60 / 2) * spec.cylinders * seconds;
    expect(Math.abs(dsp.pulses - expected)).toBeLessThanOrEqual(spec.cylinders);
  });

  it('crossplane V8: each exhaust bank is lumpy, which is the burble', () => {
    // Left channel leans on bank 0, whose pulses are spaced 180/270/180/90°. Its own
    // periodicity is the whole 720° cycle, not the 90° firing interval.
    const spec = ENGINE_BY_ID.v8;
    const rpm = 2400;
    const { l } = render(spec, { rpm }, WARMUP + 0.5);
    const x = l.subarray(Math.round(WARMUP * SR));
    const left = new Float32Array(x);
    const cycleHz = rpm / 120;
    const got = detectPitch(left, SR, cycleHz * 0.7, firingHz(spec, rpm) * 1.5, 0.97);
    expect(got).toBeLessThan(firingHz(spec, rpm) * 0.6);
  });
});
