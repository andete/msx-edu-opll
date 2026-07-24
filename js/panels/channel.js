// channel.js — one compact voice strip in the nine-channel mixer (Phase 5).
//
// The OPLL is nine of these. Each strip owns one channel's public controls:
// instrument (00–07 user slot, or one of the 15 ROM sounds), volume, pitch (a
// MIDI-note slider that resolves to F-Number/Block), and a hold-to-sound Key
// button. Writes go through the store by channel (registers 10+ch / 20+ch /
// 30+ch); two-way bound, so the strip also lights up when the polyphonic
// allocator keys the channel from the piano. See design/build-plan.md §5.

import { INSTRUMENT_NAMES, midiToName, midiToFnumBlock, fnumBlockToFreq } from '../opll-spec.js';

const LO_MIDI = 36, HI_MIDI = 96;   // C2..C7 — the strip's playable range

export class ChannelPanel {
  constructor(el, store, ch, { onFocus = null } = {}) {
    this.el = el;
    this.store = store;
    this.ch = ch;
    this.onFocus = onFocus;

    el.classList.add('chan-strip');
    el.innerHTML = `
      <div class="chan-head">
        <span class="chan-id">ch${ch + 1}</span>
        <span class="chan-tag">3${ch}h</span>
      </div>
      <select class="chan-inst" data-inst aria-label="ch${ch + 1} instrument">
        ${INSTRUMENT_NAMES.map((n, i) => `<option value="${i}">${i}·${n}</option>`).join('')}
      </select>
      <label class="chan-ctl">
        <span>Note <b data-note-v>—</b></span>
        <input type="range" min="${LO_MIDI}" max="${HI_MIDI}" step="1" data-note aria-label="ch${ch + 1} pitch">
      </label>
      <label class="chan-ctl">
        <span>Level <b data-vol-v>0</b></span>
        <input type="range" min="0" max="15" step="1" data-vol aria-label="ch${ch + 1} volume">
      </label>
      <button type="button" class="chan-key" data-key aria-label="ch${ch + 1} key on">Key</button>`;

    this.instEl = el.querySelector('[data-inst]');
    this.noteEl = el.querySelector('[data-note]');
    this.noteV = el.querySelector('[data-note-v]');
    this.volEl = el.querySelector('[data-vol]');
    this.volV = el.querySelector('[data-vol-v]');
    this.keyEl = el.querySelector('[data-key]');

    this.instEl.addEventListener('change', () => this.store.setInstrument(this.ch, +this.instEl.value));
    this.volEl.addEventListener('input', () => this.store.setVolume(this.ch, +this.volEl.value));
    this.noteEl.addEventListener('input', () => this._pushNote());

    // Hold to sound: key-on while pressed, key-off on release/leave.
    const down = (e) => { e.preventDefault(); this.store.keyOn(this.ch, true); };
    const up = () => this.store.keyOn(this.ch, false);
    this.keyEl.addEventListener('pointerdown', (e) => { down(e); try { this.keyEl.setPointerCapture(e.pointerId); } catch { /* ignore */ } });
    this.keyEl.addEventListener('pointerup', up);
    this.keyEl.addEventListener('pointercancel', up);

    // Clicking anywhere non-interactive on the strip focuses this channel (for
    // pages that expand one voice); harmless when no handler is wired.
    if (this.onFocus) el.addEventListener('click', (e) => {
      if (e.target.closest('input, select, button')) return;
      this.onFocus(this.ch);
    });

    this._unsub = store.subscribe((evt) => {
      if (evt.type === 'reset') this.refresh();
      else if (evt.type === 'reg' && this._touches(evt.addr)) this.refresh();
    });
    this.refresh();
  }

  _touches(addr) {
    return addr === 0x10 + this.ch || addr === 0x20 + this.ch || addr === 0x30 + this.ch;
  }

  _pushNote() {
    const { fnum, block } = midiToFnumBlock(+this.noteEl.value);
    this.store.setFnum(this.ch, fnum);
    this.store.setBlock(this.ch, block);
  }

  _readFnum() {
    return ((this.store.get(0x20 + this.ch) & 1) << 8) | this.store.get(0x10 + this.ch);
  }

  refresh() {
    const reg20 = this.store.get(0x20 + this.ch);
    const reg30 = this.store.get(0x30 + this.ch);
    this.instEl.value = (reg30 >> 4) & 0x0f;
    const vol = reg30 & 0x0f;
    this.volEl.value = vol; this.volV.textContent = vol;

    const hz = fnumBlockToFreq(this._readFnum(), (reg20 >> 1) & 7);
    const midi = hz >= 8 ? Math.round(69 + 12 * Math.log2(hz / 440)) : LO_MIDI;
    this.noteEl.value = Math.min(HI_MIDI, Math.max(LO_MIDI, midi));
    this.noteV.textContent = hz >= 8 ? midiToName(midi) : '—';

    const on = !!((reg20 >> 4) & 1);
    this.keyEl.classList.toggle('on', on);
    this.el.classList.toggle('sounding', on);
  }

  destroy() { this._unsub && this._unsub(); }
}
