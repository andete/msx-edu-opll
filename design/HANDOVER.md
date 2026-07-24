# msx-edu-opll — session handover

Written 2026-07-24, at the end of the **VGM tune player** — the last planned
feature. The site is now **complete** against the build plan. Read this first,
then [build-plan.md](build-plan.md) (the spec) and
[../reference/opll-registers.md](../reference/opll-registers.md) (the chip truth).
This project teaches the Yamaha **YM2413 (OPLL)** FM chip as a static, no-build web
app; siblings are `../msx-edu-psg` and `../msx-edu-scc`, family recipe in
[../../msx-edu-meta/META-PLAN.md](../../msx-edu-meta/META-PLAN.md).

## Where things stand

- **Done:** R (research/reference), D (design), 0+1 (vertical slice — one voice
  sounding), 2 (ADSR envelope + live scope), 3 (FM — the second operator),
  4 (the whole patch + the ROM gallery), 5 (nine voices), 6 (rhythm mode),
  7 (the multi-page split), 8 (MSX code view + Reference + polish), **the VGM tune
  player**. All build phases AND the deferred VGM player are done — the site is
  complete.
- **Live site:** serve the folder and open [../index.html](../index.html) (the
  landing page). The chain is [Tone](../tone.html) → [Envelope](../envelope.html)
  → [FM](../fm.html) → [Instrument](../instrument.html) → [Voices](../voices.html)
  → [Rhythm](../rhythm.html) → [MSX](../msx.html); off-chain are
  [Explore](../explore.html) (the full sandbox, click-to-focus),
  [Tune](../tune.html) (the VGM player) and [Reference](../reference.html). No
  `ready:false` pages remain.
  ```bash
  python3 -m http.server
  ```
  (AudioWorklet needs http, not `file://`.)
- **Regression guard — must stay green:**
  ```bash
  node tools/verify-core.mjs
  ```
  **52 checks** (24 core + 5 FM + 5 patch/gallery + 5 polyphony + 13 rhythm). It
  asserts behaviour vs [reference §9, §12](../reference/opll-registers.md), not
  cycle-exact emu2413.

## Architecture crib (see build-plan §2–§3 for detail)

- **One core, three contexts.** [../js/opll-core.js](../js/opll-core.js) is a
  *classic script* (no import/export) that runs in the window, the AudioWorklet,
  and Node. It is a **clean-room model written from documented behaviour** — never
  port emu2413/openMSX/MAME (project rule, reference §0). The full FM + ADSR math
  is already implemented.
- **Single source of truth:** [../js/store.js](../js/store.js) — the write-only
  register file `00`–`38` as a `Uint8Array`. Everything subscribes: audio worklet,
  UI panels, the viz core. Nothing else owns register state.
- **Audio:** [../js/audio.js](../js/audio.js) → [../js/opll-worklet.js](../js/opll-worklet.js)
  wraps opll-core; store changes are `postMessage`'d as `{type:'reg',addr,value}`.
- **Viz:** [../js/loop.js](../js/loop.js) runs a *second* opll-core on the main
  thread and **advances it by real elapsed time each frame** (OPLL envelopes are
  stateful), then the page's draw callback renders from its now-current state. No
  SharedArrayBuffer, no COOP/COEP.
- **Knowledge layer:** [../js/opll-spec.js](../js/opll-spec.js) — register
  metadata, note↔(F-Number,Block), and (added in Phase 3) `harmonics()`.

## What the VGM tune player added (files)

The deferred "load a file" feature (build-plan §7.1, memory `vgm-loader-plan`),
retargeted from the SCC's tune stack (copy-don't-factor).

- [../js/vgm.js](../js/vgm.js) — the VGM reader/replayer. `readVgmFile` (accepts
  `.vgm`/`.vgz`, un-gzips via `DecompressionStream`), `parseHeader` (clocks, GD3,
  loop), and **`VgmPlayer`** — a sample-clocked replayer that emits register
  writes instead of audio, `tick(dtMs)` catching up to wall-clock. The OPLL command
  is a plain **`0x51 aa dd`** → `onWrite(aa, dd)` (much simpler than the SCC's
  port-based `0xD2`); **`0xA0`** PSG writes go to `onPsgWrite`; waits/other chips
  skipped. Reworked from the SCC's `vgm.js`; header/wait machinery kept near-verbatim.
- [../js/psg-core.js](../js/psg-core.js) + [../js/psg-worklet.js](../js/psg-worklet.js)
  — **vendored verbatim** from msx-edu-scc (which vendored them from msx-edu-psg).
  Classic scripts exposing `globalThis.PsgCore` / the `psg` processor. Only ever
  driven by the VGM player.
- [../js/audio.js](../js/audio.js) — **reworked** to add the PSG second node. Both
  chips now feed a `DynamicsCompressor` limiter bus (so OPLL+drums can't clip);
  `usePsg(on,{clock})` / `postPsg(reg,val)` / `resetPsg()` build and drive the PSG
  worklet lazily (`PSG_GAIN = 0.14`, tuned by ear under the FM). The OPLL reg/reset
  forwarding + play/stop are unchanged.
- [../tune.html](../tune.html) + [../js/pages/tune.js](../js/pages/tune.js) — the
  Tune page: a drop-zone / file-pick / **demo** loader, its **own transport**
  (play=advance the log, pause=stop+key-off, rewind, loop) kept SEPARATE from
  `isPlaying()` so a piano keypress starts audio without resuming the song, a live
  scope (`viz.process`), five **write-activity** bars by register region (patch /
  pitch / key / select / rhythm; PSG counted separately), GD3 metadata, a chip
  list (OPLL + PSG played, anything else named + "not played"), and a 9-strip rack
  that lights as the tune keys channels. Writes land via `store.set`, so every
  widget reacts.
- [../tools/make-demo-vgm.mjs](../tools/make-demo-vgm.mjs) +
  **`../assets/demo.vgm`** — an original OPLL+PSG piece (Am–F–C–G, ~36 s), a small
  FM driver that selects ROM instruments, swaps the lead between sections, keys FM
  notes (real ADSR — no by-hand volume writes, unlike the SCC), and puts drums on
  the PSG noise channel. Generated (MIT), not ripped; **committed** (not
  gitignored). Regenerate with `node tools/make-demo-vgm.mjs`.
- [../js/shell.js](../js/shell.js) — added the `tune` PAGES entry with
  **`transport: false`**; the header Play button and play-on-edit are both
  suppressed for such a page (it drives audio itself).
- [../css/styles.css](../css/styles.css) — the Tune-page chrome (loader/drop-zone,
  transport/seek, tune-head/chips, activity bars), ported from the SCC.
- **Verifying gotcha (again):** the Tune player is driven by the rAF viz loop, and
  the in-app browser pane **pauses rAF entirely when hidden** — so playback appears
  frozen (time stuck at 0:00) in automated checks even though it is correct. Verify
  the player by importing `vgm.js` and driving `VgmPlayer.tick()` manually (the
  decode + timing are exact: 40×100 ms ticks → position 4.00 s), and trust that
  audio plays when the tab is actually visible (the worklet path is verified
  separately).
- **Core untouched** — still 52 checks green. (The VGM player is pure playback into
  the existing store/worklet; `verify-core.mjs` has no VGM checks — the demo's
  structure is validated by a standalone header/stream walk instead.)

## What Phase 8 added (files)

- [../js/components/code-view.js](../js/components/code-view.js) — the **live Z80
  code view**, mounted on the MSX page. `createCodeView(el)` regenerates the exact
  `OUT (7Ch)/(7Dh)` sequence (each register = `ld a,#RR / out (#7c),a / ld a,#VV /
  out (#7d),a`) from the register file on every store change, with decoded
  comments (instrument names, the Hz a channel's F-Number/Block makes, the rhythm
  key bits). A checkbox filters to keyed channels; a Copy button lifts the plain
  text. Much simpler than the SCC's version — no bank-switch, no wave tables.
- [../reference.html](../reference.html) + [../js/pages/reference.js](../js/pages/reference.js)
  — the **Reference** page (flipped `ready:false`→ready in `shell.js`). A TOC and
  eight sections, **all computed, none transcribed**: the register map; the eight
  patch bytes bit-by-bit (matches `decodePatch` exactly); a **note↔(F-Number,Block)
  calculator** (MIDI/Hz two-way, shows the chip's actual frequency + cents error +
  the F-Number step size, with a "hear it on ch1"); the **Multiple** table (from
  `ML2`, shown as the real ×½…×15 multipliers); the **level/envelope** table
  (steps pulled from `OpllCore.VOL_STEP_DB` 3.0 / `TL_STEP_DB` 0.75 / `EG_STEP_DB`
  0.375); the **15 ROM instruments** as a gallery — each decoded (mod ML/TL/FB, car
  ML) with its harmonic **fingerprint** from `instrumentFingerprint(n)` and a
  load-into-ch1 button; the OPL-family / VRC7 note; and sources. Fingerprints
  redraw on resize + theme flip.
- [../msx.html](../msx.html) / [../js/pages/msx.js](../js/pages/msx.js) — the lean
  Phase-7 prose page now mounts the real code view (replacing the one-line "last
  write" echo).
- [../css/styles.css](../css/styles.css) — Phase-8 chrome: `panel-code` /
  `code-block` (syntax colours `c-op`/`c-num`/`c-cmt`), the `ref-table` family,
  `toc`, `calc-*`, `gallery`/`gal-*`, plus a global `:focus-visible` ring and a
  `max-width:680px` header/`#main` tightening (the a11y/mobile pass).
- **Core untouched** — still 52 checks green. The Reference numbers are validated
  by construction (same modules as the synth); the acceptance "every calculator
  agrees with opll-spec.js" holds because they *are* opll-spec.js.
- **Note:** the reference gallery / calculator "hear it" buttons key ch1 on and
  leave it ringing (stop from the header) — same model as the SCC's reference, and
  fine for a lookup page.

## What Phase 7 added (files)

- [../js/shell.js](../js/shell.js) — **the site chrome**, one module for all ten
  HTML files (copy-don't-factor sibling of the SCC's `shell.js`). Owns: the
  `PAGES` **registry** (id/title/href, `chain` #, `lede`, `addrs`, `spot`,
  `ready`), the header + nav, the **chain** prev/next + "you are here" dots, the
  footer, and **`mountShell(pageId, opts)`** which also mounts the shared tool
  strip (piano + spotlit register inspector) into `[data-shell-tools]`. The
  header holds the **transport** (Play/Stop) and there is **play-on-edit** (first
  gesture-carrying `reg` write starts the chip) — new here; the OPLL `audio.js`
  didn't have it. `opts.keyboard`: `'focus'` (mono, last-note priority on ch1, for
  Tone/Env/FM/Instrument), `'poly'` (VoiceAllocator, default), or `{channels:N}`
  (Rhythm uses 6 melodic). Pages are still plain static docs; this runs at parse
  time.
- [../js/components/signal-path.js](../js/components/signal-path.js) — the OPLL
  **block diagram** (inline SVG, clickable links = the site map): phase gen →
  modulator —FM→ carrier → Σ → 9-bit DAC, with the instrument patch feeding both
  operators, each operator's ADSR, and the rhythm branch. `render()` reads the
  focus voice's pitch/instrument; `setLevels(mod,car,dac)` glows the operators and
  the DAC bar from the live core. **Gotcha fixed:** it lives in `components/`, so
  imports are `../store.js` / `../opll-spec.js` (a `./` typo 404'd the whole module
  graph and left blank pages — nav/diagram absent, no console error, just "Failed
  to fetch dynamically imported module" on manual import).
- [../js/components/challenge.js](../js/components/challenge.js) — per-page
  **self-checking tasks** (predicate over the store, re-tested on every change,
  sticky once met). Ported from the SCC.
- **The pages** — landing [../index.html](../index.html) +
  [../js/pages/landing.js](../js/pages/landing.js) (hero = live signal path + a
  5-note ROM chord button + chain cards); the six chain pages
  [tone](../js/pages/tone.js) · [envelope](../js/pages/envelope.js) ·
  [fm](../js/pages/fm.js) · [instrument](../js/pages/instrument.js) ·
  [voices](../js/pages/voices.js) · [rhythm](../js/pages/rhythm.js), each seeding
  its own registers, mounting only its widgets, spotlighting its addrs, with 2-3
  challenges; a **lean** [msx](../js/pages/msx.js) (prose on 7Ch/7Dh + the
  write-only shadow, and a live "last write → the two Z80 `OUT`s" echo — the full
  interactive code-view is Phase 8); and [explore](../js/pages/explore.js) — the
  old single-page sandbox, now with **click-a-strip-to-focus** any of the nine
  voices (the `ChannelPanel.onFocus` seam from Phase 5, finally wired: it rebuilds
  the pitch/operator/patch panels for the new channel and the viz loop reads
  `focusCh`). **The old `js/pages/index.js` was removed** (replaced by landing +
  explore).
- [../css/styles.css](../css/styles.css) — appended the Phase-7 chrome (nav,
  focus-page, chain dots/nav, note-box, challenges, tool strip, landing/hero/cards,
  and the `sp-*` signal-path styles; modulator blocks tinted `--mod`, carrier
  `--accent`). Reused the existing `.btn`/`.btn-play`/`kbd`.
- **Scope of Phase 7:** the page split, per stated deliverable. **Reference** is a
  `ready:false` stub. The rhythm page's scope renders the real mixed output via
  `viz.process()` (drums aren't visible through `renderScope`/`channelSample`,
  which are the melodic path). Core (`opll-core.js`) is **untouched** — 52 checks
  still green.

## What Phase 6 added (files)

- [../js/opll-core.js](../js/opll-core.js) — the **rhythm subsystem** (search
  "rhythm subsystem"). `writeReg(0x0e)` → `writeRhythm`: bit5 enters/leaves the
  mode, bits0-4 key the five drums on rising/falling edges. `enterRhythm` forces
  ch7-9's operators to ROM patches **16-18** and levels them from the drum-volume
  nibbles (`refreshRhythmLevels`: 36 = BD · 37 = HH·hi/SD·lo · 38 = TOM·hi/CYM·lo).
  `process` splits **6 melodic + 5 drums** when the mode is on. The **Bass Drum**
  is a plain 2-op voice (`channelSample(6)`); **Snare/Tom/Hi-Hat/Cymbal** are
  single-operator slots synthesised in `rhythmSample`. The **Tom** is a plain sine;
  the **Snare/Hi-Hat/Cymbal** follow the documented OPLL rhythm algorithm — a
  `hatCymGate` phase-bit comparison + the 23-bit noise **LFSR** (`clockNoise`) pick
  an absolute **sine-table phase** (`drumWave`) each sample, so they read pitched-
  yet-gritty, not as harsh squares. **All drum phase generators free-run** (advanced
  every sample regardless of key; the envelope gates only the output) — the hi-hat
  and cymbal share the gate, so the cymbal's brightness depends on the hi-hat
  operator's phase still moving even when only the cymbal is hit. Drums are +3 dB
  (`RHYTHM_GAIN`, exported).
  Pitch/inst writes to ch7-9 are guarded so rhythm levels/patches aren't clobbered,
  and the ch7-9 channel-key bits are ignored in rhythm mode (drums key only via
  `0E`).
- [../js/panels/rhythm.js](../js/panels/rhythm.js) — the **Rhythm panel**: a mode
  switch (`0E` bit5), five hold-to-hit **pads** (each keys its `0E` bit; two-way
  bound so they light on any `0E` write), a **level** slider per drum → the 36/37/38
  nibbles, and a looping **demo beat** (a 16-step groove pulsed via `setInterval`,
  keying each hit off-then-on for a clean re-trigger). It writes drum **tuning**
  into 16-18/26-28 once when the mode switches on — chosen for the ROM patch
  Multiples: ch9 is tuned low because the Tom operator (patch 18) is Multiple ×5,
  so the tom lands ~150 Hz instead of shrill; bass drum ~65 Hz. Pads are dead until
  rhythm mode is armed.
- [../index.html](../index.html) — the `#rhythm` section + Phase-6 note/badge.
- [../css/styles.css](../css/styles.css) — the rhythm panel styles (mod-orange
  accent; `.drum-pads.armed` gates the pads; `.drum-pad.hit` is the lit state).
- [../js/pages/index.js](../js/pages/index.js) — mounts `RhythmPanel`.
- [../tools/verify-core.mjs](../tools/verify-core.mjs) — **§13**, 13 rhythm checks
  (five drums audible; **tom low/tonal, BD lowest, hi-hat brighter** — these lock
  the tuning that a first pass got wrong; **hi-hat AND cymbal keyed *alone* stay
  bright > 2 kHz** — pins the free-running-phase fix; idle-vs-all; melodic 1-6
  untouched; ch7-9 channel key dead; rhythm + 6 melodic within headroom; +3 dB
  ratio == `RHYTHM_GAIN`; noise balanced + non-degenerate).
- **Teaching-decision note (build-plan §7.3):** the drum synthesis is modelled
  "faithfully enough to sound right and be inspectable", **not** cycle-exact — but
  the metallic/snare voices DO follow the OPLL's documented rhythm algorithm (the
  `hatCymGate` phase-bit comparison + sine-table lookup at the fixed drum phase
  points `0x0d0/0x234/0x2d0/0x100/0x300/…`). Those constants and the 23-bit noise
  **polynomial** (bit0⊕bit8) are reproduced as **behavioural data** from Okazaki's
  emu2413 (the reference this project follows, §0), like the instrument ROM, with
  attribution; the surrounding code is ours. A first pass used raw ±1 squares and
  an uncompensated tom tuning — it sounded wrong; this is the fix.
- **Known limitation (not a bug):** the polyphonic piano allocator
  ([../js/voices.js](../js/voices.js)) still round-robins all nine channels, so in
  rhythm mode it may hand a note to ch7-9 (now drums) where it stays silent —
  effectively six melodic voices. Making the allocator rhythm-aware is a natural
  Phase 7 (page-split) tidy-up; the core is already correct.

## What Phase 5 added (files)

- [../js/voices.js](../js/voices.js) — `VoiceAllocator`: maps held MIDI notes onto
  the nine channels round-robin, steals the oldest voice when all nine are busy,
  writes **only** pitch (`10`+ch/`20`+ch) + Key-On through the store (never
  instrument/volume). Owns no sound state — just note↔channel bookkeeping.
- [../js/panels/channel.js](../js/panels/channel.js) — `ChannelPanel`: one compact
  mixer strip per channel (instrument `<select>` · MIDI-note pitch slider · level ·
  a hold-to-sound **Key** button). Two-way bound to `10`+ch/`20`+ch/`30`+ch; the
  strip lights (`.sounding`) whenever its channel is keyed — including when the
  polyphonic piano drives it. Has an optional `onFocus(ch)` for the Phase-7 split.
- [../js/pages/index.js](../js/pages/index.js) — seeds all nine channels (instrument
  0 = the shared user patch, A4, keyed off) so the piano is a uniform polyphonic FM
  instrument out of the box; mounts nine strips into `#voices`; the piano now calls
  the allocator instead of hard-writing channel 0.
- [../index.html](../index.html) — the `#voices` mixer section; Phase-5 note + badge.
- [../tools/verify-core.mjs](../tools/verify-core.mjs) — 5 polyphony checks (nine
  voices sum & louder than one, chord stays in DAC headroom, independent
  pitch/instrument per channel).
- **Focus voice, not channel-switching (yet).** The deep-dive widgets
  (operator-pair, harmonics, ADSR, operator panels, pitch, patch gallery) still
  hard-code `CH = 0`. Making them follow a *selected* channel (the site-outline's
  "one voice expanded + voices 2–9 compact") is **Phase 7** (the page split);
  `ChannelPanel`'s `onFocus` hook is the seam left for it.

## What Phase 4 added (files)

- ★ [../js/components/patch-panel.js](../js/components/patch-panel.js) — the
  Instrument gallery: 16 tiles (User + 15 ROM), each with a harmonic-fingerprint
  canvas, click-to-select (writes `30`+ch), **copy → user ✎** on ROM tiles (drops
  the ROM's 8 bytes into `00`–`07` and switches to slot 0), and preset chips.
  Two-way bound: the active tile follows `30`+ch; the User fingerprint redraws when
  `00`–`07` change.
- [../js/presets.js](../js/presets.js) — five hand-built, editable teaching user
  patches (Pure sine / 2:1 Bell / Brass / Clav / Feedback growl) + `loadUserPatch`.
  Our own bytes, not any ROM/emulator table.
- [../js/opll-spec.js](../js/opll-spec.js) `instrumentFingerprint(n, userBytes)` —
  offline harmonic signature: a **private throwaway core** (read lazily from
  `globalThis.OpllCore` so the Node verifier works too), pitched to a fixed mid
  note, `renderPair` → `harmonics` binned against the note fundamental. `FP_BARS`
  exported.
- [../js/pages/index.js](../js/pages/index.js) + [../index.html](../index.html) —
  mount `#patch`; Phase-4 note + badge. The existing operator-pair / harmonics /
  ADSR viz already read `patchBytes(ch)`, so they follow the selected ROM for free.
- [../tools/verify-core.mjs](../tools/verify-core.mjs) — 5 checks appended (§10
  select + copy-to-user identity, §11 fingerprint sanity/distinctness).
- **Note:** the operator panels always edit the *user* slot (`00`–`07`). While a
  ROM instrument is selected they don't change the sound — the gallery status line
  says so, and **copy → user** is the bridge. Dimming them when a ROM is active is
  possible Phase-5+ polish, not done.

## What Phase 3 added (files)

- ★ [../js/components/operator-pair.js](../js/components/operator-pair.js) — the
  star widget: modulator scope → FM link (thickness ∝ drive) → carrier scope, the
  modulator feedback loop, and a **show internals** overlay (bare sine + injected
  phase). Fed by `OpllCore.renderPair(frames, ch)`.
- ★ [../js/components/harmonics.js](../js/components/harmonics.js) — live 16-bar
  DFT of the **carrier output** (retargeted from the SCC's `harmonics.js`).
- [../js/opll-core.js](../js/opll-core.js) `renderPair()` — non-destructive,
  envelope-open render of `{modulator, carrier, phaseOffset, carrierClean}`.
- [../js/opll-spec.js](../js/opll-spec.js) `harmonics(samples, f0, nHarm)` — a
  Goertzel-style projection onto `k·f0`, Blackman–Harris windowed (no library).
- [../js/panels/operator.js](../js/panels/operator.js) — now drives **both**
  operators, with the FM timbre controls: Multiple, modulator Total Level (FM
  depth), Feedback, and the sine/half-sine WS bit.
- [../js/pages/index.js](../js/pages/index.js) — audible 2:1 default FM patch,
  mounts the two operator panels + operator-pair + harmonics.
- [../tools/verify-core.mjs](../tools/verify-core.mjs) — 5 FM checks appended.
- FM tuning constants live in opll-core.js: `FM_DEPTH = 4.0`, `FB_BASE = 0.0125`
  (×`2^fb`). Tuned by ear/spectrum; adjust there if a later phase needs it.

## Gotchas learned (don't relearn these)

- **Stale module cache.** After editing JS modules, a plain browser reload can
  serve STALE modules → the draw loop silently dies → empty ("black box") canvas.
  Hard-reload, or bump the server port, when verifying.
- **Verify the real audio path** (press Play + a key), not just the viz.
- **Harmonic resolution needs periods.** Binning against a fundamental that only
  fills ~2 periods of the analysis window gives garbage (window leakage). Render
  a long enough window (`renderPair(2048)` in index.js) and bin against the base
  F-Number/Block pitch (Multiple 1). The pair widget only *displays* the first
  ~640 samples (opts.show) so it stays readable.
- **TL 63 is not silence** — it's ~47 dB, so a "silenced" modulator still leaves
  ~5% carrier sidebands. Don't assert "≈ zero"; assert relative enrichment.
- **High FM index spreads energy past the 16th harmonic** (and aliases), so raw
  "energy in bins 2..16" is *not* monotonic with depth. The **spectral centroid**
  is — that's what the verify-core FM checks track.
- **Browser pane rAF pauses when the pane is hidden**, so `await requestAnimationFrame`
  stalls and the viz loop freezes. Drive it with screenshots (which repaint) or
  synchronous JS + a screenshot, not rAF-based waits.

## What's next

Nothing planned — the build plan and its one deferred extra are all done. If the
project continues, candidates (all optional, none scoped): a real MSX-MUSIC VGM in
`assets/` alongside the generated demo (licensing permitting); making the deep-dive
widgets on Explore follow the focus voice's *live* rhythm state; a VRC7 variant
toggle (explicitly declined in v1, build-plan §7.2); or a couple of `verify-core`
checks that round-trip a tiny VGM through `VgmPlayer` into the core.

### Seams / notes for later
- The chain pages seed registers on load; there is no cross-page state (each HTML
  is a fresh document). Fine — matches the siblings.
- `color-mix()` is used for two signal-path stroke tints; it degrades to the
  default border on ancient engines (harmless).
- **Browser-pane gotcha (verifying):** the in-app browser pane pauses painting
  when hidden, so a screenshot taken right after a programmatic `scrollIntoView`
  to a mid-page dark section can come back all-black even though the DOM is fine.
  Verify with DOM/`getImageData` reads (authoritative), or screenshot only after a
  fresh navigate / `scrollTo(0,0)`.

### Deferred: the VGM "load a file" tune player

Decided 2026-07-24 (see [build-plan.md §7.1](build-plan.md) and the project
memory). Confirmed for this site, **deferred** to its own step around the Phase 7
sandbox/page split. Retarget the SCC's `js/vgm.js` + `js/pages/tune.js` +
`assets/demo.vgm` + `tools/make-demo-vgm.mjs` (copy-don't-factor). Decode OPLL VGM
writes (`0x51`); **forward the PSG drum track (`0xA0`) to a borrowed `msx-edu-psg`
worklet** (not OPLL-only); name any other declared chip and leave it silent.

## Conventions (locked)

- **user-patch-first** (teach FM by building the 8 user bytes; ROM gallery is a
  Phase 4 addition), **YM2413-only** (no VRC7), **model behaviour, never port an
  emulator**, **copy-don't-factor** across the sibling projects.
- Present files as clickable markdown links (relative path, `:line` when useful).
- Commits: descriptive, style as in the log, trailer
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. The repo has no
  committer configured — pass
  `-c user.name="Joost Yervante Damad" -c user.email="joost@damad.be"`.
