// ===== Cartes : longues listes dessinées par lots (idée Q5) =====
// Partagé par la collection (cartes.js) et le sélecteur de cartes d'un échange (cartes-trades.js).
// - Au-delà de SEUIL cartes, seules LOT cartes sont dessinées ; le lot suivant s'ajoute à la demande.
// - Chargement anticipé : le lot suivant est dessiné quand la sentinelle est à moins de MARGE écrans sous le bord bas
//   de la zone défilante. Une seule vérification en cours à la fois, un lot par image (requestAnimationFrame).
// - Remplissage : après chaque dessin, la vérification recommence jusqu'à ce que la zone déborde assez
//   (grand écran, filtre qui laisse peu de cartes).
// - gardeFocus : un redessin ne déplace pas le focus (même bouton, champ ou carte) ; lotsAnticipes rétablit le défilement.
// - Pas d'IntersectionObserver : il enchaînait les lots et déplaçait le focus.

/** Nombre de cartes dessinées à la fois. */
export const LOT = 120;
/** En dessous de ce nombre de cartes affichées, tout est dessiné d'un coup (rien ne change). */
export const SEUIL = 300;
/** Marge de chargement anticipé, en hauteurs de zone visible : 1.5 = le lot suivant arrive quand il reste 1,5 écran à défiler. */
const MARGE = 1.5;

/** Identité d'un élément rendu : ses id et attributs data-* (les classes et états aria ne comptent pas). */
const signature = (el) => [...el.attributes]
  .filter((a) => a.name === 'id' || a.name.startsWith('data-'))
  .map((a) => `${a.name}=${a.value}`).join('|');

/**
 * Exécute fn (un redessin de root), puis rend le focus à l'élément de même identité si le focus l'avait avant.
 * Le focus est rendu sans défilement. Si l'élément n'existe plus, le focus reste où le navigateur le place.
 * @param {HTMLElement} root élément redessiné (son contenu est remplacé)
 * @param {() => any} fn redessin
 * @returns {any} ce que renvoie fn
 */
export function gardeFocus(root, fn) {
  const a = document.activeElement;
  const sig = a && a !== document.body && a !== root && root.contains(a) ? signature(a) : null;
  const out = fn();
  if (sig) {
    const el = [...root.querySelectorAll(a.tagName.toLowerCase())].find((e) => signature(e) === sig);
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }
  return out;
}

/**
 * Chargement anticipé d'une liste par lots.
 * @param {object} o
 * @param {() => Element|null} o.sentinelle sentinelle du lot suivant (null quand tout est dessiné)
 * @param {() => boolean} o.charger dessine le lot suivant sans toucher au focus ni au défilement ; renvoie false s'il n'a rien dessiné
 * @param {Element|Window} [o.zone=window] zone défilante qui contient la liste
 * @returns {{planifier: () => void}} planifier() : vérifie à l'image suivante (à appeler après chaque dessin)
 */
export function lotsAnticipes({ sentinelle, charger, zone = window }) {
  let enCours = false;
  const hauteur = () => (zone === window ? window.innerHeight : zone.clientHeight);
  const pres = () => {
    const s = sentinelle();
    if (!s) return false;
    const haut = zone === window ? 0 : zone.getBoundingClientRect().top;
    return s.getBoundingClientRect().top - haut < hauteur() * (1 + MARGE);
  };
  const position = () => (zone === window ? window.scrollY : zone.scrollTop);
  const verifier = () => {
    enCours = false;
    if (!pres()) return;
    const avant = position();
    if (!charger()) return;
    // Le navigateur peut décaler le défilement au premier calcul de mise en page (ancrage sur le contenu remplacé) :
    // on rétablit la position d'avant, pour que le lot n'emporte ni la page ni la liste.
    if (Math.abs(position() - avant) > 0.5) {
      if (zone === window) window.scrollTo({ top: avant, behavior: 'instant' }); else zone.scrollTop = avant;
    }
    planifier();
  };
  function planifier() {
    if (enCours) return;
    enCours = true;
    requestAnimationFrame(verifier);
  }
  zone.addEventListener('scroll', planifier, { passive: true });
  return { planifier };
}

/**
 * Hauteurs des groupes d'une zone (attribut data-group), mesurées avant un redessin.
 * Un groupe rendu à nouveau reprend cette hauteur estimée (voir attrGroupe) : sans elle, le navigateur lui donne 900 px
 * tant qu'il n'a pas été mesuré, le document rétrécit au-dessus de la fenêtre et le défilement saute.
 * @param {Element} zone conteneur des groupes (peut être vide)
 * @returns {Map<string, number>} identifiant du groupe → hauteur en px
 */
export function mesurerGroupes(zone) {
  return new Map([...zone.querySelectorAll('[data-group]')].map((g) => [g.dataset.group, Math.round(g.getBoundingClientRect().height)]));
}
/**
 * Attributs d'un groupe : identifiant (data-group) et, si connue, sa hauteur estimée (--cz-h, lue par cartes.css).
 * @param {string} cle identifiant du groupe (sans caractères spéciaux)
 * @param {Map<string, number>} mesures hauteurs connues (mesurerGroupes)
 * @returns {string} attributs HTML, avec un espace en tête
 */
export function attrGroupe(cle, mesures) {
  const id = String(cle).replace(/[^\w-]/g, '_');
  const h = mesures.get(id);
  return ` data-group="${id}"${h ? ` style="--cz-h:${h}px"` : ''}`;
}
