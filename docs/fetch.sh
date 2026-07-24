#!/usr/bin/env bash
# Gentle, cache-once fetcher for YM2413 / OPLL / MSX-MUSIC reference docs.
# - Sequential (never parallel-hammers a host)
# - Skips files already downloaded (idempotent cache)
# - Identifies itself with a descriptive User-Agent
# - Polite 2s gap between requests
set -u
cd "$(dirname "$0")"

UA="msx-edu-opll-docs-cacher/1.0 (personal educational project; contact joost@damad.be)"
LOG="fetch.log"
: > "$LOG"

# url|local_path
SOURCES=(
  # --- Community / wiki documentation (web/) ---
  "https://en.wikipedia.org/wiki/Yamaha_YM2413|web/wikipedia-YM2413.html"
  "https://www.msx.org/wiki/Yamaha_YM2413|web/msxwiki-YM2413.html"
  "https://www.msx.org/wiki/MSX-MUSIC|web/msxwiki-MSX-MUSIC.html"
  "https://www.msx.org/wiki/MSX-MUSIC_programming|web/msxwiki-MSX-MUSIC-programming.html"
  "https://www.msx.org/wiki/FM-PAC|web/msxwiki-FM-PAC.html"
  "https://www.vgmpf.com/Wiki/index.php/YM2413|web/vgmpf-YM2413.html"
  "https://map.grauw.nl/resources/sound.php|web/grauw-sound.html"

  # --- The Yamaha application manual (datasheets/) ---
  # English translation of the YM2413 Application Manual, widely mirrored.
  "https://map.grauw.nl/resources/sound/yamaha_ym2413_frd1x.pdf|datasheets/yamaha_ym2413_application_manual.pdf"

  # --- Reference implementations (src/) — behavioural ground truth ---
  # emu2413: Mitsutaka Okazaki's reference OPLL core (the canonical source).
  "https://raw.githubusercontent.com/digital-sound-antiques/emu2413/master/emu2413.c|src/emu2413.c"
  "https://raw.githubusercontent.com/digital-sound-antiques/emu2413/master/emu2413.h|src/emu2413.h"
  # openMSX: the Okazaki-derived core we treat as primary, plus the NukeYKT
  # (die-shot-accurate) core as an independent second opinion.
  "https://raw.githubusercontent.com/openMSX/openMSX/master/src/sound/YM2413Okazaki.cc|src/openmsx-YM2413Okazaki.cc"
  "https://raw.githubusercontent.com/openMSX/openMSX/master/src/sound/YM2413Okazaki.hh|src/openmsx-YM2413Okazaki.hh"
  "https://raw.githubusercontent.com/openMSX/openMSX/master/src/sound/YM2413NukeYKT.cc|src/openmsx-YM2413NukeYKT.cc"
  # MAME's OPLL (ymfm) — a third independent implementation.
  "https://raw.githubusercontent.com/mamedev/mame/master/src/devices/sound/ymopl.cpp|src/mame-ymopl.cpp"
)

first=1
for entry in "${SOURCES[@]}"; do
  url="${entry%%|*}"
  out="${entry##*|}"
  if [ -s "$out" ]; then
    echo "SKIP (cached)  $out" | tee -a "$LOG"
    continue
  fi
  [ $first -eq 1 ] || sleep 2
  first=0
  code=$(curl -sSL -A "$UA" --retry 2 --retry-delay 3 --max-time 90 \
      -w '%{http_code}' -o "$out" "$url" 2>>"$LOG" || echo "ERR")
  size=$( [ -f "$out" ] && wc -c < "$out" | tr -d ' ' || echo 0 )
  echo "GET $code  ${size}B  $url -> $out" | tee -a "$LOG"
  # discard tiny error pages so re-runs retry them
  if [ "$code" != "200" ] || [ "${size:-0}" -lt 500 ]; then
    echo "  ^ suspect (non-200 or tiny); removing so it retries next run" | tee -a "$LOG"
    rm -f "$out"
  fi
done
echo "done." | tee -a "$LOG"
