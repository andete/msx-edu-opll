# OPLL Playground

An interactive tour of the Yamaha **YM2413 (OPLL)**, the 2-operator FM chip behind
**MSX-MUSIC** (the FM-PAC cartridge and the built-in FM of MSX2+ / turboR). Watch
two operators modulate each other, shape an ADSR envelope, pick from the 15 ROM
instruments or build your own, and hear the result, all in the browser.

> **Status: complete.** All eight build phases plus the VGM tune player are done.
> The site is a landing page whose hero is the clickable, live **signal-path
> diagram**, and the seven-stage chain [Tone](tone.html) → [Envelope](envelope.html)
> → [FM](fm.html) → [Instrument](instrument.html) → [Voices](voices.html) →
> [Rhythm](rhythm.html) → [MSX](msx.html), plus [Explore](explore.html) (the full
> sandbox), [Reference](reference.html), and [Tune](tune.html). The [MSX](msx.html)
> page carries a live **code view** (the exact `OUT (7Ch)/(7Dh)` Z80 sequence for
> whatever the chip is doing); [Reference](reference.html) gives the register map,
> the eight patch bytes bit-by-bit, a **note ↔ (F-Number, Block) calculator**, the
> Multiple and level tables, and all 15 ROM instruments decoded with their harmonic
> fingerprints (nothing transcribed — every value is computed by the same
> `opll-spec.js` / `opll-core.js` the synth uses); and [Tune](tune.html) plays a
> **VGM** recording straight through the chip model — its `0x51` writes flow into
> the register file exactly as a slider's would, lighting every widget, while the
> **PSG drum track** (`0xA0`) is forwarded to a borrowed
> [msx-edu-psg](../msx-edu-psg/README.md) worklet and played alongside. No emulator
> anywhere: the audio is our own `opll-core.js` + `psg-core.js`. Everything is
> two-way bound to the write-only register file; the DSP core is guarded by
> `node tools/verify-core.mjs` (**52 checks**).

An emulator hides the chip behind a black box and a datasheet never makes a sound.
This site shows the chip's *internal signal path* instead — the phase generator,
the two FM operators with their log-sin/exp cores, the per-operator ADSR envelope,
the instrument ROM, rhythm mode and the 9-bit DAC — as things you can change while
it plays.

Part of the **msx-edu-\*** family; the shared recipe lives in
**[msx-edu-meta](../msx-edu-meta/META-PLAN.md)**:

- **[msx-edu-psg](../msx-edu-psg/README.md)** — the MSX1 AY-3-8910 PSG.
- **[msx-edu-scc](../msx-edu-scc/README.md)** — the Konami SCC wavetable chip.
- **msx-edu-opll** — *this repo*, the FM chip of MSX-MUSIC.

## What makes the OPLL interesting

- **2-operator FM.** Each of 9 voices is a *modulator* shaping a *carrier's*
  phase — the first properly *synthesised* chip in the family, after the PSG's
  fixed squares and the SCC's drawn wavetables.
- **15 sounds in ROM, 1 you build.** You mostly *pick* an instrument rather than
  design it, and the one user patch is where FM patch design is taught.
- **A real ADSR per operator** — attack, decay, sustain, release — with a Key-On
  "damp" quirk and key-scaled rates.
- **Rhythm mode** turns 3 melodic channels into 5 drums, driven by a noise LFSR.
- **Write-only registers** reached over I/O ports `7Ch`/`7Dh` — the driver keeps
  its own shadow, which is what our inspector models.

## Documentation (the design lives with the code)

- [reference/opll-registers.md](reference/opll-registers.md) — the chip spec
  (register map, the instrument ROM, pitch/FM/ADSR math, rhythm), distilled from
  Yamaha's application manual and cross-checked against emu2413 / openMSX.
- [design/site-outline.md](design/site-outline.md) — the intended site structure
  (the chain of focus pages, the sandbox, the widget toolbox).
- [design/build-plan.md](design/build-plan.md) — the phased implementation plan,
  following the [meta-plan](../msx-edu-meta/META-PLAN.md).
- [docs/SOURCES.md](docs/SOURCES.md) — the cached references (not committed; run
  [docs/fetch.sh](docs/fetch.sh) to populate them locally).

The synth will be **written from the documented behaviour** — emu2413 (MIT),
openMSX (GPL2) and MAME (BSD-3) are read as *specification*, never copied.

## License

[MIT](LICENSE) © 2026 Joost Yervante Damad.
