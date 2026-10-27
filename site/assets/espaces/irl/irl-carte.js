// ===== IRL — carte « J’y étais » d'une sortie passée (idée C4, migration 080) =====
// Encart sous une sortie passée qui a sa carte (hg_events.card_id) : la carte avec son tampon, « Dans ta collection »,
// le nombre de membres qui l'ont reçue (sans classement), échangeable ou non. L'organisateur (14 jours après la sortie)
// et le Staff « evenements » / « cartes » peuvent ajouter un présent qui n'avait pas répondu : RPC hg_event_card_add
// (journalisée). La carte se crée dans l'admin (Sorties IRL) ; la distribution est faite par la base (pg_cron).
// Lecture : hg_cards (carte), hg_event_card_claims (qui l'a reçue). Sans la migration 080, rien n'est affiché.
// Exporte : loadSortieCards, sortieCardHtml, onSortieCardClick.
import { sb, toast, errMsg, esc, loadMyPerms, hasPerm } from './core.js';
import { cardHtml } from './cartes-ui.js';
import { pluralCount } from './utils.js';

/** Cartes des sorties (Map id → carte) et destinataires par sortie (Map event_id → [user_id]). */
const K = { cards: new Map(), claims: new Map(), staff: false };
const DAY = 864e5;

/**
 * Charge les cartes des sorties passées et leurs destinataires (deux lectures). Ne lève jamais d'erreur.
 * @param {object[]} events sorties (hg_events)
 */
export async function loadSortieCards(events) {
  const ids = [...new Set(events.map((e) => e.card_id).filter(Boolean))];
  K.cards = new Map(); K.claims = new Map();
  if (!ids.length) return;
  try {
    const [cards, claims] = await Promise.all([
      sb.from('hg_cards').select('*').in('id', ids),
      sb.from('hg_event_card_claims').select('event_id,user_id').in('event_id', events.filter((e) => e.card_id).map((e) => e.id)),
      loadMyPerms().catch(() => null),
    ]);
    K.staff = hasPerm('evenements') || hasPerm('cartes');
    K.cards = new Map((cards.data || []).map((k) => [k.id, k]));
    for (const c of claims.data || []) K.claims.set(c.event_id, [...(K.claims.get(c.event_id) || []), c.user_id]);
  } catch { /* migration absente : pas d'encart */ }
}

/**
 * Encart de la carte d'une sortie passée (vide si la sortie n'a pas de carte).
 * @param {object} ev sortie
 * @param {{ me: {id: string}, members: Map<string, object>, pseudo: (id: string) => string }} ctx
 * @returns {string} HTML
 */
export function sortieCardHtml(ev, ctx) {
  const k = ev.card_id ? K.cards.get(ev.card_id) : null;
  if (!k) return '';
  const got = K.claims.get(ev.id) || [];
  const mine = got.includes(ctx.me.id);
  const owner = ev.created_by === ctx.me.id;
  const started = ev.starts_at && new Date(ev.starts_at).getTime() <= Date.now();
  const inTime = started && !ev.retro && Date.now() <= new Date(ev.starts_at).getTime() + 14 * DAY;
  const canAdd = started && (K.staff || (owner && inTime));
  const id = esc(ev.id);
  const names = got.map((u) => ctx.pseudo(u)).sort((a, b) => a.localeCompare(b, 'fr'));
  const choices = [...ctx.members.values()].filter((m) => !m.is_ghost && m.id !== ctx.me.id && !got.includes(m.id))
    .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
  const until = ev.starts_at ? new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'long' }).format(new Date(new Date(ev.starts_at).getTime() + 14 * DAY)) : '';
  return `<section class="jy" aria-labelledby="jy-h-${id}">
    <div class="jy-head">
      <h4 class="jy-title" id="jy-h-${id}">Carte « J’y étais »</h4>
      ${mine ? '<span class="pill jy-mine">Dans ta collection</span>' : ''}
    </div>
    <div class="jy-body">
      <div class="jy-card">${cardHtml(k, { size: 'sm', stamp: true })}</div>
      <div class="jy-info">
        <p><strong>${esc(pluralCount(got.length, 'membre', 'membres'))}</strong> l’${got.length > 1 ? 'ont' : 'a'} reçue.</p>
        ${names.length ? `<p class="small muted jy-names">${names.map(esc).join(', ')}</p>` : ''}
        <p class="pill jy-trade">${k.tradeable ? 'Échangeable' : 'Non échangeable'}</p>
        <p class="small muted">Pas dans les boosters, jamais fabriquée. Elle reste un souvenir.</p>
      </div>
    </div>
    ${canAdd && choices.length ? `<div class="jy-add">
      <p class="small"><strong>${K.staff ? 'Staff' : `Organisateur · jusqu’au ${esc(until)}`}</strong></p>
      <div class="jy-add-row">
        <label class="visually-hidden" for="jy-who-${id}">Membre présent à ajouter</label>
        <select id="jy-who-${id}" data-jy-who="${id}"><option value="">Choisir un membre…</option>${choices.map((m) => `<option value="${esc(m.id)}">${esc(m.pseudo)}</option>`).join('')}</select>
        <button type="button" class="btn btn-ghost" data-jy-add="${id}" data-key="jy-add-${id}">+ Il était là aussi</button>
      </div>
      <p class="small muted">Pour un membre présent qui n’avait pas répondu. Noté au journal.</p>
    </div>` : ''}
  </section>`;
}

/**
 * Clic dans la page : « Il était là aussi ». Renvoie true si le clic a été traité.
 * @param {Event} e clic
 * @param {() => Promise<void>} refresh recharge la page après l'ajout
 */
export function onSortieCardClick(e, refresh) {
  const btn = e.target.closest('[data-jy-add]');
  if (!btn) return false;
  const ev = btn.dataset.jyAdd;
  const sel = document.querySelector(`[data-jy-who="${CSS.escape(ev)}"]`);
  if (!sel?.value) { toast('Choisis d’abord le membre présent.', 'error'); sel?.focus(); return true; }
  btn.disabled = true;
  sb.rpc('hg_event_card_add', { p_event: ev, p_user: sel.value }).then(async ({ error }) => {
    if (error) { toast(errMsg(error), 'error'); btn.disabled = false; return; }
    toast('Carte « J’y étais » ajoutée', 'ok');
    await refresh();
  });
  return true;
}
