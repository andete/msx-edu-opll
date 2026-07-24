// pages/landing.js — the front door.
//
// The hero is the signal-path diagram, live: press the chord button and the two
// operator blocks brighten with the focus voice's actual output while the DAC
// bar tracks the summed level. A block diagram wired to the thing it describes is
// worth a page of prose about how the chip is put together.

import { store } from '../store.js';
import { play, stop, isPlaying, onPlayState } from '../audio.js';
import { mountShell, PAGES } from '../shell.js';
import { SignalPath } from '../components/signal-path.js';
import { midiToFnumBlock } from '../opll-spec.js';

const $ = (id) => document.getElementById(id);

// A five-note FM spread across the voices, each a different ROM instrument so the
// chord has some colour. Channels are seeded keyed-off; the chord button keys
// them. Instruments: Piano, Vibraphone, Organ, Trumpet, Synth. Bass.
const CHORD = [
  { midi: 45, inst: 13 },   // A2  Synth Bass
  { midi: 57, inst: 3 },    // A3  Piano
  { midi: 64, inst: 8 },    // E4  Organ
  { midi: 69, inst: 12 },   // A4  Vibraphone
  { midi: 72, inst: 7 },    // C5  Trumpet
];
CHORD.forEach((s, ch) => {
  const { fnum, block } = midiToFnumBlock(s.midi);
  store.setFnum(ch, fnum);
  store.setBlock(ch, block);
  store.setInstrument(ch, s.inst);
  store.setVolume(ch, 0);
});

mountShell('index', { tools: false });

const path = new SignalPath($('path'));
path.render();
store.subscribe(() => path.render());

// --- The chord button (mirrors the header transport) ------------------------
const btn = $('chord');
const note = $('chordNote');
btn.addEventListener('click', async () => {
  if (isPlaying()) { keyChord(false); stop(); }
  else { await play(); keyChord(true); }
});
function keyChord(on) { for (let ch = 0; ch < CHORD.length; ch++) store.keyOn(ch, on); }
onPlayState((playing) => {
  btn.textContent = playing ? '■ Stop' : '▶ Play a chord';
  btn.classList.toggle('playing', playing);
  note.textContent = playing
    ? 'Five FM voices sounding. The two operator blocks glow with the live output; the DAC bar is the summed level.'
    : 'A five-note FM chord across the voices. Sound needs a click first — that is the browser\'s rule, not the chip\'s.';
});

// --- The chain index --------------------------------------------------------
$('chainCards').innerHTML = PAGES.filter((p) => p.chain).map((p) => `
  <li class="chain-card${p.ready === false ? ' is-soon' : ''}">
    ${p.ready === false
      ? `<span class="chain-card-link"><span class="chain-card-n">${p.chain}</span>
         <span><b>${p.title}</b><span class="chain-card-lede">${p.lede} — coming in the next phase</span></span></span>`
      : `<a class="chain-card-link" href="${p.href}"><span class="chain-card-n">${p.chain}</span>
         <span><b>${p.title}</b><span class="chain-card-lede">${p.lede}</span></span></a>`}
  </li>`).join('');

// --- Live levels into the diagram -------------------------------------------
import { startVizLoop } from '../loop.js';
startVizLoop((viz, dt, playing) => {
  // The viz core runs whether or not the speakers are connected, so the glow is
  // gated on actual playback: a diagram pulsing in silence would claim something
  // the listener cannot hear.
  if (!playing) { path.setLevels(0, 0, 0); return; }
  // Focus voice (channel 1) drives the operator glow; the DAC bar sums the
  // carriers across the sounding chord.
  const s0 = viz.snapshot(0);
  let sum = 0;
  for (let ch = 0; ch < CHORD.length; ch++) sum += Math.abs(viz.snapshot(ch).car.out);
  path.setLevels(s0.mod.out, s0.car.out, sum / 3);
});
