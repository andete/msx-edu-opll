// patch-panel.js — the whole-patch chooser + the ROM gallery (Phase 4). ★
//
// The OPLL's defining constraint: you mostly *pick* one of 15 ROM instruments
// rather than design your own — only slot 0 (the User instrument) is the 8 bytes
// you build. This panel makes both visible at once:
//
//   • a gallery of all 16 instruments (User + 15 ROM), each with a live harmonic
//     FINGERPRINT (opll-spec `instrumentFingerprint`) so their timbres are
//     comparable at a glance;
//   • click a tile to play it on the channel (writes reg 30+ch);
//   • ROM tiles carry a "copy → user ✎" button that drops the ROM's 8 bytes into
//     registers 00–07 and switches to the User slot, so the same sound becomes
//     fully editable by the operator panels — this is how you learn a patch;
//   • preset chips seed the User slot with hand-built teaching patches.
//
// Two-way bound: the active tile follows reg 30+ch, and the User fingerprint
// re-renders whenever the user bytes (00–07) change. See design/build-plan.md §4.

import { INSTRUMENT_NAMES, FP_BARS, instrumentFingerprint } from '../opll-spec.js';
import { USER_PRESETS, loadUserPatch } from '../presets.js';

const css = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

export class PatchPanel {
  constructor(el, store, ch = 0) {
    this.el = el;
    this.store = store;
    this.ch = ch;
    this.tiles = new Map();   // instrument index → { btn, canvas }

    el.classList.add('patch-panel');
    el.innerHTML = `
      <div class="panel-head">
        <span class="panel-title">Instrument</span>
        <span class="panel-tag">30${ch}h · ROM</span>
      </div>
      <p class="patch-status" data-status></p>
      <div class="preset-row" data-presets>
        <span class="preset-label">User presets:</span>
      </div>
      <div class="gallery" data-gallery></div>
      <p class="gallery-hint">
        Click an instrument to play it. Only <b>User</b> is editable — use
        <b>copy&nbsp;→&nbsp;user&nbsp;✎</b> on any ROM sound to drop its 8 bytes into
        the user slot and shape it with the operator controls above.
      </p>`;

    this.statusEl = el.querySelector('[data-status]');
    this._buildPresets(el.querySelector('[data-presets]'));
    this._buildGallery(el.querySelector('[data-gallery]'));

    this._unsub = store.subscribe((evt) => {
      if (evt.type === 'reset') { this._refreshActive(); this._drawUserFingerprint(); }
      else if (evt.type === 'reg') {
        if (evt.addr === 0x30 + this.ch) this._refreshActive();
        if (evt.addr <= 0x07) this._drawUserFingerprint();   // user bytes changed
      }
    });

    this._refreshActive();
    this._drawAllFingerprints();
  }

  _buildPresets(row) {
    for (const p of USER_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset-chip';
      b.textContent = p.name;
      b.title = p.blurb;
      b.addEventListener('click', () => loadUserPatch(this.store, p.bytes, this.ch));
      row.appendChild(b);
    }
  }

  _buildGallery(grid) {
    for (let n = 0; n < INSTRUMENT_NAMES.length; n++) {
      const isUser = n === 0;
      const tile = document.createElement('div');
      tile.className = 'inst-tile' + (isUser ? ' inst-user' : '');
      tile.tabIndex = 0;
      tile.dataset.inst = n;
      tile.setAttribute('role', 'button');
      tile.setAttribute('aria-label', `Play ${INSTRUMENT_NAMES[n]}`);

      const canvas = document.createElement('canvas');
      canvas.className = 'inst-fp';

      const meta = document.createElement('div');
      meta.className = 'inst-meta';
      meta.innerHTML =
        `<span class="inst-idx">${n}</span><span class="inst-name">${INSTRUMENT_NAMES[n]}</span>`;

      tile.append(canvas, meta);

      // ROM tiles get a copy-to-user affordance (nested as a real button, so we
      // stop its click from also selecting the tile).
      if (!isUser) {
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'inst-copy';
        copy.textContent = 'copy → user ✎';
        copy.title = `Copy ${INSTRUMENT_NAMES[n]}'s 8 bytes into the user slot (00–07) and edit it`;
        copy.addEventListener('click', (e) => { e.stopPropagation(); this._copyToUser(n); });
        tile.appendChild(copy);
      }

      const select = () => this.store.setInstrument(this.ch, n);
      tile.addEventListener('click', select);
      tile.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
      });

      grid.appendChild(tile);
      this.tiles.set(n, { btn: tile, canvas });
    }
  }

  // Copy a ROM instrument's 8 bytes into the user registers and switch to the
  // user slot, so the identical sound is now editable. (reference §4)
  _copyToUser(n) {
    const rom = globalThis.OpllCore.INSTRUMENT_ROM[n];
    for (let i = 0; i < 8; i++) this.store.set(i, rom[i]);
    this.store.setInstrument(this.ch, 0);
  }

  _refreshActive() {
    const active = (this.store.get(0x30 + this.ch) >> 4) & 0x0f;
    for (const [n, t] of this.tiles) t.btn.classList.toggle('active', n === active);
    const name = INSTRUMENT_NAMES[active] || `#${active}`;
    this.statusEl.innerHTML = active === 0
      ? `Playing the <b>User</b> instrument — the 8 bytes you edit above.`
      : `Playing <b>${name}</b> (ROM). The operator panels edit the User slot, not this — copy it over to shape it.`;
  }

  _drawAllFingerprints() {
    for (const [n, t] of this.tiles) {
      const mags = n === 0 ? instrumentFingerprint(0, this._userBytes()) : instrumentFingerprint(n);
      drawFingerprint(t.canvas, mags);
    }
  }

  _drawUserFingerprint() {
    const t = this.tiles.get(0);
    if (t) drawFingerprint(t.canvas, instrumentFingerprint(0, this._userBytes()));
  }

  _userBytes() {
    const b = [];
    for (let i = 0; i < 8; i++) b.push(this.store.get(i));
    return b;
  }

  destroy() { this._unsub && this._unsub(); }
}

// Draw a small normalised bar chart of a fingerprint. Normalised per-tile (to its
// own peak) so the SHAPE is what's compared, not the loudness. Bar 0 (the
// fundamental) is drawn dimmer so the FM-added upper bars stand out.
function drawFingerprint(canvas, mags) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, canvas.clientWidth || 120);
  const h = Math.max(1, canvas.clientHeight || 40);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const accent = css(canvas, '--scope-line') || '#43cfc7';
  const n = mags.length || FP_BARS;
  let max = 0;
  for (const m of mags) if (m > max) max = m;
  if (!(max > 0)) max = 1;

  const bw = w / n;
  for (let i = 0; i < n; i++) {
    const bh = (mags[i] / max) * (h - 2);
    ctx.fillStyle = accent;
    ctx.globalAlpha = i === 0 ? 0.45 : 0.9;
    ctx.fillRect(i * bw + bw * 0.16, h - Math.max(bh, 0.6), bw * 0.68, Math.max(bh, 0.6));
  }
  ctx.globalAlpha = 1;
}
