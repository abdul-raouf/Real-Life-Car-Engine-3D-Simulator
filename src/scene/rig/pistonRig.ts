// A complete, moving piston engine built from its catalog spec: crank with
// counterweights, rods, pistons, DOHC valvetrain, glass block and heads, intake,
// headers and flywheel, plus sparks, combustion glow, exhaust pulses and header heat.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { axisOf, type PistonSpec } from '../../engines/catalog.ts';
import { crankPositions, balanceCoefficients, shakeAt, type BalanceCoefficients } from '../../engines/balance.ts';
import {
  DEG,
  VALVE_EVENTS,
  exhaustLift,
  firingAngles,
  intakeLift,
  localCycle,
  mod,
  pinAngles,
  pistonDistance,
  tdcAngles,
} from '../../engines/kinematics.ts';
import type { Materials } from '../materials.ts';
import { RigBase, crossed, type RigFrame } from './common.ts';
import {
  extrudeAcross,
  flywheelGeometry,
  lobeGeometry,
  pistonGeometry,
  pulleyGeometry,
  rodGeometry,
  sparkPlugParts,
  valveGeometry,
  webGeometry,
  xCylinder,
} from './parts.ts';

interface Cylinder {
  x: number;
  alpha: number;
  fire: number;
  tdc: number;
  pin: number;
  piston: THREE.Object3D;
  rod: THREE.Object3D;
  exhaustValves: THREE.Object3D[];
  intakeValves: THREE.Object3D[];
  spark: THREE.Sprite;
  burn: THREE.Mesh;
  burnMat: THREE.MeshBasicMaterial;
  header: THREE.CatmullRomCurve3;
}

const ux = (a: number) => Math.cos(a * DEG);
const uz = (a: number) => Math.sin(a * DEG);

/** World position (in engine space) of a point `a` up the bore and `s` across it. */
function bankPoint(x: number, a: number, s: number, alpha: number, out = new THREE.Vector3()) {
  return out.set(x, a * ux(alpha) - s * uz(alpha), a * uz(alpha) + s * ux(alpha));
}

/** Slot-shaped "flying web" joining two split crank pins at ±half/2 either side of +Y. */
function flyingWebGeometry(throwR: number, pinR: number, halfSplitDeg: number, thickness: number) {
  const h = halfSplitDeg * DEG;
  const boss = pinR * 1.35;
  const ax = throwR * Math.sin(h);
  const ay = throwR * Math.cos(h);
  const s = new THREE.Shape();
  // Stadium around the segment joining the two pin centres.
  s.absarc(ax, ay, boss, -Math.PI / 2, Math.PI / 2, false);
  s.absarc(-ax, ay, boss, Math.PI / 2, (3 * Math.PI) / 2, false);
  s.closePath();
  return extrudeAcross(s, thickness, thickness * 0.1);
}

export class PistonRig extends RigBase {
  declare readonly spec: PistonSpec;
  private readonly crank = new THREE.Group();
  private readonly cams: THREE.Group[] = [];
  private readonly cyl: Cylinder[] = [];
  private readonly throttlePlate = new THREE.Group();
  private readonly balance: BalanceCoefficients;
  private lastCycle = 0;
  private panBottom = 0;
  private readonly dims: { B: number; r: number; L: number; ch: number; D: number; maxLift: number };

  constructor(spec: PistonSpec, mats: Materials) {
    super(spec, mats);
    this.balance = balanceCoefficients(spec);
    const B = spec.bore / 1000;
    const S = spec.stroke / 1000;
    const r = S / 2;
    const L = spec.rodLength / 1000;
    const ch = 0.3 * B;
    const D = r + L + ch + 0.003;
    const maxLift = 0.11 * B;
    this.dims = { B, r, L, ch, D, maxLift };
    this.engine.add(this.crank);
    this.build();
    this.finish(this.panBottom);
  }

  private build() {
    const spec = this.spec;
    const { B, r, L, ch, D, maxLift } = this.dims;
    const m = this.mats;
    const pitch = B * 1.24;
    const xs = crankPositions(spec).map((p) => p * pitch);
    const fire = firingAngles(spec);
    const tdc = tdcAngles(spec);
    const pins = pinAngles(spec);
    const pinR = 0.235 * B;
    const mainR = 0.27 * B;
    const gudgeonR = 0.11 * B;
    const rodW = spec.layout === 'v' ? 0.25 * pitch : spec.layout === 'flat' ? 0.24 * pitch : 0.3 * pitch;
    const webT = 0.1 * B;
    const skirtClear = L - r - 0.3 * B - 0.004;
    const cwR = Math.max(r + pinR * 0.6, Math.min(r + pinR * 1.3, skirtClear));
    const xMin = Math.min(...xs) - rodW / 2 - webT - 0.02;
    const xMax = Math.max(...xs) + rodW / 2 + webT + 0.02;

    // ---- Crankshaft -------------------------------------------------------------
    const sorted = xs.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
    const throws: { x0: number; x1: number; pin: number }[] = [];
    for (const { x, i } of sorted) {
      const last = throws[throws.length - 1];
      const same = last && Math.abs(mod(last.pin - pins[i] + 180, 360) - 180) < 1e-6 && x - rodW / 2 - last.x1 < 0.06 * pitch;
      if (same) last.x1 = x + rodW / 2;
      else throws.push({ x0: x - rodW / 2, x1: x + rodW / 2, pin: pins[i] });
    }
    const pinGeoCache = new Map<number, THREE.BufferGeometry>();
    const webGeo = this.geo(webGeometry(r, pinR, cwR, webT));
    // Split pins sit too close for two webs: they share one thin "flying web" instead.
    const tight = (a: { x1: number }, b: { x0: number }) => b.x0 - a.x1 < 2 * webT + 1e-4;
    let prevEnd = xMin + 0.02;
    throws.forEach((t, k) => {
      const prev = throws[k - 1];
      const next = throws[k + 1];
      const sharedFront = !!prev && tight(prev, t);
      const sharedBack = !!next && tight(t, next);
      const len = t.x1 - t.x0;
      let pg = pinGeoCache.get(len);
      if (!pg) {
        pg = this.geo(xCylinder(pinR, len, 28));
        pinGeoCache.set(len, pg);
      }
      const holder = new THREE.Group();
      holder.rotation.x = t.pin * DEG;
      const pin = new THREE.Mesh(pg, m.steel);
      pin.position.set((t.x0 + t.x1) / 2, r, 0);
      pin.castShadow = true;
      holder.add(pin);
      const webs: number[] = [];
      if (!sharedFront) webs.push(t.x0 - webT / 2);
      if (!sharedBack) webs.push(t.x1 + webT / 2);
      for (const wx of webs) {
        const web = new THREE.Mesh(webGeo, m.forged);
        web.position.x = wx;
        web.castShadow = true;
        holder.add(web);
      }
      this.crank.add(holder);
      if (sharedBack) {
        const gap = Math.max(0.003, next.x0 - t.x1);
        let d = mod(next.pin - t.pin + 180, 360) - 180;
        const bisector = t.pin + d / 2;
        d = Math.abs(d);
        const fly = this.mesh(flyingWebGeometry(r, pinR, d / 2, gap), m.forged);
        fly.position.x = (t.x1 + next.x0) / 2;
        const g = new THREE.Group();
        g.rotation.x = bisector * DEG;
        g.add(fly);
        this.crank.add(g);
      }
      // Main journal from the previous web to this one.
      if (!sharedFront) {
        const j0 = prevEnd;
        const j1 = t.x0 - webT;
        if (j1 - j0 > 1e-4) {
          const journal = this.mesh(xCylinder(mainR, j1 - j0, 28), m.steel);
          journal.position.x = (j0 + j1) / 2;
          this.crank.add(journal);
        }
      }
      prevEnd = t.x1 + (sharedBack ? 0 : webT);
    });
    const tail = this.mesh(xCylinder(mainR, xMax - prevEnd + 0.02, 28), m.steel);
    tail.position.x = (prevEnd + xMax + 0.02) / 2;
    this.crank.add(tail);
    const snout = this.mesh(xCylinder(mainR * 0.75, 0.06, 24), m.steel);
    snout.position.x = xMin - 0.01;
    this.crank.add(snout);

    // Flywheel (rear, +X) with a painted timing mark so its rotation reads at a glance.
    const flyR = Math.max(0.13, cwR + 0.045);
    const fly = this.mesh(flywheelGeometry(flyR, 0.03), m.steel);
    fly.position.x = xMax + 0.04;
    this.crank.add(fly);
    const mark = this.mesh(new THREE.BoxGeometry(0.032, flyR * 0.28, 0.012), m.mark, false);
    mark.position.set(xMax + 0.04, flyR * 0.72, 0);
    this.crank.add(mark);
    // Front pulley.
    const pul = this.mesh(pulleyGeometry(cwR * 0.95, 0.05), m.anodized);
    pul.position.x = xMin - 0.06;
    this.crank.add(pul);

    // ---- Per cylinder -------------------------------------------------------------
    const pistonGeo = this.geo(pistonGeometry(B, ch));
    const rodGeo = this.geo(rodGeometry(L, pinR, gudgeonR, rodW * 0.9));
    const exValveGeo = this.geo(valveGeometry(0.15 * B, 0.46 * B));
    const inValveGeo = this.geo(valveGeometry(0.175 * B, 0.46 * B));
    const plug = sparkPlugParts(B);
    const plugGeo = this.geo(plug.ceramic);
    const hexGeo = this.geo(plug.hex);
    const linerGeo = this.geo(new THREE.CylinderGeometry(B / 2 + 0.003, B / 2 + 0.003, D - (L - r - 0.3 * B) + 0.004, 40, 1, true));
    const burnGeo = this.geo(new THREE.CylinderGeometry(B * 0.48, B * 0.48, 1, 32));
    const headH = 0.95 * B;
    const headW = B * 1.5;
    const exhaustSide = (alpha: number) => (spec.layout === 'inline' ? 1 : Math.sign(alpha));

    for (let i = 0; i < spec.cylinders; i++) {
      const alpha = axisOf(spec, i);
      const x = xs[i];
      const se = exhaustSide(alpha);

      const piston = this.mesh(pistonGeo, m.piston);
      piston.rotation.x = alpha * DEG;
      this.engine.add(piston);

      const rod = this.mesh(rodGeo, m.rod);
      this.engine.add(rod);

      const liner = this.addGlass(linerGeo, bankPoint(x, (D + (L - r - 0.3 * B)) / 2, 0, alpha), alpha * DEG);
      liner.renderOrder = 2;

      const exhaustValves: THREE.Object3D[] = [];
      const intakeValves: THREE.Object3D[] = [];
      for (const dx of [-0.2 * B, 0.2 * B]) {
        const ev = this.mesh(exValveGeo, m.valve);
        ev.rotation.x = alpha * DEG;
        ev.userData.base = bankPoint(x + dx, D - 0.004, se * 0.22 * B, alpha);
        exhaustValves.push(ev);
        this.engine.add(ev);
        const iv = this.mesh(inValveGeo, m.valve);
        iv.rotation.x = alpha * DEG;
        iv.userData.base = bankPoint(x + dx, D - 0.004, -se * 0.22 * B, alpha);
        intakeValves.push(iv);
        this.engine.add(iv);
      }

      const plugMesh = this.mesh(plugGeo, m.ceramic);
      bankPoint(x, D + headH * 0.62, 0, alpha, plugMesh.position);
      plugMesh.rotation.x = alpha * DEG;
      this.engine.add(plugMesh);
      const hex = this.mesh(hexGeo, m.steel);
      hex.position.copy(plugMesh.position);
      hex.rotation.x = alpha * DEG;
      this.engine.add(hex);

      const spark = this.sparkSprite(B * 0.55);
      bankPoint(x, D - 0.006, 0, alpha, spark.position);
      this.engine.add(spark);

      const burnMat = this.own(
        new THREE.MeshBasicMaterial({
          color: 0xff8a2a,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      const burn = new THREE.Mesh(burnGeo, burnMat);
      burn.userData.fx = true;
      burn.visible = false;
      burn.rotation.x = alpha * DEG;
      burn.renderOrder = 4;
      this.engine.add(burn);

      this.cyl.push({
        x,
        alpha,
        fire: fire[i],
        tdc: tdc[i],
        pin: pins[i],
        piston,
        rod,
        exhaustValves,
        intakeValves,
        spark,
        burn,
        burnMat,
        header: new THREE.CatmullRomCurve3([]),
      });
    }

    // ---- Cams: two per bank, lobes timed to each valve -------------------------------
    const lobeBase = 0.12 * B;
    const lobeGeo = this.geo(lobeGeometry(lobeBase, maxLift, 0.11 * B));
    const camShaftLen = xMax - xMin - 0.04;
    const shaftGeo = this.geo(xCylinder(lobeBase * 0.62, camShaftLen, 18));
    const camA = D - 0.004 + 0.46 * B + 0.01 + lobeBase;
    const banks = [...new Set(spec.bankOf)];
    for (const b of banks) {
      const alpha = spec.bankAxis[b];
      const se = exhaustSide(alpha);
      for (const side of ['exhaust', 'intake'] as const) {
        const s = (side === 'exhaust' ? se : -se) * 0.22 * B;
        const cam = new THREE.Group();
        bankPoint((xMin + xMax) / 2, camA, s, alpha, cam.position);
        const shaft = new THREE.Mesh(shaftGeo, m.steel);
        shaft.castShadow = true;
        cam.add(shaft);
        const peak =
          side === 'exhaust'
            ? (VALVE_EVENTS.exhaustOpen + VALVE_EVENTS.exhaustClose) / 2
            : (VALVE_EVENTS.intakeOpen + VALVE_EVENTS.intakeClose) / 2;
        this.cyl.forEach((c, i) => {
          if (spec.bankOf[i] !== b) return;
          for (const dx of [-0.2 * B, 0.2 * B]) {
            const lobe = new THREE.Mesh(lobeGeo, m.steel);
            lobe.castShadow = true;
            lobe.position.x = c.x + dx - (xMin + xMax) / 2;
            lobe.rotation.x = (alpha + 180 - (c.fire + peak) / 2) * DEG;
            cam.add(lobe);
          }
        });
        this.cams.push(cam);
        this.engine.add(cam);
      }
      // Cam sprockets at the front.
      for (const sgn of [-1, 1]) {
        const sprocket = this.mesh(xCylinder(lobeBase * 2.1, 0.012, 32), m.anodized);
        bankPoint(xMin - 0.015, camA, sgn * 0.22 * B, alpha, sprocket.position);
        this.engine.add(sprocket);
      }
    }

    // ---- Glass block, heads and crankcase ----------------------------------------------
    const len = xMax - xMin;
    const blockBottom = spec.layout === 'inline' ? 0 : cwR + 0.01;
    for (const b of banks) {
      const alpha = spec.bankAxis[b];
      const blockH = D - blockBottom;
      this.addGlass(this.glassBox(len, blockH, B * 1.42, 0.012), bankPoint((xMin + xMax) / 2, blockBottom + blockH / 2, 0, alpha), alpha * DEG);
      this.addGlass(this.glassBox(len, headH, headW, 0.03), bankPoint((xMin + xMax) / 2, D + headH / 2 + 0.002, 0, alpha), alpha * DEG);
    }
    const caseH = cwR + 0.05 + (spec.layout === 'inline' ? 0 : cwR * 0.4);
    const caseW = 2 * cwR + 0.06;
    this.addGlass(this.glassBox(len, caseH, caseW, 0.03), new THREE.Vector3((xMin + xMax) / 2, -(cwR + 0.05) + caseH / 2, 0));
    // Oil pan.
    const pan = this.mesh(new RoundedBoxGeometry(len * 0.92, 0.07, caseW * 0.85, 3, 0.015), m.casting);
    pan.position.set((xMin + xMax) / 2, -(cwR + 0.05) - 0.035, 0);
    this.panBottom = -(cwR + 0.05) - 0.07;
    this.engine.add(pan);

    // ---- Intake: runners, plenum and a throttle body with a moving butterfly ----------
    const portA = D + headH * 0.32;
    const ports = this.cyl.map((c) => bankPoint(c.x, portA, -exhaustSide(c.alpha) * headW * 0.5, c.alpha));
    let plenumPos: THREE.Vector3;
    if (spec.layout === 'inline') {
      plenumPos = new THREE.Vector3((xMin + xMax) / 2, portA + 0.04, -(headW * 0.5 + 0.13));
    } else {
      const maxY = Math.max(...ports.map((p) => p.y));
      plenumPos = new THREE.Vector3((xMin + xMax) / 2, maxY + 0.11, 0);
    }
    const plenumW = spec.layout === 'inline' ? 0.11 : 0.15;
    const plenum = this.mesh(new RoundedBoxGeometry(len * 0.9, 0.09, plenumW, 4, 0.03), m.anodized);
    plenum.position.copy(plenumPos);
    this.engine.add(plenum);
    this.cyl.forEach((c, i) => {
      const out = bankPoint(0, 0, -exhaustSide(c.alpha), c.alpha).setX(0);
      const p0 = ports[i];
      const p1 = p0.clone().addScaledVector(out, 0.05);
      const end = new THREE.Vector3(c.x, plenumPos.y - 0.03, plenumPos.z + (spec.layout === 'inline' ? 0.03 : 0));
      const mid = p1.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.04, 0));
      const curve = new THREE.CatmullRomCurve3([p0, p1, mid, end], false, 'centripetal');
      this.engine.add(this.mesh(new THREE.TubeGeometry(curve, 24, B * 0.15, 12), m.intake));
    });
    const tb = this.mesh(xCylinder(0.042, 0.07, 28), m.steel);
    tb.position.set(plenumPos.x - len * 0.45 - 0.03, plenumPos.y, plenumPos.z);
    this.engine.add(tb);
    const plate = this.mesh(xCylinder(0.037, 0.004, 28), m.valve, false);
    this.throttlePlate.position.copy(tb.position).add(new THREE.Vector3(-0.01, 0, 0));
    this.throttlePlate.add(plate);
    this.engine.add(this.throttlePlate);

    // ---- Exhaust headers ------------------------------------------------------------------
    const buses = Math.max(...spec.exhaustBus) + 1;
    const exPortA = D + headH * 0.3;
    for (let bus = 0; bus < buses; bus++) {
      const members = this.cyl.map((c, i) => ({ c, i })).filter(({ i }) => spec.exhaustBus[i] === bus);
      const firstAlpha = members[0].c.alpha;
      const se = exhaustSide(firstAlpha);
      const out = bankPoint(0, 0, se, firstAlpha).setX(0);
      const down = bankPoint(0, -1, 0, firstAlpha).setX(0);
      let collector: THREE.Vector3;
      if (spec.layout === 'flat') {
        collector = new THREE.Vector3(xMax + 0.04, -(cwR + 0.11), 0);
      } else {
        const p = bankPoint(xMax + 0.05, exPortA, se * headW * 0.5, firstAlpha);
        collector = p.addScaledVector(out, 0.12).addScaledVector(down, D * 0.75);
      }
      for (const { c, i } of members) {
        const p0 = bankPoint(c.x, exPortA, se * headW * 0.5, c.alpha);
        const p1 = p0.clone().addScaledVector(out, 0.05);
        const p2 = p1.clone().addScaledVector(out, 0.035).addScaledVector(down, 0.1);
        const pts = [p0, p1, p2];
        // Unequal-length headers: a detour proportional to the extra delay.
        const extra = spec.headerDelayMs[i] * 0.22;
        if (extra > 0.01) {
          const loop = p2.clone().addScaledVector(down, 0.05 + extra * 0.4);
          loop.x += (c.x < 0 ? -1 : 1) * extra * 0.6;
          pts.push(loop);
        }
        const p3 = new THREE.Vector3((c.x + collector.x) / 2, (p2.y + collector.y) / 2, (p2.z + collector.z) / 2);
        pts.push(p3, collector.clone());
        const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
        c.header = curve;
        this.engine.add(this.mesh(new THREE.TubeGeometry(curve, 64, B * 0.16, 14), m.header));
      }
      // Collector and a short stub where the exhaust system would bolt on.
      const stubEnd = collector.clone().add(new THREE.Vector3(0.1, -0.005, 0));
      this.engine.add(this.mesh(new THREE.TubeGeometry(new THREE.LineCurve3(collector, stubEnd), 4, B * 0.24, 18), m.header));
      const flange = this.mesh(xCylinder(B * 0.38, 0.012, 24), m.steel);
      flange.position.copy(stubEnd);
      this.engine.add(flange);
    }

    this.makePulses(B * 0.5);
  }

  update(f: RigFrame) {
    const { r, L, ch, D, maxLift } = this.dims;
    const cycle = mod(f.cycle, 720);
    const crankDeg = mod(cycle, 360);
    this.crank.rotation.x = crankDeg * DEG;
    for (const cam of this.cams) cam.rotation.x = (cycle / 2) * DEG;
    this.throttlePlate.rotation.y = f.throttle * 1.35;

    const pistonPos = new THREE.Vector3();
    const pinPos = new THREE.Vector3();
    const burnFade = f.cut ? 0 : 0.35 + 0.65 * f.load;

    for (const c of this.cyl) {
      const dist = pistonDistance(r, L, crankDeg - c.tdc);
      bankPoint(c.x, dist, 0, c.alpha, pistonPos);
      c.piston.position.copy(pistonPos);
      const psi = (c.pin + crankDeg) * DEG;
      pinPos.set(c.x, r * Math.cos(psi), r * Math.sin(psi));
      c.rod.position.copy(pinPos);
      c.rod.rotation.x = Math.atan2(pistonPos.z - pinPos.z, pistonPos.y - pinPos.y);

      const local = localCycle(c.fire, cycle);
      const el = exhaustLift(local) * maxLift;
      const il = intakeLift(local) * maxLift;
      const down = bankPoint(0, -1, 0, c.alpha).setX(0);
      for (const v of c.exhaustValves) v.position.copy(v.userData.base as THREE.Vector3).addScaledVector(down, el);
      for (const v of c.intakeValves) v.position.copy(v.userData.base as THREE.Vector3).addScaledVector(down, il);

      // Spark: a short flash right at firing TDC.
      const sparkK = !f.cut && local < 22 ? 1 - local / 22 : 0;
      (c.spark.material as THREE.SpriteMaterial).opacity = sparkK;
      c.spark.visible = sparkK > 0.01;

      // Burning charge between crown and head: blue flame front, then orange, fading by BDC.
      const crown = dist + ch;
      const gap = Math.max(0.002, D - crown);
      bankPoint(c.x, crown + gap / 2, 0, c.alpha, c.burn.position);
      c.burn.scale.y = gap;
      if (local < 150 && burnFade > 0) {
        const k = local < 12 ? local / 12 : Math.pow(1 - (local - 12) / 138, 1.6);
        c.burnMat.opacity = Math.min(0.85, k * burnFade);
        const blue = Math.max(0, 1 - local / 30);
        c.burnMat.color.setRGB(1.6 - 0.9 * blue, 0.55 + 0.2 * blue, 0.15 + 1.2 * blue);
        c.burn.visible = true;
      } else {
        c.burn.visible = false;
      }

      // Exhaust valve just opened during this frame: send a glowing pulse down the header.
      if (f.pulses && !f.cut && crossed(this.lastCycle, cycle, mod(c.fire + VALVE_EVENTS.exhaustOpen, 720))) {
        this.spawnPulse(c.header, 0.35 + 0.65 * f.load);
      }
    }
    this.lastCycle = cycle;
    this.updateExhaust(f.dt, f.heat);

    // Mount shake from the residual reciprocating forces, exaggerated so it can be seen.
    if (f.shake > 0) {
      const s = shakeAt(this.spec, this.balance, crankDeg, f.rpm);
      const kF = 4.5e-7 * f.shake;
      const kM = 9e-6 * f.shake;
      this.engine.position.set(0, this.baseY + s.fy * kF, s.fz * kF);
      this.engine.rotation.set(0, s.my * kM, s.mz * kM);
    } else {
      this.engine.position.set(0, this.baseY, 0);
      this.engine.rotation.set(0, 0, 0);
    }
  }
}
