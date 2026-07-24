// pages/explore.js — the full sandbox: every widget, all nine voices.
//
// The Phase 1-6 single-page playground, now living behind the shell chrome as
// one page of the split site. The deep-dive widgets (the ★ operator pair, the
// harmonics, the ADSR animator, and the pitch / operator / patch panels) follow
// a *focus voice* you pick from the Voices mixer — the seam left in Phase 5's
// ChannelPanel.onFocus, finally wired up. Everything still flows through the
// store → worklet (audio) and store → the main-thread viz core (the scopes).

import { store } from '../store.js';
import { mountShell } from '../shell.js';
import { startVizLoop } from '../loop.js';
import { OperatorPair } from '../components/operator-pair.js';
import { Harmonics } from '../components/harmonics.js';
import { AdsrView } from '../components/adsr-view.js';
import { PitchPanel } from '../panels/pitch.js';
import { OperatorPanel } from '../panels/operator.js';
import { PatchPanel } from '../components/patch-panel.js';
import { ChannelPanel } from '../panels/channel.js';
import { RhythmPanel } from '../panels/rhythm.js';
import { midiToFnumBlock, fnumBlockToFreq } from '../opll-spec.js';

const N_CH = 9;
let focusCh = 0;   // which voice the deep-dive widgets expand

// The user instrument (registers 00–07): an audible 2:1 FM patch — a clear,
// bell-ish timbre so the FM is obvious the moment you press a key. See the note
// in the original index.js; unchanged.
function seedPatch() {
  store.set(0x00, 0x22); store.set(0x01, 0x21);
  store.set(0x02, 0x10); store.set(0x03, 0x00);
  store.set(0x04, 0xf5); store.set(0x05, 0xf4);
  store.set(0x06, 0x23); store.set(0x07, 0x33);
  const { fnum, block } = midiToFnumBlock(69); // A4
  for (let ch = 0; ch < N_CH; ch++) {
    store.set(0x30 + ch, 0x00);   // instrument 0 (user), volume 0 (loudest)
    store.setFnum(ch, fnum);
    store.setBlock(ch, block);
  }
}

seedPatch();
mountShell('explore', { keyboard: 'poly' });

const pair = new OperatorPair(document.getElementById('pair'));
const harmonics = new Harmonics(document.getElementById('harmonics'));
const adsr = new AdsrView(document.getElementById('adsr'));

// The three per-channel panels are rebuilt when the focus voice changes; the
// canvas widgets above just read `focusCh` in the draw loop, so they need no
// teardown. The patch gallery follows the focus voice's instrument too.
const focusLine = document.getElementById('focusLine');
const pitchEl = document.getElementById('pitch');
const modEl = document.getElementById('operator-mod');
const carEl = document.getElementById('operator-car');
const patchEl = document.getElementById('patch');

function mountFocus(ch) {
  focusCh = ch;
  focusLine.textContent = `Focus: channel ${ch + 1} — the widgets above expand this voice.`;
  pitchEl.innerHTML = ''; modEl.innerHTML = ''; carEl.innerHTML = ''; patchEl.innerHTML = '';
  new PitchPanel(pitchEl, store, ch);
  new OperatorPanel(modEl, store, 'mod', ch);
  new OperatorPanel(carEl, store, 'car', ch);
  new PatchPanel(patchEl, store, ch);
}
mountFocus(0);

// Rhythm mode: 0E bit5 reinterprets channels 7-9 as the five drums.
new RhythmPanel(document.getElementById('rhythm'), store);

// The nine-channel mixer: one strip per voice, each a focus target.
const voicesEl = document.getElementById('voices');
const strips = [];
for (let ch = 0; ch < N_CH; ch++) {
  const strip = document.createElement('div');
  voicesEl.appendChild(strip);
  strips.push(new ChannelPanel(strip, store, ch, { onFocus: (c) => setFocus(c) }));
}
function setFocus(ch) {
  if (ch === focusCh) return;
  mountFocus(ch);
  for (let i = 0; i < strips.length; i++) strips[i].el.classList.toggle('is-focus', i === ch);
}
strips[0].el.classList.add('is-focus');

startVizLoop((viz) => {
  const ch = focusCh;
  const data = viz.renderPair(2048, ch);
  const snap = viz.snapshot(ch);
  const fb = viz.effectivePatch(ch).mod.fb;
  pair.draw(data, { fb, show: 640 });

  const f0 = fnumBlockToFreq(snap.fnum, snap.block) / viz.sampleRate;
  harmonics.set(data.carrier, f0);

  adsr.draw(viz.effectivePatch(ch).car, snap.car);
});
