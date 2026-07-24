// code-view.js — the Z80 write sequence that would produce the current chip
// state on a real MSX.
//
// The OPLL has no bank-switching and no wave tables (unlike the SCC): reaching it
// is just two I/O ports. Register RR = value VV is always the same four bytes —
// latch RR to port 7Ch, then send VV to port 7Dh, with a short settle between.
// Everything below is generated from the live register file, so editing anything
// on the site rewrites the listing; the cost readout shows what it takes.
// Kin to msx-edu-scc's code-view.js, retargeted to the YM2413.

import { store } from '../store.js';
import { INSTRUMENT_NAMES, addrLabel, fnumBlockToFreq } from '../opll-spec.js';

const hex = (n, w = 2) => (n & (w === 4 ? 0xffff : 0xff)).toString(16).toUpperCase().padStart(w, '0');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// `ld a,#nn` and `out (#nn),a` are two bytes each: one register write is 8 bytes.
const WRITE_BYTES = 8;

// --- Program generation -----------------------------------------------------

function buildProgram(opts) {
  const lines = [];
  let bytes = 0, writes = 0;

  const blank = () => lines.push({ kind: 'blank' });
  const cmt = (text) => lines.push({ kind: 'cmt', text });
  const ins = (op, args, comment) => lines.push({ kind: 'ins', op, args, comment });

  // One register write: latch the number to 7Ch, send the value to 7Dh.
  const write = (addr, selComment, valComment) => {
    const v = store.get(addr);
    ins('ld', `a,#${hex(addr)}`, null);
    ins('out', '(#7c),a', selComment || `select ${hex(addr)}h`);
    ins('ld', `a,#${hex(v)}`, null);
    ins('out', '(#7d),a', valComment || null);
    bytes += WRITE_BYTES; writes++;
  };

  const keyed = (ch) => (store.get(0x20 + ch) >> 4) & 1;
  const channels = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter((ch) => !opts.onlyKeyed || keyed(ch));
  const rhythmOn = (store.get(0x0e) >> 5) & 1;

  cmt('--- reach the chip: ports 7Ch (address) / 7Dh (data) ---');
  cmt('each register is a pair — latch the number, then the value.');

  // --- the user instrument (00-07) -----------------------------------------
  blank();
  cmt('--- the user instrument (registers 00-07) -------------');
  for (let a = 0x00; a <= 0x07; a++) write(a, `select ${hex(a)}h — ${addrLabel(a)}`, null);

  // --- rhythm (0E) ----------------------------------------------------------
  if (rhythmOn || store.get(0x0e) !== 0) {
    blank();
    cmt('--- rhythm mode (register 0E) -------------------------');
    write(0x0e, 'select 0Eh — rhythm mode + drum keys', rhythmDesc(store.get(0x0e)));
  }

  // --- per channel: instrument/volume, then pitch, then key-on -------------
  if (channels.length === 0) {
    blank();
    cmt('(no channel is keyed — press a key, or untick the box for all nine)');
  }
  for (const ch of channels) {
    blank();
    cmt(`--- channel ${ch + 1} -----------------------------------------`);
    const inst = (store.get(0x30 + ch) >> 4) & 0x0f;
    const vol = store.get(0x30 + ch) & 0x0f;
    write(0x30 + ch, `select ${hex(0x30 + ch)}h — instrument + volume`,
      `instrument ${inst} (${INSTRUMENT_NAMES[inst]}), volume ${vol}/15${vol === 0 ? ' — loudest' : ''}`);
    const fnum = store.get(0x10 + ch) | ((store.get(0x20 + ch) & 1) << 8);
    const block = (store.get(0x20 + ch) >> 1) & 7;
    write(0x10 + ch, `select ${hex(0x10 + ch)}h — F-Number low`,
      `F-Number ${fnum} → ${fnumBlockToFreq(fnum, block).toFixed(1)} Hz`);
    write(0x20 + ch, `select ${hex(0x20 + ch)}h — block, key, sustain, F-Number hi`,
      `Block ${block}, key ${keyed(ch) ? 'ON' : 'off'}`);
  }

  blank();
  ins('ret', '', null);

  return { lines, bytes, writes };
}

function rhythmDesc(v) {
  if (!((v >> 5) & 1)) return 'rhythm off (bit 5 clear)';
  const names = ['HH', 'CYM', 'TOM', 'SD', 'BD'];   // bits 0..4
  const on = [];
  for (let b = 4; b >= 0; b--) if ((v >> b) & 1) on.push(names[b]);
  return `rhythm ON · keys: ${on.length ? on.join(' ') : 'none'}`;
}

// --- Rendering --------------------------------------------------------------

function renderLines(lines) {
  return lines.map((l) => {
    if (l.kind === 'blank') return '';
    if (l.kind === 'cmt') return `<span class="c-cmt">; ${esc(l.text)}</span>`;
    const comment = l.comment ? `<span class="c-cmt">; ${esc(l.comment)}</span>` : '';
    const args = l.args ? `<span class="c-num">${esc(l.args)}</span>` : '';
    const pad = ' '.repeat(Math.max(1, 6 - l.op.length));
    const body = `        <span class="c-op">${esc(l.op)}</span>${pad}${args}`;
    return comment ? `${body}${' '.repeat(Math.max(1, 16 - l.args.length))}${comment}` : body;
  }).join('\n');
}

function toText(lines) {
  return lines.map((l) => {
    if (l.kind === 'blank') return '';
    if (l.kind === 'cmt') return `; ${l.text}`;
    const body = `        ${l.op.padEnd(6)}${l.args}`;
    return l.comment ? `${body.padEnd(30)}; ${l.comment}` : body;
  }).join('\n');
}

/**
 * Mount the code view. Re-generates on every store change, so the listing is
 * always the program for what you are currently hearing.
 * @param {HTMLElement} mount
 */
export function createCodeView(mount) {
  mount.classList.add('panel', 'panel-code');
  mount.innerHTML = `
    <div class="panel-head">
      <span class="panel-title">The same state, as Z80</span>
      <span class="panel-tag">MSX-MUSIC · 7Ch / 7Dh</span>
    </div>
    <div class="code-bar">
      <label class="chk"><input type="checkbox" data-only checked> Only the channels that are keyed</label>
      <button type="button" class="btn btn-small" data-copy>Copy</button>
    </div>
    <pre class="code-block"><code data-code></code></pre>
    <p class="panel-note" data-cost></p>`;

  const codeEl = mount.querySelector('[data-code]');
  const onlyEl = mount.querySelector('[data-only]');
  const costEl = mount.querySelector('[data-cost]');
  const copyBtn = mount.querySelector('[data-copy]');
  let text = '';

  function render() {
    const { lines, bytes, writes } = buildProgram({ onlyKeyed: onlyEl.checked });
    codeEl.innerHTML = renderLines(lines);
    text = toText(lines);
    costEl.innerHTML = `<b>${writes}</b> register writes, <b>${bytes}</b> bytes — ` +
      `every one a latch to <code>7Ch</code> and a value to <code>7Dh</code>.`;
  }

  onlyEl.addEventListener('change', render);
  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); copyBtn.textContent = 'Copied'; }
    catch { copyBtn.textContent = 'Select it manually'; }
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1400);
  });

  store.subscribe(render);
  render();
  return { render };
}
