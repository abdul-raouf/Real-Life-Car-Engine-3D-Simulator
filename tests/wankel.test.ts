import { describe, expect, it } from 'vitest';
import { ENGINE_BY_ID, displacementLitres, wankelChamberCc, type RotarySpec } from '../src/engines/catalog.ts';
import { firingAngles, firingHz, mod } from '../src/engines/kinematics.ts';
import {
  apexes,
  flankProfile,
  housingOutline,
  insidePolygon,
  rotorOutline,
  rotorPose,
  toHousing,
  wankelFiringAngles,
} from '../src/engines/wankel.ts';

const spec = ENGINE_BY_ID.r2 as RotarySpec;
const R = spec.generatingRadius;
const e = spec.eccentricity;

describe('Renesis geometry', () => {
  it('sweeps 654 cc per chamber, 1.3 L in all', () => {
    expect(wankelChamberCc(spec)).toBeCloseTo(654.7, 0);
    expect(displacementLitres(spec)).toBeCloseTo(1.309, 2);
  });

  it('apexes ride the housing at every shaft angle', () => {
    const housing = housingOutline(R, e, 4000);
    for (let c = 0; c < 1080; c += 7) {
      for (const p of apexes(R, rotorPose(e, c, 0, 2))) {
        const d = Math.min(...housing.map((h) => Math.hypot(h.x - p.x, h.y - p.y)));
        expect(d).toBeLessThan(0.25);
      }
    }
  });

  it('the rotor never touches the housing (inner envelope)', () => {
    const housing = housingOutline(R, e, 1440);
    const rotor = rotorOutline(R, e, 0.6);
    for (let c = 0; c < 1080; c += 3) {
      for (const r of [0, 1]) {
        const pose = rotorPose(e, c, r, 2);
        for (const p of rotor) expect(insidePolygon(toHousing(p, pose), housing)).toBe(true);
      }
    }
  });

  it('flanks are as full as the housing allows: R at the apex, R − 2e at mid-flank', () => {
    const prof = flankProfile(R, e);
    expect(prof[0]).toBeGreaterThan(R - 1);
    const mid = prof[Math.floor(prof.length / 2)];
    expect(mid).toBeCloseTo(R - 2 * e, 0);
  });
});

describe('Renesis timing', () => {
  it('firing order in the catalog matches the geometry', () => {
    const derived = wankelFiringAngles(2);
    expect(derived.every(Number.isFinite)).toBe(true);
    expect(derived).toEqual(firingAngles(spec));
  });

  it('the two rotors take turns every 180° of shaft', () => {
    const fire = [...firingAngles(spec)].sort((a, b) => a - b);
    for (let k = 0; k < fire.length; k++) {
      const next = fire[(k + 1) % fire.length] + (k + 1 === fire.length ? 1080 : 0);
      expect(next - fire[k]).toBeCloseTo(180, 9);
    }
    // Rotor A faces (chambers 1-3) are 360° apart: one bang per shaft turn per rotor.
    const a = firingAngles(spec).slice(0, 3).sort((x, y) => x - y);
    expect(a).toEqual([0, 360, 720]);
  });

  it('sounds at RPM ÷ 30: 300 Hz at the 9,000 rpm redline', () => {
    expect(firingHz(spec, 9000)).toBeCloseTo(300, 9);
    expect(firingHz(spec, 3000)).toBeCloseTo(100, 9);
  });

  it('turns the rotor once for every three shaft turns', () => {
    const p0 = rotorPose(e, 0, 0, 2);
    const p1 = rotorPose(e, 1080, 0, 2);
    expect(mod((p1.angle - p0.angle) / (Math.PI * 2), 1)).toBeCloseTo(0, 9);
    expect((p1.angle - p0.angle) / (Math.PI * 2)).toBeCloseTo(1, 9);
  });
});
