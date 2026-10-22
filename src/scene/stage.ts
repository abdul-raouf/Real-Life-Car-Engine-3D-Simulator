// The studio: renderer, camera, lights, floor, reflections and bloom.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export interface StageTheme {
  background: string;
  floor: string;
}

/**
 * A dark photo studio for reflections: near-black walls, one big overhead softbox,
 * two tall strip lights and a warm kicker. Chrome then shows crisp highlights on black.
 */
function studioEnvironment(): THREE.Scene {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(10, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0x0c0d10, side: THREE.BackSide }),
  );
  env.add(room);
  const panel = (w: number, h: number, color: number, intensity: number, pos: [number, number, number]) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(6, 3.5, 0xffffff, 1.5, [0, 8, 1]);
  panel(1.1, 6, 0xeef3ff, 3.2, [-7, 2, 3]);
  panel(1.1, 6, 0xffffff, 2.4, [6, 2, 5]);
  panel(4, 1.2, 0xffc48a, 1.3, [3, 1.2, -7]);
  panel(4, 1, 0x9fbfff, 1.2, [-4, 0.8, -7]);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshBasicMaterial({ color: 0x1c1d21 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2;
  env.add(floor);
  return env;
}

export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private floor: THREE.Mesh;
  private fog: THREE.Fog;
  private camGoal: { target: THREE.Vector3; distance: number } | null = null;
  private lastInteraction = -Infinity;
  autoRotate = true;

  constructor(private container: HTMLElement) {
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.02, 60);
    this.camera.position.set(-2.1, 1.2, 2.4);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const env = studioEnvironment();
    this.scene.environment = pmrem.fromScene(env, 0.02).texture;
    this.scene.environmentIntensity = 1;
    env.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    pmrem.dispose();

    this.fog = new THREE.Fog(0x101217, 4.5, 11);
    this.scene.fog = this.fog;

    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a2420, 0.35);
    this.scene.add(hemi);

    // Key light: a soft overhead spot that leaves a pool of light on a dark floor.
    const key = new THREE.SpotLight(0xfff6ee, 30, 14, 0.4, 0.9, 1.5);
    key.position.set(-1.8, 4.6, 2.2);
    key.target.position.set(0, 0.35, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 10;
    key.shadow.bias = -0.0003;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 6;
    this.scene.add(key, key.target);

    const rimWarm = new THREE.SpotLight(0xffb067, 18, 9, 0.5, 0.7, 1.4);
    rimWarm.position.set(2.8, 1.8, -2.6);
    this.scene.add(rimWarm);
    const rimCool = new THREE.SpotLight(0x8fb6ff, 14, 9, 0.5, 0.7, 1.4);
    rimCool.position.set(-3, 1.4, -2.2);
    this.scene.add(rimCool);

    this.floor = new THREE.Mesh(
      new THREE.CircleGeometry(14, 96),
      new THREE.MeshStandardMaterial({ color: 0x1a1d23, roughness: 0.78, metalness: 0.05 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);

    const controls = new OrbitControls(this.camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 0.6;
    controls.maxDistance = 6;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.autoRotateSpeed = 0.45;
    controls.target.set(0, 0.45, 0);
    controls.addEventListener('start', () => {
      this.lastInteraction = performance.now();
      this.camGoal = null;
    });
    controls.addEventListener('end', () => (this.lastInteraction = performance.now()));
    this.controls = controls;

    const size = new THREE.Vector2(1, 1);
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(size, 0.38, 0.35, 1.55);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
  }

  setTheme(t: StageTheme) {
    const bg = new THREE.Color(t.background);
    this.scene.background = bg;
    this.fog.color.copy(bg);
    (this.floor.material as THREE.MeshStandardMaterial).color.set(t.floor);
  }

  /** Glide the camera to frame an object of this radius around this point. */
  frame(center: THREE.Vector3, radius: number, immediate = false) {
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = Math.max(0.6, this.camera.aspect);
    const fit = radius / Math.sin(Math.min(fov, fov * aspect) / 2);
    const distance = fit * (aspect < 1 ? 1.05 : 0.92);
    const target = center.clone();
    target.y -= radius * (aspect < 1 ? 0.22 : 0.08);
    if (immediate) {
      this.controls.target.copy(target);
      const dir = this.camera.position.clone().sub(this.controls.target).normalize();
      this.camera.position.copy(target).addScaledVector(dir, distance);
      this.camGoal = null;
    } else {
      this.camGoal = { target, distance };
    }
  }

  private resize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }

  render(dt: number) {
    if (this.camGoal) {
      const k = 1 - Math.exp(-dt * 3);
      this.controls.target.lerp(this.camGoal.target, k);
      const dir = this.camera.position.clone().sub(this.controls.target);
      const d = dir.length();
      const nd = d + (this.camGoal.distance - d) * k;
      this.camera.position.copy(this.controls.target).addScaledVector(dir.normalize(), nd);
      if (Math.abs(nd - this.camGoal.distance) < 0.002 && this.controls.target.distanceTo(this.camGoal.target) < 0.002) {
        this.camGoal = null;
      }
    }
    this.controls.autoRotate = this.autoRotate && performance.now() - this.lastInteraction > 7000;
    this.controls.update(dt);
    this.composer.render(dt);
  }
}
