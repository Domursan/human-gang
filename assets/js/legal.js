// ===== Pages légales : en-tête/pied communs + sommaire actif =====
import { initPage, $$ } from './core.js';

await initPage({ auth: 'optional' });

// L'en-tête est injecté après le chargement : on recale l'ancre demandée.
if (location.hash) {
  const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target) target.scrollIntoView({ block: 'start' });
}

// Mise en évidence de la section visible dans le sommaire
const links = new Map($$('.legal-toc a').map((a) => [a.getAttribute('href').slice(1), a]));
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a, id) => (id === e.target.id ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
    }
  }, { rootMargin: '-20% 0px -70% 0px' });
  $$('.legal-section').forEach((s) => io.observe(s));
}
