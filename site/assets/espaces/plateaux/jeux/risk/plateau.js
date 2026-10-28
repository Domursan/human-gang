// ===== Humane Gang — Risk : carte du monde (plateaux/jeux/risk/plateau.js) =====
/*
 * Rôle : la carte des 42 territoires, avec leur vraie forme (zones.js) sur l'image assets/images/plateaux/risk/carte.webp
 *   (1376 × 768). Chaque territoire est rempli de la couleur de son armée (semi-transparent) ; une bulle indique ses troupes.
 *   Chaque bulle est un bouton (clavier, lecteurs d'écran) ; un clic sur la forme ouvre le même bouton.
 *   Sans l'image, la carte reste lisible (fond de mer uni, formes seules).
 *   Ce module ne fait que du HTML, des classes et les animations visuelles de la carte (cortège, compteurs, chutes).
 *   table.js le monte, décide quand le refaire, marque la sélection et lance les animations.
 * Dépendances : core.js (esc), ./zones.js (FORMES, CENTRES).
 * Exporte : plateauHtml(opts), marquer(zone, sel), fleche(zone, sel), animerMouvement(zone, de, vers, n),
 *   animerCompteur(zone, id, avant), animerChutes(zone, id, n).
 */
import { esc } from '../../../../commun/core.js';
import { FORMES, CENTRES } from './zones.js';

const LARGEUR = 1376;
const HAUTEUR = 768;
const pct = (v, total) => ((v / total) * 100).toFixed(2);
const ancre = (id) => CENTRES[id] || null;

/** Position d'un territoire en pourcentage du cadre de la carte (style left/top). */
const posCss = (id) => {
  const a = ancre(id);
  return a ? `left:${pct(a[0], LARGEUR)}%;top:${pct(a[1], HAUTEUR)}%` : 'left:50%;top:50%';
};

/** Contour de repli pour un territoire sans forme : un disque autour de son ancrage. */
function disque(id) {
  const a = ancre(id);
  if (!a) return '';
  const [x, y] = a;
  const r = 34;
  return `M${x - r} ${y} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
}

/** Soldat bleu (ou rouge pour les pertes), tiré des maquettes. */
const soldat = (couleur) => `<svg width="24" height="28" viewBox="0 0 14 16" aria-hidden="true"><ellipse cx="7" cy="14.5" rx="5" ry="1.5" fill="rgba(0,0,0,0.5)"/><circle cx="7" cy="3.6" r="2.6" fill="${couleur}"/><rect x="3.6" y="7" width="6.8" height="7" rx="1.6" fill="${couleur}"/></svg>`;
/** Char, tiré de la maquette. */
const CHAR = `<svg width="36" height="25" viewBox="0 0 20 14" aria-hidden="true"><rect x="1" y="9" width="18" height="4" rx="2" fill="#0B1322"/><rect x="2" y="5" width="16" height="5" rx="1" fill="#4F7FC4"/><rect x="6" y="2" width="7" height="4" rx="1" fill="#7FA3D6"/><path d="M13 3.5 H19" stroke="#7FA3D6" stroke-width="2" stroke-linecap="round"/></svg>`;

/**
 * Carte complète : fond (image ou mer), formes des territoires, bulles (boutons), flèches et cortège.
 * @param {{image?: string|null, terrs: object[]}} opts terrs = [{id, nom, couleur, clair, a, mine, clic, proprietaire, armee}].
 * @returns {string} HTML (<div class="rk-carte">).
 */
export function plateauHtml({ image = null, terrs = [] } = {}) {
  const fond = image ? `<img class="rk-fond-img" src="${esc(image)}" alt="" width="1376" height="768">` : '';
  const formes = terrs.map((t) => {
    const d = FORMES[t.id] || disque(t.id);
    if (!d) return '';
    return `<path class="rk-forme" d="${d}" fill="${esc(t.couleur)}" data-forme="${esc(t.id)}"></path>`;
  }).join('');
  const bulles = terrs.map((t) => {
    const classes = ['rk-terr'];
    if (t.mine) classes.push('is-moi');
    const armee = t.armee ? `, armée ${t.armee}` : '';
    const proprio = t.proprietaire ? `, à ${t.proprietaire}${armee}` : ', libre';
    const nom = `${t.nom}${proprio}, ${t.a} troupe${t.a > 1 ? 's' : ''}`;
    const pastille = `<span class="rk-pastille${t.clair ? ' is-clair' : ''}" style="background:${esc(t.couleur)}" aria-hidden="true">${esc(t.a)}</span>`;
    return `<button type="button" class="${classes.join(' ')}" style="${posCss(t.id)}" data-terr="${esc(t.id)}" title="${esc(t.nom)}" aria-label="${esc(nom)}"${t.clic ? '' : ' disabled'}>${pastille}</button>`;
  }).join('');
  return `<div class="rk-carte rk-carte--image${image ? '' : ' rk-carte--sans-image'}">
    ${fond}
    <div class="rk-radar" aria-hidden="true"><span class="rk-balayage"></span></div>
    <svg class="rk-formes" viewBox="0 0 ${LARGEUR} ${HAUTEUR}" aria-hidden="true" focusable="false">${formes}</svg>
    <svg class="rk-fleches" viewBox="0 0 ${LARGEUR} ${HAUTEUR}" aria-hidden="true" focusable="false" data-fleches>
      <defs><marker id="rk-pointe" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0 L9 4.5 L0 9z" fill="#F2EFEA"></path></marker></defs>
    </svg>
    <div class="rk-pions">${bulles}</div>
    <div class="rk-cortege" data-cortege aria-hidden="true"></div>
  </div>`;
}

/**
 * Marque la sélection sur la carte déjà dessinée, sans la reconstruire (le focus reste en place).
 * @param {HTMLElement} zone zone de la carte.
 * @param {{de?: string|null, vers?: string|null, cibles?: string[], clics?: string[]}} sel
 */
export function marquer(zone, { de = null, vers = null, cibles = [], clics = [] } = {}) {
  const hl = new Set(cibles);
  const ok = new Set(clics);
  zone.querySelectorAll('[data-terr]').forEach((b) => {
    const id = b.dataset.terr;
    b.classList.toggle('is-sel', id === de);
    b.classList.toggle('is-vers', id === vers);
    b.classList.toggle('is-hl', hl.has(id));
  });
  zone.querySelectorAll('[data-forme]').forEach((f) => {
    const id = f.dataset.forme;
    f.classList.toggle('is-clic', ok.has(id));
    f.classList.toggle('is-sel', id === de);
    f.classList.toggle('is-vers', id === vers);
    f.classList.toggle('is-hl', hl.has(id));
  });
}

/**
 * Trace la flèche entre deux territoires (attaque ou déplacement). Sans arguments utiles, efface la flèche.
 * @param {HTMLElement} zone zone de la carte.
 * @param {{de?: string|null, vers?: string|null, style?: 'attaque'|'choix'}} sel
 */
export function fleche(zone, { de = null, vers = null, style = 'choix' } = {}) {
  const svg = zone.querySelector('[data-fleches]');
  if (!svg) return;
  const a = ancre(de);
  const b = ancre(vers);
  const garde = svg.querySelector('defs')?.outerHTML || '';
  if (!a || !b || de === vers) { svg.innerHTML = garde; return; }
  svg.innerHTML = `${garde}<line class="rk-fleche is-${style}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" marker-end="url(#rk-pointe)"></line>`;
}

/** Cortège d'un déplacement : un char et quelques soldats qui vont de de à vers, puis disparaissent. */
export function animerMouvement(zone, de, vers, n) {
  const cortege = zone.querySelector('[data-cortege]');
  const a = ancre(de);
  const b = ancre(vers);
  if (!cortege || !a || !b) return;
  const x0 = pct(a[0], LARGEUR); const y0 = pct(a[1], HAUTEUR);
  const x1 = pct(b[0], LARGEUR); const y1 = pct(b[1], HAUTEUR);
  // Le point du milieu est levé : le trajet fait un arc au lieu d'une ligne droite.
  const xm = ((Number(x0) + Number(x1)) / 2).toFixed(2);
  const ym = ((Number(y0) + Number(y1)) / 2 - 5).toFixed(2);
  const style = (delai) => `--x0:${x0}%;--y0:${y0}%;--xm:${xm}%;--ym:${ym}%;--x1:${x1}%;--y1:${y1}%;animation-delay:${delai}s`;
  const soldats = Math.min(4, Math.max(1, n));
  let html = `<div class="rk-marche rk-marche--char" style="${style(0)}">${CHAR}</div>`;
  for (let i = 0; i < soldats; i += 1) {
    html += `<div class="rk-marche" style="${style(0.15 + i * 0.25)}"><div class="rk-pas">${soldat('#4F7FC4')}</div></div>`;
  }
  cortege.innerHTML = html;
  setTimeout(() => { cortege.innerHTML = ''; }, 5200);
}

/** Soldats rouges qui tombent sur le territoire (pertes), après le lancer de dés. */
export function animerChutes(zone, id, n) {
  const cortege = zone.querySelector('[data-cortege]');
  if (!cortege || !ancre(id) || n < 1) return;
  const k = Math.min(3, n);
  let html = '';
  for (let i = 0; i < k; i += 1) {
    html += `<div class="rk-chute" style="${posCss(id)};--dx:${i * 14 - 14}px;animation-delay:${(3.9 + i * 0.15).toFixed(2)}s">${soldat('#D9434F')}</div>`;
  }
  cortege.insertAdjacentHTML('beforeend', html);
  setTimeout(() => cortege.querySelectorAll('.rk-chute').forEach((x) => x.remove()), 6000);
}

/**
 * Compteur qui baisse : l'ancien chiffre reste visible sur la bulle, puis s'efface et laisse voir le nouveau.
 * @param {HTMLElement} zone zone de la carte.
 * @param {string} id territoire.
 * @param {number} avant nombre de troupes avant le combat.
 */
export function animerCompteur(zone, id, avant) {
  const pastille = zone.querySelector(`[data-terr="${CSS.escape(id)}"] .rk-pastille`);
  if (!pastille || avant === undefined) return;
  const ancien = document.createElement('span');
  ancien.className = 'rk-avant';
  ancien.setAttribute('aria-hidden', 'true');
  ancien.textContent = String(avant);
  pastille.append(ancien);
  setTimeout(() => ancien.remove(), 5200);
}
