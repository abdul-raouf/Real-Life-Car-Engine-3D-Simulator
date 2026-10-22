// Picks the right rig for an engine: pistons and crank, or rotors and eccentric shaft.

import type { EngineSpec } from '../../engines/catalog.ts';
import type { Materials } from '../materials.ts';
import type { Rig } from './common.ts';
import { PistonRig } from './pistonRig.ts';
import { RotaryRig } from './rotaryRig.ts';

export type { Rig, RigFrame } from './common.ts';

export function createRig(spec: EngineSpec, mats: Materials): Rig {
  return spec.kind === 'rotary' ? new RotaryRig(spec, mats) : new PistonRig(spec, mats);
}
