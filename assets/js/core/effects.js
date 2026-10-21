// Effets visuels légers (calque derrière le contenu, sans interaction) : étoiles, neige, pluie d'emojis.
import { getPrefs } from './prefs-state.js';
import { reducedMotion, esc } from './util.js';
import { emojiAt } from './theme-calc.js';

/** Effets visuels autorisés par l'utilisateur (préférence) — ne tient pas compte de prefers-reduced-motion. */
export function effectsEnabled() { return getPrefs().effects; }
/** Effets réellement joués : préférence on ET pas de demande de mouvement réduit. */
export function motionAllowed() { return getPrefs().effects && !reducedMotion(); }

/** Redessine le calque d'effets pour le thème donné (ou le retire). */
export function startEffects(theme) {
  document.querySelector('.fx-layer')?.remove();
  const fx = theme?.effect;
  if (!document.body || !fx || fx === 'aucun' || !motionAllowed()) return;
  const layer = document.createElement('div');
  layer.className = `fx-layer fx-${fx}`;
  layer.setAttribute('aria-hidden', 'true');
  const rnd = (a, b) => a + Math.random() * (b - a);
  const small = innerWidth < 600;
  const count = { pluie: small ? 9 : 18, neige: small ? 18 : 34, etoiles: small ? 16 : 30 }[fx] ?? 0;
  // Répartition régulière sur toute la largeur (une colonne par élément, position aléatoire dans sa colonne)
  const col = (i) => (((i + rnd(0.15, 0.85)) / count) * 100).toFixed(1);
  const order = [...Array(count).keys()].sort(() => Math.random() - 0.5);
  let html = '';
  for (let i = 0; i < count; i++) {
    if (fx === 'pluie') {
      const e = emojiAt(theme.emojis, i);
      if (!e) break;
      const d = rnd(16, 28);
      html += `<span style="left:min(${col(order[i])}%, calc(100% - 30px));font-size:${rnd(16, 26).toFixed(0)}px;animation-duration:${d.toFixed(1)}s;animation-delay:-${rnd(0, d).toFixed(1)}s;--dx:${rnd(-40, 40).toFixed(0)}px;--r:${rnd(-160, 160).toFixed(0)}deg">${esc(e)}</span>`;
    } else if (fx === 'neige') {
      const d = rnd(12, 24), s = rnd(3, 7);
      html += `<span style="left:${col(order[i])}%;width:${s.toFixed(1)}px;height:${s.toFixed(1)}px;animation-duration:${d.toFixed(1)}s;animation-delay:-${rnd(0, d).toFixed(1)}s;--dx:${rnd(-50, 50).toFixed(0)}px;opacity:${rnd(0.35, 0.8).toFixed(2)}"></span>`;
    } else if (fx === 'etoiles') {
      const d = rnd(3, 7), s = rnd(2, 3.5);
      html += `<span style="left:${col(order[i])}%;top:${rnd(0, 99).toFixed(1)}%;width:${s.toFixed(1)}px;height:${s.toFixed(1)}px;animation-duration:${d.toFixed(1)}s;animation-delay:-${rnd(0, d).toFixed(1)}s"></span>`;
    }
  }
  if (!html) return;
  layer.innerHTML = html;
  document.body.prepend(layer);
}
