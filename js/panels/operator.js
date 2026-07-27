// operator.js — the full controls for one operator of the user instrument.
//
// TIMBRE (Phase 3 — FM): Multiple (the harmonic ratio), and — for the modulator —
// Total Level (how hard it drives the carrier = FM depth) and Feedback, plus the
// sine / half-sine waveform (WS). ENVELOPE (Phase 2): Attack / Decay / Sustain-
// level / Release, EG-type (sustained vs percussive) and the per-channel SUS bit
// (a fixed slow release rate, overriding RR at Key-Off — it belongs to the
// channel, not the patch). Edits registers 00–07 plus reg 20+ch bit5; two-way
// bound.
//
// `which` selects the operator: 'mod' (modulator) or 'car' (carrier). The carrier
// has no Total Level (its level is the channel volume) and no feedback, so those
// controls appear on the modulator only. See reference §5, §6, §8.
//
// `opts` hides sections a page has not introduced yet: `{ timbre: false }` drops
// Multiple (and TL/Feedback), `{ wave: false }` drops the half-sine checkbox, and
// `{ envelope: false }` drops the whole ADSR block. Stage 1 (Tone) shows Multiple
// alone; stage 2 (Envelope) shows the ADSR alone. Hidden controls are simply
// absent — the registers behind them keep whatever the page seeded.

import { ML2 } from '../opll-spec.js';

const OP = {
  mod: { title: 'Modulator', mlReg: 0x00, flags: 0x00, adr: 0x04, slrr: 0x06, wsBit: 3, isMod: true },
  car: { title: 'Carrier', mlReg: 0x01, flags: 0x01, adr: 0x05, slrr: 0x07, wsBit: 4, isMod: false },
};

export class OperatorPanel {
  constructor(el, store, which = 'car', ch = 0, opts = {}) {
    this.store = store;
    this.ch = ch;
    this.which = which;
    this.map = OP[which];
    const m = this.map;
    const showTim = opts.timbre !== false;
    const showWave = showTim && opts.wave !== false;
    const showEnv = opts.envelope !== false;
    this.showTim = showTim;
    this.showEnv = showEnv;
    // Sub-headings only earn their keep when both sections are on screen.
    const subs = showTim && showEnv;
    el.classList.add('panel', 'panel-env', which === 'mod' ? 'panel-op-mod' : 'panel-op-car');
    el.innerHTML = `
      <div class="panel-head">
        <span class="panel-title">${m.title}</span>
        <span class="panel-tag">${tag(m, showTim, showWave, showEnv)}</span>
      </div>
      ${showTim ? `
      ${subs ? '<div class="op-sub">timbre</div>' : ''}
      ${slider('ml', 'Multiple', 0, 15)}
      ${m.isMod ? slider('tl', 'Total level (FM depth)', 0, 63) : ''}
      ${m.isMod ? slider('fb', 'Feedback', 0, 7) : ''}
      ${showWave ? '<label class="chk"><input type="checkbox" data-ws> <span>Half-sine wave</span></label>' : ''}` : ''}
      ${showEnv ? `
      ${subs ? '<div class="op-sub">envelope</div>' : ''}
      ${slider('ar', 'Attack', 0, 15)}
      ${slider('dr', 'Decay', 0, 15)}
      ${slider('sl', 'Sustain level', 0, 15)}
      ${slider('rr', 'Release', 0, 15)}
      <div class="chk-row">
        <label class="chk"><input type="checkbox" data-eg> <span>Sustained (EG-type)</span></label>
        <label class="chk" title="Channel SUS, register 2x bit 5: on Key-Off the note releases at a fixed slow rate instead of RR.">
          <input type="checkbox" data-sus> <span>Slow release (channel SUS)</span></label>
      </div>` : ''}`;

    // range inputs (present ones only)
    this.inputs = {};
    this.valEls = {};
    const keys = [];
    if (showTim) { keys.push('ml'); if (m.isMod) keys.push('tl', 'fb'); }
    if (showEnv) keys.push('ar', 'dr', 'sl', 'rr');
    for (const k of keys) {
      this.inputs[k] = el.querySelector(`[data-${k}]`);
      this.valEls[k] = el.querySelector(`[data-${k}-v]`);
      this.inputs[k].addEventListener('input', () => this._push());
    }
    this.ws = el.querySelector('[data-ws]');
    this.eg = el.querySelector('[data-eg]');
    this.sus = el.querySelector('[data-sus]');
    this.ws && this.ws.addEventListener('change', () => this._push());
    this.eg && this.eg.addEventListener('change', () => this._push());
    this.sus && this.sus.addEventListener('change', () => this._pushSus());

    this._unsub = store.subscribe((evt) => {
      if (evt.type === 'reset' ||
          (evt.type === 'reg' && this._touches(evt.addr))) this.refresh();
    });
    this.refresh();
  }

  _touches(addr) {
    return addr === this.map.flags ||
           (this.showEnv && (addr === this.map.adr || addr === this.map.slrr)) ||
           (this.showTim && (addr === 0x02 || addr === 0x03)) ||  // mod TL, feedback + WS bits
           addr === 0x20 + this.ch;
  }

  _push() {
    const m = this.map;
    // timbre: Multiple lives in the flags byte (00/01) low nibble
    if (this.showTim) {
      this.store.setField(m.mlReg, 0, 3, +this.inputs.ml.value);
      if (m.isMod) {
        this.store.setField(0x02, 0, 5, +this.inputs.tl.value); // modulator Total Level (6-bit)
        this.store.setField(0x03, 0, 2, +this.inputs.fb.value); // feedback (3-bit)
      }
      if (this.ws) this.store.setBit(0x03, m.wsBit, this.ws.checked); // DM (mod) / DC (car) waveform
    }
    // envelope
    if (this.showEnv) {
      this.store.set(m.adr, (+this.inputs.ar.value << 4) | +this.inputs.dr.value);
      this.store.set(m.slrr, (+this.inputs.sl.value << 4) | +this.inputs.rr.value);
      this.store.setBit(m.flags, 5, this.eg.checked);          // EG-type
    }
  }
  _pushSus() { this.store.setBit(0x20 + this.ch, 5, this.sus.checked); }

  refresh() {
    const m = this.map;
    const flags = this.store.get(m.flags);
    const vals = { ml: flags & 0x0f };
    if (this.showEnv) {
      const adr = this.store.get(m.adr), slrr = this.store.get(m.slrr);
      Object.assign(vals, { ar: adr >> 4, dr: adr & 15, sl: slrr >> 4, rr: slrr & 15 });
    }
    if (m.isMod && this.showTim) {
      vals.tl = this.store.get(0x02) & 0x3f;
      vals.fb = this.store.get(0x03) & 0x07;
    }
    for (const k of Object.keys(this.inputs)) {
      this.inputs[k].value = vals[k];
      this.valEls[k].textContent = k === 'ml' ? mlLabel(vals[k]) : vals[k];
    }
    if (this.ws) this.ws.checked = !!((this.store.get(0x03) >> m.wsBit) & 1);
    if (this.eg) this.eg.checked = !!((flags >> 5) & 1);
    if (this.sus) this.sus.checked = !!((this.store.get(0x20 + this.ch) >> 5) & 1);
  }

  destroy() { this._unsub && this._unsub(); }
}

// The register tag names only the registers the visible controls write, so a
// trimmed-down panel does not advertise bytes it never touches.
function tag(m, showTim, showWave, showEnv) {
  const regs = [];
  if (showTim) {
    regs.push(m.mlReg);                         // Multiple
    if (m.isMod) regs.push(0x02);               // Total Level
    else if (showWave) regs.push(0x03);         // carrier waveform bit
  }
  if (showEnv) regs.push(m.adr, m.slrr, m.flags);
  return [...new Set(regs)].sort((a, b) => a - b)
    .map((v) => v.toString(16).padStart(2, '0')).join('·');
}

// Multiple readout: register value → audible multiplier (ML2 is ×2, so ÷2).
function mlLabel(v) {
  const mult = ML2[v] / 2;
  return `${v} (×${mult})`;
}

function slider(key, label, min, max) {
  return `<label class="ctl">
    <span class="ctl-label">${label} <b data-${key}-v>0</b></span>
    <input type="range" min="${min}" max="${max}" step="1" data-${key}>
  </label>`;
}
