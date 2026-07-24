// pages/rhythm.js — stage 6: the 6 + 5 drum mode.
//
// The RhythmPanel owns register 0E (the mode bit + the five drum keys) and the
// 36-38 drum levels. The keyboard stays melodic on channels 1-6. The scope shows
// the chip's actual mixed output, so a drum hit or the demo beat is visible.

import { store } from '../store.js';
import { mountShell } from '../shell.js';
import { startVizLoop } from '../loop.js';
import { Scope } from '../components/scope.js';
import { RhythmPanel } from '../panels/rhythm.js';
import { createChallenges } from '../components/challenge.js';
import { midiToFnumBlock } from '../opll-spec.js';

// Channels 1-6 get the shared 2:1 user patch so the melodic keyboard sounds while
// you drum; channels 7-9 are handed to the drums when rhythm mode arms.
store.set(0x00, 0x22); store.set(0x01, 0x21);
store.set(0x02, 0x10); store.set(0x03, 0x00);
store.set(0x04, 0xf5); store.set(0x05, 0xf4);
store.set(0x06, 0x23); store.set(0x07, 0x33);
const a4 = midiToFnumBlock(69);
for (let ch = 0; ch < 6; ch++) {
  store.set(0x30 + ch, 0x00);
  store.setFnum(ch, a4.fnum); store.setBlock(ch, a4.block);
}

// The keyboard plays only the six melodic channels — in rhythm mode a note
// handed to 7-9 would land on a drum and stay silent.
mountShell('rhythm', { keyboard: { channels: 6 }, octaves: 3 });

new RhythmPanel(document.getElementById('rhythm'), store);

createChallenges(document.getElementById('challenges'), [
  {
    id: 'arm',
    task: 'Arm <b>Rhythm mode</b> — set bit 5 of register <code>0E</code> with the switch.',
    hint: 'The pads are dead until the mode is on.',
    test: () => ((store.get(0x0e) >> 5) & 1) === 1,
  },
  {
    id: 'hit',
    task: 'Hit a <b>drum pad</b> (or run the demo beat) so a drum key bit fires.',
    hint: 'Bits 0-4 of 0E are the five drums.',
    test: () => ((store.get(0x0e) >> 5) & 1) === 1 && (store.get(0x0e) & 0x1f) !== 0,
  },
]);

const scope = new Scope(document.getElementById('scope'));
const buf = new Float32Array(1024);
startVizLoop((viz, dt, playing) => {
  // Render the chip's real mixed output (melodic 1-6 + the five drums) into a
  // short window and show it, amplified for visibility. This advances the viz
  // core a hair beyond the envelope playhead, which is invisible on a scope.
  viz.process(buf, buf.length);
  const disp = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) disp[i] = buf[i] * 3;
  scope.draw(disp, { label: playing ? 'mixed output' : 'press Play' });
});
