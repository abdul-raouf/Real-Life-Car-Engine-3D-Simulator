// Offline renders of the engine voice, driven by the same sim the site uses.
// Usage: npm run render-wavs   (writes to out/)

import { mkdirSync, writeFileSync } from 'node:fs';
import { ENGINES, ENGINE_BY_ID, type EngineSpec } from '../src/engines/catalog.ts';
import { EngineDsp } from '../src/audio/dsp.ts';
import { EngineSim, type SimInput } from '../src/sim/engineSim.ts';
import { voiceParamsFromSim } from '../src/sim/bridge.ts';
import { rpmForMidi } from '../src/music/notes.ts';
import { SONGS, chartFor, songLength } from '../src/music/songs.ts';

const SR = 48000;
const BLOCK = 128;
const OUT = new URL('../out/', import.meta.url);
mkdirSync(OUT, { recursive: true });

type Script = (t: number, sim: EngineSim) => SimInput;

function renderScript(spec: EngineSpec, seconds: number, script: Script, startRunning = false) {
  const sim = new EngineSim(spec);
  const dsp = new EngineDsp(spec, SR, { seed: 11 });
  if (startRunning) {
    sim.start();
    for (let t = 0; t < 5; t += 0.01) sim.step(0.01, { pedal: 0, targetRpm: null });
  } else {
    sim.start();
  }
  dsp.set(voiceParamsFromSim(sim, 1));
  dsp.snap();
  const n = Math.round(seconds * SR);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i += BLOCK) {
    const t = i / SR;
    sim.step(BLOCK / SR, script(t, sim));
    dsp.set(voiceParamsFromSim(sim, 1));
    dsp.process(l, r, Math.min(BLOCK, n - i), i);
  }
  return { l, r };
}

function writeWav(name: string, l: Float32Array, r: Float32Array) {
  const n = l.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l[i])) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r[i])) * 32767), 46 + i * 4);
  }
  writeFileSync(new URL(name, OUT), buf);
}

function rmsDb(x: Float32Array, from: number, to: number) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return 20 * Math.log10(Math.sqrt(s / (to - from)) + 1e-12);
}

// 1. A short tour of each engine: start, idle, two blips, limiter, overrun.
const tour: Script = (t) => {
  if (t < 3.2) return { pedal: 0, targetRpm: null };
  if (t < 3.55) return { pedal: 0.6, targetRpm: null };
  if (t < 4.6) return { pedal: 0, targetRpm: null };
  if (t < 4.95) return { pedal: 0.85, targetRpm: null };
  if (t < 6.0) return { pedal: 0, targetRpm: null };
  if (t < 8.4) return { pedal: 1, targetRpm: null };
  return { pedal: 0, targetRpm: null };
};

const report: string[] = [];
for (const spec of ENGINES) {
  const { l, r } = renderScript(spec, 11.5, tour);
  writeWav(`${spec.id}-tour.wav`, l, r);
  report.push(`${spec.id.padEnd(4)} idle ${rmsDb(l, Math.round(SR * 2.2), Math.round(SR * 3.1)).toFixed(1)} dB   limiter ${rmsDb(l, Math.round(SR * 7.5), Math.round(SR * 8.3)).toFixed(1)} dB`);
}

// 2. Same note, six engines: A3 (220 Hz) where it fits, otherwise A in the nearest octave.
{
  const parts: { l: Float32Array; r: Float32Array }[] = [];
  for (const spec of ENGINES) {
    let midi = 57;
    while (rpmForMidi(spec, midi) < spec.idleRpm * 1.15) midi += 12;
    while (rpmForMidi(spec, midi) > spec.redlineRpm * 0.95) midi -= 12;
    const target = rpmForMidi(spec, midi);
    parts.push(renderScript(spec, 2.2, () => ({ pedal: 0, targetRpm: target }), true));
    report.push(`${spec.id.padEnd(4)} plays A${Math.floor(midi / 12) - 1} at ${Math.round(target)} rpm`);
  }
  const n = parts.reduce((s, p) => s + p.l.length, 0);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    const fade = Math.round(0.03 * SR);
    for (let i = 0; i < p.l.length; i++) {
      const g = Math.min(1, i / fade, (p.l.length - i) / fade);
      l[o + i] = p.l[i] * g;
      r[o + i] = p.r[i] * g;
    }
    o += p.l.length;
  }
  writeWav('same-note-six-engines.wav', l, r);
}

// 3. The ECU plays songs.
function playSong(spec: EngineSpec, songId: string, file: string) {
  const song = SONGS.find((s) => s.id === songId)!;
  const chart = chartFor(song, spec);
  const lead = 1.0;
  const total = lead + songLength(chart) + 1.5;
  let current = -1;
  const { l, r } = renderScript(
    spec,
    total,
    (t, sim) => {
      const st = t - lead;
      const idx = chart.findIndex((n) => st >= n.start && st < n.start + n.dur);
      if (idx !== current && idx >= 0) {
        current = idx;
        sim.articulate();
      }
      if (idx < 0) return { pedal: 0, targetRpm: null };
      return { pedal: 0, targetRpm: rpmForMidi(spec, chart[idx].midi) };
    },
    true,
  );
  writeWav(file, l, r);
}
playSong(ENGINE_BY_ID.v8, 'saints', 'saints-v8.wav');
playSong(ENGINE_BY_ID.v10, 'saints', 'saints-v10.wav');
playSong(ENGINE_BY_ID.v12, 'ode', 'ode-v12.wav');

console.log(report.join('\n'));
