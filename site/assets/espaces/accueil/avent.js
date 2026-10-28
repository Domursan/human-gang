// ===== Humane Gang — calendrier de l'Avent du gang (T1, migration 096) =====
/*
 * Rôle : le calendrier de l'Avent (1er → 31 décembre) : 24 cases en papier cadeau, la case du jour s'ouvre à 6 h
 * (heure de Zurich, calculée par le serveur), les cases oubliées se rattrapent jusqu'au 31. Ouvrir une case la déchire
 * (animation coupée si « Effets visuels » est désactivé) et révèle son contenu : Paillettes, carte, souvenir, question
 * bonus ou booster. Quatre cases sont collectives : une jauge montre combien de membres l'ont ouverte ; au seuil,
 * chacun réclame le bonus du gang.
 * Ce module dessine le calendrier dans un conteneur donné : la popup (avent-popup.js), ouverte depuis le paquet cadeau
 * de l'en-tête (avent-gift.js) ou le rappel de la page Cartes (cartesReminder).
 * RPC : hg_advent_me, hg_advent_open, hg_advent_answer, hg_advent_claim_group. Tout est vérifié et payé par le serveur ;
 * le contenu d'une case n'arrive qu'une fois la case ouverte.
 * Dépendances : core.js (sb, esc, toast, errMsg, motionAllowed), cartes-ui.js (cardHtml), photos.js (signedUrls), icons.js,
 * saisons-css.js, avent-date.js, avent-gift.js (adventLeft), avent-popup.js (import dynamique, rappel des Cartes).
 * Exporte : adventSeason(), mountAdvent(box, opts), adventSubtitle(data), cartesReminder(selector).
 */
import { sb, esc, toast, errMsg, motionAllowed } from '../../commun/core.js';
import { cardHtml, rarityLabel } from '../cartes/cartes-ui.js';
import { signedUrls } from '../irl/photos.js';
import { svg } from '../../commun/icons.js';
import { loadSeasonCss } from './saisons-css.js';
import { adventSeason } from './avent-date.js';
import { adventLeft } from './avent-gift.js';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const KIND_LABEL = { paillettes: 'Paillettes', carte: 'Carte', souvenir: 'Souvenir', question: 'Question', booster: 'Booster' };
const ICON_LOCK = svg('lock', { size: 16 });
const ICON_GANG = svg('users', { size: 12 });
/** Icônes des cases (tracées pour le calendrier ; la couleur vient de la classe av-k-<type>). */
const ICON = {
  paillettes: '<svg class="av-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l1.8 5.6L19 9.5l-5.2 1.9L12 17l-1.8-5.6L5 9.5l5.2-1.9z"/><path d="M19 15l.9 2.4 2.1.6-2.1.8L19 21l-.9-2.2-2.1-.8 2.1-.6z" opacity=".7"/></svg>',
  carte: '<svg class="av-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="2"/><path d="M12 8l1.4 2.8 3 .4-2.2 2 .6 3-2.8-1.5-2.8 1.5.6-3-2.2-2 3-.4z" fill="currentColor" stroke="none"/></svg>',
  souvenir: '<svg class="av-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7l1.5-3h5L16 7"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
  question: '<svg class="av-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/></svg>',
  booster: '<svg class="av-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 3h12l-1 3 1 3-1 3 1 3-1 3 1 3H6l1-3-1-3 1-3-1-3 1-3z"/><path d="M10 10h4M10 14h4"/></svg>',
  sablier: '<svg class="av-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 3h12M6 21h12M7 3c0 5 10 6 10 9s-10 4-10 9M17 3c0 5-10 6-10 9s10 4 10 9"/></svg>',
};

export { adventSeason } from './avent-date.js';
export { itemCount, shortN };

/** État du calendrier : réponse de hg_advent_me, case choisie, rendu à faire après une ouverture, rappels de la popup. */
const A = { data: null, sel: null, fresh: null, box: null, urls: new Map(), bound: new WeakSet(), onUpdate: null, onOpened: null };

/** HTML d'une case de la grille. */
function cellHtml(d) {
  const n = d.day;
  const grp = d.group ? `<span class="av-grp" aria-hidden="true">${ICON_GANG}</span>` : '';
  const gTxt = d.group ? ', case collective' : '';
  const sel = A.sel === n;
  if (d.state === 'ouverte') {
    const c = d.content || {};
    const kind = c.kind || '';
    const paid = Number(c.paid ?? c.reward) || 0;
    const others = Math.max(0, itemCount(c) - 1);
    const val = paid > 0 ? `+${shortN(paid)}` : (KIND_LABEL[kind] || '');
    const more = others > 0 ? `<span class="av-more" aria-hidden="true">+${others}</span>` : '';
    const moreTxt = others > 0 ? `, et ${others} autre${others > 1 ? 's' : ''} élément${others > 1 ? 's' : ''}` : '';
    return `<li><button type="button" class="av-cell is-open${sel ? ' is-sel' : ''}" data-day="${n}" aria-pressed="${sel}"
      aria-label="Case du ${n}, ouverte : ${esc(KIND_LABEL[kind] || 'contenu')}${paid > 0 ? `, ${fmtN(paid)} Paillettes` : ''}${moreTxt}${gTxt}">
      ${grp}<span class="av-n">${n}</span><span class="av-k av-k-${esc(kind)}">${ICON[kind] || ''}<span class="av-val${paid > 0 ? '' : ' is-txt'}">${esc(val)}</span></span>${more}</button></li>`;
  }
  if (d.state === 'a_ouvrir') {
    return `<li><button type="button" class="av-cell is-today" data-day="${n}" aria-label="Case du ${n} : à ouvrir aujourd’hui${gTxt}">
      ${grp}<span class="av-n">${n}</span><span class="av-val">Ouvrir</span></button></li>`;
  }
  if (d.state === 'a_rattraper') {
    return `<li><button type="button" class="av-cell is-late" data-day="${n}" aria-label="Case du ${n} : à rattraper avant le 31${gTxt}">
      ${grp}<span class="av-n">${n}</span>${ICON.sablier}<span class="av-val is-txt">À rattraper</span></button></li>`;
  }
  return `<li><button type="button" class="av-cell is-locked" data-day="${n}" aria-disabled="true"
    aria-label="Case du ${n} : s’ouvre le ${n} décembre à 6 h${gTxt}">
    ${grp}<span class="av-n">${n}</span>${d.group ? '' : ICON_LOCK}</button></li>`;
}

/** Sous-titre : « 12 cases ouvertes sur 13 · une à rattraper avant le 31 ». */
export function adventSubtitle(data) {
  const late = data.days.filter((d) => d.state === 'a_rattraper').length;
  const opened = data.opened || 0;
  const avail = Math.min(24, data.today || 0);
  if (data.complete) return 'Les 24 cases sont ouvertes : calendrier complet !';
  let s = `${opened} ${opened > 1 ? 'cases ouvertes' : 'case ouverte'} sur ${avail}`;
  if (late) s += ` · ${late === 1 ? 'une' : late} à rattraper avant le 31`;
  return s;
}

/** Nombre de Paillettes, formaté à la française (espace fine insécable). */
const fmtN = (n) => new Intl.NumberFormat('fr-FR').format(Number(n) || 0);
/** Version courte pour une case de 52 px : « +1,2 M », « +25 000 » -> « +25 k ». */
function shortN(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1).replace('.', ',')} M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1).replace('.', ',')} k`;
  return fmtN(n);
}
/** Éléments d'une case (Paillettes, cartes, boosters, souvenir, question), tous ensemble, avec la compatibilité card/booster. */
function contentItems(c) {
  const cards = Array.isArray(c.cards) && c.cards.length ? c.cards : (c.card ? [{ ...c.card, qty: 1, copies: c.serial ? [{ serial: c.serial, shiny: !!c.shiny }] : [] }] : []);
  const boosters = Array.isArray(c.boosters) && c.boosters.length ? c.boosters : (c.booster ? [{ ...c.booster, qty: 1 }] : []);
  const hasMoment = !!(c.moment || c.event);
  return { cards, boosters, hasMoment, paid: Number(c.paid ?? c.reward) || 0, question: c.question };
}
/** Nombre d'éléments de la case (pour la pastille « +N » de la grille). */
function itemCount(c) {
  const { cards, boosters, hasMoment, paid, question } = contentItems(c || {});
  return (paid > 0 ? 1 : 0) + cards.length + boosters.length + (hasMoment ? 1 : 0) + (question ? 1 : 0);
}

/** Une carte (avec « ×N » si on en a plusieurs exemplaires). */
function cardItemHtml(card, qty, copy) {
  const q = Number(qty) || 1;
  return `<div class="av-rv-item av-rv-card">${cardHtml({ ...card }, { size: 'sm', shiny: !!copy?.shiny, serial: copy?.serial })}${q > 1 ? `<span class="av-qty">×${q}</span>` : ''}</div>`;
}

/** Contenu révélé d'une case ouverte (panneau sous la grille) : tout ce que la case contient. */
function revealHtml(d) {
  const c = d.content || {};
  const { cards, boosters, hasMoment, paid, question } = contentItems(c);
  const head = `<p class="sz-eyebrow">Case du ${d.day}</p>`;
  const parts = [];
  if (paid > 0) parts.push(`<div class="av-rv-item av-rv-paid"><span class="av-big">+${fmtN(paid)}</span><p class="sz-small sz-muted">Paillettes ajoutées à ton portefeuille.</p></div>`);
  for (const card of cards) {
    const copies = Array.isArray(card.copies) ? card.copies : [];
    const qty = Number(card.qty) || copies.length || 1;
    parts.push(cardItemHtml(card, qty, copies[0]));
  }
  for (const b of boosters) {
    const q = Number(b.qty) || 1;
    parts.push(`<div class="av-rv-item av-rv-booster"><div class="av-booster"><span><b>Booster</b>${esc(b.name || 'Booster')}<br>${Number(b.size) || 5} cartes</span></div>
      ${q > 1 ? `<span class="av-qty">×${q}</span>` : ''}<p class="sz-small sz-muted">Un booster ${esc(b.name || '')} à ouvrir quand tu veux.</p>
      <a class="btn btn-ghost" href="/pages/cartes/cartes.html#ouverture">L’ouvrir</a></div>`);
  }
  if (hasMoment) {
    const m = c.moment, e = c.event;
    const path = m?.image_path || e?.cover_path;
    const url = path ? A.urls.get(path) : null;
    const when = m?.happened_on ? fmtDay(m.happened_on) : e?.starts_at ? fmtDay(e.starts_at) : '';
    const title = m?.title || e?.title || 'Un souvenir du gang';
    parts.push(`<div class="av-rv-item av-rv-souvenir">${url ? `<img class="av-photo" src="${esc(url)}" alt="" data-on-error="remove" loading="lazy" decoding="async">` : ''}
      <div class="av-rv-txt"><p class="sz-eyebrow">Souvenir</p><h3 class="av-reveal-title">${esc(when ? `${when} : ${title}` : title)}</h3>
      ${m?.body ? `<p class="sz-small sz-muted">${esc(m.body)}</p>` : ''}${e?.location ? `<p class="sz-small sz-muted">${esc(e.location)}</p>` : ''}
      ${c.label ? `<p class="sz-small">${esc(c.label)}</p>` : ''}
      <a class="btn btn-ghost" href="/pages/irl/historique.html">Revoir l’historique</a></div></div>`);
  }
  if (question) {
    const q = question;
    let form = '';
    if (q.answered) {
      form = `<p class="sz-small">${q.correct ? `Bonne réponse${q.reward ? ` : +${fmtN(q.reward)} Paillettes` : ''} !` : q.correct === false ? 'Raté, ce sera pour la prochaine.' : 'Réponse envoyée, l’admin la vérifie.'}</p>
        ${q.explanation ? `<p class="sz-small sz-muted">${esc(q.explanation)}</p>` : ''}`;
    } else if (['choix_unique', 'vrai_faux', 'choix_multiple'].includes(q.qtype)) {
      const multi = q.qtype === 'choix_multiple';
      form = `<form class="av-q" data-q="${d.day}"><fieldset><legend class="visually-hidden">Ta réponse</legend>
        ${(q.options || []).map((o) => `<label class="av-opt"><input type="${multi ? 'checkbox' : 'radio'}" name="avq" value="${esc(o.id)}"><span>${esc(o.text)}</span></label>`).join('')}
        </fieldset><button class="btn btn-sand" type="submit">Répondre</button></form>`;
    } else {
      form = `<form class="av-q" data-q="${d.day}"><label class="visually-hidden" for="avq-t">Ta réponse</label>
        <input id="avq-t" name="avq" type="text" maxlength="200" autocomplete="off" ${q.qtype === 'nombre' ? 'inputmode="decimal"' : ''}>
        <button class="btn btn-sand" type="submit">Répondre</button></form>`;
    }
    parts.push(`<div class="av-rv-item av-rv-question"><div class="av-rv-txt"><p class="sz-eyebrow">Question bonus</p><h3 class="av-reveal-title">${esc(q.prompt)}</h3>
      ${q.image_url ? `<img class="av-photo" src="${esc(q.image_url)}" alt="" data-on-error="remove" loading="lazy" decoding="async">` : ''}${form}</div></div>`);
  }
  if (c.missing || d.missing) parts.push(`<p class="sz-small sz-muted av-rv-note">Exemplaire épuisé : les Paillettes remplacent la carte.</p>`);
  if (!parts.length) parts.push(`<p class="sz-small sz-muted">Rien dans cette case.</p>`);
  return `${head}<div class="av-rv-items">${parts.join('')}</div>`;
}

/** Jauge de la case collective (choisie, sinon celle du jour, sinon la prochaine). */
function groupHtml(data) {
  const pick = data.days.find((d) => d.day === A.sel && d.group)
    || data.days.find((d) => d.day === data.today && d.group)
    || data.days.find((d) => d.group && d.day <= data.today && d.state === 'ouverte' && !d.group_claimed);
  if (!pick) return '';
  const cnt = Number(pick.group_count) || 0, tgt = Number(pick.group_target) || 1;
  const pct = Math.min(100, Math.round((cnt / tgt) * 100));
  const ready = cnt >= tgt;
  let action = '';
  if (pick.state !== 'ouverte') action = `<p class="sz-small sz-muted">Ouvre la case du ${pick.day} pour compter dans la jauge.</p>`;
  else if (pick.group_claimed) action = '<p class="sz-small sz-muted">Bonus réclamé. Merci d’avoir joué collectif !</p>';
  else if (ready) action = `<button class="btn btn-sand" type="button" data-claim="${pick.day}">Réclamer ${Number(pick.group_reward) || 0} Paillettes</button>`;
  else action = `<p class="sz-small sz-muted">Encore ${tgt - cnt} ${tgt - cnt > 1 ? 'membres' : 'membre'} et tout le monde reçoit ${Number(pick.group_reward) || 0} Paillettes.</p>`;
  return `<div class="sz-card av-group"><div class="sz-between"><h3 class="sz-h3">${ICON_GANG} Bonus du gang du ${pick.day}</h3>
    <span class="av-count">${cnt} / ${tgt}</span></div>
    <div class="sz-gauge" role="progressbar" aria-label="Membres qui ont ouvert la case du ${pick.day}" aria-valuemin="0" aria-valuemax="${tgt}" aria-valuenow="${Math.min(cnt, tgt)}"><span style="width:${pct}%"></span></div>
    ${action}</div>`;
}

/** Date courte en français (« 7 décembre 2024 »). */
function fmtDay(v) {
  const s = String(v).slice(0, 10).split('-').map(Number);
  if (s.length < 3 || !s[0]) return '';
  return `${s[2]} ${MOIS[s[1] - 1]} ${s[0]}`;
}

/** Dessine le calendrier dans son conteneur, puis prévient l'appelant (titre et paquet). */
function render() {
  const data = A.data, box = A.box;
  if (!box || !data?.active) return;
  const sel = data.days.find((d) => d.day === A.sel && d.state === 'ouverte');
  const fresh = !!sel && A.fresh === sel.day;
  A.fresh = null;
  box.innerHTML = `
    <p class="av-legend">
      <span><i class="av-sw is-today"></i>À ouvrir aujourd’hui</span>
      <span><i class="av-sw is-late"></i>À rattraper</span>
      <span><i class="av-sw is-locked"></i>Pas encore</span>
      <span>${ICON_GANG} Case collective</span>
    </p>
    <ul class="av-grid" aria-label="Les 24 cases">${data.days.map((d) => cellHtml(d)).join('')}</ul>
    <div class="av-rv${fresh ? ' is-new' : ''}" aria-live="polite">${sel ? revealHtml(sel) : ''}</div>
    ${groupHtml(data)}`;
  A.onUpdate?.(data);
}

/** Charge (ou recharge) le calendrier depuis le serveur, avec les adresses des photos des souvenirs. */
async function load() {
  const { data, error } = await sb.rpc('hg_advent_me');
  if (error) throw error;
  A.data = data && data.active && Array.isArray(data.days) ? data : null;
  if (!A.data) return;
  const paths = A.data.days.map((d) => d.content?.moment?.image_path || d.content?.event?.cover_path).filter(Boolean);
  if (paths.length) {
    try { for (const [k, v] of await signedUrls(paths)) A.urls.set(k, v); } catch { /* sans photo */ }
  }
}

/** Ouvre une case : animation de déchirure (si permise), appel serveur, puis affichage du contenu. */
async function openDay(btn, day) {
  btn.disabled = true;
  if (motionAllowed()) { btn.classList.add('is-tearing'); await new Promise((r) => setTimeout(r, 600)); }
  try {
    const { data, error } = await sb.rpc('hg_advent_open', { p_day: day });
    if (error) throw error;
    A.sel = day; A.fresh = day;
    if (data?.badge) toast('Badge « Calendrier complet » débloqué !', 'success');
    else if (data?.fallback) toast(`Carte épuisée : +${Number(data.paid) || 0} Paillettes à la place`, 'success');
    else if (data?.paid) toast(`+${Number(data.paid)} Paillettes`, 'success');
    await load();
    render();
    A.onOpened?.(day);
    A.box.querySelector(`.av-cell[data-day="${day}"]`)?.focus();
  } catch (e) {
    btn.classList.remove('is-tearing');
    btn.disabled = false;
    toast(errMsg(e), 'error');
  }
}

/** Branche les clics et les réponses du calendrier (une seule fois par conteneur). */
function bind(box) {
  if (A.bound.has(box)) return;
  A.bound.add(box);
  box.addEventListener('click', async (e) => {
    const cell = e.target.closest('.av-cell');
    if (cell) {
      const day = Number(cell.dataset.day);
      const d = A.data.days.find((x) => x.day === day);
      if (!d) return;
      if (d.state === 'verrouillee') { toast(`Patience : la case du ${day} s’ouvre le ${day} décembre à 6 h.`); return; }
      if (d.state === 'ouverte') { A.sel = day; render(); A.box.querySelector(`.av-cell[data-day="${day}"]`)?.focus(); return; }
      await openDay(cell, day);
      return;
    }
    const claim = e.target.closest('[data-claim]');
    if (claim) {
      claim.disabled = true;
      try {
        const { data, error } = await sb.rpc('hg_advent_claim_group', { p_day: Number(claim.dataset.claim) });
        if (error) throw error;
        toast(data?.paid ? `Bonus du gang : +${Number(data.paid)} Paillettes` : 'Bonus déjà réclamé', 'success');
        await load(); render();
      } catch (err) { claim.disabled = false; toast(errMsg(err), 'error'); }
    }
  });
  box.addEventListener('submit', async (e) => {
    const f = e.target.closest('form.av-q');
    if (!f) return;
    e.preventDefault();
    const day = Number(f.dataset.q);
    const checked = [...f.querySelectorAll('input[name="avq"]:checked')].map((i) => i.value);
    const txt = f.querySelector('input[type="text"]')?.value?.trim();
    const resp = txt !== undefined ? txt : checked;
    if (!resp || (Array.isArray(resp) && !resp.length)) { toast('Choisis ou écris une réponse', 'error'); return; }
    const b = f.querySelector('button'); b.disabled = true;
    try {
      const { data, error } = await sb.rpc('hg_advent_answer', { p_day: day, p_response: resp });
      if (error) throw error;
      toast(data?.correct ? `Bonne réponse${data.reward ? ` : +${Number(data.reward)} Paillettes` : ''} !` : data?.correct === false ? 'Raté !' : 'Réponse envoyée', data?.correct ? 'success' : undefined);
      await load(); render();
    } catch (err) { b.disabled = false; toast(errMsg(err), 'error'); }
  });
}

/**
 * Monte le calendrier dans box (la popup). Chaque appel repart d'une case non choisie.
 * @param {HTMLElement} box Conteneur vide ou à remplacer.
 * @param {{onUpdate?: (data: object) => void, onOpened?: (day: number) => void}} [opts]
 *   onUpdate : à chaque rendu (sous-titre, paquet) ; onOpened : après l'ouverture d'une case (pluie).
 * @returns {Promise<boolean>} vrai si le calendrier est affiché (faux s'il n'est pas actif).
 */
export async function mountAdvent(box, opts = {}) {
  if (!box) return false;
  A.box = box; A.sel = null; A.fresh = null;
  A.onUpdate = opts.onUpdate || null;
  A.onOpened = opts.onOpened || null;
  await load();
  if (!A.data) return false;
  loadSeasonCss({ cards: true, popup: true });
  bind(box);
  render();
  return true;
}

/**
 * Rappel discret sur la page Cartes : « La case du jour t'attend » si elle n'est pas encore ouverte. Un clic ouvre la popup.
 * @param {string} selector Élément avant lequel insérer le rappel (cherché après la réponse du serveur).
 */
export async function cartesReminder(selector) {
  if (!adventSeason()) return;
  try {
    const { data, error } = await sb.rpc('hg_advent_me');
    if (error || !data?.active) return;
    const todo = adventLeft(data);
    const target = document.querySelector(selector);
    if (!todo || !target) return;
    loadSeasonCss({ popup: true });
    const a = document.createElement('button');
    a.type = 'button';
    a.className = 'av-remind';
    a.innerHTML = `<span aria-hidden="true">🎁</span><span>${todo > 1 ? `${todo} cases du calendrier de l’Avent t’attendent` : 'Une case du calendrier de l’Avent t’attend'}.</span>`;
    a.addEventListener('click', () => {
      import('./avent-popup.js').then((m) => m.openAvent({ returnTo: a })).catch((e) => console.warn('[avent]', e));
    });
    target.before(a);
  } catch { /* rappel facultatif */ }
}
