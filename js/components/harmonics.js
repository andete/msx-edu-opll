// harmonics.js — a 16-bar spectrum of the CARRIER OUTPUT (the audible FM result).
//
// Retargeted from the SCC's harmonics view: there it analysed a drawn 32-point
// wave; here it analyses a rendered window of the carrier and bins it against the
// voice's fundamental (see opll-spec.js `harmonics`). This is the "what is FM
// doing to the timbre" payoff — a pure sine is one bar; raise the modulator's
// Multiple / Total Level / Feedback and the higher bars grow live. (reference §6)

import { harmonics } from '../opll-spec.js';

const css = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

const N_HARM = 16;

export class Harmonics {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.data = null;
    this._resize();
    this._ro = new ResizeObserver(() => { this._resize(); this._render(); });
    this._ro.observe(canvas);
  }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * @param {Float32Array} carrier  a rendered carrier window (envelope open)
   * @param {number} f0             the voice fundamental, in cycles per sample
   */
  set(carrier, f0) {
    this.data = carrier && f0 > 0 ? harmonics(carrier, f0, N_HARM) : null;
    this._render();
  }

  _render() {
    const { ctx, w, h } = this;
    const bg = css(this.canvas, '--scope-bg') || '#08201f';
    const grid = css(this.canvas, '--scope-grid') || 'rgba(255,255,255,0.07)';
    const accent = css(this.canvas, '--scope-line') || '#43cfc7';
    const faint = css(this.canvas, '--text-faint') || '#7f9391';

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const padT = 14;                // room for the title
    const padB = 14;                // room for the harmonic-number labels
    const base = h - padB;
    const bw = w / N_HARM;

    // Fixed scale: a full-scale carrier sine (volume 0) has a fundamental of ~1.0,
    // so 1.0 is "all the energy in one harmonic". FM spreads that upward — bars
    // grow while the fundamental shrinks — rather than being re-normalised away.
    const FULL = 1.0;
    const scale = (base - padT) / FULL;

    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, base + 0.5); ctx.lineTo(w, base + 0.5);
    ctx.stroke();

    // title
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.7;
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText('carrier harmonics', 8, 12);
    ctx.globalAlpha = 1;

    if (!this.data) { return; }

    ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center';
    for (let k = 1; k <= N_HARM; k++) {
      const x = (k - 1) * bw;
      const mag = Math.min(this.data.mag[k], FULL);
      const bh = mag * scale;
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.3 + 0.7 * Math.min(1, mag / 0.4);
      ctx.fillRect(x + bw * 0.18, base - bh, bw * 0.64, Math.max(bh, 0.5));
      ctx.globalAlpha = 1;
      if (k === 1 || k % 4 === 0) {
        ctx.fillStyle = faint;
        ctx.fillText(String(k), x + bw / 2, h - 3);
      }
    }
    ctx.textAlign = 'left';
  }

  destroy() { this._ro?.disconnect(); }
}
