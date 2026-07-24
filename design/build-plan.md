# msx-edu-opll — build plan

Concrete, detailed implementation plan. Draft 2026-07-24.
Companion to [site-outline.md](site-outline.md) (structure) and
[../reference/opll-registers.md](../reference/opll-registers.md) (the chip spec).

Stack is deliberately identical to the sibling **msx-edu-scc** / **msx-edu-psg**
projects (all inherited from **tape-peek**), per
[../../msx-edu-meta/META-PLAN.md](../../msx-edu-meta/META-PLAN.md). Where this plan
says "as in the sibling projects", the intent is to reuse the *pattern*, and often
the file, near-verbatim.

---

## 0. Stack & conventions (inherited)

- **Pure static site. No build step, no bundler, no `package.json`, no framework.**
- **ES modules** loaded via `<script type="module" src="js/pages/…">`, plus **one
  classic script** for the shared DSP core (see §2, "one core, three contexts").
- **Plain CSS** in `css/styles.css` using **CSS custom properties**; theme-aware
  via `@media (prefers-color-scheme: dark)`. No external fonts/assets — inline SVG
  + `data:` URI favicon. **Accent: teal/cyan** (FM-PAC livery), distinct from
  PSG-violet and SCC-red/amber.
- Per-concern JS modules with **named exports**; each page has a tiny entry
  module in `js/pages/` that mounts only the widgets it needs.
- Node **`tools/*.mjs`** scripts for dev-time verification only — never shipped,
  never a runtime dep.
- **MIT**, © Joost Yervante Damad. Repo: `github.com/andete/msx-edu-opll`.
- Needs a local server (`python3 -m http.server`) because the AudioWorklet can't
  be loaded from `file://`.
- **Write our own synth from the documented behaviour.** emu2413 (MIT), openMSX
  (GPL2) and MAME (BSD-3) are read as *specification*, never copied. The
  instrument-ROM **data** and the chip's published tables may be reproduced with
  attribution; the code that processes them may not. See
  [../docs/SOURCES.md](../docs/SOURCES.md).

---

## 1. Repository layout

```
msx-edu-opll/
├── index.html               # landing: hero + signal path
├── tone.html  envelope.html  fm.html  instrument.html
├── voices.html  rhythm.html  msx.html
├── explore.html  reference.html
├── css/styles.css           # theme vars + all component styles (OPLL teal)
├── js/
│   ├── shell.js             # page registry, chrome, chain nav, piano wiring
│   ├── loop.js              # main-thread viz core + rAF loop
│   ├── store.js             # the 64-byte register file = single source of truth
│   ├── opll-spec.js         # register metadata, INSTRUMENT_ROM, note↔fnum, DFT, tables
│   ├── opll-core.js         # ⚑ CLASSIC script — the DSP synth (shared, see §2)
│   ├── opll-worklet.js      # AudioWorkletProcessor wrapping opll-core
│   ├── audio.js             # AudioContext setup, worklet loading, register bus
│   ├── presets.js           # patch gallery + full-machine presets
│   ├── components/
│   │   ├── operator-pair.js # ★ modulator+carrier scopes, the FM link, feedback
│   │   ├── adsr-view.js     # ★ the four-phase envelope, animated, per operator
│   │   ├── harmonics.js     # ★ DFT of the carrier output (retargeted from SCC)
│   │   ├── patch-panel.js   # ★ the 8 user bytes as controls + ROM gallery
│   │   ├── scope.js         # canvas oscilloscope (+ intermediate taps)
│   │   ├── register-inspector.js # the write-only 00–38 file, two-way bound
│   │   ├── piano.js         # note ↔ (fnum,block) keyboard
│   │   ├── signal-path.js   # animated SVG block diagram
│   │   └── code-view.js     # equivalent Z80 OUT (7Ch)/(7Dh) sequence
│   ├── panels/
│   │   ├── operator.js      # one operator's controls (AM PM EG KR ML / KL TL WS FB / AR DR SL RR)
│   │   ├── pitch.js         # F-Number + Block + note readout
│   │   ├── channel.js       # one voice strip (instantiated ×9)
│   │   ├── rhythm.js        # the 6+5 drum panel
│   │   ├── presets.js       # preset shelf
│   │   └── master.js        # play/stop, output scope
│   └── pages/
│       ├── landing.js  tone.js  envelope.js  fm.js  instrument.js
│       ├── voices.js   rhythm.js  msx.js
│       └── explore.js  reference.js
├── tools/
│   └── verify-core.mjs      # headless opll-core checks vs reference §12
├── design/ (this folder)
├── docs/    (reference cache — gitignored, see docs/SOURCES.md)
├── reference/opll-registers.md
├── README.md
└── LICENSE
```

---

## 2. Architecture

### Data flow

```
        user gesture (drag a slider, pick an instrument, press a key)
                     │
                     ▼
   ┌─────────────  store.js  ─────────────┐   ← the write-only register file
   │  regs[0x00..0x38]; set(); subscribe   │      00–38 is the ONE source of truth
   └───────┬───────────────────────┬───────┘      (a driver's shadow copy)
           │ notify                 │ postMessage({reg,val})
           ▼                        ▼
   panels/ + components/     audio.js → AudioWorklet
   (re-render from regs)      └ opll-worklet.js → opll-core.js  → speakers
           │
           ▼
   visualizer: a SECOND opll-core instance (main thread) stepped
   deterministically from the current registers to draw scopes / ADSR / harmonics.
```

Same key decision as the siblings: **the scopes do not read audio back**. They
re-render from a fresh, deterministic core run, avoiding `SharedArrayBuffer` +
COOP/COEP headers and giving stable, teachable waveforms.

### "One core, three contexts"

`opll-core.js` runs in **the window**, the **AudioWorkletGlobalScope**, and
**Node** (tests). Authored as a classic script (no module syntax), ending with:

```js
if (typeof globalThis !== 'undefined') globalThis.OpllCore = OpllCore;
if (typeof module !== 'undefined') module.exports = OpllCore;   // Node tests
```

The one intentional deviation from "everything is an ES module"; the price of
no-build AudioWorklet code sharing, isolated to a single file. As in the siblings.

### Why a register file, not a richer model

The PSG had 16 registers; the OPLL has ~64 write-only addresses (`00`–`38`). The
store holds them as a `Uint8Array(0x40)` — the exact shadow copy a real driver
keeps, since **the chip cannot be read back**. Benefits:

- The register inspector renders the file directly.
- The code view emits `OUT (7Ch)/(7Dh)` pairs straight from it.
- Instrument selection is *just a register* (`30`–`38` high nibble); the
  **instrument ROM lives in `opll-spec.js` as read-only data**, and the core
  resolves each channel's effective patch (user regs `00`–`07` vs a ROM entry) at
  render time. No patch state leaks into the store.

---

## 3. Core module specs

### `opll-core.js` — the synth (implement in full in Phase 1)

Faithful to [reference §12](../reference/opll-registers.md). Larger than the
siblings' cores (~400–500 lines) because FM + ADSR + rhythm is genuinely more
chip — the meta-plan's "scaling to complexity" note in practice.

```js
class OpllCore {
  constructor(clockHz = 3579545, sampleRate = 44100)
  reset()
  writeReg(addr, value)       // 0x00–0x38; updates derived operator/channel state
  process(out, frames)        // fill the mono audio buffer (9 voices, or rhythm)
  // --- introspection for the visualizer (NOT used for audio) ---
  snapshot()                  // per-channel: mod/car phase, env level+state, out
  renderViz(frames, ch)       // Float32 modulator, carrier, summed — for the scopes
  effectivePatch(ch)          // resolved 8-param patch (user regs or ROM) for panels
}
```

Must implement exactly (from reference §12): `fsam = clock/72`; the phase
increment `((F·2 + PM)·ml_table[ML]) << Block >> 2`; the `fullsin`/`halfsin`
tables and the log-sin→+attenuation→exp operator; **carrier volume ×4 (3 dB/step)
vs modulator TL (0.75 dB/step)**; the 7-bit / 0.375 dB envelope with `eg_step`
patterns; the **Key-On DAMP→ATTACK** transition; EG-type + per-channel SUS;
feedback; the one global LFO (AM/PM); and rhythm mode (`0E` bit5 → ROM patches
16–18 + noise LFSR, +3 dB). Instrument ROM read from `opll-spec.js`.

### `store.js` — single source of truth

```js
export const store = {
  regs: new Uint8Array(0x40),  // write-only register file 00–38
  clock: 3579545,
  set(addr, value),            // clamps, writes, emits {addr,value}
  get(addr), bit(addr, n),
  // convenience over set():
  setFnum(ch, f), setBlock(ch, b), keyOn(ch, on), setSustain(ch, on),
  setInstrument(ch, n), setVolume(ch, v),
  setUserPatchByte(i, v),      // 00–07
  loadPreset(obj),
  subscribe(fn) → unsub,
};
```

Each page subscribes once to fan out to: (1) `audio.postReg`, (2) each panel's
`onRegChange`, (3) the visualiser refresh.

### `opll-spec.js` — the knowledge layer

- `REGISTERS`: metadata for `00`–`38` (bit fields, labels, per-channel grouping)
  driving the register inspector + tooltips.
- `INSTRUMENT_ROM`: the 15 melodic + 3 rhythm patches as `Uint8Array`s (the
  emu2413 table, reproduced **as data, with attribution**), plus their names.
- `ML_TABLE`, `fullsin`/`halfsin` generators, `pm_table`, `am_table`,
  `eg_step_tables` — regenerated from their published definitions (formulae, not
  copied arrays where a formula exists).
- `noteToFnumBlock(midi)`, `fnumBlockToFreq(f,block)`, `freqToFnumBlock(hz)`,
  `envRateToSeconds(rate)`; `NOTE_TABLE` precomputed.
- `harmonics(wave)` → magnitudes (a plain DFT; no library).
- `decodePatch(bytes8)` → `{mod:{am,pm,eg,kr,ml,kl,tl,ws,fb,ar,dr,sl,rr}, car:{…}}`
  for the patch panel and the reference page.

### `audio.js`, `opll-worklet.js`, `loop.js`

Structurally identical to the siblings, with `{type:'reg',addr,value}` messages
and a `{type:'reset'}`. No mode message (single chip, no variant).

---

## 4. UI component specs (brief)

- ★ **operator-pair.js** `OperatorPair(canvas)` — modulator scope and carrier
  scope side by side, the **FM arrow** between them (thickness = modulation depth),
  the **feedback loop** on the modulator, and the live phase-offset overlay when
  "show internals" is on. The site's headline widget.
- ★ **adsr-view.js** `AdsrView(canvas)` `.setEnv(ar,dr,sl,rr,egType)` `.tick(state,level)`
  — the four segments drawn in the attenuation domain, the moving dot showing the
  live envelope, and the **Key-On damp** shown as the little pre-attack dip.
- ★ **harmonics.js** — a DFT of the carrier output, 16+ bars, updating as ML/TL/FB
  move. Retargeted from the SCC's `harmonics.js`.
- ★ **patch-panel.js** `PatchPanel(el, store)` — the 8 user bytes as labelled
  operator controls (two columns, mod/car), plus a **ROM gallery** row: pick 1–15,
  hear it, and a **"copy to user"** button that writes the ROM bytes into `00`–`07`.
- **scope.js**, **piano.js**, **signal-path.js**, **code-view.js** — as in the
  siblings, retargeted (piano maps note → `(fnum,block)`; code view emits the
  `OUT (7Ch)/(7Dh)` pairs).
- **register-inspector.js** — `00`–`38` as hex rows grouped by `REGISTERS`,
  two-way bound, `.setSpotlight(range)`. Labelled "write-only — this is the
  driver's shadow".

All components are dependency-free, canvas/SVG + the store. Theme colours from CSS
vars via `getComputedStyle`.

---

## 5. Build phases

Each phase is a **shippable vertical slice** with explicit acceptance criteria.
The DSP core is built **complete in Phase 1**; later phases only add UI. There are
more phases than the siblings — the OPLL earns them.

### Phase 0 — skeleton (½ day)
- `index.html` (single page for now), `css/styles.css` (sibling theme vars adapted
  to OPLL teal), favicon, README, MIT LICENSE, `.gitignore`. *(git already init'd
  in Phase R.)*
- **Accept:** page loads, themed light/dark, no console errors.

### Phase 1 — vertical slice: one operator, a sine, sounding (2–3 days)
- Implement **full** `opll-core.js` + `tools/verify-core.mjs`.
- `store.js`, `opll-spec.js`, `audio.js`, `opll-worklet.js`, `loop.js`.
- `components/scope.js`, `register-inspector.js`, `piano.js`; `panels/pitch.js`,
  `panels/master.js`. One voice, **carrier only, full sine, envelope forced open**
  so a plain tone sounds without the ADSR yet on-screen.
- **Accept:**
  - A key → the right pitch; **A4 → F-Number 290, Block 4 → 439.98 Hz**; scope
    shows a sine.
  - `verify-core.mjs` passes the §12 checklist (see §6).
  - Editing a byte in the register inspector moves the widgets (two-way binding).

### Phase 2 — the ADSR envelope (2 days)
- `components/adsr-view.js`; `panels/operator.js` (the AR/DR/SL/RR quarter, plus
  EG-type and the per-channel SUS bit); wire Key-On/Off from the piano.
- **Accept:** a note attacks/decays/sustains/releases audibly and the animator
  tracks it; percussive (EG=0) vs sustained (EG=1) differ; the **Key-On damp** is
  visible on the animator; higher notes run the envelope faster (KSR).

### Phase 3 — FM: the second operator ★ (3 days — the big one)
- `components/operator-pair.js`, `components/harmonics.js`; extend
  `panels/operator.js` to both operators; Multiple, TL depth, Feedback, the
  sine/half-sine WS bits.
- **Accept:** raising modulator TL/Multiple audibly and visibly enriches the
  carrier's harmonics; feedback adds its characteristic edge; a 2:1 Multiple ratio
  makes a clear bell; "show internals" reveals the phase offset the modulator
  injects; the harmonic bars move live.

### Phase 4 — the whole patch + the ROM gallery ★ (2 days)
- `opll-spec.js` `INSTRUMENT_ROM` + `decodePatch`; `components/patch-panel.js`;
  `presets.js`.
- **Accept:** the 8 user bytes drive the operators as one patch; selecting a ROM
  instrument (1–15) plays it; **"copy to user"** drops the ROM bytes into `00`–`07`
  and the same sound becomes fully editable; the gallery shows each instrument's
  harmonic fingerprint.

### Phase 5 — nine voices (1–2 days)
- `panels/channel.js` instantiated ×9; polyphony; per-channel instrument, volume,
  F-Number/Block, Key-On.
- **Accept:** a nine-note chord plays; each channel picks its own instrument and
  pitch independently; the register inspector shows `10–18`/`20–28`/`30–38`
  updating per channel.

### Phase 6 — rhythm mode (2 days)
- `panels/rhythm.js`; the noise LFSR + the fixed drum patches in the core; `0E`
  handling (rhythm-mode bit + the 5 key bits).
- **Accept:** toggling rhythm mode converts channels 7–9 into 5 drums; each drum
  triggers from its key bit; the bass/snare/tom/cymbal/hi-hat are distinct;
  channels 1–6 stay melodic; rhythm is audibly a touch louder (+3 dB).

### Phase 7 — the multi-page split (2–3 days)
- `js/shell.js` page registry + chrome; `components/signal-path.js`; the landing
  page; split the sandbox into the seven chain pages, each mounting only its
  widgets; per-page register spotlight + challenges.
- **Accept:** a first-time user can walk Tone → MSX; each page stands alone; the
  signal path navigates.

### Phase 8 — MSX context + reference + polish (2 days)
- `msx.html` + `components/code-view.js` (the `7Ch`/`7Dh` writes, the write-only
  shadow story, an FM-BIOS mention); `reference.html` (the register map, the full
  **instrument-ROM table decoded**, calculators incl. note↔(F-Number,Block), the
  OPL-family note); mobile/keyboard/a11y pass; cross-links to the PSG and SCC sites.
- **Accept:** the code view matches the current registers; every reference
  calculator agrees with `opll-spec.js`; the ROM table's decoded params match what
  the patch panel shows; usable on mobile and keyboard-only.

---

## 6. Testing & verification

**`tools/verify-core.mjs`** (Node, run manually) asserts `opll-core` against the
reference's §12 derived truths — a near-mechanical translation of that checklist:

1. `fsam = 3579545/72 ≈ 49715.9`; **F=290, Block=4 → 439.98 Hz**; Block+1 doubles
   the frequency; the phase-increment formula for a couple of anchors.
2. `ML_TABLE = {1,2,4,6,8,10,12,14,16,18,20,20,24,24,30,30}` (ML 0 → ×0.5).
3. `halfsin[x] == fullsin[x]` on the first half; the mute code on the second.
4. **Level scaling:** carrier volume `v` gives `3.0·v` dB; a modulator TL `t`
   gives `0.75·t` dB — assert both against the log→linear path.
5. **Envelope resolution:** 7-bit, `EG_STEP=0.375`, mute 127, `EG_MAX=123`;
   `SL_STEP=3.0`, `TL_STEP=0.75`.
6. **Rate:** `Rate_h = min(15, 4·field + (rks>>2))`; attack ≠ decay update law;
   a fast AR (15) reaches peak within one render window, a slow one does not.
7. **Key-On DAMP:** after Key-On the envelope first falls toward mute, then rises
   (attack) only once EG_MAX is reached — assert the level dips before it climbs.
8. **EG-type/SUS:** EG=1 holds at SL indefinitely; EG=0 keeps falling at RR after
   decay; the per-channel SUS bit changes the release slope only.
9. **Rhythm:** `0E` bit5 remaps ch7–9 to the 5 drums using ROM patches 16–18;
   melodic ch1–6 unaffected; rhythm output +3 dB.
10. **Instrument ROM:** `decodePatch(INSTRUMENT_ROM[n])` round-trips the `00`–`07`
    layout; instrument 0 uses the live user registers.
11. **A full-voice output invariant** pinning the whole chain: a chosen patch +
    note, rendered N samples, hits a fixed reference peak/RMS (the OPLL analogue of
    the SCC's DAC-range assertion). Establish the number once the core exists.

No unit-test framework (matches the siblings); keep the checks in `tools/`. Manual
A/B by ear against openMSX playing the same register writes / a real MSX-MUSIC
tune for the presets.

---

## 7. Open decisions (need a steer, but have sane defaults)

1. **Load real MSX-MUSIC music?** ~~Out of scope for v1.~~ *Default: same as the
   SCC — VGM yes as a stretch, KSS no.* VGM is a *log of register writes*, so a
   `js/vgm.js` reader that decodes the OPLL commands (`0x51`) into `writeReg` calls
   drops in almost for free once the store exists, and every widget reacts. KSS is
   an MSX program needing a Z80 + machine model (an emulator), which would bypass
   the chip model this site exists to expose — declined on the same two grounds as
   the SCC project. Generate `assets/demo.vgm` with a tool rather than ripping.
2. **VRC7 variant toggle?** *Default: no (confirmed).* It needs a second
   instrument ROM and dilutes the MSX focus. Note it in Reference as "a clone with
   different sounds"; revisit only if wanted later.
3. **How deep on rhythm?** The drum synthesis (noise LFSR + phase mixing) is
   fiddly. *Default: implement it faithfully in the core (it's in §12), but keep
   the Rhythm page focused on the 6+5 reinterpretation rather than the internal
   noise math.*
4. **Per-operator vs summed viz.** *Default: the core renders modulator, carrier
   and sum separately for the scope pair (needed for "show internals") and sums for
   audio — as the siblings render per-channel.*
5. **Instrument names.** Use Yamaha's manual names (Violin, Guitar, …). *Default:
   yes, with the raw ROM bytes shown alongside on the Reference page.*

## 8. Non-goals (explicit scope fence)

- Not a tracker, and not (in v1) a `.vgm`/`.kss`/`.mbm` player — see §7.1.
- Not MSX-AUDIO (the Y8950 / OPL): a different, richer chip. OPLL only.
- Not a machine emulator: we teach the `7Ch`/`7Dh` access on the MSX page, we
  don't emulate the Z80, the FM-BIOS, or the FM-PAC's SRAM.
- Not cycle-exact Z80↔OPLL bus timing — we model the chip, not the machine.
- No account/backend/telemetry — 100% client-side.
- No emulator code copied in; behaviour and published tables only (see §0).

---

### First commit target
Phase 0 + Phase 1 = a page where you **press a key and hear a clean FM operator's
sine**, with the write-only register file exposed — the whole pipeline proven end
to end. Everything after is additive: the envelope, the second operator (FM
itself), the patch, the voices, rhythm, and the MSX context.
