// Shaking forces from the reciprocating pistons.
//
// Each piston's inertia force along its bore is  m·r·ω²·(cos β + λ·cos 2β),  λ = r/l.
// Written as complex numbers in the plane across the crank (y + iz), every term splits
// into a part that rotates with the crank (e^{+iθ}) and one that rotates against it
// (e^{−iθ}). Crank counterweights can only cancel the first-order part that rotates with
// the crank, so that is removed. What is left is what the engine mounts actually feel.

import { axisOf, type PistonSpec } from './catalog.ts';
import { DEG, mod, pinAngles, tdcAngles } from './kinematics.ts';

type C = [number, number];

const cexp = (a: number): C => [Math.cos(a), Math.sin(a)];
const add = (a: C, b: C): C => [a[0] + b[0], a[1] + b[1]];
const scale = (a: C, k: number): C => [a[0] * k, a[1] * k];
const mul = (a: C, b: C): C => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const abs = (a: C) => Math.hypot(a[0], a[1]);

/** True when the two cylinders on a V-engine throw sit on separate, angled pins. */
export function hasSplitPins(spec: PistonSpec): boolean {
  if (spec.layout !== 'v') return false;
  const pins = pinAngles(spec);
  return spec.row.some((r, i) =>
    spec.row.some((r2, j) => j > i && r2 === r && Math.abs(mod(pins[i] - pins[j] + 180, 360) - 180) > 1e-6),
  );
}

/** Position of each cylinder along the crank, in throw pitches, centred on zero. */
export function crankPositions(spec: PistonSpec): number[] {
  // Split pins need room for a thin "flying web" between the two rods.
  const vOffset = hasSplitPins(spec) ? 0.36 : 0.28;
  const bankOffset = spec.layout === 'flat' ? 0.5 : spec.layout === 'v' ? vOffset : 0;
  const xs = spec.row.map((r, i) => r + spec.bankOf[i] * bankOffset);
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return xs.map((x) => x - mean);
}

export interface BalanceCoefficients {
  /** Per-unit (m·r·ω² = 1) coefficients. f = force, m = moment; 1/2 = order; fwd/bwd = rotation sense. */
  f1bwd: C;
  m1bwd: C;
  f2fwd: C;
  f2bwd: C;
  m2fwd: C;
  m2bwd: C;
  lambda: number;
}

export function balanceCoefficients(spec: PistonSpec): BalanceCoefficients {
  const tdc = tdcAngles(spec);
  const xs = crankPositions(spec);
  const lambda = spec.stroke / 2 / spec.rodLength;
  const zero: C = [0, 0];
  let f1bwd = zero;
  let m1bwd = zero;
  let f2fwd = zero;
  let f2bwd = zero;
  let m2fwd = zero;
  let m2bwd = zero;
  const iUnit: C = [0, 1];
  for (let i = 0; i < spec.cylinders; i++) {
    const a = axisOf(spec, i) * DEG;
    const t = tdc[i] * DEG;
    const b1 = scale(cexp(a + t), 0.5);
    const s2f = scale(cexp(a - 2 * t), 0.5 * lambda);
    const s2b = scale(cexp(a + 2 * t), 0.5 * lambda);
    f1bwd = add(f1bwd, b1);
    f2fwd = add(f2fwd, s2f);
    f2bwd = add(f2bwd, s2b);
    // Moment of a force at position x along the crank: i·x·F (in the same complex plane).
    const ix = scale(iUnit, xs[i]);
    m1bwd = add(m1bwd, mul(ix, b1));
    m2fwd = add(m2fwd, mul(ix, s2f));
    m2bwd = add(m2bwd, mul(ix, s2b));
  }
  return { f1bwd, m1bwd, f2fwd, f2bwd, m2fwd, m2bwd, lambda };
}

export interface BalanceSummary {
  /** Peak magnitudes per unit m·r·ω². Moments are per unit throw pitch. */
  primaryForce: number;
  secondaryForce: number;
  primaryCouple: number;
  secondaryCouple: number;
}

export function balanceSummary(spec: PistonSpec): BalanceSummary {
  const c = balanceCoefficients(spec);
  // A forward plus a backward rotating vector peaks at the sum of their lengths.
  return {
    primaryForce: abs(c.f1bwd),
    secondaryForce: abs(c.f2fwd) + abs(c.f2bwd),
    primaryCouple: abs(c.m1bwd),
    secondaryCouple: abs(c.m2fwd) + abs(c.m2bwd),
  };
}

export interface Shake {
  /** Force across the crank (N): y = up, z = sideways. */
  fy: number;
  fz: number;
  /** Rocking moment (N·m) as a vector across the crank. */
  my: number;
  mz: number;
}

/** Instantaneous residual shake at crank angle θ (deg) and engine speed (rpm). */
export function shakeAt(
  spec: PistonSpec,
  c: BalanceCoefficients,
  crankDeg: number,
  rpm: number,
  pitchMetres = spec.bore * 1.25e-3,
): Shake {
  const w = (rpm * 2 * Math.PI) / 60;
  const unit = spec.recipMass * (spec.stroke / 2000) * w * w;
  const th = crankDeg * DEG;
  const e1b = cexp(-th);
  const e2f = cexp(2 * th);
  const e2b = cexp(-2 * th);
  const f = add(mul(c.f1bwd, e1b), add(mul(c.f2fwd, e2f), mul(c.f2bwd, e2b)));
  const m = add(mul(c.m1bwd, e1b), add(mul(c.m2fwd, e2f), mul(c.m2bwd, e2b)));
  return {
    fy: f[0] * unit,
    fz: f[1] * unit,
    my: m[0] * unit * pitchMetres,
    mz: m[1] * unit * pitchMetres,
  };
}
