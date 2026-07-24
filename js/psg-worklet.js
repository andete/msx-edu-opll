/*
 * psg-worklet.js — the AudioWorkletProcessor that plays PSG audio.
 *
 * Loaded into the AudioWorkletGlobalScope AFTER psg-core.js (which defines
 * globalThis.PsgCore). Classic script — no imports. See design/build-plan.md §3.
 *
 * The main thread owns register state; it posts {reg,value} messages here and
 * this processor applies them to its PsgCore instance.
 */
class PSGProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opt = (options && options.processorOptions) || {};
    const Core = globalThis.PsgCore;
    this.core = new Core(opt.clock || 1789772.5, sampleRate, opt.isAY8910 !== false);
    if (opt.regs) for (let r = 0; r < 16; r++) this.core.writeReg(r, opt.regs[r] || 0);
    // Output level relative to the SCC. The standalone PSG site leaves this at
    // the core's 0.22 default; alongside the SCC the SCC Playground passes the
    // openMSX-matched 0.15 (see audio.js). See PsgCore.process(out, frames, gain).
    this.gain = (typeof opt.gain === 'number') ? opt.gain : 0.22;
    this.playing = false;

    this.port.onmessage = (e) => {
      const m = e.data;
      switch (m.type) {
        case 'reg': this.core.writeReg(m.reg, m.value); break;
        case 'clock': this.core.setClock(m.hz); break;
        case 'chip': this.rebuild(m.isAY8910); break;
        case 'reset': this.core.reset(); break;
        case 'play': this.playing = true; break;
        case 'stop': this.playing = false; break;
      }
    };
  }

  rebuild(isAY8910) {
    const Core = globalThis.PsgCore;
    const regs = Array.from(this.core.regs);
    const next = new Core(this.core.clock, sampleRate, isAY8910);
    for (let r = 0; r < 16; r++) next.writeReg(r, regs[r]);
    this.core = next;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const ch0 = out[0];
    const frames = ch0.length;
    if (this.playing) {
      this.core.process(ch0, frames, this.gain);
    } else {
      ch0.fill(0);
    }
    // mirror to any additional output channels (stereo → mono)
    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    return true; // keep processor alive
  }
}

registerProcessor('psg', PSGProcessor);
