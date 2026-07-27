// phase-wheel.js — phase modulation, one sample at a time (Phase 3 — FM).
//
// The operator pair shows the *result* of FM; this shows the *mechanism*. An
// operator is a pointer walking around a sine table at a fixed step. The wheel
// is that table, and everything on this view is drawn as a pair: the pale hand
// is where the carrier would be if nothing touched it, the bright hand is where
// the modulator has shoved it to, and the same pairing runs through the traces —
// the pale dashed wave is the sine that would have come out, the bright one is
// what actually does. Seeing them together is the whole point: the difference
// between the two IS the modulation.
//
// At 440 Hz none of that is visible, so the view runs in slow motion, walking
// the same rendered window the pair view draws. The rate matters more than it
// looks: it has to be slow enough that the *modulator's* cycle takes seconds,
// or the bright hand laps the wheel between animation frames and reads as
// random jitter rather than as a hand racing and lingering. (reference §6)

const css = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();
const TAU = Math.PI * 2;

// Samples of chip time per second of wall-clock time. A4 is ~100 samples per
// cycle, so the carrier takes ~4 s to go round once and a ×2 modulator ~2 s —
// slow enough to follow a hand that is being pushed a full turn either way.
const SLOW_RATE = 24;

export class PhaseWheel {
  constructor(container) {
    container.classList.add('wheel-wrap');
    container.innerHTML = `
      <div class="pair-head">
        <span class="pair-title">Phase wheel — one sample at a time</span>
        <span class="wheel-controls">
          <label class="chk"><input type="checkbox" data-run checked> <span>run</span></label>
          <span class="wheel-rate" data-rate></span>
        </span>
      </div>
      <canvas class="wheel-canvas"></canvas>
      <div class="wheel-readout" data-readout></div>`;
    this.canvas = container.querySelector('.wheel-canvas');
    this.run = container.querySelector('[data-run]');
    this.readout = container.querySelector('[data-readout]');
    container.querySelector('[data-rate]').textContent =
      `slow motion — ${SLOW_RATE} samples/s, not 44100 (${Math.round(44100 / SLOW_RATE)}× slower)`;
    this.ctx = this.canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.t = 0;               // position in the rendered window, in samples
    this._resize();
    // Watch both: the wrapper catches layout changes, the canvas catches its own
    // box. Observing the canvas can feed back on itself (setting canvas.width
    // changes its layout size when no stylesheet constrains it), which the clamp
    // and the unchanged-guard in _resize bound to a single settling step.
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);
    this._ro.observe(this.canvas);
  }

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    // Clamp: if the stylesheet has not applied, the canvas lays out at its
    // attribute size and each resize would double it without a ceiling.
    const w = Math.min(4096, Math.max(1, Math.round(r.width)));
    const h = Math.min(1024, Math.max(1, Math.round(r.height)));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /**
   * @param {object} data  renderPair output {modulator, carrier, phaseOffset,
   *                       carrierClean, carInc}
   * @param {number} dtMs  wall-clock milliseconds since the last frame
   * @param {object} opts  {fb: 0..7} — the modulator's self-feedback, which is
   *                       already baked into its output and so has no separate
   *                       trace; it is named on the strip so the control has
   *                       something to point at.
   */
  draw(data, dtMs, opts = {}) {
    const { ctx, w, h } = this;
    const bg = css(this.canvas, '--scope-bg') || '#08201f';
    const grid = css(this.canvas, '--scope-grid') || 'rgba(255,255,255,0.07)';
    const carC = css(this.canvas, '--scope-line') || '#43cfc7';
    const modC = css(this.canvas, '--scope-mod') || '#e0a24a';
    const faint = css(this.canvas, '--text-faint') || '#7f9391';

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    if (!data || !data.carrier.length) return;

    const n = data.carrier.length;
    // Wrap on a whole number of carrier cycles so the wheel does not jump
    // mid-rotation when the window restarts.
    const period = data.carInc > 0 ? 1 / data.carInc : n;
    const cycles = Math.max(1, Math.floor((n - 1) / period));
    const wrapAt = Math.min(n - 1, cycles * period);
    if (this.run.checked) {
      this.t += (dtMs / 1000) * SLOW_RATE;
      while (this.t >= wrapAt) this.t -= wrapAt;
      while (this.t < 0) this.t += wrapAt;
    }
    const i = Math.min(n - 1, Math.max(0, Math.floor(this.t)));

    // The two phases: where the carrier would be on its own, and where the
    // modulator has actually put it. Both in cycles; only the fraction matters.
    const clean = this.t * data.carInc;
    const injected = data.phaseOffset[i];
    const actual = clean + injected;
    const out = data.carrier[i];

    // The traces read straight out of the rendered window, backwards from the
    // current sample, so what they show is a fixed slice of chip time — a couple
    // of carrier cycles, few enough that the warping stays legible — rather than
    // however many frames happened to be drawn. The window is periodic over
    // `wrapAt`, so stepping back past 0 wraps.
    const TRACE = Math.max(8, Math.min(Math.round(wrapAt), Math.round(2.5 * period)));
    const back = (k) => {
      let idx = (i - k) % Math.round(wrapAt);
      if (idx < 0) idx += Math.round(wrapAt);
      return idx;
    };

    // --- layout: [ wheel ] [ carrier out / modulator, newest at the left ] ---
    const padT = 16, padB = 12, padX = 14;
    const R = Math.min((h - padT - padB) * 0.30, 82);
    const cx = padX + R + 18, cy = padT + R + 4;
    const traceX = cx + R + 34, traceW = w - padX - traceX;
    const traceMid = cy;
    const traceAmp = R * 0.90;

    // --- the wheel ----------------------------------------------------------
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();
    // quarter ticks, and the 0 mark where the table starts
    ctx.fillStyle = faint; ctx.font = '9px ui-monospace, monospace';
    ctx.textAlign = 'center'; ctx.globalAlpha = 0.8;
    for (const q of [0, 0.25, 0.5, 0.75]) {
      const a = q * TAU - Math.PI / 2;
      const x0 = cx + Math.cos(a) * (R - 5), y0 = cy + Math.sin(a) * (R - 5);
      const x1 = cx + Math.cos(a) * R, y1 = cy + Math.sin(a) * R;
      ctx.strokeStyle = grid;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.fillText(q.toFixed(2).slice(1), cx + Math.cos(a) * (R + 11), cy + Math.sin(a) * (R + 11) + 3);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';

    // the arc from the unmodulated phase to the actual one — the injected phase
    const a0 = frac(clean) * TAU - Math.PI / 2;
    const a1 = frac(actual) * TAU - Math.PI / 2;
    if (Math.abs(injected) > 0.001) {
      // sweep the true signed amount, so more than a full turn reads as a full
      // circle rather than silently wrapping to a short arc
      ctx.strokeStyle = modC; ctx.globalAlpha = 0.75; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.72, a0, a0 + injected * TAU, injected < 0);
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    hand(ctx, cx, cy, R, a0, faint, 1.6, 0.8);             // where it would be
    hand(ctx, cx, cy, R, a1, carC, 2.4, 1);                // where it is
    ctx.fillStyle = faint; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R, 3.5, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = carC;
    ctx.beginPath(); ctx.arc(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R, 4.5, 0, TAU); ctx.fill();

    // name the two hands, right under the wheel
    ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = faint; ctx.globalAlpha = 0.9;
    ctx.fillText('— unmodulated', cx, cy + R + 24);
    ctx.fillStyle = carC;
    ctx.fillText('— with the modulator', cx, cy + R + 36);
    ctx.globalAlpha = 1; ctx.textAlign = 'left';

    // --- the two traces, "now" at the left, history drifting right ----------
    const mBot = h - padB, mH = Math.min(38, (h - padT) * 0.24), mMid = mBot - mH / 2;
    const px = (k) => traceX + (k / (TRACE - 1)) * traceW;

    for (const mid of [traceMid, mMid]) {
      ctx.strokeStyle = grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(traceX, mid); ctx.lineTo(traceX + traceW, mid); ctx.stroke();
    }

    // the sine that WOULD have come out, under the one that actually does — the
    // gap between the two pale/bright pairs is the whole of phase modulation
    ctx.setLineDash([4, 4]);
    stroke(ctx, TRACE, px, (k) => traceMid - clamp1(data.carrierClean[back(k)]) * traceAmp, faint, 1.3, 0.8);
    ctx.setLineDash([]);
    stroke(ctx, TRACE, px, (k) => traceMid - clamp1(data.carrier[back(k)]) * traceAmp, carC, 1.8, 1);
    stroke(ctx, TRACE, px, (k) => mMid - clamp1(data.modulator[back(k)]) * (mH / 2), modC, 1.4, 0.9);

    // the two hands write to the two traces: link each to the value it just made
    const headY = traceMid - clamp1(out) * traceAmp;
    const cleanY = traceMid - clamp1(data.carrierClean[i]) * traceAmp;
    link(ctx, cx + Math.cos(a0) * R, cy + Math.sin(a0) * R, traceX, cleanY, faint, 0.4);
    link(ctx, cx + Math.cos(a1) * R, cy + Math.sin(a1) * R, traceX, headY, carC, 0.45);
    ctx.fillStyle = faint; ctx.globalAlpha = 0.8;
    ctx.beginPath(); ctx.arc(traceX, cleanY, 3, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1; ctx.fillStyle = carC;
    ctx.beginPath(); ctx.arc(traceX, headY, 3.5, 0, TAU); ctx.fill();
    ctx.fillStyle = modC;
    ctx.beginPath(); ctx.arc(traceX, mMid - clamp1(data.modulator[i]) * (mH / 2), 3, 0, TAU); ctx.fill();

    ctx.font = '9px ui-monospace, monospace'; ctx.globalAlpha = 0.85;
    ctx.fillStyle = carC; ctx.fillText('carrier out', traceX + 8, traceMid - traceAmp - 4);
    ctx.fillStyle = faint;
    ctx.fillText('· · the plain sine it would have been', traceX + 78, traceMid - traceAmp - 4);
    ctx.fillStyle = modC;
    const fb = opts.fb || 0;
    ctx.fillText(`modulator — what does the shoving${fb ? `   ↺ feedback ${fb} into itself` : ''}`,
      traceX + 8, mBot - mH - 4);
    ctx.fillStyle = faint; ctx.textAlign = 'right';
    ctx.fillText('older ►', traceX + traceW, traceMid - traceAmp - 4);
    ctx.textAlign = 'left'; ctx.globalAlpha = 1;

    // --- the sentence the whole page is about -------------------------------
    // This updates every frame, so every part of it has to be a fixed width: a
    // phrase that changes length re-wraps the flex row and the bar visibly grows
    // and snaps back. The numbers are already fixed-width (sign + 0.000); the
    // verb is padded in CSS, and the injected amount carries its unit — "turns" —
    // instead of gaining a "more than a full turn" clause once it passes 1.
    const verb = Math.abs(injected) < 0.005 ? 'on time'
      : (injected > 0 ? 'racing ahead' : 'lingering behind');
    const num = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(3)}`;
    // Same shape twice, so the two readings sit side by side like the two hands.
    this.readout.innerHTML =
      `<span class="wheel-pale">unmodulated phase <b>${frac(clean).toFixed(3)}</b> → out <b>${num(data.carrierClean[i])}</b></span>` +
      `<span>modulated phase <b>${frac(actual).toFixed(3)}</b> → out <b>${num(out)}</b></span>` +
      `<span class="wheel-verb">injected <b>${num(injected)}</b> turns` +
      ` · <span class="wheel-slot">${verb}</span></span>`;
  }

  destroy() { this._ro?.disconnect(); }
}

// Stroke `count` samples backwards from now: `xOf(k)` places the k-th sample
// back, `yOf(k)` gives its height.
function stroke(ctx, count, xOf, yOf, color, width, alpha) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (let k = 0; k < count; k++) {
    const x = xOf(k), y = yOf(k);
    if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke(); ctx.globalAlpha = 1;
}

// A dashed tie from a hand tip to the sample it just wrote.
function link(ctx, x0, y0, x1, y1, color, alpha) {
  ctx.strokeStyle = color; ctx.globalAlpha = alpha;
  ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}

function hand(ctx, cx, cy, R, a, color, width, alpha) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.globalAlpha = alpha;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
  ctx.stroke(); ctx.globalAlpha = 1;
}

const frac = (v) => v - Math.floor(v);
const clamp1 = (v) => (v > 1 ? 1 : v < -1 ? -1 : v);
