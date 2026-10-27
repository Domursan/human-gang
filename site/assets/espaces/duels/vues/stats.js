// ===== Humane Gang — Duels : mes statistiques de duels (#stats) =====
/*
 * Rôle : statistiques de duels du membre connecté. Filtre par jeu (Tous, Puissance 4, Morpion, Mastermind),
 * tuiles (duels, victoires, nuls, défaites, % de victoires, série, meilleure série), rival favori, badges
 * (obtenus en couleur avec la date, verrouillés en gris avec leur condition) et derniers duels (jeu, adversaire,
 * résultat, score, Paillettes). Le résultat est toujours écrit en toutes lettres, pas seulement en couleur.
 * Dépendances : core.js (esc), duels/api.js (duel, erreurTexte, jeuxVisibles), vues/commun.js (couleurJoueur).
 * Exporte : afficher.
 */
import { esc } from '../../../commun/core.js';
import { duel, erreurTexte, jeuxVisibles } from '../api.js';
import { couleurJoueur } from './commun.js';

/** Filtres par jeu : [clé envoyée au serveur (vide = tous), libellé]. */
/** Filtres : Tous, puis les jeux visibles pour ce membre (les jeux en développement seulement pour les admins). */
const filtresJeux = () => [['', 'Tous'], ...Object.entries(jeuxVisibles()).map(([cle, j]) => [cle, j.nom])];
const RESULTATS = { victoire: 'Victoire', nul: 'Nul', defaite: 'Défaite' };
const ICONE_OK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICONE_CADENAS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

const nombre = (n) => Number(n || 0).toLocaleString('fr-CH');
const arr = (x) => (Array.isArray(x) ? x : []);
/** Pourcentage arrondi, ou null si aucun duel. */
const pourcent = (part, total) => (Number(total) ? Math.round((Number(part) / Number(total)) * 100) : null);

/** Date courte en français suisse (« 22 oct. »), chaîne vide si la date n'est pas valable. */
function dateCourte(valeur) {
  const t = new Date(valeur);
  return isNaN(t) ? '' : t.toLocaleDateString('fr-CH', { day: 'numeric', month: 'short' });
}

/** Pseudo dans sa couleur (gris pour le robot). */
function pseudo(nom, couleur, robot = false) {
  return `<span class="duels-st-pseudo" style="color:${couleurJoueur({ couleur, robot })}">${esc(nom || '?')}</span>`;
}

/* ---------- Blocs ---------- */

/** Squelette : fil d'Ariane, titre, filtres par jeu, zone de contenu (remplie après chargement). */
function squelette() {
  return `<div class="duels-st">
    <nav class="duels-fil" aria-label="Fil d’Ariane"><a href="/pages/jeux/duels.html">Duels</a> › Statistiques</nav>
    <h1 class="duels-titre">Mes statistiques de duels</h1>
    <div class="duels-st-filtres" role="group" aria-label="Filtrer par jeu">
      ${filtresJeux().map(([cle, nom], i) => `<button type="button" class="btn btn-ghost duels-st-filtre" data-jeu="${esc(cle)}" aria-pressed="${i === 0 ? 'true' : 'false'}">${esc(nom)}</button>`).join('')}
    </div>
    <div id="st-contenu" aria-live="polite" aria-busy="true"><p class="duels-st-aide">Chargement…</p></div>
  </div>`;
}

/** Tuiles de chiffres, rival favori, puis badges et derniers duels. */
function htmlContenu(s) {
  const duels = Number(s.duels) || 0;
  const victoires = Number(s.victoires) || 0;
  const taux = pourcent(victoires, duels);
  const tuiles = [
    [nombre(duels), 'duels', ''],
    [nombre(victoires), 'victoires', 'is-vert'],
    [nombre(s.nuls), 'nuls', ''],
    [nombre(s.defaites), 'défaites', 'is-rose'],
    [taux === null ? '–' : `${taux} %`, 'de victoires', ''],
    [nombre(s.serie), 'série en cours', 'is-or'],
    [nombre(s.meilleure_serie), 'meilleure série', ''],
  ];
  const rival = s.rival
    ? `<p class="duels-st-texte">Rival favori : ${pseudo(s.rival.pseudo, s.rival.couleur)}. Vous vous êtes affrontés ${nombre(s.rival.duels)} fois : ${nombre(s.rival.victoires)} victoire${Number(s.rival.victoires) > 1 ? 's' : ''} pour toi, ${nombre(s.rival.defaites)} défaite${Number(s.rival.defaites) > 1 ? 's' : ''}.</p>`
    : '<p class="duels-st-aide">Pas encore de rival favori.</p>';

  return `
    <section class="card duels-st-carte" aria-labelledby="st-chiffres">
      <h2 id="st-chiffres" class="duels-st-titre">Chiffres</h2>
      <div class="duels-st-tuiles">
        ${tuiles.map(([valeur, nom, classe]) => `<div class="duels-st-tuile ${classe}"><span class="duels-st-chiffre">${valeur}</span><span class="duels-st-tuile-nom">${esc(nom)}</span></div>`).join('')}
      </div>
      ${rival}
    </section>
    <div class="duels-st-blocs">
      ${htmlBadges(arr(s.badges))}
      ${htmlDerniers(arr(s.derniers))}
    </div>`;
}

/** Badges : obtenus (icône, date) ou verrouillés (gris, condition affichée). */
function htmlBadges(badges) {
  const obtenus = badges.filter((b) => b.obtenu).length;
  const corps = badges.length
    ? `<ul class="duels-st-badges">${badges.map((b) => b.obtenu
      ? `<li class="duels-st-badge is-obtenu">
          <span class="duels-st-badge-icone" aria-hidden="true">${ICONE_OK}</span>
          <div><strong>${esc(b.nom)}</strong><span class="duels-st-sous">${esc(b.description)}</span>
          <span class="duels-st-sous">Obtenu${b.date ? ` le ${esc(dateCourte(b.date))}` : ''}</span></div>
        </li>`
      : `<li class="duels-st-badge is-verrou">
          <span class="duels-st-badge-icone" aria-hidden="true">${ICONE_CADENAS}</span>
          <div><strong>${esc(b.nom)}</strong><span class="duels-st-sous">Verrouillé · ${esc(b.description)}</span></div>
        </li>`).join('')}</ul>`
    : '<p class="duels-st-aide">Aucun badge pour le moment.</p>';
  return `<section class="card duels-st-carte" aria-labelledby="st-badges">
    <h2 id="st-badges" class="duels-st-titre">Badges</h2>
    <p class="duels-st-sous">${nombre(obtenus)} sur ${nombre(badges.length)} obtenus</p>
    ${corps}
  </section>`;
}

/** Derniers duels : jeu, adversaire, date, résultat écrit, score (mon score d'abord), Paillettes. */
function htmlDerniers(derniers) {
  const corps = derniers.length
    ? `<ul class="duels-st-lignes">${derniers.map((d) => `<li class="duels-st-ligne is-${esc(d.resultat || '')}">
        <div class="duels-st-ligne-texte">
          <strong>${esc(d.nom || '')}</strong>
          <span class="duels-st-sous">contre ${pseudo(d.adversaire, d.adversaire_couleur)} · ${esc(dateCourte(d.date))}</span>
        </div>
        <span class="duels-st-resultat">${esc(RESULTATS[d.resultat] || '')}</span>
        <span class="duels-st-score">${esc(d.score || '')}</span>
        ${d.paillettes != null ? `<span class="duels-st-pail">${Number(d.paillettes) > 0 ? '+' : ''}${nombre(d.paillettes)} Paillettes</span>` : ''}
      </li>`).join('')}</ul>`
    : '<p class="duels-st-aide">Pas encore de duel joué. Lance une partie : elle apparaîtra ici.</p>';
  return `<section class="card duels-st-carte" aria-labelledby="st-derniers">
    <h2 id="st-derniers" class="duels-st-titre">Derniers duels</h2>
    ${corps}
  </section>`;
}

/* ---------- Écran ---------- */

/**
 * Affiche les statistiques de duels dans root. Le filtre par jeu relance le chargement.
 * @param {HTMLElement} root conteneur de la page (#app).
 * @returns {() => void} fonction de nettoyage (arrête l'écriture après un changement d'écran).
 */
export async function afficher(root) {
  let actif = true;
  let demande = 0;
  let jeu = null;

  root.innerHTML = squelette();
  const ecran = root.querySelector('.duels-st');
  const contenu = ecran.querySelector('#st-contenu');
  const filtres = [...ecran.querySelectorAll('.duels-st-filtre')];

  /** Charge les statistiques du filtre courant ; une demande plus récente annule l'ancienne. */
  async function charger() {
    const ma = ++demande;
    contenu.setAttribute('aria-busy', 'true');
    try {
      const s = await duel.stats(null, jeu);
      if (!actif || ma !== demande) return;
      contenu.innerHTML = htmlContenu(s || {});
    } catch (e) {
      if (!actif || ma !== demande) return;
      contenu.innerHTML = `<section class="card duels-st-carte">
        <p class="duels-st-aide">Statistiques indisponibles pour l’instant. ${esc(erreurTexte(e))}</p>
        <p><button type="button" class="btn btn-ghost" id="st-reessayer">Réessayer</button></p>
      </section>`;
    } finally {
      if (actif && ma === demande) contenu.setAttribute('aria-busy', 'false');
    }
  }

  ecran.querySelector('.duels-st-filtres').addEventListener('click', (e) => {
    const bouton = e.target.closest('.duels-st-filtre');
    if (!bouton) return;
    jeu = bouton.dataset.jeu || null;
    filtres.forEach((f) => f.setAttribute('aria-pressed', String(f === bouton)));
    contenu.innerHTML = '<p class="duels-st-aide">Chargement…</p>';
    charger();
  });
  contenu.addEventListener('click', (e) => {
    if (e.target.closest('#st-reessayer')) charger();
  });

  charger();
  return () => { actif = false; };
}
