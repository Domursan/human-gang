// ===== Humane Gang — calendrier de l'Avent du gang (T1, migration 096) =====
/*
 * Rôle : la tuile « Calendrier de l'Avent » de l'accueil (1er → 31 décembre) : 24 cases en papier cadeau, la case du jour
 * s'ouvre à 6 h (heure de Zurich, calculée par le serveur), les cases oubliées se rattrapent jusqu'au 31. Ouvrir une case
 * la déchire (animation coupée si « Effets visuels » est désactivé) et révèle son contenu : Paillettes, carte, souvenir,
 * question bonus ou booster. Quatre cases sont collectives : une jauge montre combien de membres l'ont ouverte ; au seuil,
 * chacun réclame le bonus du gang. Rappel discret sur la page Cartes (cartesReminder).
 * RPC : hg_advent_me, hg_advent_open, hg_advent_answer, hg_advent_claim_group. Tout est vérifié et payé par le serveur ;
 * le contenu d'une case n'arrive qu'une fois la case ouverte.
 * Dépendances : core.js (sb, esc, toast, errMsg, motionAllowed), cartes-ui.js (cardHtml), photos.js (signedUrls), icons.js.
 * Exporte : adventSeason(), mountAdvent(box), cartesReminder(selector).
 */
import { sb, esc, toast, errMsg, motionAllowed } from './core.js';
import { cardHtml, rarityLabel } from './cartes-ui.js';
import { signedUrls } from './photos.js';
import { svg } from './icons.js';
import { loadSeasonCss } from './saisons-css.js';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const KIND_LABEL = { paillettes: 'Paillettes', carte: 'Carte', souvenir: 'Souvenir', question: 'Question', booster: 'Booster' };
const ICON_LOCK = svg('lock', { size: 14 });
const ICON_GANG = svg('users', { size: 12 });

/** Vrai entre le 30 novembre et le 1er janvier (heure locale) : on ne demande le calendrier au serveur qu'à ce moment-là. */
export function adventSeason(d = new Date()) {
  const m = d.getMonth(), j = d.getDate();
  return m === 11 || (m === 10 && j === 30) || (m === 0 && j === 1);
}

/** État de la tuile : réponse de hg_advent_me, case choisie, dernier résultat d'ouverture. */
const A = { data: null, sel: null, box: null, urls: new Map() };

/** Libellé court d'une case ouverte (« +25 », « Carte »…). */
function shortLabel(c) {
  if (!c) return 'Ouverte';
  if (c.kind === 'paillettes') return `+${Number(c.paid ?? c.reward) || 0}`;
  return KIND_LABEL[c.kind] || 'Ouverte';
}

/** HTML d'une case de la grille. */
function cellHtml(d, today) {
  const n = d.day;
  const grp = d.group ? `<span class="av-grp" aria-hidden="true">${ICON_GANG}</span>` : '';
  const sel = A.sel === n;
  if (d.state === 'ouverte') {
    const c = d.content;
    return `<li><button type="button" class="av-cell${sel ? ' is-sel' : ''}" data-day="${n}" aria-pressed="${sel}"
      aria-label="Case du ${n}, ouverte : ${esc(KIND_LABEL[c?.kind] || 'contenu')}${d.group ? ', case collective' : ''}">
      ${grp}<span class="av-n">${n}</span><span class="av-lab av-k-${esc(c?.kind || '')}">${esc(shortLabel(c))}</span></button></li>`;
  }
  if (d.state === 'a_ouvrir') {
    return `<li><button type="button" class="av-cell is-today" data-day="${n}" aria-label="Case du ${n} : à ouvrir aujourd’hui${d.group ? ', case collective' : ''}">
      ${grp}<span class="av-n">${n}</span><span class="av-lab">Ouvrir</span></button></li>`;
  }
  if (d.state === 'a_rattraper') {
    return `<li><button type="button" class="av-cell is-late" data-day="${n}" aria-label="Case du ${n} : à rattraper avant le 31${d.group ? ', case collective' : ''}">
      ${grp}<span class="av-n">${n}</span><span class="av-lab">À rattraper</span></button></li>`;
  }
  return `<li><button type="button" class="av-cell is-locked" data-day="${n}" aria-disabled="true"
    aria-label="Case du ${n} : s’ouvre le ${n} décembre à 6 h${d.group ? ', case collective' : ''}">
    ${grp}<span class="av-n">${n}</span>${d.group ? '' : ICON_LOCK}</button></li>`;
}

/** Sous-titre : « 12 cases ouvertes sur 13 · une à rattraper avant le 31 ». */
function subtitle(data) {
  const late = data.days.filter((d) => d.state === 'a_rattraper').length;
  const opened = data.opened || 0;
  const avail = Math.min(24, data.today || 0);
  if (data.complete) return 'Les 24 cases sont ouvertes : calendrier complet !';
  let s = `${opened} ${opened > 1 ? 'cases ouvertes' : 'case ouverte'} sur ${avail}`;
  if (late) s += ` · ${late === 1 ? 'une' : late} à rattraper avant le 31`;
  if (data.today >= 24 && !late && opened >= 24) s = 'Calendrier complet';
  return s;
}

/** Contenu révélé d'une case ouverte (panneau sous la grille). */
function revealHtml(d) {
  const c = d.content || {};
  const head = `<p class="sz-eyebrow">Case du ${d.day}</p>`;
  if (c.kind === 'carte' && c.card) {
    const card = { ...c.card };
    return `<div class="av-reveal"><div class="av-reveal-media">${cardHtml(card, { size: 'sm', shiny: !!c.shiny, serial: c.serial })}</div>
      <div class="av-reveal-body">${head}<h3 class="av-reveal-title">Tu gagnes une carte ${esc(rarityLabel(card.rarity))}</h3>
      <p class="sz-small sz-muted">« ${esc(card.name)} » rejoint ta collection${card.set_name ? ` (${esc(card.set_name)})` : ''}.${c.paid ? ` Et +${Number(c.paid)} Paillettes.` : ''}</p>
      <a class="btn btn-ghost" href="cartes.html#collection">Voir dans ma collection</a></div></div>`;
  }
  if (c.kind === 'carte') {
    return `<div class="av-reveal"><div class="av-reveal-body">${head}<h3 class="av-reveal-title">Plus d’exemplaire de cette carte</h3>
      <p class="sz-small sz-muted">Elle a trouvé preneur avant toi : tu reçois ${Number(c.paid) || 0} Paillettes à la place.</p></div></div>`;
  }
  if (c.kind === 'souvenir') {
    const m = c.moment, e = c.event;
    const path = m?.image_path || e?.cover_path;
    const url = path ? A.urls.get(path) : null;
    const when = m?.happened_on ? fmtDay(m.happened_on) : e?.starts_at ? fmtDay(e.starts_at) : '';
    const title = m?.title || e?.title || 'Un souvenir du gang';
    return `<div class="av-reveal">${url ? `<div class="av-reveal-media"><img class="av-photo" src="${esc(url)}" alt="" data-on-error="remove"></div>` : ''}
      <div class="av-reveal-body">${head}<h3 class="av-reveal-title">${esc(when ? `${when} : ${title}` : title)}</h3>
      ${m?.body ? `<p class="sz-small sz-muted">${esc(m.body)}</p>` : ''}${e?.location ? `<p class="sz-small sz-muted">${esc(e.location)}</p>` : ''}
      ${c.label ? `<p class="sz-small">${esc(c.label)}</p>` : ''}${c.paid ? `<p class="sz-small">+${Number(c.paid)} Paillettes</p>` : ''}
      <a class="btn btn-ghost" href="historique.html">Revoir l’historique</a></div></div>`;
  }
  if (c.kind === 'question' && c.question) {
    const q = c.question;
    let form = '';
    if (q.answered) {
      form = `<p class="sz-small">${q.correct ? `Bonne réponse${q.reward ? ` : +${Number(q.reward)} Paillettes` : ''} !` : q.correct === false ? 'Raté, ce sera pour la prochaine.' : 'Réponse envoyée, l’admin la vérifie.'}</p>
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
    return `<div class="av-reveal"><div class="av-reveal-body">${head}<h3 class="av-reveal-title">Question bonus</h3>
      <p>${esc(q.prompt)}</p>${q.image_url ? `<img class="av-photo" src="${esc(q.image_url)}" alt="" data-on-error="remove">` : ''}${form}</div></div>`;
  }
  if (c.kind === 'booster') {
    const b = c.booster || {};
    return `<div class="av-reveal"><div class="av-reveal-media"><div class="av-booster"><span><b>Booster</b>${esc(b.name || 'Booster')}<br>${Number(b.size) || 5} cartes</span></div></div>
      <div class="av-reveal-body">${head}<h3 class="av-reveal-title">Un booster ${esc(b.name || '')} pour toi</h3>
      <p class="sz-small sz-muted">Il t’attend dans ton stock, à ouvrir quand tu veux.</p>
      <a class="btn btn-ghost" href="cartes.html#ouverture">L’ouvrir</a></div></div>`;
  }
  return `<div class="av-reveal"><div class="av-reveal-body">${head}<p class="av-big">+${Number(c.paid ?? c.reward) || 0}</p>
    <p class="sz-small sz-muted">Paillettes ajoutées à ton portefeuille.</p>${c.label ? `<p class="sz-small">${esc(c.label)}</p>` : ''}</div></div>`;
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

/** Dessine toute la tuile. */
function render() {
  const data = A.data, box = A.box;
  if (!box || !data?.active) return;
  const sel = data.days.find((d) => d.day === A.sel && d.state === 'ouverte');
  box.innerHTML = `
    <section class="sz-stack" id="avent" aria-labelledby="av-title">
      <div>
        <p class="sz-eyebrow">Décembre ${esc(data.year)} · jour ${Math.max(1, Math.min(24, data.today || 1))}</p>
        <h2 class="sz-title" id="av-title">Calendrier de l’Avent</h2>
        <p class="sz-small sz-muted">${esc(subtitle(data))}</p>
      </div>
      <ul class="av-grid" aria-label="Les 24 cases">${data.days.map((d) => cellHtml(d, data.today)).join('')}</ul>
      <p class="av-legend"><span>${ICON_GANG} Case collective</span><span>${ICON_LOCK} Pas encore</span></p>
      <div id="av-reveal" aria-live="polite">${sel ? revealHtml(sel) : ''}</div>
      ${groupHtml(data)}
    </section>`;
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
  if (A.sel == null) {
    const today = A.data.days.find((d) => d.day === A.data.today);
    if (today?.state === 'ouverte') A.sel = today.day;
  }
}

/** Ouvre une case : animation de déchirure (si permise), appel serveur, puis affichage du contenu. */
async function openDay(btn, day) {
  btn.disabled = true;
  if (motionAllowed()) { btn.classList.add('is-tearing'); await new Promise((r) => setTimeout(r, 600)); }
  try {
    const { data, error } = await sb.rpc('hg_advent_open', { p_day: day });
    if (error) throw error;
    A.sel = day;
    if (data?.badge) toast('Badge « Calendrier complet » débloqué !', 'success');
    else if (data?.fallback) toast(`Carte épuisée : +${Number(data.paid) || 0} Paillettes à la place`, 'success');
    else if (data?.paid) toast(`+${Number(data.paid)} Paillettes`, 'success');
    await load();
    render();
    A.box.querySelector(`.av-cell[data-day="${day}"]`)?.focus();
  } catch (e) {
    btn.classList.remove('is-tearing');
    btn.disabled = false;
    toast(errMsg(e), 'error');
  }
}

/** Branche les clics de la tuile (une seule fois). */
function bind() {
  A.box.addEventListener('click', async (e) => {
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
  A.box.addEventListener('submit', async (e) => {
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
 * Monte le calendrier dans box (accueil). Ne fait rien hors saison ou si le calendrier n'est pas actif.
 * @param {HTMLElement} box Conteneur (vide).
 * @returns {Promise<boolean>} vrai si le calendrier est affiché.
 */
export async function mountAdvent(box) {
  if (!box) return false;
  await load();
  if (!A.data) return false;
  loadSeasonCss({ cards: true });
  A.box = box;
  box.hidden = false;
  render();
  bind();
  if (location.hash === '#avent') requestAnimationFrame(() => box.scrollIntoView({ block: 'start' }));
  return true;
}

/**
 * Rappel discret sur la page Cartes : « La case du jour t'attend » si elle n'est pas encore ouverte.
 * @param {string} selector Élément avant lequel insérer le rappel (cherché après la réponse du serveur).
 */
export async function cartesReminder(selector) {
  if (!adventSeason()) return;
  try {
    const { data, error } = await sb.rpc('hg_advent_me');
    if (error || !data?.active) return;
    const todo = (data.days || []).filter((d) => d.state === 'a_ouvrir' || d.state === 'a_rattraper').length;
    const target = document.querySelector(selector);
    if (!todo || !target) return;
    loadSeasonCss();
    const a = document.createElement('a');
    a.className = 'av-remind';
    a.href = 'accueil.html#avent';
    a.innerHTML = `<span aria-hidden="true">🎁</span><span>${todo > 1 ? `${todo} cases du calendrier de l’Avent t’attendent` : 'Une case du calendrier de l’Avent t’attend'} sur l’accueil.</span>`;
    target.before(a);
  } catch { /* rappel facultatif */ }
}
