// ===== Cartes : garder la place de l'utilisateur pendant un re-rendu =====
// Un re-rendu remplace le contenu d'un panneau (innerHTML) : sans précaution, la page peut remonter en haut
// (focus d'un élément remplacé, texte d'attente plus court que le contenu, etc.).
// keepPlace() mémorise scrollY et la position des zones défilantes marquées data-keep, lance le rendu,
// puis rétablit ces positions. Un rendu asynchrone (qui renvoie une promesse) est rétabli à la fin.

/**
 * Exécute fn (rendu synchrone ou asynchrone) et conserve la position de défilement.
 * @param {() => any} fn
 * @returns {any} ce que renvoie fn
 */
export function keepPlace(fn) {
  const y = window.scrollY;
  const x = window.scrollX;
  const inner = new Map([...document.querySelectorAll('[data-keep]')].map((el) => [el.dataset.keep, el.scrollTop]));
  const restore = () => {
    for (const [key, top] of inner) {
      const el = document.querySelector(`[data-keep="${CSS.escape(key)}"]`);
      if (el && el.scrollTop !== top) el.scrollTop = top;
    }
    if (Math.abs(window.scrollY - y) > 0.5 || Math.abs(window.scrollX - x) > 0.5) {
      window.scrollTo({ top: y, left: x, behavior: 'instant' });
    }
  };
  const out = fn();
  if (out && typeof out.then === 'function') return out.finally(restore);
  restore();
  return out;
}

/**
 * Garde la hauteur d'un élément pendant qu'un texte d'attente le remplace : la page ne raccourcit pas,
 * donc le navigateur ne ramène pas le défilement en haut. Renvoie la fonction qui libère la hauteur.
 * @param {HTMLElement} el
 * @returns {() => void}
 */
export function holdHeight(el) {
  el.style.minHeight = `${el.offsetHeight}px`;
  return () => { el.style.minHeight = ''; };
}
