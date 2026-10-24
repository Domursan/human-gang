// Admin : Secret Santa. Colonne 2 : liste des éditions (createList). Zone principale : l'édition choisie
// (adresse #irl/secret-santa/<id>) avec inscrits, tirage, exclusions, vœux, carte de base et attributions.
// Création, modification et exclusions se font dans le tiroir (ss-events.js) ; rien n'est déplié en permanence.
// Utilisé par admin.js (registerSub), ss-events.js et live.js. Dépend de core.js, state.js, common.js,
// admin-accounts.js (pairsBlockHtml), ui/ et des réglages « lot 3 » (blocReglages, chargerReglagesLot3).
import { esc, $, sb, fmtDate, fmtDateTime, isGodMode, godTag } from '../core.js';
import { S, pseudoOf, STATUS_LABEL } from './state.js';
import { check } from './common.js';
import { pairsBlockHtml } from '../admin-accounts.js';
import { createList } from './ui/list.js';
import { pill } from './ui/common.js';
import { renderDetailHeader } from './ui/detail-header.js';
import { loadEditionDetails } from './loaders.js';
import { navigate } from './shell.js';
import { blocReglages } from '../admin-reglages/lot3-ui.js';
import { chargerReglagesLot3 } from '../reglages-valeurs-lot3.js';

// Ton (couleur) de chaque étape d'une édition.
const TONE = { inscriptions: 'open', tirage: 'prog', envoi: 'prog', revelation: 'prog', termine: 'done' };
/** Statut d'une édition au format des composants ui/ : { id, label, tone }. */
export const ssStatus = (ed) => ({ id: ed.status, label: STATUS_LABEL[ed.status] ?? ed.status, tone: TONE[ed.status] || 'muted' });
/** Tri alphabétique (français) des inscrits, par pseudo. */
const byPseudo = (a, b) => pseudoOf(a.user_id).localeCompare(pseudoOf(b.user_id), 'fr');

/** État de la vue : id de l'édition affichée (adresse), racines et listes montées. */
export const SSV = { root: null, list: null, head: null, id: null, wishes: [], wishesErr: null, tok: 0, onEdit: null };

/** Édition affichée (adresse), ou null. */
export const ssCurrent = () => S.editions.find((e) => e.id === SSV.id) ?? null;
/** Édition en cours (pas « Terminé ») : une seule à la fois, sauf mode sans limite. */
export const ssOpenEdition = () => S.editions.find((e) => e.status !== 'termine');

/* ---------- Liste (colonne 2) ---------- */
/** Éléments de la colonne 2 : une ligne par édition, la plus récente en tête. */
function items() {
  return S.editions.map((ed) => ({
    id: ed.id,
    name: `Édition ${ed.year}`,
    status: ssStatus(ed),
    sub: ed.drawn_at ? `Tirage fait le ${fmtDate(ed.drawn_at)}` : 'Pas encore de tirage',
    ended: ed.status === 'termine',
  }));
}
/** Contenu HTML d'une ligne de la colonne 2 (remplace le rendu par défaut de ui/list.js). */
function rowHtml(it) {
  return `<div class="ui-row-body">
    <div class="ui-row-top"><span class="ui-row-name">${esc(it.name)}</span></div>
    <div class="ui-row-title">${esc(it.sub)}</div>
    <div class="ui-row-foot">${pill(it.status)}</div>
  </div>`;
}

/* ---------- Zone principale ---------- */
/** Bouton « + Nouvelle édition » dans la barre de zone. */
function paintActions() {
  const z = $('#zone-actions');
  if (!z) return;
  z.innerHTML = `<button class="btn btn-primary" type="button" data-ss-act="new">+ Nouvelle édition</button>`;
}

/**
 * Charge les vœux (listes de souhaits) de l'édition. Une erreur est gardée dans SSV.wishesErr
 * pour être affichée dans la carte « Vœux », sans bloquer le reste de la page.
 */
async function loadWishes(id) {
  SSV.wishesErr = null;
  try {
    const rows = check(await sb.from('hg_ss_wishes').select('user_id, label, url, created_at').eq('edition_id', id)) ?? [];
    SSV.wishes = rows.slice().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  } catch (e) {
    SSV.wishes = [];
    SSV.wishesErr = e;
  }
}

/** Liste des vœux par participant (lecture seule). Seuls les liens en http(s) deviennent cliquables. */
function wishesHtml(parts) {
  if (SSV.wishesErr) return `<p class="small muted">Vœux indisponibles : ${esc(SSV.wishesErr.message || 'erreur')}</p>`;
  const by = new Map();
  for (const w of SSV.wishes) {
    if (!by.has(w.user_id)) by.set(w.user_id, []);
    by.get(w.user_id).push(w);
  }
  const people = parts.filter((p) => by.has(p.user_id));
  if (!people.length) return '<p class="small muted">Aucun vœu saisi pour l\'instant.</p>';
  return `<ul class="ss-wish-list">${people.map((p) => `<li>
      <strong>${esc(pseudoOf(p.user_id))}</strong> <span class="muted small">(${by.get(p.user_id).length})</span>
      <ul>${by.get(p.user_id).map((w) => `<li>${w.url && /^https?:\/\//.test(w.url) ? `<a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.label)}</a>` : esc(w.label)}</li>`).join('')}</ul>
    </li>`).join('')}</ul>`;
}

/**
 * Carte « Tirage au sort » : boutons (auto, manuel, refaire en mode sans limite) et règles de seuil.
 * @param {object} ed Édition affichée.
 * @param {number} n Nombre d'inscrits.
 */
function drawBlock(ed, n) {
  const god = isGodMode();
  const minDraw = god ? 1 : 3; // mode sans limite : dès 1 participant (il s'offre alors à lui-même)
  const canDraw = n >= minDraw && !ed.drawn_at; // un seul tirage par édition (sauf « Refaire » en mode sans limite)
  const canManual = !ed.drawn_at && n >= (god ? 1 : 2);
  const canRedo = n >= (god ? 1 : 2);
  return `<section class="card stack" aria-labelledby="ss-h-draw">
    <h3 class="card-title" id="ss-h-draw">Tirage au sort</h3>
    <p class="small muted">${god
      ? 'Mode sans limite : le tirage au hasard ignore les exclusions et la cible de l\'an dernier, et peut être refait. Les paires restent secrètes.'
      : 'Respecte les exclusions et évite de retomber sur la même personne que l\'an dernier. Les paires restent secrètes. Le tirage ne peut être lancé qu\'une seule fois par édition.'}</p>
    <div class="btn-row">
      <button class="btn btn-sand" type="button" id="ss-draw" data-ss-act="draw"${canDraw ? '' : ' disabled'}>${ed.drawn_at ? 'Tirage effectué' : `Lancer le tirage${god ? godTag() : ''}`}</button>
      ${ed.drawn_at ? '' : `<button class="btn btn-ghost" type="button" id="ss-draw-manual" data-ss-act="draw-manual"${canManual ? '' : ' disabled'} aria-haspopup="dialog">Tirage manuel</button>`}
    </div>
    ${ed.drawn_at ? `<p class="small muted">Tirage fait le ${esc(fmtDateTime(ed.drawn_at))} pour ${n} participants. Le tirage passe l'édition en « Envoi des cadeaux ».</p>`
      : n < minDraw ? `<p class="small muted">Il faut au moins ${minDraw} inscrit${minDraw > 1 ? 's' : ''}${god ? godTag() : ''}.</p>`
        : '<p class="small muted">« Lancer le tirage » choisit au hasard. « Tirage manuel » te laisse fixer chaque paire toi-même, et compléter le reste au hasard.</p>'}
    ${god && ed.drawn_at ? `<div class="stack">
      <div class="btn-row">
        <button class="btn btn-sand" type="button" id="ss-redraw" data-ss-act="redraw"${canRedo ? '' : ' disabled'} aria-haspopup="dialog">Refaire le tirage (auto)${godTag()}</button>
        <button class="btn btn-ghost" type="button" id="ss-redraw-manual" data-ss-act="redraw-manual"${canRedo ? '' : ' disabled'} aria-haspopup="dialog">Refaire le tirage (manuel)${godTag()}</button>
      </div>
      <p class="small muted">Supprime les attributions actuelles puis relance un tirage. Les cartes déjà vues par les participants changeront.</p>
    </div>` : ''}
    ${S.lastDraw && S.lastDraw.edition === ed.id ? `<p class="draw-result" role="status">Tirage OK pour ${esc(S.lastDraw.n)} participants</p>` : ''}
  </section>`;
}

/**
 * Corps de la page d'une édition : inscrits, tirage, exclusions, vœux, carte de base, paires, suppression.
 * @param {object} ed Édition affichée.
 */
function detailBody(ed) {
  const parts = [...S.participants].sort(byPseudo);
  const n = parts.length;
  const sent = parts.filter((p) => p.sent_at).length;
  const received = parts.filter((p) => p.received_at).length;
  const exclCount = S.exclusions.length;
  return `
    <div class="vie-grid">
      <section class="card stack" aria-labelledby="ss-h-part">
        <h3 class="card-title" id="ss-h-part">Inscrits <span class="muted">(${n})</span></h3>
        ${n ? `<div class="participants">${parts.map((p) => `<span class="pill">${esc(pseudoOf(p.user_id))}</span>`).join('')}</div>
          ${ed.drawn_at ? `<p class="small muted">Cadeaux envoyés : ${sent} / ${n} · reçus : ${received} / ${n}</p>` : ''}`
          : '<div class="empty">Personne n\'est encore inscrit.</div>'}
      </section>

      ${drawBlock(ed, n)}

      <section class="card stack" aria-labelledby="ss-h-excl">
        <div class="vie-card-head">
          <h3 class="card-title" id="ss-h-excl">Exclusions <span class="muted">(${exclCount})</span></h3>
          <button class="btn btn-ghost btn-sm" type="button" data-ss-act="excl-new"${n >= 2 ? '' : ' disabled'}>+ Exclusion</button>
        </div>
        <p class="small muted">Deux personnes d'une même paire ne pourront pas se tirer l'une l'autre (couples, colocs…).${n >= 2 ? '' : ' Il faut au moins deux inscrits.'}</p>
        <div>${exclCount ? S.exclusions.map((x) => `
          <div class="list-row">
            <div class="pair grow"><strong>${esc(pseudoOf(x.user_a))}</strong>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>
              <strong>${esc(pseudoOf(x.user_b))}</strong></div>
            <button class="btn btn-danger btn-sm btn-icon" type="button" data-del-excl="${esc(x.user_a)}|${esc(x.user_b)}" aria-label="Retirer l'exclusion ${esc(pseudoOf(x.user_a))} et ${esc(pseudoOf(x.user_b))}">${svgX()}</button>
          </div>`).join('') : '<p class="small muted">Aucune exclusion.</p>'}</div>
      </section>

      <section class="card stack" aria-labelledby="ss-h-wish">
        <h3 class="card-title" id="ss-h-wish">Vœux <span class="muted">(${SSV.wishes.length})</span></h3>
        <p class="small muted">Listes de souhaits saisies par les participants. Lecture seule.</p>
        ${wishesHtml(parts)}
      </section>

      <section class="card stack" aria-labelledby="ss-h-card">
        <h3 class="card-title" id="ss-h-card">Carte de base</h3>
        <p class="small muted">Image de fond de la carte que chaque Santa découvre (le pseudo de sa cible est ajouté dessus). Format paysage conseillé, 1500 × 1000 px.</p>
        <div class="card-preview">${ed.card_base_url ? `<img src="${esc(ed.card_base_url)}" alt="Carte de base ${esc(ed.year)}">` : 'Carte par défaut'}</div>
        <div class="btn-row">
          <button class="btn btn-ghost" type="button" id="ss-card-upload" data-ss-act="card-upload">${svgUp()} ${ed.card_base_url ? 'Remplacer' : 'Téléverser'}</button>
          ${ed.card_base_url ? '<button class="btn btn-danger" type="button" id="ss-card-reset" data-ss-act="card-reset">Revenir à la carte par défaut</button>' : ''}
        </div>
        <input type="file" id="ss-card-file" accept="image/png,image/jpeg,image/webp" hidden>
      </section>

      ${pairsBlockHtml(ed)}
    </div>

    <section class="card stack ss-danger vie-wide" aria-labelledby="ss-h-del">
      <h3 class="card-title" id="ss-h-del">Supprimer l'édition ${esc(ed.year)}</h3>
      <p class="small muted">Efface l'édition avec ses inscrits (${n}), ses exclusions (${exclCount}), son tirage, ses vœux et ses conversations. Action définitive : le détail exact est affiché avant confirmation.</p>
      <div class="btn-row"><button class="btn btn-danger" type="button" id="ss-delete" data-ss-act="delete">Supprimer l'édition</button></div>
    </section>`;
}

/** Icône « croix » (retirer une exclusion). */
const svgX = () => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
/** Icône « téléverser » (carte de base). */
const svgUp = () => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5M5 20h14"/></svg>';

/** Dessine la page de l'édition affichée, ou un message si aucune n'est choisie ou si elle n'existe plus. */
function paintDetail() {
  const root = SSV.root;
  if (!root) return;
  SSV.head?.destroy();
  SSV.head = null;
  const ed = ssCurrent();
  if (!SSV.id) {
    root.innerHTML = `<div class="detail-empty">Choisis une édition dans la liste, ou crée-en une avec « Nouvelle édition ».</div>`;
    return;
  }
  if (!ed) {
    root.innerHTML = `<div class="detail-empty">Cette édition n'existe plus. Choisis-en une autre dans la liste.</div>`;
    return;
  }
  const n = S.participants.length;
  root.innerHTML = `<div class="vie-detail">
    <div id="ss-dhead"></div>
    ${detailBody(ed)}
  </div>`;
  SSV.head = renderDetailHeader(root.querySelector('#ss-dhead'), {
    title: `Édition ${ed.year}`,
    subtitle: `${STATUS_LABEL[ed.status] ?? ed.status} · ${n} inscrit${n > 1 ? 's' : ''}${ed.budget ? ` · budget ${ed.budget}` : ''}`,
    actions: [{ label: 'Modifier', onClick: () => SSV.onEdit?.(ssCurrent()) }],
  });
}

/** Repeint la liste des éditions et l'édition affichée (après une lecture ou une écriture). */
export function renderSS() {
  if (!SSV.root) return;
  SSV.list?.update(items());
  paintDetail();
}

/* ---------- API de la coquille (registerSub) ---------- */
/** Fournisseurs de la sous-section « Secret Santa » (voir admin/shell.js, registerSub). */
export const ssSub = {
  /** Montage unique : la zone principale, le bloc de réglages du Secret Santa, et ses valeurs. */
  main(el) {
    SSV.root = $('#ss-root');
    el.prepend(blocReglages('ss'));
    chargerReglagesLot3();
  },
  /** Colonne 2 : la liste des éditions, sans recherche ; choisir une ligne ouvre son adresse. */
  list(el) {
    SSV.list = createList(el, {
      items: items(),
      key: 'id',
      label: 'Éditions Secret Santa',
      filters: [
        { id: 'en-cours', label: 'En cours', test: (it) => !it.ended },
        { id: 'terminees', label: 'Terminées', test: (it) => it.ended },
      ],
      search: false,
      selectedId: SSV.id,
      render: rowHtml,
      empty: 'Aucune édition pour l\'instant.',
      onSelect: (it) => navigate(`irl/secret-santa/${it.id}`),
    });
  },
  /**
   * À chaque visite : recharge l'édition de l'adresse (inscrits, exclusions, vœux), puis redessine.
   * `tok` évite qu'une réponse lente écrase une visite plus récente.
   */
  async open(_el, { id } = {}) {
    const tok = ++SSV.tok;
    SSV.id = id || null;
    if (id && !S.editions.some((e) => e.id === id)) {
      navigate('irl/secret-santa');
      return;
    }
    if (id) {
      S.editionId = id;
      await loadEditionDetails();
      await loadWishes(id);
      if (tok !== SSV.tok) return;
    }
    SSV.list?.select(SSV.id);
    paintActions();
    paintDetail();
  },
};
