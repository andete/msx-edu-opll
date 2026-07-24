// scope.js — a canvas oscilloscope. Draws one or more step-sampled signals,
// trigger-aligned on a rising edge so the waveform stays stable (not scrolling).

const css = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

export class Scope {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
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
   * @param {Float32Array} main  primary waveform, samples roughly in [-1, 1]
   * @param {object} opts { overlays?: [{data, color, alpha}], label?: string }
   */
  draw(main, opts = {}) {
    const { ctx, w, h } = this;
    const bg = css(this.canvas, '--scope-bg') || '#0e0b08';
    const grid = css(this.canvas, '--scope-grid') || 'rgba(255,255,255,0.08)';
    const line = css(this.canvas, '--scope-line') || '#e0955a';

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // grid
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2);
    for (let i = 1; i < 8; i++) { const x = (w * i) / 8; ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    ctx.stroke();

    if (!main || main.length === 0) return;

    const start = triggerIndex(main);
    const span = Math.min(main.length - start, Math.floor(main.length * 0.9));

    // overlays first (dimmer, behind)
    for (const ov of opts.overlays || []) {
      plot(ctx, ov.data, start, span, w, h, ov.color, ov.alpha ?? 0.5, ov.bipolar);
    }
    plot(ctx, main, start, span, w, h, line, 1, true);

    if (opts.label) {
      ctx.fillStyle = css(this.canvas, '--scope-line') || '#e0955a';
      ctx.globalAlpha = 0.7;
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(opts.label, 8, 14);
      ctx.globalAlpha = 1;
    }
  }
}

// Find the first rising zero-crossing so the trace is stable frame to frame.
function triggerIndex(data) {
  const n = data.length;
  const limit = Math.floor(n / 2);
  for (let i = 1; i < limit; i++) {
    if (data[i - 1] <= 0 && data[i] > 0) return i;
  }
  return 0;
}

function plot(ctx, data, start, span, w, h, color, alpha, bipolar) {
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < span; i++) {
    const v = data[start + i];
    const x = (i / span) * w;
    // bipolar signals centre on 0; unipolar (bits) sit in the lower band
    const y = bipolar
      ? h / 2 - v * (h / 2) * 0.9
      : h - 4 - v * (h - 8);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}
