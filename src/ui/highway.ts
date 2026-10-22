// Rev Hero piano roll: time flows right to left past a "now" line, pitch is vertical.

import type { RevHero } from '../game/revHero.ts';
import { noteName } from '../music/notes.ts';

const BLACK = new Set([1, 3, 6, 8, 10]);

export class Highway {
  private ctx: CanvasRenderingContext2D;
  private trail: { t: number; m: number }[] = [];
  private colors = { ink: '#fff', dim: '#999', gold: '#d9a54d', blue: '#74a9ff', red: '#ff5b3d', line: '#333', surface: '#000' };

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.readColors();
  }

  readColors() {
    const s = getComputedStyle(document.documentElement);
    const v = (n: string) => s.getPropertyValue(n).trim() || '#888';
    this.colors = {
      ink: v('--ink'),
      dim: v('--ink-2'),
      gold: v('--gold'),
      blue: v('--blue'),
      red: v('--red'),
      line: v('--line'),
      surface: v('--surface'),
    };
  }

  reset() {
    this.trail = [];
  }

  /** Pitch (fractional midi) under a pointer at clientY. */
  midiAt(clientY: number, game: RevHero): number {
    const r = this.canvas.getBoundingClientRect();
    const { lo, hi } = game.span;
    const pad = 14;
    const y = Math.max(pad, Math.min(r.height - pad, clientY - r.top));
    return hi - ((y - pad) / (r.height - 2 * pad)) * (hi - lo);
  }

  draw(game: RevHero, midiNow: number) {
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
    const col = this.colors;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    g.fillStyle = col.surface;
    g.globalAlpha = 0.72;
    g.beginPath();
    g.roundRect(0, 0, w, h, 16);
    g.fill();
    g.globalAlpha = 1;

    const { lo, hi } = game.span;
    const pad = 14;
    const yOf = (m: number) => pad + ((hi - m) / (hi - lo)) * (h - 2 * pad);
    const nowX = Math.max(70, w * 0.24);
    const pxPerSec = Math.max(90, Math.min(190, w / 5.5));
    const xOf = (t: number) => nowX + (t - game.t) * pxPerSec;
    const rowH = (h - 2 * pad) / (hi - lo);

    // Semitone lanes, labelled on natural notes.
    g.font = '10px "Martian Mono", monospace';
    for (let m = Math.ceil(lo); m <= Math.floor(hi); m++) {
      const y = yOf(m);
      const pc = ((m % 12) + 12) % 12;
      if (BLACK.has(pc)) {
        g.fillStyle = col.line;
        g.globalAlpha = 0.35;
        g.fillRect(0, y - rowH / 2, w, rowH);
        g.globalAlpha = 1;
      } else {
        g.fillStyle = col.dim;
        g.fillText(noteName(m), 8, y + 3.5);
      }
    }

    // Notes.
    for (const n of game.chart) {
      const x0 = xOf(n.start);
      const x1 = xOf(n.start + n.dur);
      if (x1 < -10 || x0 > w + 10) continue;
      const r = game.results[n.index];
      const active = game.t >= n.start && game.t < n.start + n.dur;
      const tolRows = (game.tolerance / 100) * 2;
      const y = yOf(n.midi);
      const bh = Math.max(8, rowH * tolRows);
      g.fillStyle = r.judged ? (r.good ? col.blue : col.red) : active ? col.gold : col.ink;
      g.globalAlpha = r.judged ? 0.55 : active ? 0.95 : 0.28;
      g.beginPath();
      g.roundRect(x0 + 1, y - bh / 2, Math.max(4, x1 - x0 - 2), bh, Math.min(6, bh / 2));
      g.fill();
      g.globalAlpha = 1;
      if (active && n.dur > 0) {
        // Fill shows how much of the note has been held in tune.
        g.fillStyle = col.blue;
        g.globalAlpha = 0.9;
        g.fillRect(x0 + 1, y + bh / 2 - 3, Math.min(x1 - x0 - 2, (r.hit / n.dur) * (x1 - x0)), 3);
        g.globalAlpha = 1;
      }
    }

    // Now line.
    g.strokeStyle = col.gold;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(nowX, 6);
    g.lineTo(nowX, h - 6);
    g.stroke();

    // Pitch trail.
    this.trail.push({ t: game.t, m: midiNow });
    while (this.trail.length && this.trail[0].t < game.t - (nowX / pxPerSec)) this.trail.shift();
    g.strokeStyle = col.blue;
    g.lineWidth = 3;
    g.lineJoin = 'round';
    g.beginPath();
    this.trail.forEach((p, i) => {
      const x = xOf(p.t);
      const y = yOf(Math.max(lo, Math.min(hi, p.m)));
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.stroke();
    const yNow = yOf(Math.max(lo, Math.min(hi, midiNow)));
    g.fillStyle = col.blue;
    g.beginPath();
    g.arc(nowX, yNow, 7, 0, Math.PI * 2);
    g.fill();
  }
}
