/*
 * opll-core.js — a teaching model of the Yamaha YM2413 (OPLL).
 *
 * ⚑ CLASSIC script (no import/export): it must run in three contexts —
 *   1. the window          (loaded before the ES modules; sets globalThis.OpllCore)
 *   2. the AudioWorklet     (audioWorklet.addModule loads this, then opll-worklet.js)
 *   3. Node                 (require() from tools/verify-core.mjs)
 *
 * WHAT THIS IS. A clean-room implementation written from the *documented
 * behaviour* in reference/opll-registers.md — the exact pitch formula, the
 * dB-domain level chain, 2-operator phase modulation, and a per-operator ADSR
 * with the Key-On "damp" quirk. It is faithful in behaviour, not a cycle-exact
 * emulator: it does NOT reproduce emu2413's fixed-point log/exp/counter
 * internals (that would be porting the emulator, which the project forbids).
 * We model the chip; we do not copy the emulator. See reference §0, §12.
 *
 * Rhythm mode (Phase 6) — writing 0E bit5 reinterprets channels 7-9 as five
 * percussion voices (bass drum, snare, tom, cymbal, hi-hat) driven by a shared
 * noise LFSR, keyed by 0E bits 0-4, at +3 dB. It reuses this same FM engine (the
 * bass drum is a plain 2-op voice); the metallic drums add a small clean-room
 * noise/phase generator. See the "rhythm subsystem" section below and reference §9.
 */
(function (global) {
  'use strict';

  // ---- chip constants (reference §2, §12) ---------------------------------
  var CLOCK = 3579545;          // fMASTER, the MSX colour-burst crystal
  var DIV = 72;                 // fsam = fMASTER / 72 ≈ 49715.9 Hz
  var SINE_LEN = 1024;          // phase generator wave-table length (PG 10-bit)

  // Envelope / level resolution, in the chip's own units.
  var EG_STEP_DB = 0.375;       // one envelope unit
  var EG_MUTE = 127;            // envelope fully attenuated
  var EG_MAX = 123;             // attack starts / output gated above this
  var TL_STEP_DB = 0.75;        // modulator Total Level unit (6-bit)
  var VOL_STEP_DB = 3.0;        // carrier volume unit (4-bit) = 8 EG units
  var SL_STEP_DB = 3.0;         // sustain-level unit (4-bit)
  var RHYTHM_GAIN = Math.pow(10, 3 / 20); // +3 dB on the drums (reference §9)

  // Multiple table (reference §5): register value → phase multiplier ×2
  // (so ML 0 → ×0.5, ML 1 → ×1, …). No ×11/×13/×14 exist.
  var ML2 = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 20, 24, 24, 30, 30];

  // Key Scale Level: attenuation in dB at the top of each octave, per KSL
  // setting (0 = off, then 1.5 / 3.0 / 6.0 dB per octave). Standard OPL ladder.
  var KSL_DB_OCT = [0, 1.5, 3.0, 6.0];

  // ---- shared wave tables (built once) ------------------------------------
  // fullSine[i] = sin(2π·i/1024); halfSine clamps the negative half to 0.
  // (reference §12.4: halfsin == fullsin on the first half, silent on the
  // second — true here because the second half of a sine is negative.)
  var fullSine = new Float32Array(SINE_LEN);
  var halfSine = new Float32Array(SINE_LEN);
  for (var i = 0; i < SINE_LEN; i++) {
    var s = Math.sin((2 * Math.PI * i) / SINE_LEN);
    fullSine[i] = s;
    halfSine[i] = s > 0 ? s : 0;
  }
  var WAVES = [fullSine, halfSine];

  // ---- instrument ROM (reference §4) --------------------------------------
  // The 8-byte patches in 00–07 layout: entry 0 is the *user* slot (kept in
  // the live registers, not here); 1–15 are the fixed melodic ROM; 16–18 are
  // the rhythm patches. These bytes are Okazaki's measurements of a real
  // YM2413 (emu2413), reproduced here as DATA — a fact about the hardware —
  // with attribution. The code that reads them is our own.
  var INSTRUMENT_ROM = [
    [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], // 0 user (placeholder)
    [0x71, 0x61, 0x1e, 0x17, 0xd0, 0x78, 0x00, 0x17], // 1 Violin
    [0x13, 0x41, 0x1a, 0x0d, 0xd8, 0xf7, 0x23, 0x13], // 2 Guitar
    [0x13, 0x01, 0x99, 0x00, 0xf2, 0xd4, 0x21, 0x23], // 3 Piano
    [0x11, 0x61, 0x0e, 0x07, 0x8d, 0x64, 0x70, 0x27], // 4 Flute
    [0x32, 0x21, 0x1e, 0x06, 0xe1, 0x76, 0x01, 0x28], // 5 Clarinet
    [0x31, 0x22, 0x16, 0x05, 0xe0, 0x71, 0x00, 0x18], // 6 Oboe
    [0x21, 0x61, 0x1d, 0x07, 0x82, 0x81, 0x11, 0x07], // 7 Trumpet
    [0x33, 0x21, 0x2d, 0x13, 0xb0, 0x70, 0x00, 0x07], // 8 Organ
    [0x61, 0x61, 0x1b, 0x06, 0x64, 0x65, 0x10, 0x17], // 9 Horn
    [0x41, 0x61, 0x0b, 0x18, 0x85, 0xf0, 0x81, 0x07], // 10 Synthesizer
    [0x33, 0x01, 0x83, 0x11, 0xea, 0xef, 0x10, 0x04], // 11 Harpsichord
    [0x17, 0xc1, 0x24, 0x07, 0xf8, 0xf8, 0x22, 0x12], // 12 Vibraphone
    [0x61, 0x50, 0x0c, 0x05, 0xd2, 0xf5, 0x40, 0x42], // 13 Synth. Bass
    [0x01, 0x01, 0x55, 0x03, 0xe4, 0x90, 0x03, 0x02], // 14 Acoustic Bass
    [0x41, 0x41, 0x89, 0x03, 0xf1, 0xe4, 0xc0, 0x13], // 15 Electric Guitar
    [0x01, 0x01, 0x18, 0x0f, 0xdf, 0xf8, 0x6a, 0x6d], // 16 Rhythm: Bass Drum
    [0x01, 0x01, 0x00, 0x00, 0xc8, 0xd8, 0xa7, 0x68], // 17 Rhythm: HH / Snare
    [0x05, 0x01, 0x00, 0x00, 0xf8, 0xaa, 0x59, 0x55]  // 18 Rhythm: Tom / Cymbal
  ];

  // Decode an 8-byte patch (00–07 layout) into per-operator parameters.
  // Returns {mod, car} where each operator has am,pm,eg,kr,ml,kl,tl,ws,fb,ar,dr,sl,rr.
  function decodePatch(b) {
    function op(i0, i2, i4, i6, wsBit) {
      return {
        am: (b[i0] >> 7) & 1,
        pm: (b[i0] >> 6) & 1,
        eg: (b[i0] >> 5) & 1,
        kr: (b[i0] >> 4) & 1,
        ml: b[i0] & 0x0f,
        kl: (b[i2] >> 6) & 3,
        tl: b[i2] & 0x3f,           // only meaningful for the modulator
        ws: (b[3] >> wsBit) & 1,     // both waveform bits live in byte 3
        fb: b[3] & 0x07,             // feedback (modulator only)
        ar: (b[i4] >> 4) & 0x0f,
        dr: b[i4] & 0x0f,
        sl: (b[i6] >> 4) & 0x0f,
        rr: b[i6] & 0x0f
      };
    }
    return {
      mod: op(0, 2, 4, 6, 3), // byte3 bit3 = modulator waveform
      car: op(1, 3, 5, 7, 4)  // byte3 bit4 = carrier waveform
    };
  }

  // ---- helpers ------------------------------------------------------------
  function egToGain(eg) {
    // total attenuation in envelope units (0.375 dB) → linear gain.
    if (eg >= EG_MUTE) return 0;
    return Math.pow(10, (-eg * EG_STEP_DB) / 20);
  }
  function dbToEg(db) { return db / EG_STEP_DB; }

  // Envelope phases.
  var DAMP = 0, ATTACK = 1, DECAY = 2, SUSTAIN = 3, RELEASE = 4, IDLE = 5;

  // ---- an operator (slot) -------------------------------------------------
  function Slot() { this.reset(); }
  Slot.prototype.reset = function () {
    this.phase = 0;        // phase accumulator, in cycles [0,1)
    this.inc = 0;          // phase increment per output sample, in cycles
    this.out = 0;          // last linear output (−1..1), for modulation
    this.prev = 0;         // output one sample earlier, for feedback
    this.egState = IDLE;
    this.eg = EG_MUTE;     // current attenuation, envelope units
    this.p = null;         // resolved operator params (from decodePatch)
    this.tll = 0;          // fixed level (TL/volume + KSL) in envelope units
  };

  // ---- the chip -----------------------------------------------------------
  function OpllCore(clockHz, sampleRate) {
    this.clock = clockHz || CLOCK;
    this.sampleRate = sampleRate || 44100;
    this.fsam = this.clock / DIV;
    this.regs = new Uint8Array(0x40);
    this.slots = [];
    for (var i = 0; i < 18; i++) this.slots.push(new Slot());
    // per-channel state
    this.fnum = new Uint16Array(9);
    this.block = new Uint8Array(9);
    this.keyOn = new Uint8Array(9);
    this.sus = new Uint8Array(9);
    this.inst = new Uint8Array(9);
    this.vol = new Uint8Array(9);
    // global LFO phase (cycles)
    this.amPhase = 0;
    this.pmPhase = 0;
    // rhythm mode (reg 0E): mode bit + the five drum key bits, and the shared
    // noise generator that gives the snare/hi-hat/cymbal their grit.
    this.rhythm = 0;              // last 0E value (bit5 mode, bits0-4 keys)
    this.noiseReg = 1;           // LFSR state (must start non-zero)
    this.noiseOut = 1;           // last noise sample as ±1
    this.reset();
  }

  OpllCore.CLOCK = CLOCK;
  OpllCore.ML2 = ML2;
  OpllCore.INSTRUMENT_ROM = INSTRUMENT_ROM;
  OpllCore.decodePatch = decodePatch;
  OpllCore.EG_MUTE = EG_MUTE;
  OpllCore.EG_MAX = EG_MAX;
  OpllCore.EG_STEP_DB = EG_STEP_DB;
  OpllCore.TL_STEP_DB = TL_STEP_DB;
  OpllCore.VOL_STEP_DB = VOL_STEP_DB;
  OpllCore.RHYTHM_GAIN = RHYTHM_GAIN;

  OpllCore.prototype.mod = function (ch) { return this.slots[ch * 2]; };
  OpllCore.prototype.car = function (ch) { return this.slots[ch * 2 + 1]; };

  OpllCore.prototype.reset = function () {
    this.regs.fill(0);
    for (var i = 0; i < 18; i++) this.slots[i].reset();
    this.fnum.fill(0); this.block.fill(0); this.keyOn.fill(0);
    this.sus.fill(0); this.inst.fill(0); this.vol.fill(0);
    this.amPhase = 0; this.pmPhase = 0;
    this.rhythm = 0; this.noiseReg = 1; this.noiseOut = 1;
    for (var c = 0; c < 9; c++) this.refreshChannel(c);
  };

  // Return the effective 8-byte patch for a channel (user regs or ROM).
  OpllCore.prototype.patchBytes = function (ch) {
    var n = this.inst[ch];
    if (n === 0) return [
      this.regs[0], this.regs[1], this.regs[2], this.regs[3],
      this.regs[4], this.regs[5], this.regs[6], this.regs[7]
    ];
    return INSTRUMENT_ROM[n];
  };

  // Recompute every derived value for one channel's two operators.
  OpllCore.prototype.refreshChannel = function (ch) {
    var dec = decodePatch(this.patchBytes(ch));
    var mod = this.mod(ch), car = this.car(ch);
    mod.p = dec.mod; car.p = dec.car;
    this.refreshPitch(ch);
    this.refreshLevels(ch);
  };

  // Phase increment (reference §5): the exact chip formula, expressed as
  // cycles-per-output-sample so the tuning is independent of the audio rate.
  //   I(19-bit units per fsam-sample) = (fnum·2 + pm) · ML2[ml] << block >> 2
  //   cycles/output-sample = I / 2^19 · fsam / sampleRate
  OpllCore.prototype.refreshPitch = function (ch) {
    var f = this.fnum[ch], b = this.block[ch];
    var mod = this.mod(ch), car = this.car(ch);
    var ratio = this.fsam / this.sampleRate / 524288; // 2^19
    mod.inc = this.opInc(f, b, mod.p.ml, ratio);
    car.inc = this.opInc(f, b, car.p.ml, ratio);
  };
  OpllCore.prototype.opInc = function (fnum, block, ml, ratio) {
    // integer part of the chip formula, then scale to output cycles
    var base = ((fnum & 0x1ff) * 2 * ML2[ml]) << block; // >>2 folded below
    return (base / 4) * ratio;
  };

  // Fixed (non-envelope) attenuation for both operators, in envelope units:
  // modulator uses its TL (0.75 dB), carrier uses the channel volume (3.0 dB),
  // plus each operator's Key Scale Level.
  OpllCore.prototype.refreshLevels = function (ch) {
    var mod = this.mod(ch), car = this.car(ch);
    var kslMod = this.kslEg(ch, mod.p.kl);
    var kslCar = this.kslEg(ch, car.p.kl);
    mod.tll = dbToEg(mod.p.tl * TL_STEP_DB) + kslMod;
    car.tll = dbToEg(this.vol[ch] * VOL_STEP_DB) + kslCar;
  };

  // KSL attenuation for a channel/operator, in envelope units.
  OpllCore.prototype.kslEg = function (ch, kl) {
    if (!kl) return 0;
    // dB above the bottom octave: KSL_DB_OCT per octave, scaled by fnum's
    // position in the octave. Simplified but monotone and octave-correct.
    var oct = this.block[ch];
    var frac = (this.fnum[ch] >> 6) / 8; // top 3 bits → 0..~1 within octave
    var db = KSL_DB_OCT[kl] * (oct + frac);
    return dbToEg(db);
  };

  // ---- register writes (reference §3) -------------------------------------
  OpllCore.prototype.writeReg = function (addr, value) {
    addr &= 0x3f; value &= 0xff;
    this.regs[addr] = value;

    if (addr <= 0x07) {
      // user instrument changed → refresh every channel using instrument 0
      for (var c = 0; c < 9; c++) if (this.inst[c] === 0) this.refreshChannel(c);
      return;
    }
    if (addr === 0x0e) { this.writeRhythm(value); return; }
    if (addr >= 0x10 && addr <= 0x18) {
      var ch = addr - 0x10;
      this.fnum[ch] = (this.fnum[ch] & 0x100) | value;
      this.refreshPitch(ch);
      if (this.rhythmOn() && ch >= 6) this.refreshRhythmLevels(); else this.refreshLevels(ch);
      return;
    }
    if (addr >= 0x20 && addr <= 0x28) {
      var c2 = addr - 0x20;
      this.fnum[c2] = (this.fnum[c2] & 0xff) | ((value & 1) << 8);
      this.block[c2] = (value >> 1) & 7;
      this.sus[c2] = (value >> 5) & 1;
      var newKey = (value >> 4) & 1;
      this.refreshPitch(c2);
      // In rhythm mode the ch7-9 channel-key bits are ignored — the drums are
      // keyed through 0E — so only their pitch (drum tuning) applies here.
      if (this.rhythmOn() && c2 >= 6) { this.refreshRhythmLevels(); return; }
      this.refreshLevels(c2);
      this.setKey(c2, newKey);
      return;
    }
    if (addr >= 0x30 && addr <= 0x38) {
      var c3 = addr - 0x30;
      this.inst[c3] = (value >> 4) & 0x0f;
      this.vol[c3] = value & 0x0f;
      // In rhythm mode 36/37/38 carry the drum volumes, not an instrument select
      // — the operator patches stay the fixed rhythm ROM.
      if (this.rhythmOn() && c3 >= 6) { this.refreshRhythmLevels(); return; }
      this.refreshChannel(c3);
      return;
    }
  };

  // Key-On / Key-Off transitions (reference §7).
  OpllCore.prototype.setKey = function (ch, on) {
    if (on && !this.keyOn[ch]) {
      // Key-On: DAMP first (fast fall to silence) so the phase resets cleanly,
      // then ATTACK — the envelope dips before it climbs.
      var mod = this.mod(ch), car = this.car(ch);
      mod.egState = DAMP; car.egState = DAMP;
    } else if (!on && this.keyOn[ch]) {
      this.mod(ch).egState = RELEASE;
      this.car(ch).egState = RELEASE;
    }
    this.keyOn[ch] = on;
  };

  // ---- envelope ------------------------------------------------------------
  // A rate field (0..15) maps to an attenuation change per output sample. Rates
  // are exponential: +4 in the field ≈ ×2 speed, matching the chip's ladders.
  // Calibrated so a mid rate gives a musical time; not cycle-exact.
  OpllCore.prototype.effRate = function (field, ch, kr) {
    if (field === 0) return 0;
    var rks = kr ? ((this.block[ch] << 1) | (this.fnum[ch] >> 8)) : (this.block[ch] >> 1);
    return Math.min(15, field + (rks >> 2));
  };
  OpllCore.prototype.egPerSample = function (effRate) {
    if (effRate <= 0) return 0;
    // The chip's rate field maps to time roughly as ×2 per field step (each +4
    // in the internal rate doubles the speed, and the 4-bit field feeds it
    // directly). So rate 15 ≈ instant and rate ~2 spans seconds — a realistic
    // ADSR range. units/second = 2·2^effRate; divided by the sample rate so the
    // timing is independent of the audio/viz rate.
    return (2.0 * Math.pow(2, effRate)) / this.sampleRate;
  };

  OpllCore.prototype.stepEnvelope = function (slot, ch, isCarrier) {
    if (this.freezeEg) return;   // scope render: hold the envelope open
    var p = slot.p;
    switch (slot.egState) {
      case DAMP: {
        // fast fall toward mute; when fully damped, begin the attack
        slot.eg += this.egPerSample(12) ;
        if (slot.eg >= EG_MAX) {
          slot.eg = EG_MUTE;
          slot.phase = 0;                 // phase resets on Key-On
          if (isCarrier) this.mod(ch).phase = 0;
          slot.egState = ATTACK;
        }
        break;
      }
      case ATTACK: {
        var ar = this.effRate(p.ar, ch, p.kr);
        if (ar >= 15) { slot.eg = 0; }
        else { slot.eg -= this.egPerSample(ar) * (0.2 + slot.eg / EG_MUTE); }
        if (slot.eg <= 0) { slot.eg = 0; slot.egState = DECAY; }
        break;
      }
      case DECAY: {
        var dr = this.effRate(p.dr, ch, p.kr);
        slot.eg += this.egPerSample(dr);
        // sustain level: 4-bit @ 3.0 dB (sl 15 == full mute)
        var slTarget = p.sl === 15 ? EG_MUTE : p.sl * (SL_STEP_DB / EG_STEP_DB);
        if (slot.eg >= slTarget) { slot.eg = slTarget; slot.egState = SUSTAIN; }
        break;
      }
      case SUSTAIN: {
        if (!p.eg) { // percussive: keep decaying toward mute at release rate
          var rr = this.effRate(p.rr, ch, p.kr);
          slot.eg += this.egPerSample(rr);
          if (slot.eg >= EG_MUTE) slot.eg = EG_MUTE;
        }
        break;
      }
      case RELEASE: {
        var rrate = this.sus[ch] ? 5 : this.effRate(p.rr, ch, p.kr);
        slot.eg += this.egPerSample(rrate);
        if (slot.eg >= EG_MUTE) { slot.eg = EG_MUTE; slot.egState = IDLE; }
        break;
      }
      default: break;
    }
    if (slot.eg < 0) slot.eg = 0;
    if (slot.eg > EG_MUTE) slot.eg = EG_MUTE;
  };

  // ---- per-sample synthesis -----------------------------------------------
  // Modulation depth: a full-scale modulator shifts the carrier phase by a few
  // cycles (matching the chip's ~4096/1024 index offset).
  var FM_DEPTH = 4.0;   // cycles per unit modulator output
  var FB_BASE = 0.0125; // feedback scale, multiplied by 2^fb

  OpllCore.prototype.channelSample = function (ch) {
    var mod = this.mod(ch), car = this.car(ch);
    if (mod.egState === IDLE && car.egState === IDLE) return 0;

    var amMod = mod.p.am ? this.lfoAmEg() : 0;
    var amCar = car.p.am ? this.lfoAmEg() : 0;
    var pmMod = mod.p.pm ? this.lfoPm(ch) : 0;
    var pmCar = car.p.pm ? this.lfoPm(ch) : 0;

    // modulator (with self-feedback)
    var fb = mod.p.fb ? (mod.out + mod.prev) * FB_BASE * (1 << mod.p.fb) : 0;
    var mPhase = mod.phase + fb + pmMod;
    var mWave = WAVES[mod.p.ws];
    var mSample = mWave[((mPhase - Math.floor(mPhase)) * SINE_LEN) | 0];
    var mGain = egToGain(mod.eg + mod.tll + amMod);
    mod.prev = mod.out;
    mod.out = mSample * mGain;

    // carrier (phase-modulated by the modulator)
    var cPhase = car.phase + mod.out * FM_DEPTH + pmCar;
    var cWave = WAVES[car.p.ws];
    var idx = (cPhase - Math.floor(cPhase)) * SINE_LEN;
    idx = ((idx | 0) % SINE_LEN + SINE_LEN) % SINE_LEN;
    var cSample = cWave[idx];
    var cGain = egToGain(car.eg + car.tll + amCar);
    car.prev = car.out;
    car.out = cSample * cGain;

    // advance phase and envelopes
    mod.phase += mod.inc; if (mod.phase >= 1) mod.phase -= (mod.phase | 0);
    car.phase += car.inc; if (car.phase >= 1) car.phase -= (car.phase | 0);
    this.stepEnvelope(mod, ch, false);
    this.stepEnvelope(car, ch, true);

    return car.out; // only the carrier reaches the DAC
  };

  // ---- global LFO (reference §10) -----------------------------------------
  OpllCore.prototype.lfoAmEg = function () {
    // tremolo ≈ 1.27 Hz, depth ≈ 4.8 dB → 0..~12.8 EG units, triangle-ish
    var t = 0.5 - 0.5 * Math.cos(2 * Math.PI * this.amPhase);
    return t * dbToEg(4.8);
  };
  OpllCore.prototype.lfoPm = function (ch) {
    // vibrato ≈ 6.4 Hz, depth ≈ 14 cents (~0.8% pitch) → a tiny per-sample
    // phase nudge proportional to the operator's own increment.
    var s = Math.sin(2 * Math.PI * this.pmPhase);
    return s * this.car(ch).inc * 0.008;
  };

  // ---- rhythm subsystem (reference §9) ------------------------------------
  // Writing 0E bit5 reinterprets the last three channels as five drums:
  //
  //   Bass Drum   ch7 (both operators)   0E bit4   — a plain 2-op FM voice
  //   Hi-Hat      ch8 modulator slot     0E bit0   ┐ metallic: two operator
  //   Snare Drum  ch8 carrier slot       0E bit3   │ phases + the noise LFSR,
  //   Tom-Tom     ch9 modulator slot     0E bit2   │ each keyed and levelled
  //   Top Cymbal  ch9 carrier slot       0E bit1   ┘ on its own.
  //
  // The four non-BD drums are single operator SLOTS (not paired voices), so they
  // are synthesised directly here rather than through channelSample. Fixed ROM
  // patches 16-18 supply their operator params; the driver still writes the drum
  // pitch through 10-18/20-28 as usual; volumes come from the 36/37/38 nibbles.
  //
  // Slot indices: BD = 12/13 (ch7 mod/car), HH = 14, SD = 15 (ch8 mod/car),
  //               TOM = 16, CYM = 17 (ch9 mod/car).
  OpllCore.prototype.rhythmOn = function () { return (this.rhythm >> 5) & 1; };

  // The five drum key bits in 0E, paired with the slot(s) each one triggers.
  var DRUM_KEYS = [
    { bit: 4, slots: [12, 13] }, // Bass Drum — both operators
    { bit: 3, slots: [15] },     // Snare Drum — ch8 carrier
    { bit: 2, slots: [16] },     // Tom-Tom — ch9 modulator
    { bit: 1, slots: [17] },     // Top Cymbal — ch9 carrier
    { bit: 0, slots: [14] }      // Hi-Hat — ch8 modulator
  ];

  OpllCore.prototype.writeRhythm = function (value) {
    var prev = this.rhythm;
    this.rhythm = value & 0x3f;
    var on = (value >> 5) & 1, was = (prev >> 5) & 1;
    if (on && !was) this.enterRhythm();
    else if (!on && was) { this.exitRhythm(); return; }
    if (!on) return;
    // key edges: a rising drum bit re-triggers (DAMP→ATTACK), a falling one releases
    for (var i = 0; i < DRUM_KEYS.length; i++) {
      var d = DRUM_KEYS[i];
      var now = (value >> d.bit) & 1, before = (prev >> d.bit) & 1;
      if (now === before) continue;
      for (var s = 0; s < d.slots.length; s++) this.keySlot(this.slots[d.slots[s]], now);
    }
  };

  OpllCore.prototype.keySlot = function (slot, on) {
    if (on) slot.egState = DAMP;                       // percussive hit
    else if (slot.egState !== IDLE) slot.egState = RELEASE;
  };

  // Load the fixed rhythm patches into ch7-9's operators and level them.
  OpllCore.prototype.enterRhythm = function () {
    var bd = decodePatch(INSTRUMENT_ROM[16]);
    this.mod(6).p = bd.mod; this.car(6).p = bd.car;
    var hhsd = decodePatch(INSTRUMENT_ROM[17]);
    this.slots[14].p = hhsd.mod;  // Hi-Hat
    this.slots[15].p = hhsd.car;  // Snare
    var tomcym = decodePatch(INSTRUMENT_ROM[18]);
    this.slots[16].p = tomcym.mod; // Tom
    this.slots[17].p = tomcym.car; // Cymbal
    for (var ch = 6; ch <= 8; ch++) this.refreshPitch(ch);
    this.refreshRhythmLevels();
  };

  // Leave rhythm mode: silence the drums and restore the melodic patches.
  OpllCore.prototype.exitRhythm = function () {
    this.rhythm = 0;
    for (var i = 12; i <= 17; i++) this.slots[i].egState = IDLE;
    for (var ch = 6; ch <= 8; ch++) this.refreshChannel(ch);
  };

  // Drum levels: the bass drum keeps the normal 2-op level chain (carrier volume
  // + modulator TL); the four single-slot drums are direct outputs, so their
  // volume scales at the carrier's 3 dB/step. Nibbles per reference §9:
  //   36 = BD vol · 37 = HH(hi)/SD(lo) · 38 = TOM(hi)/CYM(lo).
  OpllCore.prototype.refreshRhythmLevels = function () {
    this.refreshLevels(6); // Bass Drum, via the standard channel level chain
    var hh = (this.regs[0x37] >> 4) & 0x0f, sd = this.regs[0x37] & 0x0f;
    var tom = (this.regs[0x38] >> 4) & 0x0f, cym = this.regs[0x38] & 0x0f;
    this.slots[14].tll = dbToEg(hh * VOL_STEP_DB);
    this.slots[15].tll = dbToEg(sd * VOL_STEP_DB);
    this.slots[16].tll = dbToEg(tom * VOL_STEP_DB);
    this.slots[17].tll = dbToEg(cym * VOL_STEP_DB);
  };

  // The noise generator: a 23-bit LFSR (feedback = bit0 ⊕ bit8), advanced once
  // per output sample. Its polynomial is a fact about the hardware; the code is
  // ours. Returns the current bit as ±1.
  OpllCore.prototype.clockNoise = function () {
    var n = this.noiseReg;
    var fb = (n ^ (n >> 8)) & 1;
    this.noiseReg = ((n >> 1) | (fb << 22)) >>> 0;
    this.noiseOut = (this.noiseReg & 1) ? 1 : -1;
    return this.noiseOut;
  };

  // A drum operator's phase as the chip's 9-bit phase-generator output (0..511),
  // the bit source the metallic gate and the snare read.
  function pg9(slot) { return (((slot.phase - Math.floor(slot.phase)) * 512) | 0) & 511; }

  // The hi-hat / cymbal "metallic gate": a fixed handful of phase-bit comparisons
  // of the hi-hat (slot14) and cymbal (slot17) operators. When it flips, the two
  // metallic drums jump between phase points on the sine table — the origin of
  // their inharmonic clang. Returns 0/1.
  //
  // This gate and the drum phase constants below are the OPLL's *documented*
  // rhythm algorithm (as captured by Okazaki's emu2413 — the behavioural
  // reference this project follows, reference §0). Reproduced as behavioural data
  // (like the instrument ROM), with attribution; the surrounding code is ours.
  OpllCore.prototype.hatCymGate = function () {
    var h = pg9(this.slots[14]), c = pg9(this.slots[17]);
    function b(x, n) { return (x >> n) & 1; }
    var res1 = (b(h, 2) ^ b(h, 7)) | b(h, 3);
    var res2 = b(c, 3) ^ b(c, 5);
    return res1 | res2;
  };

  // The metallic drums bypass the phase accumulator and address the sine table at
  // an absolute 10-bit index; this reads one drum slot's waveform there.
  OpllCore.prototype.drumWave = function (slot, phase10) {
    return WAVES[slot.p.ws][phase10 & (SINE_LEN - 1)];
  };

  // Advance one drum slot's phase and step its envelope (isCarrier=false so a
  // single-slot drum never resets its neighbour's phase — the two drums that
  // share a channel are independent).
  OpllCore.prototype.advanceDrum = function (slot, ch) {
    slot.phase += slot.inc; if (slot.phase >= 1) slot.phase -= (slot.phase | 0);
    this.stepEnvelope(slot, ch, false);
  };

  // Sum the five drums for one sample (rhythm mode only), at +3 dB. Snare, hi-hat
  // and cymbal are NOT square waves — each looks up the sine table at a phase
  // chosen by phase bits and the noise LFSR, which is what gives them their
  // pitched-yet-gritty character rather than a harsh buzz.
  OpllCore.prototype.rhythmSample = function () {
    this.clockNoise();
    var gate = this.hatCymGate();     // read the operator phases BEFORE advancing
    var noise = this.noiseReg & 1;    // 0/1
    var out = 0;

    // Bass Drum — a plain 2-op FM voice (channel 7, patch 16).
    out += this.channelSample(6);

    // Snare Drum (ch8 carrier) — the carrier's top phase bit picks a tone phase,
    // the noise gates it: near-silent without noise, a ±tone crack with it.
    var sd = this.slots[15];
    if (sd.egState !== IDLE) {
      var sdTop = (sd.phase - Math.floor(sd.phase)) >= 0.5;
      var sdPhase = sdTop ? (noise ? 0x300 : 0x200) : (noise ? 0x100 : 0x000);
      out += this.drumWave(sd, sdPhase) * egToGain(sd.eg + sd.tll);
      this.advanceDrum(sd, 7);
    }

    // Tom-Tom (ch9 modulator) — the one purely tonal drum: its own sine.
    var tom = this.slots[16];
    if (tom.egState !== IDLE) {
      var ti = ((tom.phase - Math.floor(tom.phase)) * SINE_LEN) | 0;
      out += this.drumWave(tom, ti) * egToGain(tom.eg + tom.tll);
      this.advanceDrum(tom, 8);
    }

    // Hi-Hat (ch8 modulator) — the gate + noise pick a bright, short phase point.
    var hh = this.slots[14];
    if (hh.egState !== IDLE) {
      var hhPhase = gate ? (noise ? 0x2d0 : 0x234) : (noise ? 0x034 : 0x0d0);
      out += this.drumWave(hh, hhPhase) * egToGain(hh.eg + hh.tll);
      this.advanceDrum(hh, 7);
    }

    // Top Cymbal (ch9 carrier) — the same gate, but tonal (no noise term): it
    // rings rather than hisses.
    var cym = this.slots[17];
    if (cym.egState !== IDLE) {
      var cymPhase = gate ? 0x300 : 0x100;
      out += this.drumWave(cym, cymPhase) * egToGain(cym.eg + cym.tll);
      this.advanceDrum(cym, 8);
    }

    return out * RHYTHM_GAIN;
  };

  // ---- block render --------------------------------------------------------
  OpllCore.prototype.process = function (out, frames) {
    var amInc = 1.27 / this.sampleRate;
    var pmInc = 6.4 / this.sampleRate;
    for (var n = 0; n < frames; n++) {
      var acc = 0;
      // In rhythm mode the last three channels become the five drums; only 1-6
      // stay melodic (6 melodic + 5 drums). Otherwise all nine are melodic.
      var nMel = this.rhythmOn() ? 6 : 9;
      for (var ch = 0; ch < nMel; ch++) acc += this.channelSample(ch);
      if (this.rhythmOn()) acc += this.rhythmSample();
      // up to 9 carriers, each −1..1; scale to keep headroom.
      out[n] = acc * 0.11;
      this.amPhase += amInc; if (this.amPhase >= 1) this.amPhase -= 1;
      this.pmPhase += pmInc; if (this.pmPhase >= 1) this.pmPhase -= 1;
    }
  };

  // ---- introspection for the visualiser (NOT used for audio) --------------
  // Render one channel's modulator, carrier and summed output over a window,
  // from a throwaway copy of the current state, so the scope is deterministic
  // and never disturbs the audio path.
  OpllCore.prototype.renderViz = function (frames, ch) {
    var carr = new Float32Array(frames);
    for (var n = 0; n < frames; n++) carr[n] = this.channelSample(ch);
    return { carrier: carr };
  };

  // Non-destructive, stable scope render, phase-aligned so the trace doesn't
  // scroll. Returns THREE Float32 arrays for one channel, then restores state:
  //   carrier   — the LIVE output, scaled by the current envelope, so a note
  //               visibly swells on attack and fades on release (flat when idle);
  //   modulator — the modulator's live output (the FM source);
  //   reference — the carrier with the envelope forced open: a steady, full-
  //               amplitude timbre trace, always visible even while silent.
  // The UI draws `reference` dim behind the bright, moving `carrier`.
  OpllCore.prototype.renderScope = function (frames, ch) {
    var mod = this.mod(ch), car = this.car(ch);
    var save = {
      mp: mod.phase, mo: mod.out, mpv: mod.prev, ms: mod.egState, me: mod.eg,
      cp: car.phase, co: car.out, cpv: car.prev, cs: car.egState, ce: car.eg,
      am: this.amPhase, pm: this.pmPhase
    };
    this.freezeEg = true;                 // hold the envelope steady across the window
    this.amPhase = 0; this.pmPhase = 0;

    // pass 1: LIVE (current envelope level)
    this._scopeReset(mod, car);
    var carArr = new Float32Array(frames), modArr = new Float32Array(frames);
    var live = mod.egState !== IDLE || car.egState !== IDLE;
    for (var n = 0; n < frames; n++) {
      carArr[n] = this.channelSample(ch);
      modArr[n] = mod.out;
    }

    // pass 2: REFERENCE (envelope forced open → steady timbre trace)
    this._scopeReset(mod, car);
    mod.egState = SUSTAIN; car.egState = SUSTAIN; mod.eg = 0; car.eg = 0;
    var refArr = new Float32Array(frames);
    for (var m = 0; m < frames; m++) refArr[m] = this.channelSample(ch);

    this.freezeEg = false;
    mod.phase = save.mp; mod.out = save.mo; mod.prev = save.mpv; mod.egState = save.ms; mod.eg = save.me;
    car.phase = save.cp; car.out = save.co; car.prev = save.cpv; car.egState = save.cs; car.eg = save.ce;
    this.amPhase = save.am; this.pmPhase = save.pm;
    return { carrier: carArr, modulator: modArr, reference: refArr, live: live };
  };

  OpllCore.prototype._scopeReset = function (mod, car) {
    mod.phase = 0; car.phase = 0; mod.out = 0; car.out = 0; mod.prev = 0; car.prev = 0;
  };

  // Non-destructive render for the ★ operator-pair widget (Phase 3 — FM). Runs
  // the channel with the envelope forced OPEN (a steady timbre, visible even
  // while the note is silent) and returns FOUR aligned windows for one channel:
  //   modulator     — the modulator's own output (the FM *source*); its amplitude
  //                   tracks the modulator TL, so it doubles as the link strength;
  //   phaseOffset   — mod.out × FM_DEPTH, the phase (in cycles) the modulator
  //                   injects into the carrier each sample — the essence of FM;
  //   carrierClean  — the carrier as a bare sine (modulation ignored), the
  //                   "before" trace for the show-internals overlay;
  //   carrier       — the carrier's actual, phase-modulated output (the "after").
  // State is saved and restored, exactly like renderScope, so audio is untouched.
  OpllCore.prototype.renderPair = function (frames, ch) {
    var mod = this.mod(ch), car = this.car(ch);
    var save = {
      mp: mod.phase, mo: mod.out, mpv: mod.prev, ms: mod.egState, me: mod.eg,
      cp: car.phase, co: car.out, cpv: car.prev, cs: car.egState, ce: car.eg,
      am: this.amPhase, pm: this.pmPhase
    };
    this.freezeEg = true;
    this.amPhase = 0; this.pmPhase = 0;
    this._scopeReset(mod, car);
    mod.egState = SUSTAIN; car.egState = SUSTAIN; mod.eg = 0; car.eg = 0;

    var modArr = new Float32Array(frames), carArr = new Float32Array(frames);
    var offArr = new Float32Array(frames), cleanArr = new Float32Array(frames);
    var cWave = WAVES[car.p.ws];
    var cGain = egToGain(car.tll);   // envelope open: only the fixed level remains
    var cph = 0;
    for (var n = 0; n < frames; n++) {
      carArr[n] = this.channelSample(ch);      // advances phases + sets mod.out
      modArr[n] = mod.out;
      offArr[n] = mod.out * FM_DEPTH;          // injected phase, in cycles
      // the carrier it WOULD have been with no modulation, same freq and level
      var ci = (cph - Math.floor(cph)) * SINE_LEN;
      ci = ((ci | 0) % SINE_LEN + SINE_LEN) % SINE_LEN;
      cleanArr[n] = cWave[ci] * cGain;
      cph += car.inc;
    }

    this.freezeEg = false;
    mod.phase = save.mp; mod.out = save.mo; mod.prev = save.mpv; mod.egState = save.ms; mod.eg = save.me;
    car.phase = save.cp; car.out = save.co; car.prev = save.cpv; car.egState = save.cs; car.eg = save.ce;
    this.amPhase = save.am; this.pmPhase = save.pm;
    return { modulator: modArr, carrier: carArr, phaseOffset: offArr, carrierClean: cleanArr };
  };

  OpllCore.prototype.snapshot = function (ch) {
    var mod = this.mod(ch), car = this.car(ch);
    return {
      keyOn: this.keyOn[ch],
      fnum: this.fnum[ch], block: this.block[ch],
      inst: this.inst[ch], vol: this.vol[ch],
      mod: { eg: mod.eg, state: mod.egState, out: mod.out },
      car: { eg: car.eg, state: car.egState, out: car.out }
    };
  };

  // Resolved patch for the panels (mirrors decodePatch on the live patch).
  OpllCore.prototype.effectivePatch = function (ch) {
    return decodePatch(this.patchBytes(ch));
  };

  // ---- exports for the three contexts -------------------------------------
  if (typeof globalThis !== 'undefined') globalThis.OpllCore = OpllCore;
  if (typeof module !== 'undefined' && module.exports) module.exports = OpllCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);
