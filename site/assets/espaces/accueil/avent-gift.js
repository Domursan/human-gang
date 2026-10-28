// ===== Humane Gang — paquet cadeau du calendrier de l'Avent (barre du haut, membre, saison seulement) =====
/*
 * Rôle : ajoute dans l'en-tête, entre le logo et le menu, le bouton « paquet cadeau » qui ouvre le calendrier de l'Avent
 * dans une popup (avent-popup.js). Sa pastille compte les cases à ouvrir ou à rattraper ; un seul appel hg_advent_me.
 * Si le calendrier n'est pas actif, si l'appel échoue ou si l'en-tête a changé entre-temps : pas de paquet.
 * Appelé par commun/core/header.js uniquement du 30 novembre au 1er janvier (rien n'est chargé hors saison).
 * Dépendances : core.js (sb), saisons-css.js (loadSeasonCss). La popup est importée au clic seulement.
 * Exporte : mountGift(header), adventLeft(data).
 */
import { sb } from '../../commun/core.js';
import { loadSeasonCss } from './saisons-css.js';

/** Nombre de cases à ouvrir aujourd'hui ou à rattraper (les deux comptent pour la pastille). */
export function adventLeft(data) {
  return (data?.days || []).filter((d) => d.state === 'a_ouvrir' || d.state === 'a_rattraper').length;
}

/** Ligne sous le titre du paquet (ordinateur seulement). */
function giftText(data, left) {
  if (!data.today || data.today < 1) return 'Dès le 1er décembre';
  if (data.complete) return 'Calendrier complet';
  const today = data.days.find((d) => d.day === data.today);
  if (today?.state === 'a_ouvrir') return `Case du ${today.day} à ouvrir`;
  if (left) return left > 1 ? `${left} cases à rattraper` : 'Une case à rattraper';
  return 'À demain, 6 h';
}

/** Met à jour le bouton : pastille, ligne de texte et nom accessible. */
function paint(btn, data) {
  const left = adventLeft(data);
  btn.querySelector('small').textContent = giftText(data, left);
  const badge = btn.querySelector('.av-gift-badge');
  badge.textContent = String(left);
  badge.hidden = !left;
  btn.setAttribute('aria-label', `Ouvrir le calendrier de l’Avent : ${left
    ? `${left} ${left > 1 ? 'cases' : 'case'} à ouvrir ou à rattraper`
    : 'rien à ouvrir pour le moment'}`);
}

/**
 * Pose le paquet cadeau dans l'en-tête (après le logo). Ne fait rien si le calendrier est fermé ou en erreur.
 * @param {HTMLElement} header En-tête du site (membre connecté).
 */
export async function mountGift(header) {
  let data;
  try {
    const { data: d, error } = await sb.rpc('hg_advent_me');
    if (error || !d?.active) return;
    data = d;
  } catch { return; }
  const brand = header.querySelector('.brand');
  if (!brand || !header.isConnected || header.querySelector('.av-gift-zone')) return;
  loadSeasonCss({ popup: true });
  const zone = document.createElement('div');
  zone.className = 'av-gift-zone';
  zone.innerHTML = `<button type="button" class="av-gift" aria-haspopup="dialog">
      <svg class="av-gift-ico" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M24 13c-3-7-12-8-12-3 0 4 8 4 12 3z" fill="#E2C77E" stroke="#8a6a1e" stroke-width="1.5"/>
        <path d="M24 13c3-7 12-8 12-3 0 4-8 4-12 3z" fill="#E2C77E" stroke="#8a6a1e" stroke-width="1.5"/>
        <rect x="6" y="14" width="36" height="9" rx="2" fill="#d1243b"/>
        <rect x="9" y="23" width="30" height="20" rx="2" fill="#B70127"/>
        <rect x="21" y="14" width="6" height="29" fill="#E2C77E"/>
        <rect x="6" y="14" width="36" height="9" rx="2" fill="none" stroke="#5b0714" stroke-width="1.5"/>
        <rect x="9" y="23" width="30" height="20" rx="2" fill="none" stroke="#5b0714" stroke-width="1.5"/>
        <circle cx="24" cy="13" r="2.6" fill="#f4d78f" stroke="#8a6a1e" stroke-width="1.2"/>
      </svg>
      <span class="av-gift-txt"><b>Calendrier de l’Avent</b><small></small></span>
      <span class="av-gift-badge" aria-hidden="true" hidden></span>
    </button>`;
  brand.after(zone);
  const btn = zone.querySelector('.av-gift');
  paint(btn, data);
  btn.addEventListener('click', () => {
    import('./avent-popup.js')
      .then((m) => m.openAvent({ returnTo: btn, onChange: (d) => paint(btn, d) }))
      .catch((e) => console.warn('[avent]', e));
  });
}
