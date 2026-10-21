// Admin : vue d'ensemble (tuiles et compteurs « à traiter » de la coquille).
import { $, esc } from '../core.js';
import { S } from './state.js';
import { canSection } from './perms.js';
import { setCount } from './shell.js';

/* =========================================================
   Vue d'ensemble
   ========================================================= */
export function renderStats() {
  const ed = S.editions[0];
  const free = S.invites.filter((i) => !i.used_by && !i.link_id && !(i.expires_at && new Date(i.expires_at) < new Date())).length;
  const newIdeas = S.ideas.filter((i) => i.status === 'nouvelle').length;
  const open = S.support.filter((s) => s.status === 'ouverte').length;
  const partCount = ed && ed.id === S.editionId ? S.participants.length : null;
  // [section, route, valeur, libellé, à traiter]. Une tuile n'apparaît que si sa section est accessible.
  const tiles = [
    ['comptes', '#membres/comptes', S.members.length, 'membres'],
    ['membres', '#membres/invitations', free, free > 1 ? 'codes disponibles' : 'code disponible'],
    ['secret-santa', '#vie/secret-santa', ed ? (partCount ?? '–') : '–', ed ? `inscrits · Secret Santa ${ed.year}` : 'aucune édition'],
    ['idees', '#communication/idees', newIdeas, newIdeas > 1 ? 'nouvelles idées' : 'nouvelle idée', newIdeas > 0],
    ['assistance', '#communication/assistance', open, open > 1 ? 'demandes ouvertes' : 'demande ouverte', open > 0],
  ];
  const shown = tiles.filter(([section]) => canSection(section));
  $('#stats').innerHTML = shown.length
    ? shown.map(([, href, v, l, warn]) =>
      `<a class="stat${warn ? ' attention' : ''}" href="${href}"><span class="stat-value">${esc(v)}</span><span class="stat-label">${esc(l)}</span></a>`).join('')
    : '<div class="empty">Aucun indicateur à afficher pour tes droits.</div>';
  // Compteurs « à traiter » : colonne de navigation, rail et onglets
  if (canSection('idees')) setCount('idees', newIdeas);
  if (canSection('assistance')) setCount('assistance', open);
}
