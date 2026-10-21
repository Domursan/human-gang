// Admin : vue d'ensemble (compteurs des tuiles, badges de navigation) et navigation latérale (section active).
import { $, $$, esc } from '../core.js';
import { S } from './state.js';
import { canSection } from './perms.js';

/* =========================================================
   Vue d'ensemble
   ========================================================= */
export function renderStats() {
  const ed = S.editions[0];
  const free = S.invites.filter((i) => !i.used_by && !i.link_id && !(i.expires_at && new Date(i.expires_at) < new Date())).length;
  const newIdeas = S.ideas.filter((i) => i.status === 'nouvelle').length;
  const open = S.support.filter((s) => s.status === 'ouverte').length;
  const partCount = ed && ed.id === S.editionId ? S.participants.length : null;
  const tiles = [
    ['#comptes', S.members.length, 'membres'],
    ['#membres', free, free > 1 ? 'codes disponibles' : 'code disponible'],
    ['#secret-santa', ed ? (partCount ?? '–') : '–', ed ? `inscrits · Secret Santa ${ed.year}` : 'aucune édition'],
    ['#idees', newIdeas, newIdeas > 1 ? 'nouvelles idées' : 'nouvelle idée', newIdeas > 0],
    ['#assistance', open, open > 1 ? 'demandes ouvertes' : 'demande ouverte', open > 0],
  ];
  // Une tuile n'apparaît que si sa section est accessible (aucune donnée n'est affichée sinon)
  const shown = tiles.filter(([href]) => canSection(href.slice(1)));
  $('#stats').innerHTML = shown.length
    ? shown.map(([href, v, l, warn]) =>
      `<a class="stat${warn ? ' attention' : ''}" href="${href}"><span class="stat-value">${esc(v)}</span><span class="stat-label">${esc(l)}</span></a>`).join('')
    : '<div class="empty">Aucun indicateur à afficher pour tes droits.</div>';
  if (canSection('idees')) setNavCount('idees', newIdeas);
  if (canSection('assistance')) setNavCount('assistance', open);
}
function setNavCount(key, n) {
  const el = $(`.nav-count[data-count="${key}"]`);
  if (!el) return;
  el.hidden = !n; el.textContent = n || '';
}

/* =========================================================
   Navigation latérale (section active)
   ========================================================= */
export function setupNav() {
  const links = $$('.admin-nav a');
  const byId = new Map(links.map((a) => [a.getAttribute('href').slice(1), a]));
  const setActive = (id) => links.forEach((a) => {
    const on = a === byId.get(id);
    if (on) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    if (on && matchMedia('(max-width: 860px)').matches) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  const visible = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.boundingClientRect.top : null);
    const first = [...visible.entries()].filter(([, v]) => v !== null).sort((a, b) => a[1] - b[1])[0];
    if (first) setActive(first[0]);
  }, { rootMargin: '-15% 0px -60% 0px' });
  $$('.admin-section').forEach((s) => { if (!s.hidden) io.observe(s); });
  setActive(location.hash.slice(1) || 'apercu');
}
