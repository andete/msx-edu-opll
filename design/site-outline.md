# msx-edu-opll — site structure (rough outline)

Draft 2026-07-24. A first-pass structure for the interactive YM2413 (OPLL)
teaching site. Grounded in [reference/opll-registers.md](../reference/opll-registers.md)
and the family recipe kept outside this repo.

Sibling projects: **[msx-edu-psg](https://github.com/andete/msx-edu-psg)** (AY-3-8910) and
**[msx-edu-scc](https://github.com/andete/msx-edu-scc)** (Konami SCC). Same stack, same
principles, same look — but a genuinely different chip, and the outline below
diverges wherever the OPLL's architecture calls for it.

## Guiding principles (carried over)

1. **Expose the mechanism.** Every concept is taught by manipulating a *live*
   chip model and seeing + hearing the result — including the intermediate
   signals a black-box emulator hides: the modulator's own waveform, the phase it
   injects into the carrier, and each operator's ADSR envelope in flight.
2. **Progressive layering.** Follow the signal path: one operator → its envelope →
   two operators (FM) → a whole patch → nine voices → rhythm → the MSX context.
3. **One engine, many pages.** Focus pages and the free sandbox share one synth
   and one register model.
4. **Gotchas are lessons.** The Key-On "damp", the two level step-sizes, write-only
   registers, and rhythm mode reusing three melodic channels become "aha" moments.

### What makes this site different from the siblings

The PSG's interesting object was a *register byte*; the SCC's was a *drawn
32-point curve*. The OPLL's is a **two-operator FM voice and its ADSR envelope** —
the first *properly synthesised* chip in the family. That reshapes the site:

| | PSG site | SCC site | **OPLL site** |
|--|----------|----------|---------------|
| Star widget | register inspector | waveform editor + harmonics | **the FM operator pair + ADSR animator** |
| Hardest concept | active-low mixer | shared ch4/ch5 table | **phase modulation itself** |
| Timbre comes from | mixing tone + noise | the wave you draw | **modulator × carrier (FM)** |
| Amplitude over time | one envelope generator | the driver, 50×/s | **a full ADSR per operator** |
| Sounds are | built from registers | drawn | **15 in ROM + 1 you build** |
| Chip access | `OUT #A0/#A1` | bank-switch a cartridge | **`OUT (7Ch)/(7Dh)`** |

**Design decision (confirmed): user-patch first.** The site's spine is *building
an FM sound from the 8 user-instrument bytes*; the 15 ROM instruments are a
gallery to load, dissect, and copy into the user slot. This maximises the
teaching goal — the OPLL is the family's chance to teach FM synthesis — and turns
the fixed ROM from a limitation into "here's what someone else drew; now edit it."

**Design decision (confirmed): YM2413 only.** No VRC7 variant toggle in v1 (unlike
AY↔YM2149 and SCC↔SCC+); it would add a second instrument ROM and muddy the MSX
focus. Noted as a possible later addition.

---

## 1. Site map

```
/ (landing — animated signal path, click a block)
├── Tone        → one operator: a sine, its pitch (F-Number + Block), the formula
├── Envelope    → the ADSR per operator; Key-On/Off, the four phases, the damp quirk
├── FM          → the second operator: phase modulation, Multiple, depth, feedback ★
├── Instrument  → the 8-byte patch as a whole; build your own; the 15-ROM gallery ★
├── Voices      → nine channels, polyphony, per-channel instrument/volume/pitch
├── Rhythm      → the 6 + 5 drum mode and its noise generator
├── MSX         → the 7Ch/7Dh ports, the FM-BIOS, the actual Z80 writes
├── Explore     → the full sandbox (all nine voices + every editor)
└── Reference   → register map, the instrument ROM, calculators, sources
```

`Tone → Envelope → FM → Instrument → Voices → Rhythm → MSX` is the **chain**: each
focus page has prev/next navigation, and the landing page's signal-path diagram
jumps into it. Explore and Reference sit outside the chain.

This is a **longer chain than the siblings** (7 vs the SCC's 7 and PSG's 8-with-MSX)
because the OPLL genuinely has more signal-path stages — as the meta-plan's
"scaling to complexity" note predicts. Each page still teaches exactly one thing.

---

## 2. Landing page

- One-line hook: *"Two operators, one modulating the other — that's FM, and you
  can watch it happen."*
- **Hero = the animated signal-path diagram** (phase gen → modulator → carrier →
  ADSR → Σ → 9-bit DAC), each block clickable into its focus page.
- A single "make a sound now" button that plays a short FM phrase and lights up
  the path.
- Short framing: what the OPLL is, that it lived in the **FM-PAC** and built-in
  MSX-MUSIC, and why 2-operator FM is a great, small place to *finally understand
  FM synthesis*.
- Links across to the PSG and SCC sites — the three chips are the MSX's sound
  family; a machine with MSX-MUSIC still has its PSG, and often an SCC cartridge
  too.

---

## 3. The chain — one page per stage

Each page: **short explanation → the widgets that stage needs → the live register
bytes behind it**. Every page has the scope, a keyboard, and a collapsible
register inspector spotlighting its own addresses.

| # | Page | Core idea | Registers | Widget introduced |
|---|------|-----------|-----------|-------------------|
| 1 | **Tone** | one operator = a sine; `f = F·fsam/2^(19−Block)`; Multiple | `10–18`, `20–28` | **operator scope**, period/note readout, piano |
| 2 | **Envelope** | ADSR per operator; Key-On damp→attack→decay→sustain→release | `04–07` | **ADSR animator** (the envelope in flight) |
| 3 | **FM** ★ | modulator phase-modulates carrier; Multiple ratio, TL depth, feedback, sine/half-sine | `00–03` | **two-operator view + harmonic bars** |
| 4 | **Instrument** ★ | the 8 user bytes as one patch; then the 15 ROM patches to load & copy in | `00–07`, `30–38` | **patch panel + ROM gallery** |
| 5 | **Voices** | nine FM voices; per-channel instrument + volume + pitch; polyphony | `10–18`,`20–28`,`30–38` | 9-channel strip |
| 6 | **Rhythm** | `0E` bit5 → 6 melodic + 5 drums, driven by a noise LFSR | `0E`, `36–38` | rhythm pad + noise view |
| 7 | **MSX** | write-only regs over `7Ch`/`7Dh`; FM-BIOS; the shadow copy | — | **code view** (Z80) |

Page mechanics:

- **"Show internals" toggle** on the scope: reveal the modulator's own output, the
  phase offset it injects into the carrier, and the carrier phase before/after
  modulation — the core FM idea made visible.
- **Self-checking challenges** ("make a bell with a 2:1 modulator", "give it a
  slow attack", "tune ch1 to 440 Hz", "turn a piano into an organ by hand") — the
  engine detects success.
- **Register spotlight**: the inspector dims everything except the bytes the page
  is about, so the link from knob to byte is never abstract.

### Why "Tone" before "FM"

You cannot teach phase modulation until a single operator making a plain sine is
familiar. Page 1 runs the carrier alone at full volume (modulator silent), so the
scope shows a clean sine and the pitch formula stands on its own. FM (page 3) then
*adds* the modulator to something the visitor already understands.

---

## 4. Explore — the sandbox

All nine voices available, laid out along the signal path, with one voice expanded
into the full FM editor at a time:

```
┌ VOICE 1 (expanded) ───────────────────────────────────┐   ┌ voices 2–9 ┐
│  ┌ modulator ┐   FM→   ┌ carrier ┐                     │   │ ch2 ▸ inst │
│  │ ~~ scope  │ ──────► │ ~~ scope│ ──► ▁▃▅▇ harmonics  │   │ ch3 ▸ inst │
│  │ ADSR ◢◣   │         │ ADSR ◢◣ │                     │   │ …          │
│  └───────────┘         └─────────┘                     │   │ ch9 ▸ inst │
│  ML  TL  FB  WS   │   AR DR SL RR   │  F-Num  Block     │   └────────────┘
│  [ instrument ▾ user | 1…15 ]   volume ▮▮▮   [key]     │
└───────────────────────────────────────────────────────┘
        └──────────────── Σ ──► 9-bit DAC + scope ──► ▶ play ─────┘
   ┌ Rhythm 6+5 ┐   ┌ Presets ┐   ┌ Register inspector (00–38, spotlightable) ┐
```

- **Register inspector** docked along the bottom: the write-only register file
  `00`–`38` as hex, grouped and labelled, two-way bound (drag a slider → bytes
  update; edit a byte → the widget updates). It *is* the driver's shadow copy.
- **Preset library**: a few full-machine patches to load and dissect — an FM bell,
  a bass, a brass stab, a drum kit, a two-voice pad.
- **Code view**: the `OUT (7Ch)/(7Dh)` sequence that would produce the current
  state.

---

## 5. Reference (thin, but useful)

- The register map + formulas rendered from
  [opll-registers.md](../reference/opll-registers.md).
- **The instrument ROM**: all 15 patches with their 8 bytes decoded into
  operator parameters, each playable, each with its harmonic fingerprint.
- **Interactive calculators**: note → (F-Number, Block), (F-Number, Block) →
  frequency, envelope-rate → time, and the Multiple table.
- **The two families side by side**: OPLL vs OPL/OPL2 (why OPLL is the cut-down
  one), and a note on the VRC7 clone.
- Sources, with links to the Yamaha manual, the MSX Wiki, emu2413 and openMSX.

---

## 6. Reusable components (the widget toolbox)

Shared by every page — build once. Starred ones have no PSG/SCC counterpart.

- ★ **Operator scope pair** — modulator + carrier time-domain views with the
  modulation link and the feedback loop drawn between them.
- ★ **ADSR animator** — the four-phase envelope drawn and animated in the
  attenuation domain, with the Key-On damp shown; one per operator.
- ★ **Harmonic view** — a DFT of the *carrier output*, updating as Multiple/TL/FB
  change; the "what FM is doing to the timbre" payoff (kin to the SCC's, retargeted).
- ★ **Patch panel** — the 8 user bytes as labelled operator controls, plus the
  ROM gallery to load a named instrument and copy it into the user slot.
- **Oscilloscope** — the summed output, with intermediate-signal taps.
- **Register inspector** — the write-only `00`–`38` file, two-way bound, spotlightable
  (the OPLL's answer to the PSG's register inspector, bigger and sparser).
- **Signal-path diagram** — animated, click-to-focus, hero + navigator.
- **Piano keyboard** — note ↔ (F-Number, Block) mapping.
- **Code view** — the equivalent `OUT (7Ch)/(7Dh)` Z80 sequence.

---

## 7. Technical architecture (sketch)

Identical in shape to the sibling projects — that stack is proven, and sharing it
keeps the three sites one family.

- **Audio engine:** an **AudioWorklet** running our own OPLL synth, matching the
  behaviours in [§12 of the reference](../reference/opll-registers.md). Written
  from the documented behaviour and the emu2413 tables (read as spec), **not**
  ported from emulator code.
- **Single source of truth:** the **write-only register file** `00`–`38` (~64
  bytes) as a `Uint8Array`, exactly as a real driver's shadow copy — the OPLL
  analogue of the PSG's 16-register array, just larger and sparser. The
  **instrument ROM is read-only reference data** in `opll-spec.js`, not store
  state; the core resolves each channel's effective patch (user regs vs ROM) from
  the register file.
- **Visualisation layer:** a *second* synth instance on the main thread, stepped
  deterministically — no `SharedArrayBuffer`, no COOP/COEP headers, stays a plain
  static site. Same trick as the siblings.
- **Stack:** no framework, no bundler, no dependencies. Static and client-side.
  Theme-aware (light/dark), keyboard-accessible, works on mobile.
- **Clock:** fixed at **3 579 545 Hz**; the generator runs at `fsam = fMASTER/72
  ≈ 49 716 Hz`. No second clock worth exposing.
- **Accent colour:** a new one distinct from PSG-violet and SCC-red/amber — a
  **teal / cyan** reading, evoking the FM-PAC's blue livery, so the three sites are
  instantly distinguishable.

---

## 8. Suggested build order (MVP-first)

Mirrors the chain; each step is a shippable vertical slice. (Detailed in
[build-plan.md](build-plan.md).)

1. **Vertical slice:** engine + one carrier operator (a sine) + scope + register
   inspector + piano. Proves UI → model → worklet → audio + viz.
2. The ADSR envelope on that operator (+ the animator).
3. The modulator: full 2-operator FM (+ the star pair-view and harmonics).
4. The whole patch: the 8 user bytes + the ROM gallery / copy-to-user.
5. Nine voices (polyphony) — then rhythm mode.
6. Split into the multi-page site: landing + signal path + focus pages.
7. MSX context: the ports and the code view; Reference page; polish.

Everything after step 1 is additive — the engine and component contracts are
fixed early, so pages layer on without rework.
