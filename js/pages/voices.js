// pages/voices.js — stage 5: nine independent FM voices, one keyboard.
//
// Nine ChannelPanel strips, each its own instrument/volume/pitch, plus a mixed
// scope. The shell's polyphonic keyboard drives the voice allocator across all
// nine channels; each strip lights when its channel is keyed.

import { store } from '../store.js';
import { mountShell } from '../shell.js';
import { startVizLoop } from '../loop.js';
import { Scope } from '../components/scope.js';
import { ChannelPanel } from '../panels/channel.js';
import { createChallenges } from '../components/challenge.js';
import { midiToFnumBlock } from '../opll-spec.js';

const N_CH = 9;

// A real 2:1 user patch shared by all nine channels, so the keyboard is a uniform
// polyphonic FM instrument out of the box; each strip can then diverge.
store.set(0x00, 0x22); store.set(0x01, 0x21);
store.set(0x02, 0x10); store.set(0x03, 0x00);
store.set(0x04, 0xf5); store.set(0x05, 0xf4);
store.set(0x06, 0x23); store.set(0x07, 0x33);
const a4 = midiToFnumBlock(69);
for (let ch = 0; ch < N_CH; ch++) {
  store.set(0x30 + ch, 0x00);
  store.setFnum(ch, a4.fnum); store.setBlock(ch, a4.block);
}

mountShell('voices', { keyboard: 'poly', octaves: 3 });

const voicesEl = document.getElementById('voices');
for (let ch = 0; ch < N_CH; ch++) {
  const strip = document.createElement('div');
  voicesEl.appendChild(strip);
  new ChannelPanel(strip, store, ch);
}

createChallenges(document.getElementById('challenges'), [
  {
    id: 'chord',
    task: 'Play a <b>chord</b> — hold three or more keys at once and hear them across the voices.',
    hint: 'The allocator spreads held notes over the nine channels.',
    test: () => {
      let keyed = 0;
      for (let ch = 0; ch < N_CH; ch++) if ((store.get(0x20 + ch) >> 4) & 1) keyed++;
      return keyed >= 3;
    },
  },
  {
    id: 'diverge',
    task: 'Give <b>channel 2</b> a different instrument from channel 1 in its mixer strip.',
    hint: 'Each strip has its own instrument select.',
    test: () => ((store.get(0x31) >> 4) & 0x0f) !== ((store.get(0x30) >> 4) & 0x0f),
  },
]);

const scope = new Scope(document.getElementById('scope'));
const line = () => getComputedStyle(scope.canvas).getPropertyValue('--scope-line').trim();
startVizLoop((viz) => {
  // Sum the (phase-reset) live traces of every channel for a mixed view; each
  // sounding channel is faintly overlaid.
  const F = 1024;
  const mix = new Float32Array(F);
  const overlays = [];
  let sounding = 0;
  for (let ch = 0; ch < N_CH; ch++) {
    const d = viz.renderScope(F, ch);
    if (!d.live) continue;
    sounding++;
    for (let i = 0; i < F; i++) mix[i] += d.carrier[i] / 3;
    if (overlays.length < 9) overlays.push({ data: d.carrier, color: line(), alpha: 0.18, bipolar: true });
  }
  scope.draw(mix, { overlays, label: `mix · ${sounding} sounding` });
});
