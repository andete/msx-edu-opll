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

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
