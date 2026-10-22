// Plumbing every engine rig shares: resource tracking, glass castings, the stand,
// exhaust pulse sprites, header heat and the start-up placement on the stand.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { EngineSpec } from '../../engines/catalog.ts';
import { heatColor, type Materials } from '../materials.ts';

export interface RigFrame {
  /** Visual cycle angle (deg), already slowed down for the camera. */
  cycle: number;
  rpm: number;
  load: number;
  throttle: number;
  cut: boolean;
  dt: number;
  /** Header temperature 0..1. */
  heat: number;
  pulses: boolean;
  shake: number;
}

export interface Rig {
  readonly root: THREE.Group;
  readonly spec: EngineSpec;
  readonly radius: number;
  readonly center: THREE.Vector3;
  /** The direction the camera prefers to look from (engine centre → camera). */
  readonly viewDir: THREE.Vector3;
  update(f: RigFrame): void;
  setXray(on: boolean): void;
  dispose(): void;
}

interface Pulse {
  sprite: THREE.Sprite;
  curve: THREE.Curve<THREE.Vector3> | null;
  t: number;
  life: number;
}

/** True if `angle` was passed while the cycle moved from prev to cur (all mod `len`). */
export function crossed(prev: number, cur: number, angle: number): boolean {
  return prev <= cur ? angle > prev && angle <= cur : angle > prev || angle <= cur;
}

export abstract class RigBase implements Rig {
  readonly root = new THREE.Group();
  readonly engine = new THREE.Group();
  radius = 1;
  readonly center = new THREE.Vector3();
  readonly viewDir = new THREE.Vector3(-2.1, 1.2, 2.4).normalize();
  protected baseY = 0;
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly ownMaterials: THREE.Material[] = [];
  private readonly glassMeshes: THREE.Mesh[] = [];
  private readonly glassEdges: THREE.LineSegments[] = [];
  private readonly pulses: Pulse[] = [];
  private readonly heatTmp = new THREE.Color();

  constructor(
    readonly spec: EngineSpec,
    protected readonly mats: Materials,
  ) {
    this.root.add(this.engine);
  }

  abstract update(f: RigFrame): void;

  protected geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.add(g);
    return g;
  }

  protected own<T extends THREE.Material>(m: T): T {
    this.ownMaterials.push(m);
    return m;
  }

  protected mesh(g: THREE.BufferGeometry, m: THREE.Material, shadows = true) {
    const mesh = new THREE.Mesh(this.geo(g), m);
    mesh.castShadow = shadows;
    mesh.receiveShadow = shadows;
    return mesh;
  }

  protected glassBox(w: number, h: number, d: number, radius: number) {
    return this.geo(new RoundedBoxGeometry(w, h, d, 3, radius));
  }

  /** A see-through casting with outlined edges. In solid view it turns to cast aluminium. */
  protected addGlass(g: THREE.BufferGeometry, pos: THREE.Vector3, rotX = 0, edgeAngle = 25) {
    const mesh = new THREE.Mesh(this.geo(g), this.mats.glass);
    mesh.position.copy(pos);
    mesh.rotation.x = rotX;
    mesh.renderOrder = 3;
    this.engine.add(mesh);
    this.glassMeshes.push(mesh);
    const edges = new THREE.LineSegments(this.geo(new THREE.EdgesGeometry(g, edgeAngle)), this.mats.glassEdge);
    edges.position.copy(pos);
    edges.rotation.x = rotX;
    edges.renderOrder = 3;
    this.engine.add(edges);
    this.glassEdges.push(edges);
    return mesh;
  }

  /** A blue-white glow used for spark flashes. */
  protected sparkSprite(scale: number) {
    const s = new THREE.Sprite(
      this.own(
        new THREE.SpriteMaterial({
          map: this.mats.glowTexture,
          color: new THREE.Color(0.75, 0.85, 1).multiplyScalar(6),
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          opacity: 0,
        }),
      ),
    );
    s.scale.setScalar(scale);
    s.renderOrder = 5;
    s.visible = false;
    return s;
  }

  protected makePulses(scale: number, count = 48) {
    for (let k = 0; k < count; k++) {
      const sprite = new THREE.Sprite(
        this.own(
          new THREE.SpriteMaterial({
            map: this.mats.glowTexture,
            color: new THREE.Color(1, 0.45, 0.12).multiplyScalar(3.2),
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
          }),
        ),
      );
      sprite.visible = false;
      sprite.scale.setScalar(scale);
      sprite.renderOrder = 6;
      this.engine.add(sprite);
      this.pulses.push({ sprite, curve: null, t: 0, life: 0 });
    }
  }

  /** Send a glowing exhaust pulse down a header. */
  protected spawnPulse(curve: THREE.Curve<THREE.Vector3>, strength: number) {
    if (!this.pulses.length) return;
    const p = this.pulses.find((q) => !q.curve) ?? this.pulses.reduce((a, b) => (a.t > b.t ? a : b));
    p.curve = curve;
    p.t = 0;
    p.life = strength;
    p.sprite.visible = true;
  }

  /** Move pulses along their headers and set the header glow. */
  protected updateExhaust(dt: number, heat: number) {
    for (const p of this.pulses) {
      if (!p.curve) continue;
      p.t += dt / 0.45;
      if (p.t >= 1) {
        p.curve = null;
        p.sprite.visible = false;
        continue;
      }
      p.curve.getPointAt(Math.min(1, p.t), p.sprite.position);
      (p.sprite.material as THREE.SpriteMaterial).opacity = p.life * (1 - p.t) * (p.t < 0.08 ? p.t / 0.08 : 1);
    }
    heatColor(heat, this.heatTmp);
    this.mats.header.emissive.copy(this.heatTmp);
  }

  /** Bounds of the engine's hardware, ignoring light effects. */
  protected solidBounds(): THREE.Box3 {
    this.engine.updateMatrixWorld(true);
    const box = new THREE.Box3();
    this.engine.traverse((o) => {
      if (o.userData.fx || !(o instanceof THREE.Mesh)) return;
      box.expandByObject(o, false);
    });
    return box;
  }

  /**
   * Call once the hardware is built: lifts the engine so its lowest part sits a hand's
   * width off the floor, builds the stand up to `cradleY` (engine space), and measures
   * the engine for camera framing.
   */
  protected finish(cradleY: number) {
    const box = this.solidBounds();
    const lift = 0.14 - box.min.y;
    this.engine.position.y = lift;
    this.baseY = lift;
    this.buildStand(box, cradleY + lift);
    const sphere = this.solidBounds().getBoundingSphere(new THREE.Sphere());
    this.radius = sphere.radius;
    this.center.copy(sphere.center);
  }

  private buildStand(box: THREE.Box3, cradleY: number) {
    const m = this.mats;
    const x0 = box.min.x + 0.08;
    const x1 = box.max.x - 0.12;
    const z = Math.min(0.2, (box.max.z - box.min.z) * 0.32);
    for (const sz of [-z, z]) {
      const rail = this.mesh(new RoundedBoxGeometry(x1 - x0 + 0.3, 0.05, 0.07, 2, 0.01), m.stand);
      rail.position.set((x0 + x1) / 2, 0.025, sz);
      this.root.add(rail);
    }
    for (const x of [x0 + 0.05, x1 - 0.05]) {
      const cross = this.mesh(new RoundedBoxGeometry(0.07, 0.05, 2 * z + 0.07, 2, 0.01), m.stand);
      cross.position.set(x, 0.025, 0);
      this.root.add(cross);
      const postH = Math.max(0.01, cradleY - 0.025 - 0.05);
      const post = this.mesh(new THREE.CylinderGeometry(0.022, 0.026, postH, 16), m.stand);
      post.position.set(x, 0.05 + postH / 2, 0);
      this.root.add(post);
      const pad = this.mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.025, 20), m.rubber);
      pad.position.set(x, cradleY - 0.0125, 0);
      this.root.add(pad);
    }
  }

  setXray(on: boolean) {
    for (const g of this.glassMeshes) g.material = on ? this.mats.glass : this.mats.casting;
    for (const e of this.glassEdges) e.visible = on;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of this.ownMaterials) m.dispose();
    this.root.removeFromParent();
  }
}
