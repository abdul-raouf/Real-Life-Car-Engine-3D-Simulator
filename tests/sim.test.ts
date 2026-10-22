import { describe, expect, it } from 'vitest';
import { ENGINES, ENGINE_BY_ID, type EngineSpec } from '../src/engines/catalog.ts';
import { EngineSim, type SimInput } from '../src/sim/engineSim.ts';

const DT = 1 / 120;

function running(spec: EngineSpec): EngineSim {
  const sim = new EngineSim(spec);
  sim.start();
  for (let t = 0; t < 6; t += DT) sim.step(DT, { pedal: 0, targetRpm: null });
  return sim;
}

function run(sim: EngineSim, seconds: number, input: SimInput, each?: (t: number) => void) {
  for (let t = 0; t < seconds; t += DT) {
    sim.step(DT, input);
    each?.(t);
  }
}

describe('engine sim', () => {
  it.each(ENGINES.map((e) => [e.id, e] as const))('%s cranks, catches, flares and settles at idle', (_, spec) => {
    const sim = new EngineSim(spec);
    sim.start();
    let peak = 0;
    let sawCranking = false;
    run(sim, 6, { pedal: 0, targetRpm: null }, () => {
      if (sim.state === 'cranking') sawCranking = true;
      peak = Math.max(peak, sim.rpm);
    });
    expect(sawCranking).toBe(true);
    expect(sim.state).toBe('running');
    expect(peak).toBeGreaterThan(spec.idleRpm * 1.15);
    expect(Math.abs(sim.rpm / spec.idleRpm - 1)).toBeLessThan(0.03);
  });

  it.each(ENGINES.map((e) => [e.id, e] as const))('%s bounces off the rev limiter at full throttle', (_, spec) => {
    const sim = running(spec);
    let max = 0;
    let cuts = 0;
    let wasCut = false;
    run(sim, 4, { pedal: 1, targetRpm: null }, () => {
      max = Math.max(max, sim.rpm);
      if (sim.limiterCut && !wasCut) cuts++;
      wasCut = sim.limiterCut;
    });
    expect(max).toBeGreaterThanOrEqual(spec.limiterRpm);
    expect(max).toBeLessThan(spec.limiterRpm * 1.03);
    expect(cuts).toBeGreaterThanOrEqual(2);
  });

  it('heavy engines rev slower than the featherweight V10', () => {
    const timeToRev = (spec: EngineSpec) => {
      const sim = running(spec);
      const goal = spec.idleRpm + 0.8 * (spec.redlineRpm - spec.idleRpm);
      let t = 0;
      while (sim.rpm < goal && t < 10) {
        sim.step(DT, { pedal: 1, targetRpm: null });
        t += DT;
      }
      return (goal - spec.idleRpm) / t; // rpm per second
    };
    const v10 = timeToRev(ENGINE_BY_ID.v10);
    const v8 = timeToRev(ENGINE_BY_ID.v8);
    expect(v10).toBeGreaterThan(3 * v8);
    expect(v8).toBeGreaterThan(3000);
    expect(v8).toBeLessThan(15000);
  });

  it.each(ENGINES.map((e) => [e.id, e] as const))('%s ECU holds a note within ±0.5% after a fifth up and down', (_, spec) => {
    const sim = running(spec);
    const base = spec.idleRpm + 0.3 * (spec.redlineRpm - spec.idleRpm);
    const fifth = base * Math.pow(2, 7 / 12);
    const settle = (target: number) => {
      let t = 0;
      let inBandSince = -1;
      while (t < 3) {
        sim.step(DT, { pedal: 0, targetRpm: target });
        t += DT;
        const ok = Math.abs(sim.rpm / target - 1) < 0.005;
        if (ok && inBandSince < 0) inBandSince = t;
        if (!ok) inBandSince = -1;
        if (inBandSince >= 0 && t - inBandSince > 0.3) return inBandSince;
      }
      return Infinity;
    };
    expect(settle(base)).toBeLessThan(1.5);
    expect(settle(fifth)).toBeLessThan(0.6);
    expect(settle(base)).toBeLessThan(0.9);
    run(sim, 1, { pedal: 0, targetRpm: base });
    expect(Math.abs(sim.rpm / base - 1)).toBeLessThan(0.002);
  });

  it('switching engines while running lands at the new idle', () => {
    const sim = running(ENGINE_BY_ID.i4);
    sim.setEngine(ENGINE_BY_ID.v10);
    run(sim, 2, { pedal: 0, targetRpm: null });
    expect(Math.abs(sim.rpm / ENGINE_BY_ID.v10.idleRpm - 1)).toBeLessThan(0.03);
  });
});
