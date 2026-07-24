# OPLL reference documentation — local cache

Cached **2026-07-24** for the `msx-edu-opll` interactive educational project.
Everything here was fetched once and stored locally so we don't hit the network
again while working. Re-run [`fetch.sh`](fetch.sh) to refill any missing file
(it skips whatever is already present).

> **Note:** the cached files themselves (`web/`, `datasheets/`, `src/`) are **not
> committed** — they are third-party pages, a Yamaha manual, and GPL/BSD/MIT
> emulator source, so we cite and link the originals below rather than
> redistribute them. They are `.gitignore`d; run [`fetch.sh`](fetch.sh) to
> populate them locally. The per-file links below therefore only resolve after
> you have fetched.

Chip focus: the **Yamaha YM2413 (OPLL)** — the 2-operator FM chip behind
**MSX-MUSIC** (the FM-PAC cartridge and the built-in FM of MSX2+/turboR). Unlike
the SCC, the OPLL **is** documented: Yamaha published an application manual, and
the chip has been reverse-engineered down to the die.

## Primary documentation (`web/` + `datasheets/`) — start here

| Local file | Source URL | What it is | Why it matters |
|------------|-----------|------------|----------------|
| [yamaha_ym2413_application_manual.pdf](datasheets/yamaha_ym2413_application_manual.pdf) | <https://map.grauw.nl/resources/sound/yamaha_ym2413_frd1x.pdf> | **Yamaha's YM2413 Application Manual** (English translation) | The manufacturer's own description: the register map, the 15-instrument ROM, the FM operator, the ADSR envelope, rhythm mode, and the frequency/`F-Number`/`Block` math. Ground truth for everything a datasheet can state. |
| [msxwiki-MSX-MUSIC.html](web/msxwiki-MSX-MUSIC.html) | <https://www.msx.org/wiki/MSX-MUSIC> | MSX Wiki — **MSX-MUSIC** | The system context: what MSX-MUSIC is, which machines/cartridges provide it, and how it relates to MSX-AUDIO (the OPL-based Y8950, a different chip). |
| [msxwiki-MSX-MUSIC-programming.html](web/msxwiki-MSX-MUSIC-programming.html) | <https://www.msx.org/wiki/MSX-MUSIC_programming> | MSX Wiki — **programming** MSX-MUSIC | The other half of the story: the I/O ports (`7Ch`/`7Dh`), the write timing, and the FM-BIOS entry points — how a Z80 actually reaches the chip. |
| [msxwiki-FM-PAC.html](web/msxwiki-FM-PAC.html) | <https://www.msx.org/wiki/FM-PAC> | MSX Wiki — **FM-PAC** | The most common way real MSX users met the OPLL: Panasonic's cartridge, its SRAM, and its slot/BIOS behaviour. |
| [msxwiki-YM2413.html](web/msxwiki-YM2413.html) | <https://www.msx.org/wiki/Yamaha_YM2413> | MSX Wiki — the **chip** | Chip identity, specs, pinout, and the OPLL family (YM2413 vs the VRC7 clone). |
| [wikipedia-YM2413.html](web/wikipedia-YM2413.html) | <https://en.wikipedia.org/wiki/Yamaha_YM2413> | Wikipedia — YM2413 overview | Framing and the wider OPLL/OPL family tree (OPL, OPL2, OPLL, OPLL clones). |
| [vgmpf-YM2413.html](web/vgmpf-YM2413.html) | <https://www.vgmpf.com/Wiki/index.php/YM2413> | VGM Preservation Frontier | Register summary and the VGM write conventions, useful if we ever load real MSX-MUSIC tunes. |
| [grauw-sound.html](web/grauw-sound.html) | <https://map.grauw.nl/resources/sound.php> | MSX Assembly Page — sound resources | Grauw's harvested MSX sound documentation, including the manual above and FM-BIOS notes. |

## Reference implementations (`src/`) — behavioural ground truth

Where the manual is vague (the exact envelope rates, the log-sin/exp operator
math, the DAC), these decide it. **emu2413 is our primary**, and it is also what
openMSX ships (as `YM2413Okazaki`), matching the sibling projects' openMSX choice.

| Local file | Source URL | Notes |
|------------|-----------|-------|
| [emu2413.c](src/emu2413.c) | <https://github.com/digital-sound-antiques/emu2413> | **The reference implementation** — Mitsutaka Okazaki's OPLL core. Carries the instrument-ROM patch table, the `fullsin`/`halfsin` wave tables, the `ml_table` multipliers, the `pm`/`am` LFO tables, and — notably — an `eg_step_tables` comment crediting **andete's research** into the envelope increment pattern. MIT. |
| [emu2413.h](src/emu2413.h) | <https://github.com/digital-sound-antiques/emu2413> | The public API and the `EOPLL_PATCH` field layout (`AM PM EG KR ML / KL TL WS FB / AR DR SL RR`). |
| [openmsx-YM2413Okazaki.cc](src/openmsx-YM2413Okazaki.cc) | <https://github.com/openMSX/openMSX/blob/master/src/sound/YM2413Okazaki.cc> | openMSX's maintained port of emu2413 — our primary within the family. GPL2. |
| [openmsx-YM2413Okazaki.hh](src/openmsx-YM2413Okazaki.hh) | <https://github.com/openMSX/openMSX/blob/master/src/sound/YM2413Okazaki.hh> | The state layout: per-slot phase/envelope, the channel/slot mapping, rhythm slots. |
| [openmsx-YM2413NukeYKT.cc](src/openmsx-YM2413NukeYKT.cc) | <https://github.com/openMSX/openMSX/blob/master/src/sound/YM2413NukeYKT.cc> | **NukeYKT** — a die-shot-based, cycle-accurate core. The most authoritative source that exists on the chip's internals; the tie-breaker if any §11 detail is ever disputed. |
| [mame-ymopl.cpp](src/mame-ymopl.cpp) | <https://github.com/mamedev/mame/blob/master/src/devices/sound/ymopl.cpp> | MAME's OPLL via the **ymfm** library — an independent third opinion. BSD-3. |

## Further reading (not cached)

- **NukeYKT / Nuke.YKT's OPLL research** — <https://github.com/nukeykt/Nuked-OPLL> —
  the standalone die-accurate core; the ultimate authority on internal timing.
- **VRC7 patch documentation** — the Konami cut-down OPLL used in Famicom
  cartridges; different instrument ROM, no rhythm. Relevant only if we add a
  variant toggle (see the build-plan).

## Licensing / reuse note

These are cached for **private reference while building**. The MSX Wiki pages are
the Microcomputer & Related Culture Foundation's; the Yamaha manual is Yamaha's;
the emulator sources are MIT (emu2413), GPL2 (openMSX) and BSD-3 (MAME/ymfm). Do
**not** redistribute them or copy substantial text into the shipped site, and
**do not copy emulator code** into `js/opll-core.js` — read the behaviour, then
write our own. The instrument-ROM *data* and the chip's published tables are
facts about the hardware and may be reproduced (with attribution); the *code* that
processes them may not. Cite and link instead.
