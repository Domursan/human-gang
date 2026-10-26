// ===== Humane Gang — présence (en ligne / hors ligne) et notifications du site (migration 153) =====
/*
 * Rôle :
 *   1. Signal de vie : tant qu'une page du site est ouverte et visible, hg_presence_ping() toutes les 50 s. Le membre est
 *      « en ligne » pendant 2 minutes après le dernier signal ; le bot Discord ne lui envoie alors pas de MP (une
 *      notification du site suffit, voir supabase/functions/_shared/presence.ts).
 *   2. Cloche de l'en-tête : nombre de notifications non lues, liste (hg_mes_notifs), « Tout marquer comme lu »
 *      (hg_notifs_lues), réglage « Masquer mon statut en ligne » (hg_presence_masquer). Une nouvelle notification arrive en
 *      direct (canal privé Realtime « notif:<id> ») et s'affiche aussi en message temporaire.
 *   3. Pastilles de statut : tout élément [data-presence="<uuid>"] reçoit la classe is-online et un libellé « En ligne »
 *      ou « Hors ligne » (hg_en_ligne, par lots, rafraîchi toutes les 60 s et à chaque ajout dans la page).
 *      presenceDot(id) fabrique cette pastille ; avatarPresence(html, id) l'ajoute sur un avatar.
 * Page : toutes (init.js appelle startPresence(profil) pour un membre connecté).
 * Dépendances : supabase.js (sb), ui.js (toast), util.js (esc).
 * Exporte : startPresence, presenceDot, avatarPresence.
 */
import { sb } from './supabase.js';
import { toast } from './ui.js';
import { esc } from './util.js';

/** Intervalle du signal de vie (ms) : sous les 2 minutes de la fenêtre « en ligne ». */
const PING_MS = 50000;
/** Intervalle de rafraîchissement des pastilles (ms). */
const STATUTS_MS = 60000;
/** Pictogramme de la cloche (trait). */
const ICON_CLOCHE = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
/** Libellés des catégories (petite étiquette dans la liste). */
const CATS = { messages: 'Message', sorties: 'Sortie', echanges: 'Échange', souhaits: 'Cartes', santa: 'Secret Santa',
  anniversaires: 'Anniversaire', jeux: 'Jeux', annonces: 'Annonce', info: 'Info' };

/** Feuille de style de la cloche et des pastilles (assets/css/notifs.css), ajoutée une fois. */
function chargerCss() {
  if (document.querySelector('link[data-css="notifs"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('../../css/notifs.css', import.meta.url).href; l.dataset.css = 'notifs';
  document.head.append(l);
}

const P = { me: null, timer: null, nonLues: 0, liste: null, masque: false, canal: null, ouvert: false, demarre: false };

/* ---------- Pastilles de statut ---------- */

/**
 * Pastille de statut d'un membre (mise à jour automatiquement : « En ligne » / « Hors ligne »).
 * @param {string} id Identifiant du membre.
 * @returns {string} HTML
 */
export function presenceDot(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ''))) return '';
  return `<span class="presence-dot" data-presence="${esc(id)}" role="img" aria-label="Hors ligne" title="Hors ligne"></span>`;
}

/**
 * Ajoute la pastille de statut en bas à droite d'un avatar.
 * @param {string} avatar HTML de l'avatar (avatarHtml).
 * @param {string} id Identifiant du membre.
 * @returns {string} HTML
 */
export function avatarPresence(avatar, id) {
  const dot = presenceDot(id);
  return dot ? `<span class="presence-wrap">${avatar}${dot}</span>` : avatar;
}

/** « il y a 5 min », « il y a 3 h », « le 12 oct. ». */
function depuis(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 60) return `il y a ${Math.max(1, min)} min`;
  if (min < 24 * 60) return `il y a ${Math.round(min / 60)} h`;
  return `le ${new Date(t).toLocaleDateString('fr-CH', { day: 'numeric', month: 'short' })}`;
}

let statutsTimer = null, statutsAttente = null;
/** Met à jour toutes les pastilles de la page (une requête pour tous les membres affichés). */
async function majStatuts() {
  const els = [...document.querySelectorAll('[data-presence]')];
  const ids = [...new Set(els.map((el) => el.dataset.presence))].slice(0, 500);
  if (!ids.length) return;
  try {
    const { data, error } = await sb.rpc('hg_en_ligne', { p_ids: ids });
    if (error) throw error;
    const m = new Map((data || []).map((r) => [r.user_id, r]));
    for (const el of els) {
      const r = m.get(el.dataset.presence);
      const on = !!r?.en_ligne;
      el.classList.toggle('is-online', on);
      const txt = on ? 'En ligne' : `Hors ligne${r?.vu_at ? ` (vu ${depuis(r.vu_at)})` : ''}`;
      el.setAttribute('aria-label', txt);
      el.title = txt;
    }
  } catch (e) {
    console.warn('[présence] statuts', e?.message || e);
  }
}
/** Mise à jour groupée (plusieurs ajouts dans la page = une seule requête). */
function majStatutsBientot() {
  clearTimeout(statutsAttente);
  statutsAttente = setTimeout(majStatuts, 300);
}

/* ---------- Signal de vie ---------- */

/** Envoie le signal de vie et met le compteur de la cloche à jour. */
async function ping() {
  if (document.hidden) return;
  try {
    const { data, error } = await sb.rpc('hg_presence_ping');
    if (error) throw error;
    if (Number.isFinite(Number(data)) && Number(data) !== P.nonLues) { P.nonLues = Number(data); P.liste = null; peindreCloche(); }
  } catch (e) {
    console.warn('[présence] signal', e?.message || e);
  }
}

/* ---------- Cloche et liste des notifications ---------- */

/** Relit mes notifications (liste et non lues). */
async function charger() {
  const { data, error } = await sb.rpc('hg_mes_notifs', { p_limite: 30 });
  if (error) throw error;
  P.liste = data?.liste || [];
  P.nonLues = Number(data?.non_lues) || 0;
  P.masque = !!data?.masque;
  return data;
}

/** Bouton de la cloche : pastille du nombre de non lues. */
function peindreCloche() {
  const b = document.getElementById('notif-btn');
  if (!b) return;
  const n = P.nonLues;
  const badge = b.querySelector('.notif-badge');
  badge.textContent = n > 99 ? '99+' : String(n);
  badge.hidden = n <= 0;
  b.setAttribute('aria-label', n ? `Notifications : ${n} non lue${n > 1 ? 's' : ''}` : 'Notifications');
  b.title = b.getAttribute('aria-label');
}

/** Contenu du panneau (liste, actions, réglage du statut). */
function panneauHtml() {
  const liste = P.liste === null ? '<p class="small muted notif-vide">Chargement…</p>'
    : !P.liste.length ? '<p class="small muted notif-vide">Aucune notification pour l’instant.</p>'
    : `<ul class="notif-liste">${P.liste.map((n) => {
      const corps = `<span class="notif-cat">${esc(CATS[n.cat] || CATS.info)}</span>
        <strong class="notif-titre">${esc(n.titre)}</strong>
        ${n.texte ? `<span class="notif-texte">${esc(n.texte)}</span>` : ''}
        <span class="notif-quand">${esc(depuis(n.created_at))}</span>`;
      const cls = `notif-item${n.lu ? '' : ' is-new'}`;
      const nonLu = n.lu ? '' : '<span class="visually-hidden">Non lue. </span>';
      return `<li>${n.lien
        ? `<a class="${cls}" href="${esc(n.lien)}" data-notif="${esc(n.id)}">${nonLu}${corps}</a>`
        : `<div class="${cls}" data-notif="${esc(n.id)}">${nonLu}${corps}</div>`}</li>`;
    }).join('')}</ul>`;
  return `<div class="notif-head"><h2 class="notif-h" id="notif-h">Notifications</h2>
      <button type="button" class="btn btn-ghost btn-sm" data-notif-act="lire"${P.nonLues ? '' : ' disabled'}>Tout marquer comme lu</button></div>
    ${liste}
    <label class="check notif-statut"><input type="checkbox" data-notif-act="masquer"${P.masque ? ' checked' : ''}>
      <span>Masquer mon statut « en ligne » aux autres membres</span></label>
    <p class="small muted notif-aide">Quand tu es sur le site, le bot ne t’envoie pas de message privé : la notification arrive ici.</p>`;
}

/** Ouvre ou ferme le panneau. */
async function basculer(ouvrir = !P.ouvert) {
  const b = document.getElementById('notif-btn');
  const box = document.getElementById('notif-panel');
  if (!b || !box) return;
  P.ouvert = ouvrir;
  b.setAttribute('aria-expanded', String(ouvrir));
  box.hidden = !ouvrir;
  if (!ouvrir) return;
  box.innerHTML = panneauHtml();
  try { await charger(); } catch (e) { console.warn('[notifs]', e?.message || e); }
  if (!P.ouvert) return;
  box.innerHTML = panneauHtml();
  peindreCloche();
  box.querySelector('.notif-item, button, input')?.focus({ preventScroll: true });
}

/** Marque des notifications comme lues (toutes si ids est absent). */
async function marquerLues(ids = null) {
  try {
    const { error } = await sb.rpc('hg_notifs_lues', { p_ids: ids });
    if (error) throw error;
    for (const n of P.liste || []) if (!ids || ids.includes(Number(n.id))) n.lu = true;
    P.nonLues = ids ? Math.max(0, P.nonLues - ids.length) : 0;
    peindreCloche();
    const box = document.getElementById('notif-panel');
    if (box && !box.hidden) box.innerHTML = panneauHtml();
  } catch (e) {
    toast(e?.message || String(e), 'error');
  }
}

/** Place la cloche dans l'en-tête (avant le bouton du compte). */
function monterCloche() {
  const outils = document.querySelector('.site-header .nav-tools');
  if (!outils || document.getElementById('notif-btn')) return;
  const wrap = document.createElement('div');
  wrap.className = 'notif-wrap';
  wrap.innerHTML = `<button type="button" class="nav-icon notif-btn" id="notif-btn" aria-haspopup="true" aria-expanded="false" aria-controls="notif-panel" aria-label="Notifications" title="Notifications">${ICON_CLOCHE}<span class="notif-badge" aria-hidden="true" hidden>0</span></button>
    <div class="notif-panel" id="notif-panel" role="region" aria-labelledby="notif-h" hidden></div>`;
  const moi = outils.querySelector('.nav-me');
  outils.insertBefore(wrap, moi || null);
  const b = wrap.querySelector('#notif-btn');
  const box = wrap.querySelector('#notif-panel');
  b.addEventListener('click', () => basculer());
  box.addEventListener('click', (ev) => {
    const lien = ev.target.closest('[data-notif]');
    if (lien) { const n = (P.liste || []).find((x) => String(x.id) === lien.dataset.notif); if (n && !n.lu) marquerLues([Number(n.id)]); }
    if (ev.target.closest('[data-notif-act="lire"]')) marquerLues();
  });
  box.addEventListener('change', async (ev) => {
    const c = ev.target.closest('[data-notif-act="masquer"]');
    if (!c) return;
    try {
      const { error } = await sb.rpc('hg_presence_masquer', { p_masque: c.checked });
      if (error) throw error;
      P.masque = c.checked;
      toast(c.checked ? 'Ton statut en ligne est masqué.' : 'Ton statut en ligne est visible.', 'ok');
    } catch (e) { c.checked = !c.checked; toast(e?.message || String(e), 'error'); }
  });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && P.ouvert) { basculer(false); b.focus(); } });
  // composedPath : le panneau a pu être redessiné pendant le clic (la cible n'est alors plus dans la page)
  document.addEventListener('click', (ev) => { if (P.ouvert && !ev.composedPath().includes(wrap)) basculer(false); });
  peindreCloche();
}

/** Canal privé « notif:<moi> » : une nouvelle notification met la cloche à jour et s'affiche en message temporaire. */
function ecouter() {
  try {
    P.canal = sb.channel(`notif:${P.me.id}`, { config: { private: true, broadcast: { self: false } } })
      .on('broadcast', { event: 'notif' }, async () => {
        try {
          const avant = new Set((P.liste || []).map((n) => String(n.id)));
          await charger();
          peindreCloche();
          const nouvelle = (P.liste || []).find((n) => !n.lu && !avant.has(String(n.id)));
          if (nouvelle) toast(`🔔 ${nouvelle.titre}`);
          const box = document.getElementById('notif-panel');
          if (box && !box.hidden) box.innerHTML = panneauHtml();
        } catch (e) { console.warn('[notifs] direct', e?.message || e); }
      });
    P.canal.subscribe();
  } catch (e) {
    console.warn('[notifs] temps réel indisponible', e?.message || e);
  }
}

/**
 * Démarre la présence pour le membre connecté : signal de vie, cloche, notifications en direct, pastilles de statut.
 * Sans effet pour un visiteur ; ne lève jamais d'erreur.
 * @param {{id: string}|null} profile Profil connecté.
 */
export function startPresence(profile) {
  if (!profile?.id || P.demarre) return;
  P.demarre = true;
  P.me = profile;
  try {
    chargerCss();
    monterCloche();
    ping();
    P.timer = setInterval(ping, PING_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { ping(); majStatuts(); } });
    ecouter();
    // Pastilles : premier passage, puis à chaque ajout dans la page et toutes les 60 s.
    majStatuts();
    statutsTimer = setInterval(() => { if (!document.hidden) majStatuts(); }, STATUTS_MS);
    new MutationObserver((muts) => {
      if (muts.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches?.('[data-presence]') || n.querySelector?.('[data-presence]'))))) majStatutsBientot();
    }).observe(document.body, { childList: true, subtree: true });
  } catch (e) {
    console.warn('[présence]', e?.message || e);
  }
}
