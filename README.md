# OPLL Playground

An **interactive, educational** tour of the Yamaha **YM2413 (OPLL)** — the
2-operator FM chip behind **MSX-MUSIC** (the FM-PAC cartridge and the built-in FM
of MSX2+ / turboR). Watch two operators modulate each other, shape an ADSR
envelope, pick from the 15 ROM instruments or build your own, and hear the
result — entirely in your browser.

> **Status:** **Phase 3 done** — **FM: the second operator**. From
> [index.html](index.html): press Play, hold a key, and sweep the modulator's
> **Multiple**, **Total level** and **Feedback** — hear the timbre change and watch
> the ★ **operator-pair** (modulator → the FM link → carrier, with a "show
> internals" view of the injected phase) and the live **carrier harmonic bars**. A
> 2:1 Multiple ratio rings like a bell. Pitch, both operators' envelopes, the FM
> timbre controls and the write-only register file are all two-way bound. The DSP
> core (`opll-core.js`) is guarded by `node tools/verify-core.mjs` (29 checks). Next
> phases add the patch/ROM gallery, nine voices, rhythm, the page split and the MSX
> context — see [design/build-plan.md](design/build-plan.md).

Unlike an emulator (which hides the chip behind a black box) or a datasheet
(which never makes a sound), this exposes the chip's *internal signal path* — the
phase generator, the two FM operators with their log-sin/exp cores, the per-operator
ADSR envelope, the instrument ROM, rhythm mode and the 9-bit DAC — as things you
can poke and observe.

Part of the **msx-edu-\*** family — the shared recipe lives in
**[msx-edu-meta](../msx-edu-meta/META-PLAN.md)**:

- **[msx-edu-psg](../msx-edu-psg/README.md)** — the MSX1 AY-3-8910 PSG.
- **[msx-edu-scc](../msx-edu-scc/README.md)** — the Konami SCC wavetable chip.
- **msx-edu-opll** — *this repo*, the FM chip of MSX-MUSIC.

## What makes the OPLL interesting

- **2-operator FM.** Each of 9 voices is a *modulator* shaping a *carrier's*
  phase — the first properly *synthesised* chip in the family, after the PSG's
  fixed squares and the SCC's drawn wavetables.
- **15 sounds in ROM, 1 you build.** The defining constraint: you mostly *pick* an
  instrument rather than design it — and the one user patch is where FM patch
  design is taught.
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
