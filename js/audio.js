// audio.js — the audio bus: AudioContext + worklet lifecycle + register bridge.
//
// Lazily created on the first user gesture (browser autoplay policy). Bridges the
// store to the AudioWorklet: subscribe once and forward every register change.
//
// The OPLL is the whole site, so it is the default node. The Tune page can also
// switch on a SECOND node — the MSX PSG (AY-3-8910), the sibling project's chip —
// summed into the same output, so a real OPLL+PSG recording plays its PSG part
// too (in practice, the drums, since MSX-MUSIC tunes keep percussion there). Its
// core/worklet are vendored from msx-edu-psg and only ever driven by the VGM
// player; nothing else on the site touches it.

import { store } from './store.js';

let ctx = null;
let node = null;
let master = null;         // limiter bus both chips feed, so the sum can't clip
let ready = false;
let playing = false;
const listeners = new Set();

// The PSG side, all lazy: nothing is loaded until a tune that needs it plays.
let psgNode = null;
let psgModulesLoaded = false;
let psgWanted = false;
let psgOpts = {};

// PSG level relative to the OPLL. The OPLL mix is scaled by 0.11/voice; a PSG
// noise voice at full amplitude out of PsgCore is louder, so it is trimmed to sit
// under the FM as a drum track rather than over it. Tuned by ear against the demo.
const PSG_GAIN = 0.14;

export function onPlayState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emitState() { for (const fn of listeners) fn(playing); }
export function isPlaying() { return playing; }

async function ensureAudio() {
  if (ready) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  // A brick-wall limiter both chips feed. The OPLL alone stays within headroom,
  // but the PSG drums add on top, so the worst-case sum can pass full scale and
  // hard-clip at the destination. Transparent below ~-1 dB, so an OPLL-only page
  // is untouched; it only acts when the two chips peak together.
  master = ctx.createDynamicsCompressor();
  master.threshold.value = -1;
  master.knee.value = 0;
  master.ratio.value = 20;
  master.attack.value = 0.001;
  master.release.value = 0.05;
  master.connect(ctx.destination);

  // Load the shared DSP core, then the processor, into the worklet scope.
  await ctx.audioWorklet.addModule('js/opll-core.js');
  await ctx.audioWorklet.addModule('js/opll-worklet.js');
  node = new AudioWorkletNode(ctx, 'opll', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: {
      clock: store.clock,
      regs: Array.from(store.regs),
    },
  });
  node.connect(master);

  store.subscribe((evt) => {
    if (!node) return;
    if (evt.type === 'reg') node.port.postMessage({ type: 'reg', addr: evt.addr, value: evt.value });
    else if (evt.type === 'reset') node.port.postMessage({ type: 'reset' });
  });

  ready = true;
  if (psgWanted) await buildPsg();
}

// --- PSG (the sibling chip, for OPLL+PSG tunes) -----------------------------

/** Create the PSG worklet node, loading its modules once. Needs a live ctx. */
async function buildPsg() {
  if (psgNode || !ctx) return;
  if (!psgModulesLoaded) {
    await ctx.audioWorklet.addModule('js/psg-core.js');
    await ctx.audioWorklet.addModule('js/psg-worklet.js');
    psgModulesLoaded = true;
  }
  psgNode = new AudioWorkletNode(ctx, 'psg', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { clock: psgOpts.clock || undefined, isAY8910: psgOpts.isAY8910 !== false, gain: PSG_GAIN },
  });
  psgNode.connect(master);
  if (playing) psgNode.port.postMessage({ type: 'play' });
}

/**
 * Turn the PSG side on or off for the current tune. Safe to call before any audio
 * exists — the node is actually built on the next play(). `opts.clock` is the AY
 * clock the file declares.
 */
export async function usePsg(on, opts = {}) {
  psgWanted = on;
  psgOpts = { ...opts };
  if (!on) { psgNode?.port.postMessage({ type: 'stop' }); psgNode?.port.postMessage({ type: 'reset' }); return; }
  if (psgNode) {
    if (opts.clock) psgNode.port.postMessage({ type: 'clock', hz: opts.clock });
    psgNode.port.postMessage({ type: 'reset' });
    if (playing) psgNode.port.postMessage({ type: 'play' });
  } else if (ready) {
    await buildPsg();
  }
}

/** One PSG register write (AY register 0–15). Forwarded to the worklet. */
export function postPsg(reg, value) {
  psgNode?.port.postMessage({ type: 'reg', reg, value });
}

/** Silence the PSG and clear its registers — for load / rewind / pause. */
export function resetPsg() {
  psgNode?.port.postMessage({ type: 'reset' });
}

/** Start sound (also resumes a suspended context). Must follow a user gesture. */
export async function play() {
  await ensureAudio();
  if (ctx.state === 'suspended') await ctx.resume();
  node.port.postMessage({ type: 'play' });
  psgNode?.port.postMessage({ type: 'play' });
  playing = true;
  emitState();
}

/** Stop sound (keeps the context alive for a quick restart). */
export function stop() {
  if (node) node.port.postMessage({ type: 'stop' });
  psgNode?.port.postMessage({ type: 'stop' });
  playing = false;
  emitState();
}

export async function toggle() {
  if (playing) stop(); else await play();
}
