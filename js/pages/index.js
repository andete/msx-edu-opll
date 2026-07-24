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
import { PitchPanel } from '../panels/pitch.js';
import { MasterPanel } from '../panels/master.js';
import { midiToFnumBlock } from '../opll-spec.js';

const CH = 0;

// A clean sustained sine on the user instrument (registers 00–07):
//   modulator TL = 63 (fully attenuated → no FM, pure carrier)
//   both operators: instant attack, sustained envelope, full sine, no feedback
function seedSinePatch() {
  store.set(0x00, 0x21); // mod: EG(sustain)=1, ML=1
  store.set(0x01, 0x21); // car: EG(sustain)=1, ML=1
  store.set(0x02, 0x3f); // mod: KSL 0, TL 63 (silent modulator)
  store.set(0x03, 0x00); // car KSL 0, full sine both ops, feedback 0
  store.set(0x04, 0xf0); // mod: AR 15, DR 0
  store.set(0x05, 0xf0); // car: AR 15, DR 0
  store.set(0x06, 0x0f); // mod: SL 0, RR 15
  store.set(0x07, 0x0f); // car: SL 0, RR 15
  store.set(0x30 + CH, 0x00); // ch1: instrument 0 (user), volume 0 (loudest)
  // default pitch A4 so the readout is meaningful before the first key press
  const { fnum, block } = midiToFnumBlock(69);
  store.setFnum(CH, fnum);
  store.setBlock(CH, block);
}

function mount() {
  seedSinePatch();

  const scope = new Scope(document.getElementById('scope'));
  new PitchPanel(document.getElementById('pitch'), store, CH);
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

  // Visualiser: draw channel 1's carrier (main) with the modulator overlaid.
  startVizLoop((viz) => {
    const { carrier, modulator } = viz.renderScope(1024, CH);
    scope.draw(carrier, {
      overlays: [{ data: modulator, color: getComputedStyle(document.documentElement)
        .getPropertyValue('--scope-mod').trim() || '#7fd', alpha: 0.35, bipolar: true }],
      label: 'ch1 carrier',
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
