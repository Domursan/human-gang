// ===== Humane Gang : sections repliables de l'admin (ui/fold.js) =====
// foldHtml({ cle, titre, resume, corps, ouvert }) : une section <details class="acc-fold"> (le composant de la fiche membre,
//   admin-accounts.css), le titre et un résumé utile (« 12 pages », « 3 en cours ») dans le <summary>, le contenu dans .acc-fold-corps.
//   cle : identifiant unique de la section dans la page. ouvert : état de départ sur ordinateur (≥ 900 px) ; sur téléphone, fermée.
//   forcer : ouvre la section quelle que soit la mémoire (ex. le sélecteur de membres vient d'être ouvert).
// L'état ouvert ou fermé choisi par la personne est gardé en mémoire (par cle) : un redessin de la page ne referme pas une section.
// Rien n'est retiré du HTML quand une section est fermée : les champs restent dans le formulaire et sont envoyés.
// Accessible : <summary> est au clavier (Entrée, Espace) et annonce son état (ouvert ou fermé) aux lecteurs d'écran.
import { esc } from '../../../commun/core/util.js';

/** Mémoire : cle -> ouvert (true) ou fermé (false), tant que la page reste ouverte. */
const ETAT = new Map();
const BUREAU = typeof matchMedia === 'function' ? matchMedia('(min-width: 900px)') : null;

// Un seul écouteur pour toute l'admin : « toggle » ne remonte pas, mais se capte à la phase de capture.
if (typeof document !== 'undefined') {
  document.addEventListener('toggle', (ev) => {
    const d = ev.target;
    if (!(d instanceof HTMLDetailsElement) || !d.dataset.fold) return;
    ETAT.set(d.dataset.fold, d.open);
  }, true);
}

/**
 * HTML d'une section repliable.
 * @param {{cle: string, titre: string, resume?: string, corps: string, ouvert?: boolean, forcer?: boolean}} o
 * @returns {string}
 */
export function foldHtml({ cle, titre, resume = '', corps, ouvert = false, forcer = false }) {
  const etat = forcer || (ETAT.has(cle) ? ETAT.get(cle) : (ouvert && !!BUREAU?.matches));
  return `<details class="acc-fold" data-fold="${esc(cle)}"${etat ? ' open' : ''}>
    <summary class="acc-fold-sum"><span>${esc(titre)}${resume ? `<span class="acc-fold-res"> · ${esc(resume)}</span>` : ''}</span></summary>
    <div class="acc-fold-corps">${corps}</div>
  </details>`;
}

/** Nombre et nom au pluriel si besoin : « 1 page », « 12 pages », « 0 page ». */
export const compte = (n, singulier, pluriel = singulier + 's') => `${n} ${n > 1 ? pluriel : singulier}`;
