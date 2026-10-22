// Crank, piston and valve motion. Everything is derived from the firing order and the
// cylinder axis angles in the catalog, so the crank drawn on screen, the timing of
// each spark and the sound all come from one source of truth.

import { axisOf, type EngineSpec } from './catalog.ts';

export const DEG = Math.PI / 180;

export const mod = (a: number, m: number) => ((a % m) + m) % m;

/** Cycle angle (0..720) at which each cylinder reaches firing TDC. Every engine here is even-firing. */
export function firingAngles(spec: EngineSpec): number[] {
  const step = 720 / spec.cylinders;
  const out = new Array<number>(spec.cylinders);
  spec.firingOrder.forEach((cyl, k) => {
    out[cyl - 1] = k * step;
  });
  return out;
}

/** Crank angle (0..360) at which each cylinder's piston is at top dead centre. */
export function tdcAngles(spec: EngineSpec): number[] {
  return firingAngles(spec).map((a) => mod(a, 360));
}

/**
 * Angular position of each cylinder's crank pin at crank angle 0. A piston is at TDC
 * when its pin points straight up its own bore, so pin = axis − tdc.
 */
export function pinAngles(spec: EngineSpec): number[] {
  const tdc = tdcAngles(spec);
  return tdc.map((t, i) => mod(axisOf(spec, i) - t, 360));
}

/** Angle between the crank pin and the cylinder axis. 0 = TDC, 180 = BDC. */
export function crankBeta(tdc: number, crankDeg: number): number {
  return mod(crankDeg - tdc, 360);
}

/** Distance from crank centre to piston pin (same units as r and l). */
export function pistonDistance(r: number, l: number, betaDeg: number): number {
  const b = betaDeg * DEG;
  const s = r * Math.sin(b);
  return r * Math.cos(b) + Math.sqrt(l * l - s * s);
}

/** Angle of the connecting rod away from the bore axis (radians). */
export function rodAngle(r: number, l: number, betaDeg: number): number {
  return Math.asin((r * Math.sin(betaDeg * DEG)) / l);
}

/** Where cylinder i is in its own four-stroke cycle: 0 = firing TDC, 0..720. */
export function localCycle(firing: number, cycleDeg: number): number {
  return mod(cycleDeg - firing, 720);
}

export type Stroke = 'power' | 'exhaust' | 'intake' | 'compression';

export function strokeOf(local: number): Stroke {
  if (local < 180) return 'power';
  if (local < 360) return 'exhaust';
  if (local < 540) return 'intake';
  return 'compression';
}

/** Valve events in local cycle degrees (0 = firing TDC). Typical road-engine cam timing. */
export const VALVE_EVENTS = {
  exhaustOpen: 130, // 50° before bottom dead centre
  exhaustClose: 380, // 20° after TDC: overlap with the intake
  intakeOpen: 345, // 15° before TDC
  intakeClose: 590, // 50° after bottom dead centre
} as const;

/** 0..1 valve lift. A smooth sin² bump between the open and close angles. */
export function valveLift(local: number, open: number, close: number): number {
  if (local < open || local > close) return 0;
  const s = Math.sin((Math.PI * (local - open)) / (close - open));
  return s * s;
}

export function exhaustLift(local: number): number {
  return valveLift(local, VALVE_EVENTS.exhaustOpen, VALVE_EVENTS.exhaustClose);
}

export function intakeLift(local: number): number {
  return valveLift(local, VALVE_EVENTS.intakeOpen, VALVE_EVENTS.intakeClose);
}

/** Firing frequency in Hz: one bang per cylinder every two revolutions. */
export function firingHz(spec: EngineSpec, rpm: number): number {
  return (rpm * spec.cylinders) / 120;
}

export function rpmForHz(spec: EngineSpec, hz: number): number {
  return (hz * 120) / spec.cylinders;
}
