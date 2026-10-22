// Wankel geometry in the plane of a rotor housing, in millimetres.
//
// Local frame: x runs along the housing's long axis, y along its short axis (the
// "waist"). Spark plugs sit at +y; intake and exhaust ports at −y.
//
// The eccentric shaft turns at θ. A rotor's centre orbits at e·(cos θ, sin θ) while the
// rotor itself turns at θ/3, so each apex traces the epitrochoid
//     p(a) = e·(cos 3a, sin 3a) + R·(cos a, sin a).
// Each face fires once per rotor turn (1080° of shaft), and the rotor's three faces take
// turns, so every rotor fires once per shaft revolution.

import { DEG, mod } from './kinematics.ts';

export interface Vec2 {
  x: number;
  y: number;
}

export interface RotorPose {
  cx: number;
  cy: number;
  /** Rotor orientation (radians): apex k points at angle + 2πk/3. */
  angle: number;
}

export function housingPoint(R: number, e: number, a: number): Vec2 {
  return { x: e * Math.cos(3 * a) + R * Math.cos(a), y: e * Math.sin(3 * a) + R * Math.sin(a) };
}

export function housingOutline(R: number, e: number, n = 360): Vec2[] {
  return Array.from({ length: n }, (_, i) => housingPoint(R, e, (i / n) * Math.PI * 2));
}

/** Shaft angle (deg) for rotor r at cycle angle c. Rotor 0 starts with its eccentric at the plugs. */
export function shaftAngle(cycle: number, rotor: number, rotors: number): number {
  return cycle + 90 + (360 * rotor) / rotors;
}

export function rotorPose(e: number, cycle: number, rotor: number, rotors: number): RotorPose {
  const th = shaftAngle(cycle, rotor, rotors) * DEG;
  return { cx: e * Math.cos(th), cy: e * Math.sin(th), angle: th / 3 };
}

export function toHousing(p: Vec2, pose: RotorPose): Vec2 {
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  return { x: pose.cx + p.x * c - p.y * s, y: pose.cy + p.x * s + p.y * c };
}

export function apexes(R: number, pose: RotorPose): Vec2[] {
  return [0, 1, 2].map((k) => {
    const a = pose.angle + (2 * Math.PI * k) / 3;
    return { x: pose.cx + R * Math.cos(a), y: pose.cy + R * Math.sin(a) };
  });
}

/**
 * Rotor flank radius as a function of angle from an apex (0..120°), computed as the
 * inner envelope of the housing seen from the rotor: for every direction, the largest
 * radius that stays inside the housing at every shaft angle.
 */
export function flankProfile(R: number, e: number, bins = 240): Float64Array {
  const minR = new Float64Array(bins).fill(Infinity);
  const housing = housingOutline(R, e, 1440);
  for (let t = 0; t < 1080; t += 0.5) {
    const th = t * DEG;
    const cx = e * Math.cos(th);
    const cy = e * Math.sin(th);
    const c = Math.cos(-th / 3);
    const s = Math.sin(-th / 3);
    for (const p of housing) {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const u = dx * c - dy * s;
      const v = dx * s + dy * c;
      const phi = mod(Math.atan2(v, u) / DEG, 120);
      const b = Math.min(bins - 1, Math.floor((phi / 120) * bins));
      const rho = Math.hypot(u, v);
      if (rho < minR[b]) minR[b] = rho;
    }
  }
  // The flank is symmetric about its midline; fold to remove sampling noise.
  const out = new Float64Array(bins);
  for (let b = 0; b < bins; b++) out[b] = Math.min(minR[b], minR[bins - 1 - b]);
  return out;
}

/** Rotor outline in the rotor's own frame, apex 0 on +x, `clearance` inside the envelope. */
export function rotorOutline(R: number, e: number, clearance: number, perFlank = 60): Vec2[] {
  const prof = flankProfile(R, e);
  const bins = prof.length;
  const pts: Vec2[] = [];
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < perFlank; i++) {
      const phi = (i / perFlank) * 120;
      const b = Math.min(bins - 1, Math.floor((phi / 120) * bins));
      const rho = Math.min(prof[b], R) - clearance;
      const a = (phi + 120 * k) * DEG;
      pts.push({ x: rho * Math.cos(a), y: rho * Math.sin(a) });
    }
  }
  return pts;
}

/**
 * Cycle angle at which each chamber fires, from the geometry: a face fires when both
 * the eccentric and the face's midpoint point at the plugs (+y). Chamber index is
 * rotor × 3 + face, face k lying between apexes k and k+1.
 */
export function wankelFiringAngles(rotors: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < rotors; r++) {
    for (let k = 0; k < 3; k++) {
      let found = NaN;
      for (let c = 0; c < 1080; c += 0.5) {
        const th = shaftAngle(c, r, rotors);
        const face = th / 3 + 60 + 120 * k;
        const near = (a: number) => Math.abs(mod(a - 90 + 180, 360) - 180) < 1e-6;
        if (near(th) && near(face)) {
          found = c;
          break;
        }
      }
      out.push(found);
    }
  }
  return out;
}

/** Point-in-polygon by ray casting. */
export function insidePolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
