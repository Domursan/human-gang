// Pied de page commun et bandeau d'information sur les cookies.
/*
 * Rôle : construit le pied de page (liens légaux, aide, événements, bouton « Préférences d'affichage »)
 * et affiche une seule fois le bandeau d'information sur les cookies.
 * Page : toutes les pages (appelé par init.js après l'en-tête).
 * Dépendances : profile.js (profil), pages-access.js (droit d'accès à la page Événements),
 * prefs.js (ouverture des préférences), icons.js (icône), site-defaults.js (textes et liens du site), util.js (esc).
 * Stockage local : « hg_cookie_ok » une fois le bandeau accepté.
 * Exporte : renderFooter, cookieNotice.
 */
import { getCachedProfile } from './profile.js';
import { canAccess } from './pages-access.js';
import { openPrefs } from './prefs.js';
import { ICON_PREFS } from './icons.js';
import { siteIdentite, siteTexte, footerLiens, fmt } from './site-defaults.js';
import { esc } from './util.js';

/** Adresse de chaque lien du pied de page, par identifiant (les identifiants viennent des réglages du site). */
const FOOTER_HREF = { evenements: '/pages/irl/evenements.html', assistance: '/pages/infos/assistance.html', mentions: '/pages/infos/legal.html#mentions', confidentialite: '/pages/infos/legal.html#confidentialite', cookies: '/pages/infos/legal.html#cookies' };

/**
 * Reconstruit le pied de page. Remplace l'ancien s'il existe.
 * Le lien « Événements » n'apparaît que pour un membre qui y a accès.
 * @param {object|null} [profile] Profil courant (par défaut le profil en cache).
 */
export function renderFooter(profile = getCachedProfile()) {
  document.querySelector('.site-footer')?.remove();
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  const links = footerLiens()
    .filter((l) => l.visible && (l.id !== 'evenements' || (profile && canAccess('evenements'))))
    .map((l) => `<a href="${FOOTER_HREF[l.id]}">${esc(l.label)}</a>`).join('');
  footer.innerHTML = `<div class="container">
      <div>${esc(fmt(siteIdentite().copyright))}</div>
      <nav aria-label="Liens légaux">
        ${links}
        <button class="footer-prefs prefs-open" type="button" aria-haspopup="dialog">${ICON_PREFS}<span>Préférences d'affichage</span></button>
      </nav>
    </div>`;
  document.body.append(footer);
  footer.querySelector('.prefs-open').addEventListener('click', openPrefs);
}

/**
 * Affiche le bandeau cookies en bas de page, si le site l'active et si on ne l'a pas encore accepté.
 * « OK, compris » retient le choix dans localStorage. Si localStorage est indisponible, on n'affiche
 * pas le bandeau (sinon il réapparaîtrait à chaque page).
 */
export function cookieNotice() {
  if (!siteIdentite().bandeau_cookies) return;
  try { if (localStorage.getItem('hg_cookie_ok')) return; } catch { return; }
  const n = document.createElement('div');
  n.className = 'cookie-notice';
  n.setAttribute('role', 'region'); n.setAttribute('aria-label', 'Information cookies');
  n.innerHTML = `<p>${esc(fmt(siteTexte('cookies_texte')))} <a href="/pages/infos/legal.html#cookies">En savoir plus</a></p>
    <button class="btn btn-light" type="button">OK, compris</button>`;
  n.querySelector('button').addEventListener('click', () => { try { localStorage.setItem('hg_cookie_ok', '1'); } catch {} n.remove(); });
  document.body.append(n);
}
