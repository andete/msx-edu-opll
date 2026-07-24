// opll-spec.js — the knowledge layer (ES module, UI-side).
//
// Pure metadata + conversions derived from reference/opll-registers.md. The audio
// core (js/opll-core.js) is a classic script and carries its own copy of the data
// it needs to make sound; this module is what the UI and Reference page read.
// Shared hardware constants come from globalThis.OpllCore (loaded first).

const Core = globalThis.OpllCore;

export const CLOCK = 3579545;
export const FSAM = CLOCK / 72;               // ≈ 49715.9 Hz

// The instrument-ROM names (reference §4). The bytes live in OpllCore.
export const INSTRUMENT_NAMES = [
  'User', 'Violin', 'Guitar', 'Piano', 'Flute', 'Clarinet', 'Oboe', 'Trumpet',
  'Organ', 'Horn', 'Synthesizer', 'Harpsichord', 'Vibraphone', 'Synth. Bass',
  'Acoustic Bass', 'Electric Guitar',
];

export const INSTRUMENT_ROM = Core ? Core.INSTRUMENT_ROM : [];
export const ML2 = Core ? Core.ML2 : [1, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 20, 24, 24, 30, 30];
export const decodePatch = Core ? Core.decodePatch : null;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI note → frequency (equal temperament, A4 = 440 Hz). */
export function midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

/** MIDI note → readable name, e.g. 69 → "A4". */
export function midiToName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

/**
 * A target frequency → the (F-Number, Block) the OPLL should use. We pick the
 * SMALLEST Block that keeps the 9-bit F-Number ≤ 511 — that maximises F-Number
 * resolution (reference §5). Multiple is assumed 1.
 */
export function freqToFnumBlock(hz) {
  for (let block = 0; block <= 7; block++) {
    const fnum = Math.round((hz * Math.pow(2, 19 - block)) / FSAM);
    if (fnum <= 511) return { fnum: Math.max(0, fnum), block };
  }
  return { fnum: 511, block: 7 };
}

/** (F-Number, Block) → frequency, Multiple 1 (reference §5). */
export function fnumBlockToFreq(fnum, block) {
  return (fnum * FSAM) / Math.pow(2, 19 - block);
}

/** MIDI note → (F-Number, Block). */
export function midiToFnumBlock(midi) { return freqToFnumBlock(midiToFreq(midi)); }

// --- Register-file metadata for the inspector (reference §3) ---------------
// Each entry describes one address (or a per-channel range) for grouping and
// tooltips. `perCh` entries repeat for channels 0..8.
export const REGISTER_GROUPS = [
  {
    title: 'User instrument',
    tag: '00–07',
    rows: [
      { addr: 0x00, label: 'Modulator: AM PM EG KR · Multiple' },
      { addr: 0x01, label: 'Carrier: AM PM EG KR · Multiple' },
      { addr: 0x02, label: 'Modulator: KSL · Total Level' },
      { addr: 0x03, label: 'Carrier KSL · waveforms (DC/DM) · Feedback' },
      { addr: 0x04, label: 'Modulator: Attack · Decay' },
      { addr: 0x05, label: 'Carrier: Attack · Decay' },
      { addr: 0x06, label: 'Modulator: Sustain level · Release' },
      { addr: 0x07, label: 'Carrier: Sustain level · Release' },
    ],
  },
  {
    title: 'Rhythm',
    tag: '0E',
    rows: [{ addr: 0x0e, label: 'Rhythm mode + BD/SD/TOM/CYM/HH keys' }],
  },
  {
    title: 'F-Number (low)',
    tag: '10–18',
    perCh: (ch) => ({ addr: 0x10 + ch, label: `ch${ch + 1}: F-Number bits 7–0` }),
  },
  {
    title: 'Block · Key · Sustain · F-Number (hi)',
    tag: '20–28',
    perCh: (ch) => ({ addr: 0x20 + ch, label: `ch${ch + 1}: · · SUS KEY Block(3) Fhi` }),
  },
  {
    title: 'Instrument · Volume',
    tag: '30–38',
    perCh: (ch) => ({ addr: 0x30 + ch, label: `ch${ch + 1}: Instrument(4) Volume(4)` }),
  },
];

// --- Harmonic analysis (the FM payoff) -------------------------------------

/**
 * The harmonic spectrum of a rendered carrier window, relative to the voice's
 * fundamental. Unlike the SCC's fixed 32-point cycle, an FM carrier is an
 * arbitrary audio window whose fundamental (the F-Number × Block base pitch, at
 * Multiple 1) rarely lands on an integer DFT bin — so instead of an FFT we
 * project the signal directly onto each harmonic frequency k·f0 (a bank of
 * Goertzel-style correlations). A Hann window suppresses the leakage from the
 * finite, non-integer-period record, giving stable bars as ML/TL/FB move.
 *
 * @param {Float32Array} samples  the carrier output over a window
 * @param {number} f0             fundamental, in CYCLES PER SAMPLE
 * @param {number} nHarm          how many harmonics to return (default 16)
 * @returns {{mag: Float64Array}}  mag[1..nHarm], ≈ amplitude of each harmonic
 */
export function harmonics(samples, f0, nHarm = 16) {
  const N = samples.length;
  const mag = new Float64Array(nHarm + 1);
  if (!(f0 > 0) || N < 2) return { mag };

  // A 4-term Blackman–Harris window (≈ −92 dB sidelobes). The fundamental is
  // strong and its record is never an integer number of periods, so a weaker
  // window would leak it into the low harmonic bins (a pure sine would show a
  // spurious 2nd/3rd bar); this keeps a pure sine reading as a single bar.
  const win = new Float64Array(N);
  let wsum = 0;
  const a0 = 0.35875, a1 = 0.48829, a2 = 0.14128, a3 = 0.01168;
  for (let n = 0; n < N; n++) {
    const t = (2 * Math.PI * n) / (N - 1);
    win[n] = a0 - a1 * Math.cos(t) + a2 * Math.cos(2 * t) - a3 * Math.cos(3 * t);
    wsum += win[n];
  }

  for (let k = 1; k <= nHarm; k++) {
    const w = 2 * Math.PI * k * f0;
    if (w >= Math.PI) break;               // above Nyquist: leave at 0
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const s = samples[n] * win[n];
      re += s * Math.cos(w * n);
      im += s * Math.sin(w * n);
    }
    mag[k] = (2 / wsum) * Math.hypot(re, im);   // ≈ amplitude of a pure harmonic
  }
  return { mag };
}

// --- Instrument fingerprints (the ROM gallery, Phase 4) --------------------

// One private throwaway core for offline analysis — never the audio or viz core,
// so nothing it does is heard or drawn. globalThis.OpllCore is read lazily (at
// call time, not module-eval time) so this also works under the Node verifier,
// where the core is `require`d *after* this module is imported.
let _fpCore = null;
function fpCore() {
  const C = globalThis.OpllCore;
  if (!_fpCore && C) _fpCore = new C(CLOCK, 44100);
  return _fpCore;
}

const FP_MIDI = 57;      // A3 — low enough that many harmonics fit under Nyquist,
                         // high enough that the render spans plenty of periods
const FP_FRAMES = 4096;
export const FP_BARS = 12;

/**
 * The harmonic "fingerprint" of an instrument — the timbral signature the gallery
 * draws under each tile. `n` is the instrument index: 0 = the live user patch
 * (pass its 8 bytes so the bars track edits), 1..15 = the fixed ROM. Deterministic
 * and offline: it loads the patch into the private core, pitches it to a fixed mid
 * note, renders the carrier with the envelope forced open (renderPair), and bins
 * that against the played note's fundamental. Bar 0 is the fundamental; FM spreads
 * energy into the higher bars, which is what makes each instrument look distinct.
 *
 * @param {number} n              instrument index 0..15
 * @param {number[]} [userBytes]  the 8 user-patch bytes (only used when n === 0)
 * @returns {Float64Array}        FP_BARS magnitudes (bar 0 = fundamental)
 */
export function instrumentFingerprint(n, userBytes) {
  const out = new Float64Array(FP_BARS);
  const core = fpCore();
  if (!core) return out;
  if (n === 0 && userBytes) {
    for (let i = 0; i < 8; i++) core.writeReg(i, userBytes[i] & 0xff);
  }
  core.writeReg(0x30, (n & 0x0f) << 4);              // instrument n, volume 0 (loudest)
  const { fnum, block } = midiToFnumBlock(FP_MIDI);
  core.writeReg(0x10, fnum & 0xff);
  core.writeReg(0x20, (block << 1) | ((fnum >> 8) & 1)); // key off — renderPair opens the env
  const { carrier } = core.renderPair(FP_FRAMES, 0);
  const f0 = fnumBlockToFreq(fnum, block) / core.sampleRate;
  const { mag } = harmonics(carrier, f0, FP_BARS);
  for (let k = 1; k <= FP_BARS; k++) out[k - 1] = mag[k];
  return out;
}

/** Human-readable label for a single address (for tooltips). */
export function addrLabel(addr) {
  for (const g of REGISTER_GROUPS) {
    if (g.rows) { const r = g.rows.find((x) => x.addr === addr); if (r) return r.label; }
    if (g.perCh) {
      for (let ch = 0; ch < 9; ch++) { const r = g.perCh(ch); if (r.addr === addr) return r.label; }
    }
  }
  return '';
}
