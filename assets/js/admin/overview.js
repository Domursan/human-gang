// Admin : vue d'ensemble (Pilotage > Vue d'ensemble) : tuiles de chiffres clés, bloc « À traiter », activité récente.
// Chaque élément n'apparaît que si les droits de la personne le permettent ; chaque ligne mène à sa sous-section.
import { $, esc, sb, avatarHtml } from '../core.js';
import { relTime } from './ui/time.js';
import { S, pseudoOf } from './state.js';
import { canSection } from './perms.js';
import { setCount } from './shell.js';
import { actionLabel } from '../admin-log.js';

// Données hors coquille, chargées à l'ouverture de la vue et à chaque changement temps réel
const OV = { trades: 0, activity: [] };

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/* =========================================================
   Vue d'ensemble : tuiles + « À traiter » + activité
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

  // « À traiter » : seulement ce que les droits permettent, une ligne par sujet, avec un lien vers la sous-section
  const todo = [];
  if (canSection('assistance') && open) todo.push({ label: `${plural(open, 'demande ouverte', 'demandes ouvertes')} d’assistance`, meta: 'Communication · Assistance', href: '#communication/assistance', act: 'Répondre' });
  if (canSection('idees') && newIdeas) todo.push({ label: `${plural(newIdeas, 'idée nouvelle', 'idées nouvelles')}`, meta: 'Communication · Boîte à idées', href: '#communication/idees', act: 'Trier' });
  if (canSection('secret-santa') && ed && ed.status === 'tirage') todo.push({ label: `Tirage du Secret Santa ${ed.year} à faire`, meta: 'Vie du gang · Secret Santa', href: '#vie/secret-santa', act: 'Ouvrir' });
  if (canSection('cartes') && OV.trades) todo.push({ label: `${plural(OV.trades, 'échange en attente', 'échanges en attente')}`, meta: 'Jeu de cartes · Échanges', href: '#cartes/echanges', act: 'Examiner' });
  const $todo = $('#ov-todo');
  if ($todo) {
    $todo.innerHTML = todo.length
      ? `<ul class="ov-todo">${todo.map((t) => `<li class="ov-todo-row">
            <div class="ov-todo-txt"><strong>${esc(t.label)}</strong><span class="small muted">${esc(t.meta)}</span></div>
            <a class="btn btn-ghost btn-sm" href="${t.href}">${esc(t.act)}</a>
          </li>`).join('')}</ul>`
      : '<div class="empty">Rien à traiter pour l’instant.</div>';
  }

  // Activité récente (journal) : seulement si le journal est permis
  const card = $('#ov-activity-card');
  if (card) card.hidden = !canSection('journal');
  const $act = $('#ov-activity');
  if ($act && canSection('journal')) {
    $act.innerHTML = OV.activity.length
      ? `<ul class="ov-act">${OV.activity.map((r) => {
        const who = r.admin_id ? pseudoOf(r.admin_id) : 'Système';
        const cible = r.target_user ? ` · ${pseudoOf(r.target_user)}` : '';
        return `<li>
            <span class="ov-av" aria-hidden="true">${avatarHtml({ pseudo: who }, 28)}</span>
            <span><strong>${esc(who)}</strong> · ${esc(actionLabel(r.action))}${esc(cible)}</span>
            <time datetime="${esc(r.created_at)}">${esc(relTime(r.created_at))}</time>
          </li>`;
      }).join('')}</ul>`
      : '<div class="empty">Aucune action journalisée pour l’instant.</div>';
  }

  // Compteurs « à traiter » : colonne de navigation, rail et onglets
  if (canSection('idees')) setCount('idees', newIdeas);
  if (canSection('assistance')) setCount('assistance', open);
}

/** Charge les données de la vue hors coquille (échanges en attente, dernières actions) puis la redessine. */
export async function loadOverview() {
  const jobs = [];
  if (canSection('cartes')) {
    jobs.push(sb.from('hg_card_trades').select('id').eq('status', 'proposee')
      .then((r) => { if (r.error) throw r.error; OV.trades = r.data?.length ?? 0; }));
  }
  if (canSection('journal')) {
    jobs.push(sb.from('hg_admin_log').select('id, admin_id, action, target_user, created_at')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(6)
      .then((r) => { if (r.error) throw r.error; OV.activity = r.data ?? []; }));
  }
  await Promise.all(jobs.map((p) => p.catch((e) => console.warn('[apercu]', e))));
  renderStats();
}

/** Tables à relire quand elles changent, selon les droits (temps réel). */
export function overviewTables() {
  return [...(canSection('journal') ? ['hg_admin_log'] : []), ...(canSection('cartes') ? ['hg_card_trades'] : [])];
}
