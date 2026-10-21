// ===== Humane Gang — administration : section « Souvenirs et photos » =====
// Trois onglets : Souvenirs (hg_moments), Photos (hg_photos + bucket hg-photos), Réactions (hg_reactions).
// Chaque onglet recharge ses données à l'affichage ; sa page et ses filtres sont gardés pendant la session.
import { loadPeople } from './helpers.js';
import { createMomentsPanel } from './moments.js';
import { createPhotosPanel } from './photos.js';
import { createReactionsPanel } from './reactions.js';
import { onTableChange } from '../admin/live.js';

const TABS = [
  ['souvenirs', 'Souvenirs', createMomentsPanel],
  ['photos', 'Photos', createPhotosPanel],
  ['reactions', 'Réactions', createReactionsPanel],
];

export function mountSouvenirsSection(root, { me }) {
  let peoplePromise = null;
  // Annuaire partagé par les onglets (membres + fantômes), chargé une seule fois.
  const ctx = {
    me,
    people: () => {
      peoplePromise ??= loadPeople().catch((e) => { peoplePromise = null; throw e; });
      return peoplePromise;
    },
  };

  root.innerHTML = `
    <div class="filters sv-tabs" role="group" aria-label="Vue souvenirs et photos">
      ${TABS.map(([key, label], i) => `<button class="chip" type="button" data-sv-tab="${key}" aria-pressed="${i === 0}">${label}</button>`).join('')}
    </div>
    <div class="sv-body"></div>`;
  const body = root.querySelector('.sv-body');
  const panels = new Map();
  const makers = new Map(TABS.map(([key, , make]) => [key, make]));

  let current = 'souvenirs';
  async function show(key) {
    current = key;
    root.querySelectorAll('[data-sv-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.svTab === key)));
    if (!panels.has(key)) panels.set(key, makers.get(key)(ctx));
    const p = panels.get(key);
    body.replaceChildren(p.el);
    await p.load();
  }

  root.querySelector('.sv-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sv-tab]');
    if (b) show(b.dataset.svTab);
  });
  // Temps réel : seul l'onglet affiché est relu
  onTableChange('souvenirs', ['hg_moments', 'hg_photos'], () => panels.get(current)?.load());
  show('souvenirs');
  return { show };
}
