// voices.js — the polyphonic voice allocator (Phase 5).
//
// The OPLL has nine independent FM channels. A keyboard press is a *note*, not a
// channel, so something has to hand each held note a free channel and take it
// back on release — that is voice allocation. This maps MIDI notes onto the nine
// channels round-robin, stealing the oldest-held voice when all nine are busy
// (the same behaviour a real MSX-MUSIC driver's key-assign does).
//
// It writes only pitch (F-Number/Block) and Key-On through the store — never the
// instrument or volume — so each channel keeps whatever timbre its mixer strip
// set. Everything downstream (audio worklet, viz core, register inspector,
// channel strips) reacts to those store writes; the allocator owns no sound
// state of its own, only the note↔channel bookkeeping.

import { midiToFnumBlock } from './opll-spec.js';

export class VoiceAllocator {
  constructor(store, { channels = 9, onChange = null } = {}) {
    this.store = store;
    this.channels = channels;
    this.onChange = onChange || (() => {});
    this.noteOf = new Array(channels).fill(null); // channel → the MIDI note it holds, or null
    this.byNote = new Map();                       // MIDI note → channel currently sounding it
    this.order = [];                               // busy channels, oldest first (steal target)
  }

  /** Press a note. Returns the channel it landed on. A repeat of a held note is
   *  a no-op (the key is already down). */
  noteOn(midi) {
    if (this.byNote.has(midi)) return this.byNote.get(midi);

    let ch = this.noteOf.indexOf(null);            // a free channel, lowest index first
    if (ch === -1) {                               // all busy → steal the oldest
      ch = this.order.shift();
      const stolen = this.noteOf[ch];
      if (stolen != null) { this.byNote.delete(stolen); this.store.keyOn(ch, false); }
    }

    const { fnum, block } = midiToFnumBlock(midi);
    this.store.setFnum(ch, fnum);
    this.store.setBlock(ch, block);
    this.store.keyOn(ch, true);

    this.noteOf[ch] = midi;
    this.byNote.set(midi, ch);
    this.order.push(ch);
    this.onChange();
    return ch;
  }

  /** Release a note (whichever channel is holding it). */
  noteOff(midi) {
    const ch = this.byNote.get(midi);
    if (ch == null) return;
    this.store.keyOn(ch, false);
    this.noteOf[ch] = null;
    this.byNote.delete(midi);
    const i = this.order.indexOf(ch);
    if (i >= 0) this.order.splice(i, 1);
    this.onChange();
  }

  /** Release every held note (panic / stop). */
  allNotesOff() {
    for (const midi of [...this.byNote.keys()]) this.noteOff(midi);
  }
}
