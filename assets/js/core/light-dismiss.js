// ===== Humane Gang — fermer une fenêtre en cliquant à côté =====
/*
 * Rôle : sur tout le site, un clic sur le fond sombre autour d'une fenêtre (<dialog> ouverte en modale) la ferme,
 * comme la croix. Le clic doit commencer ET finir hors de la boîte : sélectionner du texte en glissant hors de la
 * fenêtre ne la ferme pas. On envoie d'abord l'événement « cancel » (comme la touche Échap) : une fenêtre qui
 * refuse la fermeture (preventDefault sur cancel, par ex. pendant une ouverture de booster) reste ouverte.
 * Exceptions : <dialog data-no-dismiss>, et les fenêtres plein écran (aucun fond visible autour). Les fenêtres
 * de décision des jeux de plateau (ex. .sh-modale de Shadow Hunters) ne sont pas des <dialog> : elles attendent
 * une réponse et ne se ferment pas au clic à côté.
 * Page : toutes (installé une fois par initPage).
 * Exporte : installLightDismiss.
 */

let installed = false;

/** Vrai si le point (x, y) est hors du rectangle de la boîte de la fenêtre. */
function outside(dlg, x, y) {
  const r = dlg.getBoundingClientRect();
  return x < r.left || x > r.right || y < r.top || y > r.bottom;
}

/** Ferme la fenêtre comme la touche Échap : « cancel » d'abord, la fenêtre peut refuser. */
function dismiss(dlg) {
  const ev = new Event('cancel', { cancelable: true });
  if (!dlg.dispatchEvent(ev)) return;
  dlg.close();
}

/** Installe l'écouteur global (une seule fois). */
export function installLightDismiss() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  let downOnBackdrop = null;
  document.addEventListener('pointerdown', (e) => {
    const t = e.target;
    downOnBackdrop = t instanceof HTMLDialogElement && t.open && !t.hasAttribute('data-no-dismiss') && outside(t, e.clientX, e.clientY) ? t : null;
  }, true);
  document.addEventListener('click', (e) => {
    const t = e.target;
    // Fenêtre native : le clic sur le fond arrive sur l'élément <dialog> lui-même, hors de sa boîte.
    if (t instanceof HTMLDialogElement && t.open && t === downOnBackdrop && t.matches(':modal') && outside(t, e.clientX, e.clientY)) {
      downOnBackdrop = null;
      dismiss(t);
      return;
    }
    downOnBackdrop = null;
  });
}
