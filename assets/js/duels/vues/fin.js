// ===== Humane Gang — Duels : fin d'un duel (#partie/CODE, duel terminé ou annulé, tous jeux) =====
/*
 * Rôle : résultat (titre, scores, avatars avec couronne sur le gagnant), dernière grille (Puissance 4, Morpion classique
 * et Gomoku, Ultime) ou codes (Mastermind), détail des manches, Paillettes et badges gagnés, actions, chat.
 * Membre joueur : Revanche (duel.rejouer → #partie/<nouveau code>), ou « Rejoindre la revanche » si partie.suite existe
 * (#partie/<suite> : vues/partie.js renvoie vers #rejoindre/ si je ne joue pas encore).
 * Spectateur : résultat et chat, sans action de revanche, sans Paillettes.
 * Invité : seulement le résultat et un message de remerciement (pas de liens, pas de chat, pas de Paillettes).
 * Contrat : export function creer(root, ctx) → { maj(etat), message(msg), detruire() } (vues/partie.js).
 * Dépendances : core.js (esc, toast), ../api.js (duel, erreurTexte, estInvite, COULEURS_MM), ./commun.js (avatarHtml, nomJoueur),
 *   ./chat.js (creerChat). Le cadre des tables n'est pas utilisé ici.
 * Exporte : creer.
 */
import { esc, toast } from '../../core.js';
import { duel, erreurTexte, estInvite, COULEURS_MM } from '../api.js';
import { avatarHtml, nomJoueur } from './commun.js';
import { creerChat } from './chat.js';

/** Couleurs des jetons par place (même code que la table) et symboles du Morpion. */
const COULEUR = { 1: '#D93A3F', 2: '#F2B705' };
const SYMBOLE = { 1: 'X', 2: 'O' };
/** Icône de médaille (badge débloqué). */
const MEDAILLE = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#121212" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M4 20L20 4M4 4h4M4 4v4M20 20h-4M20 20v-4"/></svg>';
/** Couronne du gagnant. */
const COURONNE = '<svg class="duels-fin-couronne" width="30" height="20" viewBox="0 0 30 20" aria-hidden="true"><path d="M2 18L6 4l7 7 7-9 7 9 5-7 1 14z" fill="currentColor"/></svg>';

/** Titre du résultat selon le statut, le gagnant et moi. */
function titreDuel(p, gagnant, moiJ) {
  if (p.statut === 'annulee') return 'Duel annulé';
  if (!gagnant) return 'Match nul';
  if (moiJ && gagnant === moiJ) return 'Tu gagnes le duel !';
  return `${esc(gagnant.pseudo || '?')} gagne le duel`;
}

/** Un joueur dans la bannière : couronne si gagnant, avatar, pseudo. */
function joueurFin(j, gagnant) {
  if (!j) return '';
  const gagne = !!gagnant && j === gagnant;
  return `<div class="duels-fin-joueur${gagne ? ' is-gagnant' : ''}">
    ${gagne ? COURONNE : ''}
    ${avatarHtml(j, { taille: 64 })}
    <strong class="duels-fin-nom">${nomJoueur(j)}</strong>
    ${gagne ? '<span class="visually-hidden">(gagnant)</span>' : ''}
  </div>`;
}

/** Petite grille du Puissance 4 ou du Morpion (classique, Gomoku) d'après la dernière manche. */
function blocGrilleSimple(p, d, js) {
  const w = p.w, h = p.h;
  const g = String(d.grille || '').padEnd(w * h, '.');
  const gagnantes = new Set(d.ligne || []);
  const p4 = p.jeu === 'p4';
  const cellules = Array.from({ length: w * h }, (_, i) => {
    const ch = g[i] === '1' || g[i] === '2' ? g[i] : '';
    const gg = gagnantes.has(i) ? ' is-gagnante' : '';
    const contenu = !ch ? ''
      : p4 ? `<i class="duels-fin-jeton" style="--j:${COULEUR[ch]}"></i>`
        : `<b class="duels-fin-marque" style="color:${COULEUR[ch]}">${SYMBOLE[ch]}</b>`;
    return `<span class="duels-fin-case${gg}">${contenu}</span>`;
  }).join('');
  const [a, b] = p4 ? ['Rouge', 'Jaune'] : ['X', 'O'];
  const j1 = js.find((j) => j.place === 1);
  const j2 = js.find((j) => j.place === 2);
  const legende = `${a} : ${nomJoueur(j1)} · ${b} : ${nomJoueur(j2)}`;
  const note = gagnantes.size
    ? `La ligne gagnante est entourée en or (${gagnantes.size} cases).`
    : 'Manche nulle, aucune ligne gagnante.';
  return `<h2 id="duels-fin-grille-titre" class="duels-h3">Dernière grille</h2>
    <div class="duels-fin-mini duels-fin-mini--${p4 ? 'p4' : 'morpion'}" role="img" aria-label="Grille de ${w} colonnes sur ${h}. ${esc(note)}"
      style="grid-template-columns:repeat(${w}, minmax(0, 1fr))">${cellules}</div>
    <p class="duels-fin-note">${legende}</p>
    <p class="duels-fin-note">${esc(note)}</p>`;
}

/** Ultime : les 9 petites grilles, d'après l'état de chacune (X, O, = ou en cours). */
function blocUltime(p, d, js) {
  const g = String(d.grille || '').padEnd(81, '.');
  const petites = String(d.petites || p.petites || '').padEnd(9, '.');
  const tuiles = Array.from({ length: 9 }, (_, k) => {
    const s = petites[k];
    let contenu;
    if (s === '1' || s === '2') contenu = `<b class="duels-fin-marque duels-fin-gros" style="color:${COULEUR[s]}" aria-hidden="true">${SYMBOLE[s]}</b>`;
    else if (s === '=') contenu = '<b class="duels-fin-marque duels-fin-gros" aria-hidden="true">=</b>';
    else {
      const mini = Array.from({ length: 9 }, (_, i) => {
        const ch = g[k * 9 + i];
        return `<span class="duels-fin-case">${ch === '1' || ch === '2' ? `<b class="duels-fin-marque" style="color:${COULEUR[ch]}">${SYMBOLE[ch]}</b>` : ''}</span>`;
      }).join('');
      contenu = `<span class="duels-fin-mini3">${mini}</span>`;
    }
    const etat = s === '1' || s === '2' ? `gagnée par ${SYMBOLE[s]}` : s === '=' ? 'nulle' : 'en cours';
    return `<span class="duels-fin-tuile" role="img" aria-label="Petite grille ${k + 1}, ${etat}">${contenu}</span>`;
  }).join('');
  const j1 = js.find((j) => j.place === 1);
  const j2 = js.find((j) => j.place === 2);
  return `<h2 id="duels-fin-grille-titre" class="duels-h3">Dernière grille</h2>
    <div class="duels-fin-mini duels-fin-mini--ultime">${tuiles}</div>
    <p class="duels-fin-note">X : ${nomJoueur(j1)} · O : ${nomJoueur(j2)}</p>
    <p class="duels-fin-note">Une grille gagnée reçoit X ou O, une grille nulle reçoit =.</p>`;
}

/** Mastermind : les deux codes de la dernière manche (indexés par celui qui devait les percer), en pastilles avec leur nom. */
function blocCodes(d, js) {
  const titre = '<h2 id="duels-fin-grille-titre" class="duels-h3">Derniers codes</h2>';
  const entrees = Object.entries((d && d.codes) || {});
  if (!entrees.length) return `${titre}<p class="duels-fin-note">Aucun code à afficher.</p>`;
  return titre + entrees.map(([uid, secret]) => {
    const j = js.find((x) => x.user_id === uid);
    const cs = [...String(secret || '')].map((c) => COULEURS_MM.find((x) => x.c === c)).filter(Boolean);
    return `<div class="duels-fin-code">
      <p class="duels-fin-note">Code que ${nomJoueur(j)} devait percer</p>
      <ol class="duels-fin-pastilles">${cs.map((k) => `<li class="duels-fin-pastille" style="background:${k.hex};color:${['o', 'y'].includes(k.c) ? '#121212' : '#FFFFFF'}" aria-label="${esc(k.nom)}"><span aria-hidden="true">${esc(k.lettre)}</span></li>`).join('')}</ol>
      <p class="duels-fin-noms">${cs.map((k) => esc(k.nom)).join(' · ')}</p>
    </div>`;
  }).join('');
}

/** Détail des manches : vainqueur et nombre de coups (essais au Mastermind). */
function blocManches(p, js) {
  const h = p.historique || [];
  const mm = p.jeu === 'mastermind';
  const titre = `<h2 id="duels-fin-manches-titre" class="duels-h3">${h.length > 1 ? `Détail des ${h.length} manches` : 'Détail de la manche'}</h2>`;
  if (!h.length) return `${titre}<p class="duels-fin-note">Aucune manche jouée.</p>`;
  const lignes = h.map((d) => {
    const g = js.find((j) => j.user_id === d.gagnant);
    return `<tr><th scope="row">${esc(d.manche)}</th>
      <td>${g ? `${nomJoueur(g)} <span class="duels-fin-ok">· gagné</span>` : 'Nulle'}</td>
      <td>${esc(d.coups ?? '')}</td></tr>`;
  }).join('');
  return `${titre}
    <div class="duels-fin-table-cadre"><table class="duels-fin-table">
      <thead><tr><th scope="col">Manche</th><th scope="col">Vainqueur</th><th scope="col">${mm ? 'Essais' : 'Coups'}</th></tr></thead>
      <tbody>${lignes}</tbody>
    </table></div>`;
}

/** Paillettes et badges gagnés par moi (jamais pour un invité, jamais contre le robot). */
function blocGains(e, moiJ, js) {
  if (!moiJ) return '';
  const robot = js.some((j) => j.robot);
  const paillettes = Number(moiJ.paillettes || 0);
  const badges = e.badges || [];
  let texte;
  if (robot) texte = '<p class="duels-fin-note">Contre le robot, pas de Paillettes.</p>';
  else if (paillettes > 0) texte = `<p class="duels-fin-gros-chiffre">+${paillettes} Paillettes</p>`;
  else texte = '<p class="duels-fin-note">Aucune Paillette pour ce duel.</p>';
  const medailles = badges.map((b) => `<div class="duels-fin-badge">
      <span class="duels-fin-medaille">${MEDAILLE}</span>
      <div><strong>${badges.length > 1 ? 'Badges débloqués' : 'Badge débloqué'}</strong><span class="duels-fin-badge-nom">${esc(b.nom)}</span></div>
    </div>`).join('');
  return `<h2 id="duels-fin-gains-titre" class="duels-h3">Tu gagnes</h2>${texte}${medailles}`;
}

/** Actions : Revanche (ou rejoindre la revanche), retour aux duels, statistiques. */
function blocActions(p, joue) {
  const liens = [];
  if (joue) {
    liens.push(p.suite
      ? `<a class="btn btn-primary duels-fin-revanche" href="#partie/${encodeURIComponent(p.suite)}">Rejoindre la revanche</a>`
      : '<button type="button" class="btn btn-primary duels-fin-revanche" data-revanche>Revanche</button>');
  }
  liens.push('<a class="btn btn-ghost" href="#">Retour aux duels</a>');
  liens.push('<a class="btn btn-ghost" href="#stats">Mes statistiques</a>');
  return liens.join('');
}

/**
 * Monte l'écran de fin dans root.
 * @param {HTMLElement} root conteneur de l'écran (vidé au nettoyage).
 * @param {{code: string, naviguer: Function, moi: object|null, suivi: object}} ctx contexte de vues/partie.js.
 * @returns {{maj: Function, message: Function, detruire: Function}}
 */
export function creer(root, ctx) {
  const invite = estInvite();
  root.innerHTML = `
    <div class="duels-fin" data-fin>
      <section class="card duels-fin-bandeau" data-bandeau aria-labelledby="duels-fin-titre"></section>
      <div class="duels-fin-corps">
        <div class="duels-fin-colonne">
          <section class="card duels-fin-bloc" data-grille aria-labelledby="duels-fin-grille-titre"></section>
          <section class="card duels-fin-bloc" data-manches aria-labelledby="duels-fin-manches-titre"></section>
        </div>
        <aside class="duels-fin-colonne">
          <section class="card duels-fin-bloc" data-gains aria-labelledby="duels-fin-gains-titre"></section>
          <div class="duels-fin-actions" data-actions></div>
          <section class="card duels-fin-bloc" data-chat-boite aria-labelledby="duels-fin-chat-titre">
            <h2 id="duels-fin-chat-titre" class="duels-h3">Chat</h2>
            <div data-chat></div>
          </section>
        </aside>
      </div>
    </div>`;
  const q = (s) => root.querySelector(s);
  const chat = invite ? null : creerChat(q('[data-chat]'), { code: ctx.code, moi: ctx.moi });

  // Revanche : un seul écouteur, sur l'écran lui-même (il disparaît avec lui).
  q('[data-fin]').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-revanche]');
    if (!b || b.disabled) return;
    b.disabled = true;
    try {
      const nouveau = await duel.rejouer(ctx.code);
      ctx.naviguer(`#partie/${encodeURIComponent(nouveau)}`);
    } catch (err) {
      toast(erreurTexte(err), 'error');
      b.disabled = false;
    }
  });

  /** Remplit les blocs à partir de l'état du duel terminé ou annulé. */
  function rendre(e) {
    const p = e.partie || {};
    const js = e.joueurs || [];
    const moi = e.moi || {};
    const joue = !!moi.joue;
    const moiJ = joue ? js.find((j) => j.place === moi.place) || null : null;
    const parUid = (u) => (u ? js.find((j) => j.user_id === u) || null : null);
    const gagnant = js.find((j) => j.gagne) || parUid(p.vainqueur) || null;
    const j1 = js.find((j) => j.place === 1) || null;
    const j2 = js.find((j) => j.place === 2) || null;
    const historique = p.historique || [];
    const derniere = historique[historique.length - 1] || null;
    const format = p.format > 1 ? `Au meilleur des ${p.format}` : 'Manche unique';

    const pills = [];
    if (p.forfait) pills.push('par forfait');
    if (p.abandon) pills.push(`${esc(parUid(p.abandon)?.pseudo || 'Un joueur')} a abandonné`);

    q('[data-bandeau]').innerHTML = `
      <div class="duels-fin-titres">
        <h1 id="duels-fin-titre" class="duels-titre">${titreDuel(p, gagnant, moiJ)}</h1>
        <p class="duels-fin-sous">${esc(p.nom || 'Duel')} · ${js.map((j) => esc(j.pseudo || '?')).join(' contre ')} · ${esc(format)} · <span class="duels-code">${esc(p.code || '')}</span></p>
        ${pills.length ? `<p class="duels-fin-pills">${pills.map((t) => `<span class="duels-fin-pill">${t}</span>`).join('')}</p>` : ''}
      </div>
      ${j1 || j2 ? `<div class="duels-fin-score">
        ${joueurFin(j1, gagnant)}
        <p class="duels-fin-chiffres"><span class="visually-hidden">Score : ${j1?.manches ?? 0} à ${j2?.manches ?? 0}</span><span aria-hidden="true">${j1?.manches ?? 0} – ${j2?.manches ?? 0}</span></p>
        ${joueurFin(j2, gagnant)}
      </div>` : ''}`;

    q('[data-grille]').hidden = invite;
    q('[data-manches]').hidden = invite;
    q('[data-actions]').hidden = invite;
    q('[data-chat-boite]').hidden = invite;
    if (!invite) {
      q('[data-grille]').innerHTML = p.jeu === 'mastermind' ? blocCodes(derniere, js)
        : !derniere ? '<h2 id="duels-fin-grille-titre" class="duels-h3">Dernière grille</h2><p class="duels-fin-note">Aucune manche jouée.</p>'
          : p.variante === 'ultime' ? blocUltime(p, derniere, js)
            : blocGrilleSimple(p, derniere, js);
      q('[data-manches]').innerHTML = blocManches(p, js);
      q('[data-gains]').innerHTML = blocGains(e, moiJ, js);
      q('[data-actions]').innerHTML = blocActions(p, joue);
    } else {
      q('[data-gains]').innerHTML = `<p class="duels-fin-merci">Merci d’avoir joué${p.nom ? ` à ${esc(p.nom)}` : ''} !</p>`;
    }
  }

  return {
    /** Met à jour l'écran avec l'état du duel terminé. */
    maj(e) {
      rendre(e);
      chat?.maj(e);
    },
    /** Ajoute un message au chat. */
    message(m) { chat?.ajouter(m); },
    detruire() {
      chat?.detruire();
      root.innerHTML = '';
    },
  };
}
