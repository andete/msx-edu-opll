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

/** A gentle soft-clip transfer curve: identity up to ~0.7, then rounding peaks
 *  toward ±0.88 (and clamping anything past ±1 there too). Zero-latency limiting. */
function softClipCurve() {
  const n = 2048;
  const curve = new Float32Array(n);
  const knee = 0.7;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;   // −1..1
    const ax = Math.abs(x);
    const y = ax <= knee ? ax : knee + (1 - Math.exp(-(ax - knee) * 3)) * (1 - knee);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

export function onPlayState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emitState() { for (const fn of listeners) fn(playing); }
export function isPlaying() { return playing; }

async function ensureAudio() {
  if (ready) return;
  // Ask for the lowest-latency output the platform will give — key-press → sound
  // responsiveness matters more here than buffer safety.
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });

  // A soft-clip bus both chips feed. A 9-voice fortissimo chord (or the OPLL+PSG
  // sum on the Tune page) can approach full scale and hard-clip at the destination;
  // this rounds those peaks off. Unlike a DynamicsCompressor it is a pure per-sample
  // WaveShaper — no lookahead, so it adds *zero* latency to the note-play path
  // (which a compressor's ~6 ms would). Transparent below ~0.7; only the peaks bend.
  master = ctx.createWaveShaper();
  master.curve = softClipCurve();
  master.oversample = 'none';
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
