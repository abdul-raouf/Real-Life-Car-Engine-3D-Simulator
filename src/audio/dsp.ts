// The engine voice. Pure TypeScript with no Web Audio dependencies, so the same code runs
// in the AudioWorklet, in the ScriptProcessor fallback and in Node for tests and WAV renders.
//
// Model, in the order sound travels:
//   1. A crank-phase clock advances every sample from the current RPM.
//   2. When a cylinder's exhaust valve opens, its blowdown pulse is rendered into that
//      exhaust bus, after the cylinder's own header delay. The pulse width is fixed in
//      crank degrees, so the harmonics follow engine orders as the revs rise.
//   3. Each bus runs through a pipe resonance (feedback comb) and a muffler lowpass.
//   4. Intake roar, valvetrain ticks, starter whine and overrun pops are added on top.
//   5. Soft saturation and a DC blocker finish the signal.

import type { EngineSpec } from '../engines/catalog.ts';
import { chamberEvents, firingAngles, mod } from '../engines/kinematics.ts';

export interface VoiceParams {
  rpm: number;
  /** Cylinder filling 0..1 (roughly manifold pressure). Sets pulse strength. */
  load: number;
  /** Driver throttle 0..1, for intake roar. */
  throttle: number;
  /** Fuel cut: rev limiter, ignition off, or the ECU braking down to a note. */
  cut: boolean;
  /** Starter motor engaged 0..1. */
  starter: number;
  /** Likelihood of afterfire pops 0..1: high on the limiter, some on overrun. */
  crackle: number;
  /** Master level 0..1. */
  master: number;
}

export interface DspOptions {
  /** No randomness at all: identical cylinders, no jitter, no noise, no pops. For tests. */
  deterministic?: boolean;
  seed?: number;
}

const RING = 1 << 14;
const RING_MASK = RING - 1;
const COMB = 1 << 12;
const COMB_MASK = COMB - 1;

const EV_EXHAUST = 0;
const EV_INTAKE = 1;
const EV_CLOSE = 2;
const EV_INJECT = 3;

interface EngineEvent {
  angle: number;
  kind: number;
  cyl: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  lowpass(fc: number, q: number, sr: number) {
    const w = (2 * Math.PI * Math.min(fc, sr * 0.45)) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    this.b0 = (1 - cos) / 2 / a0;
    this.b1 = (1 - cos) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  bandpass(fc: number, q: number, sr: number) {
    const w = (2 * Math.PI * Math.min(fc, sr * 0.45)) / sr;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b1 = 0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(x: number): number {
    // Transposed direct form II.
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  reset() {
    this.z1 = 0;
    this.z2 = 0;
  }
}

export class EngineDsp {
  readonly sr: number;
  private spec!: EngineSpec;
  private readonly deterministic: boolean;
  private rand: () => number;

  private target: VoiceParams = { rpm: 0, load: 0, throttle: 0, cut: true, starter: 0, crackle: 0, master: 0 };
  private rpm = 0;
  private load = 0;
  private throttle = 0;
  private starter = 0;
  private master = 0;
  private readonly smooth: number;

  private phase = 0;
  private cycleLen = 720;
  private evIdx = 0;
  private events: EngineEvent[] = [];
  private readPos = 0;

  private buses: Float32Array[] = [];
  private combs: Float32Array[] = [];
  private combLen: number[] = [];
  private combLp: number[] = [];
  private tones: Biquad[] = [];
  private panL: number[] = [];
  private panR: number[] = [];
  private center = new Float32Array(RING);
  private combPos = 0;

  private cylTrim: number[] = [];
  private delaySamples: number[] = [];
  private intakeBp = new Biquad();
  private intakeEnv = 0;
  private starterPhase = 0;
  private starterLp = 0;
  private dcxL = 0;
  private dcyL = 0;
  private dcxR = 0;
  private dcyR = 0;
  private blockCount = 0;
  private gaussSpare: number | null = null;

  /** Exhaust pulses fired since construction, for tests and the UI. */
  pulses = 0;
  pops = 0;

  constructor(spec: EngineSpec, sampleRate: number, opts: DspOptions = {}) {
    this.sr = sampleRate;
    this.deterministic = !!opts.deterministic;
    this.rand = mulberry32(opts.seed ?? 0x5eed);
    this.smooth = 1 - Math.exp(-1 / (0.008 * sampleRate));
    this.setEngine(spec);
  }

  setEngine(spec: EngineSpec) {
    this.spec = spec;
    const v = spec.voice;
    const nb = v.pipeHz.length;
    this.buses = Array.from({ length: nb }, () => new Float32Array(RING));
    this.combs = Array.from({ length: nb }, () => new Float32Array(COMB));
    this.combLen = v.pipeHz.map((hz) => Math.min(COMB - 2, this.sr / hz));
    this.combLp = new Array(nb).fill(0);
    this.tones = Array.from({ length: nb }, () => new Biquad());
    this.panL = v.pan.map((p) => Math.cos(((p + 1) * Math.PI) / 4));
    this.panR = v.pan.map((p) => Math.sin(((p + 1) * Math.PI) / 4));
    this.center.fill(0);
    this.cylTrim = Array.from({ length: spec.chambers }, () =>
      this.deterministic ? 1 : 1 + (this.rand() - 0.5) * 0.12,
    );
    this.delaySamples = spec.headerDelayMs.map((ms) => (ms * this.sr) / 1000);

    const fire = firingAngles(spec);
    const ce = chamberEvents(spec);
    const cyc = spec.cycleDeg;
    this.cycleLen = cyc;
    this.phase = mod(this.phase, cyc);
    const evs: EngineEvent[] = [];
    fire.forEach((f, cyl) => {
      evs.push({ angle: mod(f + ce.exhaustOpen, cyc), kind: EV_EXHAUST, cyl });
      evs.push({ angle: mod(f + ce.intakeOpen, cyc), kind: EV_INTAKE, cyl });
      if (spec.kind === 'piston') {
        // Valves seating: the valvetrain's tick. A rotary has no valves.
        evs.push({ angle: mod(f + ce.exhaustClose, cyc), kind: EV_CLOSE, cyl });
        evs.push({ angle: mod(f + ce.intakeClose, cyc), kind: EV_CLOSE, cyl });
      }
      if (v.injector) {
        // Direct injection fires early in the intake stroke.
        evs.push({ angle: mod(f + ce.intakeOpen + 0.3 * (ce.intakeClose - ce.intakeOpen), cyc), kind: EV_INJECT, cyl });
      }
    });
    evs.sort((a, b) => a.angle - b.angle);
    this.events = evs;
    this.seekEvents();
    this.updateFilters();
  }

  set(p: Partial<VoiceParams>) {
    Object.assign(this.target, p);
  }

  /** Jump straight to the target parameters (no smoothing). Used by offline renders. */
  snap() {
    this.rpm = this.target.rpm;
    this.load = this.target.load;
    this.throttle = this.target.throttle;
    this.starter = this.target.starter;
    this.master = this.target.master;
  }

  get currentRpm() {
    return this.rpm;
  }

  private seekEvents() {
    let i = 0;
    while (i < this.events.length && this.events[i].angle <= this.phase) i++;
    this.evIdx = i;
  }

  private gauss(): number {
    if (this.gaussSpare !== null) {
      const g = this.gaussSpare;
      this.gaussSpare = null;
      return g;
    }
    const u = Math.max(1e-12, this.rand());
    const w = this.rand() * 2 * Math.PI;
    const m = Math.sqrt(-2 * Math.log(u));
    this.gaussSpare = m * Math.sin(w);
    return m * Math.cos(w);
  }

  private updateFilters() {
    const v = this.spec.voice;
    const bright = 0.55 + 0.45 * this.load;
    for (const t of this.tones) t.lowpass(v.toneHz * bright, 0.75, this.sr);
    const x = this.rpm / this.spec.redlineRpm;
    this.intakeBp.bandpass(380 + 1100 * x, 1.1, this.sr);
  }

  /** Render a blowdown pulse into a ring buffer, starting `offset` samples from now. */
  private renderPulse(ring: Float32Array, offset: number, width: number, amp: number, noise: number) {
    const u0 = this.spec.voice.attack ?? 0.12;
    const start = Math.ceil(offset);
    const end = Math.min(RING - 1, Math.floor(offset + width));
    for (let k = start; k <= end; k++) {
      const u = (k - offset) / width;
      const r = u / u0;
      let s = r * Math.exp(1 - r);
      if (noise > 0) s += noise * (this.rand() * 2 - 1) * Math.exp(-u * 5);
      ring[(this.readPos + k) & RING_MASK] += amp * s;
    }
  }

  private renderPop(ring: Float32Array, offset: number, amp: number) {
    const width = 0.028 * this.sr;
    const start = Math.ceil(offset);
    const end = Math.min(RING - 1, Math.floor(offset + width));
    for (let k = start; k <= end; k++) {
      const u = (k - offset) / width;
      const env = Math.exp(-u * 4.5) * (1 - Math.exp(-u * 80));
      ring[(this.readPos + k) & RING_MASK] += amp * env * ((this.rand() * 2 - 1) * 0.9 + 0.35);
    }
  }

  private trigger(ev: EngineEvent, frac: number, dPhase: number) {
    const spec = this.spec;
    const v = spec.voice;
    if (ev.kind === EV_EXHAUST) {
      const bus = spec.exhaustBus[ev.cyl];
      const ring = this.buses[bus];
      const offset = frac + this.delaySamples[ev.cyl];
      const span = v.pulseSpanDeg * (1.15 - 0.3 * this.load);
      const width = Math.min(4000, span / Math.max(dPhase, 1e-4));
      const fired = !this.target.cut;
      let amp = fired ? 0.16 + 0.84 * this.load : 0.07;
      if (!this.deterministic) {
        // Combustion varies cycle to cycle, most at light load and low revs.
        const lowRev = Math.max(0, 1 - this.rpm / (2.2 * spec.idleRpm));
        const sigma = 0.035 + 0.09 * (1 - this.load) * lowRev;
        amp *= this.cylTrim[ev.cyl] * Math.max(0.2, 1 + sigma * this.gauss());
      }
      this.renderPulse(ring, offset, width, amp, this.deterministic ? 0 : v.grit * (0.35 + 0.65 * this.load));
      this.pulses++;

      if (!this.deterministic) {
        // Unburnt fuel lighting off in a hot header: overrun crackle and limiter bangs.
        const hot = Math.min(1, Math.max(0, (this.rpm / spec.redlineRpm - 0.3) / 0.4));
        if (hot > 0 && this.rand() < this.target.crackle * 0.05 * hot) {
          this.renderPop(ring, offset + (0.002 + this.rand() * 0.01) * this.sr, 0.6 + this.rand() * 0.9);
          this.pops++;
        }
      }
    } else if (ev.kind === EV_INTAKE) {
      this.intakeEnv = Math.min(1.6, this.intakeEnv + 0.7);
    } else if (ev.kind === EV_INJECT) {
      if (this.deterministic || !v.injector || this.target.cut) return;
      // High-pressure injector: a short metallic click, louder at light load where it is not masked.
      const amp = v.injector * 0.05 * (0.6 + 0.4 * (1 - this.load));
      const width = 0.0011 * this.sr;
      const start = Math.ceil(frac);
      const w = (2 * Math.PI * 4300) / this.sr;
      for (let k = start; k <= start + width; k++) {
        const t = k - frac;
        const env = Math.exp(-t / (0.00025 * this.sr));
        const s = 0.65 * Math.sin(w * t) + 0.35 * (this.rand() * 2 - 1);
        this.center[(this.readPos + k) & RING_MASK] += amp * env * s;
      }
    } else if (!this.deterministic && v.mech > 0) {
      const amp = v.mech * 0.045 * (0.35 + this.rpm / spec.redlineRpm);
      const width = 0.0007 * this.sr;
      const start = Math.ceil(frac);
      for (let k = start; k <= start + width; k++) {
        const u = (k - frac) / width;
        this.center[(this.readPos + k) & RING_MASK] += amp * (this.rand() * 2 - 1) * Math.exp(-u * 6);
      }
    }
  }

  process(outL: Float32Array, outR: Float32Array, n: number, offset = 0) {
    const spec = this.spec;
    const v = spec.voice;
    const sr = this.sr;
    const k = this.smooth;
    const t = this.target;
    const nb = this.buses.length;
    const fb = v.pipeFeedback;
    const drive = v.drive;
    const pre = v.gain * 0.55;
    const events = this.events;
    const ne = events.length;

    for (let i = 0; i < n; i++) {
      this.rpm += (t.rpm - this.rpm) * k;
      this.load += (t.load - this.load) * k;
      this.throttle += (t.throttle - this.throttle) * k;
      this.starter += (t.starter - this.starter) * k;
      this.master += (t.master - this.master) * k;

      if ((this.blockCount++ & 127) === 0) this.updateFilters();

      // 1. Crank clock and valve events.
      const dPhase = (this.rpm * 6) / sr;
      if (dPhase > 0) {
        let next = this.phase + dPhase;
        while (this.evIdx < ne && events[this.evIdx].angle <= next) {
          const ev = events[this.evIdx++];
          this.trigger(ev, (ev.angle - this.phase) / dPhase, dPhase);
        }
        if (next >= this.cycleLen) {
          next -= this.cycleLen;
          this.phase -= this.cycleLen;
          this.evIdx = 0;
          while (this.evIdx < ne && events[this.evIdx].angle <= next) {
            const ev = events[this.evIdx++];
            this.trigger(ev, (ev.angle - this.phase) / dPhase, dPhase);
          }
        }
        this.phase = next;
      }

      // 2. Exhaust buses through pipe and muffler.
      let L = 0;
      let R = 0;
      const cp = this.combPos;
      for (let b = 0; b < nb; b++) {
        const ring = this.buses[b];
        const x = ring[this.readPos];
        ring[this.readPos] = 0;
        const comb = this.combs[b];
        const d = this.combLen[b];
        const di = Math.floor(d);
        const df = d - di;
        const a = comb[(cp - di) & COMB_MASK];
        const c = comb[(cp - di - 1) & COMB_MASK];
        const delayed = a + (c - a) * df;
        this.combLp[b] += 0.4 * (delayed - this.combLp[b]);
        const y = x + fb * this.combLp[b];
        comb[cp] = y;
        const z = this.tones[b].process(y);
        L += z * this.panL[b];
        R += z * this.panR[b];
      }

      // 3. Intake, mechanical, starter.
      let mid = this.center[this.readPos];
      this.center[this.readPos] = 0;
      if (!this.deterministic && v.intake > 0) {
        const x = this.rpm / spec.redlineRpm;
        const amp = v.intake * 0.22 * this.throttle * this.throttle * (0.25 + x);
        mid += this.intakeBp.process(this.rand() * 2 - 1) * amp * (0.45 + this.intakeEnv);
      }
      this.intakeEnv *= 1 - 40 / sr;
      if (this.starter > 0.001) {
        this.starterPhase += ((this.rpm / 60) * 11) / sr;
        this.starterPhase -= Math.floor(this.starterPhase);
        const saw = 2 * this.starterPhase - 1;
        this.starterLp += 0.03 * (saw - this.starterLp);
        mid += this.starterLp * 0.07 * this.starter;
      }
      L += mid;
      R += mid;

      // 4. DC blocker (the pulses are one-sided), then saturation and level.
      this.dcyL = L - this.dcxL + 0.996 * this.dcyL;
      this.dcxL = L;
      this.dcyR = R - this.dcxR + 0.996 * this.dcyR;
      this.dcxR = R;
      outL[offset + i] = Math.tanh(drive * pre * this.dcyL) * 0.9 * this.master;
      outR[offset + i] = Math.tanh(drive * pre * this.dcyR) * 0.9 * this.master;

      this.readPos = (this.readPos + 1) & RING_MASK;
      this.combPos = (cp + 1) & COMB_MASK;
    }
  }
}
