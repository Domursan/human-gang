// En-tête commun : marque, navigation (pages accessibles). Les outils (recherche, mode sans limite, préférences, compte,
// déconnexion) sont dans une colonne latérale <aside class="side-tools"> : à droite sur ordinateur, sous l'en-tête sur téléphone.
/*
 * Rôle : construit la barre du haut de chaque page : logo, liens vers les pages accessibles, et les boutons
 * d'outils. Sur petit écran, la navigation se replie derrière un bouton « Menu ».
 * Page : toutes les pages (renderHeader est appelée par init.js, updateNav une fois les pages connues).
 * Dépendances : supabase.js (déconnexion), profile.js, perms.js (Staff/admin), pages-access.js (liens),
 * theme.js (logo), prefs.js, godmode.js (bouton mode sans limite), util.js, icons.js, search.js, site-defaults.js.
 * Exporte : updateHeaderProfile, updateNav, renderHeader.
 */
import { sb } from './supabase.js';
import { getCachedProfile } from './profile.js';
import { getCachedPerms, canPanel, clearPerms } from './perms.js';
import { getMyPages } from './pages-access.js';
import { currentLogo } from './theme.js';
import { openPrefs } from './prefs.js';
import { paintGod, openGodDialog, disableGodMode, isGodMode } from './godmode.js';
import { avatarHtml, esc } from './util.js';
import { ICON_MSG, ICON_DOOR, ICON_PREFS, ICON_BOLT, ICON_USER, ICON_HELP, ICON_MENU } from './icons.js';
import { searchButtonHtml, bindSearch } from './search.js';
import { bindShortcuts } from './shortcuts.js';
import { siteIdentite, navLibelle } from './site-defaults.js';

/* ---------- Constantes ---------- */

// Navigation de secours (accès inconnus) : identique à l'ancienne navigation fixe.
const NAV_FALLBACK = [
  { slug: 'secret-santa', label: 'Secret Santa' },
  { slug: 'irl', label: 'IRL' },
  { slug: 'historique', label: 'Historique' },
  { slug: 'messages', label: 'Messages' },
];
// Libellés courts pour l'en-tête (le libellé complet reste celui de hg_pages ailleurs).
const NAV_SHORT = { cartes: 'Cartes', membre: 'Annuaire', recap: 'Récap' };

/* ---------- Liens de navigation ---------- */

// Libellé saisi dans Admin › Réglages (vide = libellé automatique de la page).
/**
 * Liste des liens du menu : les pages accessibles marquées « dans la navigation ».
 * Si les accès ne sont pas encore connus (réseau), on affiche la navigation de secours.
 * @returns {Array<{slug: string, label: string}>} Liens dans l'ordre d'affichage.
 */
function navEntries() {
  const mine = getMyPages();
  if (!mine) return NAV_FALLBACK.map((x) => ({ slug: x.slug, label: navLibelle(x.slug) || x.label }));
  return mine.filter((p) => p.in_nav).map((p) => ({ slug: p.slug, label: navLibelle(p.slug) || NAV_SHORT[p.slug] || p.label || p.slug }));
}

/**
 * Contenu du bouton compte : avatar et pseudo si connecté, sinon icône et « Connexion ».
 * @param {object|null} profile Profil courant.
 * @returns {string} Fragment HTML.
 */
function accountInner(profile) {
  return profile
    ? `${avatarHtml(profile, 32)}<span class="nav-account-name">${esc(profile.pseudo)}</span>`
    : `<span class="nav-account-ico" aria-hidden="true">${ICON_USER}</span><span class="nav-account-name nav-account-login">Connexion</span>`;
}
/** Observateur qui remet l'avatar si une page écrase le contenu du bouton compte. */
let _accountObserver = null;
/**
 * Met à jour le bouton compte de l'en-tête (avatar + pseudo). À appeler après une modification du profil.
 * L'observateur est coupé pendant la mise à jour, pour ne pas réagir à sa propre écriture.
 * @param {object|null} [profile] Profil à afficher (par défaut le profil en cache).
 */
export function updateHeaderProfile(profile = getCachedProfile()) {
  const a = document.querySelector('.site-header .nav-account');
  if (!a) return;
  _accountObserver?.disconnect();
  a.innerHTML = accountInner(profile);
  a.classList.toggle('is-guest', !profile);
  a.setAttribute('aria-label', profile ? `Mon compte (${profile.pseudo})` : 'Connexion');
  _accountObserver?.observe(a, { childList: true });
}

/**
 * Attribut aria-current="page" si le lien pointe vers la page affichée, sinon ''.
 * @param {string} href Nom du fichier visé (ex. 'irl.html').
 * @returns {string} Attribut HTML ou ''.
 */
const curAttr = (href) => (location.pathname.split('/').pop() === href ? ' aria-current="page"' : '');
/**
 * Liens de navigation : pages accessibles (in_nav) + Admin. Sans profil, aucun lien de page.
 * Le lien « Admin » (ou « Staff » pour qui a des droits partiels) ne s'affiche que si le profil y a droit.
 * @param {object|null} profile Profil courant.
 * @returns {string} Fragment HTML des liens.
 */
function navHtml(profile) {
  // Pages triées par sort ; « Messages » garde son icône et sa pastille.
  const links = navEntries().map(({ slug, label }) => {
    const href = `${slug}.html`;
    if (slug === 'messages') return `<a class="nav-msg" href="messages.html"${curAttr(href)} aria-label="Messages">${ICON_MSG}<span class="nav-msg-label">${esc(label)}</span><span class="nav-badge" hidden></span></a>`;
    return `<a href="${href}"${curAttr(href)} data-page="${esc(slug)}">${esc(label)}</a>`;
  }).join('');
  // Admin : lien « Admin » ; Staff (permissions accordées) : lien « Staff » vers le même panel.
  const panel = profile && (profile.is_admin || canPanel(getCachedPerms()));
  const admin = panel ? `<a class="nav-admin" href="admin.html"${curAttr('admin.html')}>${profile.is_admin ? 'Admin' : 'Staff'}</a>` : '';
  // Aide & tutos : toujours présent dans le menu (visible surtout sur téléphone, où le bouton « ? » est dans la rangée d'outils)
  const help = `<a class="nav-help-link" href="aide.html"${curAttr('aide.html')} data-page="aide">Aide &amp; tutos</a>`;
  return `${profile ? links : ''}${admin}${help}`;
}
/**
 * Remplit la navigation de l'en-tête (appelée quand les pages accessibles sont connues).
 * Le bouton « Menu » est masqué s'il n'y a aucun lien à afficher.
 * @param {object|null} [profile] Profil courant (par défaut le profil en cache).
 */
export function updateNav(profile = getCachedProfile()) {
  const header = document.querySelector('.site-header');
  const nav = header?.querySelector('.nav');
  if (!nav) return;
  nav.innerHTML = navHtml(profile);
  const toggle = header.querySelector('.nav-toggle');
  if (toggle) {
    toggle.hidden = !nav.querySelector('a');
    if (toggle.hidden) setNavOpen(header, false);
  }
}
/**
 * Ouvre ou ferme la navigation repliée (760 px et moins). Met à jour aria-expanded du bouton « Menu ».
 * @param {HTMLElement} header Élément <header> de la page.
 * @param {boolean} open true pour ouvrir.
 */
function setNavOpen(header, open) {
  header.classList.toggle('nav-open', open);
  header.querySelector('.nav-toggle')?.setAttribute('aria-expanded', String(open));
}

/* ---------- Construction de l'en-tête ---------- */

/**
 * En-tête commun. nav:false -> la navigation reste vide jusqu'à updateNav (pages accessibles pas encore connues).
 * Les boutons outils dépendent du profil : recherche et déconnexion pour un membre, mode sans limite pour un admin.
 * Remplace l'en-tête précédent s'il existe. Branche aussi le menu replié, la touche Échap et l'observateur du compte.
 * @param {object|null} profile Profil courant, ou null pour un visiteur.
 * @param {{nav?: boolean}} [options] nav : false pour laisser la navigation vide au début.
 */
export function renderHeader(profile, { nav = true } = {}) {
  document.querySelector('.site-header')?.remove();
  const account = `<a class="nav-account" href="compte.html"${curAttr('compte.html')}></a>`;
  const god = profile?.is_admin ? `<button class="nav-icon nav-god" type="button" aria-pressed="false" aria-label="Activer le mode sans limite" title="Mode sans limite">${ICON_BOLT}</button>` : '';
  const search = profile ? searchButtonHtml() : '';
  const help = `<a class="nav-icon nav-help" href="aide.html"${curAttr('aide.html')} aria-label="Aide et tutos" title="Aide et tutos">${ICON_HELP}</a>`;
  const prefs = `<button class="nav-icon prefs-open" type="button" aria-label="Préférences d'affichage" aria-haspopup="dialog" title="Préférences d'affichage">${ICON_PREFS}</button>`;
  const logout = profile ? `<button class="nav-icon nav-logout" type="button" aria-label="Se déconnecter" title="Se déconnecter">${ICON_DOOR}</button>` : '';
  const toggle = `<button class="nav-icon nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Menu" title="Menu" hidden>${ICON_MENU}</button>`;
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `<a class="skip-link" href="#app">Aller au contenu</a>
    <div class="rainbow" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
    <div class="container">
      <a class="brand" href="accueil.html"><img class="brand-logo" src="${esc(currentLogo())}" alt=""><span>${esc(siteIdentite().nom.toUpperCase())}</span></a>
      <nav class="nav" id="site-nav" aria-label="Navigation principale">${nav ? navHtml(profile) : ''}</nav>
      <div class="nav-tools">${toggle}</div>
      <aside class="side-tools" aria-label="Outils">${search}${help}${god}${prefs}${account}${logout}</aside>
    </div>`;
  // Cible du lien d'évitement : le contenu principal de la page (tabindex -1 : atteignable par script et par le lien)
  const main = document.getElementById('app');
  if (main && !main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  document.body.prepend(header);
  updateHeaderProfile(profile);
  const tg = header.querySelector('.nav-toggle');
  tg.hidden = !header.querySelector('.nav a');
  tg.addEventListener('click', () => setNavOpen(header, tg.getAttribute('aria-expanded') !== 'true'));
  // Un clic sur un lien du menu replié referme le menu (la page change)
  header.querySelector('.nav').addEventListener('click', (e) => { if (e.target.closest('a')) setNavOpen(header, false); });
  // Échap ferme le menu replié et rend le focus à son bouton
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tg.getAttribute('aria-expanded') === 'true') { setNavOpen(header, false); tg.focus(); }
  });
  // Si une page remplace le contenu du bouton compte (ex. textContent = pseudo), on remet l'avatar
  const a = header.querySelector('.nav-account');
  _accountObserver = new MutationObserver(() => {
    if (a.querySelector('.nav-account-name')) return; // contenu normal : rien à faire
    const txt = a.textContent.trim();
    updateHeaderProfile(!txt || txt === 'Connexion' ? null : { ...(getCachedProfile() || {}), pseudo: txt });
  });
  _accountObserver.observe(a, { childList: true });
  header.querySelector('.prefs-open').addEventListener('click', openPrefs);
  // Bouton mode sans limite : coupe si actif, ouvre le dialogue d'activation sinon
  header.querySelector('.nav-god')?.addEventListener('click', (e) => {
    if (isGodMode()) disableGodMode(e.currentTarget);
    else openGodDialog(e);
  });
  paintGod();
  if (profile) bindSearch(header);
  bindShortcuts(profile); // « g » puis une lettre, « / », « ? » (idée Q8 ; rien sur admin.html)
  // Déconnexion : on coupe la session, on oublie les droits et les badges vus pour cette session, puis on va à la page de connexion
  header.querySelector('.nav-logout')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await sb.auth.signOut(); } catch {}
    try { sessionStorage.removeItem('hg_badges_checked'); } catch {}
    clearPerms();
    location.href = 'compte.html';
  });
}
