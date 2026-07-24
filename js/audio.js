// audio.js — the audio bus: AudioContext + worklet lifecycle + register bridge.
//
// Lazily created on the first user gesture (browser autoplay policy). Bridges the
// store to the AudioWorklet: subscribe once and forward every register change.

import { store } from './store.js';

let ctx = null;
let node = null;
let ready = false;
let playing = false;
const listeners = new Set();

export function onPlayState(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emitState() { for (const fn of listeners) fn(playing); }
export function isPlaying() { return playing; }

async function ensureAudio() {
  if (ready) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
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
  node.connect(ctx.destination);

  store.subscribe((evt) => {
    if (!node) return;
    if (evt.type === 'reg') node.port.postMessage({ type: 'reg', addr: evt.addr, value: evt.value });
    else if (evt.type === 'reset') node.port.postMessage({ type: 'reset' });
  });

  ready = true;
}

/** Start sound (also resumes a suspended context). Must follow a user gesture. */
export async function play() {
  await ensureAudio();
  if (ctx.state === 'suspended') await ctx.resume();
  node.port.postMessage({ type: 'play' });
  playing = true;
  emitState();
}

/** Stop sound (keeps the context alive for a quick restart). */
export function stop() {
  if (node) node.port.postMessage({ type: 'stop' });
  playing = false;
  emitState();
}

export async function toggle() {
  if (playing) stop(); else await play();
}
