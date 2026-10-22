// Effets visuels légers (calque derrière le contenu, sans interaction) : étoiles, neige, pluie d'emojis.
/*
 * Rôle : dessine, sur toute la page, une couche décorative (étoiles, neige ou emojis qui tombent)
 * selon le thème actif. Le calque n'intercepte aucun clic (aria-hidden, décoratif).
 * Page : toutes les pages (appelé par init.js à l'initialisation, et à chaque changement de thème).
 * Dépendances : prefs-state.js (préférence « effets »), util.js (reducedMotion, esc), theme-calc.js (emojiAt).
 * Exporte : effectsEnabled, motionAllowed, startEffects.
 */
import { getPrefs } from './prefs-state.js';
import { reducedMotion, esc } from './util.js';
import { emojiAt } from './theme-calc.js';

/** Effets visuels autorisés par l'utilisateur (préférence) — ne tient pas compte de prefers-reduced-motion. */
export function effectsEnabled() { return getPrefs().effects; }
/** Effets réellement joués : préférence on ET pas de demande de mouvement réduit. */
export function motionAllowed() { return getPrefs().effects && !reducedMotion(); }

/**
 * Redessine le calque d'effets pour le thème donné (ou le retire).
 * Le calque précédent est toujours supprimé d'abord, pour ne jamais empiler deux couches.
 * @param {object|null} theme Thème actif ; son champ `effect` vaut 'pluie', 'neige', 'etoiles' ou 'aucun'.
 */
export function startEffects(theme) {
  document.querySelector('.fx-layer')?.remove();
  const fx = theme?.effect;
  if (!document.body || !fx || fx === 'aucun' || !motionAllowed()) return;
  const layer = document.createElement('div');
  layer.className = `fx-layer fx-${fx}`;
  layer.setAttribute('aria-hidden', 'true');
  /** Nombre aléatoire entre a et b. */
  const rnd = (a, b) => a + Math.random() * (b - a);
  const small = innerWidth < 600; // petit écran : moins d'éléments pour rester fluide
  const count = { pluie: small ? 9 : 18, neige: small ? 18 : 34, etoiles: small ? 16 : 30 }[fx] ?? 0;
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
    }
  }
  if (!html) return;
  layer.innerHTML = html;
  document.body.prepend(layer); // en premier dans le body : derrière le contenu
}
