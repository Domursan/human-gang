// ===== Humane Gang — Duels : fin d'un duel (#partie/CODE, duel terminé ou annulé, tous jeux) =====
/*
 * Rôle : résultat (titre, scores, avatars avec couronne sur le gagnant), dernière grille (Puissance 4, Morpion classique
 * et Gomoku, Ultime), codes (Mastermind), les deux flottes (Bataille navale), les personnages secrets (Qui est-ce ?),
 * détail des manches, Paillettes et badges gagnés, actions, chat.
 * Membre joueur : Revanche (duel.rejouer → #partie/<nouveau code>), ou « Rejoindre la revanche » si partie.suite existe
 * (#partie/<suite> : vues/partie.js renvoie vers #rejoindre/ si je ne joue pas encore).
 * Spectateur : résultat et chat, sans action de revanche, sans Paillettes.
 * Invité : seulement le résultat et un message de remerciement (pas de liens, pas de chat, pas de Paillettes).
 * Qui est-ce : les personnages sont chargés une fois avec duel.plateau(code). Le portrait (./portrait.js) est chargé
 *   à la demande par import dynamique : si ce module manque, seuls les prénoms s'affichent.
 * Contrat : export function creer(root, ctx) → { maj(etat), message(msg), detruire() } (vues/partie.js).
 * Dépendances : core.js (esc, toast), ../api.js (duel, erreurTexte, estInvite, COULEURS_MM), ./commun.js (avatarHtml, nomJoueur),
 *   ./chat.js (creerChat). Le cadre des tables n'est pas utilisé ici.
 * Exporte : creer.
 */
import { esc, toast } from '../../core.js';
import { duel, erreurTexte, estInvite, COULEURS_MM } from '../api.js';
import { avatarHtml, nomJoueur, deJoueur } from './commun.js';
import { creerChat } from './chat.js';

/** Couleurs des jetons par place (même code que la table) et symboles du Morpion. */
const COULEUR = { 1: '#D93A3F', 2: '#F2B705' };
const SYMBOLE = { 1: 'X', 2: 'O' };
/** Libellé de la colonne « coups » du détail des manches, selon le jeu. */
const LIBELLE_COUPS = { mastermind: 'Essais', bataille: 'Tirs', quiestce: 'Questions', pfc: 'Lancers' };
/** Lettres des pièces d'échecs (notation française) et noms des gestes du pierre-feuille-ciseaux. */
const LETTRE_PIECE = { k: 'R', q: 'D', r: 'T', b: 'F', n: 'C', p: 'P' };
const NOM_GESTE = { pierre: 'Pierre', feuille: 'Feuille', ciseaux: 'Ciseaux' };
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

/** Grille d'un jeu de cases (Othello, Dames, Échecs), lecture seule : pions en rond, dames marquées D, pièces en lettres. */
function blocCases(p, e, d, js) {
  const w = p.w || 8, h = p.h || 8;
  const g = String(d.grille || '').padEnd(w * h, '.');
  const pions = e.pions || {};
  const duDe = (c) => js.find((j) => String(pions[j.user_id]) === c) || null;
  const nom1 = nomJoueur(duDe('1')), nom2 = nomJoueur(duDe('2'));
  const compte = (cars) => [...g].filter((x) => cars.includes(x)).length;
  let legende;
  if (p.jeu === 'othello') legende = `Noirs : ${nom1} (${compte(['1'])}) · Blancs : ${nom2} (${compte(['2'])})`;
  else if (p.jeu === 'echecs') legende = `Blancs : ${nom1} · Noirs : ${nom2}`;
  else legende = `${nom1} (${compte(['1', 'A'])} pions) · ${nom2} (${compte(['2', 'B'])} pions)`;
  const cellules = Array.from({ length: w * h }, (_, i) => {
    const x = g[i];
    const r = Math.floor(i / w), c = i % w;
    let classe = 'is-vert', contenu = '';
    if (p.jeu === 'othello') {
      if (x === '1' || x === '2') contenu = `<i class="duels-fin-pion ${x === '1' ? 'is-noir' : 'is-blanc'}"></i>`;
    } else if (p.jeu === 'dames') {
      classe = (r + c) % 2 === 1 ? 'is-sombre' : 'is-clair';
      if (['1', '2', 'A', 'B'].includes(x)) {
        contenu = `<i class="duels-fin-pion ${x === '1' || x === 'A' ? 'is-noir' : 'is-blanc'}"></i>${x === 'A' || x === 'B' ? '<b class="duels-fin-dame" aria-hidden="true">D</b>' : ''}`;
      }
    } else {
      classe = (r + c) % 2 === 0 ? 'is-clair' : 'is-sombre';
      if (x !== '.' && LETTRE_PIECE[x.toLowerCase()]) {
        contenu = `<b class="duels-fin-piece ${x === x.toUpperCase() ? 'is-blanc' : 'is-noir'}">${esc(LETTRE_PIECE[x.toLowerCase()])}</b>`;
      }
    }
    return `<span class="duels-fin-case ${classe}">${contenu}</span>`;
  }).join('');
  return `<h2 id="duels-fin-grille-titre" class="duels-h3">Dernière grille</h2>
    <div class="duels-fin-mini duels-fin-mini--cases" role="img" aria-label="Grille de ${w} colonnes sur ${h}" style="grid-template-columns:repeat(${w}, minmax(0, 1fr))">${cellules}</div>
    <p class="duels-fin-note">${legende}</p>`;
}

/** Pierre-feuille-ciseaux : pas de grille ; la liste des lancers de la partie, du premier au dernier. */
function blocLancers(e, js) {
  const titre = '<h2 id="duels-fin-grille-titre" class="duels-h3">Les lancers</h2>';
  const lancers = (e.pfc && e.pfc.lancers) || [];
  if (!lancers.length) return `${titre}<p class="duels-fin-note">Aucun lancer.</p>`;
  const nomDe = (uid) => { const j = js.find((x) => x.user_id === uid); return j?.robot ? 'le robot' : (j?.pseudo || '?'); };
  const [j1, j2] = [js.find((j) => j.place === 1), js.find((j) => j.place === 2)];
  const lignes = lancers.map((l) => `<li>Manche ${esc(l.manche)} : ${esc(nomDe(j1?.user_id))} ${esc(NOM_GESTE[l[j1?.user_id]] || '—')}
      · ${esc(nomDe(j2?.user_id))} ${esc(NOM_GESTE[l[j2?.user_id]] || '—')}
      · ${l.gagnant ? `${esc(nomDe(l.gagnant))} gagne` : 'égalité, relance'}</li>`).join('');
  return `${titre}<ol class="duels-fin-lancers">${lignes}</ol>`;
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

/** Bataille navale : navires d'un joueur. Moi : ma flotte ; sinon les navires révélés à la fin (coules[uid]). */
function flotteDe(b, uid, moiUid) {
  if (uid === moiUid && b.ma_flotte && b.ma_flotte.length) return b.ma_flotte;
  return (b.coules && b.coules[uid]) || [];
}

/** Bataille navale : tirs reçus par un joueur, ce sont les tirs de son adversaire. */
function tirsRecus(b, uid, js) {
  const autre = js.find((j) => j.user_id !== uid);
  return (autre && b.tirs && b.tirs[autre.user_id]) || [];
}

/** Bataille navale : une flotte 10 × 10 (navires, navires coulés, tirs reçus) avec son nom. */
function carteFlotte(j, navires, tirs) {
  const cases = new Set(navires.flatMap((n) => n.cases || []));
  const touches = new Set(tirs.filter((t) => t.resultat === 'touche' || t.resultat === 'coule').map((t) => t.case));
  const eaux = new Set(tirs.filter((t) => t.resultat === 'eau').map((t) => t.case));
  const coules = navires.filter((n) => (n.cases || []).length && n.cases.every((c) => touches.has(c)));
  const casesCoulees = new Set(coules.flatMap((n) => n.cases));
  const cellules = Array.from({ length: 100 }, (_, c) => {
    const k = ['duels-fin-bcase'];
    if (casesCoulees.has(c)) k.push('is-coule');
    else if (cases.has(c)) k.push('is-navire');
    if (touches.has(c)) k.push('is-touche');
    if (eaux.has(c)) k.push('is-eau');
    return `<span class="${k.join(' ')}"></span>`;
  }).join('');
  const nc = coules.length;
  const resume = navires.length
    ? `Flotte de ${j.pseudo || '?'} : ${nc} navire${nc > 1 ? 's' : ''} coulé${nc > 1 ? 's' : ''} sur ${navires.length}. ${touches.size} tirs au but, ${eaux.size} dans l'eau.`
    : `Flotte de ${j.pseudo || '?'} : non révélée.`;
  return `<figure class="duels-fin-flotte">
    <div class="duels-fin-bgrille" role="img" aria-label="${esc(resume)}">${cellules}</div>
    <figcaption class="duels-fin-flotte-nom">Flotte ${deJoueur(j)}
      <span class="duels-fin-note">${navires.length ? `${nc} coulé${nc > 1 ? 's' : ''} sur ${navires.length}` : 'Non révélée'}</span></figcaption>
  </figure>`;
}

/** Bataille navale : les deux flottes côte à côte. */
function blocFlottes(e, js, moiUid) {
  const b = e.bataille || {};
  const titre = '<h2 id="duels-fin-grille-titre" class="duels-h3">Les deux flottes</h2>';
  const cartes = js.map((j) => carteFlotte(j, flotteDe(b, j.user_id, moiUid), tirsRecus(b, j.user_id, js))).join('');
  return `${titre}
    <div class="duels-fin-flottes">${cartes}</div>
    <p class="duels-fin-note">Navire à flot : case claire. Navire coulé : case rouge. Croix : tir au but. Point : tir dans l'eau.</p>`;
}

/** Image d'un personnage : portraitSvg (./portrait.js) renvoie du SVG ou un élément ; vide si indisponible. */
function portraitHtml(mod, perso) {
  if (!mod || typeof mod.portraitSvg !== 'function') return '';
  try {
    const r = mod.portraitSvg(perso.attributs || {}, { titre: perso.prenom || '' });
    return typeof r === 'string' ? r : ((r && r.outerHTML) || '');
  } catch {
    return '';
  }
}

/**
 * Qui est-ce ? : le personnage de chaque joueur (perso_adverse, à la fin), portrait et prénom.
 * @param {object} e état du duel terminé.
 * @param {object[]} js joueurs.
 * @param {object|null|undefined} charge {plateau, portrait} ; undefined pendant le chargement, null si échec.
 */
function blocPersos(e, js, charge) {
  const titre = '<h2 id="duels-fin-grille-titre" class="duels-h3">Les personnages secrets</h2>';
  if (charge === undefined) return `${titre}<p class="duels-fin-note">Chargement des personnages…</p>`;
  if (!charge) return `${titre}<p class="duels-fin-note">Personnages indisponibles pour le moment.</p>`;
  const choisis = (e.quiestce && e.quiestce.perso_adverse) || {};
  const persos = charge.plateau.persos || [];
  const cartes = js.map((j) => {
    const perso = persos.find((x) => x.id === choisis[j.user_id]);
    if (!perso) {
      return `<figure class="duels-fin-perso"><figcaption class="duels-fin-legende"><span class="duels-fin-note">Personnage ${deJoueur(j)} : inconnu</span></figcaption></figure>`;
    }
    const image = portraitHtml(charge.portrait, perso);
    return `<figure class="duels-fin-perso">
      ${image ? `<div class="duels-fin-portrait" aria-hidden="true">${image}</div>` : ''}
      <figcaption class="duels-fin-legende"><span class="duels-fin-note">Personnage ${deJoueur(j)} :</span> <strong class="duels-fin-prenom">${esc(perso.prenom || '?')}</strong></figcaption>
    </figure>`;
  }).join('');
  return `${titre}<div class="duels-fin-persos">${cartes}</div>`;
}

/** Détail des manches : vainqueur et nombre de coups (essais, tirs ou questions selon le jeu). */
function blocManches(p, js, lancers = null) {
  const h = p.historique || [];
  const libelle = LIBELLE_COUPS[p.jeu] || 'Coups';
  const titre = `<h2 id="duels-fin-manches-titre" class="duels-h3">${h.length > 1 ? `Détail des ${h.length} manches` : 'Détail de la manche'}</h2>`;
  if (!h.length) return `${titre}<p class="duels-fin-note">Aucune manche jouée.</p>`;
  const lignes = h.map((d) => {
    const g = js.find((j) => j.user_id === d.gagnant);
    return `<tr><th scope="row">${esc(d.manche)}</th>
      <td>${g ? `${nomJoueur(g)} <span class="duels-fin-ok">· gagné</span>` : 'Nulle'}</td>
      <td>${esc(lancers ? lancers.filter((l) => l.manche === d.manche).length : (d.coups ?? ''))}</td></tr>`;
  }).join('');
  return `${titre}
    <div class="duels-fin-table-cadre"><table class="duels-fin-table">
      <thead><tr><th scope="col">Manche</th><th scope="col">Vainqueur</th><th scope="col">${libelle}</th></tr></thead>
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
  let vivant = true;
  let dernier = null;
  /** Qui est-ce : undefined tant que chargé, puis {plateau, portrait}, ou null si le chargement échoue. */
  let quiEst;
  let chargement = null;
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

  /** Qui est-ce : charge une fois les personnages du plateau et le module de portrait, puis redessine. */
  function chargerQuiEst() {
    if (chargement) return;
    chargement = Promise.all([
      duel.plateau(ctx.code).catch(() => null),
      import('./portrait.js').catch(() => null),
    ]).then(([plateau, portrait]) => {
      quiEst = plateau ? { plateau, portrait } : null;
      if (vivant && dernier) rendre(dernier);
    });
  }

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
      if (p.jeu === 'quiestce' && quiEst === undefined) chargerQuiEst();
      q('[data-grille]').innerHTML = p.jeu === 'mastermind' ? blocCodes(derniere, js)
        : p.jeu === 'bataille' ? blocFlottes(e, js, moiJ?.user_id)
          : p.jeu === 'quiestce' ? blocPersos(e, js, quiEst)
            : p.jeu === 'pfc' ? blocLancers(e, js)
              : !derniere ? '<h2 id="duels-fin-grille-titre" class="duels-h3">Dernière grille</h2><p class="duels-fin-note">Aucune manche jouée.</p>'
                : p.variante === 'ultime' ? blocUltime(p, derniere, js)
                  : ['othello', 'dames', 'echecs'].includes(p.jeu) ? blocCases(p, e, derniere, js)
                    : blocGrilleSimple(p, derniere, js);
      q('[data-manches]').innerHTML = blocManches(p, js, p.jeu === 'pfc' ? (e.pfc?.lancers || []) : null);
      q('[data-gains]').innerHTML = blocGains(e, moiJ, js);
      q('[data-actions]').innerHTML = blocActions(p, joue);
    } else {
      q('[data-gains]').innerHTML = `<p class="duels-fin-merci">Merci d’avoir joué${p.nom ? ` à ${esc(p.nom)}` : ''} !</p>`;
    }
  }

  return {
    /** Met à jour l'écran avec l'état du duel terminé. */
    maj(e) {
      dernier = e;
      rendre(e);
      chat?.maj(e);
    },
    /** Ajoute un message au chat. */
    message(m) { chat?.ajouter(m); },
    detruire() {
      vivant = false;
      chat?.detruire();
      root.innerHTML = '';
    },
  };
}
