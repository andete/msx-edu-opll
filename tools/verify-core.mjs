#!/usr/bin/env node
/*
 * verify-core.mjs — headless checks for js/opll-core.js against the truths in
 * reference/opll-registers.md §12. Run manually:
 *
 *     node tools/verify-core.mjs
 *
 * Exits non-zero if any check fails. This is our DSP regression guard. It tests
 * the *behaviour* our teaching core commits to (reference §12), not cycle-exact
 * emu2413 internals.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { harmonics, instrumentFingerprint } from '../js/opll-spec.js';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const OpllCore = require(join(here, '..', 'js', 'opll-core.js'));

let failures = 0;
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
function check(name, cond, detail = '') {
  const ok = !!cond;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

const CLOCK = 3579545;
const SR = 49716;              // run the core near the chip's own fsam for checks
const fsam = CLOCK / 72;

// Measure the fundamental frequency a channel produces, by counting the phase
// increment the core computed for its carrier (cycles/sample × sampleRate).
function carrierFreq(core, ch) {
  return core.car(ch).inc * core.sampleRate;
}

// Play one channel with a given user patch and note; return peak |output|.
function renderPeak(core, ch, frames) {
  const buf = new Float32Array(frames);
  core.process(buf, frames);
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  return peak;
}

console.log('opll-core verification\n');

// --- 1. Pitch: fsam, the anchor, and octave doubling ---------------------
console.log('Pitch (F-Number / Block):');
{
  const core = new OpllCore(CLOCK, SR);
  check('fsam = fMASTER/72 ≈ 49715.9 Hz', approx(core.fsam, fsam, 0.5), `${core.fsam.toFixed(1)} Hz`);
  // A4 anchor: F-Number 290, Block 4, Multiple 1 → ~440 Hz.
  core.writeReg(0x30, 0x00);           // ch0: instrument 0 (user), volume 0
  // give the user patch Multiple 1 on both operators so ML2[1]=2 (×1)
  core.writeReg(0x00, 0x01); core.writeReg(0x01, 0x01);
  core.writeReg(0x10, 290 & 0xff);     // F-Number low
  core.writeReg(0x20, (4 << 1) | ((290 >> 8) & 1)); // Block 4 + F-Number bit8, key off
  const f = carrierFreq(core, 0);
  check('F=290, Block=4, ML=1 → ≈440 Hz', Math.abs(f - 439.98) < 0.5, `${f.toFixed(2)} Hz`);
  // Block+1 doubles the pitch.
  core.writeReg(0x20, (5 << 1) | ((290 >> 8) & 1));
  const f2 = carrierFreq(core, 0);
  check('Block 4 → 5 doubles frequency', Math.abs(f2 - 2 * f) < 0.5, `${f2.toFixed(2)} Hz`);
}

// --- 2. Multiple table ----------------------------------------------------
console.log('\nMultiple table:');
{
  const expected = [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 20, 24, 24, 30, 30];
  check('ML2 = {1,2,4,…,30,30} (ML 0→×0.5, no ×11/13/14)',
    JSON.stringify(OpllCore.ML2) === JSON.stringify(expected));
  // ML register 2 (×2) should give twice the frequency of ML register 1 (×1).
  const core = new OpllCore(CLOCK, SR);
  core.writeReg(0x30, 0x00);
  core.writeReg(0x10, 200); core.writeReg(0x20, (4 << 1));
  core.writeReg(0x01, 0x01); const f1 = carrierFreq(core, 0); // carrier ML=1
  core.writeReg(0x01, 0x02); const f2 = carrierFreq(core, 0); // carrier ML=2
  check('carrier ML 1→2 doubles carrier frequency', Math.abs(f2 - 2 * f1) < 0.5,
    `${f1.toFixed(1)} → ${f2.toFixed(1)} Hz`);
}

// --- 3. Level scaling: carrier 3 dB/step, modulator 0.75 dB/step ----------
console.log('\nLevels (dB per step):');
{
  const core = new OpllCore(CLOCK, SR);
  // carrier volume: each unit = 3.0 dB on the carrier's fixed level (tll).
  core.writeReg(0x30, 0x00);            // vol 0
  const tll0 = core.car(0).tll;
  core.writeReg(0x30, 0x01);            // vol 1
  const tll1 = core.car(0).tll;
  const carDb = (tll1 - tll0) * OpllCore.EG_STEP_DB;
  check('carrier volume step = 3.0 dB', approx(carDb, 3.0, 1e-6), `${carDb.toFixed(3)} dB`);
  // modulator TL: each unit = 0.75 dB on the modulator's fixed level.
  core.writeReg(0x02, 0x00); const m0 = core.mod(0).tll;
  core.writeReg(0x02, 0x01); const m1 = core.mod(0).tll;
  const modDb = (m1 - m0) * OpllCore.EG_STEP_DB;
  check('modulator TL step = 0.75 dB', approx(modDb, 0.75, 1e-6), `${modDb.toFixed(3)} dB`);
}

// --- 4. Envelope resolution constants -------------------------------------
console.log('\nEnvelope constants:');
{
  check('EG_STEP = 0.375 dB', approx(OpllCore.EG_STEP_DB, 0.375));
  check('EG_MUTE = 127', OpllCore.EG_MUTE === 127);
  check('EG_MAX = 123', OpllCore.EG_MAX === 123);
  check('carrier volume unit = 8 EG units (3.0 dB)', approx(OpllCore.VOL_STEP_DB / OpllCore.EG_STEP_DB, 8));
}

// --- 5. Envelope rate behaviour: fast AR vs slow AR -----------------------
console.log('\nEnvelope rates:');
{
  function attackPeak(ar) {
    const core = new OpllCore(CLOCK, SR);
    core.writeReg(0x30, 0x00);                 // inst 0, vol 0
    core.writeReg(0x00, 0x01); core.writeReg(0x01, 0x01);
    core.writeReg(0x04, (ar << 4) | 0x00);     // mod AR, DR 0
    core.writeReg(0x05, (ar << 4) | 0x00);     // car AR, DR 0
    core.writeReg(0x06, 0x00); core.writeReg(0x07, 0x00); // SL/RR 0 (hold)
    core.writeReg(0x10, 290); core.writeReg(0x20, (4 << 1) | 1 << 4); // key on, block4
    return renderPeak(core, 0, 2048);
  }
  const fast = attackPeak(15);
  const slow = attackPeak(2);
  check('fast attack (AR=15) reaches audible level quickly', fast > 0.05, `peak ${fast.toFixed(3)}`);
  check('slow attack (AR=2) is quieter over the same short window', slow < fast, `slow ${slow.toFixed(3)} < fast ${fast.toFixed(3)}`);
}

// --- 6. Key-On DAMP: the envelope dips before it climbs -------------------
console.log('\nKey-On damp:');
{
  const core = new OpllCore(CLOCK, SR);
  core.writeReg(0x30, 0x00);
  core.writeReg(0x00, 0x01); core.writeReg(0x01, 0x01);
  core.writeReg(0x05, (5 << 4)); // moderate carrier AR so we can observe the climb
  core.writeReg(0x07, 0x00);
  core.writeReg(0x10, 290);
  // put the carrier at a partly-open envelope, then key on
  core.car(0).eg = 40; core.car(0).egState = 3; // pretend sustaining
  core.writeReg(0x20, (4 << 1) | (1 << 4));      // key on → should DAMP
  check('Key-On enters DAMP (not immediate attack)', core.car(0).egState === 0 /* DAMP */,
    `state ${core.car(0).egState}`);
  const before = core.car(0).eg;
  const buf = new Float32Array(64); core.process(buf, 64);
  check('envelope attenuation increases during damp (dips toward mute)', core.car(0).eg > before || core.car(0).egState > 0,
    `eg ${before.toFixed(1)} → ${core.car(0).eg.toFixed(1)}, state ${core.car(0).egState}`);
}

// --- 6b. EG-type: sustained holds at SL; percussive keeps falling ---------
console.log('\nEG-type (sustained vs percussive):');
{
  function heldEg(egType) {
    const core = new OpllCore(CLOCK, SR);
    core.writeReg(0x30, 0x00);
    core.writeReg(0x00, 0x01);
    core.writeReg(0x01, 0x01 | (egType << 5));   // carrier EG-type bit
    core.writeReg(0x04, 0xf0); core.writeReg(0x05, 0xf8); // fast AR, some DR
    core.writeReg(0x06, 0x00); core.writeReg(0x07, 0x45); // car SL=4, RR=5 (percussive decays at RR)
    core.writeReg(0x10, 290); core.writeReg(0x20, (4 << 1) | (1 << 4)); // key ON, held
    const buf = new Float32Array(512);
    for (let i = 0; i < 60; i++) core.process(buf, 512); // ~0.7 s held
    return core.car(0).eg;
  }
  const sustained = heldEg(1);
  const percussive = heldEg(0);
  check('sustained (EG=1) holds near the sustain level (eg ≈ 32)', Math.abs(sustained - 32) < 6, `eg ${sustained.toFixed(1)}`);
  check('percussive (EG=0) keeps decaying past sustain while held', percussive > sustained + 10, `eg ${percussive.toFixed(1)} > ${sustained.toFixed(1)}`);
}

// --- 7. Instrument ROM round-trips through the 00–07 layout ---------------
console.log('\nInstrument ROM:');
{
  check('ROM has 19 entries (user + 15 melodic + 3 rhythm)', OpllCore.INSTRUMENT_ROM.length === 19);
  const piano = OpllCore.INSTRUMENT_ROM[3];
  const dec = OpllCore.decodePatch(piano);
  // byte0 = 0x13 → mod: AM0 PM0 EG0 KR1 ML3 ; check a couple of fields
  check('decodePatch(Piano) modulator ML = 3', dec.mod.ml === 3, `ml ${dec.mod.ml}`);
  check('decodePatch(Piano) modulator KR = 1', dec.mod.kr === 1, `kr ${dec.mod.kr}`);
  check('decodePatch waveform bits split byte 3', typeof dec.mod.ws === 'number' && typeof dec.car.ws === 'number');
}

// --- 8. Full-voice output invariant (pins the whole chain) ----------------
console.log('\nFull-voice output:');
{
  const core = new OpllCore(CLOCK, SR);
  core.writeReg(0x30, 0x30);                   // ch0: instrument 3 (Piano), vol 0
  core.writeReg(0x10, 290);
  core.writeReg(0x20, (4 << 1) | (1 << 4));    // block 4, key on
  const buf = new Float32Array(4096); core.process(buf, 4096);
  let peak = 0, rms = 0;
  for (const v of buf) { peak = Math.max(peak, Math.abs(v)); rms += v * v; }
  rms = Math.sqrt(rms / buf.length);
  check('a keyed Piano voice produces audible output', peak > 0.02 && peak <= 1.0, `peak ${peak.toFixed(3)}`);
  check('output stays within DAC headroom (|x| ≤ 1)', peak <= 1.0, `peak ${peak.toFixed(3)}`);
  check('RMS is non-trivial', rms > 0.002, `rms ${rms.toFixed(4)}`);
}

// --- 9. FM: the modulator enriches the carrier's harmonics ----------------
// Render the carrier with the envelope forced open (renderPair), bin it against
// the voice fundamental (carrier ML=1 → fundamental = its own increment), and
// measure the energy in harmonics 2..16. A bare sine has almost none; an active
// modulator adds a lot; feedback adds more still. (reference §6, §12.4-5)
console.log('\nFM (modulator → carrier harmonics):');
{
  // Analyse channel 0 with a given user-patch setup. Returns the carrier's
  // fundamental, its upper-harmonic energy, its spectral centroid (mean harmonic
  // number, weighted by energy — a "brightness"), and the modulator's own
  // upper-harmonic energy.
  function analyze(setup) {
    const core = new OpllCore(CLOCK, SR);
    core.writeReg(0x30, 0x00);                 // inst 0 (user), vol 0 (loudest)
    core.writeReg(0x01, 0x01);                 // carrier ML=1 → fundamental = base pitch
    core.writeReg(0x03, 0x00);
    setup(core);
    core.writeReg(0x10, 290 & 0xff);           // F-Number low 8 bits
    core.writeReg(0x20, (4 << 1) | ((290 >> 8) & 1)); // Block 4 + F-Number bit 8 (key off — renderPair opens the env)
    const { carrier, modulator } = core.renderPair(2048, 0);
    const hc = harmonics(carrier, core.car(0).inc, 16);   // carrier ML=1 → base fundamental
    const hm = harmonics(modulator, core.mod(0).inc, 16); // modulator's own fundamental
    const upper = (h) => { let s = 0; for (let k = 2; k <= 16; k++) s += h.mag[k] * h.mag[k]; return Math.sqrt(s); };
    let num = 0, den = 0;
    for (let k = 1; k <= 16; k++) { const p = hc.mag[k] * hc.mag[k]; num += k * p; den += p; }
    return { carFund: hc.mag[1], carHigh: upper(hc), carCentroid: den ? num / den : 1, modHigh: upper(hm) };
  }

  // (a) Modulator Total Level: LOWER TL = louder modulator = deeper FM. A moderate
  // amount of modulation must add far more upper-harmonic energy than a near-silent
  // modulator; deeper modulation keeps pushing energy upward, so the carrier's
  // spectral centroid rises monotonically with depth. (At extreme depth the energy
  // spreads beyond the 16th harmonic, so we track the centroid, not raw 2..16
  // energy, which is what stays monotone.)
  const tlQuiet = analyze((c) => { c.writeReg(0x00, 0x02); c.writeReg(0x02, 0x3f); }); // TL 63 (near silent)
  const tlMid = analyze((c) => { c.writeReg(0x00, 0x02); c.writeReg(0x02, 0x18); });   // TL 24 (moderate)
  const tlLoud = analyze((c) => { c.writeReg(0x00, 0x02); c.writeReg(0x02, 0x00); });  // TL 0  (loud)
  check('a near-silent modulator leaves the carrier ~a single harmonic (fund ≈ 1)', Math.abs(tlQuiet.carFund - 1) < 0.15, `fund ${tlQuiet.carFund.toFixed(3)}`);
  check('an active modulator greatly enriches the carrier vs a near-silent one',
    tlMid.carHigh > tlQuiet.carHigh * 5 && tlMid.carHigh > 0.3,
    `high ${tlQuiet.carHigh.toFixed(3)} → ${tlMid.carHigh.toFixed(3)}`);
  check('deeper modulation brightens the carrier (centroid TL 63<24<0)',
    tlLoud.carCentroid > tlMid.carCentroid && tlMid.carCentroid > tlQuiet.carCentroid,
    `centroid ${tlQuiet.carCentroid.toFixed(2)} < ${tlMid.carCentroid.toFixed(2)} < ${tlLoud.carCentroid.toFixed(2)}`);

  // (b) Modulator Multiple: a higher modulator ratio pushes energy into higher
  // harmonics — at a moderate depth the carrier's spectral centroid rises with ML.
  const ml1 = analyze((c) => { c.writeReg(0x00, 0x01); c.writeReg(0x02, 0x18); }); // mod ×1
  const ml2 = analyze((c) => { c.writeReg(0x00, 0x02); c.writeReg(0x02, 0x18); }); // mod ×2
  const ml4 = analyze((c) => { c.writeReg(0x00, 0x04); c.writeReg(0x02, 0x18); }); // mod ×4
  check('higher modulator Multiple brightens the carrier (centroid ×1<×2<×4)',
    ml4.carCentroid > ml2.carCentroid && ml2.carCentroid > ml1.carCentroid,
    `centroid ${ml1.carCentroid.toFixed(2)} < ${ml2.carCentroid.toFixed(2)} < ${ml4.carCentroid.toFixed(2)}`);

  // (c) Feedback bends the modulator's own sine into a brighter, richer wave.
  const noFb = analyze((c) => { c.writeReg(0x00, 0x01); c.writeReg(0x02, 0x00); c.writeReg(0x03, 0x00); });
  const withFb = analyze((c) => { c.writeReg(0x00, 0x01); c.writeReg(0x02, 0x00); c.writeReg(0x03, 0x07); });
  check('feedback enriches the modulator (sine → brighter wave)', withFb.modHigh > noFb.modHigh + 0.05, `modHigh ${noFb.modHigh.toFixed(4)} → ${withFb.modHigh.toFixed(3)}`);
}

// --- 10. Instrument selection + copy-to-user identity (Phase 4) -----------
// Selecting a ROM instrument makes the channel USE that patch; "copy to user"
// reproduces the identical sound in the editable user slot. (reference §4)
console.log('\nInstrument select / copy-to-user:');
{
  const rom = OpllCore.INSTRUMENT_ROM[7];               // Trumpet
  const romDec = JSON.stringify(OpllCore.decodePatch(rom));

  const core = new OpllCore(CLOCK, SR);
  core.writeReg(0x30, 0x70);                            // select inst 7
  check('selecting inst 7 uses the ROM Trumpet patch',
    JSON.stringify(core.effectivePatch(0)) === romDec);

  for (let i = 0; i < 8; i++) core.writeReg(i, rom[i]); // copy → user slot
  core.writeReg(0x30, 0x00);                            // select inst 0 (user)
  check('copy-to-user reproduces the ROM patch in the user slot',
    JSON.stringify(core.effectivePatch(0)) === romDec);

  // …and it sounds the same: identical peak over an identical keyed render.
  function peakOf(instByte, copyRom) {
    const c = new OpllCore(CLOCK, SR);
    if (copyRom) for (let i = 0; i < 8; i++) c.writeReg(i, rom[i]);
    c.writeReg(0x30, instByte);
    c.writeReg(0x10, 290); c.writeReg(0x20, (4 << 1) | (1 << 4)); // block 4, key on
    return renderPeak(c, 0, 4096);
  }
  const pRom = peakOf(0x70, false), pUser = peakOf(0x00, true);
  check('the copied user patch sounds identical to the ROM instrument',
    Math.abs(pRom - pUser) < 1e-6, `peak ${pRom.toFixed(4)} vs ${pUser.toFixed(4)}`);
}

// --- 11. Instrument fingerprints (the gallery) ----------------------------
// The gallery's per-tile bar chart: bar 0 is the fundamental, higher bars are the
// FM-added harmonics. A silenced modulator is ~one bar; a real ROM patch spreads.
console.log('\nInstrument fingerprints:');
{
  const upper = (fp) => { let s = 0; for (let i = 1; i < fp.length; i++) s += fp[i]; return s; };
  // Pure-sine user patch (modulator TL 63) → dominated by the fundamental bar.
  const pure = instrumentFingerprint(0, [0x21, 0x21, 0x3f, 0x00, 0xf0, 0xf0, 0x0f, 0x0f]);
  check('a silenced-modulator user patch is nearly a single bar',
    pure[0] > upper(pure) * 3, `fund ${pure[0].toFixed(3)} vs upper ${upper(pure).toFixed(3)}`);
  // A ROM brass patch (Trumpet) carries real upper-harmonic content.
  const trumpet = instrumentFingerprint(7);
  check('the Trumpet fingerprint has real upper-harmonic content',
    upper(trumpet) > 0.1, `upper ${upper(trumpet).toFixed(3)}`);
  // Distinct instruments produce distinct fingerprints.
  const flute = instrumentFingerprint(4);
  let diff = 0; for (let i = 0; i < trumpet.length; i++) diff += Math.abs(trumpet[i] - flute[i]);
  check('different instruments have different fingerprints (Trumpet ≠ Flute)',
    diff > 0.1, `L1 distance ${diff.toFixed(3)}`);
}

// --- 12. Nine voices: polyphony + per-channel independence (Phase 5) ------
// The core sums all nine channels every sample; each channel carries its own
// pitch, instrument and key state. The allocator (js/voices.js) just drives these
// registers, so exercising them at the core level pins the polyphony behaviour.
console.log('\nNine voices (polyphony):');
{
  // Key a plain sine voice on a set of channels and return the render's RMS.
  function chordRms(channels) {
    const core = new OpllCore(CLOCK, SR);
    // A sustained clean-carrier user patch with a fast attack, so process() opens
    // the envelope inside the window.
    core.writeReg(0x00, 0x21); core.writeReg(0x01, 0x21);   // sustained, ML 1 both ops
    core.writeReg(0x02, 0x3f);                              // modulator silenced → clean carrier
    core.writeReg(0x04, 0xf0); core.writeReg(0x05, 0xf0);   // fast attack, no decay
    core.writeReg(0x06, 0x00); core.writeReg(0x07, 0x00);   // hold (SL/RR 0)
    for (const ch of channels) {
      core.writeReg(0x30 + ch, 0x00);                       // inst 0 (user), vol 0
      core.writeReg(0x10 + ch, 290);
      core.writeReg(0x20 + ch, (4 << 1) | (1 << 4));        // block 4, key on
    }
    const buf = new Float32Array(4096); core.process(buf, 4096);
    let rms = 0; for (const v of buf) rms += v * v;
    return Math.sqrt(rms / buf.length);
  }
  const one = chordRms([0]);
  const nine = chordRms([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  check('nine keyed voices are louder than one (all channels sum)', nine > one * 2, `rms ${one.toFixed(3)} → ${nine.toFixed(3)}`);
  check('a nine-voice chord stays within DAC headroom (|x| ≤ 1)', (() => {
    const core = new OpllCore(CLOCK, SR);
    for (let ch = 0; ch < 9; ch++) {
      core.writeReg(0x30 + ch, 0x30);                       // Piano on every channel
      core.writeReg(0x10 + ch, 260 + ch * 6);               // a spread of pitches
      core.writeReg(0x20 + ch, (4 << 1) | (1 << 4));
    }
    return renderPeak(core, 0, 4096) <= 1.0;
  })(), 'no clipping');

  // Independent pitch: two channels at different F-Numbers produce different
  // carrier frequencies.
  const core = new OpllCore(CLOCK, SR);
  core.writeReg(0x01, 0x01);                                // carrier ML 1 (shared user patch)
  core.writeReg(0x11, 120); core.writeReg(0x21, (4 << 1));  // channel index 1: F-Number 120
  core.writeReg(0x12, 240); core.writeReg(0x22, (4 << 1));  // channel index 2: F-Number 240 (2×)
  check('channels carry independent pitch (F-Number per channel)',
    Math.abs(carrierFreq(core, 2) - 2 * carrierFreq(core, 1)) < 1.0,
    `${carrierFreq(core, 1).toFixed(1)} Hz vs ${carrierFreq(core, 2).toFixed(1)} Hz`);

  // Independent instrument: one channel on the user patch vs another on a ROM
  // instrument resolve to different effective patches.
  const c2 = new OpllCore(CLOCK, SR);
  c2.writeReg(0x30, 0x00);   // ch1 → user
  c2.writeReg(0x31, 0x30);   // ch2 → Piano (ROM 3)
  check('channels carry independent instruments',
    JSON.stringify(c2.effectivePatch(0)) !== JSON.stringify(c2.effectivePatch(1)));
}

// --- 13. Rhythm mode: the 6+5 drum reinterpretation (Phase 6) --------------
// Writing 0E bit5 turns channels 7-9 into five drums keyed by 0E bits 0-4, at
// +3 dB, leaving channels 1-6 melodic. (reference §9)
console.log('\nRhythm mode (6 melodic + 5 drums):');
{
  // A rhythm kit at the panel's tuning + full drum volume; render the given 0E
  // keys. The tuning matters: the Tom operator (patch 18) has Multiple ×5, so
  // channel 9 is deliberately low or the tom turns shrill (a real past bug).
  function kit(core, keyBits) {
    core.writeReg(0x0e, 0x20);                              // rhythm mode on
    core.writeReg(0x16, 86);  core.writeReg(0x26, 3 << 1);  // ch7 (BD) ~65 Hz
    core.writeReg(0x17, 122); core.writeReg(0x27, 4 << 1);  // ch8 (HH/SD)
    core.writeReg(0x18, 80);  core.writeReg(0x28, 2 << 1);  // ch9 (TOM/CYM)
    core.writeReg(0x36, 0x00); core.writeReg(0x37, 0x00); core.writeReg(0x38, 0x00); // loud
    core.writeReg(0x0e, 0x20 | keyBits);
  }
  function drumBuf(keyBits, frames = 8192) {
    const core = new OpllCore(CLOCK, SR);
    kit(core, keyBits);
    const buf = new Float32Array(frames); core.process(buf, frames);
    return buf;
  }
  function drumPeak(keyBits) { let p = 0; for (const v of drumBuf(keyBits)) p = Math.max(p, Math.abs(v)); return p; }
  // A crude dominant-frequency probe (zero-crossing rate) — enough to tell a low
  // tonal drum from a shrill one, or noise from tone.
  function domHz(keyBits) {
    const buf = drumBuf(keyBits, 16384); let zc = 0;
    for (let i = 1; i < buf.length; i++) if ((buf[i - 1] < 0) !== (buf[i] < 0)) zc++;
    return (zc / 2) / (buf.length / SR);
  }
  const drums = [['Bass Drum', 0x10], ['Snare', 0x08], ['Tom', 0x04], ['Cymbal', 0x02], ['Hi-Hat', 0x01]];
  let allSound = true;
  for (const [name, bit] of drums) { const p = drumPeak(bit); if (!(p > 0.02)) { allSound = false; check(`${name} sounds`, false, `peak ${p.toFixed(4)}`); } }
  check('all five drums produce audible output on their key bit', allSound);

  // Drum character/tuning: the tom is a low tonal drum (this would have failed at
  // the old shrill ~1.3 kHz), the bass drum sits below it, and the hi-hat is far
  // brighter than the tom (noise vs tone).
  const bdF = domHz(0x10), tomF = domHz(0x04), hhF = domHz(0x01);
  check('the tom is a low tonal drum, not shrill (< 300 Hz)', tomF < 300, `${tomF.toFixed(0)} Hz`);
  check('the bass drum is the lowest voice (< tom, < 120 Hz)', bdF < 120 && bdF < tomF, `bd ${bdF.toFixed(0)} < tom ${tomF.toFixed(0)} Hz`);
  check('the hi-hat is far brighter than the tom', hhF > tomF * 4, `hh ${hhF.toFixed(0)} vs tom ${tomF.toFixed(0)} Hz`);

  // The louder sine-lookup drums must still fit under the DAC ceiling alongside a
  // full melodic mix (6 Piano voices + all five drums keyed).
  {
    const core = new OpllCore(CLOCK, SR);
    for (let ch = 0; ch < 6; ch++) { core.writeReg(0x30 + ch, 0x30); core.writeReg(0x10 + ch, 260 + ch * 8); core.writeReg(0x20 + ch, (4 << 1) | (1 << 4)); }
    kit(core, 0x1f);
    let p = 0; const buf = new Float32Array(8192); core.process(buf, 8192);
    for (const v of buf) p = Math.max(p, Math.abs(v));
    check('rhythm + 6 melodic voices stays within DAC headroom (|x| ≤ 1)', p <= 1.0, `peak ${p.toFixed(3)}`);
  }

  // A silent-key rhythm render is quiet; keying every drum is clearly louder.
  const idle = drumPeak(0x00), all = drumPeak(0x1f);
  check('no drum keyed → near silence; all five keyed → audible', idle < 0.005 && all > idle * 5, `idle ${idle.toFixed(4)} → all ${all.toFixed(4)}`);

  // Melodic channels 1-6 are untouched by rhythm mode: the same keyed Piano on
  // channel 1 renders identically whether or not rhythm mode is on.
  function ch0Peak(rhythmOn) {
    const core = new OpllCore(CLOCK, SR);
    core.writeReg(0x30, 0x30);                    // ch1: Piano, vol 0
    if (rhythmOn) core.writeReg(0x0e, 0x20);
    core.writeReg(0x10, 290); core.writeReg(0x20, (4 << 1) | (1 << 4));
    return renderPeak(core, 0, 4096);
  }
  check('rhythm mode leaves melodic channels 1-6 unchanged', Math.abs(ch0Peak(false) - ch0Peak(true)) < 1e-9, `${ch0Peak(false).toFixed(4)} vs ${ch0Peak(true).toFixed(4)}`);

  // In rhythm mode the ch7-9 channel-key bits are dead: keying ch7 the melodic
  // way (20+ch key bit) produces nothing — that channel is a drum now, sounding
  // only through 0E.
  function ch6MelodicPeak(rhythmOn) {
    const core = new OpllCore(CLOCK, SR);
    core.writeReg(0x00, 0x21); core.writeReg(0x01, 0x21); core.writeReg(0x02, 0x3f); // clean carrier
    core.writeReg(0x04, 0xf0); core.writeReg(0x05, 0xf0);
    core.writeReg(0x06, 0x00); core.writeReg(0x07, 0x00);
    core.writeReg(0x36, 0x00);                    // ch7 → user patch, loud
    if (rhythmOn) core.writeReg(0x0e, 0x20);
    core.writeReg(0x16, 290); core.writeReg(0x26, (4 << 1) | (1 << 4)); // key ch7 melodically
    return renderPeak(core, 6, 4096);
  }
  check('rhythm mode ignores the ch7-9 channel key (drums keyed only via 0E)', ch6MelodicPeak(true) < 0.001 && ch6MelodicPeak(false) > 0.02, `on ${ch6MelodicPeak(true).toFixed(4)} vs off ${ch6MelodicPeak(false).toFixed(4)}`);

  // The +3 dB rhythm lift: the Bass Drum (a plain 2-op voice on patch 16) is
  // exactly RHYTHM_GAIN louder than the identical patch played melodically.
  function bdRhythmPeak() {
    const core = new OpllCore(CLOCK, SR);
    core.writeReg(0x0e, 0x20); core.writeReg(0x16, 100); core.writeReg(0x26, 2 << 1); core.writeReg(0x36, 0x00);
    core.writeReg(0x0e, 0x30);
    return renderPeak(core, 0, 8192);
  }
  function bdMelodicPeak() {
    const core = new OpllCore(CLOCK, SR);
    const rom = OpllCore.INSTRUMENT_ROM[16];
    for (let i = 0; i < 8; i++) core.writeReg(i, rom[i]);
    core.writeReg(0x30, 0x00); core.writeReg(0x10, 100); core.writeReg(0x20, (2 << 1) | (1 << 4));
    return renderPeak(core, 0, 8192);
  }
  const ratio = bdRhythmPeak() / bdMelodicPeak();
  check('drums are +3 dB (RHYTHM_GAIN ≈ 1.413) over the same melodic voice', approx(ratio, OpllCore.RHYTHM_GAIN, 1e-3), `ratio ${ratio.toFixed(4)} vs ${OpllCore.RHYTHM_GAIN.toFixed(4)}`);

  // The noise generator (the snare/hi-hat/cymbal grit): a 23-bit LFSR that stays
  // balanced around zero and never collapses to the all-zero dead state.
  const nc = new OpllCore(CLOCK, SR);
  let plus = 0, minus = 0, zero = 0, N = 50000;
  for (let i = 0; i < N; i++) { const v = nc.clockNoise(); if (v > 0) plus++; else minus++; if (nc.noiseReg === 0) zero++; }
  check('noise LFSR is roughly balanced ±1', Math.abs(plus - minus) < N * 0.1, `+${plus} / −${minus}`);
  check('noise LFSR never degenerates to all-zero', zero === 0, `zero states ${zero}`);
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
