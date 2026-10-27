// ===== Humane Gang — Shadow Hunters : encart de fin (plateaux/jeux/shadow/fin.js) =====
/*
 * Rôle : HTML de l'encart de fin de Shadow Hunters : le personnage de chacun, son camp, s'il est vivant ou mort,
 *   sa condition de victoire et s'il a gagné. Le classement et les récompenses sont dans l'écran de fin commun
 *   (plateaux/vues/fin.js).
 * Dépendances : core.js (esc), ../../api.js (nomDe), ./plateau.js (campDe, CAMP_LIBELLE, couleurCamp, PV_MAX).
 * Exporte : recap(etat, contenus) -> HTML (chaîne).
 *   etat.joueurs[i] = { user_id, pseudo, elimine, gagne, etat: { revele, perso, camp, degats } } ;
 *   etat.partie.raison = 'hunters' | 'shadows' | 'neutre' (camp qui a gagné, fixé par le serveur).
 */
import { esc } from '../../../../commun/core.js';
import { nomDe } from '../../api.js';
import { campDe, CAMP_LIBELLE, couleurCamp, PV_MAX } from './plateau.js';

/** Libellé du camp qui a gagné la partie (fixé par le serveur). */
const ISSUE = {
  hunters: 'Les Hunters gagnent !',
  shadows: 'Les Shadows gagnent !',
  neutre: 'Un Neutre gagne seul !',
};

/** Encart de fin : une carte par personnage (camp, vivant ou mort, victoire, gagnant). */
export function recap(etat, contenus) {
  const issue = ISSUE[etat?.partie?.raison] || '';
  const cartes = (etat?.joueurs || []).filter((j) => !j.parti).map((j) => {
    const s = j.etat || {};
    const perso = s.perso || null;
    const camp = s.camp || campDe(perso);
    const info = (contenus?.personnages || []).find((p) => p.id === perso) || {};
    const nom = perso ? nomDe(contenus, 'personnages', perso) : 'Personnage inconnu';
    const max = perso ? PV_MAX[perso] : null;
    const pv = max != null ? Math.max(0, max - (s.degats ?? 0)) : null;
    const etatVie = j.elimine ? 'Mort' : 'Vivant';
    const bilan = j.gagne ? 'Gagnant' : 'Non gagnant';
    return `<li class="sh-fin-carte${j.gagne ? ' is-gagnant' : ''}" style="--camp:${couleurCamp(camp)}">
      <span class="sh-fin-camp">${esc(camp ? CAMP_LIBELLE[camp] : 'Camp inconnu')}</span>
      <strong class="sh-fin-nom">${esc(nom)}</strong>
      <span class="sh-fin-joueur">${esc(j.pseudo || '?')}</span>
      <span class="sh-fin-etat">${esc(etatVie)}${pv != null ? ` · ${pv} / ${max} PV` : ''}</span>
      <span class="sh-fin-bilan">${esc(bilan)}</span>
      ${info.victoire ? `<p class="sh-fin-victoire"><span class="sh-label">Victoire :</span> ${esc(info.victoire)}</p>` : ''}
    </li>`;
  }).join('');
  return `<div class="sh-fin">
    <section class="sh-bloc" aria-labelledby="sh-fin-titre">
      <h2 id="sh-fin-titre" class="sh-bloc-titre">${esc(issue || 'Les personnages')}</h2>
      <ul class="sh-fin-cartes">${cartes || '<li class="sh-vide">Aucun personnage.</li>'}</ul>
    </section>
  </div>`;
}
