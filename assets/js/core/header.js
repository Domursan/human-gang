// En-tête commun : marque, navigation (pages accessibles), outils (mode sans limite, préférences, compte, déconnexion).
import { sb } from './supabase.js';
import { getCachedProfile } from './profile.js';
import { getMyPages } from './pages-access.js';
import { currentLogo } from './theme.js';
import { openPrefs } from './prefs.js';
import { paintGod, openGodDialog, disableGodMode, isGodMode } from './godmode.js';
import { avatarHtml, esc } from './util.js';
import { ICON_MSG, ICON_DOOR, ICON_PREFS, ICON_BOLT } from './icons.js';
import { searchButtonHtml, bindSearch } from './search.js';

// Navigation de secours (accès inconnus) : identique à l'ancienne navigation fixe.
const NAV_FALLBACK = [
  { slug: 'secret-santa', label: 'Secret Santa' },
  { slug: 'irl', label: 'IRL' },
  { slug: 'historique', label: 'Historique' },
  { slug: 'messages', label: 'Messages' },
];
// Libellés courts pour l'en-tête (le libellé complet reste celui de hg_pages ailleurs).
const NAV_SHORT = { cartes: 'Cartes', membre: 'Annuaire', recap: 'Récap' };
function navEntries() {
  const mine = getMyPages();
  if (!mine) return NAV_FALLBACK;
  return mine.filter((p) => p.in_nav).map((p) => ({ slug: p.slug, label: NAV_SHORT[p.slug] || p.label || p.slug }));
}

function accountInner(profile) {
  return profile
    ? `${avatarHtml(profile, 32)}<span class="nav-account-name">${esc(profile.pseudo)}</span>`
    : '<span class="nav-account-name nav-account-login">Connexion</span>';
}
let _accountObserver = null;
/** Met à jour le bouton compte de l'en-tête (avatar + pseudo). À appeler après une modification du profil. */
export function updateHeaderProfile(profile = getCachedProfile()) {
  const a = document.querySelector('.site-header .nav-account');
  if (!a) return;
  _accountObserver?.disconnect();
  a.innerHTML = accountInner(profile);
  a.classList.toggle('is-guest', !profile);
  a.setAttribute('aria-label', profile ? `Mon compte (${profile.pseudo})` : 'Connexion');
  _accountObserver?.observe(a, { childList: true });
}

const curAttr = (href) => (location.pathname.split('/').pop() === href ? ' aria-current="page"' : '');
/** Liens de navigation : pages accessibles (in_nav) + Admin. Sans profil, aucun lien de page. */
function navHtml(profile) {
  // Pages triées par sort ; « Messages » garde son icône et sa pastille.
  const links = navEntries().map(({ slug, label }) => {
    const href = `${slug}.html`;
    if (slug === 'messages') return `<a class="nav-msg" href="messages.html"${curAttr(href)} aria-label="Messages">${ICON_MSG}<span class="nav-msg-label">${esc(label)}</span><span class="nav-badge" hidden></span></a>`;
    return `<a href="${href}"${curAttr(href)} data-page="${esc(slug)}">${esc(label)}</a>`;
  }).join('');
  const admin = profile?.is_admin ? `<a class="nav-admin" href="admin.html"${curAttr('admin.html')}>Admin</a>` : '';
  return `${profile ? links : ''}${admin}`;
}
/** Remplit la navigation de l'en-tête (appelée quand les pages accessibles sont connues). */
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
/** Ouvre ou ferme la navigation repliée (760 px et moins). */
function setNavOpen(header, open) {
  header.classList.toggle('nav-open', open);
  header.querySelector('.nav-toggle')?.setAttribute('aria-expanded', String(open));
}

/**
 * En-tête commun. nav:false -> la navigation reste vide jusqu'à updateNav (pages accessibles pas encore connues).
 */
export function renderHeader(profile, { nav = true } = {}) {
  document.querySelector('.site-header')?.remove();
  const account = `<a class="nav-account" href="compte.html"${curAttr('compte.html')}></a>`;
  const god = profile?.is_admin ? `<button class="nav-icon nav-god" type="button" aria-pressed="false" aria-label="Activer le mode sans limite" title="Mode sans limite">${ICON_BOLT}</button>` : '';
  const search = profile ? searchButtonHtml() : '';
  const prefs = `${search}${god}<button class="nav-icon prefs-open" type="button" aria-label="Préférences d'affichage" aria-haspopup="dialog" title="Préférences d'affichage">${ICON_PREFS}</button>`;
  const logout = profile ? `<button class="nav-icon nav-logout" type="button" aria-label="Se déconnecter" title="Se déconnecter">${ICON_DOOR}</button>` : '';
  const toggle = '<button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" hidden>Menu</button>';
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `<a class="skip-link" href="#app">Aller au contenu</a>
    <div class="rainbow" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span><span></span></div>
    <div class="container">
      <a class="brand" href="accueil.html"><img class="brand-logo" src="${esc(currentLogo())}" alt=""><span>HUMANE GANG</span></a>
      <nav class="nav" id="site-nav" aria-label="Navigation principale">${nav ? navHtml(profile) : ''}</nav>
      <div class="nav-tools">${toggle}${prefs}${account}${logout}</div>
    </div>`;
  // Cible du lien d'évitement : le contenu principal de la page (tabindex -1 : atteignable par script et par le lien)
  const main = document.getElementById('app');
  if (main && !main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  document.body.prepend(header);
  updateHeaderProfile(profile);
  const tg = header.querySelector('.nav-toggle');
  tg.hidden = !header.querySelector('.nav a');
  tg.addEventListener('click', () => setNavOpen(header, tg.getAttribute('aria-expanded') !== 'true'));
  header.querySelector('.nav').addEventListener('click', (e) => { if (e.target.closest('a')) setNavOpen(header, false); });
  header.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tg.getAttribute('aria-expanded') === 'true') { setNavOpen(header, false); tg.focus(); }
  });
  // Si une page remplace le contenu du bouton compte (ex. textContent = pseudo), on remet l'avatar
  const a = header.querySelector('.nav-account');
  _accountObserver = new MutationObserver(() => {
    if (a.querySelector('.nav-account-name')) return;
    const txt = a.textContent.trim();
    updateHeaderProfile(!txt || txt === 'Connexion' ? null : { ...(getCachedProfile() || {}), pseudo: txt });
  });
  _accountObserver.observe(a, { childList: true });
  header.querySelector('.prefs-open').addEventListener('click', openPrefs);
  header.querySelector('.nav-god')?.addEventListener('click', (e) => {
    if (isGodMode()) disableGodMode(e.currentTarget);
    else openGodDialog(e);
  });
  paintGod();
  if (profile) bindSearch(header);
  header.querySelector('.nav-logout')?.addEventListener('click', async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await sb.auth.signOut(); } catch {}
    try { sessionStorage.removeItem('hg_badges_checked'); } catch {}
    location.href = 'compte.html';
  });
}
