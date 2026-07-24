// pages/index.js — Phase 1 vertical slice orchestrator.
//
// One voice (channel 1 / index 0), the user instrument set to a clean sustained
// sine (the modulator silenced, so it's a pure carrier tone — FM arrives in a
// later phase). Proves the whole pipeline: UI → store → worklet → audio, and
// store → the main-thread viz core → the scope. See design/build-plan.md §5, P1.

import { store } from '../store.js';
import { startVizLoop } from '../loop.js';
import { Scope } from '../components/scope.js';
import { Piano } from '../components/piano.js';
import { RegisterInspector } from '../components/register-inspector.js';
import { AdsrView } from '../components/adsr-view.js';
import { PitchPanel } from '../panels/pitch.js';
import { OperatorPanel } from '../panels/operator.js';
import { MasterPanel } from '../panels/master.js';
import { midiToFnumBlock } from '../opll-spec.js';

const CH = 0;

// The user instrument (registers 00–07): a pure carrier sine (the modulator is
// silenced with TL 63 → no FM yet) shaped by a musical carrier ADSR, so pressing
// a key gives an attack, a decay to a sustain, and a release. FM arrives later.
function seedPatch() {
  store.set(0x00, 0x21); // mod: EG(sustain)=1, ML=1
  store.set(0x01, 0x21); // car: EG(sustain)=1, ML=1
  store.set(0x02, 0x3f); // mod: KSL 0, TL 63 (silent modulator)
  store.set(0x03, 0x00); // car KSL 0, full sine both ops, feedback 0
  store.set(0x04, 0xf0); // mod: AR 15, DR 0 (irrelevant while silent)
  store.set(0x05, 0xd8); // car: AR 13, DR 8
  store.set(0x06, 0x0f); // mod: SL 0, RR 15
  store.set(0x07, 0x47); // car: SL 4, RR 7
  store.set(0x30 + CH, 0x00); // ch1: instrument 0 (user), volume 0 (loudest)
  const { fnum, block } = midiToFnumBlock(69); // A4
  store.setFnum(CH, fnum);
  store.setBlock(CH, block);
}

function mount() {
  seedPatch();

  const scope = new Scope(document.getElementById('scope'));
  const adsr = new AdsrView(document.getElementById('adsr'));
  new PitchPanel(document.getElementById('pitch'), store, CH);
  new OperatorPanel(document.getElementById('operator'), store, 'car', CH);
  new MasterPanel(document.getElementById('master'));
  new RegisterInspector(document.getElementById('regs'), store);

  new Piano(document.getElementById('piano'), {
    base: 48, octaves: 3,
    onNoteOn: (midi) => {
      const { fnum, block } = midiToFnumBlock(midi);
      store.setFnum(CH, fnum);
      store.setBlock(CH, block);
      store.keyOn(CH, true);
    },
    onNoteOff: () => store.keyOn(CH, false),
  });

  const modColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--scope-mod').trim() || '#e0a24a';

  startVizLoop((viz) => {
    // scope: the carrier waveform (timbre), modulator overlaid
    const { carrier, modulator } = viz.renderScope(1024, CH);
    scope.draw(carrier, {
      overlays: [{ data: modulator, color: modColor, alpha: 0.35, bipolar: true }],
      label: 'ch1 carrier',
    });
    // ADSR: the carrier envelope schematic + the live playhead
    adsr.draw(viz.effectivePatch(CH).car, viz.snapshot(CH).car);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
