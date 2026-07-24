// pages/msx.js — stage 7: the ports, and the write-only shadow story.
//
// A prose page for now (the full interactive code view is Phase 8). It does one
// live thing: echo the most recent register write as the pair of Z80 OUTs that
// would produce it, so the "everything is a 7Ch/7Dh write" claim is concrete.

import { store } from '../store.js';
import { mountShell } from '../shell.js';
import { midiToFnumBlock } from '../opll-spec.js';

// Seed a plain audible voice so poking the keyboard/register file makes sound.
store.set(0x00, 0x22); store.set(0x01, 0x21);
store.set(0x02, 0x10); store.set(0x03, 0x00);
store.set(0x04, 0xf5); store.set(0x05, 0xf4);
store.set(0x06, 0x23); store.set(0x07, 0x33);
const a4 = midiToFnumBlock(69);
for (let ch = 0; ch < 9; ch++) { store.set(0x30 + ch, 0x00); store.setFnum(ch, a4.fnum); store.setBlock(ch, a4.block); }

mountShell('msx', { keyboard: 'poly', octaves: 3 });

const hx = (n) => n.toString(16).toUpperCase().padStart(2, '0');
const out = document.getElementById('lastWrite');
store.subscribe((e) => {
  if (e.type !== 'reg') return;
  out.textContent =
    `LD A,${hx(e.addr)}h · OUT (7Ch),A · LD A,${hx(e.value)}h · OUT (7Dh),A`;
});
