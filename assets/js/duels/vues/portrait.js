/**
 * Portraits du jeu « Qui est-ce ? » (duels, site Humane Gang).
 *
 * Rôle : dessiner en SVG le buste de face d'un personnage à partir de ses attributs
 * (voir hg_duel_qec_persos dans supabase/migrations/122_duels.sql) et produire le texte
 * accessible qui le décrit. Chaque SVG est autonome (aucun id, aucun <use>), donc
 * plusieurs portraits peuvent cohabiter dans la même page sans collision.
 *
 * Dépendances : aucune.
 *
 * Exports :
 *   - portraitSvg(attributs, { titre }) : chaîne <svg viewBox="0 0 100 120"> prête à insérer.
 *   - descriptionPortrait(attributs) : texte français de l'aria-label, sans le titre.
 */

const FOND = '#D3DBE6';
const CONTOUR = { stroke: '#2A1E1A', 'stroke-opacity': '.45', 'stroke-width': '1' };

const CHEVEUX = ['aucun', 'noirs', 'bruns', 'blonds', 'roux', 'gris'];
const CHAPEAUX = ['aucun', 'casquette', 'chapeau', 'bonnet'];
const YEUX = ['marron', 'bleus', 'verts'];

const COULEUR_CHEVEUX = {
  noirs: '#1E1716', bruns: '#6B4327', blonds: '#EBC77F', roux: '#B8572E', gris: '#A7ABB4',
};
const COULEUR_SOURCILS = {
  aucun: '#4A3328', noirs: '#120D0C', bruns: '#3E2716', blonds: '#9C7A3E', roux: '#7A3518', gris: '#6E727C',
};
const COULEUR_IRIS = { marron: '#6B4226', bleus: '#3C7FC2', verts: '#3E8E5A' };
const PEAU = { 1: '#F6DCC6', 2: '#E8B896', 3: '#C8906A', 4: '#9A6540', 5: '#6B4128' };
const PEAU_OMBRE = { 1: '#E2BC9F', 2: '#CFA07C', 3: '#AE7650', 4: '#7E4D2C', 5: '#55301D' };

const NOM_CHEVEUX = {
  noirs: 'noirs', bruns: 'bruns', blonds: 'blonds', roux: 'roux', gris: 'gris',
};
const NOM_CHAPEAU = { casquette: 'casquette', chapeau: 'chapeau', bonnet: 'bonnet' };

/**
 * Valeurs sûres : les énumérations inconnues retombent sur une valeur par défaut,
 * la couleur du haut doit être un hexadécimal à 6 chiffres (sinon gris).
 * @param {object} [a] attributs bruts (issus de la base)
 * @returns {{cheveux:string, longs:boolean, lunettes:boolean, chapeau:string, barbe:boolean,
 *   boucles:boolean, yeux:string, peau:number, haut:string}}
 */
function normaliser(a = {}) {
  const peau = Math.round(Number(a.peau));
  return {
    cheveux: CHEVEUX.includes(a.cheveux) ? a.cheveux : 'aucun',
    longs: a.longs === true,
    lunettes: a.lunettes === true,
    chapeau: CHAPEAUX.includes(a.chapeau) ? a.chapeau : 'aucun',
    barbe: a.barbe === true,
    boucles: a.boucles === true,
    yeux: YEUX.includes(a.yeux) ? a.yeux : 'marron',
    peau: peau >= 1 && peau <= 5 ? peau : 3,
    haut: typeof a.haut === 'string' && /^#[0-9a-f]{6}$/i.test(a.haut) ? a.haut : '#6B7280',
  };
}

/**
 * Élément SVG sous forme de chaîne.
 * @param {string} nom nom de la balise
 * @param {object} attrs attributs (valeurs déjà sûres)
 * @param {string} [enfants] contenu
 * @returns {string}
 */
function el(nom, attrs, enfants = '') {
  const liste = Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
  return enfants ? `<${nom} ${liste}>${enfants}</${nom}>` : `<${nom} ${liste}/>`;
}

/**
 * Texte français décrivant le personnage, sans titre.
 * Ex. « cheveux bruns courts, yeux marron, barbe, lunettes ».
 * La peau et la couleur du haut ne sont pas décrites : elles ne sont pas des questions du jeu.
 * @param {object} attributs attributs du personnage
 * @returns {string}
 */
export function descriptionPortrait(attributs) {
  const c = normaliser(attributs);
  const chauve = c.cheveux === 'aucun';
  const morceaux = [];
  morceaux.push(chauve ? 'chauve' : `cheveux ${NOM_CHEVEUX[c.cheveux]} ${c.longs ? 'longs' : 'courts'}`);
  morceaux.push(`yeux ${c.yeux}`);
  if (c.barbe) morceaux.push(chauve ? 'barbe grise' : 'barbe');
  if (c.lunettes) morceaux.push('lunettes');
  if (c.boucles) morceaux.push("boucles d'oreilles");
  if (c.chapeau !== 'aucun') morceaux.push(NOM_CHAPEAU[c.chapeau]);
  return morceaux.join(', ');
}

/**
 * Portrait SVG du personnage : fond doux, buste de face, attributs superposés.
 * @param {object} attributs attributs du personnage
 * @param {{titre?: string}} [options] titre optionnel (prénom) placé devant la description
 * @returns {string} balise <svg> complète
 */
export function portraitSvg(attributs, { titre = '' } = {}) {
  const c = normaliser(attributs);
  const chauve = c.cheveux === 'aucun';
  const cheveux = COULEUR_CHEVEUX[c.cheveux];
  const barbe = chauve ? COULEUR_CHEVEUX.gris : cheveux;
  const peau = PEAU[c.peau];
  const peauOmbre = PEAU_OMBRE[c.peau];
  const description = descriptionPortrait(attributs);
  const echappe = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]);
  const label = echappe(titre ? `${titre} : ${description}` : description);

  let s = '';
  s += el('rect', { width: 100, height: 120, fill: FOND });

  // Cheveux longs : nappe derrière la tête, puis mèches devant les épaules.
  if (!chauve && c.longs) {
    s += el('path', { d: 'M24 50 Q22 20 50 19 Q78 20 76 50 L78 96 Q50 104 22 96 Z', fill: cheveux, ...CONTOUR });
  }

  // Épaules et col.
  s += el('path', { d: 'M12 120 Q14 92 38 86 L62 86 Q86 92 88 120 Z', fill: c.haut, ...CONTOUR });
  s += el('rect', { x: 43, y: 72, width: 14, height: 18, fill: peauOmbre });
  s += el('path', { d: 'M40 86 L50 99 L60 86 Z', fill: peau });

  // Visage et oreilles.
  s += el('ellipse', { cx: 50, cy: 54, rx: 22, ry: 27, fill: peau, ...CONTOUR });
  s += el('circle', { cx: 28, cy: 58, r: 4.5, fill: peau, ...CONTOUR });
  s += el('circle', { cx: 72, cy: 58, r: 4.5, fill: peau, ...CONTOUR });

  // Cheveux : mèches devant (cadre du visage), puis calotte et frange.
  if (!chauve && c.longs) {
    s += el('path', { d: 'M26 50 Q24 74 27 98 Q31 100 35 96 Q30 76 33 52 Z', fill: cheveux, ...CONTOUR });
    s += el('path', { d: 'M74 50 Q76 74 73 98 Q69 100 65 96 Q70 76 67 52 Z', fill: cheveux, ...CONTOUR });
  }
  if (!chauve) {
    s += el('path', { d: 'M26 50 Q22 20 50 19 Q78 20 74 50 Q62 36 50 38 Q38 36 26 50 Z', fill: cheveux, ...CONTOUR });
  }

  // Yeux : blanc, iris, pupille, reflet. Sourcils de la couleur des cheveux (plus sombre).
  for (const x of [42, 58]) {
    s += el('ellipse', { cx: x, cy: 55.5, rx: 4.6, ry: 3.2, fill: '#FFFDF8' });
    s += el('circle', { cx: x, cy: 55.5, r: 2.9, fill: COULEUR_IRIS[c.yeux] });
    s += el('circle', { cx: x, cy: 55.5, r: 1.4, fill: '#14100E' });
    s += el('circle', { cx: x + 0.9, cy: 54.5, r: 0.7, fill: '#FFFFFF' });
  }
  const sourcils = COULEUR_SOURCILS[chauve ? 'aucun' : c.cheveux];
  s += el('path', {
    d: 'M37 46.5 Q41.5 44.5 46.5 46.5 M53.5 46.5 Q58.5 44.5 63 46.5',
    fill: 'none', stroke: sourcils, 'stroke-width': 2.2, 'stroke-linecap': 'round',
  });

  // Nez et bouche (la bouche reste sur la peau, au-dessus de la barbe).
  s += el('path', { d: 'M50 58 Q48.5 63 51 64', fill: 'none', stroke: '#2A1E1A', 'stroke-opacity': '.5', 'stroke-width': 1.2, 'stroke-linecap': 'round' });
  s += el('path', { d: 'M45 70 Q50 73.5 55 70', fill: 'none', stroke: '#8A3B33', 'stroke-width': 2, 'stroke-linecap': 'round' });

  // Barbe : mâchoire et menton, de la couleur des cheveux (grise si chauve).
  if (c.barbe) {
    s += el('path', {
      d: 'M27 56 Q29 87 50 88 Q71 87 73 56 Q68 78 50 78 Q32 78 27 56 Z',
      fill: barbe, ...CONTOUR,
    });
  }

  // Lunettes rondes, monture sombre.
  if (c.lunettes) {
    s += el('g', { fill: 'none', stroke: '#1B1B1F', 'stroke-width': 2.2 }, [
      el('circle', { cx: 41, cy: 55.5, r: 6.8 }),
      el('circle', { cx: 59, cy: 55.5, r: 6.8 }),
      el('path', { d: 'M47.8 55.5 Q50 53.8 52.2 55.5' }),
      el('path', { d: 'M34.2 54 L27 52.5 M65.8 54 L73 52.5' }),
    ].join(''));
  }

  // Boucles d'oreilles dorées, au-dessus des mèches.
  if (c.boucles) {
    for (const x of [28, 72]) {
      s += el('circle', { cx: x, cy: 65, r: 2.2, fill: '#E2B54E', stroke: '#9C7420', 'stroke-width': 0.6 });
    }
  }

  // Chapeaux, par-dessus les cheveux.
  if (c.chapeau === 'casquette') {
    s += el('path', { d: 'M25 42 Q25 15 50 15 Q75 15 75 42 Z', fill: '#2B5AE2', ...CONTOUR });
    s += el('rect', { x: 18, y: 38, width: 64, height: 7, rx: 3.5, fill: '#1F449E' });
  } else if (c.chapeau === 'chapeau') {
    s += el('path', { d: 'M30 38 Q30 14 50 14 Q70 14 70 38 Z', fill: '#8A5A34', ...CONTOUR });
    s += el('rect', { x: 30, y: 32, width: 40, height: 5, fill: '#3A2414' });
    s += el('ellipse', { cx: 50, cy: 38, rx: 34, ry: 6, fill: '#8A5A34', ...CONTOUR });
  } else if (c.chapeau === 'bonnet') {
    s += el('path', { d: 'M24 42 Q50 -8 76 42 Z', fill: '#E8B04B', ...CONTOUR });
    s += el('rect', { x: 24, y: 37, width: 52, height: 8, rx: 4, fill: '#B9862A' });
    s += el('circle', { cx: 50, cy: 14, r: 5, fill: '#E8B04B', ...CONTOUR });
  }

  const svg = el('svg', {
    viewBox: '0 0 100 120',
    role: 'img',
    'aria-label': label,
    focusable: 'false',
  }, s);
  return svg;
}
