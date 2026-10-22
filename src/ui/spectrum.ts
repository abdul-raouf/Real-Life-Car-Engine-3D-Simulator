// Live spectrum strip with a marker on the firing frequency: the note you hear.

import type { EngineSpec } from '../engines/catalog.ts';
import { firingHz } from '../engines/kinematics.ts';
import { midiAtRpm, noteName } from '../music/notes.ts';

const F_MIN = 20;
const F_MAX = 5000;

export class Spectrum {
  private ctx: CanvasRenderingContext2D;
  private data: Float32Array<ArrayBuffer> = new Float32Array(0);
  private colors = { ink: '#fff', dim: '#888', gold: '#d9a54d', blue: '#74a9ff', line: '#333' };

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.readColors();
  }

  readColors() {
    const s = getComputedStyle(document.documentElement);
    const v = (n: string) => s.getPropertyValue(n).trim() || '#888';
    this.colors = { ink: v('--ink'), dim: v('--ink-2'), gold: v('--gold'), blue: v('--blue'), line: v('--line') };
  }

  draw(analyser: AnalyserNode | null, spec: EngineSpec, rpm: number) {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = this.ctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const xOf = (f: number) => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * w;

    g.strokeStyle = this.colors.line;
    g.lineWidth = 1;
    g.font = '9px "Martian Mono", monospace';
    g.fillStyle = this.colors.dim;
    for (const f of [50, 100, 200, 500, 1000, 2000]) {
      const x = Math.round(xOf(f)) + 0.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
      g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 3, h - 3);
    }

    if (analyser) {
      if (this.data.length !== analyser.frequencyBinCount) this.data = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(this.data);
      const binHz = analyser.context.sampleRate / analyser.fftSize;
      g.beginPath();
      g.moveTo(0, h);
      const cols = Math.floor(w / 2);
      for (let k = 0; k <= cols; k++) {
        const x = (k / cols) * w;
        const f = F_MIN * Math.pow(F_MAX / F_MIN, k / cols);
        const f2 = F_MIN * Math.pow(F_MAX / F_MIN, (k + 1) / cols);
        let peak = -140;
        for (let b = Math.floor(f / binHz); b <= Math.ceil(f2 / binHz) && b < this.data.length; b++) peak = Math.max(peak, this.data[b]);
        const v = Math.max(0, Math.min(1, (peak + 100) / 80));
        g.lineTo(x, h - v * (h - 4));
      }
      g.lineTo(w, h);
      g.closePath();
      g.fillStyle = this.colors.blue;
      g.globalAlpha = 0.28;
      g.fill();
      g.globalAlpha = 0.9;
      g.strokeStyle = this.colors.blue;
      g.lineWidth = 1.2;
      g.stroke();
      g.globalAlpha = 1;
    }

    const fh = firingHz(spec, rpm);
    if (rpm > 50 && fh > F_MIN && fh < F_MAX) {
      const x = xOf(fh);
      g.strokeStyle = this.colors.gold;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
      g.fillStyle = this.colors.gold;
      g.font = '600 10px "Martian Mono", monospace';
      const label = `${noteName(midiAtRpm(spec, rpm))} firing`;
      const tw = g.measureText(label).width;
      g.fillText(label, Math.min(w - tw - 2, x + 5), 11);
    }
  }
}
