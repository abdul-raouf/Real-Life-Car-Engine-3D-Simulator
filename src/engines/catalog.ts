// The six "instruments". Geometry, operating range and voice for each engine.
//
// Conventions (shared with kinematics.ts and the 3D rig):
// - Cylinders are numbered from 1, arrays are indexed from 0 (index 0 = cylinder 1).
// - Angles are degrees. A cylinder axis angle is measured from vertical (+Y) in the
//   direction the crank rotates. Inline engines use 0, V banks use ±half the V angle,
//   flat engines use ±90.
// - `row` is the crank throw a cylinder sits on, counted from the front. Cylinders on
//   the same row of a V engine share one crank pin; on a boxer they are an opposed pair.

export type EngineId = 'i4' | 'b4' | 'i6' | 'v8' | 'v12' | 'v10';
export type Layout = 'inline' | 'v' | 'flat';

export interface Voice {
  /** Exhaust pipe resonance (Hz) per exhaust bus. */
  pipeHz: number[];
  /** Feedback of the pipe resonator, 0..1. */
  pipeFeedback: number;
  /** Crank degrees of exhaust blowdown. Shorter = sharper, brighter pulses. */
  pulseSpanDeg: number;
  /** Final lowpass cutoff (Hz). */
  toneHz: number;
  /** Broadband combustion noise riding on each pulse, 0..1. */
  grit: number;
  /** Intake roar at high throttle, 0..1. */
  intake: number;
  /** Valvetrain / mechanical tick level, 0..1. */
  mech: number;
  /** Saturation drive, 1 = clean. */
  drive: number;
  /** Stereo position per exhaust bus, -1..1. */
  pan: number[];
  /** Output trim so engines sit at similar loudness. */
  gain: number;
}

export interface EngineSpec {
  id: EngineId;
  name: string;
  short: string;
  role: string;
  layout: Layout;
  cylinders: number;
  /** Angle between the banks (0 inline, 180 flat). */
  vAngle: number;
  /** Axis angle of each bank. */
  bankAxis: number[];
  bankOf: number[];
  row: number[];
  firingOrder: number[];
  /** Which exhaust bus each cylinder breathes into. */
  exhaustBus: number[];
  /** Extra delay (ms) from exhaust port to collector, per cylinder. Unequal-length headers live here. */
  headerDelayMs: number[];
  bore: number; // mm
  stroke: number; // mm
  rodLength: number; // mm
  idleRpm: number;
  redlineRpm: number;
  limiterRpm: number;
  /** Effective rotating inertia (kg·m²): crank, flywheel, clutch. */
  inertia: number;
  peakTorque: number; // Nm
  peakTorqueRpm: number;
  /** Fraction of peak torque still available at idle and at redline. */
  torqueAtIdle: number;
  torqueAtRedline: number;
  /** Reciprocating mass per cylinder (kg): piston, pin, rings, small end of rod. */
  recipMass: number;
  voice: Voice;
  example: string;
  why: string;
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

export const ENGINES: EngineSpec[] = [
  {
    id: 'i4',
    name: 'Inline-4',
    short: 'I4',
    role: 'Bass',
    layout: 'inline',
    cylinders: 4,
    vAngle: 0,
    bankAxis: [0],
    bankOf: [0, 0, 0, 0],
    row: range(4),
    firingOrder: [1, 3, 4, 2],
    exhaustBus: [0, 0, 0, 0],
    headerDelayMs: [0, 0, 0, 0],
    bore: 86,
    stroke: 86,
    rodLength: 139,
    idleRpm: 800,
    redlineRpm: 7600,
    limiterRpm: 7800,
    inertia: 0.16,
    peakTorque: 210,
    peakTorqueRpm: 5500,
    torqueAtIdle: 0.62,
    torqueAtRedline: 0.82,
    recipMass: 0.45,
    voice: {
      pipeHz: [118],
      pipeFeedback: 0.55,
      pulseSpanDeg: 80,
      toneHz: 3800,
      grit: 0.35,
      intake: 0.55,
      mech: 0.35,
      drive: 1.6,
      pan: [0],
      gain: 0.9,
    },
    example: '2.0 L, naturally aspirated, high-revving hatchback style',
    why: 'Fires every 180°, so it sings an octave below a V8 at the same RPM. The pistons pair up and cancel their main shaking, but a second-order buzz remains: the whole engine hums up and down at twice crank speed.',
  },
  {
    id: 'b4',
    name: 'Flat-4 Boxer',
    short: 'B4',
    role: 'Rumble',
    layout: 'flat',
    cylinders: 4,
    vAngle: 180,
    bankAxis: [90, -90],
    bankOf: [0, 1, 0, 1],
    row: [0, 0, 1, 1],
    firingOrder: [1, 3, 2, 4],
    exhaustBus: [0, 0, 0, 0],
    // Unequal-length headers: each pulse reaches the collector at a different moment.
    headerDelayMs: [0, 0.55, 0.2, 0.8],
    bore: 99.5,
    stroke: 79,
    rodLength: 130.5,
    idleRpm: 750,
    redlineRpm: 6700,
    limiterRpm: 6900,
    inertia: 0.3,
    peakTorque: 390,
    peakTorqueRpm: 4000,
    torqueAtIdle: 0.45,
    torqueAtRedline: 0.7,
    recipMass: 0.55,
    voice: {
      pipeHz: [92],
      pipeFeedback: 0.6,
      pulseSpanDeg: 95,
      toneHz: 2600,
      grit: 0.45,
      intake: 0.45,
      mech: 0.25,
      drive: 2.0,
      pan: [0],
      gain: 1.0,
    },
    example: '2.5 L turbo rally-car boxer with unequal-length headers',
    why: 'It fires evenly, but the header pipes are different lengths, so the four pulses arrive at the collector unevenly spaced. Your ear hears that stagger as the famous off-beat burble. Opposed pistons cancel each other’s shaking almost perfectly.',
  },
  {
    id: 'i6',
    name: 'Inline-6',
    short: 'I6',
    role: 'Baritone',
    layout: 'inline',
    cylinders: 6,
    vAngle: 0,
    bankAxis: [0],
    bankOf: [0, 0, 0, 0, 0, 0],
    row: range(6),
    firingOrder: [1, 5, 3, 6, 2, 4],
    exhaustBus: [0, 0, 0, 0, 0, 0],
    headerDelayMs: [0, 0, 0, 0, 0, 0],
    bore: 82,
    stroke: 94.6,
    rodLength: 144,
    idleRpm: 750,
    redlineRpm: 7200,
    limiterRpm: 7400,
    inertia: 0.32,
    peakTorque: 420,
    peakTorqueRpm: 4800,
    torqueAtIdle: 0.55,
    torqueAtRedline: 0.78,
    recipMass: 0.5,
    voice: {
      pipeHz: [134],
      pipeFeedback: 0.5,
      pulseSpanDeg: 70,
      toneHz: 4600,
      grit: 0.25,
      intake: 0.5,
      mech: 0.3,
      drive: 1.4,
      pan: [0],
      gain: 0.95,
    },
    example: '3.0 L straight-six, classic German sports-sedan style',
    why: 'Six pistons in a row fire every 120°. Both halves of the engine mirror each other, so every shaking force and rocking couple cancels: the textbook “perfectly balanced” engine. Smooth, silky, slightly turbine-like.',
  },
  {
    id: 'v8',
    name: 'Crossplane V8',
    short: 'V8',
    role: 'Lead',
    layout: 'v',
    cylinders: 8,
    vAngle: 90,
    bankAxis: [45, -45],
    bankOf: [0, 1, 0, 1, 0, 1, 0, 1],
    row: [0, 0, 1, 1, 2, 2, 3, 3],
    firingOrder: [1, 8, 7, 2, 6, 5, 4, 3],
    exhaustBus: [0, 1, 0, 1, 0, 1, 0, 1],
    headerDelayMs: [0, 0, 0, 0, 0, 0, 0, 0],
    bore: 103.25,
    stroke: 92,
    rodLength: 154,
    idleRpm: 700,
    redlineRpm: 6600,
    limiterRpm: 6800,
    inertia: 0.42,
    peakTorque: 580,
    peakTorqueRpm: 4600,
    torqueAtIdle: 0.62,
    torqueAtRedline: 0.8,
    recipMass: 0.6,
    voice: {
      pipeHz: [96, 96],
      pipeFeedback: 0.62,
      pulseSpanDeg: 88,
      toneHz: 3000,
      grit: 0.4,
      intake: 0.4,
      mech: 0.25,
      drive: 1.9,
      pan: [-0.55, 0.55],
      gain: 0.85,
    },
    example: '6.2 L pushrod-era American muscle V8 (drawn here with overhead cams)',
    why: 'It fires every 90°, but each bank fires unevenly (gaps of 180°, 270°, 180°, 90°). With one exhaust per bank, each pipe gets lumpy pulses, and that is the burble. The crossplane crank cancels second-order shake, at the cost of heavy counterweights.',
  },
  {
    id: 'v12',
    name: 'V12',
    short: 'V12',
    role: 'Tenor',
    layout: 'v',
    cylinders: 12,
    vAngle: 60,
    bankAxis: [-30, 30],
    bankOf: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
    row: [0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5],
    firingOrder: [1, 7, 5, 11, 3, 9, 6, 12, 2, 8, 4, 10],
    exhaustBus: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
    headerDelayMs: new Array(12).fill(0),
    bore: 94,
    stroke: 78,
    rodLength: 147,
    idleRpm: 900,
    redlineRpm: 9000,
    limiterRpm: 9250,
    inertia: 0.34,
    peakTorque: 720,
    peakTorqueRpm: 6000,
    torqueAtIdle: 0.5,
    torqueAtRedline: 0.82,
    recipMass: 0.42,
    voice: {
      pipeHz: [152, 152],
      pipeFeedback: 0.45,
      pulseSpanDeg: 62,
      toneHz: 6200,
      grit: 0.22,
      intake: 0.65,
      mech: 0.35,
      drive: 1.5,
      pan: [-0.45, 0.45],
      gain: 0.85,
    },
    example: '6.5 L naturally aspirated Italian grand-tourer V12',
    why: 'Two perfectly balanced inline-sixes sharing a crank, firing every 60°. Pitch is RPM ÷ 10, so at 4,400 RPM it hits concert A (440 Hz). Twelve overlapping pulses blur into a smooth, rising wail.',
  },
  {
    id: 'v10',
    name: 'F1-style V10',
    short: 'V10',
    role: 'Soprano',
    layout: 'v',
    cylinders: 10,
    vAngle: 72,
    bankAxis: [-36, 36],
    bankOf: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
    row: [0, 1, 2, 3, 4, 0, 1, 2, 3, 4],
    firingOrder: [1, 6, 2, 7, 4, 9, 5, 10, 3, 8],
    exhaustBus: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
    headerDelayMs: new Array(10).fill(0),
    bore: 97,
    stroke: 40.5,
    rodLength: 100,
    idleRpm: 4200,
    redlineRpm: 18500,
    limiterRpm: 19000,
    inertia: 0.035,
    peakTorque: 330,
    peakTorqueRpm: 15000,
    torqueAtIdle: 0.4,
    torqueAtRedline: 0.88,
    recipMass: 0.3,
    voice: {
      pipeHz: [310, 310],
      pipeFeedback: 0.35,
      pulseSpanDeg: 55,
      toneHz: 9000,
      grit: 0.18,
      intake: 0.6,
      mech: 0.45,
      drive: 1.3,
      pan: [-0.35, 0.35],
      gain: 0.7,
    },
    example: '3.0 L, 72° V10 in the style of early-2000s Formula 1',
    why: 'Tiny stroke, featherweight crank, 18,500 RPM. Pitch is RPM ÷ 12, so concert A needs 5,280 RPM: exactly the maths behind the 2003 F1 car that played “When the Saints Go Marching In”. Revs so fast it snaps between notes.',
  },
];

export const ENGINE_BY_ID: Record<EngineId, EngineSpec> = Object.fromEntries(
  ENGINES.map((e) => [e.id, e]),
) as Record<EngineId, EngineSpec>;

export function axisOf(spec: EngineSpec, cylIndex: number): number {
  return spec.bankAxis[spec.bankOf[cylIndex]];
}

export function displacementLitres(spec: EngineSpec): number {
  const r = spec.bore / 2;
  return (Math.PI * r * r * spec.stroke * spec.cylinders) / 1e6;
}
