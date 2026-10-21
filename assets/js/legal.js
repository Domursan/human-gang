// ===== Pages légales : en-tête/pied communs + sommaire actif =====
import { initPage, $$ } from './core.js';
import { siteIdentite, siteTexte } from './core/site-defaults.js';

await initPage({ auth: 'optional' });

// Éditeur et contact : réglages du site ; vide = « à compléter » (rien n'est inventé)
const ident = siteIdentite();
document.querySelectorAll('[data-field]').forEach((el) => {
  const v = ident[el.dataset.field] || '';
  el.textContent = v || 'à compléter';
  el.classList.toggle('a-completer', !v);
});
// Texte additionnel saisi dans l'admin : un paragraphe par ligne vide
document.querySelectorAll('[data-legal-extra]').forEach((el) => {
  const paras = String(siteTexte(el.dataset.legalExtra) || '').split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
  el.replaceChildren(...paras.map((t) => { const p = document.createElement('p'); p.textContent = t; return p; }));
});

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
