import { ENGINE_BY_ID, type EngineId } from './engines/catalog.ts';
import { makeMaterials } from './scene/materials.ts';
import { EngineRig } from './scene/rig/rig.ts';
import { Stage } from './scene/stage.ts';

const stage = new Stage(document.getElementById('stage')!);
stage.setTheme({ background: '#111318', floor: '#16181d' });
const mats = makeMaterials();
let rig: EngineRig | null = null;
let cycle = 0;

function show(id: EngineId) {
  rig?.dispose();
  rig = new EngineRig(ENGINE_BY_ID[id], mats);
  stage.scene.add(rig.root);
  stage.frame(rig.center, rig.radius, true);
}
show((location.hash.slice(1) as EngineId) || 'v8');
(window as unknown as { __show: typeof show; __cycle: (c: number) => void }).__show = show;
(window as unknown as { __cycle: (c: number) => void }).__cycle = (c: number) => (cycle = c);

let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  rig?.update({ cycle, rpm: 3000, load: 0.6, throttle: 0.4, cut: false, dt, heat: 0.6, pulses: true, shake: 1 });
  stage.render(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
