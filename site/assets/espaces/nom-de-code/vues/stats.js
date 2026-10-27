// ===== Humane Gang — Codenames : mes statistiques (#stats) =====
/*
 * Rôle : statistiques du membre connecté, sur les parties terminées : parties, victoires, taux, mots trouvés,
 * parties et victoires comme espion, meilleur indice (« Plage 3 → 4 mots ») et badges (obtenus avec la date,
 * verrouillés avec leur condition). Les états vides (aucune partie, aucun indice) ont leur propre message.
 * Dépendances : core.js (esc), nom-de-code/api.js (ndc, erreurTexte).
 * Exporte : afficher.
 */
import { esc } from '../../../commun/core.js';
import { ndc, erreurTexte } from '../api.js';

const nombre = (n) => Number(n || 0).toLocaleString('fr-CH');
const pourcent = (part, total) => (Number(total) ? `${Math.round((Number(part) / Number(total)) * 100)} %` : '–');

/** Date courte en français suisse (« 22 oct. »), chaîne vide si la date n'est pas valable. */
function dateCourte(valeur) {
  const t = new Date(valeur);
  return isNaN(t) ? '' : t.toLocaleDateString('fr-CH', { day: 'numeric', month: 'short' });
}

const ICONE_OK = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICONE_CADENAS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

/* ---------- Blocs ---------- */

function htmlTuiles(s) {
  const parties = Number(s.parties) || 0;
  const victoires = Number(s.victoires) || 0;
  const espion = Number(s.espion) || 0;
  const victoiresEspion = Number(s.victoires_espion) || 0;
  const haut = [
    { valeur: nombre(parties), nom: 'parties terminées' },
    { valeur: nombre(victoires), nom: 'victoires', cls: 'jaune' },
    { valeur: pourcent(victoires, parties), nom: 'de victoires' },
    { valeur: nombre(s.mots_trouves), nom: 'mots trouvés', cls: 'rose' },
  ];
  const bas = [
    { valeur: nombre(espion), nom: 'parties comme espion' },
    { valeur: nombre(victoiresEspion), nom: 'victoires comme espion', cls: 'jaune' },
    { valeur: pourcent(victoiresEspion, espion), nom: 'de victoires comme espion' },
  ];
  const tuile = (t) => `<div class="ndc-st-tuile${t.cls ? ` ${t.cls}` : ''}">
      <span class="ndc-st-chiffre">${t.valeur}</span><span class="ndc-st-tuile-nom">${esc(t.nom)}</span>
    </div>`;
  return `<div class="ndc-st-grille ndc-st-grille-4">${haut.map(tuile).join('')}</div>
    <div class="ndc-st-grille ndc-st-grille-3">${bas.map(tuile).join('')}</div>
    ${parties ? '' : '<p class="ndc-st-aide">Pas encore de partie terminée. Tes statistiques se rempliront après ta première partie.</p>'}`;
}

/** Meilleur indice donné en tant qu'espion : « Plage 3 → 4 mots ». Un nombre à 0 veut dire « illimité ». */
function htmlMeilleurIndice(i) {
  if (!i || !i.mot) {
    return '<p class="ndc-st-aide">Pas encore d\'indice noté. Il apparaîtra après ta première partie en tant qu\'espion.</p>';
  }
  const trouves = Number(i.trouves) || 0;
  const nb = Number(i.nombre) === 0 ? 'illimité' : nombre(i.nombre);
  return `<p class="ndc-st-indice"><span class="ndc-st-mot">${esc(i.mot)}</span>
      <span class="ndc-st-nb">${esc(nb)}</span>
      <span aria-hidden="true" class="ndc-st-fleche">→</span>
      <span class="ndc-st-trouves">${nombre(trouves)} ${trouves === 1 ? 'mot' : 'mots'}</span></p>
    <p class="ndc-st-aide">Ton meilleur indice en tant qu'espion : le mot donné, le nombre annoncé, et les mots que ton équipe a trouvés grâce à lui.</p>`;
}

function ligneBadge(b) {
  const obtenu = !!b.obtenu;
  const statut = obtenu
    ? `<span class="ndc-st-statut">Obtenu le ${esc(dateCourte(b.date))}</span>`
    : `<span class="ndc-st-statut">Condition : ${esc(b.description)}</span>`;
  return `<li class="ndc-st-badge${obtenu ? ' obtenu' : ''}">
    <span class="ndc-st-medaille" aria-hidden="true">${obtenu ? ICONE_OK : ICONE_CADENAS}</span>
    <div class="ndc-st-badge-texte">
      <strong>${esc(b.nom)}</strong>
      <span class="ndc-st-sous">${obtenu ? `${esc(b.description)} · ` : ''}${statut}</span>
    </div>
  </li>`;
}

function htmlBadges(badges) {
  if (!badges.length) return '<p class="ndc-st-aide">Aucun badge pour le moment.</p>';
  const obtenus = badges.filter((b) => b.obtenu).length;
  return `<p class="ndc-st-sous">${nombre(obtenus)} obtenu${obtenus > 1 ? 's' : ''} sur ${nombre(badges.length)}</p>
    <ul class="ndc-st-liste-badges">${badges.map(ligneBadge).join('')}</ul>`;
}

/* ---------- Écran ---------- */

/**
 * Affiche les statistiques Codenames du membre dans root. Renvoie la fonction de nettoyage.
 * @param {HTMLElement} root
 */
export async function afficher(root) {
  let actif = true;

  root.innerHTML = `<div class="ndc-st">
    <nav class="ndc-fil" aria-label="Fil d'Ariane"><a href="/pages/jeux/jeux.html">Jeux</a> › <a href="/pages/jeux/nom-de-code.html">Codenames</a> › <span aria-current="page">Statistiques</span></nav>
    <h1 class="ndc-titre">Mes statistiques</h1>
    <div id="ndc-st-zone" aria-live="polite"><p class="ndc-st-aide">Chargement…</p></div>
  </div>`;

  const zone = root.querySelector('#ndc-st-zone');
  try {
    const s = await ndc.stats();
    if (!actif) return;
    if (!s) {
      zone.innerHTML = '<p class="ndc-st-aide">Tes statistiques ne sont pas disponibles pour ton compte.</p>';
      return;
    }
    const badges = Array.isArray(s.badges) ? s.badges : [];
    zone.innerHTML = `${htmlTuiles(s)}
      <div class="ndc-st-duo">
        <section class="card ndc-st-section" aria-labelledby="ndc-st-indice-titre">
          <h2 id="ndc-st-indice-titre" class="ndc-st-titre">Meilleur indice</h2>
          ${htmlMeilleurIndice(s.meilleur_indice)}
        </section>
        <section class="card ndc-st-section" aria-labelledby="ndc-st-badges-titre">
          <h2 id="ndc-st-badges-titre" class="ndc-st-titre">Badges</h2>
          ${htmlBadges(badges)}
        </section>
      </div>`;
  } catch (e) {
    if (!actif) return;
    zone.innerHTML = `<p class="ndc-st-aide" role="alert">Statistiques indisponibles pour l'instant. ${esc(erreurTexte(e))}</p>`;
  }

  return () => { actif = false; };
}
