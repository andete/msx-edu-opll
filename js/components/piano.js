// piano.js — a small keyboard. Emits note-on / note-off with a MIDI number.
// Pointer + touch + computer-keyboard (Z..M row) input.

import { midiToName } from '../opll-spec.js';

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const BLACK = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 }; // semitone → white-key index it sits after
// computer keyboard mapping (one octave), MSX-ish
const KEYMAP = { z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, ',': 12 };

export class Piano {
  /** @param {HTMLElement} mount @param {object} opts {octaves, base, onNoteOn, onNoteOff} */
  constructor(mount, opts = {}) {
    this.mount = mount;
    this.base = opts.base ?? 48; // C3
    this.octaves = opts.octaves ?? 3;
    this.onNoteOn = opts.onNoteOn || (() => {});
    this.onNoteOff = opts.onNoteOff || (() => {});
    this.active = new Set();
    this.pointerKeys = new Map(); // pointerId → midi currently held by that pointer (or null)
    this._build();
    this._bindKeyboard();
  }

  _build() {
    this.mount.classList.add('piano');
    this.mount.innerHTML = '';
    const board = document.createElement('div');
    board.className = 'piano-board';

    const whiteMidis = [];
    for (let o = 0; o < this.octaves; o++) {
      for (const semi of WHITE) whiteMidis.push(this.base + o * 12 + semi);
    }
    const ww = 100 / whiteMidis.length; // white-key width, %

    this.keyEls = new Map();
    // white keys (absolute, side by side)
    whiteMidis.forEach((midi, i) => {
      const k = this._makeKey(midi, 'white');
      k.style.left = `${i * ww}%`;
      k.style.width = `${ww}%`;
      board.appendChild(k);
      this.keyEls.set(midi, k);
    });
    // black keys (absolute, centred over the white-key boundaries)
    const bw = ww * 0.62;
    for (let o = 0; o < this.octaves; o++) {
      for (let semi = 0; semi < 12; semi++) {
        if (!(semi in BLACK)) continue;
        const midi = this.base + o * 12 + semi;
        const afterWhite = o * 7 + BLACK[semi]; // sits after this white index
        const k = this._makeKey(midi, 'black');
        k.style.left = `${(afterWhite + 1) * ww - bw / 2}%`;
        k.style.width = `${bw}%`;
        board.appendChild(k);
        this.keyEls.set(midi, k);
      }
    }
    this.mount.appendChild(board);
    this.board = board;
    this._bindPointer(board);
  }

  _makeKey(midi, kind) {
    const k = document.createElement('button');
    k.type = 'button';
    k.className = `pkey pkey-${kind}`;
    k.dataset.midi = midi;
    if (midi % 12 === 0) k.innerHTML = `<span class="pkey-label">${midiToName(midi)}</span>`;
    return k;
  }

  // Pointer handling at the board level so a press can *glide* across keys:
  // capture the pointer, then hit-test with elementFromPoint each move. This
  // works for mouse and touch alike (touch's implicit per-key capture would
  // otherwise swallow moves onto neighbouring keys).
  _bindPointer(board) {
    board.addEventListener('pointerdown', (e) => {
      const midi = this._keyAt(e.clientX, e.clientY);
      if (midi == null) return;
      e.preventDefault();
      try { board.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this._movePointer(e.pointerId, midi);
    });
    board.addEventListener('pointermove', (e) => {
      if (!this.pointerKeys.has(e.pointerId)) return; // only while dragging
      this._movePointer(e.pointerId, this._keyAt(e.clientX, e.clientY));
    });
    const end = (e) => {
      if (!this.pointerKeys.has(e.pointerId)) return;
      const midi = this.pointerKeys.get(e.pointerId);
      if (midi != null) this._release(midi);
      this.pointerKeys.delete(e.pointerId);
    };
    board.addEventListener('pointerup', end);
    board.addEventListener('pointercancel', end);
  }

  // The midi note under a screen point, or null if it isn't one of our keys.
  _keyAt(x, y) {
    const key = document.elementFromPoint(x, y)?.closest?.('.pkey');
    if (!key || !this.board.contains(key)) return null;
    const midi = Number(key.dataset.midi);
    return Number.isFinite(midi) ? midi : null;
  }

  // Update which key a pointer holds; releasing the previous one as it glides.
  _movePointer(pointerId, midi) {
    const prev = this.pointerKeys.get(pointerId);
    if (prev === midi) return;
    if (prev != null) this._release(prev);
    if (midi != null) this._press(midi);
    this.pointerKeys.set(pointerId, midi ?? null);
  }

  _press(midi) {
    if (this.active.has(midi)) return;
    this.active.add(midi);
    this.keyEls.get(midi)?.classList.add('pressed');
    this.onNoteOn(midi);
  }

  _release(midi) {
    if (!this.active.has(midi)) return;
    this.active.delete(midi);
    this.keyEls.get(midi)?.classList.remove('pressed');
    this.onNoteOff(midi);
  }

  _bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const semi = KEYMAP[e.key.toLowerCase()];
      if (semi === undefined) return;
      this._press(this.base + 12 + semi); // middle-ish octave
    });
    window.addEventListener('keyup', (e) => {
      const semi = KEYMAP[e.key.toLowerCase()];
      if (semi === undefined) return;
      this._release(this.base + 12 + semi);
    });
  }
}
