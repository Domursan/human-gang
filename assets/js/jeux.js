// ===== Humane Gang — page « Jeux » (jeux.html) : tableau de bord « Les missions du jour » et un onglet par jeu =====
/*
 * Rôle : construit la barre d'onglets (liste de assets/js/jeux/onglets.js), précédée de l'onglet « Les missions du jour »
 * (programme du jour : chaque jeu avec son état, Paillettes gagnées aujourd'hui). Charge le module d'un jeu à la
 * première ouverture de son onglet et lui confie son panneau. L'onglet choisi est dans l'adresse (jeux.html#geo) et
 * retenu dans le stockage local pour la visite suivante. Un choix propre à un jeu suit le nom de l'onglet dans l'adresse
 * (jeux.html#arcade-raclette) : il est passé au module dans ctx.sub, et l'événement « jeux:sub » le signale quand il change.
 * Mise en page (maquettes JEUX / JEUX-PC) : sur téléphone, pastilles qui défilent horizontalement (la page, elle, ne
 * défile pas de côté) ; sur grand écran, colonne d'onglets à gauche, groupée (Chaque jour, Chaque semaine, Compétition).
 * Accessibilité : motif ARIA des onglets, flèches (gauche/droite et haut/bas), Début et Fin, un seul onglet dans
 * l'ordre de tabulation.
 * Page : jeux.html (session membre requise).
 * Dépendances : core.js (initPage, sb, toast, esc, $), jeux/onglets.js, jeux/commun.js, modules jeux/<id>.js.
 * Le fichier n'exporte rien.
 */
import { sb, initPage, toast, esc, $ } from './core.js';
import { ONGLETS } from './jeux/onglets.js';
import { nf, jourLong, zurichIso } from './jeux/commun.js';

/* ---------- Initialisation : session membre requise ---------- */
const me = await initPage();

/* ---------- Constantes et état ---------- */
/** Clé du stockage local : dernier onglet ouvert. */
const CLE = 'hg_jeux_onglet';
/** Identifiant réservé au tableau de bord. */
const HUB = 'aujourdhui';
/** Forme d'un identifiant d'onglet valide. */
const ID_RE = /^[a-z0-9][a-z0-9-]{0,30}$/;
/** Groupes de la colonne d'onglets (grand écran) et du tableau de bord, dans l'ordre. */
const GROUPES = [['jour', 'Chaque jour'], ['semaine', 'Chaque semaine'], ['competition', 'Compétition']];
/** Icône du tableau de bord (étincelle). */
const ICONE_HUB = '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>';
/** Icône par défaut d'un jeu (manette). */
const ICONE_DEF = '<rect x="2" y="7" width="20" height="10" rx="4"/><path d="M7 10v4M5 12h4M15 11h.01M18 13h.01"/>';
/** Jeux valides, sans doublon, rangés par groupe (l'ordre de onglets.js est gardé dans chaque groupe). */
const JEUX = GROUPES.flatMap(([g]) => ONGLETS.filter((o, i, a) => o && ID_RE.test(o.id) && o.id !== HUB && o.module
  && a.findIndex((x) => x.id === o.id) === i && (GROUPES.some(([k]) => k === o.rythme) ? o.rythme : 'jour') === g)
  .map((o) => ({ ...o, rythme: GROUPES.some(([k]) => k === o.rythme) ? o.rythme : 'jour' })));
/** Tous les onglets : le tableau de bord puis les jeux. */
const LISTE = [{ id: HUB, titre: 'Les missions du jour', icone: ICONE_HUB, hub: true }, ...JEUX];
/** Dossier des modules (les chemins de onglets.js lui sont relatifs). */
const BASE = new URL('./jeux/', import.meta.url);
/** Contexte passé aux modules. sub : choix propre à un jeu tiré de l'adresse (null si aucun). */
const CTX = { sb, me, toast, esc, sub: null };
// État : onglet affiché ; modules montés (id -> module) ; montages en cours ; modules importés ; résumés (id -> résumé).
const S = { cur: null, mods: new Map(), loading: new Map(), imports: new Map(), resumes: new Map() };

const tablist = $('#jeux-tabs');
const panels = $('#jeux-panels');
const app = $('#app');

/* ---------- Outils ---------- */
/** SVG d'icône (trait, 24 × 24). */
const svg = (inner, cls = 'jeux-ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${inner || ICONE_DEF}</svg>`;
/** Couleur d'icône sûre : variable CSS ou hexadécimal, sinon sable. */
const couleur = (c) => (/^(var\(--[a-z0-9-]+\)|#[0-9a-f]{3,8})$/i.test(c || '') ? c : 'var(--sand)');
/** Dernier onglet retenu, ou null (stockage indisponible : sans importance). */
function lireMemoire() { try { return localStorage.getItem(CLE); } catch { return null; } }
/** Retient l'onglet ouvert. */
function retenir(id) { try { localStorage.setItem(CLE, id); } catch { /* stockage bloqué : rien à faire */ } }
/**
 * Onglet et choix lus dans l'adresse : #geo → { id: 'geo', sub: null } ; #arcade-raclette → { id: 'arcade', sub: 'raclette' } ;
 * adresse inconnue → { id: null, sub: null }.
 */
function lireAdresse() {
  const h = decodeURIComponent(location.hash.slice(1)).split('/')[0];
  if (LISTE.some((o) => o.id === h)) return { id: h, sub: null };
  const o = LISTE.find((x) => !x.hub && h.startsWith(`${x.id}-`) && h.length > x.id.length + 1);
  return o ? { id: o.id, sub: h.slice(o.id.length + 1) } : { id: null, sub: null };
}
/**
 * Importe le module d'un jeu (une seule fois).
 * @param {object} o Ligne de ONGLETS.
 * @returns {Promise<object>} Le module.
 */
function importer(o) {
  if (!S.imports.has(o.id)) {
    const p = import(new URL(o.module, BASE).href);
    p.catch(() => S.imports.delete(o.id)); // nouvelle tentative possible
    S.imports.set(o.id, p);
  }
  return S.imports.get(o.id);
}

/* ---------- Construction ---------- */
/** Bouton d'onglet. */
function tabHtml(o) {
  return `<button class="jeux-tab" type="button" role="tab" id="jeux-tab-${o.id}" aria-controls="jeux-panel-${o.id}"
      aria-selected="false" tabindex="-1" data-id="${o.id}">${svg(o.icone)}<span class="jeux-tab-t">${esc(o.titre)}</span><span class="jeux-tab-st" data-st="${o.id}"></span></button>`;
}

/** Barre d'onglets (groupes décoratifs pour le grand écran) et panneaux vides. */
function construire() {
  let h = tabHtml(LISTE[0]);
  for (const [g, label] of GROUPES) {
    const jeux = JEUX.filter((o) => o.rythme === g);
    if (!jeux.length) continue;
    h += `<span class="jeux-tabs-grp" aria-hidden="true">${esc(label)}</span>${jeux.map(tabHtml).join('')}`;
  }
  tablist.innerHTML = h;
  panels.innerHTML = LISTE.map((o) => `<section class="jeux-panel" role="tabpanel" id="jeux-panel-${o.id}"
      aria-labelledby="jeux-tab-${o.id}" tabindex="0" data-id="${o.id}" hidden></section>`).join('');
  // Orientation annoncée selon la mise en page (colonne à gauche sur grand écran)
  const mq = matchMedia('(min-width: 1024px)');
  const orient = () => tablist.setAttribute('aria-orientation', mq.matches ? 'vertical' : 'horizontal');
  orient();
  mq.addEventListener?.('change', orient);
}

/* ---------- Tableau de bord « Les missions du jour » ---------- */
/** Pastille d'état d'un jeu. */
function badgeHtml(r) {
  if (!r) return '<span class="pill jeux-pill-sand">Ouvrir</span>';
  const t = esc(r.badge || (r.etat === 'fait' ? 'Fait' : r.etat === 'a_jouer' ? 'À jouer' : ''));
  if (!t) return '';
  if (r.etat === 'fait') return `<span class="pill pill-ok"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>${t}</span>`;
  if (r.etat === 'a_jouer') return `<span class="pill jeux-pill-sand">${t}</span>`;
  if (r.etat === 'en_cours') return `<span class="pill jeux-pill-amber">${t}</span>`;
  return `<span class="pill">${t}</span>`;
}

/** Monte le tableau de bord (structure), puis le remplit avec les résumés des jeux. */
function monterHub(panel) {
  panel.innerHTML = `<div class="jeux-hub">
      <section class="jg-card jeux-prog" aria-labelledby="jeux-prog-h">
        <div class="jg-between"><h2 class="jg-h3" id="jeux-prog-h">Ton programme du jour</h2>
          <span class="jeux-serie" id="jeux-serie" hidden></span></div>
        <div class="jeux-bar" role="progressbar" aria-labelledby="jeux-prog-h" aria-valuemin="0" aria-valuemax="${JEUX.length}" aria-valuenow="0" id="jeux-bar"><i></i></div>
        <p class="small muted" id="jeux-prog-txt">Chargement de tes jeux…</p>
      </section>
      <div class="jeux-hub-cards" id="jeux-hub-cards"></div>
      ${GROUPES.map(([g, label]) => {
        const jeux = JEUX.filter((o) => o.rythme === g);
        return jeux.length ? `<section class="jg-card jeux-hub-list" aria-labelledby="jeux-grp-${g}">
          <h2 class="jeux-lbl" id="jeux-grp-${g}">${esc(label)}</h2>
          <ul class="jeux-rows">${jeux.map((o) => `<li><button class="jeux-row" type="button" data-open="${o.id}">
              <span class="jeux-tile" style="color:${couleur(o.couleur)}">${svg(o.icone, 'jeux-gi')}</span>
              <span class="jeux-row-txt"><span class="jeux-row-t">${esc(o.titre)}</span><span class="small muted jeux-row-s" data-sub="${o.id}">…</span></span>
              <span class="jeux-row-b" data-badge="${o.id}"></span></button></li>`).join('')}</ul></section>` : '';
      }).join('')}
      <p class="small muted jeux-hint">Fais glisser la barre d’onglets pour passer d’un jeu à l’autre.</p>
    </div>`;
  panel.addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) choisir(b.dataset.open, { focus: true }); });
  return rafraichirHub();
}

/** Demande à chaque jeu son résumé du jour (en parallèle) et met à jour le tableau de bord et les onglets. */
async function rafraichirHub() {
  await Promise.all(JEUX.map(async (o) => {
    try {
      const m = await importer(o);
      const r = typeof m.resume === 'function' ? await m.resume(CTX) : null;
      S.resumes.set(o.id, r && typeof r === 'object' ? r : null);
    } catch (e) {
      console.warn('[jeux] résumé', o.id, e);
      S.resumes.set(o.id, { etat: 'info', texte: 'Indisponible pour le moment', badge: '' });
    }
  }));
  peindreHub();
}

/** Applique les résumés : lignes, cartes « à jouer », barre de progression, gains du jour, états des onglets. */
function peindreHub() {
  const avecEtat = JEUX.filter((o) => ['fait', 'a_jouer', 'en_cours'].includes(S.resumes.get(o.id)?.etat));
  const faits = avecEtat.filter((o) => S.resumes.get(o.id).etat === 'fait').length;
  const gain = JEUX.reduce((t, o) => t + (Number(S.resumes.get(o.id)?.gain) || 0), 0);
  const serie = Math.max(0, ...JEUX.map((o) => Number(S.resumes.get(o.id)?.serie) || 0));
  for (const o of JEUX) {
    const r = S.resumes.get(o.id);
    const sub = document.querySelector(`[data-sub="${o.id}"]`);
    if (sub) sub.textContent = r?.texte || 'Découvre le jeu';
    const b = document.querySelector(`[data-badge="${o.id}"]`);
    if (b) b.innerHTML = badgeHtml(r);
    const st = document.querySelector(`[data-st="${o.id}"]`);
    if (st) st.textContent = r?.etat === 'fait' ? (r.badge || 'Fait') : r?.etat === 'en_cours' ? (r.badge || '') : '';
  }
  const total = avecEtat.length;
  const bar = $('#jeux-bar');
  if (bar) {
    bar.setAttribute('aria-valuemax', String(total || 1));
    bar.setAttribute('aria-valuenow', String(faits));
    bar.setAttribute('aria-valuetext', `${faits} jeu${faits > 1 ? 'x' : ''} sur ${total}`);
    bar.querySelector('i').style.width = `${total ? Math.round((100 * faits) / total) : 0}%`;
  }
  const txt = $('#jeux-prog-txt');
  if (txt) txt.textContent = `${nf(faits)} jeu${faits > 1 ? 'x' : ''} sur ${nf(total)} fait${faits > 1 ? 's' : ''} · ${jourLong(zurichIso())}`;
  const se = $('#jeux-serie');
  if (se) { se.hidden = !serie; se.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-7 0 2 1 3 2 3 0-3 1-6 1-8z" fill="currentColor"/></svg>${nf(serie)} jour${serie > 1 ? 's' : ''}`; se.setAttribute('aria-label', `Série : ${serie} jours`); }
  // Cartes « à jouer » (grand écran) : trois jeux au plus
  const cards = $('#jeux-hub-cards');
  if (cards) {
    const aJouer = JEUX.filter((o) => S.resumes.get(o.id)?.etat === 'a_jouer').slice(0, 3);
    cards.innerHTML = aJouer.map((o) => {
      const r = S.resumes.get(o.id);
      return `<div class="jg-card jeux-card"><div class="jg-between"><span class="jeux-tile" style="color:${couleur(o.couleur)}">${svg(o.icone, 'jeux-gi')}</span>${badgeHtml(r)}</div>
        <div><p class="jeux-card-t">${esc(o.titre)}</p><p class="small muted">${esc(r.texte || '')}</p></div>
        <button class="btn btn-sand" type="button" data-open="${o.id}">Jouer</button></div>`;
    }).join('');
    cards.hidden = !aJouer.length;
  }
  // Paillettes gagnées aujourd'hui (en-tête)
  const bal = $('#jeux-bal');
  if (bal) { bal.hidden = false; $('#jeux-bal-v').textContent = `+${nf(gain)} ✦`; }
}

/* ---------- Chargement d'un jeu ---------- */
/**
 * Monte le panneau d'un onglet (une seule fois). En cas d'échec : l'erreur et un bouton « Réessayer ».
 * @param {object} o Ligne de LISTE.
 * @returns {Promise<void>}
 */
function monter(o) {
  if (S.mods.has(o.id)) return Promise.resolve();
  if (S.loading.has(o.id)) return S.loading.get(o.id);
  const panel = document.getElementById(`jeux-panel-${o.id}`);
  panel.setAttribute('aria-busy', 'true');
  panel.innerHTML = '<p class="card jeux-empty">Chargement…</p>';
  const p = (async () => {
    try {
      if (o.hub) { await monterHub(panel); S.mods.set(o.id, {}); return; }
      const mod = await importer(o);
      if (typeof mod.mount !== 'function') throw new Error('module de jeu incomplet');
      panel.innerHTML = '';
      await mod.mount(panel, CTX);
      S.mods.set(o.id, mod);
    } catch (e) {
      console.warn('[jeux]', o.id, e);
      panel.innerHTML = `<div class="card jeux-error" role="alert"><p><strong>Ce jeu n’a pas pu se charger.</strong></p>
        <p class="small muted">${esc(e?.message || String(e))}</p>
        <button class="btn btn-ghost" type="button" data-jeux-retry>Réessayer</button></div>`;
      panel.querySelector('[data-jeux-retry]').addEventListener('click', () => { if (S.cur === o.id) monter(o); }, { once: true });
    } finally {
      panel.removeAttribute('aria-busy');
      S.loading.delete(o.id);
    }
  })();
  S.loading.set(o.id, p);
  return p;
}

/* ---------- Sélection d'un onglet ---------- */
/**
 * Affiche un onglet : état ARIA, panneau visible, adresse et mémoire à jour, module chargé si besoin.
 * @param {string} id Identifiant de l'onglet.
 * @param {{focus?: boolean, adresse?: boolean, sub?: string|null}} [opts] focus : donne le focus à l'onglet ; adresse : met #id dans l'URL ;
 *   sub : choix propre au jeu (ctx.sub) ; s'il est fourni, le module déjà monté est prévenu par « jeux:sub ».
 */
function choisir(id, { focus = false, adresse = true, sub = undefined } = {}) {
  const o = LISTE.find((x) => x.id === id) || LISTE[0];
  const avant = S.cur;
  S.cur = o.id;
  CTX.sub = sub ?? null;
  for (const t of tablist.querySelectorAll('[role="tab"]')) {
    const on = t.dataset.id === o.id;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    if (on) {
      if (focus) t.focus({ preventScroll: true });
      // Onglet visible dans la barre (défilement horizontal de la barre seulement, jamais de la page)
      if (tablist.scrollWidth > tablist.clientWidth) {
        const l = t.offsetLeft - tablist.offsetLeft, r = l + t.offsetWidth;
        if (l < tablist.scrollLeft) tablist.scrollLeft = l - 16;
        else if (r > tablist.scrollLeft + tablist.clientWidth) tablist.scrollLeft = r - tablist.clientWidth + 48;
      }
    }
  }
  for (const p of panels.querySelectorAll('[role="tabpanel"]')) p.hidden = p.dataset.id !== o.id;
  retenir(o.id);
  if (adresse && lireAdresse().id !== o.id) history.replaceState(null, '', `#${o.id}`);
  document.title = `${o.hub ? 'Jeux' : `${o.titre} · Jeux`} · Humane Gang`;
  // Retour au tableau de bord : les états ont pu changer (jeu joué entre-temps)
  if (o.hub && avant && avant !== HUB && S.mods.has(HUB)) rafraichirHub();
  // Le panneau est prévenu à chaque affichage (une carte cachée doit recalculer sa taille)
  monter(o).then(() => {
    const panneau = document.getElementById(`jeux-panel-${o.id}`);
    panneau?.dispatchEvent(new CustomEvent('jeux:show'));
    if (sub !== undefined) panneau?.dispatchEvent(new CustomEvent('jeux:sub', { detail: { sub: CTX.sub } }));
  });
}

/* ---------- Clavier et clics ---------- */
tablist.addEventListener('click', (e) => {
  const t = e.target.closest('[role="tab"]');
  if (t) choisir(t.dataset.id);
});
tablist.addEventListener('keydown', (e) => {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  const i = tabs.findIndex((t) => t.dataset.id === S.cur);
  let j = null;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % tabs.length;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + tabs.length) % tabs.length;
  else if (e.key === 'Home') j = 0;
  else if (e.key === 'End') j = tabs.length - 1;
  if (j === null) return;
  e.preventDefault();
  choisir(tabs[j].dataset.id, { focus: true });
});
// Lien direct ou retour arrière vers jeux.html#<id> ou jeux.html#<id>-<choix>
window.addEventListener('hashchange', () => { const a = lireAdresse(); if (a.id) choisir(a.id, { adresse: false, sub: a.sub }); });
// En quittant la page : chaque module chargé peut libérer ses ressources (minuteurs, abonnements…)
window.addEventListener('pagehide', () => { for (const m of S.mods.values()) { try { m.unmount?.(); } catch { /* sans importance */ } } });

/* ---------- Démarrage ---------- */
construire();
const memo = lireMemoire();
const depart = lireAdresse();
choisir(depart.id || (LISTE.some((o) => o.id === memo) ? memo : HUB), { sub: depart.sub });
// Les états des onglets (« Fait »…) et les gains du jour sont utiles même sans ouvrir le tableau de bord
if (S.cur !== HUB) rafraichirHub();
app.setAttribute('aria-busy', 'false');
