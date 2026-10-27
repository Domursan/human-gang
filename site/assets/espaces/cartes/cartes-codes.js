// ===== Cartes : codes cadeaux (idée C9, migration 081) — côté membre =====
// Un QR imprimé ouvre cartes.html#code=HG-XXXX-XXXX : la fenêtre « Code cadeau » s'ouvre, déjà remplie, avec le lot
// (aperçu hg_gift_code_peek) ; « Utiliser le code » appelle hg_gift_code_redeem puis recharge la page (solde, stock,
// collection). On peut aussi taper le code à la main (encart de l'onglet Inventaire, codeBoxHtml).
// Les erreurs du serveur (déjà utilisé, expiré, trop d'essais) sont renvoyées comme réponses, pas comme exceptions.
// Exporte : initCodes(ctx), codeBoxHtml(), codeFromHash(hash), openCode(code).
// ctx = { app, refresh: async () => {}, goTab: (id) => void } (fourni par cartes.js).
import { sb, esc, toast, errMsg } from './core.js';
import { fmtP, rarityLabel } from './cartes-ui.js';

let C = null;
// État de la fenêtre : code saisi, lot affiché (aperçu), résultat de l'utilisation, erreur, action en cours.
const W = { code: '', lot: null, done: null, error: '', busy: false, peeked: '' };
const RE_CODE = /^(?:HG)?[2-9A-HJKMNP-Z]{8}$/;
/** Code saisi normalisé (majuscules, sans espace ni tiret) ; vide si invalide. */
const norm = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Code affiché : HG-XXXX-XXXX (à partir d'une saisie libre). */
function pretty(v) {
  let n = norm(v);
  if (n.length === 10 && n.startsWith('HG')) n = n.slice(2);
  return n.length === 8 ? `HG-${n.slice(0, 4)}-${n.slice(4)}` : String(v || '').toUpperCase().slice(0, 14);
}
/** Vrai si la saisie a la forme d'un code complet. */
const complete = (v) => RE_CODE.test(norm(v));

/**
 * Texte du lot : « 1 booster Doré », « 300 Paillettes », « La carte « X » (Rare, brillante) », et l'expiration.
 * @param {object} lot lot (kind, amount, type_name, card, shiny, expires_at)
 */
export function lotText(lot) {
  if (!lot) return '';
  let t;
  if (lot.kind === 'booster') t = `${lot.amount} booster${lot.amount > 1 ? 's' : ''} ${lot.type_name || lot.type_id || ''}`.trim();
  else if (lot.kind === 'paillettes') t = fmtP(lot.amount);
  else t = `La carte « ${lot.card?.name || '?'} » (${rarityLabel(lot.card?.rarity)}${lot.shiny ? ', brillante' : ''})`;
  if (lot.expires_at) t += ` · valable jusqu’au ${new Intl.DateTimeFormat('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Zurich' }).format(new Date(lot.expires_at))}`;
  return t;
}
/** Titre de la réussite : « Booster Doré ajouté », « 300 ✦ ajoutées », « Carte ajoutée à ta collection ». */
function doneTitle(lot) {
  if (lot.kind === 'booster') return `${lot.amount > 1 ? `${lot.amount} boosters` : 'Booster'} ${lot.type_name || ''} ajouté${lot.amount > 1 ? 's' : ''}`.replace(/\s+/g, ' ');
  if (lot.kind === 'paillettes') return `${fmtP(lot.amount)} ajoutées`;
  return `« ${lot.card?.name || 'Carte'} » ajoutée`;
}

/** Encart de l'onglet Inventaire : saisie à la main. */
export function codeBoxHtml() {
  return `<section class="card cartes-block c2-codebox" aria-labelledby="c2-code-h">
      <h2 id="c2-code-h" class="cart-h">Code cadeau</h2>
      <p class="cartes-small">Un QR sur un gobelet, une affiche ou un colis ? Scanne-le, ou tape le code ici.</p>
      <form class="c2-code-row" data-c2-form="code-inline" novalidate>
        <label class="visually-hidden" for="c2-code-inline">Code cadeau</label>
        <input id="c2-code-inline" class="c2-code-in c2-code-sm" autocomplete="off" autocapitalize="characters" spellcheck="false"
          inputmode="text" maxlength="16" placeholder="HG-XXXX-XXXX">
        <button type="submit" class="btn btn-ghost">Utiliser</button>
      </form>
    </section>`;
}

/** Contenu de la fenêtre « Code cadeau ». */
function dialogBody() {
  const err = W.error ? `<p class="c2-code-err" role="alert">${esc(W.error)}</p>` : '';
  if (W.done) {
    const lot = W.done.lot || {};
    const go = lot.kind === 'booster' ? '<button type="button" class="btn btn-ghost" data-c2="code-go" data-to="ouverture">L’ouvrir</button>'
      : lot.kind === 'carte' ? '<button type="button" class="btn btn-ghost" data-c2="code-go" data-to="collection">La voir</button>' : '';
    const sub = lot.kind === 'booster' ? 'Il t’attend dans l’onglet Ouverture.' : lot.kind === 'carte' ? 'Elle est dans ta collection.' : 'Elles sont sur ton solde.';
    return `<div class="c2-code-ok" role="status">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
        <div><p class="c2-code-ok-t">${esc(doneTitle(lot))}</p><p class="small">${esc(sub)}</p></div>
        ${go}
      </div>
      <div class="btn-row"><button type="button" class="btn btn-ghost" data-c2="code-close">Fermer</button></div>`;
  }
  return `<form class="stack" data-c2-form="code" novalidate>
      <div class="field">
        <label for="c2-code-in">Ton code</label>
        <input id="c2-code-in" class="c2-code-in" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="16"
          placeholder="HG-XXXX-XXXX" value="${esc(W.code)}" aria-describedby="c2-code-help">
      </div>
      ${W.lot ? `<p class="c2-code-lot"><span class="pill pill-sand">Lot</span><span>${esc(lotText(W.lot))}</span></p>` : ''}
      ${err}
      <button type="submit" class="btn btn-sand c2-code-use" ${W.busy ? 'disabled' : ''}>${W.busy ? 'Un instant…' : 'Utiliser le code'}</button>
      <p class="cartes-small" id="c2-code-help">Un code ne sert qu’une fois. Tu peux aussi le taper à la main dans l’Inventaire.</p>
    </form>`;
}

/** Dessine la fenêtre (crée le <dialog> à la première ouverture). */
function draw(focusInput = false) {
  let dlg = document.getElementById('c2-code-dlg');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'c2-code-dlg';
    dlg.className = 'cartes-dialog c2-code-dlg';
    dlg.setAttribute('aria-labelledby', 'c2-code-title');
    C.app.append(dlg);
  }
  dlg.innerHTML = `<div class="cartes-dialog-pad">
      <div class="c2-dlg-head"><h2 id="c2-code-title">Code cadeau</h2>
        <button type="button" class="cartes-close" data-c2="code-close" aria-label="Fermer"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      ${dialogBody()}
    </div>`;
  if (!dlg.open) dlg.showModal();
  if (focusInput) dlg.querySelector('#c2-code-in')?.focus();
  else if (W.done) dlg.querySelector('.c2-code-ok .btn, [data-c2="code-close"]')?.focus();
}

/** Aperçu du lot (une fois par code complet saisi). */
async function peek() {
  if (!complete(W.code) || W.peeked === norm(W.code)) return;
  W.peeked = norm(W.code);
  try {
    const { data, error } = await sb.rpc('hg_gift_code_peek', { p_code: W.code });
    if (error) throw error;
    if (data?.ok) { W.lot = data.lot; W.error = ''; } else { W.lot = null; W.error = data?.message || 'Code invalide.'; }
  } catch (e) { W.error = errMsg(e); }
  draw();
}

/** Utilise le code saisi. */
async function redeem() {
  if (W.busy) return;
  if (!complete(W.code)) { W.error = 'Un code a 8 signes : HG-XXXX-XXXX.'; draw(true); return; }
  W.busy = true; W.error = ''; draw();
  try {
    const { data, error } = await sb.rpc('hg_gift_code_redeem', { p_code: W.code });
    if (error) throw error;
    if (data?.ok) {
      W.done = data; W.busy = false; draw();
      toast(doneTitle(data.lot || {}), 'ok');
      await C.refresh();
      return;
    }
    W.error = data?.message || 'Code invalide.';
  } catch (e) { W.error = errMsg(e); }
  W.busy = false;
  draw(true);
}

/**
 * Ouvre la fenêtre « Code cadeau », remplie avec le code donné (QR) et son lot.
 * @param {string} [code] code lu dans l'adresse ou saisi
 */
export function openCode(code = '') {
  Object.assign(W, { code: pretty(code), lot: null, done: null, error: '', busy: false, peeked: '' });
  draw(!code);
  peek();
}

/**
 * Code présent dans l'adresse (#code=HG-…), ou null.
 * @param {string} hash location.hash
 */
export function codeFromHash(hash) {
  const m = /^#code=([A-Za-z0-9-]{8,16})$/.exec(hash || '');
  return m ? m[1] : null;
}

/**
 * Branche les écouteurs (fenêtre et encart de l'Inventaire). Une seule fois.
 * @param {{app: HTMLElement, refresh: () => Promise<void>, goTab: (id: string) => void}} ctx
 */
export function initCodes(ctx) {
  if (C) return;
  C = ctx;
  ctx.app.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c2^="code-"]');
    if (!b) return;
    const dlg = document.getElementById('c2-code-dlg');
    if (b.dataset.c2 === 'code-close') dlg?.close();
    if (b.dataset.c2 === 'code-go') { dlg?.close(); C.goTab(b.dataset.to); }
  });
  ctx.app.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-c2-form]');
    if (!f) return;
    e.preventDefault();
    if (f.dataset.c2Form === 'code') { W.code = pretty(f.querySelector('#c2-code-in').value); redeem(); }
    if (f.dataset.c2Form === 'code-inline') {
      const v = f.querySelector('#c2-code-inline').value;
      if (!v.trim()) { f.querySelector('#c2-code-inline').focus(); return; }
      openCode(v);
    }
  });
  ctx.app.addEventListener('input', (e) => {
    if (e.target.id !== 'c2-code-in') return;
    W.code = e.target.value;
    if (complete(W.code)) { W.code = pretty(W.code); e.target.value = W.code; peek(); }
    else if (W.lot || W.error) { W.lot = null; W.error = ''; W.peeked = ''; const keep = e.target.selectionStart; draw(true); const i = document.getElementById('c2-code-in'); i?.setSelectionRange(keep, keep); }
  });
}
