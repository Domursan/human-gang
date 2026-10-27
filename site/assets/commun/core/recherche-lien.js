// ===== Humane Gang — ouverture de la recherche (pont léger, sans le code de la recherche) =====
/*
 * Rôle : la loupe de l'en-tête, le raccourci Ctrl/Cmd + K et la touche « / » ouvrent la recherche. Le code de la
 * recherche (search.js : dialogue, index, résultats) n'est chargé qu'à la première ouverture. Ce petit module garde
 * les écouteurs ; foldText (repli des accents, pur) y vit aussi pour que les pages n'aient pas à charger search.js.
 * Page : toutes les pages (en-tête : bindRechercheLien) ; shortcuts.js (touche « / ») ; cartes.js (foldText).
 * Dépendances : search.js (chargé à la demande).
 * Exporte : foldText, ouvreRecherche(e), bindRechercheLien(header).
 */

/**
 * Repli de la recherche : minuscules, sans accents (pour comparer « Cafe » et « café »).
 * @param {string} s Texte à replier.
 * @returns {string} Texte replié.
 */
export const foldText = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Ouvre la recherche. Le bouton (ou l'élément actif) qui a ouvert est noté tout de suite, pour rendre le focus à la
 * fermeture, comme openSearch le fait lui-même.
 * @param {Event|null} [e] Événement du clic, s'il y en a un.
 */
export function ouvreRecherche(e) {
  const active = document.activeElement;
  const ouvreur = e?.currentTarget instanceof Element ? e.currentTarget
    : (active && active !== document.body ? active : document.querySelector('.site-header .nav-search-open'));
  import('./search.js').then((m) => m.openSearch({ currentTarget: ouvreur })).catch((err) => console.warn('[recherche]', err));
}

/** true une fois le raccourci clavier branché : on ne l'ajoute pas deux fois. */
let keyBound = false;
/**
 * Branche la loupe de l'en-tête et le raccourci Ctrl/Cmd + K (une seule fois pour la page).
 * @param {HTMLElement} header En-tête dans lequel se trouve le bouton loupe.
 */
export function bindRechercheLien(header) {
  header.querySelector('.nav-search-open')?.addEventListener('click', ouvreRecherche);
  if (keyBound) return;
  keyBound = true;
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || String(e.key || '').toLowerCase() !== 'k') return;
    if (!document.querySelector('.site-header .nav-search-open')) return; // membres connectés seulement
    e.preventDefault();
    ouvreRecherche();
  });
}
