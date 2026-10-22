import * as THREE from 'three';

export interface Materials {
  forged: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  piston: THREE.MeshStandardMaterial;
  rod: THREE.MeshStandardMaterial;
  valve: THREE.MeshStandardMaterial;
  header: THREE.MeshStandardMaterial;
  intake: THREE.MeshStandardMaterial;
  anodized: THREE.MeshStandardMaterial;
  ceramic: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  stand: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  glassEdge: THREE.LineBasicMaterial;
  casting: THREE.MeshStandardMaterial;
  mark: THREE.MeshStandardMaterial;
  glowTexture: THREE.Texture;
}

function radialTexture(): THREE.Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function makeMaterials(): Materials {
  const metal = (color: number, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
    new THREE.MeshStandardMaterial({ color, metalness: 1, roughness, ...extra });

  return {
    forged: metal(0x8c939b, 0.34),
    steel: metal(0xa9b0b7, 0.26),
    piston: metal(0xd7dbe0, 0.2),
    rod: metal(0x7d838c, 0.3),
    valve: metal(0xc9cdd2, 0.22),
    header: metal(0xb3a999, 0.36, { emissive: 0x000000 }),
    intake: metal(0xc0c4c8, 0.3),
    // Heat-tinted titanium gold, the accent of the whole site.
    anodized: metal(0xb98d3f, 0.32),
    ceramic: new THREE.MeshStandardMaterial({ color: 0xefede8, roughness: 0.35, metalness: 0 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x18191c, roughness: 0.85, metalness: 0 }),
    stand: new THREE.MeshStandardMaterial({ color: 0x2b2e34, roughness: 0.55, metalness: 0.7 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xa9c2d8,
      metalness: 0,
      roughness: 0.06,
      transparent: true,
      opacity: 0.065,
      clearcoat: 0.6,
      clearcoatRoughness: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
      envMapIntensity: 0.7,
    }),
    glassEdge: new THREE.LineBasicMaterial({ color: 0xcfe0f0, transparent: true, opacity: 0.28, depthWrite: false }),
    casting: new THREE.MeshStandardMaterial({ color: 0x7f8389, metalness: 0.9, roughness: 0.5 }),
    mark: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0.4 }),
    glowTexture: radialTexture(),
  };
}

/** Header glow colour for a temperature 0..1: dull cherry red, through orange, to straw. */
export function heatColor(heat: number, out: THREE.Color): THREE.Color {
  const h = Math.max(0, Math.min(1, heat));
  const r = Math.min(1, h * 2.2);
  const g = Math.max(0, h - 0.35) * 0.9;
  const b = Math.max(0, h - 0.8) * 0.6;
  return out.setRGB(r, g, b).multiplyScalar(Math.pow(h, 1.8) * 1.25);
}
