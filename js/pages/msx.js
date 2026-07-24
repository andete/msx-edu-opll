// pages/msx.js — stage 7: the ports, the write-only shadow, and the code view.
//
// The code view is generated live from the register file, so the "everything is
// a 7Ch/7Dh write" claim is not just told — it is shown, for whatever the chip is
// doing right now, and it rewrites itself as you play.

import { store } from '../store.js';
import { mountShell } from '../shell.js';
import { createCodeView } from '../components/code-view.js';
import { midiToFnumBlock } from '../opll-spec.js';

// Seed a plain audible voice so poking the keyboard/register file makes sound.
store.set(0x00, 0x22); store.set(0x01, 0x21);
store.set(0x02, 0x10); store.set(0x03, 0x00);
store.set(0x04, 0xf5); store.set(0x05, 0xf4);
store.set(0x06, 0x23); store.set(0x07, 0x33);
const a4 = midiToFnumBlock(69);
for (let ch = 0; ch < 9; ch++) { store.set(0x30 + ch, 0x00); store.setFnum(ch, a4.fnum); store.setBlock(ch, a4.block); }

mountShell('msx', { keyboard: 'poly', octaves: 3 });

createCodeView(document.getElementById('code'));
