// ===== Humane Gang — Jeux à salon : logique commune des accueils (rejoindre avec un code, parties publiques, blocs) =====
/*
 * Rôle : le comportement partagé des écrans d'accueil Uno, Loup-Garou, Codenames et Plateaux : champ « Rejoindre avec
 * un code » (efface l'erreur à la saisie, normalise, navigue), chargement d'un bloc une seule fois (« Mes parties »,
 * « Mes statistiques »), liste des parties publiques rafraîchie avec son message d'erreur.
 * Le rendu HTML (classes, textes, ambiance) reste dans le vues/accueil.js de chaque jeu.
 * Dépendances : aucune (le jeu passe esc, erreurTexte et le rendu).
 * Exporte : brancherRejoindre, chargerBloc, suivrePubliques.
 */

/**
 * Relie le formulaire « Rejoindre avec un code ».
 * @param {{formulaire: HTMLFormElement, champ: HTMLInputElement, erreur: HTMLElement, normaliser: Function,
 *   messageErreur: string, naviguer: (hash: string) => void, url: (code: string) => string}} o
 *   normaliser(saisie) renvoie le code ou null si le format ne convient pas.
 */
export function brancherRejoindre({ formulaire, champ, erreur, normaliser, messageErreur, naviguer, url }) {
  champ.addEventListener('input', () => {
    if (!erreur.hidden) { erreur.hidden = true; champ.removeAttribute('aria-invalid'); }
  });
  formulaire.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = normaliser(champ.value);
    if (!code) {
      erreur.textContent = messageErreur;
      erreur.hidden = false;
      champ.setAttribute('aria-invalid', 'true');
      champ.focus();
      return;
    }
    champ.value = code;
    naviguer(url(code));
  });
}

/**
 * Charge un bloc une seule fois. Une erreur n'affecte que ce bloc : elle est affichée à la place des données.
 * @param {{zone: HTMLElement, charger: () => Promise<any>, rendre: (donnees: any) => string,
 *   messageErreur: (texte: string) => string, erreurTexte: (e: any) => string, actif: () => boolean}} o
 */
export async function chargerBloc({ zone, charger, rendre, messageErreur, erreurTexte, actif }) {
  try {
    const donnees = await charger();
    if (!actif()) return;
    zone.innerHTML = rendre(donnees);
  } catch (e) {
    if (!actif()) return;
    zone.innerHTML = messageErreur(erreurTexte(e));
  }
}

/**
 * Liste rafraîchie (parties publiques) : chargée tout de suite puis à chaque intervalle quand l'onglet est visible.
 * Ne redessine que si le contenu a changé ; une erreur n'efface pas une liste déjà affichée.
 * @returns {() => void} arrête le rafraîchissement.
 */
export function suivrePubliques({ zone, charger, rendre, messageErreur, erreurTexte, actif, intervalle }) {
  let dernierHtml = null;
  async function recharger() {
    try {
      const liste = await charger();
      if (!actif()) return;
      const html = rendre(liste);
      if (html !== dernierHtml) { zone.innerHTML = html; dernierHtml = html; }
    } catch (e) {
      if (!actif() || dernierHtml !== null) return;
      zone.innerHTML = messageErreur(erreurTexte(e));
    }
  }
  recharger();
  const minuterie = setInterval(() => { if (!document.hidden) recharger(); }, intervalle);
  return () => clearInterval(minuterie);
}
