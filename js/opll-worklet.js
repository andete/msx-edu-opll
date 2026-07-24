/*
 * opll-worklet.js — the AudioWorkletProcessor that plays OPLL audio.
 *
 * Loaded into the AudioWorkletGlobalScope AFTER opll-core.js (which defines
 * globalThis.OpllCore). Classic script — no imports. See design/build-plan.md §3.
 *
 * The main thread owns the register file; it posts {reg,value} messages here and
 * this processor applies them to its OpllCore instance. Output is mono, mirrored
 * to both channels of a stereo bus.
 */
class OPLLProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opt = (options && options.processorOptions) || {};
    const Core = globalThis.OpllCore;
    this.core = new Core(opt.clock || 3579545, sampleRate);
    if (opt.regs) for (let a = 0; a < 0x40; a++) this.core.writeReg(a, opt.regs[a] || 0);
    this.playing = false;
    this.mono = new Float32Array(128);

    this.port.onmessage = (e) => {
      const m = e.data;
      switch (m.type) {
        case 'reg': this.core.writeReg(m.addr, m.value); break;
        case 'reset': this.core.reset(); break;
        case 'play': this.playing = true; break;
        case 'stop': this.playing = false; break;
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const ch0 = out[0];
    const frames = ch0.length;
    if (this.playing) {
      if (this.mono.length !== frames) this.mono = new Float32Array(frames);
      this.core.process(this.mono, frames);
      ch0.set(this.mono);
    } else {
      ch0.fill(0);
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    return true; // keep processor alive
  }
}

registerProcessor('opll', OPLLProcessor);
