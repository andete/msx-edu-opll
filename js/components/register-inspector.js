// register-inspector.js — the OPLL's write-only register file (00–38) as hex +
// per-bit cells, grouped and labelled by opll-spec. Two-way bound: a store change
// re-renders; clicking a bit writes back through the store. It IS the driver's
// shadow copy the chip cannot give you back. Supports .setSpotlight(range) to dim
// everything a page isn't about.

import { REGISTER_GROUPS, addrLabel } from '../opll-spec.js';

export class RegisterInspector {
  constructor(el, store) {
    this.el = el;
    this.store = store;
    this.rowEls = new Map(); // addr → { hex, bits:[8] }
    this.spotlight = null;   // null = show all; else Set of addrs to highlight
    this._build();
    this._unsub = store.subscribe((evt) => {
      if (evt.type === 'reg') this._renderAddr(evt.addr);
      else if (evt.type === 'reset') this.refresh();
    });
    this.refresh();
  }

  _build() {
    this.el.classList.add('reg-inspector');
    this.el.innerHTML = '';
    for (const g of REGISTER_GROUPS) {
      const rows = g.rows ? g.rows : Array.from({ length: 9 }, (_, ch) => g.perCh(ch));
      const grp = document.createElement('div');
      grp.className = 'reg-group';
      grp.innerHTML = `<div class="reg-group-head"><span>${g.title}</span><code>${g.tag}</code></div>`;
      const body = document.createElement('div');
      body.className = 'reg-group-body';
      for (const r of rows) body.appendChild(this._makeRow(r.addr, r.label));
      grp.appendChild(body);
      this.el.appendChild(grp);
    }
  }

  _makeRow(addr, label) {
    const row = document.createElement('div');
    row.className = 'reg-row';
    row.dataset.addr = addr;

    const name = document.createElement('code');
    name.className = 'reg-addr';
    name.textContent = hex2(addr);
    name.title = label;

    const hexVal = document.createElement('code');
    hexVal.className = 'reg-hex';

    const bits = document.createElement('div');
    bits.className = 'reg-bits';
    const bitEls = [];
    for (let b = 7; b >= 0; b--) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'reg-bit';
      cell.dataset.bit = b;
      cell.title = `${label} — bit ${b}`;
      cell.addEventListener('click', () => {
        const cur = this.store.get(addr);
        this.store.setBit(addr, b, !((cur >> b) & 1));
      });
      bits.appendChild(cell);
      bitEls[b] = cell;
    }

    const lab = document.createElement('span');
    lab.className = 'reg-label';
    lab.textContent = label;

    row.append(name, bits, hexVal, lab);
    this.rowEls.set(addr, { row, hex: hexVal, bits: bitEls });
    return row;
  }

  _renderAddr(addr) {
    const refs = this.rowEls.get(addr);
    if (!refs) return;
    const v = this.store.get(addr);
    refs.hex.textContent = hex2(v);
    for (let b = 0; b < 8; b++) refs.bits[b].classList.toggle('on', !!((v >> b) & 1));
  }

  /** range: {lo, hi} inclusive, or an array of addrs, or null to show all. */
  setSpotlight(range) {
    if (!range) this.spotlight = null;
    else if (Array.isArray(range)) this.spotlight = new Set(range);
    else { this.spotlight = new Set(); for (let a = range.lo; a <= range.hi; a++) this.spotlight.add(a); }
    for (const [addr, refs] of this.rowEls) {
      const dim = this.spotlight && !this.spotlight.has(addr);
      refs.row.classList.toggle('dim', !!dim);
    }
  }

  refresh() {
    for (const addr of this.rowEls.keys()) this._renderAddr(addr);
  }

  destroy() { this._unsub && this._unsub(); }
}

function hex2(n) { return n.toString(16).toUpperCase().padStart(2, '0'); }
