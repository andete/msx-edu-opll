// adsr-view.js — the per-operator ADSR envelope, drawn as a schematic and
// animated with a live playhead. The schematic's segment widths come from the
// rate fields (faster rate → shorter segment); the dot's height is the current
// attenuation, and its x is placed so it traces the drawn outline rather than
// merely moving alongside it. It shows the Key-On "damp" as a dip before the
// attack climbs — the OPLL quirk that has no PSG/SCC counterpart — and drops the
// S segment entirely for a percussive operator, which never holds. See §7.

const css = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

// envelope states, matching opll-core.js
const DAMP = 0, ATTACK = 1, DECAY = 2, SUSTAIN = 3, RELEASE = 4, IDLE = 5;
const EG_MUTE = 127;
const SL_EG = 8; // one sustain-level step = 8 envelope units (3.0 dB)

// The channel SUS bit (reg 2x bit5) makes Key-Off release at a fixed effective
// rate of 5 instead of the patch's RR. The segment widths below are drawn from
// raw 4-bit fields, and the core's effective rate is ~4× the field, so rate 5
// draws at the width of a field of 5/4. See reference §7.
const SUS_FIELD = 5 / 4;

export class AdsrView {
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
   * @param {object} env  {ar, dr, sl, rr, eg}  (eg = EG-type: 1 sustained, 0 percussive)
   * @param {object} live {state, eg}           current envelope from the core
   */
  draw(env, live) {
    const { ctx, w, h } = this;
    const bg = css(this.canvas, '--scope-bg') || '#08201f';
    const grid = css(this.canvas, '--scope-grid') || 'rgba(255,255,255,0.07)';
    const line = css(this.canvas, '--scope-line') || '#43cfc7';
    const dimc = css(this.canvas, '--text-faint') || '#7f9391';

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

    const padL = 6, padR = 6, padT = 10, padB = 14;
    const x0 = padL, x1 = w - padR, yTop = padT, yBot = h - padB;
    const ampY = (a) => yBot - a * (yBot - yTop); // a in [0,1], 1 = full volume

    // baseline (silence) + full-volume line
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, yBot); ctx.lineTo(x1, yBot); ctx.stroke();

    // --- schematic geometry -------------------------------------------------
    // segment widths weighted by (16 − field): faster rates draw narrower. A
    // percussive operator (EG-type 0) has no hold: after the decay it keeps
    // falling at the release rate whether the key is down or not, so it gets no
    // S segment and its tail is the whole span after the decay.
    const sustained = !!env.eg;
    const susSlow = !!(live && live.sus);          // channel SUS overrides RR
    const wA = 16 - env.ar, wD = 16 - env.dr, wS = sustained ? 10 : 0;
    const wR = 16 - (susSlow ? SUS_FIELD : env.rr);
    const totalW = Math.max(1, wA + wD + wS + wR);
    const span = x1 - x0;
    const xA = x0 + (wA / totalW) * span;
    const xD = xA + (wD / totalW) * span;
    const xS = xD + (wS / totalW) * span;   // == xD when percussive
    const xR = x1;

    const susAmp = 1 - Math.min(EG_MUTE, env.sl * SL_EG) / EG_MUTE;
    const susDisplay = env.sl === 15 ? 0 : susAmp;

    // --- the envelope outline ----------------------------------------------
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, ampY(0));                 // start silent
    ctx.lineTo(xA, ampY(1));                 // attack → peak
    ctx.lineTo(xD, ampY(susDisplay));        // decay → sustain level
    if (sustained) ctx.lineTo(xS, ampY(susDisplay)); // sustain hold
    ctx.lineTo(xR, ampY(0));                 // release → silence
    ctx.stroke();

    // sustain-level guide
    ctx.strokeStyle = dimc; ctx.globalAlpha = 0.4; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x0, ampY(susDisplay)); ctx.lineTo(x1, ampY(susDisplay)); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;

    // segment labels
    ctx.fillStyle = dimc; ctx.font = '10px ui-monospace, monospace';
    label(ctx, 'A', x0, xA, h - 3);
    label(ctx, 'D', xA, xD, h - 3);
    if (sustained) label(ctx, 'S', xD, xS, h - 3);
    // Name the source of the release rate, so the channel SUS bit is visible as
    // something other than a checkbox that appears to do nothing.
    label(ctx, susSlow ? 'R (channel SUS)' : 'R', xS, xR, h - 3);

    // --- live playhead ------------------------------------------------------
    if (live && live.state !== IDLE) {
      const a = 1 - Math.min(EG_MUTE, live.eg) / EG_MUTE;
      let x = x0;
      switch (live.state) {
        case DAMP: x = x0; break;
        case ATTACK: x = x0 + (xA - x0) * (1 - live.eg / EG_MUTE); break;
        case DECAY: {
          const target = Math.min(EG_MUTE, env.sl * SL_EG) || 1;
          x = xA + (xD - xA) * Math.min(1, live.eg / target);
          break;
        }
        // The falling tail. It is drawn from the sustain level down to silence,
        // not from full volume, so the playhead has to measure its progress over
        // that same span — otherwise the dot rides above the line it should
        // trace. A percussive operator falls in the SUSTAIN state (it never
        // holds), so both states share the tail.
        case SUSTAIN:
          if (sustained) { x = (xD + xS) / 2; break; }
          // fallthrough: percussive, already decaying at the release rate
        case RELEASE: {
          const from = env.sl === 15 ? EG_MUTE : Math.min(EG_MUTE, env.sl * SL_EG);
          const t = from >= EG_MUTE ? 1 : (live.eg - from) / (EG_MUTE - from);
          x = xS + (xR - xS) * Math.max(0, Math.min(1, t));
          break;
        }
        default: x = x0;
      }
      const stateCol = live.state === DAMP ? (css(this.canvas, '--danger') || '#b5473a') : line;
      ctx.fillStyle = stateCol;
      ctx.beginPath(); ctx.arc(x, ampY(a), 4, 0, Math.PI * 2); ctx.fill();
      // state name, top-left
      ctx.fillStyle = stateCol; ctx.globalAlpha = 0.85; ctx.font = '11px ui-monospace, monospace';
      // The core still calls the percussive tail "sustain"; on screen that reads
      // as a hold, which is the opposite of what it is doing.
      const stateName = (live.state === SUSTAIN && !sustained) ? 'fading' : STATE_NAMES[live.state];
      ctx.fillText(stateName, 8, 14); ctx.globalAlpha = 1;
    }
  }
}

const STATE_NAMES = ['damp', 'attack', 'decay', 'sustain', 'release', 'idle'];

function label(ctx, text, xa, xb, y) {
  const cx = (xa + xb) / 2;
  ctx.textAlign = 'center';
  ctx.fillText(text, cx, y);
  ctx.textAlign = 'left';
}
