// pages/envelope.js — stage 2: the ADSR envelope on the carrier.
//
// The modulator is silenced again (this page is about amplitude over time, not
// timbre), so the carrier is a plain sine whose loudness is exactly its
// envelope. The AdsrView draws the four segments and the live playhead — attack,
// decay, sustain while held, release on key-off — plus the Key-On damp.

import { store } from '../store.js';
import { mountShell } from '../shell.js';
import { startVizLoop } from '../loop.js';
import { AdsrView } from '../components/adsr-view.js';
import { OperatorPanel } from '../panels/operator.js';
import { createChallenges } from '../components/challenge.js';
import { midiToFnumBlock } from '../opll-spec.js';

const CH = 0;

// A clean carrier sine with an audible, moderate envelope to start from.
store.set(0x00, 0x20); store.set(0x01, 0x21);
store.set(0x02, 0x3f); // modulator silent
store.set(0x03, 0x00);
store.set(0x04, 0xf0); // mod fast attack (irrelevant while silent)
store.set(0x05, 0x84); // car: AR 8, DR 4 — a clear attack + decay to hear
store.set(0x06, 0x00);
store.set(0x07, 0x53); // car: SL 5, RR 3
store.set(0x30, 0x00);
const a4 = midiToFnumBlock(69);
store.setFnum(CH, a4.fnum); store.setBlock(CH, a4.block);

mountShell('envelope', { keyboard: 'focus', octaves: 3 });

new OperatorPanel(document.getElementById('operator'), store, 'car', CH);

createChallenges(document.getElementById('challenges'), [
  {
    id: 'slow-attack',
    task: 'Give the carrier a <b>slow attack</b> — set <b>AR</b> to 4 or less, so the note swells in.',
    hint: 'Attack Rate is the first slider; low = slow.',
    test: () => ((store.get(0x05) >> 4) & 0x0f) <= 4 && ((store.get(0x05) >> 4) & 0x0f) >= 1,
  },
  {
    id: 'percussive',
    task: 'Make it <b>percussive</b>: turn <b>EG-type</b> off so the note decays away even while the key is held.',
    hint: 'EG-type (the sustain-hold bit) is in the operator panel; off = percussive.',
    test: () => ((store.get(0x01) >> 5) & 1) === 0,
  },
  {
    id: 'plucky',
    task: 'Make a short <b>pluck</b>: fast attack (<b>AR</b> 15) and a quick release (<b>RR</b> ≥ 10).',
    hint: 'AR high, RR high, and percussive helps.',
    test: () => ((store.get(0x05) >> 4) & 0x0f) === 15 && (store.get(0x07) & 0x0f) >= 10,
  },
]);

const adsr = new AdsrView(document.getElementById('adsr'));
startVizLoop((viz) => {
  const snap = viz.snapshot(CH);
  adsr.draw(viz.effectivePatch(CH).car, snap.car);
});
