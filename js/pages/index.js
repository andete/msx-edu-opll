// pages/index.js — Phase 3 sandbox orchestrator: full two-operator FM.
//
// One voice (channel 1 / index 0). The user instrument (registers 00–07) is now a
// real FM patch — the modulator is audible and phase-modulates the carrier. The
// ★ operator-pair shows the modulator, the FM link and the carrier; the harmonic
// bars show what FM does to the carrier's timbre, live. Everything still flows
// through the store → worklet (audio) and store → the main-thread viz core (the
// scopes). See design/build-plan.md §5, Phase 3.

import { store } from '../store.js';
import { startVizLoop } from '../loop.js';
import { OperatorPair } from '../components/operator-pair.js';
import { Harmonics } from '../components/harmonics.js';
import { Piano } from '../components/piano.js';
import { RegisterInspector } from '../components/register-inspector.js';
import { AdsrView } from '../components/adsr-view.js';
import { PitchPanel } from '../panels/pitch.js';
import { OperatorPanel } from '../panels/operator.js';
import { MasterPanel } from '../panels/master.js';
import { midiToFnumBlock, fnumBlockToFreq } from '../opll-spec.js';

const CH = 0;

// The user instrument (registers 00–07): an audible FM patch with a 2:1 ratio
// (modulator Multiple ×2 over a carrier ×1) — a clear, bell-ish timbre so the FM
// is obvious the moment you press a key. The modulator's Total Level sets a
// moderate FM depth; feedback starts at 0 so the user hears its effect when they
// raise it. Both operators are sustained (EG-type 1) so the tone holds while a
// key is down and the harmonic bars settle for inspection.
function seedPatch() {
  store.set(0x00, 0x22); // mod: EG(sustain)=1, ML=2  (×2 → the 2:1 ratio)
  store.set(0x01, 0x21); // car: EG(sustain)=1, ML=1  (×1)
  store.set(0x02, 0x10); // mod: KSL 0, TL 16 (moderate FM depth)
  store.set(0x03, 0x00); // car KSL 0, full sine both ops, feedback 0
  store.set(0x04, 0xf5); // mod: AR 15, DR 5
  store.set(0x05, 0xf4); // car: AR 15, DR 4
  store.set(0x06, 0x23); // mod: SL 2, RR 3
  store.set(0x07, 0x33); // car: SL 3, RR 3
  store.set(0x30 + CH, 0x00); // ch1: instrument 0 (user), volume 0 (loudest)
  const { fnum, block } = midiToFnumBlock(69); // A4
  store.setFnum(CH, fnum);
  store.setBlock(CH, block);
}

function mount() {
  seedPatch();

  const pair = new OperatorPair(document.getElementById('pair'));
  const harmonics = new Harmonics(document.getElementById('harmonics'));
  const adsr = new AdsrView(document.getElementById('adsr'));
  new PitchPanel(document.getElementById('pitch'), store, CH);
  new OperatorPanel(document.getElementById('operator-mod'), store, 'mod', CH);
  new OperatorPanel(document.getElementById('operator-car'), store, 'car', CH);
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

  startVizLoop((viz) => {
    // ★ operator pair: modulator → (FM) → carrier, rendered steady (envelope
    // open) so the FM timbre is always visible; the link thickness follows the
    // modulator's feedback. The window is long enough for a clean harmonic
    // analysis; the pair only *shows* the first ~640 samples (a few readable
    // cycles at musical pitches).
    const data = viz.renderPair(2048, CH);
    const snap = viz.snapshot(CH);
    const fb = viz.effectivePatch(CH).mod.fb;
    pair.draw(data, { fb, show: 640 });

    // carrier harmonics, binned against the voice fundamental (F-Number/Block at
    // Multiple 1), in cycles per sample.
    const f0 = fnumBlockToFreq(snap.fnum, snap.block) / viz.sampleRate;
    harmonics.set(data.carrier, f0);

    // the carrier ADSR schematic + the live playhead
    adsr.draw(viz.effectivePatch(CH).car, snap.car);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
