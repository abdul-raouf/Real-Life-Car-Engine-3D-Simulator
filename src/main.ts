import './ui/styles.css';
import type * as THREE from 'three';
import {
  ENGINES,
  ENGINE_BY_ID,
  displacementLitres,
  firingInterval,
  wankelChamberCc,
  type EngineId,
  type EngineSpec,
  type PistonSpec,
} from './engines/catalog.ts';
import { balanceSummary, hasSplitPins } from './engines/balance.ts';
import { firingHz, pitchDivisor, rpmForHz } from './engines/kinematics.ts';
import { EngineSim, type SimInput } from './sim/engineSim.ts';
import { voiceParamsFromSim } from './sim/bridge.ts';
import { AudioEngine } from './audio/audioEngine.ts';
import { cents, midiAtRpm, midiToHz, noteName, playableRange, rpmForMidi } from './music/notes.ts';
import { SONGS, chartFor, type ChartNote } from './music/songs.ts';
import { RevHero, type Difficulty } from './game/revHero.ts';
import { Stage } from './scene/stage.ts';
import { makeMaterials } from './scene/materials.ts';
import { createRig, type Rig } from './scene/rig/rig.ts';
import { Tach } from './ui/tach.ts';
import { FiringRing } from './ui/ring.ts';
import { Spectrum } from './ui/spectrum.ts';
import { Piano } from './ui/piano.ts';
import { Highway } from './ui/highway.ts';

type Mode = 'free' | 'play' | 'hero';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- Preferences (per viewer, optional) -------------------------------------------
interface Prefs {
  engine: EngineId;
  xray: boolean;
  slowmo: boolean;
  shake: boolean;
  pulses: boolean;
  volume: number;
}
function loadPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem('redline-recital') ?? '{}') as Partial<Prefs>;
  } catch {
    return {};
  }
}
function savePrefs() {
  try {
    const p: Prefs = {
      engine: state.spec.id,
      xray: state.xray,
      slowmo: state.slowmo,
      shake: state.shake,
      pulses: state.pulses,
      volume: state.volume,
    };
    localStorage.setItem('redline-recital', JSON.stringify(p));
  } catch {
    /* storage unavailable: preferences just are not remembered */
  }
}

const prefs = loadPrefs();
const hashId = location.hash.slice(1) as EngineId;
const startId: EngineId = hashId in ENGINE_BY_ID ? hashId : prefs.engine && prefs.engine in ENGINE_BY_ID ? prefs.engine : 'v8';

const state = {
  spec: ENGINE_BY_ID[startId],
  mode: 'free' as Mode,
  started: false,
  xray: prefs.xray ?? true,
  slowmo: prefs.slowmo ?? true,
  shake: prefs.shake ?? !reducedMotion,
  pulses: prefs.pulses ?? true,
  volume: prefs.volume ?? 0.8,
  spaceHeld: false,
  spacePedal: 0,
  pointerPedal: null as number | null,
  held: [] as number[],
  demo: null as { chart: ChartNote[]; t: number; idx: number } | null,
  hero: null as RevHero | null,
  difficulty: 'easy' as Difficulty,
  heroPointer: null as { midi: number; pedal: number } | null,
  heat: 0,
  cycle: 0,
  fade: 1,
  fadeTarget: 1,
  paused: false,
};

// ---- Core objects ----------------------------------------------------------------------
const stage = new Stage($('stage'));
stage.autoRotate = !reducedMotion;
const mats = makeMaterials();
const sim = new EngineSim(state.spec);
const audio = new AudioEngine();
const tach = new Tach($('tach') as unknown as SVGSVGElement);
const ring = new FiringRing($('ring') as unknown as SVGSVGElement);
const spectrum = new Spectrum($<HTMLCanvasElement>('spectrum'));
const highway = new Highway($<HTMLCanvasElement>('highway'));
const piano = new Piano($('piano'), (m) => noteOn(m), (m) => noteOff(m));
let rig: Rig = createRig(state.spec, mats);
stage.scene.add(rig.root);
rig.setXray(state.xray);

// ---- Theme ----------------------------------------------------------------------------
function applyTheme() {
  const s = getComputedStyle(document.documentElement);
  stage.setTheme({
    background: s.getPropertyValue('--bg').trim() || '#0f1115',
    floor: s.getPropertyValue('--floor').trim() || '#15171c',
  });
  spectrum.readColors();
  highway.readColors();
}
applyTheme();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ---- Layout: keep the engine in the space the UI leaves free --------------------------
const card = $('card');
const consoleEl = $('console');
function layout() {
  const W = window.innerWidth;
  const bar = document.querySelector('.topbar')!.getBoundingClientRect();
  const top = bar.bottom + 8;
  // Eight engine chips can wrap onto a second line; keep the card and roll below them.
  document.documentElement.style.setProperty('--top-h', `${Math.round(bar.height + 10)}px`);
  const cons = consoleEl.getBoundingClientRect();
  document.documentElement.style.setProperty('--console-h', `${Math.round(cons.height)}px`);
  const cardRect = card.getBoundingClientRect();
  const sideCard = getComputedStyle(card).position === 'fixed' && cardRect.width > 0 && cardRect.width < W * 0.6;
  const right = sideCard ? cardRect.left - 8 : W;
  const bottom = cons.top - 8;
  stage.setFocus(0, top, right, Math.max(120, bottom - top));
}
new ResizeObserver(() => {
  layout();
  stage.frame(rig.center, rig.radius, true);
}).observe(consoleEl);
window.addEventListener('resize', () => {
  layout();
  stage.frame(rig.center, rig.radius);
});

// ---- Engine card ------------------------------------------------------------------------
const LAYOUT_TEXT: Record<PistonSpec['layout'], (s: PistonSpec) => string> = {
  inline: (s) => `Inline, ${s.cylinders} in a row`,
  v: (s) => `${s.vAngle}° V, two banks${hasSplitPins(s) ? ', split pins' : ''}`,
  flat: () => 'Horizontally opposed',
};

function ringCaption(spec: EngineSpec): string {
  const hand = 'The hand follows the shaft in slow motion.';
  if (spec.kind === 'rotary') {
    return `Each dot is a rotor face firing, around one 1,080° cycle (three shaft turns). <span class="bank-a">Gold</span> is the front rotor, <span class="bank-b">blue</span> the rear. ${hand}`;
  }
  if (spec.layout === 'inline') return `Each dot is a cylinder firing, around one 720° cycle (two crank turns). ${hand}`;
  return `Firing order around one 720° cycle. <span class="bank-a">Gold</span> and <span class="bank-b">blue</span> are the two banks. ${hand}`;
}

function renderCard(spec: EngineSpec) {
  $('card-role').textContent = `${spec.role} · ${spec.short}`;
  $('card-title').textContent = spec.name;
  $('card-example').textContent = spec.example;
  const r = playableRange(spec);
  const concertA = rpmForHz(spec, 440);
  const shapeRows: [string, string][] =
    spec.kind === 'rotary'
      ? [
          ['Layout', `${spec.rotors} rotors, Wankel`],
          ['Displacement', `${displacementLitres(spec).toFixed(1)} L (${spec.rotors} × ${Math.round(wankelChamberCc(spec))} cc)`],
          ['Rotor R × e × width', `${spec.generatingRadius} × ${spec.eccentricity} × ${spec.rotorWidth} mm`],
          ['Firing order', 'front, rear, front…'],
        ]
      : [
          ['Layout', LAYOUT_TEXT[spec.layout](spec)],
          ['Displacement', `${displacementLitres(spec).toFixed(1)} L`],
          ['Bore × stroke', `${spec.bore} × ${spec.stroke} mm`],
          ['Firing order', spec.firingOrder.join('-')],
        ];
  const rows: [string, string][] = [
    ...shapeRows,
    ['Fires every', `${firingInterval(spec)}° of shaft`],
    ['Idle → redline', `${fmt(spec.idleRpm)} → ${fmt(spec.redlineRpm)}`],
    ['Note range', `${noteName(r.low)} – ${noteName(r.high)}`],
    ['Pitch', `RPM ÷ ${fmt(pitchDivisor(spec))}`],
    ['A 440 Hz at', concertA <= spec.redlineRpm && concertA >= spec.idleRpm ? `${fmt(concertA)} rpm` : 'out of range'],
  ];
  $('tagline-formula').textContent = `RPM ÷ ${fmt(pitchDivisor(spec))}`;
  $('ring-caption').innerHTML = ringCaption(spec);
  const dl = $('card-specs');
  dl.replaceChildren();
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  $('card-why').textContent = spec.why;
  $('limit-text').textContent = fmt(spec.limiterRpm);
  if (spec.kind === 'rotary') {
    $('shake-note').textContent =
      'Nothing reciprocates: the rotors only spin and orbit, and counterweights on the eccentric shaft cancel that completely.';
    return;
  }
  const b = balanceSummary(spec);
  const notes: string[] = [];
  if (b.primaryForce > 1e-6) notes.push('a first-order force');
  if (b.secondaryForce > 1e-6) notes.push('a second-order force at twice crank speed');
  if (b.primaryCouple > 1e-6) notes.push('a first-order rocking couple');
  if (b.secondaryCouple > 1e-6) notes.push('a second-order rocking couple');
  $('shake-note').textContent = notes.length
    ? `What the mounts feel: ${notes.join(', ')}. Counterweights already cancel what they can.`
    : 'Perfectly balanced: every force and rocking couple cancels.';
}

const balanceCache = new Map<EngineId, ReturnType<typeof balanceSummary>>();
function updateShakeMeter() {
  const spec = state.spec;
  if (spec.kind === 'rotary') {
    $('shake-value').textContent = '0.0 kN';
    $('shake-bar').style.width = '0%';
    return;
  }
  let b = balanceCache.get(spec.id);
  if (!b) {
    b = balanceSummary(spec);
    balanceCache.set(spec.id, b);
  }
  const w = (sim.rpm * 2 * Math.PI) / 60;
  const unit = spec.recipMass * (spec.stroke / 2000) * w * w;
  const force = (b.primaryForce + b.secondaryForce) * unit;
  const couple = (b.primaryCouple + b.secondaryCouple) * unit * spec.bore * 1.25e-3;
  const text = couple > 1 ? `${(force / 1000).toFixed(1)} kN · ${fmt(couple)} N·m` : `${(force / 1000).toFixed(1)} kN`;
  $('shake-value').textContent = text;
  const level = Math.max(force / 16000, couple / 900);
  $('shake-bar').style.width = `${clamp(level * 100, 0, 100)}%`;
}

// ---- Engine chips ---------------------------------------------------------------------
const enginesNav = $('engines');
for (const [k, e] of ENGINES.entries()) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.dataset.id = e.id;
  b.title = `${e.name} (key ${k + 1})`;
  b.innerHTML = `<span class="id">${e.short}</span><span class="role">${e.role}</span>`;
  b.addEventListener('click', () => selectEngine(e.id));
  enginesNav.append(b);
}
function markChips() {
  for (const b of enginesNav.querySelectorAll<HTMLButtonElement>('.chip')) {
    b.setAttribute('aria-pressed', String(b.dataset.id === state.spec.id));
  }
}

function applyEngine(spec: EngineSpec, immediate: boolean) {
  state.spec = spec;
  let turnTo: THREE.Vector3 | undefined;
  if (rig.spec !== spec) {
    const before = rig.viewDir;
    rig.dispose();
    rig = createRig(spec, mats);
    stage.scene.add(rig.root);
    // Only swing the camera when the new engine is best seen from a different side.
    if (!before.equals(rig.viewDir)) turnTo = rig.viewDir;
  }
  rig.setXray(state.xray);
  sim.setEngine(spec);
  audio.setEngine(spec);
  tach.setEngine(spec);
  ring.setEngine(spec);
  piano.setEngine(spec);
  renderCard(spec);
  markChips();
  layout();
  stage.frame(rig.center, rig.radius, immediate || reducedMotion, immediate ? rig.viewDir : turnTo);
  savePrefs();
}

let switchTimer = 0;
function selectEngine(id: EngineId) {
  if (id === state.spec.id) return;
  stopDemo();
  stopHero();
  releaseAll();
  state.fadeTarget = 0;
  window.clearTimeout(switchTimer);
  switchTimer = window.setTimeout(() => {
    applyEngine(ENGINE_BY_ID[id], false);
    state.fadeTarget = 1;
  }, state.started ? 140 : 0);
}

// ---- Modes ---------------------------------------------------------------------------------
const tabs = [...document.querySelectorAll<HTMLButtonElement>('.modes [role=tab]')];
for (const t of tabs) t.addEventListener('click', () => setMode(t.dataset.mode as Mode));
function setMode(mode: Mode) {
  if (mode === state.mode) return;
  stopDemo();
  stopHero();
  releaseAll();
  state.mode = mode;
  for (const t of tabs) t.setAttribute('aria-selected', String(t.dataset.mode === mode));
  $('panel-free').hidden = mode !== 'free';
  $('panel-play').hidden = mode !== 'play';
  $('panel-hero').hidden = mode !== 'hero';
  requestAnimationFrame(layout);
}

// ---- Toggles ------------------------------------------------------------------------------
function toggle(id: string, get: () => boolean, set: (v: boolean) => void, msg?: (v: boolean) => string) {
  const b = $<HTMLButtonElement>(id);
  b.setAttribute('aria-pressed', String(get()));
  b.addEventListener('click', () => {
    set(!get());
    b.setAttribute('aria-pressed', String(get()));
    if (msg) toast(msg(get()));
    savePrefs();
  });
}
toggle('t-xray', () => state.xray, (v) => {
  state.xray = v;
  rig.setXray(v);
});
toggle(
  't-slow',
  () => state.slowmo,
  (v) => (state.slowmo = v),
  (v) =>
    v
      ? `Slow-motion camera: 1/${Math.round(state.spec.redlineRpm / 240)} of real speed. The sound is always real time.`
      : 'Real-time camera. At real speed the crank turns faster than the screen refreshes, so it strobes.',
);
toggle('t-shake', () => state.shake, (v) => (state.shake = v), (v) => (v ? 'Mount shake on, exaggerated so you can see it.' : 'Mount shake off.'));
toggle('t-pulses', () => state.pulses, (v) => (state.pulses = v));
const infoBtn = $<HTMLButtonElement>('t-info');
infoBtn.addEventListener('click', () => {
  const open = !card.classList.contains('open');
  card.classList.toggle('open', open);
  infoBtn.setAttribute('aria-pressed', String(open));
});
$('card-close').addEventListener('click', () => {
  card.classList.remove('open');
  infoBtn.setAttribute('aria-pressed', 'false');
});
const volume = $<HTMLInputElement>('volume');
volume.value = String(state.volume);
volume.addEventListener('input', () => {
  state.volume = Number(volume.value);
  audio.setVolume(state.volume);
  savePrefs();
});

// ---- Toast --------------------------------------------------------------------------------
let toastTimer = 0;
function toast(msg: string, ms = 3200) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), ms);
}

// ---- Pedal (free rev) -----------------------------------------------------------------
const pedal = $('pedal');
const pedalFromEvent = (e: PointerEvent) => {
  const r = pedal.getBoundingClientRect();
  return clamp(1 - (e.clientY - r.top) / r.height, 0.15, 1) ** 0.8;
};
pedal.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  pedal.setPointerCapture(e.pointerId);
  state.pointerPedal = pedalFromEvent(e);
});
pedal.addEventListener('pointermove', (e) => {
  if (state.pointerPedal !== null) state.pointerPedal = pedalFromEvent(e);
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  pedal.addEventListener(ev, () => (state.pointerPedal = null));
}

// ---- Play mode ----------------------------------------------------------------------------
function noteOn(m: number) {
  if (!state.started) return;
  stopDemo();
  if (state.held.length === 0) sim.articulate();
  state.held = state.held.filter((x) => x !== m);
  state.held.push(m);
  piano.show(state.held);
}
function noteOff(m: number) {
  state.held = state.held.filter((x) => x !== m);
  piano.show(state.held);
}
function releaseAll() {
  state.held = [];
  piano.show([]);
  state.spaceHeld = false;
  state.pointerPedal = null;
}

for (const id of ['demo-song', 'hero-song']) {
  const sel = $<HTMLSelectElement>(id);
  for (const s of SONGS) {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = s.title;
    sel.append(o);
  }
}
const demoBtn = $<HTMLButtonElement>('demo-play');
demoBtn.addEventListener('click', () => {
  if (state.demo) {
    stopDemo();
    return;
  }
  if (!state.started) return;
  const song = SONGS.find((s) => s.id === $<HTMLSelectElement>('demo-song').value)!;
  state.demo = { chart: chartFor(song, state.spec), t: -0.5, idx: -1 };
  demoBtn.textContent = 'Stop';
  toast(`${song.title}. ${song.credit}`);
});
function stopDemo() {
  if (!state.demo) return;
  state.demo = null;
  demoBtn.textContent = 'Let the ECU play it';
  piano.show(state.held);
}

// ---- Rev Hero --------------------------------------------------------------------------------
const diffEasy = $<HTMLButtonElement>('diff-easy');
const diffHard = $<HTMLButtonElement>('diff-hard');
function setDifficulty(d: Difficulty) {
  state.difficulty = d;
  diffEasy.setAttribute('aria-checked', String(d === 'easy'));
  diffHard.setAttribute('aria-checked', String(d === 'hard'));
}
diffEasy.addEventListener('click', () => setDifficulty('easy'));
diffHard.addEventListener('click', () => setDifficulty('hard'));

const heroBtn = $<HTMLButtonElement>('hero-start');
const highwayEl = $<HTMLCanvasElement>('highway');
const highwayWrap = $('highway-wrap');
const countdown = $('countdown');
heroBtn.addEventListener('click', () => {
  if (state.hero && !state.hero.finished) {
    stopHero();
    return;
  }
  if (!state.started) return;
  const song = SONGS.find((s) => s.id === $<HTMLSelectElement>('hero-song').value)!;
  state.hero = new RevHero(chartFor(song, state.spec), state.difficulty);
  state.heroPointer = null;
  highway.reset();
  highwayWrap.hidden = false;
  heroBtn.textContent = 'Stop';
  toast(
    state.difficulty === 'easy'
      ? 'Drag up and down on the piano roll. The ECU chases your pitch.'
      : 'Feather Space (or press on the roll, higher = more throttle) to hold each note.',
  );
});
function stopHero() {
  if (!state.hero) return;
  state.hero = null;
  state.heroPointer = null;
  highwayWrap.hidden = true;
  countdown.hidden = true;
  heroBtn.textContent = 'Start';
}
function finishHero(game: RevHero) {
  const pct = Math.round(game.accuracy * 100);
  toast(`Grade ${game.grade}. In tune ${pct}% of the time, best streak ${game.bestStreak}, score ${fmt(game.score)}.`, 6000);
  heroBtn.textContent = 'Play again';
  window.setTimeout(() => {
    if (state.hero === game) {
      state.hero = null;
      highwayWrap.hidden = true;
    }
  }, 1800);
}
const heroPointer = (e: PointerEvent) => {
  const game = state.hero;
  if (!game) return;
  const r = highwayEl.getBoundingClientRect();
  state.heroPointer = {
    midi: highway.midiAt(e.clientY, game),
    pedal: clamp(1 - (e.clientY - r.top) / r.height, 0, 1),
  };
};
highwayEl.addEventListener('pointerdown', (e) => {
  highwayEl.setPointerCapture(e.pointerId);
  heroPointer(e);
});
highwayEl.addEventListener('pointermove', (e) => {
  if (state.difficulty === 'easy' || highwayEl.hasPointerCapture(e.pointerId)) heroPointer(e);
});
highwayEl.addEventListener('pointerup', () => {
  if (state.difficulty === 'hard') state.heroPointer = null;
});

// ---- Keyboard ------------------------------------------------------------------------------
const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.code === 'Space') {
    if (typing(e) || (e.target instanceof HTMLButtonElement && state.mode !== 'free' && state.mode !== 'hero')) return;
    e.preventDefault();
    state.spaceHeld = true;
    return;
  }
  if (typing(e)) return;
  if (/^Digit[1-8]$/.test(e.code)) {
    selectEngine(ENGINES[Number(e.code.slice(5)) - 1].id);
    return;
  }
  if (state.mode === 'play' && !e.repeat) {
    if (e.key === 'z' || e.key === 'Z') piano.shiftOctave(-1);
    else if (e.key === 'x' || e.key === 'X') piano.shiftOctave(1);
    else {
      const m = piano.midiForKey(e.key);
      if (m !== null) noteOn(m);
    }
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') state.spaceHeld = false;
  if (state.mode === 'play') {
    const m = piano.midiForKey(e.key);
    if (m !== null) noteOff(m);
  }
});
window.addEventListener('blur', releaseAll);

// ---- Start ----------------------------------------------------------------------------------
const gate = $('gate');
$('start').addEventListener('click', async () => {
  gate.hidden = true;
  try {
    await audio.start(state.spec);
    audio.setVolume(state.volume);
  } catch (err) {
    console.warn('Audio could not start', err);
    toast('Sound could not start in this browser. Everything else still works.');
  }
  state.started = true;
  sim.start();
  window.setTimeout(() => toast('Hold Space or the pedal to rev. Keys 1 to 8 swap engines.'), 1600);
});

document.addEventListener('visibilitychange', () => {
  state.paused = document.hidden;
  if (!state.started) return;
  if (document.hidden) audio.suspend();
  else audio.resume();
});

// ---- Frame loop ------------------------------------------------------------------------------
let last = performance.now();
let uiClock = 0;
let slowClock = 0;
const rpmEl = $('rpm');
const noteEl = $('note');
const hzEl = $('hz');
const pedalFill = $('pedal-fill');
const statScore = $('hero-score');
const statStreak = $('hero-streak');
const statAcc = $('hero-acc');

function inputFor(dt: number): { input: SimInput; target: number | null } {
  state.spacePedal += ((state.spaceHeld ? 1 : 0) - state.spacePedal) * Math.min(1, dt / 0.06);
  const spec = state.spec;
  if (state.mode === 'free') {
    return { input: { pedal: Math.max(state.spacePedal, state.pointerPedal ?? 0), targetRpm: null }, target: null };
  }
  if (state.mode === 'play') {
    if (state.held.length) {
      const m = state.held[state.held.length - 1];
      return { input: { pedal: 0, targetRpm: rpmForMidi(spec, m) }, target: m };
    }
    const d = state.demo;
    if (d) {
      d.t += dt;
      const idx = d.chart.findIndex((n) => d.t >= n.start && d.t < n.start + n.dur);
      if (idx !== d.idx && idx >= 0) {
        d.idx = idx;
        sim.articulate();
        piano.show([d.chart[idx].midi]);
        piano.reveal(d.chart[idx].midi);
      }
      const lastNote = d.chart[d.chart.length - 1];
      if (d.t > lastNote.start + lastNote.dur + 0.4) {
        stopDemo();
      } else if (idx >= 0) {
        const m = d.chart[idx].midi;
        return { input: { pedal: 0, targetRpm: rpmForMidi(spec, m) }, target: m };
      }
    }
    return { input: { pedal: 0, targetRpm: null }, target: null };
  }
  const game = state.hero;
  if (game) {
    const note = game.current() ?? (game.t < 0 ? game.next() : null);
    if (game.difficulty === 'easy') {
      const p = state.heroPointer;
      return { input: { pedal: 0, targetRpm: p ? rpmForMidi(spec, p.midi) : null }, target: note?.midi ?? null };
    }
    const pointer = state.heroPointer?.pedal ?? 0;
    return { input: { pedal: Math.max(state.spacePedal, pointer), targetRpm: null }, target: note?.midi ?? null };
  }
  return { input: { pedal: Math.max(state.spacePedal, 0), targetRpm: null }, target: null };
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const elapsed = Math.max(0, (now - last) / 1000);
  last = now;
  if (state.paused) return;
  // The engine runs on wall-clock time even if rendering drops frames; visuals cap the step.
  const simDt = Math.min(elapsed, 0.25);
  const dt = Math.min(elapsed, 0.05);
  const spec = state.spec;

  const { input, target } = inputFor(simDt);
  if (state.started) sim.step(simDt, input);

  state.fade += (state.fadeTarget - state.fade) * Math.min(1, dt / 0.05);
  if (state.started) audio.setParams(voiceParamsFromSim(sim, state.fade));

  const running = sim.state === 'running';
  const heatTarget = running ? Math.pow(Math.min(1, (sim.load * sim.rpm) / spec.redlineRpm), 0.7) : 0;
  state.heat += (heatTarget - state.heat) * Math.min(1, dt / (heatTarget > state.heat ? 3 : 7));

  const slow = state.slowmo ? spec.redlineRpm / 240 : 1;
  state.cycle = (state.cycle + (sim.rpm * 6 * dt) / slow) % spec.cycleDeg;
  rig.update({
    cycle: state.cycle,
    rpm: sim.rpm,
    load: sim.load,
    throttle: sim.throttle,
    cut: sim.cut,
    dt,
    heat: state.heat,
    pulses: state.pulses,
    shake: state.shake && running ? 1 : 0,
  });
  stage.render(dt);

  // Rev Hero bookkeeping.
  const midiNow = sim.rpm > 60 ? midiAtRpm(spec, sim.rpm) : -Infinity;
  const game = state.hero;
  if (game) {
    const wasFinished = game.finished;
    game.update(simDt, midiNow);
    countdown.hidden = game.t >= 0;
    if (game.t < 0) countdown.textContent = String(Math.ceil(-game.t));
    if (!wasFinished && game.finished) finishHero(game);
    highway.draw(game, Number.isFinite(midiNow) ? midiNow : game.span.lo);
  }

  // Readouts.
  uiClock += dt;
  slowClock += dt;
  ring.update(state.cycle, sim.cut);
  const tolerance = game ? game.tolerance : 15;
  const band =
    target !== null
      ? { lo: rpmForMidi(spec, target - tolerance / 100), hi: rpmForMidi(spec, target + tolerance / 100) }
      : null;
  tach.update(sim.rpm, sim.limiterCut, band);
  pedalFill.style.height = `${Math.round(Math.max(state.spacePedal, state.pointerPedal ?? 0) * 100)}%`;
  if (uiClock > 1 / 30) {
    uiClock = 0;
    rpmEl.textContent = fmt(Math.round(sim.rpm / 10) * 10);
    if (sim.rpm > 60) {
      const hz = firingHz(spec, sim.rpm);
      const m = midiAtRpm(spec, sim.rpm);
      const near = Math.round(m);
      const c = Math.round(cents(hz, midiToHz(near)));
      noteEl.textContent = `${noteName(near)} ${c >= 0 ? '+' : '−'}${Math.abs(c)}¢`;
      noteEl.classList.toggle('tuned', target !== null && Math.abs(m - target) * 100 <= tolerance);
      hzEl.textContent = `${hz.toFixed(1)} Hz firing`;
    } else {
      noteEl.textContent = '—';
      noteEl.classList.remove('tuned');
      hzEl.textContent = state.started ? 'cranking' : 'engine off';
    }
    spectrum.draw(audio.analyser, spec, sim.rpm);
    if (game) {
      statScore.textContent = fmt(game.score);
      statStreak.textContent = `${game.streak}×${game.multiplier}`;
      statAcc.textContent = game.t > 0 ? `${Math.round(game.accuracy * 100)}%` : '—';
    }
  }
  if (slowClock > 0.1) {
    slowClock = 0;
    updateShakeMeter();
  }
}

// ---- Boot ------------------------------------------------------------------------------------
setDifficulty('easy');
applyEngine(state.spec, true);
layout();
stage.frame(rig.center, rig.radius, true);
requestAnimationFrame(frame);

// Hooks for automated checks.
(window as unknown as { __redline: unknown }).__redline = {
  state,
  stage,
  sim,
  audio,
  selectEngine,
  setMode,
  noteOn,
  noteOff,
};
