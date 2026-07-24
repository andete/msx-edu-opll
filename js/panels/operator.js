// operator.js — the envelope controls for one operator of the user instrument:
// Attack / Decay / Sustain-level / Release, the EG-type (sustained vs
// percussive), and the per-channel Sustain bit. Edits the user patch (registers
// 00–07) plus reg 20+ch bit5. Two-way bound through the store.
//
// Operator selector: 'car' (carrier, addresses 05/07/01) or 'mod' (04/06/00).
// Phase 2 wires the carrier; the modulator's own envelope arrives with FM.

const OP = {
  car: { adr: 0x05, slrr: 0x07, flags: 0x01, title: 'Carrier envelope', tag: '05h · 07h' },
  mod: { adr: 0x04, slrr: 0x06, flags: 0x00, title: 'Modulator envelope', tag: '04h · 06h' },
};

export class OperatorPanel {
  constructor(el, store, which = 'car', ch = 0) {
    this.store = store;
    this.ch = ch;
    this.map = OP[which];
    el.classList.add('panel', 'panel-env');
    el.innerHTML = `
      <div class="panel-head">
        <span class="panel-title">${this.map.title}</span>
        <span class="panel-tag">${this.map.tag}</span>
      </div>
      ${slider('ar', 'Attack')}
      ${slider('dr', 'Decay')}
      ${slider('sl', 'Sustain level')}
      ${slider('rr', 'Release')}
      <div class="chk-row">
        <label class="chk"><input type="checkbox" data-eg> <span>Sustained (EG-type)</span></label>
        <label class="chk"><input type="checkbox" data-sus> <span>Sustain (channel)</span></label>
      </div>`;

    this.inputs = {};
    for (const k of ['ar', 'dr', 'sl', 'rr']) {
      this.inputs[k] = el.querySelector(`[data-${k}]`);
      this.inputs[k].addEventListener('input', () => this._push());
    }
    this.eg = el.querySelector('[data-eg]');
    this.sus = el.querySelector('[data-sus]');
    this.eg.addEventListener('change', () => this._push());
    this.sus.addEventListener('change', () => this._pushSus());
    this.valEls = {};
    for (const k of ['ar', 'dr', 'sl', 'rr']) this.valEls[k] = el.querySelector(`[data-${k}-v]`);

    this._unsub = store.subscribe((evt) => {
      if (evt.type === 'reset' ||
          (evt.type === 'reg' && this._touches(evt.addr))) this.refresh();
    });
    this.refresh();
  }

  _touches(addr) {
    return addr === this.map.adr || addr === this.map.slrr ||
           addr === this.map.flags || addr === 0x20 + this.ch;
  }

  _push() {
    const ar = +this.inputs.ar.value, dr = +this.inputs.dr.value;
    const sl = +this.inputs.sl.value, rr = +this.inputs.rr.value;
    this.store.set(this.map.adr, (ar << 4) | dr);
    this.store.set(this.map.slrr, (sl << 4) | rr);
    this.store.setBit(this.map.flags, 5, this.eg.checked); // EG-type bit
  }
  _pushSus() { this.store.setBit(0x20 + this.ch, 5, this.sus.checked); }

  refresh() {
    const adr = this.store.get(this.map.adr), slrr = this.store.get(this.map.slrr);
    const vals = { ar: adr >> 4, dr: adr & 15, sl: slrr >> 4, rr: slrr & 15 };
    for (const k of ['ar', 'dr', 'sl', 'rr']) {
      this.inputs[k].value = vals[k];
      this.valEls[k].textContent = vals[k];
    }
    this.eg.checked = !!((this.store.get(this.map.flags) >> 5) & 1);
    this.sus.checked = !!((this.store.get(0x20 + this.ch) >> 5) & 1);
  }

  destroy() { this._unsub && this._unsub(); }
}

function slider(key, label) {
  return `<label class="ctl">
    <span class="ctl-label">${label} <b data-${key}-v>0</b></span>
    <input type="range" min="0" max="15" step="1" data-${key}>
  </label>`;
}
