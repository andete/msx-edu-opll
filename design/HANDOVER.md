# msx-edu-opll — session handover

Written 2026-07-24, at the end of **Phase 3 (FM)**. Read this first, then
[build-plan.md](build-plan.md) (the spec) and
[../reference/opll-registers.md](../reference/opll-registers.md) (the chip truth).
This project teaches the Yamaha **YM2413 (OPLL)** FM chip as a static, no-build web
app; siblings are `../msx-edu-psg` and `../msx-edu-scc`, family recipe in
[../../msx-edu-meta/META-PLAN.md](../../msx-edu-meta/META-PLAN.md).

## Where things stand

- **HEAD:** `8b21a37` (design decision). Phase 3 code is `0491435`.
- **Done:** R (research/reference), D (design), 0+1 (vertical slice — one voice
  sounding), 2 (ADSR envelope + live scope), **3 (FM — the second operator)**.
- **Live sandbox:** [../index.html](../index.html) — a single voice (channel 1 /
  index 0), full 2-operator FM. Serve the folder and open it:
  ```bash
  python3 -m http.server
  ```
  (AudioWorklet needs http, not `file://`.)
- **Regression guard — must stay green:**
  ```bash
  node tools/verify-core.mjs
  ```
  **29 checks** (24 core + 5 FM). It asserts behaviour vs
  [reference §12](../reference/opll-registers.md), not cycle-exact emu2413.

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

- **Phase 4 — the whole patch + ROM gallery** (★): `opll-spec.js` already has
  `INSTRUMENT_ROM`/`INSTRUMENT_NAMES`/`decodePatch`; add
  `js/components/patch-panel.js` (8 user bytes as controls) + a ROM gallery with a
  **copy-to-user** button (write the ROM bytes into `00`–`07`), and `js/presets.js`.
- **Phase 5 — nine voices** (`js/panels/channel.js` ×9; polyphony — the core
  already sums 9 channels).
- **Phase 6 — rhythm mode** (`0E` bit5 → 6 melodic + 5 drums + noise LFSR;
  `writeReg` currently ignores `0x0e`, marked "Phase 6").
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
