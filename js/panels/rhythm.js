// rhythm.js — the 6+5 drum panel (Phase 6).
//
// Writing bit 5 of register 0E flips the OPLL out of "nine melodic voices" into
// "six melodic + five drums": channels 7-9 become Bass Drum, Snare, Tom, Cymbal
// and Hi-Hat, each keyed by its own bit of 0E (not the channel key), voiced by
// the fixed rhythm ROM patches, and mixed +3 dB. This panel is that register,
// made playable: a mode switch, five hold-to-hit pads with a level each, and a
// looping demo beat so you can hear the reinterpretation at once. It writes only
// 0E and the drum-volume nibbles of 36/37/38 (plus a one-time drum tuning into
// 16-18/26-28); the core does the rest. See reference §9, design/build-plan.md §5.

const MODE_BIT = 5;

// The five drums, in a drummer's left-to-right order. `bit` is the 0E key bit;
// `vol` is the {reg, lo} of the 4-bit volume nibble (hi nibble when lo === 4).
const DRUMS = [
  { key: 'BD',  bit: 4, label: 'Bass',   glyph: '●', vol: { reg: 0x36, lo: 0 } },
  { key: 'SD',  bit: 3, label: 'Snare',  glyph: '◆', vol: { reg: 0x37, lo: 0 } },
  { key: 'TOM', bit: 2, label: 'Tom',    glyph: '▲', vol: { reg: 0x38, lo: 4 } },
  { key: 'CYM', bit: 1, label: 'Cymbal', glyph: '✳', vol: { reg: 0x38, lo: 0 } },
  { key: 'HH',  bit: 0, label: 'Hi-Hat', glyph: '×', vol: { reg: 0x37, lo: 4 } },
];

// A one-bar sixteenth-note groove: which drum bits fire on each of the 16 steps.
// Bass on the 1 and the 3 (+ a pickup), snare on the 2 and the 4 backbeat, hats
// on every eighth, a crash to open the bar.
const BEAT_STEPS = 16;
const PATTERN = {
  BD:  [0, 8, 11],
  SD:  [4, 12],
  TOM: [],
  CYM: [0],
  HH:  [0, 2, 4, 6, 8, 10, 12, 14],
};
const STEP_MS = 125;   // ~120 BPM sixteenths

// Sensible fixed drum tuning, written once when rhythm mode is switched on:
// {fnum, block} per channel 7/8/9. Chosen for how the ROM patches multiply it —
// e.g. the Tom operator (patch 18) has Multiple ×5, so channel 9 is tuned low so
// the tom lands ~150 Hz, not shrill. Bass drum ~65 Hz; the snare/metal channels
// sit high so the hats and cymbal read bright.
const DRUM_TUNE = [
  { ch: 6, fnum: 86,  block: 3 },  // ch7 — Bass Drum   (~65 Hz)
  { ch: 7, fnum: 122, block: 4 },  // ch8 — Hi-Hat / Snare (snare body ~185 Hz)
  { ch: 8, fnum: 80,  block: 2 },  // ch9 — Tom / Cymbal (tom ~150 Hz via ×5)
];

/**
 * Options:
 *   beat     — show the looping demo-beat button (default true). Turn it off where
 *              something else is already driving 0E, like a tune playing: two
 *              sequencers writing the same register is noise, not a lesson.
 *   latchMs  — hold a pad lit this long after its bit falls (default 0, exact).
 *              A drum keyed for three 50 Hz frames can come and go between two
 *              paints; the readout below the pads stays exact either way.
 */
export class RhythmPanel {
  constructor(el, store, opts = {}) {
    this.el = el;
    this.store = store;
    this.showBeat = opts.beat !== false;
    this.latchMs = opts.latchMs || 0;
    this.latched = {};        // drum key -> timeout id
    this.beatTimer = null;
    this.beatStep = 0;

    el.classList.add('panel', 'panel-rhythm');
    el.innerHTML = `
      <div class="panel-head">
        <span class="panel-title">Rhythm</span>
        <span class="panel-tag">0Eh</span>
      </div>
      <label class="rhythm-mode">
        <input type="checkbox" data-mode>
        <span>Rhythm mode <b class="rhythm-mode-hint">— ch7-9 become 5 drums</b></span>
      </label>
      <div class="drum-pads" data-pads>
        ${DRUMS.map((d) => `
          <div class="drum-pad-cell">
            <button type="button" class="drum-pad" data-pad="${d.key}"
                    aria-label="${d.label} (0E bit ${d.bit})">
              <span class="drum-glyph">${d.glyph}</span>
              <span class="drum-name">${d.label}</span>
              <span class="drum-bit">bit ${d.bit}</span>
            </button>
            <input type="range" class="drum-vol" min="0" max="15" step="1" value="0"
                   data-vol="${d.key}" aria-label="${d.label} level">
          </div>`).join('')}
      </div>
      <div class="rhythm-foot">
        ${this.showBeat ? '<button type="button" class="btn beat-btn" data-beat>▶ Demo beat</button>' : ''}
        <code class="rhythm-reg" data-reg>0E = 00</code>
      </div>`;

    this.modeEl = el.querySelector('[data-mode]');
    this.padsEl = el.querySelector('[data-pads]');
    this.beatEl = el.querySelector('[data-beat]');
    this.regEl = el.querySelector('[data-reg]');
    this.pads = {};
    for (const d of DRUMS) this.pads[d.key] = el.querySelector(`[data-pad="${d.key}"]`);

    // Mode switch: seed the drum tuning/volumes, then flip 0E bit5.
    this.modeEl.addEventListener('change', () => {
      if (this.modeEl.checked) this._seedDrums();
      this.store.setBit(0x0e, MODE_BIT, this.modeEl.checked);
      if (!this.modeEl.checked) this._stopBeat();
    });

    // Hold-to-hit pads: press keys the drum's 0E bit, release clears it.
    for (const d of DRUMS) {
      const pad = this.pads[d.key];
      const down = (e) => {
        e.preventDefault();
        if (!this._rhythmOn()) return;   // pads are dead until rhythm mode is on
        this.store.setBit(0x0e, d.bit, true);
      };
      const up = () => { if (this._rhythmOn()) this.store.setBit(0x0e, d.bit, false); };
      pad.addEventListener('pointerdown', (e) => { down(e); try { pad.setPointerCapture(e.pointerId); } catch { /* ignore */ } });
      pad.addEventListener('pointerup', up);
      pad.addEventListener('pointercancel', up);
    }

    // Volume sliders → the 4-bit drum-volume nibbles of 36/37/38.
    for (const d of DRUMS) {
      el.querySelector(`[data-vol="${d.key}"]`).addEventListener('input', (e) => {
        this.store.setField(d.vol.reg, d.vol.lo, d.vol.lo + 3, +e.target.value & 0x0f);
      });
    }

    if (this.beatEl) this.beatEl.addEventListener('click', () => this._toggleBeat());

    this._unsub = store.subscribe((evt) => {
      if (evt.type === 'reset') { this._stopBeat(); this.refresh(); }
      else if (evt.type === 'reg' && this._touches(evt.addr)) this.refresh();
    });
    this.refresh();
  }

  _rhythmOn() { return !!this.store.bit(0x0e, MODE_BIT); }

  _touches(addr) { return addr === 0x0e || addr === 0x36 || addr === 0x37 || addr === 0x38; }

  // Write the drum tuning and current slider levels so the kit sounds right the
  // moment rhythm mode comes on. (Pitch goes in *before* the mode bit, so the
  // core resolves the drum increments from it.)
  _seedDrums() {
    for (const t of DRUM_TUNE) { this.store.setFnum(t.ch, t.fnum); this.store.setBlock(t.ch, t.block); }
    for (const d of DRUMS) {
      const v = +this.el.querySelector(`[data-vol="${d.key}"]`).value & 0x0f;
      this.store.setField(d.vol.reg, d.vol.lo, d.vol.lo + 3, v);
    }
  }

  // ---- the looping demo beat ----------------------------------------------
  _toggleBeat() { this.beatTimer ? this._stopBeat() : this._startBeat(); }

  _startBeat() {
    if (!this._rhythmOn()) { this.modeEl.checked = true; this.modeEl.dispatchEvent(new Event('change')); }
    this.beatStep = 0;
    const tick = () => {
      // Compute the bits that hit on this step, then key everything off and
      // straight back on — a clean rising edge re-triggers each drum every hit.
      let hits = 0;
      for (const d of DRUMS) if (PATTERN[d.key].includes(this.beatStep)) hits |= (1 << d.bit);
      const mode = 1 << MODE_BIT;
      this.store.set(0x0e, mode);            // release all drums
      this.store.set(0x0e, mode | hits);     // trigger this step's drums
      this.beatStep = (this.beatStep + 1) % BEAT_STEPS;
    };
    tick();
    this.beatTimer = setInterval(tick, STEP_MS);
    this.beatEl.classList.add('playing');
    this.beatEl.textContent = '■ Stop beat';
  }

  _stopBeat() {
    if (this.beatTimer) { clearInterval(this.beatTimer); this.beatTimer = null; }
    if (!this.beatEl) return;
    if (this._rhythmOn()) this.store.set(0x0e, 1 << MODE_BIT);  // all drums off
    this.beatEl.classList.remove('playing');
    this.beatEl.textContent = '▶ Demo beat';
  }

  // Light a pad. With latchMs the lit state outlives the key bit, so a hit that
  // opens and closes between two paints is still seen.
  _light(d, on) {
    const pad = this.pads[d.key];
    if (!this.latchMs) { pad.classList.toggle('hit', on); return; }
    if (on) {
      pad.classList.add('hit');
      clearTimeout(this.latched[d.key]);
      this.latched[d.key] = setTimeout(() => {
        this.latched[d.key] = 0;
        if (!((this.store.get(0x0e) >> d.bit) & 1) || !this._rhythmOn()) pad.classList.remove('hit');
      }, this.latchMs);
    } else if (!this.latched[d.key]) {
      pad.classList.remove('hit');
    }
  }

  refresh() {
    const reg = this.store.get(0x0e);
    const on = !!((reg >> MODE_BIT) & 1);
    this.modeEl.checked = on;
    this.padsEl.classList.toggle('armed', on);
    this.regEl.textContent = `0E = ${reg.toString(16).padStart(2, '0').toUpperCase()}`;
    for (const d of DRUMS) {
      this._light(d, on && !!((reg >> d.bit) & 1));
      const v = (this.store.get(d.vol.reg) >> d.vol.lo) & 0x0f;
      this.el.querySelector(`[data-vol="${d.key}"]`).value = v;
    }
  }

  destroy() {
    this._stopBeat();
    for (const k of Object.keys(this.latched)) clearTimeout(this.latched[k]);
    this._unsub && this._unsub();
  }
}
