// signal-path.js — the OPLL as a block diagram you can click.
//
// Doubles as the landing page's hero and as a navigator: each block is a link
// into the focus page that teaches it, so the site map and the signal path are
// one object. Inline SVG rather than canvas, because the blocks want to be real
// links — focusable, keyboard-reachable, readable by a screen reader.
//
// When audio is running the diagram animates from the live core: the two
// operators brighten with the focus voice's output, and the summed level drives
// the DAC bar. The diagram is not an illustration, it is an instrument panel.
// Kin to msx-edu-scc's signal-path.js, redrawn for two-operator FM.

import { store } from '../store.js';
import { fnumBlockToFreq, INSTRUMENT_NAMES } from '../opll-spec.js';

const NS = 'http://www.w3.org/2000/svg';

/** Which focus page each block links to. */
const L = {
  phase: 'tone.html', mod: 'fm.html', car: 'tone.html', fm: 'fm.html',
  env: 'envelope.html', inst: 'instrument.html', sum: 'voices.html',
  rhythm: 'rhythm.html', dac: 'msx.html',
};

export class SignalPath {
  constructor(mount, opts = {}) {
    this.mount = mount;
    this.interactive = opts.interactive !== false;
    this._build();
  }

  _build() {
    this.mount.classList.add('signal-path');
    this.mount.innerHTML = `
      <svg viewBox="0 0 760 330" role="img"
           aria-label="OPLL signal path: a phase generator drives a modulator operator that phase-modulates a carrier operator; each operator has its own ADSR envelope and is shaped by the 8-byte instrument patch; nine such voices (or six plus five drums in rhythm mode) sum into a 9-bit DAC.">
        <defs>
          <marker id="sp-arrow" viewBox="0 0 8 8" refX="7" refY="4"
                  markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0 0 L8 4 L0 8 z" class="sp-arrowhead"/>
          </marker>
        </defs>

        <text x="380" y="18" class="sp-clock" text-anchor="middle">fCLOCK = 3 579 545 Hz &#8594; fSAM = fCLOCK / 72 &#8776; 49 716 Hz</text>

        <!-- Instrument patch spans the two operators and feeds both. -->
        <a href="${L.inst}" class="sp-block sp-block-inst">
          <rect x="150" y="40" width="360" height="30" rx="8"/>
          <text x="330" y="59" text-anchor="middle">Instrument &#160;·&#160; <tspan data-inst>8-byte patch</tspan></text>
        </a>
        <path class="sp-wire sp-wire-feed" d="M215 70 L215 132" marker-end="url(#sp-arrow)"/>
        <path class="sp-wire sp-wire-feed" d="M445 70 L445 132" marker-end="url(#sp-arrow)"/>

        <!-- Main row: phase gen -> modulator --FM--> carrier -> Sigma -> DAC. -->
        <g class="sp-op">
          <a href="${L.phase}" class="sp-block sp-block-phase">
            <rect x="20" y="132" width="118" height="58" rx="8"/>
            <text x="79" y="156" text-anchor="middle">Phase gen</text>
            <text x="79" y="174" text-anchor="middle" class="sp-label" data-pitch>F 0 · B 0</text>
          </a>
          <path class="sp-wire" d="M138 161 L156 161" marker-end="url(#sp-arrow)"/>

          <a href="${L.mod}" class="sp-block sp-block-mod">
            <rect x="156" y="132" width="118" height="58" rx="8"/>
            <text x="215" y="156" text-anchor="middle">Modulator</text>
            <text x="215" y="174" text-anchor="middle" class="sp-label">operator 1</text>
            <rect class="sp-glow" data-glow-mod x="156" y="132" width="118" height="58" rx="8"/>
          </a>
          <!-- feedback loop on the modulator -->
          <path class="sp-wire sp-wire-fb" d="M215 132 q -34 -20 -44 6 q -6 18 15 22" marker-end="url(#sp-arrow)"/>
          <text x="150" y="120" class="sp-tiny" text-anchor="middle">feedback</text>

          <!-- the FM link -->
          <a href="${L.fm}" class="sp-fm-link">
            <path class="sp-wire sp-wire-fm" d="M274 161 L352 161" marker-end="url(#sp-arrow)"/>
            <text x="313" y="152" class="sp-fm-label" text-anchor="middle">FM</text>
          </a>

          <a href="${L.car}" class="sp-block sp-block-car">
            <rect x="352" y="132" width="118" height="58" rx="8"/>
            <text x="411" y="156" text-anchor="middle">Carrier</text>
            <text x="411" y="174" text-anchor="middle" class="sp-label">operator 2</text>
            <rect class="sp-glow" data-glow-car x="352" y="132" width="118" height="58" rx="8"/>
          </a>
          <path class="sp-wire" d="M470 161 L512 161" marker-end="url(#sp-arrow)"/>

          <a href="${L.sum}" class="sp-block sp-block-sum">
            <rect x="512" y="132" width="96" height="58" rx="8"/>
            <text x="560" y="156" text-anchor="middle">&#931;</text>
            <text x="560" y="174" text-anchor="middle" class="sp-label">nine voices</text>
          </a>
          <path class="sp-wire" d="M608 161 L636 161" marker-end="url(#sp-arrow)"/>

          <a href="${L.dac}" class="sp-block sp-block-dac">
            <rect x="636" y="132" width="104" height="58" rx="8"/>
            <rect class="sp-dac-fill" x="638" y="134" width="0" height="54" rx="6"/>
            <text x="688" y="156" text-anchor="middle">9-bit DAC</text>
            <text x="688" y="174" text-anchor="middle" class="sp-label">7Ch / 7Dh</text>
          </a>
        </g>

        <!-- Each operator's ADSR envelope. -->
        <path class="sp-wire" d="M215 190 L215 214" marker-end="url(#sp-arrow)"/>
        <a href="${L.env}" class="sp-block sp-block-env">
          <rect x="156" y="214" width="118" height="30" rx="8"/>
          <text x="215" y="233" text-anchor="middle">ADSR</text>
        </a>
        <path class="sp-wire" d="M411 190 L411 214" marker-end="url(#sp-arrow)"/>
        <a href="${L.env}" class="sp-block sp-block-env">
          <rect x="352" y="214" width="118" height="30" rx="8"/>
          <text x="411" y="233" text-anchor="middle">ADSR</text>
        </a>

        <!-- Rhythm branch, folding three voices into five drums. -->
        <a href="${L.rhythm}" class="sp-block sp-block-rhythm">
          <rect x="352" y="272" width="256" height="30" rx="8"/>
          <text x="480" y="291" text-anchor="middle">Rhythm &#160;·&#160; 6 melodic + 5 drums</text>
        </a>
        <path class="sp-wire sp-wire-join" d="M560 272 L560 190"/>
      </svg>`;

    this.pitch = this.mount.querySelector('[data-pitch]');
    this.inst = this.mount.querySelector('[data-inst]');
    this.glowMod = this.mount.querySelector('[data-glow-mod]');
    this.glowCar = this.mount.querySelector('[data-glow-car]');
    this.dacFill = this.mount.querySelector('.sp-dac-fill');

    if (!this.interactive) {
      for (const a of this.mount.querySelectorAll('a')) {
        a.removeAttribute('href');
        a.setAttribute('aria-hidden', 'true');
      }
    }
  }

  /** Redraw the labels that come from the store (the focus voice, channel 1). */
  render() {
    const f = store.get(0x10) | ((store.get(0x20) & 1) << 8);
    const b = (store.get(0x20) >> 1) & 7;
    const hz = fnumBlockToFreq(f, b);
    this.pitch.textContent = `F ${f} · B ${b} · ${hz.toFixed(0)} Hz`;
    const inst = (store.get(0x30) >> 4) & 0x0f;
    this.inst.textContent = inst === 0 ? 'your 8-byte patch' : INSTRUMENT_NAMES[inst];
  }

  /**
   * Live levels from the visualiser core. `mod`/`car` are the operators' latest
   * output magnitudes (roughly −1…1); `dac` is a 0…1 summed level.
   */
  setLevels(mod, car, dac) {
    this.glowMod.style.opacity = String(Math.min(1, Math.abs(mod)) * 0.6);
    this.glowCar.style.opacity = String(Math.min(1, Math.abs(car)) * 0.6);
    this.dacFill.setAttribute('width', String(Math.max(0, Math.min(1, dac)) * 100));
  }
}
