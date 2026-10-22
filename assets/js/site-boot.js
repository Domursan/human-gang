/* Module chargé par toutes les pages, avant le module de la page.
   - Repli des images en erreur : balise <img data-on-error="remove|hide|text|initials">
     (remplace les gestionnaires onerror="" inline, interdits par la CSP).
   - Boutons « Réessayer » : <button data-action="reload"> (remplace onclick="" inline). */
/*
 * Rôle : petits comportements communs à toutes les pages, sans rapport avec une fonctionnalité précise :
 * repli des images cassées, bouton « Réessayer », feuilles de style « print » basculées sur « all »,
 * et enregistrement du service worker (mode hors ligne).
 * Page : toutes les pages (chargé avant le module de chaque page).
 * Dépendances : aucune. Le fichier sw.js (racine du site) est enregistré ici.
 * Exporte : rien (effets de bord seulement).
 */

/* ---------- Images en erreur ---------- */

/**
 * Repli des images dont le chargement échoue : selon data-on-error, l'image est retirée, cachée,
 * remplacée par un texte ou par des initiales. Écouteur en phase de capture, car l'événement « error » ne remonte pas.
 */
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

/* ---------- Bouton « Réessayer » ---------- */

// Délégation : un clic sur n'importe quel [data-action="reload"] recharge la page
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="reload"]')) location.reload();
});

/* ---------- Feuilles de style ---------- */

/* Feuilles chargées en « print » puis basculées sur « all » (remplace onload="" inline). */
document.querySelectorAll('link[data-media-all]').forEach((l) => {
  /** Passe la feuille en « all » : elle s'applique à l'écran. */
  const on = () => { l.media = 'all'; };
  if (l.sheet) on(); else l.addEventListener('load', on, { once: true });
});

/* ---------- Mode hors ligne (service worker) ---------- */

/* Mode hors ligne : enregistrement du service worker (sw.js, à la racine du site). */
if (window.isSecureContext && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  // Nouvelle version du site installée pendant la visite : on recharge une fois pour ne pas mélanger
  // l'ancienne page et les nouveaux fichiers.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
}
