# msx-edu-opll — session handover

Written 2026-07-24, at the end of **Phase 6 (rhythm mode)**. Read this first, then
[build-plan.md](build-plan.md) (the spec) and
[../reference/opll-registers.md](../reference/opll-registers.md) (the chip truth).
This project teaches the Yamaha **YM2413 (OPLL)** FM chip as a static, no-build web
app; siblings are `../msx-edu-psg` and `../msx-edu-scc`, family recipe in
[../../msx-edu-meta/META-PLAN.md](../../msx-edu-meta/META-PLAN.md).

## Where things stand

- **Done:** R (research/reference), D (design), 0+1 (vertical slice — one voice
  sounding), 2 (ADSR envelope + live scope), 3 (FM — the second operator),
  4 (the whole patch + the ROM gallery), 5 (nine voices), **6 (rhythm mode)**.
- **Live sandbox:** [../index.html](../index.html) — nine polyphonic FM channels
  + the rhythm kit (the deep-dive widgets still focus channel 1 / index 0). Serve
  the folder and open it:
  ```bash
  python3 -m http.server
  ```
  (AudioWorklet needs http, not `file://`.)
- **Regression guard — must stay green:**
  ```bash
  node tools/verify-core.mjs
  ```
  **46 checks** (24 core + 5 FM + 5 patch/gallery + 5 polyphony + 7 rhythm). It
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

## What Phase 6 added (files)

- [../js/opll-core.js](../js/opll-core.js) — the **rhythm subsystem** (search
  "rhythm subsystem"). `writeReg(0x0e)` → `writeRhythm`: bit5 enters/leaves the
  mode, bits0-4 key the five drums on rising/falling edges. `enterRhythm` forces
  ch7-9's operators to ROM patches **16-18** and levels them from the drum-volume
  nibbles (`refreshRhythmLevels`: 36 = BD · 37 = HH·hi/SD·lo · 38 = TOM·hi/CYM·lo).
  `process` splits **6 melodic + 5 drums** when the mode is on. The **Bass Drum**
  is a plain 2-op voice (`channelSample(6)`); **Snare/Tom/Hi-Hat/Cymbal** are
  single-operator slots synthesised in `rhythmSample` from a 23-bit noise **LFSR**
  (`clockNoise`) and a clean-room **metallic** phase-bit square. Drums are +3 dB
  (`RHYTHM_GAIN`, exported). Pitch/inst writes to ch7-9 are guarded so rhythm
  levels/patches aren't clobbered, and the ch7-9 channel-key bits are ignored in
  rhythm mode (drums key only via `0E`).
- [../js/panels/rhythm.js](../js/panels/rhythm.js) — the **Rhythm panel**: a mode
  switch (`0E` bit5), five hold-to-hit **pads** (each keys its `0E` bit; two-way
  bound so they light on any `0E` write), a **level** slider per drum → the 36/37/38
  nibbles, and a looping **demo beat** (a 16-step groove pulsed via `setInterval`,
  keying each hit off-then-on for a clean re-trigger). It writes drum **tuning**
  into 16-18/26-28 once when the mode switches on. Pads are dead until rhythm mode
  is armed.
- [../index.html](../index.html) — the `#rhythm` section + Phase-6 note/badge.
- [../css/styles.css](../css/styles.css) — the rhythm panel styles (mod-orange
  accent; `.drum-pads.armed` gates the pads; `.drum-pad.hit` is the lit state).
- [../js/pages/index.js](../js/pages/index.js) — mounts `RhythmPanel`.
- [../tools/verify-core.mjs](../tools/verify-core.mjs) — **§13**, 7 rhythm checks
  (five drums audible; idle-vs-all; melodic 1-6 untouched; ch7-9 channel key dead;
  +3 dB ratio == `RHYTHM_GAIN`; noise balanced + non-degenerate).
- **Teaching-decision note (build-plan §7.3):** the drum synthesis is modelled
  "faithfully enough to sound right and be inspectable", **not** cycle-exact. The
  metallic hi-hat/cymbal generator (`metallic()`) is a compact clean-room
  phase-bit square, not the emu2413 rhythm path. The noise **polynomial** (23-bit,
  bit0⊕bit8) is treated as hardware data (like the ROM); the code is ours.
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

## What's next (build-plan §5)

- **Phase 7 — multi-page split** (`js/shell.js` registry + chrome,
  `components/signal-path.js`, landing + the seven chain pages, the Explore
  sandbox).
- **Phase 8 — MSX context + reference + polish** (`code-view.js` for `7Ch`/`7Dh`,
  the reference page, mobile/a11y).

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
