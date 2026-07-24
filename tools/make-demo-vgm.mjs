#!/usr/bin/env node
/*
 * make-demo-vgm.mjs — write assets/demo.vgm, an original OPLL+PSG tune.
 *
 *     node tools/make-demo-vgm.mjs
 *
 * The Tune page needs something to play before a visitor has a file of their own,
 * and shipping someone else's music would mean redistributing a rip we have no
 * right to. So we generate one. This is a small 50 Hz sound driver emitting its
 * register writes into a VGM log instead of into a chip.
 *
 * It is written to demonstrate exactly what the site teaches:
 *
 *   • it selects ROM instruments per channel and CHANGES the lead's instrument
 *     between sections, so the channel strips + register file visibly move;
 *   • it keys FM notes on and off — unlike the SCC there is no by-hand volume
 *     envelope, because the OPLL has a real ADSR per operator doing that job;
 *   • it puts the drums on the MSX PSG's noise channel — MSX-MUSIC tunes keep
 *     percussion on the AY next door, which the Tune page plays alongside the OPLL
 *     via a borrowed msx-edu-psg worklet.
 *
 * Output is VGM 1.61, declaring the YM2413 at 3 579 545 Hz (the true MSX rate,
 * which our core also runs at) and the AY-3-8910 PSG at master/2.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'assets', 'demo.vgm');

const MASTER = 3579545;
const FSAM = MASTER / 72;
const PSG_CLOCK = 1789772;         // MSX PSG = master/2, what a real MSX rip declares

const cmds = [];
/** VGM: write `val` to YM2413 register `reg`. */
const w = (reg, val) => cmds.push(0x51, reg & 0xff, val & 0xff);
/** VGM: write `val` to register `reg` of the AY-3-8910 (the MSX PSG). */
const ay = (reg, val) => cmds.push(0xa0, reg & 0x0f, val & 0xff);
const frame = () => cmds.push(0x63);          // wait one PAL frame

// --- Pitch: MIDI note -> (F-Number, Block) ----------------------------------

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
function fnumBlock(midi) {
  const hz = midiToFreq(midi);
  for (let block = 0; block <= 7; block++) {
    const fnum = Math.round((hz * Math.pow(2, 19 - block)) / FSAM);
    if (fnum <= 511) return { fnum: Math.max(0, fnum), block };
  }
  return { fnum: 511, block: 7 };
}
const N = (name, oct) => {
  const names = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
  return names[name] + (oct + 1) * 12;
};

// --- The OPLL, as seen from a driver ----------------------------------------

// Per-channel shadow of register 20 (block/key/sustain/F-hi), so key on/off can
// flip just its bit without disturbing the pitch — exactly what a real driver's
// RAM shadow is for.
const reg20 = new Uint8Array(9);

function setInstrument(ch, inst, vol) { w(0x30 + ch, ((inst & 0x0f) << 4) | (vol & 0x0f)); }
function setPitch(ch, midi) {
  const { fnum, block } = fnumBlock(midi);
  w(0x10 + ch, fnum & 0xff);
  reg20[ch] = (reg20[ch] & 0x20) | (block << 1) | ((fnum >> 8) & 1);  // keep SUS, clear key
  w(0x20 + ch, reg20[ch]);
}
function key(ch, on) {
  if (on) reg20[ch] |= 0x10; else reg20[ch] &= ~0x10;
  w(0x20 + ch, reg20[ch]);
}
/** Retrigger a note: key off, set the new pitch, key on (the OPLL wants the edge). */
function noteOn(ch, midi) { key(ch, false); setPitch(ch, midi); key(ch, true); }

// --- The PSG drum voice ------------------------------------------------------
// The OPLL has its own rhythm mode, but MSX-MUSIC drivers usually run drums on
// the PSG so all nine FM voices stay melodic — one noise channel, its amplitude
// nudged down by hand on the interrupt. We use PSG channel A in noise-only mode.
const drum = { vol: 0, decay: 0 };
function drumHit(period, vol, decay) {
  ay(6, period & 0x1f);       // R6: noise period
  ay(8, vol & 0x0f);          // R8: channel A amplitude
  drum.vol = vol; drum.decay = decay;
}

// --- The piece --------------------------------------------------------------
// Am – F – C – G, seven frames a sixteenth (~100 BPM), sixteen steps a bar.
// Instrument indices: 3 Piano, 4 Flute, 7 Trumpet, 8 Organ, 12 Vibraphone,
// 13 Synth Bass, 2 Guitar.

const STEP_FRAMES = 7;
const CHORDS = [
  { root: N('A', 2), notes: [N('A', 3), N('C', 4), N('E', 4)] },
  { root: N('F', 2), notes: [N('F', 3), N('A', 3), N('C', 4)] },
  { root: N('C', 3), notes: [N('C', 4), N('E', 4), N('G', 4)] },
  { root: N('G', 2), notes: [N('G', 3), N('B', 3), N('D', 4)] },
];
const ARP = [0, 1, 2, 1, 2, 1, 0, 1];
const LEADS = [7, 2, 4, 12];   // Trumpet, Guitar, Flute, Vibraphone — one per section

// Voice map: ch0 bass · ch1-3 chord (Organ) · ch4 lead · drums on the PSG.
setInstrument(0, 13, 0);       // Synth Bass, loudest
for (let ch = 1; ch <= 3; ch++) setInstrument(ch, 8, 4);   // Organ pad, a touch back
setInstrument(4, LEADS[0], 2); // Lead

// PSG channel A in noise-only mode: tone A off, noise A on, rest off. R7 is
// active-low, so a set bit disables.
ay(7, 0x3f & ~0x08);   // 0x37
ay(8, 0);

function tickFrame() {
  if (drum.decay && drum.vol > 0) {
    const next = Math.max(0, drum.vol - drum.decay);
    if (next !== drum.vol) { drum.vol = next; ay(8, drum.vol); }
  }
  frame();
}

for (let section = 0; section < 4; section++) {
  setInstrument(4, LEADS[section], 2);              // swap the lead instrument
  if (section === 2) for (let ch = 1; ch <= 3; ch++) setInstrument(ch, 3, 4); // pad → Piano

  for (let bar = 0; bar < 4; bar++) {
    const chord = CHORDS[bar % CHORDS.length];
    for (let step = 0; step < 16; step++) {
      // Bass on the beat, an octave hop mid-bar.
      if (step % 4 === 0) noteOn(0, chord.root + (step === 8 ? 12 : 0));
      // Chord stab at the top of each bar, released two steps before the next.
      if (step === 0) for (let i = 0; i < 3; i++) noteOn(1 + i, chord.notes[i]);
      if (step === 14) for (let i = 1; i <= 3; i++) key(i, false);
      // Lead arpeggio every other sixteenth, up an octave in the back half.
      if (step % 2 === 0) {
        const midi = chord.notes[ARP[(step / 2) % ARP.length] % 3] + (section >= 2 ? 12 : 0);
        noteOn(4, midi);
      }
      // PSG drums: kick on the beat, snare on the backbeat, hats on the off-beats.
      if (step % 8 === 0) drumHit(30, 14, 2);          // kick (0, 8)
      else if (step % 8 === 4) drumHit(7, 13, 2);      // snare (4, 12)
      else if (step % 2 === 0) drumHit(1, 6, 3);       // hat

      for (let f = 0; f < STEP_FRAMES; f++) tickFrame();
    }
  }
}

// Tail: release everything and let the FM releases ring out over a few frames.
drum.decay = 0; drum.vol = 0; ay(8, 0);
for (let ch = 0; ch < 5; ch++) key(ch, false);
for (let i = 0; i < 30; i++) frame();
ay(7, 0x3f);           // PSG: everything off
cmds.push(0x66);       // end of sound data

// --- Assemble the file ------------------------------------------------------

const HEADER = 0x100;

function countSamples(stream) {
  let n = 0;
  for (let i = 0; i < stream.length;) {
    const c = stream[i];
    if (c === 0x51) { i += 3; continue; }
    if (c === 0xa0) { i += 3; continue; }
    if (c === 0x63) { n += 882; i += 1; continue; }
    if (c === 0x62) { n += 735; i += 1; continue; }
    if (c === 0x61) { n += stream[i + 1] | (stream[i + 2] << 8); i += 3; continue; }
    if (c === 0x66) break;
    i += 1;
  }
  return n;
}

/** GD3 tag: UTF-16LE, NUL-separated, in the spec's field order. */
function gd3(fields) {
  const text = fields.join('\0') + '\0';
  const body = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    body[i * 2] = text.charCodeAt(i) & 0xff;
    body[i * 2 + 1] = (text.charCodeAt(i) >> 8) & 0xff;
  }
  const out = new Uint8Array(12 + body.length);
  out.set([0x47, 0x64, 0x33, 0x20], 0);              // "Gd3 "
  const v = new DataView(out.buffer);
  v.setUint32(4, 0x00000100, true);                   // version 1.00
  v.setUint32(8, body.length, true);
  out.set(body, 12);
  return out;
}

const data = Uint8Array.from(cmds);
const tag = gd3([
  'Four Chords, Fifteen Voices', '',                  // track, track (JP)
  'OPLL Playground demo', '',                          // game, game (JP)
  'MSX + Yamaha YM2413 (OPLL) + PSG (AY-3-8910)', '',  // system, system (JP)
  'Joost Yervante Damad', '',                          // author, author (JP)
  '2026',                                              // release date
  'tools/make-demo-vgm.mjs',                           // ripped by
  'An original OPLL+PSG demo, generated rather than ripped, for msx-edu-opll. MIT licensed like the rest of the project.',
]);

const total = HEADER + data.length + tag.length;
const out = new Uint8Array(total);
const view = new DataView(out.buffer);
out.set([0x56, 0x67, 0x6d, 0x20], 0);                 // "Vgm "
view.setUint32(0x04, total - 4, true);                // EOF offset
view.setUint32(0x08, 0x00000161, true);               // version 1.61
view.setUint32(0x10, MASTER, true);                   // YM2413 (OPLL) clock
view.setUint32(0x14, (HEADER + data.length) - 0x14, true);  // GD3 offset
view.setUint32(0x18, countSamples(cmds), true);       // total samples
view.setUint32(0x24, 50, true);                       // rate hint: 50 Hz (PAL)
view.setUint32(0x34, HEADER - 0x34, true);            // data offset
view.setUint32(0x74, PSG_CLOCK, true);                // AY8910 (PSG) clock
out.set(data, HEADER);
out.set(tag, HEADER + data.length);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);

let writes = 0, psgWrites = 0;
for (let i = 0; i < cmds.length;) {
  if (cmds[i] === 0x51) { writes++; i += 3; }
  else if (cmds[i] === 0xa0) { psgWrites++; i += 3; }
  else if (cmds[i] === 0x61) i += 3;
  else i += 1;
}
console.log(`wrote ${OUT}`);
console.log(`  ${out.length} bytes, ${(countSamples(cmds) / 44100).toFixed(1)} s, ${writes} OPLL + ${psgWrites} PSG writes`);
