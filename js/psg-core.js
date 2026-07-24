/*
 * psg-core.js — AY-3-8910 / YM2149 sound-chip synthesis core.
 *
 * ⚑ This is a CLASSIC script (no import/export) on purpose: the exact same file
 *   runs in THREE contexts — the browser window, the AudioWorkletGlobalScope,
 *   and Node (for tools/verify-core.mjs). See design/build-plan.md §2.
 *   It exposes `PsgCore` on globalThis, and module.exports for Node.
 *
 * Behaviour is faithful to the openMSX reference implementation
 * (src/sound/AY8910.cc); see reference/psg-registers.md §11 for the trace.
 * The model here is a straightforward per-native-step simulator rather than
 * openMSX's event-scheduling optimisation — clearer, and plenty fast for a
 * teaching tool.
 */

(function () {
  'use strict';

  // --- Volume tables (exact openMSX values) -------------------------------
  // YM2149: 32 levels, 1.5 dB/step (factor 2^-0.25 per step).
  // AY-3-8910: 16 levels, 3 dB/step — every step duplicated from the 32-table.
  const YM2149_ENV = (() => {
    const t = new Float64Array(32);
    let out = 1.0;
    const factor = Math.pow(0.5, 0.25); // ≈ 0.84089642, i.e. -1.5 dB
    for (let i = 31; i > 0; i--) { t[i] = out; out *= factor; }
    t[0] = 0.0;
    return t;
  })();
  // 16-level fixed-amplitude / AY envelope table: VOL16[i] = YM2149_ENV[2i+1].
  const VOL16 = (() => {
    const t = new Float64Array(16);
    t[0] = 0.0;
    for (let i = 1; i < 16; i++) t[i] = YM2149_ENV[2 * i + 1];
    return t;
  })();

  const DEFAULT_CLOCK = 1789772.5; // MSX PSG clock = 3.579545 MHz / 2

  class PsgCore {
    /**
     * @param {number} clockHz    PSG chip clock (default: MSX 1.7897725 MHz)
     * @param {number} sampleRate audio sample rate
     * @param {boolean} isAY8910  true = AY-3-8910 (16 env levels),
     *                            false = YM2149 (32 env levels)
     */
    constructor(clockHz = DEFAULT_CLOCK, sampleRate = 44100, isAY8910 = true) {
      this.sampleRate = sampleRate;
      this.isAY8910 = isAY8910;
      // Envelope resolution: AY-3-8910 has 16 levels, YM2149 has 32 (finer
      // fades). The generator runs `envMax+1` steps per ramp; each step lasts
      // `envScale·EP` native ticks, so the total ramp time is the same either
      // way (32·EP·16 = 16·EP·32). Fixed amplitude (R8 bits 0–3) stays 4-bit
      // (VOL16) on both chips — only the envelope gains resolution.
      this.envMax = isAY8910 ? 15 : 31;
      this.envMask = isAY8910 ? 0x0f : 0x1f;
      this.envTable = isAY8910 ? VOL16 : YM2149_ENV;
      this.envScale = isAY8910 ? 32 : 16;
      this.regs = new Uint8Array(16);
      this.setClock(clockHz);
      this.reset();
    }

    setClock(clockHz) {
      this.clock = clockHz;
      // Tone/noise counters step at clock/8; a full square wave is 2*TP steps,
      // giving the datasheet's fT = clock/(16*TP).
      this.nativeRate = clockHz / 8;
      this.cyclesPerSample = this.nativeRate / this.sampleRate;
    }

    reset() {
      // Generators
      this.toneCount = new Int32Array(3);
      this.toneOut = new Uint8Array(3);      // 0/1 square state per channel
      this.tonePeriod = new Int32Array([1, 1, 1]);
      this.noiseCount = 0;
      this.noisePeriod = 2;                   // = 2 * max(1, NP)
      this.lfsr = 1;                          // 17-bit shift register, seed 1
      // Envelope
      this.envCount = 0;
      this.envPeriodNative = this.envScale;   // native steps per envelope step
      this.envStep = this.envMax;             // counts envMax -> 0
      this.envAttack = 0;                     // 0 or 15 (XOR mask)
      this.envHold = false;
      this.envAlternate = false;
      this.envHolding = false;
      // Amplitude
      this.vol = new Float64Array(3);         // fixed-level amplitude per channel
      this.envChan = [false, false, false];   // channel follows envelope?
      // Fractional sample accumulator
      this.acc = 0;
      this.regs.fill(0);
      // Re-derive from zeroed registers
      for (let r = 0; r < 16; r++) this.writeReg(r, 0);
      this.acc = 0;
    }

    // --- Register access ----------------------------------------------------
    writeReg(n, value) {
      n &= 15; value &= 0xff;
      this.regs[n] = value;
      switch (n) {
        case 0: case 1: this._setTonePeriod(0); break;
        case 2: case 3: this._setTonePeriod(1); break;
        case 4: case 5: this._setTonePeriod(2); break;
        case 6: // noise period; 0 behaves like 1 (verified turboR)
          this.noisePeriod = 2 * Math.max(1, value & 0x1f);
          break;
        case 7: break; // mixer read live in the sample loop
        case 8: case 9: case 10: this._setAmplitude(n - 8, value); break;
        case 11: case 12: this._setEnvPeriod(); break;
        case 13: this._setEnvShape(value); break;
        // 14, 15: I/O ports — no effect on sound
      }
    }

    readReg(n) {
      n &= 15;
      const v = this.regs[n];
      if (!this.isAY8910) return v;
      // AY-3-8910 read-back masks: unused bits read 0
      const MASK = [0xff, 0x0f, 0xff, 0x0f, 0xff, 0x0f, 0x1f, 0xff,
                    0x1f, 0x1f, 0x1f, 0xff, 0xff, 0x0f, 0xff, 0xff];
      return v & MASK[n];
    }

    _setTonePeriod(ch) {
      const fine = this.regs[ch * 2];
      const coarse = this.regs[ch * 2 + 1] & 0x0f;
      // period = max(1, value): 0 behaves like 1 for tone.
      this.tonePeriod[ch] = Math.max(1, (coarse << 8) | fine);
    }

    _setEnvPeriod() {
      const ep = (this.regs[12] << 8) | this.regs[11];
      // Envelope step occurs every 256*EP master clocks. In native (clock/8)
      // steps that is envScale*EP (32 on AY, 16 on YM2149 with its 2× step
      // count). Exception: EP=0 is HALF of EP=1 (not equal), unlike tone/noise.
      this.envPeriodNative = ep === 0 ? this.envScale / 2 : this.envScale * ep;
    }

    _setAmplitude(ch, value) {
      this.envChan[ch] = (value & 0x10) !== 0;
      this.vol[ch] = VOL16[value & 0x0f];
    }

    _setEnvShape(shape) {
      // Decode Continue/Attack/Alternate/Hold (reference §7).
      this.envAttack = (shape & 0x04) ? this.envMask : 0x00;
      if ((shape & 0x08) === 0) {
        // Continue=0 collapses to a single ramp that holds.
        this.envHold = true;
        this.envAlternate = this.envAttack !== 0;
      } else {
        this.envHold = (shape & 0x01) !== 0;
        this.envAlternate = (shape & 0x02) !== 0;
      }
      this.envStep = this.envMax;
      this.envHolding = false;
      this.envCount = 0;
    }

    // --- One native step (clock/8) -----------------------------------------
    _tick() {
      // Tone generators
      const tc = this.toneCount, tp = this.tonePeriod, to = this.toneOut;
      for (let i = 0; i < 3; i++) {
        if (++tc[i] >= tp[i]) { tc[i] = 0; to[i] ^= 1; }
      }
      // Noise generator
      if (++this.noiseCount >= this.noisePeriod) {
        this.noiseCount = 0;
        // 17-bit LFSR, output bit0, feedback bit0 XOR bit3
        const r = this.lfsr;
        this.lfsr = (r >>> 1) ^ ((r & 1) << 13) ^ ((r & 1) << 16);
      }
      // Envelope generator
      if (!this.envHolding && ++this.envCount >= this.envPeriodNative) {
        this.envCount = 0;
        this._envStep();
      }
    }

    _envStep() {
      if (this.envHolding) return;
      if (--this.envStep < 0) {
        if (this.envHold) {
          if (this.envAlternate) this.envAttack ^= this.envMask;
          this.envHolding = true;
          this.envStep = 0;
        } else {
          if (this.envAlternate) this.envAttack ^= this.envMask;
          this.envStep = this.envMax;
        }
      }
    }

    // Envelope amplitude level (0..15 on AY, 0..31 on YM2149) for the step.
    _envLevel() { return (this.envStep ^ this.envAttack) & this.envMask; }

    // Mixed float output of all three channels at the current state.
    _output() {
      const en = this.regs[7];
      const noiseBit = this.lfsr & 1;
      let sum = 0;
      for (let i = 0; i < 3; i++) {
        const toneDis = (en >> i) & 1;        // 1 = tone disabled
        const noiseDis = (en >> (i + 3)) & 1; // 1 = noise disabled
        // (toneOut | toneDis) & (noiseBit | noiseDis) — both disabled => 1
        const bit = (this.toneOut[i] | toneDis) & (noiseBit | noiseDis);
        if (bit) {
          const level = this.envChan[i] ? this._envLevel() : -1;
          sum += level >= 0 ? this.envTable[level] : this.vol[i];
        }
      }
      return sum;
    }

    // --- Audio: fill a mono buffer with `frames` samples --------------------
    process(out, frames, gain = 0.22) {
      for (let n = 0; n < frames; n++) {
        this.acc += this.cyclesPerSample;
        let steps = this.acc | 0;
        this.acc -= steps;
        if (steps <= 0) {
          out[n] = this._output() * gain;
          continue;
        }
        // Average over the native steps within this sample (cheap anti-alias).
        let s = 0;
        for (let k = 0; k < steps; k++) { this._tick(); s += this._output(); }
        out[n] = (s / steps) * gain;
      }
    }

    // --- Visualisation: render a window without touching the audio path -----
    // Returns cached typed arrays (length `frames`): mixed float, per-channel
    // float, and the raw tone/noise bits — for the scope's "show internals".
    renderViz(frames, gain = 0.9) {
      if (!this._viz || this._viz.mixed.length !== frames) {
        this._viz = {
          mixed: new Float32Array(frames),
          ch: [new Float32Array(frames), new Float32Array(frames), new Float32Array(frames)],
          tone: [new Int8Array(frames), new Int8Array(frames), new Int8Array(frames)],
          noise: new Int8Array(frames),
        };
      }
      const v = this._viz;
      const en = this.regs[7];
      for (let n = 0; n < frames; n++) {
        this.acc += this.cyclesPerSample;
        let steps = this.acc | 0;
        this.acc -= steps;
        for (let k = 0; k < steps; k++) this._tick();
        const noiseBit = this.lfsr & 1;
        let sum = 0;
        for (let i = 0; i < 3; i++) {
          const toneDis = (en >> i) & 1;
          const noiseDis = (en >> (i + 3)) & 1;
          const bit = (this.toneOut[i] | toneDis) & (noiseBit | noiseDis);
          const level = this.envChan[i] ? this._envLevel() : -1;
          const amp = level >= 0 ? this.envTable[level] : this.vol[i];
          const cv = bit ? amp : 0;
          v.ch[i][n] = cv * gain;
          v.tone[i][n] = this.toneOut[i];
          sum += cv;
        }
        v.mixed[n] = sum * gain * 0.34;
        v.noise[n] = noiseBit;
      }
      return v;
    }

    // Instantaneous internal state, for meters / diagram highlighting.
    snapshot() {
      const en = this.regs[7];
      const noiseBit = this.lfsr & 1;
      const chans = [];
      for (let i = 0; i < 3; i++) {
        const level = this.envChan[i] ? this._envLevel() : (this.regs[8 + i] & 0x0f);
        chans.push({
          toneOut: this.toneOut[i],
          toneDisabled: !!((en >> i) & 1),
          noiseDisabled: !!((en >> (i + 3)) & 1),
          followsEnv: this.envChan[i],
          level,
        });
      }
      return { noiseBit, envLevel: this._envLevel(), envHolding: this.envHolding, chans };
    }

    // Expose tables for UI (read-only).
    static get VOLUME_TABLE() { return VOL16; }
    static get YM2149_ENV() { return YM2149_ENV; }
    static get DEFAULT_CLOCK() { return DEFAULT_CLOCK; }
  }

  if (typeof globalThis !== 'undefined') globalThis.PsgCore = PsgCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = PsgCore;
})();
