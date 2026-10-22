// Firing ring: one 720° four-stroke cycle drawn as a circle. Each dot is a cylinder's
// firing moment, coloured by bank, so uneven per-bank spacing (the V8 burble) is visible.

import type { EngineSpec } from '../engines/catalog.ts';
import { firingAngles, mod } from '../engines/kinematics.ts';

const NS = 'http://www.w3.org/2000/svg';
const C = 110;
const R = 74;

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>) {
  const e = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

const at = (deg720: number, r: number) => {
  const a = ((deg720 / 720) * 360 - 90) * (Math.PI / 180);
  return [C + r * Math.cos(a), C + r * Math.sin(a)] as const;
};

export class FiringRing {
  private dots: SVGCircleElement[] = [];
  private fire: number[] = [];
  private hand: SVGLineElement;
  private layer: SVGGElement;

  constructor(svg: SVGSVGElement) {
    this.layer = el('g', {});
    this.hand = el('line', { x1: C, y1: C, x2: C, y2: C - R + 12, 'stroke-width': 2, 'stroke-linecap': 'round' });
    this.hand.style.stroke = 'var(--ink)';
    svg.append(this.layer, this.hand, el('circle', { cx: C, cy: C, r: 3.5, style: 'fill: var(--ink)' }));
  }

  setEngine(spec: EngineSpec) {
    this.fire = firingAngles(spec);
    const g = this.layer;
    g.replaceChildren();
    const track = el('circle', { cx: C, cy: C, r: R, fill: 'none', 'stroke-width': 1.5 });
    track.style.stroke = 'var(--line)';
    g.append(track);
    // Quarter marks: each is one stroke (180°) of a single cylinder's cycle.
    for (const d of [0, 180, 360, 540]) {
      const [x0, y0] = at(d, R - 6);
      const [x1, y1] = at(d, R + 6);
      const t = el('line', { x1: x0, y1: y0, x2: x1, y2: y1, 'stroke-width': 1 });
      t.style.stroke = 'var(--ink-2)';
      g.append(t);
      const [lx, ly] = at(d, R - 25);
      const lab = el('text', { x: lx, y: ly + 3, 'text-anchor': 'middle', 'font-size': 8 });
      lab.style.fill = 'var(--ink-2)';
      lab.style.fontFamily = 'var(--font-data)';
      lab.textContent = `${d}°`;
      g.append(lab);
    }
    const centre = el('text', { x: C, y: C + 22, 'text-anchor': 'middle', 'font-size': 9 });
    centre.style.fill = 'var(--ink-2)';
    centre.style.fontFamily = 'var(--font-data)';
    centre.textContent = spec.firingOrder.join('-');
    g.append(centre);

    this.dots = this.fire.map((f, i) => {
      const [x, y] = at(f, R);
      const color = spec.bankOf[i] === 0 ? 'var(--gold)' : 'var(--blue)';
      const dot = el('circle', { cx: x, cy: y, r: 6.5 });
      dot.style.fill = color;
      dot.style.transition = 'r 0.08s';
      g.append(dot);
      const [lx, ly] = at(f, R + 19);
      const t = el('text', { x: lx, y: ly + 4, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 600 });
      t.style.fill = color;
      t.style.fontFamily = 'var(--font-data)';
      t.textContent = String(i + 1);
      g.append(t);
      return dot;
    });
  }

  update(cycle: number, cut: boolean) {
    const c = mod(cycle, 720);
    const [x, y] = at(c, R - 12);
    this.hand.setAttribute('x2', x.toFixed(2));
    this.hand.setAttribute('y2', y.toFixed(2));
    this.dots.forEach((d, i) => {
      const since = mod(c - this.fire[i], 720);
      const hot = !cut && since < 45;
      d.setAttribute('r', hot ? (10 - since / 9).toFixed(2) : '6.5');
    });
  }
}
