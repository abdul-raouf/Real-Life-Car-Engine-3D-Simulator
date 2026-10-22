// AudioWorklet wrapper around the engine voice. Runs on the audio thread.

import { ENGINE_BY_ID, type EngineId } from '../engines/catalog.ts';
import { EngineDsp, type VoiceParams } from './dsp.ts';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

type Message = { type: 'engine'; id: EngineId } | { type: 'params'; p: Partial<VoiceParams> };

class EngineVoiceProcessor extends AudioWorkletProcessor {
  private dsp = new EngineDsp(ENGINE_BY_ID.v8, sampleRate);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<Message>) => {
      const m = e.data;
      if (m.type === 'engine') this.dsp.setEngine(ENGINE_BY_ID[m.id]);
      else this.dsp.set(m.p);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0];
    const l = out[0];
    const r = out[1] ?? out[0];
    this.dsp.process(l, r, l.length);
    return true;
  }
}

registerProcessor('engine-voice', EngineVoiceProcessor);
