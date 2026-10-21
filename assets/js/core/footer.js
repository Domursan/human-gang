// Pied de page commun et bandeau d'information sur les cookies.
import { getCachedProfile } from './profile.js';
import { canAccess } from './pages-access.js';
import { openPrefs } from './prefs.js';
import { ICON_PREFS } from './icons.js';
import { siteIdentite, siteTexte, footerLiens, fmt } from './site-defaults.js';
import { esc } from './util.js';

const FOOTER_HREF = { evenements: 'evenements.html', assistance: 'assistance.html', mentions: 'legal.html#mentions', confidentialite: 'legal.html#confidentialite', cookies: 'legal.html#cookies' };

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
export function cookieNotice() {
  if (!siteIdentite().bandeau_cookies) return;
  try { if (localStorage.getItem('hg_cookie_ok')) return; } catch { return; }
  const n = document.createElement('div');
  n.className = 'cookie-notice';
  n.setAttribute('role', 'region'); n.setAttribute('aria-label', 'Information cookies');
  n.innerHTML = `<p>${esc(fmt(siteTexte('cookies_texte')))} <a href="legal.html#cookies">En savoir plus</a></p>
    <button class="btn btn-light" type="button">OK, compris</button>`;
  n.querySelector('button').addEventListener('click', () => { try { localStorage.setItem('hg_cookie_ok', '1'); } catch {} n.remove(); });
  document.body.append(n);
}
