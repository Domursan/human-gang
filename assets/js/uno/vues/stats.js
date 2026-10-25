// ===== Humane Gang — Uno : mes statistiques (#stats) =====
/*
 * Rôle : statistiques du membre connecté : tuiles (parties, victoires, taux, meilleure série, cartes jouées, UNO oubliés,
 * défis gagnés), badges (obtenus avec la date, verrouillés avec leur condition) et dernières parties.
 * Les Paillettes ne sont pas affichées aux invités. Les états vides (nouveau joueur) ont leur propre message.
 * Dépendances : core.js (esc, avatarHtml), uno/api.js (uno, erreurTexte, estInvite).
 * Exporte : afficher.
 */
import { esc } from '../../core.js';
import { uno, erreurTexte, estInvite } from '../api.js';

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

/* ---------- Blocs ---------- */

function htmlTuiles(s, invite) {
  const parties = Number(s.parties) || 0;
  const victoires = Number(s.victoires) || 0;
  const tuilesHaut = [
    { valeur: nombre(parties), nom: 'parties jouées' },
    { valeur: nombre(victoires), nom: 'victoires', cls: 'vert' },
    { valeur: `${pourcent(victoires, parties)}&nbsp;%`, nom: 'de victoires' },
    { valeur: nombre(s.meilleure_serie), nom: 'meilleure série', cls: 'or' },
  ];
  const tuilesBas = [
    { valeur: nombre(s.cartes_jouees), nom: 'cartes jouées' },
    { valeur: nombre(s.oublis_uno), nom: 'UNO oubliés', cls: 'rose' },
    { valeur: nombre(s.defis_gagnes), nom: 'défis gagnés' },
  ];
  const tuile = (t) => `<div class="uno-st-tuile${t.cls ? ` ${t.cls}` : ''}">
      <span class="uno-st-chiffre">${t.valeur}</span><span class="uno-st-tuile-nom">${esc(t.nom)}</span>
    </div>`;
  return `<div class="uno-st-grille uno-st-grille-4">${tuilesHaut.map(tuile).join('')}</div>
    <div class="uno-st-grille uno-st-grille-3">${tuilesBas.map(tuile).join('')}</div>
    ${parties ? '' : '<p class="uno-st-aide">Pas encore de partie jouée. Tes statistiques se rempliront après ta première partie.</p>'}`;
}

function ligneBadge(b) {
  const obtenu = !!b.obtenu;
  const statut = obtenu
    ? `<span class="uno-st-statut">Obtenu le ${esc(dateCourte(b.date))}</span>`
    : `<span class="uno-st-statut">Condition : ${esc(b.description)}</span>`;
  return `<li class="uno-st-badge${obtenu ? ' obtenu' : ''}">
    <span class="uno-st-medaille" aria-hidden="true">${obtenu ? ICONE_OK : ICONE_CADENAS}</span>
    <div class="uno-st-badge-texte">
      <strong>${esc(b.nom)}</strong>
      <span class="uno-st-sous">${obtenu ? `${esc(b.description)} · ` : ''}${statut}</span>
    </div>
  </li>`;
}

function htmlBadges(badges) {
  if (!badges.length) return '<p class="uno-st-aide">Aucun badge pour le moment.</p>';
  const obtenus = badges.filter((b) => b.obtenu).length;
  return `<p class="uno-st-sous">${nombre(obtenus)} obtenu${obtenus > 1 ? 's' : ''} sur ${nombre(badges.length)}</p>
    <ul class="uno-st-liste-badges">${badges.map(ligneBadge).join('')}</ul>`;
}

function htmlDernieres(parties, invite) {
  if (!parties.length) return '<p class="uno-st-aide">Aucune partie terminée pour l\'instant.</p>';
  return `<table class="uno-st-table" aria-labelledby="uno-st-parties-titre">
    <thead><tr>
      <th scope="col">Date</th>
      <th scope="col">Joueurs</th>
      <th scope="col">Rang</th>
      ${invite ? '' : '<th scope="col" class="droite">Paillettes</th>'}
    </tr></thead>
    <tbody>${parties.map((p) => `<tr>
      <td>${esc(dateCourte(p.date))}</td>
      <td>${nombre(p.joueurs)}</td>
      <td class="${Number(p.rang) === 1 ? 'uno-st-premier' : ''}">${rangTexte(p.rang)}</td>
      ${invite ? '' : `<td class="droite"><strong>+${nombre(p.paillettes)}</strong></td>`}
    </tr>`).join('')}</tbody>
  </table>`;
}

/* ---------- Écran ---------- */

/**
 * Affiche les statistiques Uno du membre dans root. Renvoie la fonction de nettoyage.
 * @param {HTMLElement} root
 */
export async function afficher(root) {
  let actif = true;
  const invite = estInvite();

  root.innerHTML = `<div class="uno-st">
    <nav class="uno-fil" aria-label="Fil d'Ariane"><a href="jeux.html">Jeux</a> › <a href="uno.html">Uno</a> › <span aria-current="page">Statistiques</span></nav>
    <h1 class="uno-titre display" id="uno-st-titre">Mes statistiques Uno</h1>
    <div id="uno-st-zone" aria-live="polite"><p class="uno-st-aide">Chargement…</p></div>
  </div>`;

  const zone = root.querySelector('#uno-st-zone');
  try {
    const s = await uno.stats();
    if (!actif) return;
    if (!s) {
      zone.innerHTML = '<p class="uno-st-aide">Tes statistiques ne sont pas disponibles pour ton compte.</p>';
      return;
    }
    const badges = Array.isArray(s.badges) ? s.badges : [];
    const dernieres = Array.isArray(s.dernieres) ? s.dernieres : [];
    zone.innerHTML = `${htmlTuiles(s, invite)}
      <div class="uno-st-duo">
        <section class="card uno-st-section" aria-labelledby="uno-st-badges-titre">
          <h2 id="uno-st-badges-titre" class="uno-st-titre">Badges</h2>
          ${htmlBadges(badges)}
        </section>
        <section class="card uno-st-section" aria-labelledby="uno-st-parties-titre">
          <h2 id="uno-st-parties-titre" class="uno-st-titre">Dernières parties</h2>
          ${htmlDernieres(dernieres, invite)}
        </section>
      </div>`;
  } catch (e) {
    if (!actif) return;
    zone.innerHTML = `<p class="uno-st-aide" role="alert">Statistiques indisponibles pour l'instant. ${esc(erreurTexte(e))}</p>`;
  }

  return () => { actif = false; };
}
