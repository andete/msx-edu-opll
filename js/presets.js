// presets.js — teaching user-patch presets (Phase 4).
//
// Complete 8-byte user patches (registers 00–07) that make FM patch design
// approachable. Unlike the fixed ROM instruments — which you *select* and then
// *copy* into the user slot to edit — these load STRAIGHT into the user slot as
// editable starting points, each isolating one FM idea (a silenced modulator, a
// simple 2:1 ratio, feedback, a percussive ring). They are our own bytes, built
// from the register layout in reference §3–§6 to teach; they don't reproduce any
// ROM instrument or emulator table.
//
// Byte layout (see js/opll-core.js `decodePatch`):
//   00 mod: AM PM EG KR · ML     01 car: AM PM EG KR · ML
//   02 mod: KSL · Total Level    03 car KSL · DC/DM waves · Feedback
//   04 mod: Attack · Decay       05 car: Attack · Decay
//   06 mod: Sustain · Release    07 car: Sustain · Release

export const USER_PRESETS = [
  {
    name: 'Pure sine',
    blurb: 'Modulator silenced (TL 63): just the carrier — a single harmonic. The blank canvas to build from.',
    bytes: [0x21, 0x21, 0x3f, 0x00, 0xf0, 0xf0, 0x0f, 0x0f],
  },
  {
    name: '2:1 Bell',
    blurb: 'Modulator ×2 over carrier ×1, keyed short: the archetypal FM bell that rings and fades.',
    bytes: [0x02, 0x01, 0x14, 0x00, 0xf4, 0xf3, 0x24, 0x35],
  },
  {
    name: 'Brass',
    blurb: 'Sustained 1:1 with feedback and a soft attack — a reedy, blowy tone that holds.',
    bytes: [0x21, 0x21, 0x0c, 0x05, 0x94, 0xa3, 0x22, 0x12],
  },
  {
    name: 'Clav',
    blurb: 'Modulator ×3 with full feedback, fast and percussive — a hard, plucked attack.',
    bytes: [0x03, 0x01, 0x08, 0x07, 0xf8, 0xf7, 0x36, 0x47],
  },
  {
    name: 'Feedback growl',
    blurb: 'A loud 1:1 modulator with maximum feedback: the sine folds into a buzzy, gritty wave.',
    bytes: [0x21, 0x21, 0x02, 0x07, 0xf2, 0xf2, 0x11, 0x11],
  },
];

/**
 * Load a user patch: write its 8 bytes into registers 00–07 and switch the
 * channel to instrument 0 (the user slot) so it is what sounds and what the
 * operator panels edit.
 */
export function loadUserPatch(store, bytes, ch = 0) {
  for (let i = 0; i < 8; i++) store.set(i, bytes[i] & 0xff);
  store.setInstrument(ch, 0);
}
