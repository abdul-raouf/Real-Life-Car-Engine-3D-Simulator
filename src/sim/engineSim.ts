// Engine speed dynamics for a free-revving engine on a stand.
//
//   I · dω/dt = load · T_wot(rpm) − T_friction(rpm) − T_pumping(rpm, load)
//
// `load` is cylinder filling. It chases the throttle plate through a short manifold lag.
// Heavy flywheels glide between notes; the V10's featherweight crank snaps.
// An idle controller holds idle when nobody is on the pedal. In ECU mode a feedforward +
// PI controller holds a target RPM (that is how the engine "plays" a note) and cuts fuel
// to fall to a lower note faster.

import type { EngineSpec } from '../engines/catalog.ts';

export type EngineState = 'off' | 'cranking' | 'running';

export interface SimInput {
  /** Driver pedal 0..1. Ignored while targetRpm is set. */
  pedal: number;
  /** RPM the ECU should hold, or null for direct pedal control. */
  targetRpm: number | null;
}

const MANIFOLD_TAU = 0.035;
/** Closed-throttle pumping loss at redline, as a fraction of peak torque. */
const PUMPING = 0.25;
const CRANK_RPM = 240;
const CRANK_TIME = 0.75;
const RAD_PER_RPM = (2 * Math.PI) / 60;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export class EngineSim {
  spec: EngineSpec;
  state: EngineState = 'off';
  rpm = 0;
  load = 0;
  throttle = 0;
  limiterCut = false;
  ecuCut = false;
  /** Net crank torque (Nm) from the last step, for the HUD. */
  torque = 0;
  private stateTime = 0;
  private flare = 0;
  private idleInteg = 0;
  private ecuInteg = 0;
  private stabTime = 0;

  constructor(spec: EngineSpec) {
    this.spec = spec;
  }

  get cut(): boolean {
    return this.state !== 'running' || this.limiterCut || this.ecuCut || this.stabTime > 0;
  }

  /** A short ignition cut, so a repeated note is heard as a new note. */
  articulate(seconds = 0.045) {
    this.stabTime = seconds;
  }

  get starter(): number {
    return this.state === 'cranking' ? 1 : 0;
  }

  /** Mechanical power (kW) currently produced by combustion. */
  get powerKw(): number {
    if (this.cut) return 0;
    return (this.load * this.wot(this.rpm) * this.spec.peakTorque * this.rpm * RAD_PER_RPM) / 1000;
  }

  start() {
    if (this.state === 'off') {
      this.state = 'cranking';
      this.stateTime = 0;
    }
  }

  stop() {
    this.state = 'off';
    this.limiterCut = false;
    this.ecuCut = false;
  }

  /** Swap the engine on the stand. A running engine comes back at idle. */
  setEngine(spec: EngineSpec) {
    this.spec = spec;
    this.idleInteg = 0;
    this.ecuInteg = 0;
    this.limiterCut = false;
    this.ecuCut = false;
    if (this.state === 'running') {
      this.rpm = spec.idleRpm;
      this.load = this.loadToHold(spec.idleRpm);
      this.flare = 0;
    }
  }

  /** Fraction of peak torque available at full throttle. */
  wot(rpm: number): number {
    const s = this.spec;
    if (rpm <= s.peakTorqueRpm) {
      const x = clamp((s.peakTorqueRpm - rpm) / (s.peakTorqueRpm - s.idleRpm), 0, 1.6);
      return Math.max(0.12, 1 - (1 - s.torqueAtIdle) * x * x);
    }
    const x = (rpm - s.peakTorqueRpm) / (s.redlineRpm - s.peakTorqueRpm);
    return Math.max(0.08, 1 - (1 - s.torqueAtRedline) * x * x);
  }

  /** Friction plus pumping loss, as a fraction of peak torque. */
  losses(rpm: number, load: number): number {
    const x = rpm / this.spec.redlineRpm;
    return 0.04 + 0.07 * x + 0.04 * x * x + PUMPING * (1 - load) * x;
  }

  /** Cylinder filling that exactly balances the losses at this speed. */
  loadToHold(rpm: number): number {
    const x = rpm / this.spec.redlineRpm;
    const fr = 0.04 + 0.07 * x + 0.04 * x * x;
    return clamp((fr + PUMPING * x) / (this.wot(rpm) + PUMPING * x), 0, 1);
  }

  step(dt: number, input: SimInput) {
    let remaining = Math.min(dt, 0.1);
    while (remaining > 1e-9) {
      const h = Math.min(remaining, 0.001);
      this.substep(h, input);
      remaining -= h;
    }
  }

  private substep(h: number, input: SimInput) {
    const s = this.spec;
    this.stateTime += h;

    if (this.state === 'off') {
      this.throttle = 0;
      this.load += (0 - this.load) * (h / MANIFOLD_TAU);
      this.integrate(h, 0);
      return;
    }

    if (this.state === 'cranking') {
      // The starter drags the crank to about 240 rpm, with no combustion yet.
      this.rpm += (CRANK_RPM - this.rpm) * (h / 0.14);
      this.load = 0;
      if (this.stateTime >= CRANK_TIME) {
        this.state = 'running';
        this.stateTime = 0;
        this.flare = 0.55;
        this.idleInteg = 0.18;
      }
      return;
    }

    // Running.
    this.flare *= 1 - h / 1.1;
    this.stabTime = Math.max(0, this.stabTime - h);
    const target = input.targetRpm === null ? null : clamp(input.targetRpm, s.idleRpm, s.redlineRpm);
    if (target !== null) {
      // ECU mode: feedforward + PI on relative error, with a little rate damping.
      const err = (target - this.rpm) / target;
      const accel = this.torque / s.inertia / RAD_PER_RPM / target; // relative rpm per second
      const raw = this.loadToHold(target) + 9 * err + this.ecuInteg - 0.04 * accel;
      // Integrate only near the note and while the throttle is not pinned (no wind-up).
      if (Math.abs(err) < 0.03 && raw > 0 && raw < 1) {
        this.ecuInteg = clamp(this.ecuInteg + err * h * 6, -0.05, 0.05);
      }
      this.throttle = clamp(raw, 0, 1);
      this.ecuCut = err < -0.035;
      this.idleInteg = 0;
    } else {
      this.ecuCut = false;
      this.ecuInteg = 0;
      const idleTarget = s.idleRpm * (1 + this.flare);
      const err = (idleTarget - this.rpm) / s.idleRpm;
      this.idleInteg = clamp(this.idleInteg + err * h * 1.5, 0, 0.4);
      const idleAir = clamp(this.loadToHold(idleTarget) + 1.2 * err + this.idleInteg, 0, 0.6);
      const pedal = Math.pow(clamp(input.pedal, 0, 1), 1.3);
      this.throttle = Math.max(pedal, idleAir);
    }

    // Rev limiter: fuel cut with hysteresis, which makes the needle bounce.
    if (this.rpm >= s.limiterRpm) this.limiterCut = true;
    else if (this.limiterCut && this.rpm < s.limiterRpm * 0.975) this.limiterCut = false;

    this.load += (this.throttle - this.load) * Math.min(1, h / MANIFOLD_TAU);
    const combustion = this.cut ? 0 : this.load * this.wot(this.rpm);
    this.integrate(h, combustion);
  }

  private integrate(h: number, combustionFrac: number) {
    const s = this.spec;
    // Losses fade out as the crank stops, so it settles at exactly zero.
    const lossFrac = this.losses(this.rpm, this.load) * Math.min(1, this.rpm / 150);
    this.torque = (combustionFrac - lossFrac) * s.peakTorque;
    const dRpm = (this.torque / s.inertia / RAD_PER_RPM) * h;
    this.rpm = Math.max(0, this.rpm + dRpm);
  }
}
