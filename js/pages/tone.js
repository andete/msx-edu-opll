// pages/tone.js — stage 1: one operator, a sine, and its pitch.
//
// The carrier alone, at full volume, with the modulator silenced (TL 63) so the
// scope shows a clean sine and the pitch formula stands on its own. FM (stage 3)
// then *adds* the modulator to something already familiar.

import { store } from '../store.js';
import { mountShell } from '../shell.js';
import { startVizLoop } from '../loop.js';
import { Scope } from '../components/scope.js';
import { PitchPanel } from '../panels/pitch.js';
import { OperatorPanel } from '../panels/operator.js';
import { createChallenges } from '../components/challenge.js';
import { midiToFnumBlock, fnumBlockToFreq } from '../opll-spec.js';

const CH = 0;

// A single sustained carrier sine: modulator silent, carrier full sine, both
// operators held open so the tone rings while a key is down.
store.set(0x00, 0x20); // mod: EG-sustain, ML 0
store.set(0x01, 0x21); // car: EG-sustain, ML 1
store.set(0x02, 0x3f); // mod TL 63 — effectively silent, so no FM
store.set(0x03, 0x00); // car: full sine, feedback 0
store.set(0x04, 0xf0); // mod AR 15
store.set(0x05, 0xf0); // car AR 15, DR 0 — no decay, a steady tone
store.set(0x06, 0x00); // mod SL/RR 0
store.set(0x07, 0x0f); // car SL 0, RR 15 — clean release on key-off
store.set(0x30, 0x00); // ch1 instrument 0 (user), volume 0 (loudest)
const a4 = midiToFnumBlock(69);
store.setFnum(CH, a4.fnum); store.setBlock(CH, a4.block);
store.keyOn(CH, true);   // keyed on at seed, so the header Play sounds at once

mountShell('tone', { keyboard: 'focus', octaves: 3 });

new PitchPanel(document.getElementById('pitch'), store, CH);
// Multiple only: the envelope is stage 2 and the half-sine wave is stage 3, so
// neither belongs on the panel yet. The seeded registers keep the tone steady.
new OperatorPanel(document.getElementById('operator'), store, 'car', CH, { wave: false, envelope: false });

const freqEl = document.querySelector('[data-freq]');

createChallenges(document.getElementById('challenges'), [
  {
    id: 'a4',
    task: 'Tune the operator to <b>A4</b> — F-Number <code>290</code>, Block <code>4</code>.',
    hint: 'The formula note above spells it out: 440 Hz.',
    test: () => {
      const f = (store.get(0x10) | ((store.get(0x20) & 1) << 8));
      const b = (store.get(0x20) >> 1) & 7;
      return f === 290 && b === 4;
    },
  },
  {
    id: 'octave',
    task: 'Raise the <b>Block</b> by one to send the same F-Number an octave up.',
    hint: 'Block is the exponent — +1 doubles the frequency.',
    test: () => ((store.get(0x20) >> 1) & 7) >= 5,
  },
  {
    id: 'multiple',
    task: 'Set the carrier <b>Multiple</b> to ×2 — the operator now sounds an octave above its F-Number.',
    hint: 'Multiple multiplies the operator frequency; ×2 = one octave.',
    test: () => (store.get(0x01) & 0x0f) === 2,
  },
]);

const scope = new Scope(document.getElementById('scope'));
startVizLoop((viz, dt, playing) => {
  const data = viz.renderScope(1024, CH);
  // The steady reference trace is always visible; the live carrier overlays it
  // when a note is sounding.
  scope.draw(data.reference, {
    label: 'carrier — one sine',
    overlays: playing && data.live ? [{ data: data.carrier, color: getComputedStyle(scope.canvas).getPropertyValue('--scope-line').trim(), alpha: 0.35, bipolar: true }] : [],
  });
  const snap = viz.snapshot(CH);
  freqEl.textContent = `${fnumBlockToFreq(snap.fnum, snap.block).toFixed(1)} Hz`;
});
