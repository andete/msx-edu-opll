// operator.js — the full controls for one operator of the user instrument.
//
// TIMBRE (Phase 3 — FM): Multiple (the harmonic ratio), and — for the modulator —
// Total Level (how hard it drives the carrier = FM depth) and Feedback, plus the
// sine / half-sine waveform (WS). ENVELOPE (Phase 2): Attack / Decay / Sustain-
// level / Release, EG-type (sustained vs percussive) and the per-channel Sustain
// bit. Edits the user patch (registers 00–07) plus reg 20+ch bit5; two-way bound.
//
// `which` selects the operator: 'mod' (modulator) or 'car' (carrier). The carrier
// has no Total Level (its level is the channel volume) and no feedback, so those
// controls appear on the modulator only. See reference §5, §6, §8.

import { ML2 } from '../opll-spec.js';

const OP = {
  mod: { title: 'Modulator', tag: '00·02·04·06', mlReg: 0x00, flags: 0x00, adr: 0x04, slrr: 0x06, wsBit: 3, isMod: true },
  car: { title: 'Carrier', tag: '01·03·05·07', mlReg: 0x01, flags: 0x01, adr: 0x05, slrr: 0x07, wsBit: 4, isMod: false },
};

export class OperatorPanel {
  constructor(el, store, which = 'car', ch = 0) {
    this.store = store;
    this.ch = ch;
    this.which = which;
    this.map = OP[which];
    const m = this.map;
    el.classList.add('panel', 'panel-env', which === 'mod' ? 'panel-op-mod' : 'panel-op-car');
    el.innerHTML = `
      <div class="panel-head">
        <span class="panel-title">${m.title}</span>
        <span class="panel-tag">${m.tag}</span>
      </div>
      <div class="op-sub">timbre</div>
      ${slider('ml', 'Multiple', 0, 15)}
      ${m.isMod ? slider('tl', 'Total level (FM depth)', 0, 63) : ''}
      ${m.isMod ? slider('fb', 'Feedback', 0, 7) : ''}
      <label class="chk"><input type="checkbox" data-ws> <span>Half-sine wave</span></label>
      <div class="op-sub">envelope</div>
      ${slider('ar', 'Attack', 0, 15)}
      ${slider('dr', 'Decay', 0, 15)}
      ${slider('sl', 'Sustain level', 0, 15)}
      ${slider('rr', 'Release', 0, 15)}
      <div class="chk-row">
        <label class="chk"><input type="checkbox" data-eg> <span>Sustained (EG-type)</span></label>
        <label class="chk"><input type="checkbox" data-sus> <span>Sustain (channel)</span></label>
      </div>`;

    // range inputs (present ones only)
    this.inputs = {};
    this.valEls = {};
    const keys = ['ml', 'ar', 'dr', 'sl', 'rr'];
    if (m.isMod) keys.push('tl', 'fb');
    for (const k of keys) {
      this.inputs[k] = el.querySelector(`[data-${k}]`);
      this.valEls[k] = el.querySelector(`[data-${k}-v]`);
      this.inputs[k].addEventListener('input', () => this._push());
    }
    this.ws = el.querySelector('[data-ws]');
    this.eg = el.querySelector('[data-eg]');
    this.sus = el.querySelector('[data-sus]');
    this.ws.addEventListener('change', () => this._push());
    this.eg.addEventListener('change', () => this._push());
    this.sus.addEventListener('change', () => this._pushSus());

    this._unsub = store.subscribe((evt) => {
      if (evt.type === 'reset' ||
          (evt.type === 'reg' && this._touches(evt.addr))) this.refresh();
    });
    this.refresh();
  }

  _touches(addr) {
    return addr === this.map.mlReg || addr === this.map.flags ||
           addr === this.map.adr || addr === this.map.slrr ||
           addr === 0x02 || addr === 0x03 ||   // modulator TL/KSL, feedback + both WS bits
           addr === 0x20 + this.ch;
  }

  _push() {
    const m = this.map;
    // timbre: Multiple lives in the flags byte (00/01) low nibble
    this.store.setField(m.mlReg, 0, 3, +this.inputs.ml.value);
    if (m.isMod) {
      this.store.setField(0x02, 0, 5, +this.inputs.tl.value); // modulator Total Level (6-bit)
      this.store.setField(0x03, 0, 2, +this.inputs.fb.value); // feedback (3-bit)
    }
    this.store.setBit(0x03, m.wsBit, this.ws.checked);         // DM (mod) / DC (car) waveform
    // envelope
    this.store.set(m.adr, (+this.inputs.ar.value << 4) | +this.inputs.dr.value);
    this.store.set(m.slrr, (+this.inputs.sl.value << 4) | +this.inputs.rr.value);
    this.store.setBit(m.flags, 5, this.eg.checked);            // EG-type
  }
  _pushSus() { this.store.setBit(0x20 + this.ch, 5, this.sus.checked); }

  refresh() {
    const m = this.map;
    const flags = this.store.get(m.flags);
    const adr = this.store.get(m.adr), slrr = this.store.get(m.slrr);
    const vals = {
      ml: flags & 0x0f,
      ar: adr >> 4, dr: adr & 15, sl: slrr >> 4, rr: slrr & 15,
    };
    if (m.isMod) {
      vals.tl = this.store.get(0x02) & 0x3f;
      vals.fb = this.store.get(0x03) & 0x07;
    }
    for (const k of Object.keys(this.inputs)) {
      this.inputs[k].value = vals[k];
      this.valEls[k].textContent = k === 'ml' ? mlLabel(vals[k]) : vals[k];
    }
    this.ws.checked = !!((this.store.get(0x03) >> m.wsBit) & 1);
    this.eg.checked = !!((flags >> 5) & 1);
    this.sus.checked = !!((this.store.get(0x20 + this.ch) >> 5) & 1);
  }

  destroy() { this._unsub && this._unsub(); }
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
