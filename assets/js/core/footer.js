// Pied de page commun et bandeau d'information sur les cookies.
import { getCachedProfile } from './profile.js';
import { canAccess } from './pages-access.js';
import { openPrefs } from './prefs.js';
import { ICON_PREFS } from './icons.js';

export function renderFooter(profile = getCachedProfile()) {
  document.querySelector('.site-footer')?.remove();
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `<div class="container">
      <div>© ${new Date().getFullYear()} Humane Gang</div>
      <nav aria-label="Liens légaux">
        ${profile && canAccess('evenements') ? '<a href="evenements.html">Événements</a>' : ''}
        <a href="assistance.html">Assistance</a>
        <a href="legal.html#mentions">Mentions légales</a>
        <a href="legal.html#confidentialite">Confidentialité</a>
        <a href="legal.html#cookies">Cookies</a>
        <button class="footer-prefs prefs-open" type="button" aria-haspopup="dialog">${ICON_PREFS}<span>Préférences d'affichage</span></button>
      </nav>
    </div>`;
  document.body.append(footer);
  footer.querySelector('.prefs-open').addEventListener('click', openPrefs);
}
export function cookieNotice() {
  try { if (localStorage.getItem('hg_cookie_ok')) return; } catch { return; }
  const n = document.createElement('div');
  n.className = 'cookie-notice';
  n.setAttribute('role', 'region'); n.setAttribute('aria-label', 'Information cookies');
  n.innerHTML = `<p>Ce site utilise seulement le stockage nécessaire à son fonctionnement (connexion, préférences). Aucun traceur, aucune publicité. <a href="legal.html#cookies">En savoir plus</a></p>
    <button class="btn btn-light" type="button">OK, compris</button>`;
  n.querySelector('button').addEventListener('click', () => { try { localStorage.setItem('hg_cookie_ok', '1'); } catch {} n.remove(); });
  document.body.append(n);
}
