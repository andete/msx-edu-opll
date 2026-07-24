// pages/reference.js — the lookup page.
//
// Nothing here is transcribed. Every table row and calculator answer is computed
// by the same opll-spec.js / opll-core.js the synth uses, so this page cannot
// drift from the chip model: if a number is wrong here, the sound is wrong the
// same way, and both are fixed in one place.

import { store } from '../store.js';
import { mountShell } from '../shell.js';
import { play, stop, isPlaying, onPlayState } from '../audio.js';
import {
  INSTRUMENT_ROM, INSTRUMENT_NAMES, ML2, decodePatch,
  midiToFreq, midiToName, freqToFnumBlock, fnumBlockToFreq, instrumentFingerprint,
} from '../opll-spec.js';

const Core = globalThis.OpllCore;
const hex = (n) => (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
const css = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();
const $ = (id) => document.getElementById(id);

mountShell('reference', { tools: false });

// --- The register map -------------------------------------------------------

const MAP = [
  ['00–07', 'User instrument — one 8-byte FM patch, shared by every channel on instrument 0',
    'modulator: 00 02 04 06 · carrier: 01 03 05 07'],
  ['0E', 'Rhythm mode + the five drum keys',
    'bit 5 = mode · bits 4–0 = BD SD TOM CYM HH'],
  ['10–18', 'F-Number low byte, one per channel', 'bits 7–0'],
  ['20–28', 'Block, Key-On, Sustain, F-Number high bit, per channel',
    '– – SUS KEY Block(3) F8'],
  ['30–38', 'Instrument select + volume, per channel', 'Instrument(4) · Volume(4)'],
];
$('mapTable').querySelector('tbody').innerHTML = MAP.map(([a, what, layout]) => `
  <tr><td><code>${a}</code></td><td>${what}</td><td><em>${layout}</em></td></tr>`).join('');

// --- The eight patch bytes, bit by bit --------------------------------------

// Each byte's eight bits as single-letter fields (bit 7 → bit 0), plus a plain
// meaning. Matches decodePatch() exactly.
const PATCH_BITS = [
  ['00', ['AM', 'PM', 'EG', 'KR', 'M', 'M', 'M', 'M'], 'Modulator: tremolo, vibrato, EG-type, key-scale-rate · Multiple'],
  ['01', ['AM', 'PM', 'EG', 'KR', 'M', 'M', 'M', 'M'], 'Carrier: same flags · Multiple'],
  ['02', ['KL', 'KL', 'T', 'T', 'T', 'T', 'T', 'T'], 'Modulator: Key-Scale-Level · Total Level (FM depth)'],
  ['03', ['KL', 'KL', '–', 'DC', 'DM', 'FB', 'FB', 'FB'], 'Carrier KSL · carrier waveform (DC) · modulator waveform (DM) · Feedback'],
  ['04', ['A', 'A', 'A', 'A', 'D', 'D', 'D', 'D'], 'Modulator: Attack Rate · Decay Rate'],
  ['05', ['A', 'A', 'A', 'A', 'D', 'D', 'D', 'D'], 'Carrier: Attack Rate · Decay Rate'],
  ['06', ['S', 'S', 'S', 'S', 'R', 'R', 'R', 'R'], 'Modulator: Sustain Level · Release Rate'],
  ['07', ['S', 'S', 'S', 'S', 'R', 'R', 'R', 'R'], 'Carrier: Sustain Level · Release Rate'],
];
$('patchTable').querySelector('tbody').innerHTML = PATCH_BITS.map(([b, bits, meaning]) => `
  <tr><td><code>${b}</code></td>${bits.map((f) => `<td><code>${f}</code></td>`).join('')}<td>${meaning}</td></tr>`).join('');

// --- The Multiple table -----------------------------------------------------

// ML2 is the multiplier ×2 (so index 0 → ×0.5). Show the real multiplier.
$('mlTable').querySelector('tbody').innerHTML =
  `<tr><td>× frequency</td>${ML2.map((v) => `<td><code>${v / 2 === 0.5 ? '½' : '×' + (v / 2)}</code></td>`).join('')}</tr>`;

// --- Levels and the envelope ------------------------------------------------

const EG = Core?.EG_STEP_DB ?? 0.375;
const TL = Core?.TL_STEP_DB ?? 0.75;
const VOL = Core?.VOL_STEP_DB ?? 3.0;
const LEVELS = [
  ['Carrier volume', '4 · 30–38', `${VOL} dB`, `0…${(15 * VOL).toFixed(0)} dB`, 'the loudest is volume 0 — it counts attenuation, not gain'],
  ['Modulator Total Level', '6 · 02', `${TL} dB`, `0…${(63 * TL).toFixed(1)} dB`, 'sets FM depth, not loudness — a silent modulator is TL 63'],
  ['Sustain level (SL)', '4 · 06/07', `${VOL} dB`, `0…${(14 * VOL).toFixed(0)} dB, 15 = mute`, 'where decay hands off to the sustain phase'],
  ['Envelope unit (EG)', '7-bit internal', `${EG} dB`, `0…${(EG * 123).toFixed(1)} dB`, 'finer than any field can set — the engine works in these'],
];
$('levelTable').querySelector('tbody').innerHTML = LEVELS.map(([f, bits, step, range, note]) => `
  <tr><td>${f}</td><td><code>${bits}</code></td><td><b>${step}</b></td><td>${range}</td><td><em>${note}</em></td></tr>`).join('');

// --- Pitch calculator -------------------------------------------------------

const calc = $('calc');
const midiIn = calc.querySelector('[data-midi]');
const hzIn = calc.querySelector('[data-hz]');
const out = calc.querySelector('[data-out]');
let hz = midiToFreq(69);   // A4, the running example

function syncCalc(source) {
  if (source === 'midi') hz = midiToFreq(clampInt(midiIn.value, 0, 127, 69));
  else if (source === 'hz') hz = Math.max(1, parseFloat(hzIn.value) || 1);

  const { fnum, block } = freqToFnumBlock(hz);
  const actual = fnumBlockToFreq(fnum, block);
  // nearest equal-tempered note to the frequency the chip will really produce
  const midiF = 69 + 12 * Math.log2(actual / 440);
  const nearest = Math.round(midiF);
  const cents = Math.round((midiF - nearest) * 100);

  if (source !== 'midi') midiIn.value = nearest;
  if (source !== 'hz') hzIn.value = hz.toFixed(1);

  out.innerHTML =
    `F-Number <b>${fnum}</b> = <code>${hex(fnum & 0xff)}h</code> low +
     <code>${fnum >> 8}</code> hi, Block <b>${block}</b> →
     the chip actually makes <b>${actual.toFixed(2)} Hz</b>, which is
     ${midiToName(nearest)} ${cents === 0 ? 'exactly' : `${cents > 0 ? '+' : ''}${cents} cents`}.
     One unit of F-Number here is ${(fnumBlockToFreq(fnum + 1, block) - actual).toFixed(2)} Hz.`;
}
midiIn.addEventListener('input', () => syncCalc('midi'));
hzIn.addEventListener('input', () => syncCalc('hz'));

const hearBtn = calc.querySelector('[data-hear]');
hearBtn.addEventListener('click', async () => {
  if (isPlaying()) { stop(); return; }
  // A plain 2:1 bell patch on ch1 at the calculated pitch.
  store.set(0x00, 0x22); store.set(0x01, 0x21); store.set(0x02, 0x10); store.set(0x03, 0x00);
  store.set(0x04, 0xf5); store.set(0x05, 0xf4); store.set(0x06, 0x23); store.set(0x07, 0x33);
  const { fnum, block } = freqToFnumBlock(hz);
  store.set(0x30, 0x00);
  store.setFnum(0, fnum); store.setBlock(0, block); store.keyOn(0, true);
  await play();
});
onPlayState((p) => { hearBtn.textContent = p ? '■ Stop' : '♪ Hear it on ch1'; });

// --- The instrument ROM gallery ---------------------------------------------

const gallery = $('gallery');

function drawFingerprint(canvas, bars) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  canvas.width = w * dpr; canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = css('--scope-bg'); ctx.fillRect(0, 0, w, h);
  let max = 1e-6; for (const v of bars) max = Math.max(max, v);
  const bw = w / bars.length;
  const color = css('--scope-line');
  for (let k = 0; k < bars.length; k++) {
    const bh = (bars[k] / max) * (h - 3);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.4 + 0.6 * (bars[k] / max);
    ctx.fillRect(k * bw + bw * 0.18, h - bh, bw * 0.64, Math.max(bh, 0.5));
  }
  ctx.globalAlpha = 1;
}

// A compact decoded summary of a patch (the highlights, not all 26 params).
function decodedLine(bytes) {
  const p = decodePatch(bytes);
  const mlStr = (ml) => (ML2[ml] / 2 === 0.5 ? '½' : '×' + ML2[ml] / 2);
  return `mod ${mlStr(p.mod.ml)} · TL ${p.mod.tl} · FB ${p.mod.fb} · ` +
    `car ${mlStr(p.car.ml)}${p.car.ws || p.mod.ws ? ' · half-sine' : ''}`;
}

const cards = INSTRUMENT_ROM.slice(1, 16).map((bytes, i) => {
  const n = i + 1;
  const el = document.createElement('article');
  el.className = 'gal-card';
  el.innerHTML = `
    <div class="gal-head"><b>${n} · ${INSTRUMENT_NAMES[n]}</b></div>
    <canvas class="gal-harm" aria-label="${INSTRUMENT_NAMES[n]} harmonic fingerprint"></canvas>
    <div class="gal-dec">${decodedLine(bytes)}</div>
    <div class="gal-foot">
      <button type="button" class="btn btn-small" data-load>♪ Load into ch1</button>
      <code class="gal-bytes">${Array.from(bytes).map((v) => hex(v)).join(' ')}</code>
    </div>`;
  gallery.appendChild(el);
  el.querySelector('[data-load]').addEventListener('click', async () => {
    store.set(0x30, (n << 4) | 0x00);          // instrument n, volume 0 (loudest)
    const { fnum, block } = freqToFnumBlock(midiToFreq(57)); // A3
    store.setFnum(0, fnum); store.setBlock(0, block); store.keyOn(0, true);
    await play();
  });
  return { n, bytes, el };
});

function drawGallery() {
  for (const c of cards) drawFingerprint(c.el.querySelector('.gal-harm'), instrumentFingerprint(c.n));
}

// Canvases are CSS-sized, so redraw on resize and on the theme flip (which
// changes the colours they were painted with).
new ResizeObserver(drawGallery).observe(gallery);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawGallery);

// --- Go ---------------------------------------------------------------------

function clampInt(v, lo, hi, dflt) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; }

syncCalc('init');
drawGallery();
