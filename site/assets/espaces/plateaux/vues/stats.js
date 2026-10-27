// ===== Humane Gang — Jeux de plateau : mes statistiques (#stats) =====
/*
 * Rôle : statistiques du membre connecté pour ce jeu : tuiles (parties, victoires, taux, Paillettes), badges
 * (obtenus avec leur date, à obtenir avec leur condition) et dernières parties.
 * Données : plat.stats() → { parties, victoires, paillettes, badges: [{code, nom, description, obtenu, date}],
 * dernieres: [{code, nom, date, joueurs, gagne, rang, paillettes}] }.
 * Dépendances : core.js (esc), plateaux/api.js (plat, erreurTexte, jeu).
 * Exporte : afficher.
 */
import { esc } from '../../../commun/core.js';
import { plat, erreurTexte, jeu } from '../api.js';

const nombre = (n) => Number(n || 0).toLocaleString('fr-CH');
const pourcent = (part, total) => (Number(total) ? Math.round((Number(part) / Number(total)) * 100) : 0);

/** Date courte en français suisse (« 22 oct. »), chaîne vide si la date n'est pas valable. */
function dateCourte(valeur) {
  const t = new Date(valeur);
  return isNaN(t) ? '' : t.toLocaleDateString('fr-CH', { day: 'numeric', month: 'short' });
}

/** Rang lisible (« 1er », « 2e ») ou tiret si la partie n'est pas terminée. */
const rangTexte = (r) => (r == null ? '–' : Number(r) === 1 ? '1er' : `${r}e`);

const ICONE_OK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICONE_CADENAS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

/** Tuiles de chiffres. Les Paillettes ne sont pas affichées aux invités. */
function htmlTuiles(s, invite) {
  const parties = Number(s.parties) || 0;
  const victoires = Number(s.victoires) || 0;
  const tuiles = [
    { valeur: nombre(parties), nom: 'parties jouées' },
    { valeur: nombre(victoires), nom: 'victoires', cls: 'vert' },
    { valeur: `${pourcent(victoires, parties)}&nbsp;%`, nom: 'de victoires' },
  ];
  if (!invite) tuiles.push({ valeur: nombre(s.paillettes), nom: 'Paillettes', cls: 'or' });
  const tuile = (t) => `<div class="plat-st-tuile${t.cls ? ` ${t.cls}` : ''}">
      <span class="plat-st-chiffre">${t.valeur}</span><span class="plat-st-nom">${esc(t.nom)}</span>
    </div>`;
  return `<div class="plat-st-grille">${tuiles.map(tuile).join('')}</div>
    ${parties ? '' : '<p class="plat-st-aide">Pas encore de partie terminée. Tes statistiques se rempliront après ta première partie.</p>'}`;
}

/** Une ligne de badge : obtenu (date) ou verrouillé (condition). */
function ligneBadge(b) {
  const obtenu = !!b.obtenu;
  const statut = obtenu
    ? `<span class="plat-st-statut">Obtenu le ${esc(dateCourte(b.date))}</span>`
    : `<span class="plat-st-statut">Condition : ${esc(b.description)}</span>`;
  return `<li class="plat-st-badge${obtenu ? ' is-obtenu' : ''}">
    <span class="plat-st-medaille" aria-hidden="true">${obtenu ? ICONE_OK : ICONE_CADENAS}</span>
    <div>
      <strong>${esc(b.nom)}</strong>
      <span class="plat-st-sous">${obtenu ? `${esc(b.description)} · ` : ''}${statut}</span>
    </div>
  </li>`;
}

/** Liste des badges, avec le compte des obtenus. */
function htmlBadges(badges) {
  if (!badges.length) return '<p class="plat-st-aide">Aucun badge pour le moment.</p>';
  const obtenus = badges.filter((b) => b.obtenu).length;
  return `<p class="plat-st-sous">${nombre(obtenus)} obtenu${obtenus > 1 ? 's' : ''} sur ${nombre(badges.length)}</p>
    <ul class="plat-st-liste-badges">${badges.map(ligneBadge).join('')}</ul>`;
}

/** Tableau des dernières parties ; colonne Paillettes masquée pour les invités. */
function htmlDernieres(parties, invite) {
  if (!parties.length) return '<p class="plat-st-aide">Aucune partie terminée pour l\'instant.</p>';
  return `<div class="plat-st-table-cadre"><table class="plat-st-table">
    <caption class="visually-hidden">Dernières parties</caption>
    <thead><tr>
      <th scope="col">Date</th>
      <th scope="col">Joueurs</th>
      <th scope="col">Rang</th>
      ${invite ? '' : '<th scope="col" class="num">Paillettes</th>'}
    </tr></thead>
    <tbody>${parties.map((p) => `<tr>
      <td>${esc(dateCourte(p.date))}</td>
      <td>${nombre(p.joueurs)}</td>
      <td class="${Number(p.rang) === 1 ? 'plat-st-premier' : ''}">${rangTexte(p.rang)}</td>
      ${invite ? '' : `<td class="num"><strong>+${nombre(p.paillettes)}</strong></td>`}
    </tr>`).join('')}</tbody>
  </table></div>`;
}

/**
 * Affiche les statistiques du jeu de la page dans root. Renvoie la fonction de nettoyage.
 * @param {HTMLElement} root zone d'affichage (#app).
 */
export async function afficher(root) {
  let actif = true;
  const J = jeu();

  root.innerHTML = `<div class="plat-st">
    <nav class="plat-fil" aria-label="Fil d'Ariane"><a href="/pages/jeux/jeux.html">Jeux</a> › <a href="${esc(J.page)}">${esc(J.nom)}</a> › <span aria-current="page">Statistiques</span></nav>
    <h1 class="plat-titre display">Mes statistiques ${esc(J.nom)}</h1>
    <div data-zone aria-live="polite"><p class="plat-st-aide">Chargement…</p></div>
  </div>`;

  const zone = root.querySelector('[data-zone]');
  try {
    const s = await plat.stats();
    if (!actif) return;
    if (!s) {
      zone.innerHTML = '<p class="plat-st-aide">Tes statistiques ne sont pas disponibles pour ton compte.</p>';
      return;
    }
    const badges = Array.isArray(s.badges) ? s.badges : [];
    const dernieres = Array.isArray(s.dernieres) ? s.dernieres : [];
    zone.innerHTML = `${htmlTuiles(s, false)}
      <div class="plat-st-duo">
        <section class="card plat-carte" aria-labelledby="plat-st-badges-titre">
          <h2 id="plat-st-badges-titre">Badges</h2>
          ${htmlBadges(badges)}
        </section>
        <section class="card plat-carte" aria-labelledby="plat-st-parties-titre">
          <h2 id="plat-st-parties-titre">Dernières parties</h2>
          ${htmlDernieres(dernieres, false)}
        </section>
      </div>`;
  } catch (e) {
    if (!actif) return;
    zone.innerHTML = `<p class="plat-st-aide" role="alert">Statistiques indisponibles pour l'instant. ${esc(erreurTexte(e))}</p>`;
  }

  return () => { actif = false; };
}
