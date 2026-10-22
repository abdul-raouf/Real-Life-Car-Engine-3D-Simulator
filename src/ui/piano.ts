// On-screen keyboard covering exactly the notes the engine can hold, with a
// computer-keyboard mapping (A W S E D F T G Y H U J K O L P ;) that can shift by octave.

import type { EngineSpec } from '../engines/catalog.ts';
import { noteName, playableRange } from '../music/notes.ts';

const LETTERS = ['a', 'w', 's', 'e', 'd', 'f', 't', 'g', 'y', 'h', 'u', 'j', 'k', 'o', 'l', 'p', ';'];
const BLACK = new Set([1, 3, 6, 8, 10]);

export class Piano {
  private keys = new Map<number, HTMLElement>();
  private low = 48;
  private high = 72;
  private base = 48;
  private pointerNote: number | null = null;

  constructor(
    private root: HTMLElement,
    private onDown: (midi: number) => void,
    private onUp: (midi: number) => void,
  ) {
    root.addEventListener('pointerdown', (e) => {
      const m = this.noteAt(e.clientX, e.clientY);
      if (m === null) return;
      e.preventDefault();
      root.setPointerCapture(e.pointerId);
      this.pointerNote = m;
      this.onDown(m);
    });
    root.addEventListener('pointermove', (e) => {
      if (this.pointerNote === null) return;
      const m = this.noteAt(e.clientX, e.clientY);
      if (m !== null && m !== this.pointerNote) {
        const old = this.pointerNote;
        this.pointerNote = m;
        this.onDown(m);
        this.onUp(old);
      }
    });
    const end = () => {
      if (this.pointerNote === null) return;
      const m = this.pointerNote;
      this.pointerNote = null;
      this.onUp(m);
    };
    root.addEventListener('pointerup', end);
    root.addEventListener('pointercancel', end);
  }

  private noteAt(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.key');
    if (!el || !this.root.contains(el)) return null;
    return Number(el.dataset.midi);
  }

  setEngine(spec: EngineSpec) {
    const r = playableRange(spec);
    this.low = r.low;
    this.high = r.high;
    // Start the letter mapping on the C closest to 40% up the range.
    const target = this.low + 0.4 * (this.high - this.low);
    this.base = Math.round((target - 0) / 12) * 12;
    this.clampBase();
    this.render();
  }

  private clampBase() {
    while (this.base + 4 > this.high) this.base -= 12;
    while (this.base < this.low - 11) this.base += 12;
  }

  shiftOctave(dir: number) {
    const next = this.base + 12 * dir;
    if (next + 4 > this.high || next + 16 < this.low) return;
    this.base = next;
    this.render();
  }

  midiForKey(key: string): number | null {
    const i = LETTERS.indexOf(key.toLowerCase());
    if (i < 0) return null;
    const m = this.base + i;
    return m >= this.low && m <= this.high ? m : null;
  }

  private render() {
    const root = this.root;
    root.replaceChildren();
    this.keys.clear();
    const whiteW = 30;
    let whiteIndex = 0;
    for (let m = this.low; m <= this.high; m++) {
      const pc = ((m % 12) + 12) % 12;
      const key = document.createElement('div');
      key.className = `key ${BLACK.has(pc) ? 'black' : 'white'}`;
      key.dataset.midi = String(m);
      key.setAttribute('role', 'button');
      key.setAttribute('aria-label', noteName(m));
      const li = m - this.base;
      if (li >= 0 && li < LETTERS.length) {
        const l = document.createElement('span');
        l.className = 'letter';
        l.textContent = LETTERS[li].toUpperCase();
        key.append(l);
      }
      if (pc === 0) {
        const n = document.createElement('span');
        n.className = 'name';
        n.textContent = noteName(m);
        key.append(n);
      }
      if (BLACK.has(pc)) {
        key.style.left = `${whiteIndex * (whiteW - 1) - 10}px`;
      } else {
        whiteIndex++;
      }
      root.append(key);
      this.keys.set(m, key);
    }
    root.style.width = `${whiteIndex * (whiteW - 1) + 1}px`;
  }

  /** Highlight the held notes. */
  show(down: Iterable<number>) {
    const set = new Set(down);
    for (const [m, el] of this.keys) el.classList.toggle('down', set.has(m));
  }

  /** Scroll the keyboard so this note is in view (for the ECU demo on narrow screens). */
  reveal(midi: number) {
    const el = this.keys.get(midi);
    const wrap = this.root.parentElement;
    if (!el || !wrap) return;
    const left = el.offsetLeft;
    if (left < wrap.scrollLeft + 20 || left > wrap.scrollLeft + wrap.clientWidth - 40) {
      wrap.scrollTo({ left: left - wrap.clientWidth / 2, behavior: 'smooth' });
    }
  }
}
