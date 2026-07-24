// pitch.js — the pitch panel for one channel: F-Number + Block sliders, the live
// frequency/note readout, and the Multiple readout. Writes go through the store;
// the store notifies audio + viz. Two-way bound to the register file.

import { fnumBlockToFreq, midiToName } from '../opll-spec.js';

export class PitchPanel {
  constructor(el, store, ch = 0) {
    this.store = store;
    this.ch = ch;
    el.classList.add('panel', 'panel-pitch');
    el.innerHTML = `
      <div class="panel-head">
        <span class="panel-title">Pitch</span>
        <span class="panel-tag">10${ch}h · 20${ch}h</span>
      </div>
      <div class="readout">
        <span class="readout-freq" data-freq>—</span>
        <span class="readout-note" data-note></span>
      </div>
      <label class="ctl">
        <span class="ctl-label">F-Number <b data-fnum-v>0</b></span>
        <input type="range" min="0" max="511" step="1" data-fnum>
      </label>
      <label class="ctl">
        <span class="ctl-label">Block (octave) <b data-block-v>0</b></span>
        <input type="range" min="0" max="7" step="1" data-block>
      </label>
      <div class="ctl-sub"><span>f = F·fsam / 2^(19−Block)</span><code data-inc></code></div>`;

    this.freq = el.querySelector('[data-freq]');
    this.note = el.querySelector('[data-note]');
    this.fnum = el.querySelector('[data-fnum]');
    this.block = el.querySelector('[data-block]');
    this.fnumV = el.querySelector('[data-fnum-v]');
    this.blockV = el.querySelector('[data-block-v]');

    this.fnum.addEventListener('input', () => this._pushFnum());
    this.block.addEventListener('input', () => this._pushBlock());

    this._unsub = store.subscribe((evt) => {
      if (evt.type === 'reg' && (this._touches(evt.addr))) this.refresh();
      else if (evt.type === 'reset') this.refresh();
    });
    this.refresh();
  }

  _touches(addr) { return addr === 0x10 + this.ch || addr === 0x20 + this.ch; }

  _readFnum() {
    const lo = this.store.get(0x10 + this.ch);
    const hi = (this.store.get(0x20 + this.ch) & 1) << 8;
    return hi | lo;
  }
  _readBlock() { return (this.store.get(0x20 + this.ch) >> 1) & 7; }

  _pushFnum() {
    this.store.setFnum(this.ch, Number(this.fnum.value));
  }
  _pushBlock() {
    this.store.setBlock(this.ch, Number(this.block.value));
  }

  refresh() {
    const f = this._readFnum();
    const b = this._readBlock();
    this.fnum.value = f; this.block.value = b;
    this.fnumV.textContent = f; this.blockV.textContent = b;
    const hz = fnumBlockToFreq(f, b);
    this.freq.textContent = hz >= 1 ? `${hz.toFixed(1)} Hz` : '—';
    this.note.textContent = hz >= 8 ? `≈ ${nearestNote(hz)}` : '';
  }

  destroy() { this._unsub && this._unsub(); }
}

// nearest equal-tempered note name for a frequency
function nearestNote(hz) {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return midiToName(midi);
}
