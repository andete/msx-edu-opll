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
