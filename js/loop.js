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

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(now - last, 100); // clamp after tab-switch stalls
    last = now;
    draw(viz, dt, isPlaying());
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { getViz: () => viz };
}
