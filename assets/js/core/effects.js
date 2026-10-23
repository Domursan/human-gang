// Effets visuels légers (calque derrière le contenu, sans interaction) : étoiles, neige, pluie d'emojis, fromage.
/*
 * Rôle : dessine, sur toute la page, une couche décorative (étoiles, neige, emojis qui tombent, ou gourmandises
 * qui dérivent pour le thème « fromage ») selon le thème actif. Le calque n'intercepte aucun clic (aria-hidden, décoratif).
 * Le thème « fromage » pose aussi la classe fx-fromage sur <html> : coulée de fromage sous l'en-tête et gouttes sous
 * les boutons principaux et les cadres (dessinées en CSS, base.css). Pas de gouttes sur la page d'administration.
 * Page : toutes les pages (appelé par init.js à l'initialisation, et à chaque changement de thème).
 * Dépendances : prefs-state.js (préférence « effets »), util.js (reducedMotion, esc), theme-calc.js (emojiAt).
 * Exporte : effectsEnabled, motionAllowed, applyFromageClass, startEffects.
 */
import { getPrefs } from './prefs-state.js';
import { reducedMotion, esc } from './util.js';
import { emojiAt } from './theme-calc.js';

/** Effets visuels autorisés par l'utilisateur (préférence) — ne tient pas compte de prefers-reduced-motion. */
export function effectsEnabled() { return getPrefs().effects; }
/** Effets réellement joués : préférence on ET pas de demande de mouvement réduit. */
export function motionAllowed() { return getPrefs().effects && !reducedMotion(); }

/** Gourmandises du thème « fromage » (SVG inline, cadre 60 x 60) : cornichon, rondelle de salami, tranche de jambon, viande séchée. */
const GOURMANDISES = {
  cornichon: '<path d="M30 3C42 3 43 16 41 30C39 44 44 52 36 57C33 59 27 59 24 57C16 52 21 44 19 30C17 16 18 3 30 3Z" fill="#6E8B3D"/><path d="M24 12C22 24 22 38 24 50" stroke="#A6BF6B" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/><g fill="#4B6328"><circle cx="30" cy="15" r="1.3"/><circle cx="36" cy="26" r="1.2"/><circle cx="28" cy="36" r="1.4"/><circle cx="36" cy="47" r="1.2"/><circle cx="29" cy="53" r="1"/></g>',
  salami: '<circle cx="30" cy="30" r="27" fill="#B2473A" stroke="#7E2C24" stroke-width="2.5"/><circle cx="30" cy="30" r="21" fill="none" stroke="#C9645A" stroke-width="1" opacity=".6"/><g fill="#F4E3C1"><circle cx="20" cy="22" r="3"/><circle cx="36" cy="18" r="2.4"/><circle cx="41" cy="34" r="3.2"/><circle cx="25" cy="41" r="2.6"/><circle cx="34" cy="48" r="2"/><circle cx="16" cy="36" r="1.8"/><circle cx="30" cy="30" r="1.6"/></g>',
  jambon: '<path d="M8 22C14 10 30 8 40 12C50 16 56 26 52 38C49 48 36 54 24 50C14 47 6 36 8 22Z" fill="#F3BDB2" stroke="#FFF7EE" stroke-width="4"/><path d="M18 26C24 22 34 24 40 30M20 40C28 36 38 38 44 43" stroke="#E08C80" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>',
  sechee: '<path d="M6 26C10 16 22 14 34 16C46 17 54 22 54 32C54 42 46 46 34 45C22 44 10 42 6 34C5 31 5 29 6 26Z" fill="#7A3B2A"/><path d="M12 28C22 25 34 26 46 29M14 36C24 33 36 34 48 37" stroke="#4E2118" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="40" cy="22" r="1.6" fill="#F4E3C1" opacity=".8"/>',
};
/** Ordre des gourmandises dans le calque (le cycle se répète si le calque en contient davantage). */
const GOURMANDISE_KINDS = ['cornichon', 'salami', 'jambon', 'sechee'];

/**
 * Vrai sur la page d'administration (admin.html) : le thème ne met pas de gouttes sous ses boutons et cadres.
 * @returns {boolean}
 */
const onAdminPage = () => /(^|\/)admin\.html$/.test(location.pathname);

/**
 * Pose ou retire la classe fx-fromage sur <html> (coulée et gouttes du thème « fromage »). Coupée avec la préférence
 * « effets » et absente de la page d'administration. Appelée aussi au démarrage (theme.js) pour que l'en-tête ait sa
 * place dès le premier affichage.
 * @param {object|null} theme Thème affiché.
 */
export function applyFromageClass(theme) {
  document.documentElement.classList.toggle('fx-fromage', theme?.effect === 'fromage' && effectsEnabled() && !onAdminPage());
}

/**
 * Redessine le calque d'effets pour le thème donné (ou le retire).
 * Le calque précédent est toujours supprimé d'abord, pour ne jamais empiler deux couches.
 * @param {object|null} theme Thème actif ; son champ `effect` vaut 'pluie', 'neige', 'etoiles', 'fromage' ou 'aucun'.
 */
export function startEffects(theme) {
  document.querySelector('.fx-layer')?.remove();
  const fx = theme?.effect;
  // Coulée et gouttes du fromage : classe sur <html> (dessinée en CSS), même si les gourmandises ne bougent pas
  // (mouvement réduit). Coupées avec la préférence « effets », et absentes de la page d'administration.
  applyFromageClass(theme);
  if (!document.body || !fx || fx === 'aucun' || !motionAllowed()) return;
  const layer = document.createElement('div');
  layer.className = `fx-layer fx-${fx}`;
  layer.setAttribute('aria-hidden', 'true');
  /** Nombre aléatoire entre a et b. */
  const rnd = (a, b) => a + Math.random() * (b - a);
  const small = innerWidth < 600; // petit écran : moins d'éléments pour rester fluide
  const count = { pluie: small ? 9 : 18, neige: small ? 18 : 34, etoiles: small ? 16 : 30, fromage: small ? 4 : 7 }[fx] ?? 0;
  // Répartition régulière sur toute la largeur (une colonne par élément, position aléatoire dans sa colonne)
  /** Position horizontale (en %) de l'élément i, tirée au hasard dans sa colonne. */
  const col = (i) => (((i + rnd(0.15, 0.85)) / count) * 100).toFixed(1);
  // Ordre mélangé des colonnes : les éléments ne tombent pas tous dans le même ordre de gauche à droite
  const order = [...Array(count).keys()].sort(() => Math.random() - 0.5);
  let html = '';
  for (let i = 0; i < count; i++) {
    if (fx === 'pluie') {
      // Emojis du thème, dans l'ordre ; s'il n'y en a plus, on arrête (pas de répétition vide)
      const e = emojiAt(theme.emojis, i);
      if (!e) break;
      const d = rnd(16, 28); // durée chute, en s
      html += `<span style="left:min(${col(order[i])}%, calc(100% - 30px));font-size:${rnd(16, 26).toFixed(0)}px;animation-duration:${d.toFixed(1)}s;animation-delay:-${rnd(0, d).toFixed(1)}s;--dx:${rnd(-40, 40).toFixed(0)}px;--r:${rnd(-160, 160).toFixed(0)}deg">${esc(e)}</span>`;
    } else if (fx === 'neige') {
      const d = rnd(12, 24), s = rnd(3, 7); // durée de chute et taille du flocon
      html += `<span style="left:${col(order[i])}%;width:${s.toFixed(1)}px;height:${s.toFixed(1)}px;animation-duration:${d.toFixed(1)}s;animation-delay:-${rnd(0, d).toFixed(1)}s;--dx:${rnd(-50, 50).toFixed(0)}px;opacity:${rnd(0.35, 0.8).toFixed(2)}"></span>`;
    } else if (fx === 'etoiles') {
      // Étoiles qui scintillent : délai négatif pour que tout ne commence pas en même temps
      const d = rnd(3, 7), s = rnd(2, 3.5);
      html += `<span style="left:${col(order[i])}%;top:${rnd(0, 99).toFixed(1)}%;width:${s.toFixed(1)}px;height:${s.toFixed(1)}px;animation-duration:${d.toFixed(1)}s;animation-delay:-${rnd(0, d).toFixed(1)}s"></span>`;
    } else if (fx === 'fromage') {
      // Gourmandises qui dérivent lentement derrière le contenu : un aller dure 30 à 60 s, trajectoires variées
      const kind = GOURMANDISE_KINDS[i % GOURMANDISE_KINDS.length];
      const s = small ? rnd(36, 48) : rnd(46, 64), d = rnd(30, 60);
      html += `<span style="left:${col(order[i])}%;top:${rnd(0, 100).toFixed(1)}%;width:${s.toFixed(0)}px;height:${s.toFixed(0)}px;animation-duration:${d.toFixed(1)}s;animation-delay:-${rnd(0, d).toFixed(1)}s;--dx:${rnd(-22, 22).toFixed(1)}vw;--dy:${rnd(-14, 14).toFixed(1)}vh;--r0:${rnd(-30, 30).toFixed(0)}deg;--r1:${rnd(-30, 30).toFixed(0)}deg"><svg viewBox="0 0 60 60" aria-hidden="true" focusable="false">${GOURMANDISES[kind]}</svg></span>`;
    }
  }
  if (!html) return;
  layer.innerHTML = html;
  document.body.prepend(layer); // en premier dans le body : derrière le contenu
}
