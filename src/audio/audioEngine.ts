// Web Audio graph: engine voice → level → analyser → speakers.
// Uses an AudioWorklet when the page is allowed to load one, otherwise runs the same
// voice in a ScriptProcessor on the main thread.

import type { EngineSpec } from '../engines/catalog.ts';
import { EngineDsp, type VoiceParams } from './dsp.ts';
import workletUrl from './engine.worklet.ts?worker&url';

export class AudioEngine {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  mode: 'worklet' | 'script' | 'off' = 'off';
  private level: GainNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private script: ScriptProcessorNode | null = null;
  private dsp: EngineDsp | null = null;
  private volume = 0.8;

  async start(spec: EngineSpec) {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();
    const level = ctx.createGain();
    level.gain.value = this.volume;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 8192;
    analyser.smoothingTimeConstant = 0.55;
    analyser.minDecibels = -100;
    analyser.maxDecibels = -15;
    level.connect(analyser);
    analyser.connect(ctx.destination);
    this.level = level;
    this.analyser = analyser;

    try {
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'engine-voice', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      node.connect(level);
      this.worklet = node;
      this.mode = 'worklet';
    } catch (err) {
      console.info('AudioWorklet unavailable, using ScriptProcessor', err);
      const dsp = new EngineDsp(spec, ctx.sampleRate);
      const sp = ctx.createScriptProcessor(1024, 1, 2);
      sp.onaudioprocess = (e) => {
        const l = e.outputBuffer.getChannelData(0);
        const r = e.outputBuffer.getChannelData(1);
        dsp.process(l, r, l.length);
      };
      sp.connect(level);
      this.dsp = dsp;
      this.script = sp;
      this.mode = 'script';
    }
    this.setEngine(spec);
  }

  setEngine(spec: EngineSpec) {
    this.worklet?.port.postMessage({ type: 'engine', id: spec.id });
    this.dsp?.setEngine(spec);
  }

  setParams(p: VoiceParams) {
    if (this.worklet) this.worklet.port.postMessage({ type: 'params', p });
    else this.dsp?.set(p);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.level && this.ctx) this.level.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  suspend() {
    void this.ctx?.suspend();
  }

  resume() {
    void this.ctx?.resume();
  }

  get running() {
    return this.ctx?.state === 'running';
  }

  dispose() {
    this.script?.disconnect();
    this.worklet?.disconnect();
    void this.ctx?.close();
  }
}
