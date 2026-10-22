// A moving Wankel rotary: glass trochoid housings and side plates, triangular rotors
// orbiting the eccentric shaft at one-third speed, the 3:2 phasing gears that make them
// do it, two spark plugs per rotor, intake runners and exhaust headers.
//
// Housing-plane coordinates come from wankel.ts (x = long axis, y = toward the plugs) and
// map to engine space as Y = x, Z = −y: plugs face the back, ports face the camera.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { RotarySpec } from '../../engines/catalog.ts';
import { DEG, PORT_EVENTS, firingAngles, localCycle, mod } from '../../engines/kinematics.ts';
import { housingOutline, rotorOutline, rotorPose, shaftAngle, type Vec2 } from '../../engines/wankel.ts';
import type { Materials } from '../materials.ts';
import { RigBase, crossed, type RigFrame } from './common.ts';
import { extrudeAcross, flywheelGeometry, pulleyGeometry, sparkPlugParts, xCylinder } from './parts.ts';

const MM = 1e-3;

/** Housing-plane point → engine space. */
const yz = (p: Vec2, x = 0, out = new THREE.Vector3()) => out.set(x, p.x, -p.y);

function toShape(points: Vec2[], holes: Vec2[][] = []): THREE.Shape {
  const s = new THREE.Shape(points.map((p) => new THREE.Vector2(p.y, p.x)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.y, p.x))));
  return s;
}

const circle = (r: number, n = 48, cx = 0, cy = 0): Vec2[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });

function roundedRect(hx: number, hy: number, rad: number, seg = 8): Vec2[] {
  const pts: Vec2[] = [];
  const corners: [number, number, number][] = [
    [hx - rad, hy - rad, 0],
    [-hx + rad, hy - rad, 90],
    [-hx + rad, -hy + rad, 180],
    [hx - rad, -hy + rad, 270],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = (a0 + (90 * i) / seg) * DEG;
      pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
    }
  }
  return pts;
}

function sector(r: number, centreDeg: number, halfDeg: number, n = 24): Vec2[] {
  const pts: Vec2[] = [{ x: 0, y: 0 }];
  for (let i = 0; i <= n; i++) {
    const a = (centreDeg - halfDeg + (2 * halfDeg * i) / n) * DEG;
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
  }
  return pts;
}

/** Spur gear ring in the housing plane. Teeth point outward (stationary gear) or inward (rotor's internal gear). */
function gearGeometry(pitchR: number, teeth: number, width: number, inward: boolean): THREE.BufferGeometry {
  const toothH = 0.0035;
  const rIn = inward ? pitchR + toothH * 0.5 : pitchR - 0.007;
  const rOut = inward ? pitchR + 0.008 : pitchR - toothH * 0.5;
  const ring = extrudeAcross(toShape(circle(rOut, 72), [circle(rIn, 72)]), width, 0);
  const parts: THREE.BufferGeometry[] = [ring];
  const toothW = ((Math.PI * 2 * pitchR) / teeth) * 0.5;
  for (let i = 0; i < teeth; i++) {
    const t = new THREE.BoxGeometry(width, toothH, toothW);
    t.translate(0, pitchR, 0);
    t.rotateX((i / teeth) * Math.PI * 2);
    parts.push(t);
  }
  const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false)!;
  parts.forEach((p) => p.dispose());
  return merged;
}

interface RotorParts {
  x: number;
  group: THREE.Group;
  skins: THREE.MeshBasicMaterial[];
  lead: THREE.Sprite;
  trail: THREE.Sprite;
  header: THREE.CatmullRomCurve3;
}

export class RotaryRig extends RigBase {
  declare readonly spec: RotarySpec;
  private readonly shaft = new THREE.Group();
  private readonly rotors: RotorParts[] = [];
  private readonly throttlePlate = new THREE.Group();
  private readonly fire: number[];
  private lastCycle = 0;
  private panBottom = 0;

  constructor(spec: RotarySpec, mats: Materials) {
    super(spec, mats);
    // Look in more along the shaft, so the rotors are seen through the front plate.
    this.viewDir.set(-2.3, 1.0, 1.25).normalize();
    this.fire = firingAngles(spec);
    this.engine.add(this.shaft);
    this.build();
    this.finish(this.panBottom);
  }

  private build() {
    const spec = this.spec;
    const m = this.mats;
    const R = spec.generatingRadius * MM;
    const e = spec.eccentricity * MM;
    const W = spec.rotorWidth * MM;
    const n = spec.rotors;
    const plateT = 0.032;
    const midT = 0.04;
    const total = 2 * plateT + n * W + (n - 1) * midT;
    const x0 = -total / 2;
    const rotorX = Array.from({ length: n }, (_, r) => x0 + plateT + r * (W + midT) + W / 2);
    const hx = R + e + 0.03; // half-length of the housing along its long axis
    const hy = R - e + 0.055; // half-width across the waist
    const outer = roundedRect(hx, hy, 0.035);

    // ---- Rotor housings (the trochoid bore) and side plates -----------------------------
    const housingGeo = this.geo(extrudeAcross(toShape(outer, [housingOutline(R, e, 240)]), W, 0));
    for (const x of rotorX) this.addGlass(housingGeo, new THREE.Vector3(x, 0, 0), 0, 30);
    const plateGeo = (t: number) => this.geo(extrudeAcross(toShape(outer, [circle(0.03)]), t, 0));
    this.addGlass(plateGeo(plateT), new THREE.Vector3(x0 + plateT / 2, 0, 0), 0, 30);
    this.addGlass(plateGeo(plateT), new THREE.Vector3(x0 + total - plateT / 2, 0, 0), 0, 30);
    for (let r = 0; r < n - 1; r++) this.addGlass(plateGeo(midT), new THREE.Vector3(rotorX[r] + W / 2 + midT / 2, 0, 0), 0, 30);

    // Side ports cut into the plates, on the port side of the waist: exhaust toward the
    // power lobe (−x, shares the header's heat glow), intake toward the intake lobe (+x).
    const waist = -(R - e);
    const slot = (rx: number, ry: number) =>
      this.geo(extrudeAcross(toShape(Array.from({ length: 32 }, (_, i) => {
        const a = (i / 32) * Math.PI * 2;
        return { x: rx * Math.cos(a), y: ry * Math.sin(a) };
      })), 0.003, 0));
    const exSlot = slot(0.016, 0.008);
    const inSlot = slot(0.024, 0.01);
    for (const x of rotorX) {
      for (const side of [-1, 1]) {
        const px = x + side * (W / 2 + 0.0016);
        const ex = this.mesh(exSlot, m.header, false);
        yz({ x: -0.045, y: waist + 0.016 }, px, ex.position);
        this.engine.add(ex);
        const ip = this.mesh(inSlot, m.rubber, false);
        yz({ x: 0.05, y: waist + 0.02 }, px, ip.position);
        this.engine.add(ip);
      }
    }

    // ---- Eccentric shaft, counterweights, flywheel, pulley ----------------------------------
    const mainR = 0.0215;
    const shaftLen = total + 0.14;
    const main = this.mesh(xCylinder(mainR, shaftLen, 28), m.steel);
    this.shaft.add(main);
    rotorX.forEach((x, r) => {
      const a = ((360 * r) / n) * DEG;
      const journal = this.mesh(xCylinder(0.037, W - 0.008, 40), m.steel);
      yz({ x: e * Math.cos(a), y: e * Math.sin(a) }, x, journal.position);
      this.shaft.add(journal);
    });
    // Counterweights sit opposite the nearest rotor journal to cancel the rocking couple.
    const cwGeo = (centre: number) => this.geo(extrudeAcross(toShape(sector(0.055, centre, 75)), 0.016, 0.002));
    const cwFront = this.mesh(cwGeo(180), m.forged);
    cwFront.position.x = x0 - 0.025;
    this.shaft.add(cwFront);
    const cwRear = this.mesh(cwGeo(180 + (360 * (n - 1)) / n), m.forged);
    cwRear.position.x = x0 + total + 0.025;
    this.shaft.add(cwRear);
    const flyR = 0.135;
    const fly = this.mesh(flywheelGeometry(flyR, 0.03), m.steel);
    fly.position.x = x0 + total + 0.07;
    this.shaft.add(fly);
    const mark = this.mesh(new THREE.BoxGeometry(0.032, flyR * 0.28, 0.012), m.mark, false);
    mark.position.set(x0 + total + 0.07, flyR * 0.72, 0);
    this.shaft.add(mark);
    // A small pulley, so the front rotor stays visible through the front plate.
    const pul = this.mesh(pulleyGeometry(0.045, 0.05), m.anodized);
    pul.position.x = x0 - 0.06;
    this.shaft.add(pul);

    // ---- Stationary phasing gears (2e pitch radius, 34 teeth) on the plates -----------------
    const statGeo = this.geo(gearGeometry(2 * e, 34, 0.016, false));
    for (const x of rotorX) {
      const g = this.mesh(statGeo, m.anodized);
      g.position.x = x - W / 2 + 0.012;
      this.engine.add(g);
    }

    // ---- Rotors ---------------------------------------------------------------------------
    const perFlank = 60;
    const outline = rotorOutline(R / MM, e / MM, 0.6, perFlank).map((p) => ({ x: p.x * MM, y: p.y * MM }));
    const rotorGeo = this.geo(extrudeAcross(toShape(outline, [circle(0.0395, 48)]), W - 0.004, 0.0012));
    const sealGeo = this.geo(new THREE.BoxGeometry(W - 0.003, 0.007, 0.0028));
    const ringGeo = this.geo(gearGeometry(3 * e, 51, 0.014, true));
    const plug = sparkPlugParts(0.09);
    const plugGeo = this.geo(plug.ceramic);
    const hexGeo = this.geo(plug.hex);
    rotorX.forEach((x) => {
      const group = new THREE.Group();
      group.position.x = x;
      const body = this.mesh(rotorGeo, m.piston);
      group.add(body);
      for (let k = 0; k < 3; k++) {
        const a = 120 * k * DEG;
        const seal = this.mesh(sealGeo, m.valve, false);
        yz({ x: (R - 0.0035) * Math.cos(a), y: (R - 0.0035) * Math.sin(a) }, 0, seal.position);
        seal.rotation.x = -a;
        group.add(seal);
      }
      const ring = this.mesh(ringGeo, m.steel);
      ring.position.x = -W / 2 + 0.012;
      group.add(ring);

      // A glowing skin on each face, lit while that face's charge burns.
      const skins: THREE.MeshBasicMaterial[] = [];
      for (let k = 0; k < 3; k++) {
        const pts = outline.slice(k * perFlank, (k + 1) * perFlank + 1);
        if (k === 2) pts.push(outline[0]);
        const pos: number[] = [];
        const idx: number[] = [];
        pts.forEach((p, i) => {
          const s = 1 + 0.0012 / Math.hypot(p.x, p.y);
          for (const xx of [-(W / 2 - 0.004), W / 2 - 0.004]) pos.push(xx, p.x * s, -p.y * s);
          if (i > 0) {
            const b = (i - 1) * 2;
            idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
          }
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        const mat = this.own(
          new THREE.MeshBasicMaterial({
            color: 0xff8a2a,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        const skin = new THREE.Mesh(this.geo(g), mat);
        skin.userData.fx = true;
        skin.renderOrder = 4;
        group.add(skin);
        skins.push(mat);
      }
      this.engine.add(group);

      // Leading and trailing spark plugs on the plug side of the waist.
      const plugY = hy - 0.004;
      const sparks: THREE.Sprite[] = [];
      for (const px of [-0.014, 0.02]) {
        const body2 = this.mesh(plugGeo, m.ceramic);
        yz({ x: px, y: plugY }, x, body2.position);
        body2.rotation.x = -Math.PI / 2;
        this.engine.add(body2);
        const hex = this.mesh(hexGeo, m.steel);
        hex.position.copy(body2.position);
        hex.rotation.x = -Math.PI / 2;
        this.engine.add(hex);
        const spark = this.sparkSprite(0.05);
        yz({ x: px, y: R - e - 0.003 }, x, spark.position);
        this.engine.add(spark);
        sparks.push(spark);
      }

      this.rotors.push({ x, group, skins, lead: sparks[0], trail: sparks[1], header: new THREE.CatmullRomCurve3([]) });
    });

    // ---- Exhaust: one header per rotor from the port side, merging behind ---------------------
    const collector = new THREE.Vector3(x0 + total + 0.06, -hx + 0.02, hy + 0.09);
    for (const rp of this.rotors) {
      const p0 = yz({ x: -0.05, y: -(hy - 0.012) }, rp.x);
      const p1 = p0.clone().add(new THREE.Vector3(0, -0.005, 0.05));
      const p2 = p1.clone().add(new THREE.Vector3(0, -0.07, 0.035));
      const p3 = new THREE.Vector3((rp.x + collector.x) / 2, (p2.y + collector.y) / 2, (p2.z + collector.z) / 2 + 0.01);
      const curve = new THREE.CatmullRomCurve3([p0, p1, p2, p3, collector.clone()], false, 'centripetal');
      rp.header = curve;
      this.engine.add(this.mesh(new THREE.TubeGeometry(curve, 64, 0.019, 14), m.header));
    }
    const stubEnd = collector.clone().add(new THREE.Vector3(0.1, -0.005, 0));
    this.engine.add(this.mesh(new THREE.TubeGeometry(new THREE.LineCurve3(collector, stubEnd), 4, 0.026, 18), m.header));
    const flange = this.mesh(xCylinder(0.04, 0.012, 24), m.steel);
    flange.position.copy(stubEnd);
    this.engine.add(flange);

    // ---- Intake: plenum on top, runners down to the side ports --------------------------------
    const plenumPos = new THREE.Vector3(0, hx + 0.08, hy * 0.35);
    const plenum = this.mesh(new RoundedBoxGeometry(total + 0.02, 0.085, 0.13, 4, 0.03), m.anodized);
    plenum.position.copy(plenumPos);
    this.engine.add(plenum);
    for (const x of rotorX) {
      for (const dx of [-W * 0.3, W * 0.3]) {
        const p0 = yz({ x: 0.05, y: -(hy - 0.012) }, x + dx);
        const p1 = p0.clone().add(new THREE.Vector3(0, 0.01, 0.045));
        const p2 = new THREE.Vector3(x + dx, hx + 0.005, hy + 0.03);
        const end = new THREE.Vector3(x + dx, plenumPos.y - 0.035, plenumPos.z + 0.02);
        const curve = new THREE.CatmullRomCurve3([p0, p1, p2, end], false, 'centripetal');
        this.engine.add(this.mesh(new THREE.TubeGeometry(curve, 32, 0.012, 12), m.intake));
      }
    }
    const tb = this.mesh(xCylinder(0.038, 0.07, 28), m.steel);
    tb.position.set(plenumPos.x - total / 2 - 0.045, plenumPos.y, plenumPos.z);
    this.engine.add(tb);
    const plate = this.mesh(xCylinder(0.033, 0.004, 28), m.valve, false);
    this.throttlePlate.position.copy(tb.position).add(new THREE.Vector3(-0.01, 0, 0));
    this.throttlePlate.add(plate);
    this.engine.add(this.throttlePlate);

    // ---- Oil pan ---------------------------------------------------------------------------------
    const pan = this.mesh(new RoundedBoxGeometry(total * 0.95, 0.06, hy * 1.6, 3, 0.015), m.casting);
    pan.position.set(0, -hx - 0.03, 0);
    this.engine.add(pan);
    this.panBottom = -hx - 0.06;

    this.makePulses(0.045);
  }

  update(f: RigFrame) {
    const spec = this.spec;
    const cycle = mod(f.cycle, spec.cycleDeg);
    const e = spec.eccentricity * MM;
    this.shaft.rotation.x = -shaftAngle(cycle, 0, spec.rotors) * DEG;
    this.throttlePlate.rotation.y = f.throttle * 1.35;
    const burnFade = f.cut ? 0 : 0.35 + 0.65 * f.load;

    this.rotors.forEach((rp, r) => {
      const pose = rotorPose(e, cycle, r, spec.rotors);
      rp.group.position.set(rp.x, pose.cx, -pose.cy);
      rp.group.rotation.x = -pose.angle;

      let sinceFire = Infinity;
      for (let k = 0; k < 3; k++) {
        const ch = r * 3 + k;
        const local = localCycle(this.fire[ch], cycle, spec.cycleDeg);
        sinceFire = Math.min(sinceFire, local);
        // The burning charge rides on the face through the power phase (0..270°).
        const mat = rp.skins[k];
        if (burnFade > 0 && local < 240) {
          const kk = local < 15 ? local / 15 : Math.pow(1 - (local - 15) / 225, 1.5);
          mat.opacity = Math.min(0.9, kk * burnFade);
          const blue = Math.max(0, 1 - local / 40);
          mat.color.setRGB(1.6 - 0.9 * blue, 0.55 + 0.2 * blue, 0.15 + 1.2 * blue);
        } else {
          mat.opacity = 0;
        }
        if (f.pulses && !f.cut && crossed(this.lastCycle, cycle, mod(this.fire[ch] + PORT_EVENTS.exhaustOpen, spec.cycleDeg))) {
          this.spawnPulse(rp.header, 0.35 + 0.65 * f.load);
        }
      }
      // The leading plug fires first; the trailing plug a few degrees later.
      const lead = !f.cut && sinceFire < 22 ? 1 - sinceFire / 22 : 0;
      const trail = !f.cut && sinceFire >= 6 && sinceFire < 28 ? 1 - (sinceFire - 6) / 22 : 0;
      (rp.lead.material as THREE.SpriteMaterial).opacity = lead;
      rp.lead.visible = lead > 0.01;
      (rp.trail.material as THREE.SpriteMaterial).opacity = trail;
      rp.trail.visible = trail > 0.01;
    });
    this.lastCycle = cycle;
    this.updateExhaust(f.dt, f.heat);
    // Nothing reciprocates, and the counterweights balance the rotors: no mount shake.
    this.engine.position.set(0, this.baseY, 0);
  }
}
