// challenge.js — small self-checking tasks per page.
//
// Each challenge is a predicate over the store, re-tested on every change. No
// scoring, no progress saved, no nagging: the point is only to give a reader a
// concrete thing to aim at ("make a bell with a 2:1 modulator") and to confirm
// the instant they hit it, because on a chip this direct the confirmation is the
// lesson. Once met, a challenge stays met — ticking back off the moment you
// nudge a slider past the target would punish exactly the exploring we want.
// Copy-don't-factor sibling of msx-edu-scc's challenge.js.

import { store } from '../store.js';

/**
 * @param {HTMLElement} mount
 * @param {Array<{id: string, task: string, hint?: string, test: () => boolean}>} list
 */
export function createChallenges(mount, list) {
  mount.classList.add('challenges');
  mount.innerHTML = `
    <h3 class="challenges-head">Try it</h3>
    <ul class="challenge-list" data-list></ul>`;
  const ul = mount.querySelector('[data-list]');

  const items = list.map((c) => {
    const li = document.createElement('li');
    li.className = 'challenge';
    li.innerHTML = `
      <span class="challenge-mark" aria-hidden="true"></span>
      <span class="challenge-body">
        <span class="challenge-task">${c.task}</span>
        ${c.hint ? `<span class="challenge-hint">${c.hint}</span>` : ''}
      </span>`;
    li.setAttribute('aria-label', `Not done: ${li.textContent.trim()}`);
    ul.appendChild(li);
    return { spec: c, li, done: false };
  });

  function check() {
    for (const it of items) {
      if (it.done) continue;
      let ok = false;
      try { ok = !!it.spec.test(); } catch { ok = false; }
      if (!ok) continue;
      it.done = true;
      it.li.classList.add('done');
      it.li.setAttribute('aria-label', `Done: ${it.spec.task}`);
    }
  }

  const unsub = store.subscribe(check);
  check();
  return { check, destroy: () => unsub() };
}
