import { describe, expect, it } from 'vitest';
import { ENGINES, ENGINE_BY_ID, type EngineSpec } from '../src/engines/catalog.ts';
import {
  exhaustLift,
  firingAngles,
  firingHz,
  intakeLift,
  mod,
  pinAngles,
  pistonDistance,
  rpmForHz,
  strokeOf,
} from '../src/engines/kinematics.ts';
import { balanceSummary } from '../src/engines/balance.ts';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const angleDiff = (a: number, b: number) => {
  const d = mod(a - b, 360);
  return Math.min(d, 360 - d);
};

describe('catalog integrity', () => {
  it.each(ENGINES.map((e) => [e.id, e] as const))('%s has consistent per-cylinder arrays', (_, e) => {
    const n = e.cylinders;
    for (const arr of [e.bankOf, e.row, e.exhaustBus, e.headerDelayMs]) expect(arr).toHaveLength(n);
    expect([...e.firingOrder].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(e.voice.pipeHz.length).toBe(Math.max(...e.exhaustBus) + 1);
    expect(e.voice.pan.length).toBe(e.voice.pipeHz.length);
    expect(e.idleRpm).toBeLessThan(e.redlineRpm);
    expect(e.redlineRpm).toBeLessThan(e.limiterRpm);
  });
});

describe('piston kinematics', () => {
  const r = 43;
  const l = 139;
  it('sits at r+l at TDC and l−r at BDC, so the stroke is 2r', () => {
    expect(near(pistonDistance(r, l, 0), r + l)).toBe(true);
    expect(near(pistonDistance(r, l, 180), l - r)).toBe(true);
  });
  it('never travels outside TDC..BDC', () => {
    for (let b = 0; b < 360; b += 1) {
      const d = pistonDistance(r, l, b);
      expect(d).toBeLessThanOrEqual(r + l + 1e-9);
      expect(d).toBeGreaterThanOrEqual(l - r - 1e-9);
    }
  });
  it('valves follow the four-stroke order', () => {
    expect(strokeOf(10)).toBe('power');
    expect(strokeOf(250)).toBe('exhaust');
    expect(strokeOf(450)).toBe('intake');
    expect(strokeOf(650)).toBe('compression');
    expect(exhaustLift(255)).toBeGreaterThan(0.9);
    expect(intakeLift(467)).toBeGreaterThan(0.9);
    expect(exhaustLift(0)).toBe(0); // both valves shut at the moment of firing
    expect(intakeLift(0)).toBe(0);
    expect(exhaustLift(650)).toBe(0);
  });
});

describe('firing order matches a real crankshaft', () => {
  const pinsFor = (e: EngineSpec) => pinAngles(e);
  const byRow = (e: EngineSpec) => {
    const pins = pinsFor(e);
    const rows = new Map<number, number[]>();
    e.row.forEach((r, i) => rows.set(r, [...(rows.get(r) ?? []), pins[i]]));
    return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);
  };

  it('V engines: both cylinders on a row share one crank pin', () => {
    for (const id of ['v8', 'v12', 'v10'] as const) {
      for (const pins of byRow(ENGINE_BY_ID[id])) {
        expect(pins).toHaveLength(2);
        expect(angleDiff(pins[0], pins[1])).toBeLessThan(1e-9);
      }
    }
  });

  it('V8 is a true crossplane: four pins 90° apart in two planes', () => {
    const rows = byRow(ENGINE_BY_ID.v8).map((p) => p[0]);
    const rel = rows.map((p) => mod(p - rows[0], 360));
    expect(rel).toEqual([0, 90, 270, 180]);
  });

  it('I6 and each V12 bank pair throws 1-6, 2-5, 3-4 at 120° spacing', () => {
    for (const pins of [pinsFor(ENGINE_BY_ID.i6), byRow(ENGINE_BY_ID.v12).map((p) => p[0])]) {
      expect(angleDiff(pins[0], pins[5])).toBeLessThan(1e-9);
      expect(angleDiff(pins[1], pins[4])).toBeLessThan(1e-9);
      expect(angleDiff(pins[2], pins[3])).toBeLessThan(1e-9);
      expect(angleDiff(pins[0], pins[1])).toBeCloseTo(120, 9);
      expect(angleDiff(pins[0], pins[2])).toBeCloseTo(120, 9);
    }
  });

  it('I4 is a flat-plane crank: 1 and 4 up together, 2 and 3 opposite', () => {
    const p = pinsFor(ENGINE_BY_ID.i4);
    expect(angleDiff(p[0], p[3])).toBeLessThan(1e-9);
    expect(angleDiff(p[1], p[2])).toBeLessThan(1e-9);
    expect(angleDiff(p[0], p[1])).toBeCloseTo(180, 9);
  });

  it('boxer: opposed pistons sit on pins 180° apart and move in and out together', () => {
    const e = ENGINE_BY_ID.b4;
    for (const pins of byRow(e)) expect(angleDiff(pins[0], pins[1])).toBeCloseTo(180, 9);
  });

  it('V10 banks fire like inline-5s, every 144°', () => {
    const e = ENGINE_BY_ID.v10;
    const fire = firingAngles(e);
    const bankA = fire.filter((_, i) => e.bankOf[i] === 0).sort((a, b) => a - b);
    for (let k = 1; k < bankA.length; k++) expect(bankA[k] - bankA[k - 1]).toBeCloseTo(144, 9);
  });

  it('crossplane V8 banks fire unevenly (the burble), the whole engine evenly', () => {
    const e = ENGINE_BY_ID.v8;
    const fire = firingAngles(e);
    const gaps = (bank: number) => {
      const a = fire.filter((_, i) => e.bankOf[i] === bank).sort((x, y) => x - y);
      return a.map((v, k) => mod((a[(k + 1) % a.length] ?? v) - v, 720));
    };
    expect([...gaps(0)].sort((a, b) => a - b)).toEqual([90, 180, 180, 270]);
    expect([...gaps(1)].sort((a, b) => a - b)).toEqual([90, 180, 180, 270]);
  });
});

describe('balance', () => {
  const s = (id: keyof typeof ENGINE_BY_ID) => balanceSummary(ENGINE_BY_ID[id]);
  it('inline-6 and V12 are perfectly balanced', () => {
    for (const id of ['i6', 'v12'] as const) {
      const b = s(id);
      expect(b.primaryForce).toBeLessThan(1e-9);
      expect(b.secondaryForce).toBeLessThan(1e-9);
      expect(b.primaryCouple).toBeLessThan(1e-9);
      expect(b.secondaryCouple).toBeLessThan(1e-9);
    }
  });
  it('inline-4 keeps a secondary force of 4λ (vertical buzz at 2× crank speed)', () => {
    const e = ENGINE_BY_ID.i4;
    const b = s('i4');
    expect(b.primaryForce).toBeLessThan(1e-9);
    expect(b.secondaryForce).toBeCloseTo((4 * e.stroke) / 2 / e.rodLength, 9);
    expect(b.secondaryCouple).toBeLessThan(1e-9);
  });
  it('boxer cancels its forces but keeps a small secondary rocking couple', () => {
    const b = s('b4');
    expect(b.primaryForce).toBeLessThan(1e-9);
    expect(b.secondaryForce).toBeLessThan(1e-9);
    expect(b.secondaryCouple).toBeGreaterThan(0.05);
  });
  it('crossplane V8 has no secondary force or couple', () => {
    const b = s('v8');
    expect(b.primaryForce).toBeLessThan(1e-9);
    expect(b.secondaryForce).toBeLessThan(1e-9);
    expect(b.secondaryCouple).toBeLessThan(1e-9);
  });
});

describe('pitch maths', () => {
  it('firing frequency is RPM × cylinders ÷ 120', () => {
    expect(firingHz(ENGINE_BY_ID.v8, 3300)).toBeCloseTo(220, 9);
    expect(rpmForHz(ENGINE_BY_ID.v10, 440)).toBeCloseTo(5280, 9); // the 2003 F1 stunt
    expect(rpmForHz(ENGINE_BY_ID.v12, 440)).toBeCloseTo(4400, 9);
    expect(rpmForHz(ENGINE_BY_ID.i4, 110)).toBeCloseTo(3300, 9);
  });
});
