// operator-pair.js — ★ the site's headline widget (Phase 3 — FM).
//
// Two operator scopes side by side — the MODULATOR (the FM source) and the
// CARRIER (what reaches the DAC) — with the modulation link drawn between them
// (its thickness tracks how hard the modulator is driving the carrier) and the
// modulator's self-feedback loop drawn curving back into itself (its thickness
// tracks FB). A "show internals" toggle overlays, on the carrier, the bare
// unmodulated sine it *would* have been plus the phase offset the modulator is
// injecting sample-by-sample — phase modulation made visible. (reference §6, §13)
//
// Fed from OpllCore.renderPair(frames, ch): {modulator, carrier, phaseOffset,
// carrierClean}. Draws from a fresh deterministic render, never the audio path.

const css = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

export class OperatorPair {
  constructor(container) {
    container.classList.add('pair-wrap');
    container.innerHTML = `
      <div class="pair-head">
        <span class="pair-title">Operator pair — modulator <span class="pair-arrow">→</span> carrier</span>
        <label class="chk pair-toggle"><input type="checkbox" data-internals> <span>show internals</span></label>
      </div>
      <canvas class="pair-canvas"></canvas>`;
    this.canvas = container.querySelector('.pair-canvas');
    this.internals = container.querySelector('[data-internals]');
    this.ctx = this.canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._last = null;
    this.internals.addEventListener('change', () => { if (this._last) this.draw(this._last.data, this._last.opts); });
    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(this.canvas);
  }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    this.canvas.width = this.w * this.dpr;
    this.canvas.height = this.h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this._last) this.draw(this._last.data, this._last.opts);
  }

  /**
   * @param {object} data  {modulator, carrier, phaseOffset, carrierClean}
   * @param {object} opts  {fb: 0..7, show?: samples to display (a few cycles)}
   */
  draw(data, opts = {}) {
    this._last = { data, opts };
    const { ctx, w, h } = this;
    const bg = css(this.canvas, '--scope-bg') || '#08201f';
    const grid = css(this.canvas, '--scope-grid') || 'rgba(255,255,255,0.07)';
    const carC = css(this.canvas, '--scope-line') || '#43cfc7';
    const modC = css(this.canvas, '--scope-mod') || '#e0a24a';
    const faint = css(this.canvas, '--text-faint') || '#7f9391';
    const showInt = this.internals.checked;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    if (!data) return;

    // --- layout: [ modulator box ]  →arrow→  [ carrier box ] ----------------
    const padT = 22, padB = 8, padX = 10;
    const gap = Math.max(46, w * 0.09);           // room for the FM arrow
    const boxTop = padT, boxBot = h - padB;
    const usable = w - padX * 2 - gap;
    const modW = usable * 0.42;
    const carW = usable * 0.58;
    const modX = padX;
    const carX = padX + modW + gap;

    // shared trigger index + display span so the two traces keep their real
    // phase relationship and show only a few readable cycles (not the whole
    // analysis window, which is longer than needed for the harmonic view).
    const start = triggerIndex(data.modulator);
    const avail = data.modulator.length - start;
    const span = Math.max(2, Math.min(opts.show || avail, avail));

    // --- modulator box ------------------------------------------------------
    drawBox(ctx, modX, boxTop, modW, boxBot - boxTop, grid);
    labelTop(ctx, 'MODULATOR', modX + 6, boxTop - 8, modC);
    plot(ctx, data.modulator, start, span, modX, boxTop, modW, boxBot - boxTop, modC, 1, 1);
    // self-feedback loop: an arc off the top of the modulator box, back into it
    drawFeedback(ctx, modX, modW, boxTop, opts.fb || 0, modC, faint);

    // --- the FM (phase-modulation) link -------------------------------------
    // thickness tracks how hard the modulator is actually driving the carrier
    const modPeak = peak(data.modulator);
    drawFmArrow(ctx, modX + modW, carX, (boxTop + boxBot) / 2, modPeak, carC, faint);

    // --- carrier box --------------------------------------------------------
    drawBox(ctx, carX, boxTop, carW, boxBot - boxTop, grid);
    labelTop(ctx, showInt ? 'CARRIER  (bare sine + injected phase)' : 'CARRIER → out',
      carX + 6, boxTop - 8, carC);

    if (showInt) {
      // the "before": the bare, unmodulated carrier sine, dim and dashed
      ctx.setLineDash([4, 4]);
      plot(ctx, data.carrierClean, start, span, carX, boxTop, carW, boxBot - boxTop, faint, 0.6, 1);
      ctx.setLineDash([]);
      // the injected phase offset (cycles), on its own auto-scaled axis — this is
      // literally what gets added to the carrier's phase each sample.
      const offScale = 1 / Math.max(0.25, peak(data.phaseOffset));
      plot(ctx, data.phaseOffset, start, span, carX, boxTop, carW, boxBot - boxTop, modC, 0.85, offScale);
      labelTop(ctx, 'injected phase', carX + carW - 96, boxBot + 0, modC);
    }
    // the "after": the actual, phase-modulated carrier output (always on top)
    plot(ctx, data.carrier, start, span, carX, boxTop, carW, boxBot - boxTop, carC, 1, 1);
  }

  destroy() { this._ro?.disconnect(); }
}

// ---- drawing helpers -------------------------------------------------------

function drawBox(ctx, x, y, w, h, grid) {
  ctx.strokeStyle = grid; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
}

function labelTop(ctx, text, x, y, color) {
  ctx.fillStyle = color; ctx.globalAlpha = 0.85;
  ctx.font = '11px ui-monospace, monospace'; ctx.textAlign = 'left';
  ctx.fillText(text, x, y); ctx.globalAlpha = 1;
}

// Plot a windowed signal into a rect, centred on the box mid-line. `gain` scales
// amplitude; signals are assumed roughly in [-1, 1] before gain.
function plot(ctx, data, start, span, x, y, w, h, color, alpha, gain) {
  if (!data || data.length === 0 || span < 2) return;
  const mid = y + h / 2, amp = (h / 2) * 0.92;
  ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i < span; i++) {
    const px = x + (i / span) * w;
    let v = data[start + i] * gain;
    if (v > 1) v = 1; else if (v < -1) v = -1;   // clamp for display only
    const py = mid - v * amp;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke(); ctx.globalAlpha = 1;
}

// The modulator's self-feedback: a loop arcing off the top of its box and back
// in, drawn thicker with more FB; nothing when FB = 0.
function drawFeedback(ctx, boxX, boxW, boxTop, fb, color, faint) {
  if (!fb) return;
  const y0 = boxTop + 4;
  const xa = boxX + boxW * 0.62, xb = boxX + boxW * 0.38;
  const rise = 12;
  ctx.strokeStyle = color; ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1 + fb * 0.6; ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(xa, y0);
  ctx.bezierCurveTo(xa, y0 - rise, xb, y0 - rise, xb, y0);
  ctx.stroke();
  // arrowhead into the box
  arrowhead(ctx, xb, y0, Math.PI / 2, 5, color);
  ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
  ctx.fillStyle = faint; ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'center';
  ctx.fillText('FB ' + fb, (xa + xb) / 2, y0 - rise - 3);
  ctx.globalAlpha = 1; ctx.textAlign = 'left';
}

// The modulation link: a horizontal arrow whose thickness grows with drive.
function drawFmArrow(ctx, x0, x1, y, strength, color, faint) {
  const lw = 1 + Math.min(1, strength) * 7;      // 1..8 px
  ctx.strokeStyle = color; ctx.globalAlpha = 0.9; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x0 + 2, y); ctx.lineTo(x1 - 8, y); ctx.stroke();
  arrowhead(ctx, x1 - 2, y, 0, 7 + lw, color);
  ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
  ctx.fillStyle = faint; ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'center';
  ctx.fillText('phase', (x0 + x1) / 2, y - lw / 2 - 5);
  ctx.fillText('mod', (x0 + x1) / 2, y + lw / 2 + 12);
  ctx.globalAlpha = 1; ctx.textAlign = 'left';
}

function arrowhead(ctx, x, y, angle, size, color) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.fillStyle = color; ctx.globalAlpha = 0.95;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-size, -size * 0.6); ctx.lineTo(-size, size * 0.6);
  ctx.closePath(); ctx.fill(); ctx.restore(); ctx.globalAlpha = 1;
}

function peak(data) {
  let p = 0;
  for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > p) p = a; }
  return p;
}

// first rising zero-crossing, so the pair of traces is stable frame to frame
function triggerIndex(data) {
  const n = data.length, limit = Math.floor(n / 2);
  for (let i = 1; i < limit; i++) if (data[i - 1] <= 0 && data[i] > 0) return i;
  return 0;
}
