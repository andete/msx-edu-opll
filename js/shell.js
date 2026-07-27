// shell.js — the site chrome: the page registry, the header, the chain
// navigation, and the shared tool strip (the piano + the register inspector)
// every focus page ends with.
//
// Rendering the chrome from one module rather than repeating it across ten HTML
// files means the nav can never drift out of sync with the chain, and each page
// file stays down to the one thing it is teaching. The pages are still plain
// static documents — this runs at parse time, before first paint.
// Copy-don't-factor sibling of msx-edu-scc's shell.js, retargeted to the OPLL.

import { store } from './store.js';
import { play, stop, isPlaying, onPlayState } from './audio.js';
import { Piano } from './components/piano.js';
import { RegisterInspector } from './components/register-inspector.js';
import { VoiceAllocator } from './voices.js';
import { midiToFnumBlock } from './opll-spec.js';

/**
 * Every page on the site, in order. `chain` marks the seven-stage signal-path
 * walk that has prev/next navigation; Home, Explore and Reference sit outside
 * it. `spot` is the register addresses the page is about, for the inspector's
 * spotlight (a flat array of addrs, or {lo,hi} ranges, mixed). `ready:false`
 * marks a page a later phase will fill — shown, but dimmed and unlinked.
 */
export const PAGES = [
  { id: 'index', title: 'Home', href: 'index.html' },
  {
    id: 'tone', title: 'Tone', href: 'tone.html', chain: 1,
    lede: 'One operator, a sine, and the pitch formula behind it',
    addrs: '10–18, 20–28',
    spot: [{ lo: 0x10, hi: 0x18 }, { lo: 0x20, hi: 0x28 }],
  },
  {
    id: 'envelope', title: 'Envelope', href: 'envelope.html', chain: 2,
    lede: 'A full ADSR per operator — and the Key-On damp quirk',
    addrs: '04–07',
    spot: [{ lo: 0x04, hi: 0x07 }, { lo: 0x20, hi: 0x28 }],
  },
  {
    id: 'fm', title: 'FM', href: 'fm.html', chain: 3,
    lede: 'The second operator bends the first — that is FM',
    addrs: '00–03',
    spot: [{ lo: 0x00, hi: 0x03 }],
  },
  {
    id: 'instrument', title: 'Instrument', href: 'instrument.html', chain: 4,
    lede: 'The eight-byte patch, and the fifteen sounds in ROM',
    addrs: '00–07, 30–38',
    spot: [{ lo: 0x00, hi: 0x07 }, { lo: 0x30, hi: 0x38 }],
  },
  {
    id: 'voices', title: 'Voices', href: 'voices.html', chain: 5,
    lede: 'Nine independent FM voices, one keyboard',
    addrs: '10–18, 20–28, 30–38',
    spot: [{ lo: 0x10, hi: 0x18 }, { lo: 0x20, hi: 0x28 }, { lo: 0x30, hi: 0x38 }],
  },
  {
    id: 'rhythm', title: 'Rhythm', href: 'rhythm.html', chain: 6,
    lede: 'One bit turns three voices into five drums',
    addrs: '0E, 36–38',
    spot: [0x0e, { lo: 0x36, hi: 0x38 }],
  },
  {
    id: 'msx', title: 'MSX', href: 'msx.html', chain: 7,
    lede: 'Reaching the chip over ports 7Ch / 7Dh',
    addrs: '—',
  },
  {
    id: 'explore', title: 'Explore', href: 'explore.html',
    lede: 'The whole chip, every widget, all nine voices',
  },
  {
    id: 'tune', title: 'Tune', href: 'tune.html',
    lede: 'Play a real VGM recording and watch the driver work',
    // The one page with a transport of its own (a tune's play/pause/rewind), so
    // the shell's header Play button and play-on-edit are both suppressed here.
    transport: false,
  },
  {
    id: 'reference', title: 'Reference', href: 'reference.html',
    lede: 'Register map, the instrument ROM, calculators, sources',
  },
];

export const pageById = (id) => PAGES.find((p) => p.id === id);
const CHAIN = PAGES.filter((p) => p.chain).sort((a, b) => a.chain - b.chain);

// --- Play-on-edit ----------------------------------------------------------

// Starting to change any parameter — drag a slider, toggle a bit, pick an
// instrument — is taken to mean you want to hear it, so the first such edit
// starts the chip. Gated on the browser's user-activation signal: the register
// writes a page makes at load must NOT make sound on their own; only a change
// carrying a live gesture does.
let lastGestureAt = -Infinity;
if (typeof navigator !== 'undefined' && !navigator.userActivation) {
  for (const t of ['pointerdown', 'keydown']) {
    window.addEventListener(t, () => { lastGestureAt = performance.now(); }, true);
  }
}
const hasGesture = () =>
  navigator.userActivation ? navigator.userActivation.isActive
                           : performance.now() - lastGestureAt < 1000;

function armAudioOnEdit() {
  store.subscribe((e) => {
    if (isPlaying()) return;
    if (e.type !== 'reg') return;     // not a reset/bookkeeping event
    if (!hasGesture()) return;
    // Synchronous within the gesture's call stack, so the AudioContext is
    // constructed under the activation the autoplay policy requires.
    play().catch(() => { /* gesture window lost — the header Play still works */ });
  });
}

// --- Chrome ----------------------------------------------------------------

function logoSVG() {
  return `
    <svg class="logo" viewBox="0 0 40 40" aria-hidden="true">
      <rect class="logo-body" x="2" y="2" width="36" height="36" rx="8"/>
      <path class="logo-wave" d="M8 20 q3 -9 6 0 t6 0 t6 0 t6 0" fill="none"/>
    </svg>`;
}

function headerHTML(current) {
  const link = (p) => {
    const here = p.id === current ? ' aria-current="page"' : '';
    const cls = `nav-link${p.chain ? ' nav-chain' : ''}${p.ready === false ? ' nav-soon' : ''}`;
    if (p.ready === false) {
      return `<span class="${cls}" title="Coming in the next phase">${p.title}<em>soon</em></span>`;
    }
    return `<a class="${cls}" href="${p.href}"${here}>${p.title}</a>`;
  };
  const chain = CHAIN.map(link).join('');
  const outside = PAGES.filter((p) => !p.chain && p.id !== 'index').map(link).join('');
  // A page that carries its own transport (the Tune player) hides the header's,
  // so there are not two competing play buttons for two different things.
  const ownsTransport = pageById(current)?.transport === false;

  return `
    <div class="brand">
      <a href="index.html" class="brand-link" aria-label="OPLL Playground home">
        ${logoSVG()}
        <div>
          <h1>OPLL&nbsp;Playground</h1>
          <p class="tagline">The Yamaha <strong>YM2413</strong>, the FM chip of MSX-MUSIC.</p>
        </div>
      </a>
    </div>
    <nav class="site-nav" aria-label="Site">
      <div class="nav-group">${chain}</div>
      <div class="nav-group nav-group-alt">${outside}</div>
    </nav>
    ${ownsTransport ? '' : `
    <div class="header-actions">
      <button type="button" class="btn btn-play btn-transport" data-transport>▶ Play</button>
    </div>`}`;
}

function footerHTML() {
  return `
    <p>A clean-room teaching model of the YM2413 — behaviour from the docs, not
      ported from an emulator.</p>
    <p class="footer-links">
      <a href="https://damad.be/joost/">← damad.be/joost</a>
      <span class="footer-sep">·</span>
      <a href="https://github.com/andete/msx-edu-opll">source on GitHub</a>
      <span class="footer-sep">·</span>
      <a href="https://damad.be/joost/msx-edu-psg/">PSG Playground ↗</a>
      <span class="footer-sep">·</span>
      <a href="https://damad.be/joost/msx-edu-scc/">SCC Playground ↗</a>
      <span class="footer-sep">·</span>
      MIT © 2026 Joost Yervante Damad
    </p>`;
}

/** Prev / next along the chain, so a page reads as one step of a walk. */
function chainNavHTML(current) {
  const i = CHAIN.findIndex((p) => p.id === current);
  if (i < 0) return '';
  const prev = CHAIN[i - 1];
  const next = CHAIN[i + 1];
  const side = (p, dir) => {
    if (!p) return '<span class="chain-end"></span>';
    const label = dir === 'prev' ? '← Previous' : 'Next →';
    if (p.ready === false) {
      return `<span class="chain-link chain-${dir} is-soon">
        <span class="chain-dir">${label}</span>
        <span class="chain-title">${p.chain}. ${p.title}</span>
        <span class="chain-lede">coming in the next phase</span></span>`;
    }
    return `<a class="chain-link chain-${dir}" href="${p.href}">
      <span class="chain-dir">${label}</span>
      <span class="chain-title">${p.chain}. ${p.title}</span>
      <span class="chain-lede">${p.lede}</span></a>`;
  };
  return `${side(prev, 'prev')}${side(next, 'next')}`;
}

/** The "you are here" pips at the top of each chain page. */
function chainDotsHTML(current) {
  return CHAIN.map((p) => {
    const state = p.id === current ? ' here' : (p.ready === false ? ' soon' : '');
    const inner = `<span class="dot-n">${p.chain}</span><span class="dot-t">${p.title}</span>`;
    return p.ready === false || p.id === current
      ? `<span class="chain-dot${state}">${inner}</span>`
      : `<a class="chain-dot" href="${p.href}">${inner}</a>`;
  }).join('');
}

// --- Mounting ---------------------------------------------------------------

/**
 * Render the chrome around a page and, unless suppressed, the shared tool strip
 * at the bottom: the keyboard and the register inspector, spotlit on this
 * page's own bytes.
 *
 * @param {string} pageId
 * @param {object} opts
 *   tools:     false to skip the shared tool strip (the landing page).
 *   keyboard:  'focus' → every key plays channel 1 (the deep-dive voice);
 *              'poly'  → a polyphonic allocator (default); { channels: N }
 *              limits it to channels 0..N-1 (the Rhythm page uses 6 melodic).
 *   toolsHint, memIntro: override the default copy.
 * A page can also pull the keyboard out of the bottom strip and up next to its
 * own widget by putting a `[data-shell-keyboard]` element in its markup.
 * @returns {{ page, regs: RegisterInspector|null, voices: object|null }}
 */
export function mountShell(pageId, opts = {}) {
  const page = pageById(pageId);
  document.body.dataset.page = pageId;

  const header = document.querySelector('[data-shell-header]');
  if (header) { header.className = 'site-header'; header.innerHTML = headerHTML(pageId); }

  // The transport lives in the (sticky) header, because the two things you want
  // from it are opposites: "how do I start any of this" before scrolling, and
  // "how do I stop it" halfway down, with the keyboard long out of sight.
  const transport = header?.querySelector('[data-transport]');
  if (transport) {
    transport.addEventListener('click', async () => { if (isPlaying()) stop(); else await play(); });
    const sync = (playing) => {
      transport.textContent = playing ? '■ Stop' : '▶ Play';
      transport.classList.toggle('playing', playing);
      transport.setAttribute('aria-label', playing ? 'Stop the chip' : 'Start the chip');
    };
    onPlayState(sync);
    sync(isPlaying());
  }
  // Pages that carry their own transport (the Tune player) drive playback
  // themselves; everywhere else, editing a parameter starts the chip.
  if (page?.transport !== false) armAudioOnEdit();

  const footer = document.querySelector('[data-shell-footer]');
  if (footer) { footer.className = 'site-footer'; footer.innerHTML = footerHTML(); }

  for (const el of document.querySelectorAll('[data-chain-dots]')) {
    el.className = 'chain-dots';
    el.setAttribute('aria-label', 'Signal path progress');
    el.innerHTML = chainDotsHTML(pageId);
  }
  for (const el of document.querySelectorAll('[data-chain-nav]')) {
    el.className = 'chain-nav';
    el.setAttribute('aria-label', 'Signal path');
    el.innerHTML = chainNavHTML(pageId);
  }

  let regs = null, voices = null;
  const tools = document.querySelector('[data-shell-tools]');
  if (tools && opts.tools !== false) ({ regs, voices } = mountTools(tools, page, opts));

  return { page, regs, voices };
}

/** Flatten a page's `spot` (addrs and {lo,hi} ranges) to a flat addr array. */
function spotAddrs(spot) {
  const out = [];
  for (const s of spot) {
    if (typeof s === 'number') out.push(s);
    else for (let a = s.lo; a <= s.hi; a++) out.push(a);
  }
  return out;
}

function mountTools(mount, page, opts) {
  // Keyboard routing. Focus pages send every note to channel 1 so the deep-dive
  // widgets track it; the poly pages spread notes across the voices.
  const kb = opts.keyboard || 'poly';
  const isFocus = kb === 'focus';

  // The single-voice pages seed their focus note keyed ON (see each page's seed),
  // so the header Play sounds the voice immediately; the poly pages stay silent
  // until you play a note. The hint says which, so Play never feels broken.
  const hint = isFocus
    ? `Press <b>▶ Play</b> in the header and you'll hear this page's voice right
       away. The keys below re-trigger it and play other pitches, <b>while held</b>
       — key-up is the only note-off the OPLL has.`
    : `Press <b>▶ Play</b> in the header to start the chip, then play the keys below:
       chords work, since the voices are independent. Keys sound <b>while held</b>;
       key-up is the only note-off the OPLL has.`;

  const keysHTML = `
    <p class="tools-hint">
      ${hint} Use the mouse, or the computer keys printed on them
      (<kbd>Z</kbd><kbd>S</kbd><kbd>X</kbd>…<kbd>M</kbd>), an octave laid out the
      way an MSX keyboard does it.
    </p>
    <div data-piano class="piano-mount" aria-label="Playable keyboard"></div>`;

  const regsHTML = `
    <details class="reg-details">
      <summary>Register file${page?.addrs && page.addrs !== '—' ? ` — this page is <code>${page.addrs}</code>` : ''}</summary>
      <p class="reg-intro">${opts.memIntro || `
        The YM2413 is <b>write-only</b>: it can never be read back, so a driver
        keeps this shadow copy of every byte it has sent. The bytes this page is
        about are lit; the rest are dimmed. Click a bit to flip it.`}
      </p>
      <div data-regs></div>
    </details>`;

  // A page whose whole point is "hold a key and watch" can host the keyboard
  // itself, next to the widget it drives, instead of leaving it at the bottom
  // of the tool strip. It declares a `[data-shell-keyboard]` slot; the register
  // file stays down in the strip either way.
  const keysHost = document.querySelector('[data-shell-keyboard]');
  if (keysHost) {
    keysHost.className = 'keys-stage';
    keysHost.innerHTML = keysHTML;
    mount.innerHTML = regsHTML;
  } else {
    mount.innerHTML = keysHTML + regsHTML;
  }
  const keysRoot = keysHost || mount;

  let voices = null, onNoteOn, onNoteOff;
  if (isFocus) {
    const held = [];                              // last-note-priority mono on ch1
    const CH = 0;
    const setPitch = (midi) => {
      const { fnum, block } = midiToFnumBlock(midi);
      store.setFnum(CH, fnum); store.setBlock(CH, block);
    };
    onNoteOn = (midi) => {
      if (!held.includes(midi)) held.push(midi);
      setPitch(midi);
      // Force a rising key edge so every press re-attacks the envelope, even when
      // a note is already sounding (a held note, or the page's seeded tone).
      store.keyOn(CH, false);
      store.keyOn(CH, true);
    };
    onNoteOff = (midi) => {
      const i = held.indexOf(midi); if (i >= 0) held.splice(i, 1);
      if (held.length) setPitch(held[held.length - 1]);   // fall back to the held note
      else store.keyOn(CH, false);
    };
  } else {
    voices = new VoiceAllocator(store, { channels: (kb.channels ?? 9) });
    onNoteOn = (midi) => voices.noteOn(midi);
    onNoteOff = (midi) => voices.noteOff(midi);
  }
  new Piano(keysRoot.querySelector('[data-piano]'), {
    base: 48, octaves: opts.octaves ?? 3,
    onNoteOn: async (midi) => { onNoteOn(midi); await play(); },
    onNoteOff,
  });

  const regs = new RegisterInspector(mount.querySelector('[data-regs]'), store);
  if (page?.spot) regs.setSpotlight(spotAddrs(page.spot));
  return { regs, voices };
}
