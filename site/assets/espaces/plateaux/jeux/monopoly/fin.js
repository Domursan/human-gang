// ===== Humane Gang — Monopoly : encart de fin (plateaux/jeux/monopoly/fin.js) =====
/*
 * Rôle : HTML de l'encart de fin du Monopoly : classement par fortune (argent, terrains, maisons)
 *   et titres de chacun, groupés par couleur. Le classement général et les récompenses sont à part (écran commun).
 * Dépendances : core.js (esc, initials), ../../api.js (nomDe).
 * Exporte : recap(etat, contenus) -> HTML (chaîne).
 *   La fortune vient de etat.jeu.fortunes[user_id] (sinon de joueur.etat.fortune). Les titres viennent de etat.jeu.proprietes.
 */
import { esc, initials } from '../../../../commun/core.js';
import { nomDe } from '../../api.js';

const EUR = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} €`;
const COULEUR_OK = /^#[0-9a-f]{6}$/i;

/** Fortune d'un joueur : d'après jeu.fortunes, sinon d'après son état. */
function fortuneDe(etat, j) {
  const f = etat?.jeu?.fortunes?.[j.user_id];
  if (f != null) return Number(f) || 0;
  return Number(j.etat?.fortune) || 0;
}

/** Titres d'un joueur : cases possédées, triées par numéro, avec leur groupe et leur nombre de maisons. */
function titresDe(etat, contenus, uid) {
  const props = etat?.jeu?.proprietes || {};
  const plateau = etat?.jeu?.plateau || [];
  return Object.entries(props)
    .filter(([, p]) => p?.proprio === uid)
    .map(([c, p]) => ({ c: Number(c), p, def: plateau[Number(c)] || {} }))
    .sort((a, b) => a.c - b.c)
    .map((t) => ({
      nom: nomDe(contenus, 'cases', `c${t.c}`) || `Case ${t.c}`,
      groupe: t.def.groupe || '',
      couleur: (contenus.groupes || []).find((g) => g.id === t.def.groupe)?.couleur || (t.def.type === 'gare' ? '#8A93A0' : '#6B6660'),
      maisons: Number(t.p.maisons) || 0,
      hypo: !!t.p.hypotheque,
    }));
}

/** Classement : fortune décroissante (les ruinés en bas). */
function classement(etat) {
  return (etat?.joueurs || [])
    .filter((j) => !j.parti)
    .map((j) => ({ j, fortune: fortuneDe(etat, j) }))
    .sort((a, b) => (Number(!!a.j.elimine) - Number(!!b.j.elimine)) || (b.fortune - a.fortune));
}

/**
 * Classement par fortune et titres de chacun.
 * @param {object} etat état final de la partie.
 * @param {object} contenus contenus du jeu (cases, groupes).
 * @returns {string} HTML.
 */
export function recap(etat, contenus) {
  const liste = classement(etat);
  if (!liste.length) return '';
  const lignes = liste.map(({ j, fortune }, i) => {
    const titres = titresDe(etat, contenus, j.user_id);
    const couleur = COULEUR_OK.test(j.couleur || '') && !j.invite ? j.couleur : '#F2EFEA';
    const pastilles = titres.map((t) => (
      `<li class="mo-titre${t.hypo ? ' is-hypo' : ''}" style="--c:${esc(t.couleur)}">` +
      `<span class="mo-titre-nom">${esc(t.nom)}</span>` +
      `<span class="mo-titre-info">${t.maisons >= 5 ? 'hôtel' : t.maisons ? `${t.maisons} maison${t.maisons > 1 ? 's' : ''}` : ''}${t.hypo ? ' · hypothèque' : ''}</span></li>`
    )).join('');
    const etiquettes = [j.elimine ? '<span class="mo-etiquette">ruiné</span>' : '', j.invite ? '<span class="mo-etiquette">invité</span>' : ''].join('');
    return `<li class="mo-classe${j.elimine ? ' is-elimine' : ''}">
      <span class="mo-rang" aria-label="Rang ${i + 1}">${i + 1}</span>
      <span class="mo-classe-avatar" style="background:${esc(couleur)}" aria-hidden="true">${esc(initials(j.pseudo))}</span>
      <div class="mo-classe-corps">
        <p class="mo-classe-tete"><strong style="color:${esc(couleur)}">${esc(j.pseudo || '?')}</strong> ${etiquettes}
          <span class="mo-classe-fortune">${esc(EUR(fortune))}</span></p>
        <p class="small muted">Argent ${esc(EUR(j.etat?.argent))} · ${titres.length} terrain${titres.length > 1 ? 's' : ''}</p>
        ${titres.length ? `<ul class="mo-titres" aria-label="Titres de ${esc(j.pseudo || '?')}">${pastilles}</ul>` : '<p class="small muted">Aucun terrain.</p>'}
      </div>
    </li>`;
  }).join('');
  return `<section class="mo-fin" aria-labelledby="mo-fin-titre">
    <h2 id="mo-fin-titre" class="mo-fin-titre">Classement par fortune</h2>
    <p class="small muted">La fortune compte l'argent, les terrains (à leur prix) et les maisons.</p>
    <ol class="mo-classement">${lignes}</ol>
  </section>`;
}
