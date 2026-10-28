// ===== Humane Gang — popup du calendrier de l'Avent (paquet cadeau de l'en-tête, rappel de la page Cartes) =====
/*
 * Rôle : une <dialog> modale qui contient le calendrier de l'Avent (avent.js) : en-tête rouge (cases ouvertes et à
 * rattraper), légende, grille de cases carrées, contenu révélé, jauge collective. À l'ouverture, une pluie de neige,
 * de cœurs et de paquets traverse l'écran ; à chaque case ouverte, une pluie plus petite. Aucune pluie si
 * motionAllowed() est faux (mouvement réduit ou « Effets visuels » coupés). Plein écran sur téléphone (760 px et moins).
 * Accessibilité : Échap, la croix (44 px) et le clic sur le fond ferment ; le focus revient à l'élément qui a ouvert
 * la popup (le paquet ou le rappel).
 * Chargé à la demande (clic sur le paquet ou sur le rappel) : jamais hors saison.
 * Dépendances : core.js (motionAllowed, toast, errMsg, esc), avent.js (mountAdvent, adventSubtitle), saisons-css.js.
 * Exporte : openAvent({ returnTo, onChange }).
 */
import { motionAllowed, toast, errMsg, esc } from '../../commun/core.js';
import { mountAdvent, adventSubtitle } from './avent.js';
import { loadSeasonCss } from './saisons-css.js';

const CLOSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const BOW = '<svg class="av-bow" viewBox="0 0 66 48" aria-hidden="true"><path d="M33 22C24 6 6 4 8 16c2 10 16 8 25 6z" fill="#E2C77E" stroke="#8a6a1e" stroke-width="2"/><path d="M33 22c9-16 27-18 25-6-2 10-16 8-25 6z" fill="#E2C77E" stroke="#8a6a1e" stroke-width="2"/><path d="M30 24l-8 20 6-3 3 6 4-21zM36 24l8 20-6-3-3 6-4-21z" fill="#d4b061"/><circle cx="33" cy="22" r="5" fill="#f4d78f" stroke="#8a6a1e" stroke-width="2"/></svg>';

/** Formes de la pluie (SVG) : flocon, neige ronde, cœur, paquet cadeau. */
const FORMES = [
  () => '<svg viewBox="0 0 24 24"><g stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10"/><path d="M12 5l-2.5-2M12 5l2.5-2M12 19l-2.5 2M12 19l2.5 2" stroke-width="1.6"/></g></svg>',
  () => '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="#fff" opacity=".9"/></svg>',
  () => { const c = ['#E0909A', '#d1243b', '#ff6f91'][Math.floor(Math.random() * 3)]; return `<svg viewBox="0 0 24 24"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z" fill="${c}"/></svg>`; },
  () => { const p = [['#B70127', '#E2C77E'], ['#2B5AE2', '#F2EFEA'], ['#159946', '#FBD32D'], ['#4E2398', '#E0909A']][Math.floor(Math.random() * 4)];
    return `<svg viewBox="0 0 24 24"><rect x="3" y="9" width="18" height="12" rx="1.5" fill="${p[0]}"/><rect x="2" y="6" width="20" height="5" rx="1.2" fill="${p[0]}" opacity=".85"/><rect x="10.5" y="6" width="3" height="15" fill="${p[1]}"/><path d="M12 6c-2-4-6-4-6-2s4 2 6 2zM12 6c2-4 6-4 6-2s-4 2-6 2z" fill="${p[1]}"/></svg>`; },
];

let dlg = null, body = null, rain = null, eyebrow = null, sub = null;
let returnEl = null, onChange = null;

/** Crée la <dialog> une seule fois, à la fin du document. */
function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'av-dlg';
  dlg.setAttribute('aria-labelledby', 'av-dlg-t');
  dlg.innerHTML = `<div class="av-dlg-in">
      <div class="av-dlg-head">
        <div class="av-dlg-txt"><p class="av-eyebrow"></p><h2 id="av-dlg-t">Calendrier de l’Avent</h2><p class="av-sub"></p></div>
        ${BOW}
        <button type="button" class="av-close" aria-label="Fermer le calendrier">${CLOSE}</button>
      </div>
      <div class="av-dlg-body" aria-busy="true"></div>
    </div>
    <div class="av-rain" aria-hidden="true"></div>`;
  eyebrow = dlg.querySelector('.av-eyebrow');
  sub = dlg.querySelector('.av-sub');
  body = dlg.querySelector('.av-dlg-body');
  rain = dlg.querySelector('.av-rain');
  dlg.querySelector('.av-close').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => {
    rain.replaceChildren();
    if (returnEl?.isConnected) returnEl.focus();
  });
  document.body.append(dlg);
}

/**
 * Pluie de formes qui tombent dans la popup (supprimées à la fin de leur chute).
 * @param {number} n Nombre d'éléments.
 */
function pluie(n) {
  if (!rain || !dlg?.open || !motionAllowed()) return;
  const W = window.innerWidth, frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) {
    const t = Math.random(), f = t < 0.4 ? (Math.random() < 0.5 ? 0 : 1) : t < 0.7 ? 2 : 3;
    const s = f === 1 ? 8 + Math.random() * 8 : f === 3 ? 22 + Math.random() * 16 : 16 + Math.random() * 14;
    const el = document.createElement('span');
    el.className = 'av-drop';
    el.style.cssText = `left:${Math.random() * W}px;width:${s}px;height:${s}px;--d:${3 + Math.random() * 3}s;--delay:${Math.random() * 1.6}s;`
      + `--dx:${(Math.random() - 0.5) * 160}px;--r:${(Math.random() - 0.5) * 540}deg;--s:${0.9 + Math.random() * 1.2}s;opacity:${0.75 + Math.random() * 0.25}`;
    el.innerHTML = FORMES[f]();
    el.addEventListener('animationend', (e) => { if (e.animationName === 'av-fall') el.remove(); });
    frag.append(el);
  }
  rain.append(frag);
}

/**
 * Ouvre la popup et y charge le calendrier. Le focus revient à returnTo à la fermeture.
 * @param {{returnTo?: HTMLElement|null, onChange?: (data: object) => void}} [o]
 *   returnTo : élément qui a ouvert la popup ; onChange : reçoit les données à chaque rendu (paquet, pastille).
 * @returns {Promise<boolean>} vrai si le calendrier est affiché.
 */
export async function openAvent({ returnTo = null, onChange: cb = null } = {}) {
  if (!dlg) build();
  returnEl = returnTo || document.activeElement;
  onChange = cb;
  loadSeasonCss({ cards: true, popup: true });
  body.setAttribute('aria-busy', 'true');
  body.innerHTML = '<p class="av-loading">Chargement…</p>';
  if (!dlg.open) dlg.showModal();
  pluie(window.innerWidth <= 760 ? 60 : 110);
  try {
    const ok = await mountAdvent(body, {
      onUpdate: (data) => {
        eyebrow.textContent = `Décembre ${data.year}`;
        sub.textContent = adventSubtitle(data);
        onChange?.(data);
      },
      onOpened: () => pluie(40),
    });
    body.removeAttribute('aria-busy');
    if (!ok) {
      body.innerHTML = '<p class="av-loading">Le calendrier n’est pas ouvert pour le moment.</p>';
      return false;
    }
    return true;
  } catch (e) {
    body.removeAttribute('aria-busy');
    body.innerHTML = `<p class="av-loading">${esc(errMsg(e))}</p>`;
    toast(errMsg(e), 'error');
    return false;
  }
}
