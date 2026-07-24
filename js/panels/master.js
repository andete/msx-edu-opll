// master.js — the transport: play/stop, and a note about needing a gesture.
// Audio is created lazily on first Play (browser autoplay policy).

import { toggle, onPlayState, isPlaying } from '../audio.js';

export class MasterPanel {
  constructor(el) {
    el.classList.add('panel', 'panel-master');
    el.innerHTML = `
      <div class="panel-head"><span class="panel-title">Master</span></div>
      <button type="button" class="btn btn-play" data-play>▶ Play</button>
      <p class="master-hint">Press <kbd>Play</kbd>, then a piano key or the
        <kbd>Z</kbd>…<kbd>M</kbd> row. Sound starts on your first click.</p>`;
    this.btn = el.querySelector('[data-play]');
    this.btn.addEventListener('click', () => toggle());
    onPlayState((p) => this._render(p));
    this._render(isPlaying());
  }
  _render(p) {
    this.btn.classList.toggle('playing', p);
    this.btn.textContent = p ? '■ Stop' : '▶ Play';
  }
}
