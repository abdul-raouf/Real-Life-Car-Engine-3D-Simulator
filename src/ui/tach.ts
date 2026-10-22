// SVG tachometer: 270° sweep, redline zone, a blue band for the target note.

import type { EngineSpec } from '../engines/catalog.ts';

const NS = 'http://www.w3.org/2000/svg';
const CX = 120;
const CY = 112;
const R = 92;
const START = 225;
const SWEEP = 270;

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

const polar = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)] as const;
};

function arcPath(a0: number, a1: number, r: number) {
  const [x0, y0] = polar(a0, r);
  const [x1, y1] = polar(a1, r);
  const large = Math.abs(a0 - a1) > 180 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export class Tach {
  private max = 8000;
  private needle: SVGLineElement;
  private band: SVGPathElement;
  private cutText: SVGTextElement;
  private dynamic: SVGGElement;

  constructor(svg: SVGSVGElement) {
    this.dynamic = el('g', {});
    this.band = el('path', { class: 'band', fill: 'none', 'stroke-width': 9, 'stroke-linecap': 'butt', opacity: 0 });
    this.needle = el('line', { class: 'needle', x1: CX, y1: CY, x2: CX, y2: CY - R + 14, 'stroke-width': 3, 'stroke-linecap': 'round' });
    this.cutText = el('text', { class: 'cut', x: CX, y: CY - 30, 'text-anchor': 'middle', opacity: 0 });
    this.cutText.textContent = 'FUEL CUT';
    svg.append(this.dynamic, this.band, this.cutText, this.needle, el('circle', { class: 'hub', cx: CX, cy: CY, r: 5 }));
  }

  private angle(rpm: number) {
    return START - (SWEEP * Math.max(0, Math.min(rpm, this.max))) / this.max;
  }

  setEngine(spec: EngineSpec) {
    const step = spec.limiterRpm > 12000 ? 2000 : 1000;
    this.max = Math.ceil((spec.limiterRpm * 1.04) / step) * step;
    const g = this.dynamic;
    g.replaceChildren();
    g.append(el('path', { class: 'track', d: arcPath(START, START - SWEEP, R), fill: 'none', 'stroke-width': 2 }));
    g.append(el('path', { class: 'red', d: arcPath(this.angle(spec.redlineRpm), START - SWEEP, R - 3), fill: 'none', 'stroke-width': 6 }));
    for (let v = 0; v <= this.max + 1; v += step / 2) {
      const major = v % step === 0;
      const a = this.angle(v);
      const [x0, y0] = polar(a, R);
      const [x1, y1] = polar(a, R - (major ? 12 : 6));
      g.append(el('line', { class: major ? 'tick major' : 'tick', x1: x0, y1: y0, x2: x1, y2: y1, 'stroke-width': major ? 2 : 1 }));
      if (major) {
        const [tx, ty] = polar(a, R - 27);
        const t = el('text', { class: 'num', x: tx, y: ty + 5, 'text-anchor': 'middle' });
        t.textContent = String(v / 1000);
        g.append(t);
      }
    }
    const label = el('text', { class: 'num unit', x: CX, y: CY + 72, 'text-anchor': 'middle' });
    label.textContent = '×1000 rpm';
    g.append(label);
  }

  update(rpm: number, cut: boolean, band: { lo: number; hi: number } | null) {
    const a = this.angle(rpm);
    const [x, y] = polar(a, R - 14);
    this.needle.setAttribute('x2', x.toFixed(2));
    this.needle.setAttribute('y2', y.toFixed(2));
    this.cutText.setAttribute('opacity', cut ? '1' : '0');
    if (band) {
      this.band.setAttribute('d', arcPath(this.angle(band.lo), this.angle(band.hi), R - 4));
      this.band.setAttribute('opacity', '0.9');
    } else {
      this.band.setAttribute('opacity', '0');
    }
  }
}
