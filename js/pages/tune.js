// pages/tune.js — play a VGM recording through our own chip model.
//
// The register writes go into the store exactly as a slider's would, so every
// widget on the site reacts without knowing a file is involved. That is the whole
// design: the tune is just another thing writing bytes. The OPLL side lands in
// the store; the PSG side (usually the drums) is forwarded to its own worklet.

import { store } from '../store.js';
import { mountShell } from '../shell.js';
import { startVizLoop } from '../loop.js';
import { play as startAudio, stop as stopAudio, onPlayState, usePsg, postPsg, resetPsg } from '../audio.js';
import { CLOCK } from '../opll-spec.js';
import { readVgmFile, VgmPlayer, opllMasterClock } from '../vgm.js';
import { Scope } from '../components/scope.js';
import { ChannelPanel } from '../panels/channel.js';
import { RhythmPanel } from '../panels/rhythm.js';

const $ = (id) => document.getElementById(id);

mountShell('tune', { keyboard: 'poly' });

let player = null;
let rack = null;
// The tune's own transport state, kept SEPARATE from whether the AudioContext is
// running. Pressing a piano key turns audio on (so you hear an instrument) but
// must not resume the recording — so the player advances on `tunePlaying`, never
// on isPlaying(). Otherwise a keypress restarts the song under your hands.
let tunePlaying = false;

// --- Write activity ---------------------------------------------------------
const REGIONS = [
  { id: 'patch', label: 'instrument', hint: 'editing the user patch (00–07)' },
  { id: 'pitch', label: 'pitch', hint: 'notes, vibrato (10–18)' },
  { id: 'key', label: 'key / block', hint: 'note on/off, octave (20–28)' },
  { id: 'inst', label: 'select / vol', hint: 'instrument + volume (30–38)' },
  { id: 'rhythm', label: 'rhythm', hint: 'drum mode + levels (0E, 36–38)' },
];
const counts = Object.fromEntries(REGIONS.map((r) => [r.id, 0]));
const smooth = Object.fromEntries(REGIONS.map((r) => [r.id, 0]));
counts.psg = 0;   // PSG writes are counted but not shown as an OPLL activity bar

$('bars').innerHTML = REGIONS.map((r) => `
  <div class="activity-row">
    <span class="activity-label">${r.label}</span>
    <span class="activity-track"><span class="activity-fill" data-bar="${r.id}"></span></span>
    <span class="activity-n" data-n="${r.id}">0</span>
    <span class="activity-hint">${r.hint}</span>
  </div>`).join('');
const barEls = Object.fromEntries(REGIONS.map((r) => [r.id, $('bars').querySelector(`[data-bar="${r.id}"]`)]));
const numEls = Object.fromEntries(REGIONS.map((r) => [r.id, $('bars').querySelector(`[data-n="${r.id}"]`)]));

function regionOf(addr) {
  if (addr <= 0x07) return 'patch';
  if (addr === 0x0e || (addr >= 0x36 && addr <= 0x38)) return 'rhythm';
  if (addr >= 0x10 && addr <= 0x18) return 'pitch';
  if (addr >= 0x20 && addr <= 0x28) return 'key';
  if (addr >= 0x30 && addr <= 0x38) return 'inst';
  return 'patch';
}

// --- Loading ----------------------------------------------------------------

function fail(msg) { $('error').textContent = msg; $('error').hidden = false; }

async function load(bytes, name) {
  $('error').hidden = true;
  let raw;
  try { raw = await readVgmFile(bytes); }
  catch (e) { fail(`${name}: ${e.message}`); return; }

  let p;
  try {
    p = new VgmPlayer(raw, {
      onWrite: (addr, value) => { store.set(addr, value); counts[regionOf(addr)]++; },
      onPsgWrite: (reg, value) => { postPsg(reg, value); counts.psg++; },
      onEnd: () => { tunePlaying = false; syncTransport(); },
    });
  } catch (e) { fail(`${name}: could not read the command stream (${e.message}).`); return; }

  if (!p.header.opllClockDeclared) {
    fail(`${name} declares no YM2413. This page plays the OPLL (and PSG) part of a ` +
      `VGM, so there would be nothing to hear — the file may be for another machine.`);
    return;
  }

  stopAudio();
  tunePlaying = false;
  player = p;
  player.loop = $('loop').checked;

  // A tune writes only the registers it uses, so anything left from a previous
  // tune (or another page) has to go first.
  store.reset();
  // Switch the PSG side on for a file that declares one, so its drums play; off
  // (and cleared) for a pure-OPLL file, so a previous tune's PSG cannot bleed.
  const psgHz = p.header.chips.ay8910;
  await usePsg(!!psgHz, { clock: psgHz });
  resetPsg();

  showMeta(p, name);
  buildRack();
  $('nowPlaying').hidden = false;
  syncTransport();
}

function showMeta(p, name) {
  const g = p.header.gd3;
  $('title').textContent = g?.track || name;
  const bits = [];
  if (g?.game) bits.push(g.game);
  if (g?.author) bits.push(g.author);
  if (g?.date) bits.push(g.date);
  bits.push(`VGM ${p.header.versionText}`);
  if (p.header.totalSamples) bits.push(fmtTime(p.header.totalSamples / 44100));
  $('sub').textContent = bits.join(' · ');

  const chips = Object.entries(p.header.chips);
  $('chips').innerHTML = chips.map(([id, hz]) => {
    const label = id === 'ym2413' ? 'OPLL (YM2413)'
      : id === 'ay8910' ? 'PSG (AY-3-8910) — drums'
      : id.toUpperCase();
    const ours = id === 'ym2413' || id === 'ay8910';
    return `<span class="chip-tag${ours ? ' is-ours' : ''}" title="${hz} Hz">${label}${ours ? '' : ' — not played'}</span>`;
  }).join('');

  // Our core runs at a fixed 3.579545 MHz, which is what OPLL files declare, so a
  // warning here is rare — but if a file asks for something else, say so rather
  // than playing it at the wrong pitch.
  const master = opllMasterClock(p.header.opllClockDeclared);
  if (Math.abs(master - CLOCK) > CLOCK * 0.005) {
    $('chips').innerHTML += `<span class="chip-tag is-warn" title="declared ${p.header.opllClockDeclared} Hz">` +
      `clock ${(master / 1e6).toFixed(3)} MHz — played at ${(CLOCK / 1e6).toFixed(3)}, so the pitch will be off</span>`;
  }
}

function buildRack() {
  if (rack) return;
  const el = $('rack');
  rack = [];
  for (let ch = 0; ch < 9; ch++) {
    const strip = document.createElement('div');
    el.appendChild(strip);
    rack.push(new ChannelPanel(strip, store, ch));
  }
  // The same panel the Rhythm page uses, here as a mirror of the file's 0E
  // writes: no demo-beat button (the tune is the sequencer), and hits latched
  // briefly because a drum keyed for three frames can fall between two paints.
  new RhythmPanel($('rhythmPanel'), store, { beat: false, latchMs: 110 });
}

// --- Transport --------------------------------------------------------------

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function syncTransport() {
  const playing = tunePlaying && player && !player.ended;
  $('play').textContent = playing ? '⏸ Pause' : '▶ Play';
  $('play').classList.toggle('playing', playing);
}

/** Pause: stop the recording advancing and silence what it left sounding, but
 *  keep every channel's instrument/pitch so the piano can still play them. */
function pauseTune() {
  tunePlaying = false;
  stopAudio();
  for (let ch = 0; ch < 9; ch++) store.keyOn(ch, false);
  resetPsg();
  syncTransport();
}

$('play').addEventListener('click', async () => {
  if (!player) return;
  if (tunePlaying) { pauseTune(); return; }
  if (player.ended) { player.rewind(); store.reset(); }
  tunePlaying = true;
  await startAudio();
  syncTransport();
});
$('rewind').addEventListener('click', () => {
  if (!player) return;
  tunePlaying = false;
  player.rewind();
  store.reset();
  resetPsg();
  stopAudio();
  syncTransport();
});
$('loop').addEventListener('change', (e) => { if (player) player.loop = e.target.checked; });
// The piano turns audio on without touching tunePlaying, so let the button
// reflect the tune's own state whenever the audio state changes underneath it.
onPlayState(syncTransport);

// --- File input -------------------------------------------------------------

const readFile = (f) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(new Uint8Array(r.result));
  r.onerror = () => rej(new Error('could not be read'));
  r.readAsArrayBuffer(f);
});

$('pick').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) await load(await readFile(f), f.name);
});

const drop = $('drop');
for (const type of ['dragenter', 'dragover']) {
  drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.add('over'); });
}
for (const type of ['dragleave', 'drop']) {
  drop.addEventListener(type, (e) => { e.preventDefault(); drop.classList.remove('over'); });
}
drop.addEventListener('drop', async (e) => {
  const f = e.dataTransfer?.files?.[0];
  if (f) await load(await readFile(f), f.name);
});

$('demo').addEventListener('click', async () => {
  $('error').hidden = true;
  try {
    const res = await fetch('assets/demo.vgm');
    if (!res.ok) throw new Error(`server said ${res.status}`);
    await load(new Uint8Array(await res.arrayBuffer()), 'demo.vgm');
  } catch (e) {
    fail(`Could not load the demo tune (${e.message}). Run \`node tools/make-demo-vgm.mjs\` to generate it.`);
  }
});

// --- The loop ---------------------------------------------------------------

const scope = new Scope($('scope'));
const buf = new Float32Array(1024);

startVizLoop((viz, dt) => {
  // Advance on the tune's own state, not on whether audio happens to be on: a
  // piano keypress starts audio but must leave the recording where it is.
  if (player && tunePlaying && !player.ended) player.tick(dt);

  // The mixed OPLL output as a scope (the PSG drums are not in this trace — they
  // are a separate worklet — but the FM voices are).
  viz.process(buf, buf.length);
  const disp = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) disp[i] = buf[i] * 3;
  scope.draw(disp, { label: tunePlaying ? 'OPLL mix' : 'paused' });

  // Decay the per-region counters toward the live rate, then draw the bars.
  const perSecond = 1000 / Math.max(dt, 1);
  for (const r of REGIONS) {
    const rate = counts[r.id] * perSecond;
    counts[r.id] = 0;
    smooth[r.id] += (rate - smooth[r.id]) * 0.12;
    const v = Math.round(smooth[r.id]);
    barEls[r.id].style.width = `${Math.min(100, (v / 200) * 100)}%`;
    numEls[r.id].textContent = v;
  }
  counts.psg = 0;
  const total = Math.round(REGIONS.reduce((n, r) => n + smooth[r.id], 0));
  $('rate').textContent = `${total} writes/s`;

  if (player) {
    const dur = player.durationSeconds;
    $('time').textContent = dur
      ? `${fmtTime(player.positionSeconds)} / ${fmtTime(dur)}`
      : fmtTime(player.positionSeconds);
    $('seekFill').style.width = dur
      ? `${Math.min(100, (player.positionSeconds / dur) * 100)}%` : '0%';
  }
});
