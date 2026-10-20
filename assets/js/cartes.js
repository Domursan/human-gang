// ===== Cartes à collectionner — page d'attente =====
// Accès : auth 'member' + contrôle par hg_pages (slug « cartes », mode « admin » pour l'instant) dans initPage.
// Rien de fonctionnel ici : le jeu viendra remplacer renderPreview() (garder initPage + #app).
import { initPage, esc, $, currentLogo } from './core.js';

const app = $('#app');
await initPage({ auth: 'member' });

/* Raretés (couleur du liseré). Réutilisables par le futur jeu. */
export const RARITIES = [
  { id: 'commune', label: 'Commune' },
  { id: 'rare', label: 'Rare' },
  { id: 'legendaire', label: 'Légendaire' },
];

function cardBack(r, i) {
  return `<li class="tcg-card tcg-${esc(r.id)}" style="--i:${i}">
      <div class="tcg-face" aria-hidden="true">
        <span class="tcg-corner tl"></span><span class="tcg-corner tr"></span><span class="tcg-corner bl"></span><span class="tcg-corner br"></span>
        <div class="tcg-pattern"></div>
        <div class="tcg-medal"><img class="tcg-logo" src="${esc(currentLogo())}" alt="" onerror="this.remove()"></div>
        <span class="tcg-gems"><i></i><i></i><i></i></span>
      </div>
      <p class="tcg-rarity"><span class="tcg-dot" aria-hidden="true"></span>${esc(r.label)}</p>
    </li>`;
}

function renderPreview() {
  app.innerHTML = `
    <section class="page-head cartes-head">
      <div>
        <p class="eyebrow">Bientôt</p>
        <h1 class="page-title">Cartes à collectionner</h1>
      </div>
      <p class="pill pill-current cartes-status">En préparation — réservé à l'admin pour l'instant</p>
    </section>
    <section class="card cartes-stage" aria-labelledby="cartes-preview-title">
      <h2 id="cartes-preview-title" class="visually-hidden">Aperçu des dos de cartes</h2>
      <ul class="tcg-fan" aria-label="Trois dos de cartes, un par rareté">
        ${RARITIES.map(cardBack).join('')}
      </ul>
      <p class="muted cartes-lead">Collectionne les membres du gang, leurs moments cultes et quelques cartes très rares. La couleur du liseré indique la rareté.</p>
    </section>`;
  app.removeAttribute('aria-busy');
}

renderPreview();
