// ===== Cartes à collectionner — cagnotte collective de Paillettes (idée C13) =====
// Encart en haut de la page Cartes (cartes.html) : jauge de la cagnotte en cours, participants, 5 derniers versements
// (pseudo, ou « Anonyme »), fenêtre de versement (montants rapides, montant libre, case « anonymement »).
// RPC (migration 082) : hg_pot_current() (lecture, clôt une cagnotte échue), hg_pot_contribute(p_pot, p_amount, p_anonymous, p_request).
// Règles affichées : 10 ✦ minimum, 25 % de l'objectif au plus par membre, remboursement si l'objectif n'est pas atteint,
// récompense pour tous les membres (même sans versement) dès que l'objectif est atteint.
// Tout texte venant de la base passe par esc(). Sans la migration (fonction absente) ou sans cagnotte : l'encart reste vide.
// Exporte : mountPot(el, ctx) — ctx : { me, refresh, balance } (refresh recharge le solde de la page, balance() le renvoie).
import { sb, toast, errMsg, esc, avatarHtml } from './core.js';
import { fmtPaillettes } from './paillettes.js';

const nf = new Intl.NumberFormat('fr-CH');
/** Date de fin « 24 déc. à 18 h » (heure de Zurich). */
const endFmt = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'short', hour: 'numeric' });
const QUICK = [50, 100, 250, 500];

/** État de l'encart : données de hg_pot_current, montant choisi, anonymat, fenêtre ouverte, envoi en cours, demande en cours. */
const P = { el: null, ctx: null, data: null, amount: 100, anon: false, open: false, busy: false, req: null };

/** Identifiant stable d'un versement tant qu'il n'a pas abouti (un double clic ne paie pas deux fois). */
const newReq = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;

/** « 9 jours restants », « 5 h restantes », « Moins d'une heure ». */
function leftText(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'Terminée';
  const h = Math.floor(ms / 3600e3);
  if (h >= 48) return `${nf.format(Math.floor(h / 24))} jours restants`;
  if (h >= 1) return `${nf.format(h)} h restantes`;
  return 'Moins d’une heure';
}

/** « il y a 12 min », « à l'instant », « hier », sinon la date. */
function agoText(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 90) return 'à l’instant';
  if (s < 3600) return `il y a ${nf.format(Math.round(s / 60))} min`;
  if (s < 86400) return `il y a ${nf.format(Math.round(s / 3600))} h`;
  if (s < 172800) return 'hier';
  return new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'short' }).format(new Date(iso));
}

/** Plafond de versement de l'appelant : sa marge, son solde. */
const maxAmount = () => Math.max(0, Math.min(Number(P.data?.my_left) || 0, Number(P.ctx?.balance?.() ?? Infinity)));

/** Récompense en mots : « un booster Raclette » ou « 2 boosters Raclette ». */
const rewardText = (p) => `${Number(p.reward_qty) > 1 ? `${nf.format(p.reward_qty)} boosters` : 'un booster'} « ${esc(p.reward_name || p.reward_type)} »`;

/** Ligne d'un versement récent. */
function rowHtml(r) {
  const who = r.pseudo ? esc(r.pseudo) : 'Anonyme';
  const av = r.pseudo ? avatarHtml(r, 28) : '<span class="avatar pot-anon" aria-hidden="true" style="width:28px;height:28px">?</span>';
  return `<li class="pot-row">${av}<span class="pot-who">${who}${r.is_me ? ' <span class="muted small">(toi)</span>' : ''}</span>
    <span class="pot-amt">${fmtPaillettes(Number(r.amount))}</span><span class="pot-ago muted small">${esc(agoText(r.created_at))}</span></li>`;
}

/** Fenêtre de versement (dans l'encart). */
function formHtml(p) {
  const max = maxAmount();
  const a = Math.min(Math.max(P.amount, 10), Math.max(max, 10));
  return `<section class="pot-form" aria-labelledby="pot-form-h">
    <div class="pot-between"><h3 id="pot-form-h" class="pot-form-h">Verser</h3><span class="muted small">Max. ${fmtPaillettes(Number(p.cap))} par membre</span></div>
    ${max < 10 ? `<p class="pot-note">${Number(P.data.my_left) < 10 ? 'Tu as déjà versé ton maximum : merci !' : 'Pas assez de Paillettes pour verser (10 ✦ minimum).'}</p>` : `
    <div class="pot-quick" role="group" aria-label="Montants rapides">
      ${QUICK.filter((q) => q <= max).map((q) => `<button type="button" class="pot-chip" data-pot="quick" data-v="${q}" aria-pressed="${q === a}">${nf.format(q)}</button>`).join('')}
      <label class="pot-amount"><span class="visually-hidden">Montant en Paillettes</span>
        <input type="number" id="pot-amount" inputmode="numeric" min="10" max="${max}" step="1" value="${a}" data-pot="amount"><span aria-hidden="true">✦</span></label>
    </div>
    <label class="pot-check"><input type="checkbox" id="pot-anon" data-pot="anon" ${P.anon ? 'checked' : ''}> Verser anonymement</label>
    <p class="pot-note">Si l’objectif n’est pas atteint le ${esc(endFmt.format(new Date(p.ends_at)))}, tout le monde est remboursé. Atteint : chaque membre reçoit ${rewardText(p)}, même sans avoir versé.${p.badge ? ' Dès 100 ✦ versés, tu gagnes aussi le badge de la cagnotte.' : ''}</p>
    <div class="btn-row">
      <button type="button" class="btn btn-primary pot-confirm" data-pot="confirm" ${P.busy ? 'disabled' : ''}>Confirmer · ${fmtPaillettes(a)}</button>
      <button type="button" class="btn btn-ghost" data-pot="close">Annuler</button>
    </div>`}
  </section>`;
}

/** HTML de l'encart selon l'état de la cagnotte (ouverte, atteinte, échouée). */
function potHtml() {
  const d = P.data, p = d?.pot;
  if (!p) return '';
  const pct = Math.min(100, Math.floor(Number(p.total) / Number(p.goal) * 100));
  const people = `${nf.format(Number(p.contributors))} participant${Number(p.contributors) > 1 ? 's' : ''}`;
  const recent = d.recent?.length ? `<div class="pot-recent"><h3 class="pot-recent-h">Derniers versements</h3><ul class="pot-list">${d.recent.map(rowHtml).join('')}</ul></div>` : '';
  let status = '';
  if (p.status === 'atteinte') {
    status = `<p class="pot-done" role="status"><strong>Objectif atteint !</strong> ${d.rewarded
      ? `Ton ${Number(p.reward_qty) > 1 ? 'lot de boosters' : 'booster'} « ${esc(p.reward_name)} » t’attend dans <button type="button" class="pot-link" data-tab-go="inventaire">l’Inventaire</button>.`
      : 'Les boosters ont été distribués aux membres présents ce jour-là.'}</p>`;
  } else if (p.status === 'echouee') {
    status = `<p class="pot-done pot-fail" role="status"><strong>Objectif pas atteint.</strong> ${Number(d.mine) ? `Tes ${fmtPaillettes(Number(d.mine))} t’ont été rendues.` : 'Tous les versements ont été rendus.'}</p>`;
  }
  const open = p.status === 'ouverte';
  return `<section class="pot-box" aria-labelledby="pot-title">
    <div class="pot-between"><p class="eyebrow pot-eyebrow">Cagnotte du gang</p><span class="muted small">${open ? esc(leftText(p.ends_at)) : 'Terminée'}</span></div>
    <h2 class="pot-title" id="pot-title">${esc(p.title)}</h2>
    <div class="pot-between pot-sum"><p class="pot-total"><span class="visually-hidden">Total versé : </span>${fmtPaillettes(Number(p.total))}</p><span class="muted small">sur ${fmtPaillettes(Number(p.goal))}</span></div>
    <div class="progress pot-bar" role="progressbar" aria-label="Avancement de la cagnotte" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
    <div class="pot-between small"><span>${nf.format(pct)} % · ${people}</span><span class="muted">${open ? `Fin le ${esc(endFmt.format(new Date(p.ends_at)))}` : ''}</span></div>
    ${Number(d.mine) ? `<p class="small muted pot-mine">Tu as versé ${fmtPaillettes(Number(d.mine))}.</p>` : ''}
    ${status}
    ${open && !P.open ? `<button type="button" class="btn btn-sand pot-cta" data-pot="open" aria-expanded="false" aria-controls="pot-form-slot">Verser des Paillettes</button>` : ''}
    <div id="pot-form-slot">${open && P.open ? formHtml(p) : ''}</div>
    ${recent}
    ${open ? '<p class="small muted pot-foot">Les boosters vont à chaque membre présent au moment où l’objectif est atteint ; un membre arrivé après ne les reçoit pas.</p>' : ''}
  </section>`;
}

/** Redessine l'encart ; focus (sélecteur) reçoit le focus après le rendu. */
function render(focus = null) {
  if (!P.el) return;
  P.el.innerHTML = potHtml();
  P.el.hidden = !P.data?.pot;
  if (focus) P.el.querySelector(focus)?.focus({ preventScroll: true });
}

/** Charge la cagnotte (hg_pot_current). Fonction absente (migration pas encore déployée) ou erreur : encart caché. */
async function load() {
  try {
    const { data, error } = await sb.rpc('hg_pot_current');
    if (error) throw error;
    P.data = data && typeof data === 'object' ? data : null;
  } catch (e) {
    console.warn('[cagnotte]', e);
    P.data = null;
  }
  render();
}

/** Montant choisi (borné entre 10 et le maximum permis). */
function setAmount(v, focus) {
  const n = Math.floor(Number(v) || 0);
  P.amount = Math.max(10, Math.min(n, Math.max(10, maxAmount())));
  P.req = null; // un autre montant = une autre demande
  render(focus);
}

/** Envoie le versement (hg_pot_contribute). Le même identifiant de demande est gardé jusqu'à la réussite. */
async function confirm() {
  const p = P.data?.pot;
  if (!p || P.busy) return;
  const input = P.el.querySelector('#pot-amount');
  const a = Math.floor(Number(input?.value ?? P.amount));
  if (!(a >= 10)) return toast('Versement minimal : 10 ✦', 'error');
  if (a > maxAmount()) return toast(`Tu peux verser ${nf.format(maxAmount())} ✦ au plus`, 'error');
  P.amount = a;
  P.req = P.req || newReq();
  P.busy = true;
  render('.pot-confirm');
  try {
    const { data, error } = await sb.rpc('hg_pot_contribute', { p_pot: p.id, p_amount: a, p_anonymous: P.anon, p_request: P.req });
    if (error) throw error;
    P.req = null;
    P.open = false;
    if (data && typeof data === 'object' && data.pot) P.data = data;
    toast(data?.reached ? 'Objectif atteint : les boosters partent pour tout le gang !' : `Merci ! ${nf.format(a)} ✦ versées dans la cagnotte`, 'ok');
    await P.ctx?.refresh?.();
  } catch (e) {
    toast(errMsg(e), 'error');
  } finally {
    P.busy = false;
    render(P.open ? '.pot-confirm' : '.pot-cta, .pot-title');
  }
}

/** Délégation des clics et des saisies de l'encart. */
function onClick(e) {
  const t = e.target.closest('[data-pot]');
  if (!t || t.disabled) return;
  const k = t.dataset.pot;
  if (k === 'open') { P.open = true; render('#pot-amount, .pot-note'); }
  else if (k === 'close') { P.open = false; P.req = null; render('.pot-cta'); }
  else if (k === 'quick') setAmount(t.dataset.v, `[data-pot="quick"][data-v="${t.dataset.v}"]`);
  else if (k === 'confirm') confirm();
}
function onChange(e) {
  const t = e.target;
  if (t.dataset.pot === 'anon') { P.anon = t.checked; P.req = null; }
  else if (t.dataset.pot === 'amount') setAmount(t.value, '#pot-amount');
}
function onKey(e) {
  if (e.key === 'Enter' && e.target.dataset?.pot === 'amount') { e.preventDefault(); P.amount = Math.floor(Number(e.target.value) || 0); confirm(); }
}

/**
 * Monte l'encart de la cagnotte dans el (caché tant qu'il n'y a pas de cagnotte à montrer).
 * @param {HTMLElement} el conteneur (vide)
 * @param {{ me: object, refresh: () => Promise<void>, balance: () => number }} ctx
 * @returns {Promise<void>}
 */
export async function mountPot(el, ctx) {
  if (!el) return;
  P.el = el;
  P.ctx = ctx;
  el.hidden = true;
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('keydown', onKey);
  await load();
  // Le temps restant se met à jour sans recharger (pas quand l'onglet est caché).
  setInterval(() => { if (!document.hidden && P.data?.pot?.status === 'ouverte' && !P.open && !P.busy) render(); }, 60000);
}
