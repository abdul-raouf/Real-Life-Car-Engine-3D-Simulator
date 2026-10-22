// Crank, piston and valve motion, plus the timing every engine shares. Everything is
// derived from the firing order and the geometry in the catalog, so the parts drawn on
// screen, the timing of each spark and the sound all come from one source of truth.

import { axisOf, type EngineSpec, type PistonSpec } from './catalog.ts';

export const DEG = Math.PI / 180;

export const mod = (a: number, m: number) => ((a % m) + m) % m;

/**
 * Cycle angle (0..cycleDeg) at which each chamber fires. Every engine here is
 * even-firing, so firings are spaced cycleDeg ÷ chambers apart in firing order.
 */
export function firingAngles(spec: EngineSpec): number[] {
  const step = spec.cycleDeg / spec.chambers;
  const out = new Array<number>(spec.chambers);
  spec.firingOrder.forEach((n, k) => {
    out[n - 1] = k * step;
  });
  return out;
}

/** Crank angle (0..360) at which each cylinder's piston is at top dead centre. */
export function tdcAngles(spec: PistonSpec): number[] {
  return firingAngles(spec).map((a) => mod(a, 360));
}

/**
 * Angular position of each cylinder's crank pin at crank angle 0. A piston is at TDC
 * when its pin points straight up its own bore, so pin = axis − tdc.
 */
export function pinAngles(spec: PistonSpec): number[] {
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

/** Where a chamber is in its own cycle: 0 = firing, up to cycleLen. */
export function localCycle(firing: number, cycle: number, cycleLen = 720): number {
  return mod(cycle - firing, cycleLen);
}

export type Stroke = 'power' | 'exhaust' | 'intake' | 'compression';

/** The four phases each take a quarter of the cycle, for pistons and rotors alike. */
export function strokeOf(local: number, cycleLen = 720): Stroke {
  const q = cycleLen / 4;
  if (local < q) return 'power';
  if (local < 2 * q) return 'exhaust';
  if (local < 3 * q) return 'intake';
  return 'compression';
}

export interface ChamberEvents {
  exhaustOpen: number;
  exhaustClose: number;
  intakeOpen: number;
  intakeClose: number;
}

/** Valve events in local cycle degrees (0 = firing TDC). Typical road-engine cam timing. */
export const VALVE_EVENTS: ChamberEvents = {
  exhaustOpen: 130, // 50° before bottom dead centre
  exhaustClose: 380, // 20° after TDC: overlap with the intake
  intakeOpen: 345, // 15° before TDC
  intakeClose: 590, // 50° after bottom dead centre
};

/**
 * Port events for a side-ported Wankel such as the Renesis, in shaft degrees on the
 * 1080° cycle (each phase lasts 270°). The side exhaust port closes before the intake
 * opens, so there is no overlap. Approximate: Mazda's exact figures are not published.
 */
export const PORT_EVENTS: ChamberEvents = {
  exhaustOpen: 225, // 45° before "bottom dead centre" at 270
  exhaustClose: 540,
  intakeOpen: 543,
  intakeClose: 865, // 55° after the intake phase ends at 810
};

export function chamberEvents(spec: EngineSpec): ChamberEvents {
  return spec.kind === 'rotary' ? PORT_EVENTS : VALVE_EVENTS;
}

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

/** Shaft turns per chamber cycle: 2 for a four-stroke, 3 for a Wankel. */
const turnsPerCycle = (spec: EngineSpec) => spec.cycleDeg / 360;

/**
 * Firing frequency in Hz. A four-stroke fires each cylinder every two turns
 * (RPM × cylinders ÷ 120); a Wankel fires each rotor once per shaft turn (RPM × rotors ÷ 60).
 */
export function firingHz(spec: EngineSpec, rpm: number): number {
  return (rpm / 60) * (spec.chambers / turnsPerCycle(spec));
}

export function rpmForHz(spec: EngineSpec, hz: number): number {
  return (hz * 60 * turnsPerCycle(spec)) / spec.chambers;
}

/** The divisor in "pitch = RPM ÷ n". */
export const pitchDivisor = (spec: EngineSpec) => (60 * turnsPerCycle(spec)) / spec.chambers;
