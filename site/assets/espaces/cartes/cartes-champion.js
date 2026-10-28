// ===== Cartes à collectionner — « Ma carte Champion » (idée C17, Champions du gang) =====
// Fenêtre ouverte depuis l'onglet Collection (/pages/cartes/cartes.html) : le membre compose sa carte « main » (jeu, main, emblème, phrase)
// avec un aperçu en direct (cardHtml), puis la propose ; le Staff « cartes » la valide dans le panel (admin-cards/champions.js).
// Acceptée : carte rare de la série « Champions du gang <année> », famille Jeu vidéo, tirable dans les boosters,
// et un exemplaire brillant offert au membre. Une carte par membre et par an ; personne ne crée la carte d'un autre.
// Emblèmes : pictos génériques dessinés pour le gang (aucun logo de jeu), images assets/cards/champions/<id>.svg.
// RPC (migration 082) : hg_champion_me(), hg_champion_propose(p jsonb), hg_champion_withdraw().
// Tout texte venant de la base ou saisi passe par esc() (cardHtml échappe aussi).
// Exporte : GAMES, EMBLEMS, championCardPreview, openChampion(ctx) — ctx : { refresh } (recharge la collection après une acceptation).
import { sb, toast, errMsg, esc } from '../../commun/core.js';
import { cardHtml } from './cartes-ui.js';

/** Jeux proposés (identifiant, libellé) : liste blanche, identique à celle de la base. */
export const GAMES = [['lol', 'LoL'], ['aoe2', 'AoE2'], ['ck3', 'CK3'], ['minecraft', 'Minecraft'], ['among_us', 'Among Us'], ['codenames', 'Nom de code'], ['autre', 'Autre']];
/** Emblèmes (identifiant, libellé, tracé 24 × 24) : liste blanche, identique à celle de la base et aux images des cartes. */
export const EMBLEMS = [
  ['epee', 'Épée', '<path d="M20 4 9.5 14.5M20 4h-4.5M20 4v4.5M7 12.5l4.5 4.5M9.2 14.8 5 19M3.5 20.5 5 19"/>'],
  ['chateau', 'Château', '<path d="M4 21V8h3v3h3V8h4v3h3V8h3v13zM10 21v-4a2 2 0 0 1 4 0v4"/>'],
  ['couronne', 'Couronne', '<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 10H5zM5 21h14"/>'],
  ['pioche', 'Pioche', '<path d="M3 10.5c3.5-6 14.5-6 18 0M12 7v14"/>'],
  ['fusee', 'Fusée', '<path d="M12 2.5c3 2.8 4 6.6 4 10.5l-1.8 4h-4.4L8 13c0-3.9 1-7.7 4-10.5zM8 13l-3 3v3l3.2-2M16 13l3 3v3l-3.2-2M12 9.5v.01M10.5 20.5h3"/>'],
  ['baton', 'Bâton magique', '<path d="M5 19 14.5 9.5"/><circle cx="16.5" cy="7.5" r="2.5"/><path d="M20.5 3.5v.01M21 12v.01M12 3v.01"/>'],
  ['bouclier', 'Bouclier', '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>'],
  ['etoile', 'Étoile', '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>'],
];
const MAIN_MAX = 24;
const FLAVOR_MAX = 60;
const gameLabel = (id) => (GAMES.find(([g]) => g === id)?.[1] || 'Jeu vidéo');
const embIcon = (path) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${path}</svg>`;

/** État de la fenêtre : réponse de hg_champion_me, formulaire, envoi en cours, contexte. */
const C = { me: null, form: { game: 'lol', main: '', emblem: 'epee', flavor: '' }, busy: false, ctx: null, dlg: null };

/**
 * Carte Champion telle qu'elle sortira (même rendu que la vraie carte) : objet carte pour cardHtml.
 * @param {{pseudo: string, year: number, game: string, main: string, emblem: string, flavor?: string}} f
 * @returns {object}
 */
export function championCardPreview(f) {
  return {
    name: `${f.pseudo || 'Moi'} · main ${f.main || '…'}`, rarity: 'rare', family: 'jeu',
    image_url: `/assets/cartes/champions/${EMBLEMS.some(([e]) => e === f.emblem) ? f.emblem : 'etoile'}.svg`,
    flavor: f.flavor || '', caption: `${gameLabel(f.game)} · édition ${f.year}`, set_name: `Champions ${f.year}`,
  };
}

/** Bandeau d'état (proposition en attente, acceptée, refusée). */
function statusHtml(cur, year) {
  if (!cur) return '';
  if (cur.status === 'proposee') return `<p class="champ-status" role="status"><strong>Proposition envoyée.</strong> Le Staff la relit avant la sortie ; tu recevras ton exemplaire brillant dès qu’elle est validée.</p>
    <button type="button" class="btn btn-ghost" data-champ="withdraw">Retirer ma proposition</button>`;
  if (cur.status === 'acceptee' && Number(cur.year) === Number(year)) return `<p class="champ-status champ-ok" role="status"><strong>Ta carte Champion ${esc(year)} est sortie !</strong> Ton exemplaire brillant est dans ta collection. Tu pourras la refaire l’an prochain.</p>`;
  if (cur.status === 'refusee') return `<p class="champ-status champ-ko" role="status"><strong>Le Staff a demandé une modification.</strong>${cur.review_note ? ` « ${esc(cur.review_note)} »` : ''} Tu peux proposer une nouvelle version.</p>`;
  return '';
}

/** Formulaire de création (jeu, main, emblème, phrase) et bouton « Proposer ma carte ». */
function formHtml() {
  const f = C.form;
  return `<form class="champ-form" data-champ-form novalidate>
    <fieldset class="champ-fs"><legend class="champ-lg">Jeu</legend>
      <div class="champ-chips">${GAMES.map(([id, label]) => `<label class="champ-chip"><input type="radio" name="champ-game" value="${id}" ${f.game === id ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('')}</div>
    </fieldset>
    <div class="field"><label for="champ-main">Mon main</label>
      <input id="champ-main" name="main" maxlength="${MAIN_MAX}" autocomplete="off" required value="${esc(f.main)}" placeholder="Ahri, Francs, dynastie de Serge…" aria-describedby="champ-main-help">
      <span class="small muted" id="champ-main-help">Champion, civilisation, dynastie ou rôle : du texte, jamais un logo.</span></div>
    <fieldset class="champ-fs"><legend class="champ-lg">Emblème (aucun logo de jeu)</legend>
      <div class="champ-embs">${EMBLEMS.map(([id, label, path]) => `<label class="champ-emb" title="${esc(label)}"><input type="radio" name="champ-emblem" value="${id}" ${f.emblem === id ? 'checked' : ''}><span class="champ-emb-i">${embIcon(path)}<span class="visually-hidden">${esc(label)}</span></span></label>`).join('')}</div>
    </fieldset>
    <div class="field"><label for="champ-flavor">Ma phrase · ${FLAVOR_MAX} caractères</label>
      <input id="champ-flavor" name="flavor" maxlength="${FLAVOR_MAX}" autocomplete="off" value="${esc(f.flavor)}" placeholder="Je ne ban jamais Yasuo." aria-describedby="champ-fl-count">
      <span class="small muted" id="champ-fl-count" aria-live="polite">${f.flavor.length} / ${FLAVOR_MAX}</span></div>
    <button type="submit" class="btn btn-sand champ-submit" ${C.busy ? 'disabled' : ''}>Proposer ma carte</button>
    <p class="small muted">Le Staff relit avant la sortie. Tu reçois un exemplaire brillant offert. Une carte par an.</p>
  </form>`;
}

/** Contenu de la fenêtre. */
function bodyHtml() {
  const m = C.me;
  if (!m) return '<p class="muted" aria-live="polite">Chargement…</p>';
  const cur = m.current;
  const shown = cur && cur.status !== 'refusee' && cur.status !== 'retiree' ? { ...cur, pseudo: m.pseudo, year: cur.year } : { ...C.form, pseudo: m.pseudo, year: m.year };
  return `<p class="eyebrow">Champions du gang</p>
    <h2 id="champ-title" class="champ-title" tabindex="-1">Ma carte Champion</h2>
    <div class="champ-preview" id="champ-preview" aria-live="polite">${cardHtml(championCardPreview(shown), { size: 'md' })}</div>
    ${statusHtml(cur, m.year)}
    ${m.can_propose ? formHtml() : ''}`;
}

/** Redessine la fenêtre ; focus (sélecteur) reçoit le focus. */
function render(focus = null) {
  const body = C.dlg?.querySelector('.champ-body');
  if (!body) return;
  body.innerHTML = bodyHtml();
  if (focus) body.querySelector(focus)?.focus({ preventScroll: true });
}

/** Met à jour l'aperçu sans redessiner le formulaire (le curseur reste dans le champ). */
function updatePreview() {
  const el = C.dlg?.querySelector('#champ-preview');
  if (el && C.me) el.innerHTML = cardHtml(championCardPreview({ ...C.form, pseudo: C.me.pseudo, year: C.me.year }), { size: 'md' });
  const cnt = C.dlg?.querySelector('#champ-fl-count');
  if (cnt) cnt.textContent = `${C.form.flavor.length} / ${FLAVOR_MAX}`;
}

/** Lit hg_champion_me. */
async function load() {
  const { data, error } = await sb.rpc('hg_champion_me');
  if (error) throw error;
  C.me = data && typeof data === 'object' ? data : null;
  if (!C.me) throw new Error('Les cartes Champions ne sont pas encore disponibles.');
}

/** Envoie la proposition. */
async function submit() {
  if (C.busy) return;
  const f = C.form;
  f.main = f.main.trim(); f.flavor = f.flavor.trim();
  if (!f.main) { toast('Écris ton main (champion, civilisation…)', 'error'); C.dlg.querySelector('#champ-main')?.focus(); return; }
  C.busy = true;
  render('.champ-submit');
  try {
    const { error } = await sb.rpc('hg_champion_propose', { p: { game: f.game, main: f.main, emblem: f.emblem, flavor: f.flavor || null } });
    if (error) throw error;
    toast('Proposition envoyée au Staff', 'ok');
    await load();
    C.busy = false;
    render('#champ-title');
  } catch (e) {
    C.busy = false;
    toast(errMsg(e), 'error');
    render('.champ-submit');
  }
}

/** Retire la proposition en attente. */
async function withdraw(btn) {
  btn.disabled = true;
  try {
    const { error } = await sb.rpc('hg_champion_withdraw');
    if (error) throw error;
    await load();
    toast('Proposition retirée', 'ok');
    render('#champ-title');
  } catch (e) { btn.disabled = false; toast(errMsg(e), 'error'); }
}

/** Crée la fenêtre une seule fois (dialog modal, plein écran sur téléphone). */
function ensureDialog() {
  if (C.dlg) return C.dlg;
  const d = document.createElement('dialog');
  d.id = 'cartes-champion';
  d.className = 'cartes-dialog champ-dlg';
  d.setAttribute('aria-labelledby', 'champ-title');
  d.innerHTML = `<button type="button" class="cartes-close" data-champ="close" aria-label="Fermer"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    <div class="cartes-dialog-pad champ-body"></div>`;
  (document.getElementById('app') || document.body).append(d);
  d.addEventListener('click', (e) => {
    const t = e.target.closest('[data-champ]');
    if (!t || t.disabled) return;
    if (t.dataset.champ === 'close') d.close();
    else if (t.dataset.champ === 'withdraw') withdraw(t);
  });
  d.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'champ-main') C.form.main = t.value.slice(0, MAIN_MAX);
    else if (t.id === 'champ-flavor') C.form.flavor = t.value.slice(0, FLAVOR_MAX);
    else return;
    updatePreview();
  });
  d.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'champ-game') C.form.game = t.value;
    else if (t.name === 'champ-emblem') C.form.emblem = t.value;
    else return;
    updatePreview();
  });
  d.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  d.addEventListener('close', () => { C.ctx?.onClose?.(); });
  C.dlg = d;
  return d;
}

/**
 * Ouvre la fenêtre « Ma carte Champion ».
 * @param {{ onClose?: () => void }} [ctx] onClose : rendu du focus au bouton d'origine
 * @returns {Promise<void>}
 */
export async function openChampion(ctx = {}) {
  C.ctx = ctx;
  const d = ensureDialog();
  render();
  if (!d.open) d.showModal();
  try {
    await load();
    render('#champ-title');
  } catch (e) {
    const body = d.querySelector('.champ-body');
    const msg = e?.code === 'PGRST202' ? 'Les cartes Champions arrivent bientôt.' : errMsg(e);
    if (body) body.innerHTML = `<h2 id="champ-title" class="champ-title">Ma carte Champion</h2><p class="empty">${esc(msg)}</p>`;
  }
}
