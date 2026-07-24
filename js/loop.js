// loop.js — the shared visualiser: a main-thread OpllCore that mirrors the store
// (never touching the audio path) plus a requestAnimationFrame loop. Each page
// passes a draw callback that renders its own scopes / envelopes from the live
// core. Same "second core instance" trick as the sibling projects — no
// SharedArrayBuffer, no COOP/COEP headers, stays a plain static site.
// See design/build-plan.md §2.

import { store } from './store.js';
import { isPlaying } from './audio.js';

function makeCore() {
  const core = new globalThis.OpllCore(store.clock, 44100);
  for (let a = 0; a < 0x40; a++) core.writeReg(a, store.get(a));
  return core;
}

/**
 * Start the render loop. `draw(viz, dtMs, playing)` is called each frame.
 * Returns a getter for the live core.
 */
export function startVizLoop(draw) {
  const viz = makeCore();
  store.subscribe((evt) => {
    if (evt.type === 'reg') viz.writeReg(evt.addr, evt.value);
    else if (evt.type === 'reset') viz.reset();
  });

  // The OPLL's envelopes are stateful over time, so — unlike the PSG/SCC — the
  // visualiser core must actually RUN, advancing by real elapsed time each frame,
  // for the ADSR playhead to move. We step it into a throwaway buffer (the audio
  // is discarded; the real sound comes from the worklet) and then draw from its
  // now-current state. Clamped so a tab-switch stall can't process a huge block.
  const MAX_SAMPLES = 8192;
  const scratch = new Float32Array(MAX_SAMPLES);

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(now - last, 100); // clamp after tab-switch stalls
    last = now;
    const n = Math.min(MAX_SAMPLES, Math.max(0, Math.round((dt / 1000) * viz.sampleRate)));
    if (n > 0) viz.process(scratch, n);
    draw(viz, dt, isPlaying());
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { getViz: () => viz };
}
