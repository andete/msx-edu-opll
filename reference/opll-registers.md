# Yamaha YM2413 (OPLL) — register reference

Distilled from **Yamaha's YM2413 Application Manual**
([local copy](../docs/datasheets/yamaha_ym2413_application_manual.pdf)) — the
manufacturer's own spec — cross-checked against the **MSX Wiki** pages for
[MSX-MUSIC](../docs/web/msxwiki-MSX-MUSIC.html),
[MSX-MUSIC programming](../docs/web/msxwiki-MSX-MUSIC-programming.html) and the
[YM2413](../docs/web/msxwiki-YM2413.html), and — for the exact behavioural detail
the manual leaves vague (envelope rates, the operator's log-sin/exp math, the
DAC) — against **emu2413**, Mitsutaka Okazaki's reference core
([`emu2413.c`](../docs/src/emu2413.c)), which is also what **openMSX** ships
([`YM2413Okazaki.cc`](../docs/src/openmsx-YM2413Okazaki.cc)). **NukeYKT**
([`YM2413NukeYKT.cc`](../docs/src/openmsx-YM2413NukeYKT.cc)) — a die-shot-accurate
core — and **MAME/ymfm** are the tie-breakers. Points marked **[emu2413]** come
from that code and override the manual where they disagree; see §12 for the
consolidated implementation notes the verifier checks.

> **Naming — read this first.**
>
> - **OPLL** = *FM Operator Type-LL*, Yamaha's cost-reduced FM chip. The MSX part
>   is the **YM2413**; the near-identical Konami clone is the **VRC7** (different
>   instrument ROM, no rhythm). This document says **OPLL** for the behaviour and
>   **YM2413** for the MSX chip.
> - **MSX-MUSIC** is the *standard* (the chip + the FM-BIOS + the `7Ch/7Dh`
>   ports); the **FM-PAC** is Panasonic's cartridge that provides it. Don't
>   confuse MSX-MUSIC (OPLL) with **MSX-AUDIO** (the Y8950, an OPL derivative — a
>   different, richer chip). This site is OPLL only.
> - **Two operators, not two channels.** Each of the 9 voices is **one carrier +
>   one modulator** FM pair. "9 channels" means 9 such pairs (18 operators).
> - **You mostly don't draw a patch.** 15 of the 16 instruments are a **fixed ROM**;
>   only instrument **0** is user-definable. This is the chip's defining
>   constraint and the opposite of the SCC's draw-everything model.

---

## 1. Signal path (the chip in one diagram)

```
                       fMASTER = 3 579 545 Hz            fsam = fMASTER / 72
                             │                                ≈ 49 715.9 Hz
   one voice (×9) ───────────┼──────────────────────────────────────────────
                             ▼
     F-Number (9 bit) ┌──────────────┐   Block (3 bit, octave)
        ──────────────► phase gen.   ├── << Block ──►  phase accumulator
                       │ ×Multiple ML │                     │
      LFO PM (vibrato)─┤              │                     ▼
                       └──────────────┘             ┌───────────────┐
                                                    │  MODULATOR op │  sine / half-sine
                              feedback (FB) ───────►│  log-sin + exp│  (WS bit)
                                                    └──────┬────────┘
                                                           │ phase-modulates
                                                           ▼
                                                    ┌───────────────┐
                                                    │  CARRIER op   │
                                                    │  log-sin + exp│
                                                    └──────┬────────┘
                                                           │
   each op: × ADSR envelope (attack/decay/sustain/release), + KSL, + TL/volume,
            + LFO AM (tremolo)                              │
                                                           ▼
                              9 carriers ──────►  Σ  ──►  9-bit floating DAC  ──► mono out
                                (rhythm mode: 6 melodic voices + 5 drums)
```

The interesting object is neither a register byte (PSG) nor a drawn curve (SCC):
it is the **two-operator FM pair and its ADSR envelope**. That is what the site
must expose.

---

## 2. The chip at a glance

| | |
|--|--|
| Synthesis | 2-operator FM (phase modulation), 1 sine + 1 half-sine waveform per op |
| Voices | **9** melodic, **or** 6 melodic + **5 rhythm** (bass drum, snare, tom, cymbal, hi-hat) |
| Instruments | **1 user** patch + **15 fixed ROM** patches |
| Envelope | **ADSR** per operator (attack, decay, sustain level, release), key-scaled |
| Modulation | one global **LFO**: AM (tremolo, 1.27 Hz) + PM (vibrato, 6.4 Hz) |
| Pitch | 9-bit **F-Number** + 3-bit **Block** (octave); `fsam = fMASTER/72` |
| Level | carrier **volume** 4-bit @ 3.0 dB; modulator **TL** 6-bit @ 0.75 dB |
| Output | single **mono** 9-bit floating-point DAC (no per-channel outputs on the pin) |
| Clock | **3.579545 MHz** (the MSX colour-burst crystal) |
| Registers | write-only, **~64 addresses** via a latch/data port pair |

---

## 3. Register map

The OPLL has one **address latch** and one **data** port; registers are
**write-only** (you cannot read the chip back — the app's inspector models a
shadow copy, exactly as a real driver must). Addresses:

| Addr | Bits `7…0` | Purpose |
|------|-----------|---------|
| `00` | `AM PM EG KR MMMM` | **User inst — modulator**: AM, PM(vibrato), EG-type, KSR, Multiple |
| `01` | `AM PM EG KR MMMM` | **User inst — carrier**: same fields |
| `02` | `KK TTTTTT` | **User inst — modulator**: KSL(2), Total Level(6) |
| `03` | `KK ·· D C FFF`* | **User inst — carrier**: KSL(2), carrier waveform (C), modulator waveform (D), Feedback(3) |
| `04` | `AAAA DDDD` | **User inst — modulator**: Attack rate(4), Decay rate(4) |
| `05` | `AAAA DDDD` | **User inst — carrier**: Attack rate, Decay rate |
| `06` | `SSSS RRRR` | **User inst — modulator**: Sustain level(4), Release rate(4) |
| `07` | `SSSS RRRR` | **User inst — carrier**: Sustain level, Release rate |
| `0E` | `·· R  BSTCH` | **Rhythm**: bit5 rhythm-mode; bit4 BD, bit3 SD, bit2 TOM, bit1 CYM, bit0 HH key |
| `0F` | — | (test register — leave 0) |
| `10`–`18` | `FFFFFFFF` | **F-Number low 8 bits**, channels 1–9 |
| `20`–`28` | `·· S K BBB F` | per channel: bit5 **Sustain**, bit4 **Key-On**, bits3–1 **Block**, bit0 **F-Number bit 8** |
| `30`–`38` | `IIII VVVV` | per channel: **Instrument** select(4, hi), **Volume**(4, lo) |

\* `03` layout, MSB→LSB: `KSL KSL — DC DM FB FB FB`, where **DC** = carrier
waveform select, **DM** = modulator waveform select (0 = full sine, 1 = half
sine), **FB** = modulator self-feedback depth (0–7).

Channels are numbered **1–9** in Yamaha's manual; emu2413 indexes them **0–8**,
and each channel *c* owns operators (modulator = slot `2c`, carrier = slot
`2c+1`).

---

## 4. The instrument ROM (why the OPLL sounds like the OPLL)

Instrument select (`30`–`38` high nibble):

- **`0`** → the **user** patch in registers `00`–`07` (the only editable one).
- **`1`–`15`** → a **fixed ROM** patch. The player picks a *name*, not a sound to
  build.

The 15 melodic ROM patches (Yamaha's names):

| # | Instrument | # | Instrument | # | Instrument |
|---|------------|---|------------|---|------------|
| 1 | Violin | 6 | Oboe | 11 | Harpsichord |
| 2 | Guitar | 7 | Trumpet | 12 | Vibraphone |
| 3 | Piano | 8 | Organ | 13 | Synth. Bass |
| 4 | Flute | 9 | Horn | 14 | Acoustic Bass |
| 5 | Clarinet | 10 | Synthesizer | 15 | Electric Guitar |

Each patch is **8 bytes** in exactly the `00`–`07` layout above. The canonical
byte values are the table in [`emu2413.c`](../docs/src/emu2413.c) (originally
Okazaki's measurements of a real YM2413; entries 16–18 are the three rhythm
patches). **These bytes are facts about the hardware and may be reproduced with
attribution** — they belong in `js/opll-spec.js` as `INSTRUMENT_ROM`. The *code*
that reads them may not be copied (§0 licensing rule).

> **Teaching hook.** The killer demo is: select ROM instrument 3 (Piano), copy
> its 8 bytes into the *user* slot, and watch the identical sound become fully
> editable — the ROM is demystified as "just a patch someone else drew."

---

## 5. Pitch — F-Number, Block and Multiple

The phase generator advances at `fsam = fMASTER / 72 ≈ 49 715.9 Hz`. For an
operator with Multiple ML (see below):

```
f_operator = Multiple × F-Number × fsam / 2^(19 − Block)
```

For the **fundamental** (Multiple = 1) the voice pitch is:

```
f_tone = F-Number × fsam / 2^(19 − Block)            F-Number: 9-bit (0–511)
                                                     Block:    3-bit octave (0–7)
```

Inverting, to place a note:

```
F-Number = f_tone × 2^(19 − Block) / fsam
```

**Anchor (used by the verifier): F-Number = 290, Block = 4, ML = 1 → 439.98 Hz**
(≈ A4). Each Block step doubles the pitch for the same F-Number; you raise
F-Number within a Block until it approaches 511, then step Block and halve
F-Number. **[emu2413]** the per-sample phase increment is
`((F-Number×2 + PM) × ml_table[ML]) << Block >> 2`, accumulated in a 19-bit phase
whose top 10 bits index a 1024-point wave table.

**Multiple (ML, 4-bit)** multiplies an operator's frequency relative to the
voice's F-Number — this is how FM builds harmonic ratios between modulator and
carrier. The table (register value → multiple):

| ML | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|----|---|---|---|---|---|---|---|---|---|---|----|----|----|----|----|----|
| ×  | ½ | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 10 | 12 | 12 | 15 | 15 |

(Note 11 and 13 repeat their predecessors — no ×11, ×13, ×14 exist.)

---

## 6. The FM operator (log-sin + exp, feedback, modulation)

Each operator computes a sine of its phase, in the **log domain** to make the
final `×envelope` a cheap add:

1. **Phase → log-sin.** The phase's top bits index a quarter-sine lookup that
   returns **−log₂(sin)** scaled by 256 (`fullsin_table`); the half-sine waveform
   (`WS` bit) clamps the negative half to zero (`halfsin_table`). This is the
   only "waveform" choice — there is no drawable table.
2. **Add attenuation.** The envelope level, KSL, and TL/volume are all in the
   same log units and simply **add** to the log-sin value.
3. **exp back to linear.** An exp table converts the summed log attenuation to a
   signed linear sample.
4. **Modulation.** The **modulator's** linear output is fed into the **carrier's**
   phase as a phase offset (this *is* the "FM"). The modulator can also feed
   **back into its own** phase, depth set by **FB** (0–7); FB = 0 is no feedback.

Only the **carrier** reaches the DAC; the modulator is audible only through what
it does to the carrier's phase. Exposing the modulator's own waveform, and the
modulation index, is the site's central "show the internals" move.

---

## 7. The ADSR envelope (per operator)

Every operator has its own **Attack → Decay → Sustain → Release** envelope,
working in the **attenuation** (log) domain: 0 = full volume, rising to silence.

| Field | Bits | Meaning |
|-------|------|---------|
| **AR** Attack Rate | 4 | how fast it rises to peak on Key-On (15 = instant) |
| **DR** Decay Rate | 4 | fall from peak down to the sustain level |
| **SL** Sustain Level | 4 | the level decay stops at — **3.0 dB/step** (0–45 dB) |
| **RR** Release Rate | 4 | fall to silence after Key-Off |
| **EG** (env type) | 1 | 0 = *percussive* (after decay, fall at RR); 1 = *sustained* (hold at SL until Key-Off) |
| **KR** (KSR) | 1 | key-scale rate: higher notes run the envelope faster |
| **SUS** (reg `2x` bit5) | 1 | per-channel "sustain" — on Key-Off, release at a fixed slow rate instead of RR |

**[emu2413] the internals the verifier pins:**

- The envelope counter is **7-bit**, one step = **EG_STEP = 0.375 dB**; mute is
  127, and attack ends / decay begins at **EG_MAX = 123**.
- The **effective rate** is `Rate_h = min(15, 4·field + (rks >> 2))`, `rks` being
  the key-scale value from Block/F-Number and KSR; the low 2 bits pick a pattern
  from `eg_step_tables` (**"based on andete's research"** — the increment is not a
  clean power of two).
- Attack is **exponential-ish** and computed differently from decay/release
  (which are linear in the log domain).
- **Key-On does not start at attack**: the operator first **DAMPs** (fast fall to
  silence) so the phase can reset cleanly, *then* attacks — the DAMP→ATTACK
  transition fires when the envelope reaches EG_MAX.

There is **no separate sustain-rate register** (unlike OPL2): "sustain" here is
just "hold at SL", and the per-channel SUS bit only changes the *release* slope.

---

## 8. Levels — KSL, TL, volume, and the two step sizes

Three attenuations add in the log domain before the exp:

- **Volume** (`30`–`38` low nibble, 4-bit) sets the **carrier** level.
  **[emu2413]** the register value is taken `×4` into 6-bit TL units, i.e.
  **3.0 dB/step**, 0–45 dB. Volume 15 = quietest, 0 = loudest.
- **TL** (Total Level, `02`/patch, 6-bit) sets the **modulator** level at
  **0.75 dB/step**, 0–47.25 dB. On the carrier, TL is not used — the volume
  register replaces it — so TL is a *modulator-only* control that sets the FM
  depth/timbre.
- **KSL** (Key Scale Level, 2-bit) attenuates higher notes so an instrument gets
  quieter as it goes up the keyboard (0 = off; 1.5/3.0/6.0 dB per octave).

The mismatch — carrier in 3 dB steps, modulator in 0.75 dB steps — is a real
gotcha worth a callout.

---

## 9. Rhythm mode

Writing **bit 5 of register `0E`** turns channels **7, 8, 9 into 5 percussion
instruments**, leaving channels 1–6 melodic:

| Drum | Uses | Key bit (`0E`) |
|------|------|----------------|
| Bass Drum | ch 7 (both ops) | bit 4 |
| Snare Drum | ch 8 carrier | bit 3 |
| Tom-Tom | ch 9 modulator | bit 2 |
| Top Cymbal | ch 9 carrier | bit 1 |
| Hi-Hat | ch 8 modulator | bit 0 |

The drums use **fixed ROM patches 16–18** and a **noise generator** (an LFSR)
mixed with specific operator phases for the metallic sounds (hi-hat, cymbal).
Rhythm channels are output at **+3 dB** relative to melodic ones **[emu2413]**.
Their pitches are fixed by the driver writing F-Numbers to ch 7/8/9 as usual.

---

## 10. The LFO (one global modulator)

A single LFO drives every operator that opts in:

- **AM (tremolo)** — `am_table`, depth ≈ 4.8 dB, rate ≈ **1.27 Hz**. Enabled per
  operator by the **AM** bit.
- **PM (vibrato)** — `pm_table`, depth ≈ 14 cents, rate ≈ **6.4 Hz**. Enabled per
  operator by the **PM** bit; it offsets the F-Number feeding the phase generator
  (see §5's increment formula).

Both are **fixed depth and rate** — the only choice is on/off per operator.

---

## 11. How the Z80 reaches the OPLL on MSX

MSX-MUSIC exposes two **I/O ports** (not memory-mapped, unlike the SCC):

| Port | Direction | Use |
|------|-----------|-----|
| `7Ch` | write | **address latch** — which register to write next |
| `7Dh` | write | **data** — the value for the latched register |

```asm
        ld      a,#30           ; select register 30h (ch1 inst/volume)
        out     (#7C),a
        ld      a,#10           ; instrument 1 (Violin), volume 0 (loudest)
        out     (#7D),a         ; ... then set F-Number, Block, Key-On via 10h/20h
```

**Write timing matters:** after the address write the chip needs a short settle
(the manual specifies a minimum; drivers insert a few `nop`s or reuse the
natural instruction gap). The chip is **write-only** — a driver keeps its own
shadow of all registers, which is exactly what the app's inspector is.

**FM-BIOS.** MSX-MUSIC machines carry an FM-BIOS with entry points and a
MSX-BASIC extension (`CALL MUSIC`, then `PLAY` with the FM voices) — worth a
mention on the MSX page, but the port-level writes are the honest story.

**Detection.** MSX-MUSIC is found by locating the "APRLOPLL" ROM signature and
its FM-BIOS, not by probing the chip (which can't be read).

---

## 12. emu2413-verified implementation notes

The behaviours `js/opll-core.js` must reproduce, each written as an assertable
truth for `tools/verify-core.mjs`. From [`emu2413.c`](../docs/src/emu2413.c),
cross-checked against openMSX's `YM2413Okazaki` and NukeYKT.

1. **Clock & sample rate.** `fMASTER = 3 579 545 Hz`; the generator runs at
   `fsam = fMASTER / 72 ≈ 49 715.9 Hz`. All envelope and LFO rates are relative
   to `fsam`.
2. **Pitch formula.** `f_tone = F-Number × fsam / 2^(19−Block)` for Multiple 1;
   assert **F=290, Block=4 → 439.98 Hz**, and that raising Block by 1 doubles the
   frequency. Per-sample phase increment is
   `((F×2 + PM) × ml_table[ML]) << Block >> 2`.
3. **Multiple table.** `ml_table = {1,2,4,6,8,10,12,14,16,18,20,20,24,24,30,30}`
   (these are ×2 the audible multiple, so ML 0 → ×0.5, ML 1 → ×1).
4. **Operator waveforms.** Two only: full sine and half-sine (negative half
   clamped to 0), selected by the WS bits in register `03`. Assert `halfsin[x] =
   fullsin[x]` for the first half and the mute code for the second half.
5. **Log/exp operator.** Attenuations (envelope + KSL + TL/volume) add in
   `−log₂(sin)·256` units, then a single exp converts to a signed linear sample;
   only the carrier is summed to output.
6. **Envelope resolution.** 7-bit counter, `EG_STEP = 0.375 dB`, mute = 127,
   `EG_MAX = 123`. `SL_STEP = 3.0 dB` (4-bit), `TL_STEP = 0.75 dB` (6-bit).
7. **Carrier volume scaling.** The 4-bit volume register is `×4` into TL units →
   **3.0 dB/step**; the modulator TL is the raw 6-bit value → **0.75 dB/step**.
   Assert both against a known attenuation.
8. **Envelope rate.** `Rate_h = min(15, 4·field + (rks>>2))`; the low 2 bits of
   `rks` index `eg_step_tables[…][…]` for the increment pattern. Attack uses a
   different (exponential) update than decay/release.
9. **Key-On DAMP.** Key-On forces a fast DAMP to silence first, then transitions
   to ATTACK when the envelope reaches EG_MAX — not an immediate attack from the
   current level.
10. **EG type & SUS.** `EG=1` holds at the sustain level until Key-Off; `EG=0`
    keeps falling at RR. The per-channel `2x` SUS bit changes only the release
    slope.
11. **Rhythm mode.** `0E` bit5 remaps channels 7–9 to 5 drums using ROM patches
    16–18 plus a noise LFSR; rhythm output is `+3 dB`. Melodic channels 1–6 are
    unaffected.
12. **LFO.** One global LFO: AM ≈ 1.27 Hz / ~4.8 dB (`am_table`), PM ≈ 6.4 Hz /
    ~14 cents (`pm_table`), each enabled per operator by its AM/PM bit.
13. **Write-only + settle.** Registers cannot be read back; a `7Ch` address write
    then a `7Dh` data write, with a settle gap. The model keeps a shadow copy.
14. **Instrument ROM.** Instrument 0 = user (`00`–`07`); 1–15 = fixed ROM patches;
    the ROM bytes are the emu2413 table (reproduced as data, with attribution).

> emu2413's resampler (`sinc_table`, `windowed_sinc`) and its rate converter are
> emulator plumbing for arbitrary output rates, **not** chip behaviour — our core
> renders at `fsam` and resamples with the WebAudio graph, so ignore them.

---

## 13. Implications for the app (design notes)

- **The star widget is the FM pair, not a byte grid.** Two operator scopes
  (modulator + carrier), the modulation arrow between them, the feedback loop,
  and an **animated ADSR envelope** on each — this is what a black box hides and
  what has no PSG/SCC counterpart. The register inspector demotes to a supporting
  role.
- **The ROM-instrument tension is the hook.** 15 sounds you *pick* vs 1 you
  *build*. The "copy a ROM patch into the user slot and edit it" move turns the
  fixed ROM from a limitation into a lesson in FM patch design.
- **ADSR is a whole chapter.** Unlike the SCC (no envelope, driver does it) and
  the PSG (one shared envelope generator), the OPLL gives every operator its own
  ADSR — a natural page, with the Key-On DAMP quirk as a "gotcha".
- **FM itself needs teaching.** Most visitors will not know phase modulation.
  Modulator-frequency-ratio (via Multiple) and modulation-depth (via TL/FB)
  sweeps, shown on the carrier scope + a live harmonic view, carry that.
- **Rhythm mode** is the OPLL's equivalent of the SCC's shared-waveform twist:
  the same 9 channels reinterpreted as 6 + 5 drums.
- **Gotchas as lessons:** the two level step-sizes (§8), the Key-On DAMP (§7),
  write-only registers (§11), and no ×11/×13/×14 in the Multiple table (§5).
- **Access story:** `OUT (7Ch)/(7Dh)` replaces the PSG's `#A0/#A1` and the SCC's
  mapper unlock in the code-view panel — simpler than the SCC, and a clean
  contrast to show alongside both siblings.
- **Variant toggle candidate:** YM2413 ↔ **VRC7** (different ROM, no rhythm),
  mirroring AY↔YM2149 and SCC↔SCC+. Decide in the build-plan.
