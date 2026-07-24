// pages/fm.js — stage 3 ★: the modulator, and phase modulation itself.
//
// Now the modulator is audible and warps the carrier's phase. The ★ operator
// pair shows the modulator → FM link → carrier, and the harmonic bars show what
// FM does to the carrier's timbre, live. The star page of the site.

import { store } from '../store.js';
import { mountShell } from '../shell.js';
import { startVizLoop } from '../loop.js';
import { OperatorPair } from '../components/operator-pair.js';
import { Harmonics } from '../components/harmonics.js';
import { OperatorPanel } from '../panels/operator.js';
import { createChallenges } from '../components/challenge.js';
import { midiToFnumBlock, fnumBlockToFreq } from '../opll-spec.js';

const CH = 0;

// An audible 2:1 FM patch: modulator ×2 over carrier ×1, moderate depth, feedback
// 0 (so the reader hears feedback appear when they add it), both sustained.
store.set(0x00, 0x22); store.set(0x01, 0x21);
store.set(0x02, 0x10); // mod TL 16 — moderate FM depth
store.set(0x03, 0x00);
store.set(0x04, 0xf5); store.set(0x05, 0xf4);
store.set(0x06, 0x23); store.set(0x07, 0x33);
store.set(0x30, 0x00);
const a4 = midiToFnumBlock(69);
store.setFnum(CH, a4.fnum); store.setBlock(CH, a4.block);
store.keyOn(CH, true);   // keyed on at seed, so the header Play sounds at once

mountShell('fm', { keyboard: 'focus', octaves: 3 });

new OperatorPanel(document.getElementById('operator-mod'), store, 'mod', CH);
new OperatorPanel(document.getElementById('operator-car'), store, 'car', CH);

createChallenges(document.getElementById('challenges'), [
  {
    id: 'bell',
    task: 'Make a <b>bell</b>: modulator <b>Multiple</b> ×2 over a ×1 carrier, with real FM depth (modulator <b>TL</b> ≤ 20).',
    hint: 'The 2:1 ratio lands the sidebands on harmonics; lower TL = deeper FM.',
    test: () => (store.get(0x00) & 0x0f) === 2 && (store.get(0x01) & 0x0f) === 1 && (store.get(0x02) & 0x3f) <= 20,
  },
  {
    id: 'feedback',
    task: 'Add <b>feedback</b> on the modulator (≥ 4) and hear the edge it puts on the tone.',
    hint: 'Feedback is the modulator routed back into itself.',
    test: () => (store.get(0x03) & 0x07) >= 4,
  },
  {
    id: 'clang',
    task: 'Make it <b>clangy</b>: an off-ratio modulator — Multiple ×3 or higher against the ×1 carrier.',
    hint: 'Inharmonic ratios push energy onto non-harmonic partials.',
    test: () => (store.get(0x00) & 0x0f) >= 3 && (store.get(0x01) & 0x0f) === 1,
  },
]);

const pair = new OperatorPair(document.getElementById('pair'));
const harmonics = new Harmonics(document.getElementById('harmonics'));
startVizLoop((viz) => {
  const data = viz.renderPair(2048, CH);
  const snap = viz.snapshot(CH);
  const fb = viz.effectivePatch(CH).mod.fb;
  pair.draw(data, { fb, show: 640 });
  const f0 = fnumBlockToFreq(snap.fnum, snap.block) / viz.sampleRate;
  harmonics.set(data.carrier, f0);
});
