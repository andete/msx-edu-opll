// store.js — the single source of truth: the OPLL's write-only register file.
//
// The YM2413 cannot be read back, so a real driver keeps a shadow copy of every
// register it has written. That shadow IS our model: the 64 addresses 00–38 as a
// Uint8Array. Everything (audio worklet, UI panels, the visualiser) reads from
// here and is notified on change. Nothing else owns register state.
// See design/build-plan.md §2–§3.

const subscribers = new Set();

export const store = {
  regs: new Uint8Array(0x40),
  clock: 3579545,

  /** Set register `addr` (0x00..0x38) to `value` (0..255). */
  set(addr, value, { force = false } = {}) {
    addr &= 0x3f;
    value &= 0xff;
    if (this.regs[addr] === value && !force) return;
    this.regs[addr] = value;
    emit({ type: 'reg', addr, value });
  },

  setBit(addr, bit, on) {
    const cur = this.regs[addr & 0x3f];
    this.set(addr, on ? (cur | (1 << bit)) : (cur & ~(1 << bit)));
  },

  setField(addr, lo, hi, val) {
    const width = hi - lo + 1;
    const mask = ((1 << width) - 1) << lo;
    const cur = this.regs[addr & 0x3f];
    this.set(addr, (cur & ~mask) | ((val << lo) & mask));
  },

  get(addr) { return this.regs[addr & 0x3f]; },
  bit(addr, b) { return (this.regs[addr & 0x3f] >> b) & 1; },

  // ---- convenience over set(), by channel (0..8) ----
  setFnum(ch, f) {
    this.set(0x10 + ch, f & 0xff);
    const hi = this.regs[0x20 + ch] & ~0x01;
    this.set(0x20 + ch, hi | ((f >> 8) & 1));
  },
  setBlock(ch, b) { this.setField(0x20 + ch, 1, 3, b & 7); },
  keyOn(ch, on) { this.setBit(0x20 + ch, 4, !!on); },
  setSustain(ch, on) { this.setBit(0x20 + ch, 5, !!on); },
  setInstrument(ch, n) { this.setField(0x30 + ch, 4, 7, n & 0x0f); },
  setVolume(ch, v) { this.setField(0x30 + ch, 0, 3, v & 0x0f); },
  setUserPatchByte(i, v) { this.set(i & 0x07, v); },

  /** Load a full register set (e.g. a preset): {addr: value, …} or a 0x40 array. */
  loadRegs(bytes) {
    if (Array.isArray(bytes) || bytes instanceof Uint8Array) {
      for (let a = 0; a < 0x40; a++) this.set(a, bytes[a] ?? 0);
    } else {
      for (const k of Object.keys(bytes)) this.set(Number(k), bytes[k]);
    }
  },

  /** Silence + clear: key everything off and zero the file. */
  reset() {
    for (let a = 0; a < 0x40; a++) this.set(a, 0);
    emit({ type: 'reset' });
  },

  subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
};

function emit(evt) { for (const fn of subscribers) fn(evt); }
