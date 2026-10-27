// ===== Humane Gang — classement des jeux du jour (migration 157) =====
/*
 * Rôle : bloc « Classement » sous chaque jeu du jour (Sutom HG, Framed, Heardle, Code du jour, jeux « devine », grilles,
 *   Sudoku) et classement général (tous les jeux) avec la progression vers le bonus « 16 jeux terminés ».
 *   Deux onglets : « Aujourd'hui » (points du jour, puis temps) et « Cette semaine » (somme des points, lundi à dimanche).
 *   Points = Paillettes gagnées : 150 au 1er palier, −10 par palier, 10 si raté.
 * Données : RPC hg_jeux_classement(p_jeu) (p_jeu null = tous les jeux).
 * Dépendances : core.js (sb, esc), core/util.js (avatarHtml), core/profile.js (membre connecté).
 * Exporte : CLE_JEU (onglet de /pages/jeux/jeux.html → clé du classement), monterClassement(conteneur, cle), rafraichirClassements().
 */
import { paillSym } from '../../commun/paillettes.js';
import { sb, esc } from '../../commun/core.js';
import { avatarHtml } from '../../commun/core/util.js';
import { getCachedProfile } from '../../commun/core/profile.js';

/** Onglet de /pages/jeux/jeux.html (ou « code_jour » pour /pages/jeux/duels.html#jour) → clé de hg_jeux_resultats. */
export const CLE_JEU = {
  sutom: 'sutom', framed: 'framed', heardle: 'heardle', code_jour: 'code_jour',
  'carte-mystere': 'nj_carte', 'jeu-video': 'nj_jv', pochette: 'nj_pochette', replique: 'nj_replique', pays: 'nj_pays', plat: 'nj_plat',
  connexions: 'nj_connexions', 'mots-croises': 'nj_motscroises', 'mot-mele': 'nj_motmele', anagramme: 'nj_anagramme', nerdle: 'nj_nerdle',
  sudoku: 'nj_sudoku',
};
/** Nombre de lignes montrées avant « Voir tout ». */
const COURT = 10;
/** Blocs montés (pour les rafraîchir ensemble après une partie). */
const BLOCS = new Set();

/** « 1 234 ». */
const nf = (n) => new Intl.NumberFormat('fr-CH').format(Number(n) || 0);
/** Médaille des trois premiers, sinon le rang. */
const rang = (i) => (i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1));

/** Feuille de style du bloc (/assets/espaces/jeux/jeux-classement.css), ajoutée une fois. */
function css() {
  if (document.querySelector('link[data-css="jeux-classement"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('./jeux-classement.css', import.meta.url).href; l.dataset.css = 'jeux-classement';
  document.head.append(l);
}

/**
 * Lignes d'un classement.
 * @param {object[]} liste lignes { user_id, pseudo, color, avatar_url, points, parties, reussies, bonus }
 * @param {string|null} moi identifiant du membre connecté
 * @param {boolean} tout true : toutes les lignes ; sinon les COURT premières (et la mienne si elle est plus bas)
 * @param {boolean} general classement de tous les jeux (montre le nombre de jeux faits)
 * @returns {string} HTML
 */
function lignes(liste, moi, tout, general, total) {
  if (!liste.length) return '<p class="jc-vide">Personne pour l’instant. À toi de jouer !</p>';
  const idxMoi = liste.findIndex((x) => x.user_id === moi);
  const vis = liste.map((x, i) => [x, i]).filter(([, i]) => tout || i < COURT || i === idxMoi);
  return `<ol class="jc-liste">${vis.map(([x, i]) => `<li class="jc-ligne${x.user_id === moi ? ' is-moi' : ''}">
      <span class="jc-rang" aria-label="Rang ${i + 1}">${rang(i)}</span>
      ${avatarHtml({ pseudo: x.pseudo, color: x.color, avatar_url: x.avatar_url }, 28)}
      <span class="jc-nom">${esc(x.pseudo || 'Membre')}${x.user_id === moi ? ' <span class="jc-toi">toi</span>' : ''}${x.bonus ? ' <span class="jc-bonus" title="Les 16 jeux terminés">bonus</span>' : ''}</span>
      ${general ? `<span class="jc-faits">${nf(x.parties)}${total ? `/${total}` : ''} jeu${x.parties > 1 ? 'x' : ''}</span>` : ''}
      <span class="jc-pts">${nf(x.points)} ${paillSym()}</span></li>`).join('')}</ol>
    ${!tout && liste.length > COURT ? `<button type="button" class="btn btn-ghost btn-sm jc-tout" data-jc="tout">Voir tout le classement (${liste.length})</button>` : ''}`;
}

/**
 * Monte un bloc de classement dans un conteneur.
 * @param {HTMLElement} el conteneur (vidé)
 * @param {string|null} cle clé du jeu (CLE_JEU) ; null = classement général de tous les jeux
 * @returns {{rafraichir: Function}}
 */
export function monterClassement(el, cle = null) {
  css();
  const st = { onglet: 'jour', tout: false, data: null, err: null };
  const general = !cle;
  const titre = general ? 'Classement des jeux du jour' : 'Classement';
  async function charger() {
    try {
      const { data, error } = await sb.rpc('hg_jeux_classement', { p_jeu: cle });
      if (error) throw error;
      st.data = data || { jour: [], semaine: [], moi: { faits: 0 }, total_jeux: 16, bonus: 250, max: 150 }; st.err = null;
    } catch (e) { st.err = e?.message || String(e); }
    peindre();
  }
  function peindre() {
    const d = st.data;
    const moi = getCachedProfile()?.id || null;
    const liste = d ? (st.onglet === 'jour' ? d.jour : d.semaine) || [] : [];
    const prog = general && d ? (() => {
      const f = Number(d.moi?.faits) || 0, t = Number(d.total_jeux) || 16;
      return `<div class="jc-prog"><p class="jc-prog-t">${d.moi?.bonus ? `Bonus de ${nf(d.bonus)} ${paillSym()} obtenu aujourd’hui : bravo !` : `Tes jeux du jour : <strong>${f}/${t}</strong> · termine les ${t} pour gagner <strong>${nf(d.bonus)} ${paillSym()}</strong> de bonus`}</p>
        <div class="progress jc-barre" role="progressbar" aria-label="Jeux du jour terminés" aria-valuemin="0" aria-valuemax="${t}" aria-valuenow="${f}"><span style="width:${Math.round((f / t) * 100)}%"></span></div></div>`;
    })() : '';
    el.innerHTML = `<section class="card jc" aria-labelledby="jc-h-${esc(cle || 'tous')}">
      <div class="jc-tete"><h2 class="jc-h" id="jc-h-${esc(cle || 'tous')}">${titre}</h2>
        <div class="jc-onglets" role="group" aria-label="Période">
          <button type="button" class="jc-o" data-jc-o="jour" aria-pressed="${st.onglet === 'jour'}">Aujourd’hui</button>
          <button type="button" class="jc-o" data-jc-o="semaine" aria-pressed="${st.onglet === 'semaine'}">Cette semaine</button></div></div>
      ${prog}
      ${st.err ? `<p class="jc-vide">Classement indisponible (${esc(st.err)}).</p>` : !d ? '<p class="jc-vide">Chargement…</p>' : lignes(liste, moi, st.tout, general, general ? d.total_jeux : 0)}
      ${d && !general ? `<p class="jc-note">Points = Paillettes gagnées : ${nf(d.max)} ${paillSym()} du premier coup, puis 10 de moins par essai ou palier ; 10 ${paillSym()} si c’est raté.</p>` : ''}
    </section>`;
  }
  el.addEventListener('click', (ev) => {
    const o = ev.target.closest('[data-jc-o]');
    if (o) { st.onglet = o.dataset.jcO; st.tout = false; peindre(); return; }
    if (ev.target.closest('[data-jc="tout"]')) { st.tout = true; peindre(); }
  });
  const bloc = { rafraichir: charger, el };
  BLOCS.add(bloc);
  peindre();
  charger();
  return bloc;
}

/** Recharge tous les classements montés (après une partie terminée). */
export function rafraichirClassements() {
  for (const b of BLOCS) { if (b.el.isConnected) b.rafraichir(); else BLOCS.delete(b); }
}
