/* Module chargé par toutes les pages, avant le module de la page.
   - Repli des images en erreur : balise <img data-on-error="remove|hide|text|initials">
     (remplace les gestionnaires onerror="" inline, interdits par la CSP).
   - Boutons « Réessayer » : <button data-action="reload"> (remplace onclick="" inline). */

document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.onError) return;
  const mode = img.dataset.onError;
  if (mode === 'remove') img.remove();
  else if (mode === 'hide') img.style.visibility = 'hidden';
  else if (mode === 'text') img.replaceWith(document.createTextNode(img.dataset.fallback || ''));
  else if (mode === 'initials') {
    const s = document.createElement('span');
    s.className = img.dataset.fallbackClass || '';
    s.textContent = img.dataset.fallback || '';
    img.replaceWith(s);
  }
}, true);

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="reload"]')) location.reload();
});

/* Feuilles chargées en « print » puis basculées sur « all » (remplace onload="" inline). */
document.querySelectorAll('link[data-media-all]').forEach((l) => {
  const on = () => { l.media = 'all'; };
  if (l.sheet) on(); else l.addEventListener('load', on, { once: true });
});

/* Mode hors ligne : enregistrement du service worker (sw.js, à la racine du site). */
if (window.isSecureContext && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
