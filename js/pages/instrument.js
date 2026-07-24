// pages/instrument.js — stage 4 ★: the 8-byte patch + the ROM gallery.
//
// The patch panel shows the User slot and the 15 ROM instruments as a gallery
// (each with its harmonic fingerprint), with copy-to-user. The operator panels
// and the harmonic bars follow the focus voice, so a copied ROM patch becomes
// immediately editable.

import { store } from '../store.js';
import { mountShell } from '../shell.js';
import { startVizLoop } from '../loop.js';
import { PatchPanel } from '../components/patch-panel.js';
import { Harmonics } from '../components/harmonics.js';
import { OperatorPanel } from '../panels/operator.js';
import { createChallenges } from '../components/challenge.js';
import { midiToFnumBlock, fnumBlockToFreq } from '../opll-spec.js';

const CH = 0;

// Start on a real 2:1 user patch so the User tile is audible before any ROM is
// chosen; A4, keyed off.
store.set(0x00, 0x22); store.set(0x01, 0x21);
store.set(0x02, 0x10); store.set(0x03, 0x00);
store.set(0x04, 0xf5); store.set(0x05, 0xf4);
store.set(0x06, 0x23); store.set(0x07, 0x33);
store.set(0x30, 0x00);
const a4 = midiToFnumBlock(69);
store.setFnum(CH, a4.fnum); store.setBlock(CH, a4.block);

mountShell('instrument', { keyboard: 'focus', octaves: 3 });

new PatchPanel(document.getElementById('patch'), store, CH);
new OperatorPanel(document.getElementById('operator-mod'), store, 'mod', CH);
new OperatorPanel(document.getElementById('operator-car'), store, 'car', CH);

createChallenges(document.getElementById('challenges'), [
  {
    id: 'pick-organ',
    task: 'Load the <b>Organ</b> (instrument 8) from the gallery and play it.',
    hint: 'Click its tile — the active tile follows the channel instrument.',
    test: () => ((store.get(0x30) >> 4) & 0x0f) === 8,
  },
  {
    id: 'copy-to-user',
    task: 'Copy any <b>ROM</b> instrument into the <b>User</b> slot with <b>copy → user ✎</b>, so slot 0 is now that sound.',
    hint: 'The gallery switches to slot 0 after copying; the user bytes change.',
    test: () => ((store.get(0x30) >> 4) & 0x0f) === 0 &&
      // any non-trivial user patch (not the all-zero default)
      (store.get(0x00) || store.get(0x01) || store.get(0x04) || store.get(0x05)) !== 0,
  },
  {
    id: 'edit',
    task: 'With the User slot active, change the carrier <b>Multiple</b> — you are now editing a patch by hand.',
    hint: 'Slot 0 must be active for the operator panels to bite.',
    test: () => ((store.get(0x30) >> 4) & 0x0f) === 0 && (store.get(0x01) & 0x0f) !== 1,
  },
]);

const harmonics = new Harmonics(document.getElementById('harmonics'));
startVizLoop((viz) => {
  const data = viz.renderPair(2048, CH);
  const snap = viz.snapshot(CH);
  const f0 = fnumBlockToFreq(snap.fnum, snap.block) / viz.sampleRate;
  harmonics.set(data.carrier, f0);
});
