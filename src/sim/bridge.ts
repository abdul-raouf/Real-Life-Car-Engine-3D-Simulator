import type { VoiceParams } from '../audio/dsp.ts';
import type { EngineSim } from './engineSim.ts';

/** What the voice needs to know about the engine right now. */
export function voiceParamsFromSim(sim: EngineSim, master: number): VoiceParams {
  const overrun = sim.state === 'running' && sim.throttle < 0.05 && sim.rpm > sim.spec.idleRpm * 2.5;
  return {
    rpm: sim.rpm,
    load: sim.load,
    throttle: sim.throttle,
    cut: sim.cut,
    starter: sim.starter,
    crackle: sim.limiterCut ? 1 : overrun ? 0.35 : sim.ecuCut ? 0.15 : 0,
    master,
  };
}
