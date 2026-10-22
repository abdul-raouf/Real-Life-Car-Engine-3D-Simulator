// Geometry builders for engine parts. Every part is built in a local frame where
//   +X runs along the crank, +Y points up the cylinder bore, +Z is sideways across the bank.
// So a part is placed by position + rotation.x = bank angle.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const merge = (parts: THREE.BufferGeometry[]) => {
  const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
  parts.forEach((p) => p.dispose());
  return g!;
};

/** Cylinder whose axis runs along X. */
export function xCylinder(radius: number, length: number, segments = 32): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(radius, radius, length, segments);
  g.rotateZ(Math.PI / 2);
  return g;
}

/** Extrude a 2D outline drawn in the YZ cross-section (shape x → world −Z), thickness along X. */
export function extrudeAcross(shape: THREE.Shape, depth: number, bevel: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 28,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

/** Crank web: a boss around the crank pin (at +Y) and a counterweight sweeping the opposite side. */
export function webGeometry(throwR: number, pinR: number, cwR: number, thickness: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const boss = pinR * 1.45;
  const half = (68 * Math.PI) / 180;
  s.absarc(0, throwR, boss, 0, Math.PI, false);
  s.lineTo(-cwR * Math.sin(half), -cwR * Math.cos(half));
  s.absarc(0, 0, cwR, -Math.PI / 2 - half, -Math.PI / 2 + half, false);
  s.lineTo(boss, throwR);
  return extrudeAcross(s, thickness, thickness * 0.12);
}

/** Cam lobe: base circle with a smooth nose at +Y. */
export function lobeGeometry(baseR: number, lift: number, width: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const n = 72;
  const noseHalf = (75 * Math.PI) / 180;
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI * 2;
    const d = Math.atan2(Math.sin(th), Math.cos(th));
    const bump = Math.abs(d) < noseHalf ? Math.pow(Math.cos((d / noseHalf) * (Math.PI / 2)), 2) : 0;
    const rho = baseR + lift * bump;
    const x = rho * Math.sin(th);
    const y = rho * Math.cos(th);
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  return extrudeAcross(s, width, 0);
}

/** Connecting rod from the big end (origin) to the small end (+Y · length). I-beam shank. */
export function rodGeometry(length: number, pinR: number, gudgeonR: number, width: number): THREE.BufferGeometry {
  const big = xCylinder(pinR * 1.42, width * 0.92, 28);
  const small = xCylinder(gudgeonR * 1.55, width * 0.7, 20);
  small.translate(0, length, 0);
  const shankLen = length - pinR * 1.2 - gudgeonR * 1.3;
  const webW = width * 0.22;
  const flangeD = pinR * 0.32;
  const depth = pinR * 1.25;
  const web = new THREE.BoxGeometry(webW, shankLen, depth);
  web.translate(0, pinR * 1.2 + shankLen / 2, 0);
  const f1 = new THREE.BoxGeometry(width * 0.62, shankLen, flangeD);
  f1.translate(0, pinR * 1.2 + shankLen / 2, depth / 2 - flangeD / 2);
  const f2 = f1.clone();
  f2.translate(0, 0, -(depth - flangeD));
  const cap = new THREE.BoxGeometry(width * 0.92, pinR * 0.5, pinR * 3.2);
  cap.translate(0, -pinR * 1.25, 0);
  return merge([big, small, web, f1, f2, cap]);
}

/** Piston turned on a lathe: skirt, three ring grooves, slightly domed crown. y = 0 at the gudgeon pin. */
export function pistonGeometry(bore: number, compressionHeight: number): THREE.BufferGeometry {
  const R = bore / 2;
  const ch = compressionHeight;
  const B = bore;
  const p = (r: number, y: number) => new THREE.Vector2(r, y);
  const pts = [
    p(0.0001, -0.27 * B),
    p(R * 0.96, -0.3 * B),
    p(R * 0.985, -0.285 * B),
    p(R * 0.985, ch - 0.25 * B),
    p(R * 0.935, ch - 0.245 * B),
    p(R * 0.935, ch - 0.215 * B),
    p(R * 0.99, ch - 0.21 * B),
    p(R * 0.99, ch - 0.17 * B),
    p(R * 0.935, ch - 0.165 * B),
    p(R * 0.935, ch - 0.14 * B),
    p(R * 0.99, ch - 0.135 * B),
    p(R * 0.99, ch - 0.1 * B),
    p(R * 0.935, ch - 0.095 * B),
    p(R * 0.935, ch - 0.07 * B),
    p(R * 0.992, ch - 0.065 * B),
    p(R * 0.992, ch - 0.012 * B),
    p(R * 0.95, ch),
    p(R * 0.55, ch + 0.012 * B),
    p(0.0001, ch + 0.016 * B),
  ];
  return new THREE.LatheGeometry(pts, 48);
}

/** Poppet valve: head disc at y = 0, stem rising to +Y. */
export function valveGeometry(headR: number, stemLen: number): THREE.BufferGeometry {
  const head = new THREE.CylinderGeometry(headR * 0.55, headR, headR * 0.28, 28);
  head.translate(0, headR * 0.14, 0);
  const stem = new THREE.CylinderGeometry(headR * 0.13, headR * 0.13, stemLen, 10);
  stem.translate(0, stemLen / 2, 0);
  const retainer = new THREE.CylinderGeometry(headR * 0.42, headR * 0.42, headR * 0.16, 16);
  retainer.translate(0, stemLen - headR * 0.1, 0);
  return merge([head, stem, retainer]);
}

/** Spark plug standing on +Y: ceramic body, hex, terminal. */
export function sparkPlugParts(bore: number) {
  const r = bore * 0.05;
  const body = new THREE.CylinderGeometry(r * 0.85, r, bore * 0.32, 16);
  body.translate(0, bore * 0.16, 0);
  const tip = new THREE.CylinderGeometry(r * 0.35, r * 0.35, bore * 0.06, 10);
  tip.translate(0, bore * 0.35, 0);
  const hex = new THREE.CylinderGeometry(r * 1.35, r * 1.35, bore * 0.07, 6);
  hex.translate(0, bore * 0.02, 0);
  return { ceramic: merge([body, tip]), hex };
}

/** Flywheel with ring-gear teeth, in the YZ plane, thickness along X. */
export function flywheelGeometry(radius: number, thickness: number): THREE.BufferGeometry {
  const disc = xCylinder(radius * 0.94, thickness, 72);
  const hub = xCylinder(radius * 0.3, thickness * 1.6, 32);
  const teeth: THREE.BufferGeometry[] = [];
  const count = 96;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const t = new THREE.BoxGeometry(thickness * 0.75, radius * 0.08, ((Math.PI * 2 * radius) / count) * 0.55);
    t.translate(0, radius * 0.96, 0);
    t.rotateX(a);
    teeth.push(t);
  }
  return merge([disc, hub, ...teeth]);
}

/** Front pulley: grooved wheel. */
export function pulleyGeometry(radius: number, width: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [xCylinder(radius, width * 0.25, 48)];
  for (let k = 0; k < 4; k++) {
    const ring = xCylinder(radius * 0.93, width * 0.16, 48);
    ring.translate(-width * 0.12 - k * width * 0.2, 0, 0);
    parts.push(ring);
    const rib = xCylinder(radius, width * 0.04, 48);
    rib.translate(-width * 0.22 - k * width * 0.2, 0, 0);
    parts.push(rib);
  }
  parts.push(xCylinder(radius * 0.35, width * 1.1, 24));
  return merge(parts);
}
