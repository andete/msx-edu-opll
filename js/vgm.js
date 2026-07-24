// vgm.js — read a VGM log and replay its OPLL writes into our own chip model.
//
// A VGM file is not music and it is not samples: it is a *timestamped list of
// register writes*, captured from a real machine or an emulator. Which makes it
// the perfect input for this site. We do not need anyone's emulator to play one —
// we already have the chip. We only have to read the log and poke the same bytes,
// at the same moments, into the same register file every other page here is built
// around.
//
// The payoff is that everything wired to the store lights up for free: the
// channel strips flicker as the driver keys notes, the register inspector moves
// exactly where the tune is writing, and the scopes follow. That is a real
// MSX-MUSIC driver, taken apart live.
//
// Written from the VGM specification (vgmrips.net). The YM2413 command is a plain
// two-operand register write (0x51 aa dd); no emulator code is bundled and no
// third-party engine is used — the audio comes from js/opll-core.js, the same
// synth as every other page.
//
// Scope: we decode the YM2413 (OPLL), and the AY-3-8910 PSG that sat beside it in
// every MSX — the latter forwarded to a separate PSG worklet (borrowed from the
// sibling msx-edu-psg project) rather than into the OPLL store, since it is a
// different chip. That covers the drums, which MSX-MUSIC tunes usually put on the
// PSG. Any other chip in a file (an SCC, an arcade part) is named on the page and
// left silent.

import { CLOCK } from './opll-spec.js';

/** VGM header fields we read. Offsets are from the VGM specification. */
const OFF = {
  ident: 0x00, eof: 0x04, version: 0x08,
  ym2413: 0x10,
  gd3: 0x14, totalSamples: 0x18, loopOffset: 0x1c, loopSamples: 0x20,
  rate: 0x24,
  dataOffset: 0x34,
  ay8910: 0x74,
};

/** Chip clocks worth reporting, so the page can say what else is in the file. */
const OTHER_CLOCKS = [
  ['sn76489', 0x0c], ['ym2413', 0x10], ['ym2612', 0x2c], ['ym2151', 0x30],
  ['y8950', 0x58], ['ymf278b', 0x60], ['ay8910', 0x74], ['k051649', 0x9c],
];

/** The top two bits of a clock field are flags (dual-chip, variant), not Hz. */
const CLOCK_MASK = 0x3fffffff;

const u8 = (b, o) => b[o];
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));

export const isGzip = (b) => b.length > 1 && b[0] === 0x1f && b[1] === 0x8b;
export const isVgm = (b) => b.length > 3 && ascii(b, 0, 4) === 'Vgm ';

/**
 * Un-gzip a .vgz using the platform's own DecompressionStream — no library, in
 * keeping with the rest of the site. Most VGMs in the wild are distributed
 * gzipped with a .vgz extension, so this is not an optional extra.
 */
export async function gunzip(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot decompress .vgz files. Try an uncompressed .vgm.');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Accept either a .vgm or a .vgz and return raw VGM bytes. */
export async function readVgmFile(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const raw = isGzip(b) ? await gunzip(b) : b;
  if (!isVgm(raw)) throw new Error('Not a VGM file — the header does not start with "Vgm ".');
  return raw;
}

/**
 * Parse the header. Every clock field was added in some VGM version, so a field
 * only exists if it lies before the start of the command data — reading past that
 * in an old file returns the first bytes of the music.
 */
export function parseHeader(b) {
  const version = u32(b, OFF.version);
  // Before v1.50 the data always began at 0x40; from then on it is a relative
  // offset stored at 0x34.
  const rel = u32(b, OFF.dataOffset);
  const dataOffset = version >= 0x150 && rel ? OFF.dataOffset + rel : 0x40;

  const clock = (off) => (off + 4 <= dataOffset ? u32(b, off) & CLOCK_MASK : 0);

  const loopRel = u32(b, OFF.loopOffset);
  const chips = {};
  for (const [name, off] of OTHER_CLOCKS) {
    const hz = clock(off);
    if (hz) chips[name] = hz;
  }

  return {
    version,
    versionText: `${(version >> 8).toString(16)}.${(version & 0xff).toString(16).padStart(2, '0')}`,
    dataOffset,
    eof: OFF.eof + 4 + u32(b, OFF.eof),
    totalSamples: u32(b, OFF.totalSamples),
    loopOffset: loopRel ? OFF.loopOffset + loopRel : 0,
    loopSamples: u32(b, OFF.loopSamples),
    opllClockDeclared: clock(OFF.ym2413),
    chips,
    gd3: readGd3(b, u32(b, OFF.gd3) ? OFF.gd3 + u32(b, OFF.gd3) : 0),
  };
}

/**
 * The GD3 tag: UTF-16LE, NUL-separated, in a fixed field order — track name in
 * English and Japanese, game, system, author, and so on.
 */
function readGd3(b, off) {
  if (!off || off + 12 > b.length || ascii(b, off, 4) !== 'Gd3 ') return null;
  const len = u32(b, off + 8);
  const start = off + 12;
  const end = Math.min(b.length, start + len);
  const fields = [];
  let cur = '';
  for (let i = start; i + 1 < end; i += 2) {
    const c = b[i] | (b[i + 1] << 8);
    if (c === 0) { fields.push(cur); cur = ''; } else cur += String.fromCharCode(c);
  }
  const [track, trackJp, game, gameJp, system, systemJp, author, authorJp, date, ripper, notes] = fields;
  return { track, trackJp, game, gameJp, system, systemJp, author, authorJp, date, ripper, notes };
}

/**
 * The clock our core should run at, from what the file declares. The YM2413 is
 * conventionally declared at the true MSX rate 3 579 545 Hz, which is also what
 * our core wants, so a declared clock within 1% is taken at face value; anything
 * else is reported but the core still runs at its native rate (re-clocking the
 * synth per file would be plumbing for a case that essentially never occurs).
 */
export function opllMasterClock(declared) {
  if (!declared) return CLOCK;
  return declared;
}

// --- The command stream -----------------------------------------------------

/**
 * Operand byte counts for every VGM command, so unknown chips can be skipped
 * without understanding them. Variable-length commands (0x67 data blocks, 0x68
 * PCM RAM writes) are handled separately in step().
 */
function operandLength(cmd) {
  if (cmd === 0x31) return 1;                       // AY8910 stereo mask
  if (cmd >= 0x40 && cmd <= 0x4e) return 2;         // reserved, 2 operands
  if (cmd === 0x4f || cmd === 0x50) return 1;       // GG stereo / PSG
  if (cmd >= 0x51 && cmd <= 0x5f) return 2;         // classic two-operand chips
  if (cmd === 0x61) return 2;                       // wait nnnn
  if (cmd === 0x62 || cmd === 0x63 || cmd === 0x66) return 0;
  if (cmd >= 0x70 && cmd <= 0x8f) return 0;         // short waits / YM2612 PCM
  if (cmd === 0x90 || cmd === 0x91 || cmd === 0x95) return 4;
  if (cmd === 0x92) return 5;
  if (cmd === 0x93) return 10;
  if (cmd === 0x94) return 1;
  if (cmd >= 0xa0 && cmd <= 0xbf) return 2;
  if (cmd >= 0xc0 && cmd <= 0xdf) return 3;
  if (cmd >= 0xe0) return 4;
  return 0;
}

/**
 * A VGM replayer that emits register writes instead of audio.
 *
 * Timing is carried in the file as waits measured in 44 100 Hz samples, so the
 * player keeps a sample clock and consumes commands until it has caught up with
 * wall-clock time. Because the writes go through the store, playback is driven
 * from the animation frame rather than the audio thread: a write can therefore
 * land up to one frame (~16 ms) from its recorded moment. For a driver that
 * writes on the 50 Hz interrupt this is inaudible, and it buys the thing the page
 * exists for — every widget on the site seeing every write.
 */
export class VgmPlayer {
  /**
   * @param {Uint8Array} bytes raw VGM (already un-gzipped)
   * @param {{onWrite: (addr:number, value:number)=>void, onEnd?: ()=>void,
   *          onLoop?: ()=>void, onPsgWrite?: (reg:number,value:number)=>void}} opts
   */
  constructor(bytes, opts) {
    this.b = bytes;
    this.header = parseHeader(bytes);
    this.onWrite = opts.onWrite;
    // The PSG side of an OPLL+PSG file: AY-3-8910 register writes, forwarded to
    // the PSG worklet rather than into the OPLL store (the store is OPLL-only).
    // Optional — a file without a PSG, or a page that does not want it, leaves
    // this null and those writes are simply skipped.
    this.onPsgWrite = opts.onPsgWrite || null;
    this.onEnd = opts.onEnd || null;
    this.onLoop = opts.onLoop || null;
    this.loop = true;
    // Set once the file actually writes the PSG, so the page can say "and drums"
    // rather than trusting the header's chip list alone.
    this.usesPsg = false;
    this.writeCount = 0;
    this.psgWriteCount = 0;
    this.rewind();
  }

  rewind() {
    this.pos = this.header.dataOffset;
    this.samples = 0;      // position in the song, in 44.1 kHz samples
    this.pending = 0;      // fractional samples carried between ticks
    this.partial = 0;      // how far into a long wait we are
    this.ended = false;
    this.writesThisTick = 0;
  }

  get positionSeconds() { return this.samples / 44100; }
  get durationSeconds() { return (this.header.totalSamples || 0) / 44100; }

  /** Advance by `dtMs` of wall-clock time, emitting every write that falls in it. */
  tick(dtMs) {
    if (this.ended) return;
    this.pending += (dtMs / 1000) * 44100;
    // Guard against a long stall turning into a burst of thousands of writes.
    const budget = Math.min(this.pending, 44100 * 0.25);
    this.pending = 0;
    this.writesThisTick = 0;
    let remaining = budget;
    while (remaining > 0 && !this.ended) {
      const waited = this.step(remaining);
      if (waited <= 0 && this.ended) break;
      remaining -= waited;
    }
  }

  /**
   * Execute commands until one of them waits. Returns the number of samples
   * consumed by that wait (0 if the stream ended). `limit` caps a single wait so
   * a long rest is spread over several ticks rather than swallowed whole.
   */
  step(limit) {
    const b = this.b;
    for (;;) {
      if (this.pos >= b.length) { this.finish(); return 0; }
      const cmd = b[this.pos];

      // --- waits ---
      if (cmd === 0x61) {
        const n = b[this.pos + 1] | (b[this.pos + 2] << 8);
        return this.consumeWait(n, 3, limit);
      }
      if (cmd === 0x62) return this.consumeWait(735, 1, limit);   // one NTSC frame
      if (cmd === 0x63) return this.consumeWait(882, 1, limit);   // one PAL frame
      if (cmd >= 0x70 && cmd <= 0x7f) return this.consumeWait((cmd & 0x0f) + 1, 1, limit);
      if (cmd >= 0x80 && cmd <= 0x8f) {
        // YM2612 PCM write + wait n; we have no YM2612, so only the wait counts.
        const n = cmd & 0x0f;
        if (n === 0) { this.pos += 1; continue; }
        return this.consumeWait(n, 1, limit);
      }

      // --- end of stream ---
      if (cmd === 0x66) {
        if (this.loop && this.header.loopOffset) {
          this.pos = this.header.loopOffset;
          this.samples = 0;
          this.onLoop?.();
          continue;
        }
        this.finish();
        return 0;
      }

      // --- variable-length commands we only need to skip ---
      if (cmd === 0x67) {                       // data block: 0x67 0x66 tt ssssssss
        const len = u32(b, this.pos + 3);
        this.pos += 7 + len;
        continue;
      }
      if (cmd === 0x68) { this.pos += 12; continue; }   // PCM RAM write

      // --- the PSG, if this file has one and the page wants it ---
      if (cmd === 0xa0) {                       // AY8910 write: register, value
        const reg = u8(b, this.pos + 1);
        const val = u8(b, this.pos + 2);
        // Bit 7 of the register byte marks a write to a second AY (dual-chip).
        // We model one PSG, so those are dropped rather than folded in.
        if (!(reg & 0x80) && this.onPsgWrite) {
          this.onPsgWrite(reg & 0x0f, val);
          this.usesPsg = true;
          this.psgWriteCount++;
        }
        this.pos += 3;
        continue;
      }

      // --- the one command we are here for: YM2413 register write ---
      if (cmd === 0x51) {
        const reg = u8(b, this.pos + 1);
        const val = u8(b, this.pos + 2);
        // The OPLL answers to 00–38; anything else is a mirror or noise. Guard
        // so a malformed log falls silent rather than scribbling out of range.
        if (reg <= 0x38) {
          this.onWrite(reg, val);
          this.writeCount++;
          this.writesThisTick++;
        }
        this.pos += 3;
        continue;
      }

      this.pos += 1 + operandLength(cmd);
    }
  }

  /**
   * Take up to `limit` samples out of a wait. If the wait is longer than the
   * caller's budget the command is left in place with the remainder rewritten
   * into our own counter, so long rests stay sample-accurate across ticks.
   */
  consumeWait(n, cmdLen, limit) {
    const already = this.partial || 0;
    const left = n - already;
    if (left <= limit) {
      this.pos += cmdLen;
      this.partial = 0;
      this.samples += left;
      return left;
    }
    this.partial = already + limit;
    this.samples += limit;
    return limit;
  }

  finish() {
    this.ended = true;
    this.onEnd?.();
  }
}
