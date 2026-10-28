// ===== Humane Gang — Uno : la table de jeu « Nuit arc-en-ciel » (#partie, partie en cours) =====
/*
 * Rôle : affiche une partie en cours. Barre du haut (nom, code, sens, chrono, son, chat), autres joueurs autour
 * de la table (photo de profil, anneau doré et pastille « Joue » pour celui qui joue), tapis vert, flèches dorées qui
 * tournent dans le sens du jeu, pioche (on pioche en cliquant dessus ; elle pulse « Pioche ! » quand on n'a pas le choix)
 * et défausse, ma main en éventail (2 arcs au-delà de 12 cartes, triée par couleur ou par valeur), puis ma ligne :
 * moi, Passer, UNO ! (seulement juste après avoir posé l'avant-dernière carte), Contre-UNO rouge avec le nom de la cible.
 * Animations : cartes piochées qui volent une par une, +2/+4 et blocage sur le siège touché, grande annonce « UNO ! »
 * et « Inversion ». Son « Pièce arcade » quand mon tour commence (commun/tour-signal.js).
 * Sur ordinateur : table à gauche, chat à droite. Sous 760 px : une colonne, les joueurs défilent en bande, la main est
 * un éventail compressé sur 2 rangées (un appui fait remonter la carte, un second la joue) et le chat s'ouvre en volet.
 * La mise en page est dans assets/espaces/uno/table.css ; ici, seulement le contenu et les actions.
 * Une seule action à la fois (anti double clic). Après chaque action : ctx.suivi.rafraichir().
 * Dépendances : core.js (esc, avatarHtml, toast), uno/api.js (uno, erreurTexte), uno/cartes.js (carteHtml, dosHtml, COULEURS),
 *   ./chat.js (creerChat), commun/tour-signal.js, uno.css (.uno-btn, .uno-roue, .uno-roue-voile, .uno-invite-tag).
 * Exporte : creer(root, ctx) -> { maj(etat), message(msg), detruire() }.
 *   ctx = { code, naviguer, moi, suivi } ; suivi = retour de suivrePartie (rafraichir, secondesRestantes, etat, decalage).
 */
import { esc, avatarHtml, toast } from '../../../commun/core.js';
import { uno, erreurTexte } from '../api.js';
import { carteHtml, dosHtml, COULEURS } from '../cartes.js';
import { creerChat } from './chat.js';
import { boutonReponses } from '../../../commun/core/admin-reponses.js';
import { creerSignalTour } from '../../../commun/tour-signal.js';

const RAYON = 16;
const CIRCONFERENCE = 2 * Math.PI * RAYON;
const ECRAN_GRAND = '(min-width: 761px)';
const JOURNAL_MAX = 15;
const GRACE_UNO = 3000;            // ms avant de pouvoir contrer un oubli de UNO (règle serveur, migration 171)
const NB_FLECHES = 8;
const CLE_TRI = 'hg_uno_tri';
const COULEURS_ROUE = [['r', 'Rouge', 'q-r'], ['b', 'Bleu', 'q-b'], ['g', 'Vert', 'q-g'], ['y', 'Jaune', 'q-y']];
const ORDRE_COULEUR = { r: 0, y: 1, g: 2, b: 3, k: 4 };
const ORDRE_VALEUR = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'passe', 'inv', '+2', 'joker', '+4'];
const HEX = /^#[0-9a-f]{6}$/i;

const ETOILE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#FFFFFF" aria-hidden="true"><path d="M12 2l2.4 7.2H22l-6 4.6 2.3 7.2L12 16.6 5.7 21l2.3-7.2-6-4.6h7.6z"></path></svg>';
const ICONE_SENS = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7"></path><path d="M20 4v4h-4"></path></svg>';
const ICONE_CHAT = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"></path></svg>';
const ICONE_BLOQUE = '<svg width="78" height="78" viewBox="0 0 24 24" fill="none" stroke="#FF4D4D" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M5.6 18.4L18.4 5.6"></path></svg>';

/** Couleur d'affichage d'un joueur : sa couleur de profil, gris pour un invité. */
const couleurJoueur = (j) => (j?.invite ? '#9A968F' : (HEX.test(j?.couleur || '') ? j.couleur : '#F2EFEA'));
const nbCartes = (n) => (n === 1 ? '1 carte' : `${n ?? 0} cartes`);
/** Chrono « 0:18 », ou un tiret quand il n'y a pas de tour en cours. */
const chrono = (s) => (s == null ? '–' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
const ligneJournal = (j) => `<li class="uno-journal-ligne">${esc(j.texte)}</li>`;
const mouvementReduit = () => document.body.classList.contains('uno-calme')
  || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const lireTri = () => { try { return localStorage.getItem(CLE_TRI) === 'valeur' ? 'valeur' : 'couleur'; } catch { return 'couleur'; } };
const garderTri = (t) => { try { localStorage.setItem(CLE_TRI, t); } catch { /* stockage indisponible */ } };

/** Photo de profil (ou initiales) dans son anneau ; l'anneau devient doré et se vide avec le chrono pour le joueur actif. */
function avatar(j, taille) {
  const img = avatarHtml({ pseudo: j?.pseudo, color: j?.invite ? '#3A3A40' : j?.couleur, avatar_url: j?.avatar_url }, taille);
  return `<span class="uno-av" style="--c:${couleurJoueur(j)}">${img}</span>`;
}

/** Trie une main : par couleur (puis valeur) ou par valeur (puis couleur). */
function trier(cartes, mode) {
  const v = (c) => { const i = ORDRE_VALEUR.indexOf(c.valeur); return i < 0 ? 99 : i; };
  const co = (c) => ORDRE_COULEUR[c.couleur] ?? 9;
  return [...cartes].sort((a, b) => (mode === 'valeur'
    ? v(a) - v(b) || co(a) - co(b) || a.id - b.id
    : co(a) - co(b) || v(a) - v(b) || a.id - b.id));
}

/**
 * Positions (en % de la table) des autres joueurs, sur l'anneau : le premier à gauche, le dernier à droite.
 * Un seul adversaire : en haut. Moi, en bas, je ne suis pas placé ici.
 * @param {number} n nombre d'adversaires.
 * @returns {Array<{x:number, y:number}>}
 */
function placer(n) {
  const etendue = n <= 1 ? 0 : Math.min(212, 40 + 36 * (n - 1));
  return Array.from({ length: n }, (_, k) => {
    const phi = (n <= 1 ? 90 : 90 + etendue / 2 - k * (etendue / (n - 1))) * Math.PI / 180;
    return { x: 50 + 40 * Math.cos(phi), y: 50 - 34 * Math.sin(phi) };
  });
}

/** Squelette statique de la table (les parties variables sont remplies à chaque mise à jour). */
function squelette(idChat) {
  return `
  <header class="uno-barre">
    <div class="uno-barre-titre">
      <h1 class="uno-nom" tabindex="-1" data-nom>Partie</h1>
      <span class="uno-code" data-code></span>
    </div>
    <p class="uno-sens" data-sens-bloc><span class="uno-sens-icone" aria-hidden="true">${ICONE_SENS}</span><span data-sens>Sens horaire</span></p>
    <div class="uno-chrono" role="timer" aria-label="Temps restant pour jouer">
      <svg class="uno-anneau" width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="${RAYON}" fill="none" stroke="#2A2A2F" stroke-width="4"></circle>
        <circle data-anneau cx="20" cy="20" r="${RAYON}" fill="none" stroke="#E2C77E" stroke-width="4" stroke-linecap="round"
          stroke-dasharray="0 ${CIRCONFERENCE.toFixed(2)}" transform="rotate(-90 20 20)"></circle>
      </svg>
      <span class="uno-chrono-texte" data-chrono>–</span>
      <span class="visually-hidden" aria-live="polite" data-chrono-annonce></span>
    </div>
    <button type="button" class="btn btn-ghost uno-bouton-chat" data-chat-bouton aria-controls="${idChat}" aria-expanded="true">${ICONE_CHAT}<span class="uno-chat-libelle">Masquer le chat</span></button>
  </header>

  <div class="uno-corps">
    <section class="uno-plateau" aria-label="Table de jeu">
      <ol class="uno-sieges" aria-label="Autres joueurs" data-sieges></ol>
      <div class="uno-tapis">
        <div class="uno-ovale" aria-hidden="true"></div>
        <div class="uno-fleches" aria-hidden="true" data-fleches>${'<i></i>'.repeat(NB_FLECHES)}</div>
        <div class="uno-tapis-centre">
          <p class="uno-pilules">
            <span class="uno-pilule" data-couleur hidden></span>
            <span class="uno-pilule uno-pilule-cumul" data-cumul hidden></span>
          </p>
          <div class="uno-pile">
            <div class="uno-pile-bloc">
              <button type="button" class="uno-pioche" data-cle="pioche" data-pioche aria-label="Piocher">
                <span class="uno-pile-dos" aria-hidden="true">${dosHtml()}${dosHtml()}${dosHtml()}</span>
                <span class="uno-pioche-bulle" data-bulle hidden></span>
              </button>
              <span class="uno-legende">Pioche · <span data-pioche-nb>0</span></span>
            </div>
            <div class="uno-pile-bloc">
              <div class="uno-defausse" data-dessus></div>
              <span class="uno-legende">Défausse</span>
            </div>
          </div>
          <p class="uno-dernier" data-dernier></p>
        </div>
        <div class="uno-annonce" data-annonce aria-hidden="true"></div>
      </div>
    </section>

    <aside class="uno-chat" id="${idChat}" aria-label="Chat de la table">
      <div class="uno-chat-tete">
        <h2 class="uno-chat-titre">Chat de la table</h2>
        <button type="button" class="btn btn-ghost uno-chat-fermer" data-chat-fermer>Fermer le chat</button>
      </div>
      <div class="uno-chat-zone" data-chat></div>
    </aside>
  </div>

  <section class="uno-bas" aria-label="Tes cartes">
    <div class="uno-defi" data-defi hidden aria-live="polite"></div>
    <div class="uno-main-zone">
      <div class="uno-main-tete">
        <p class="uno-indice" data-indice hidden>Interception possible</p>
        <p class="uno-aide-tel" data-aide-tel>Touche une carte pour l'agrandir, touche-la encore pour la jouer.</p>
        <div class="uno-tri" role="group" aria-label="Trier ma main">
          <button type="button" data-tri="couleur">Par couleur</button>
          <button type="button" data-tri="valeur">Par valeur</button>
        </div>
      </div>
      <div class="uno-main-cartes" data-main></div>
    </div>
    <div class="uno-bas-ligne">
      <div class="uno-moi" data-moi></div>
      <div class="uno-commandes">
        <button type="button" class="btn btn-ghost uno-cmd" data-cle="passer" data-passer hidden>Passer</button>
        <button type="button" class="uno-contre" data-cle="contrer" data-contrer hidden></button>
        <button type="button" class="uno-btn" data-cle="uno" data-uno title="Disponible juste après avoir posé ton avant-dernière carte">${ETOILE}<span>UNO !</span>${ETOILE}</button>
      </div>
    </div>
  </section>

  <section class="uno-journal-zone" aria-labelledby="uno-journal-titre">
    <h2 class="uno-journal-titre" id="uno-journal-titre">Journal</h2>
    <ol class="uno-journal" aria-live="polite" aria-relevant="additions" data-journal></ol>
  </section>
  <p class="visually-hidden" aria-live="polite" data-annonce-tour></p>`;
}

/**
 * Monte la table de jeu dans root.
 * @param {HTMLElement} root conteneur de l'écran.
 * @param {{code: string, naviguer: Function, moi: object|null, suivi: object}} ctx
 * @returns {{ maj: (etat: object) => void, message: (msg: object) => void, detruire: () => void }}
 */
export function creer(root, ctx) {
  const code = ctx.code;
  const suivi = ctx.suivi;
  const grand = window.matchMedia(ECRAN_GRAND);
  const idChat = `uno-chat-zone-${code}`;

  const el = document.createElement('section');
  el.className = 'uno-table';
  el.innerHTML = squelette(idChat);
  root.append(el);
  boutonReponses(el.querySelector('.uno-barre'), 'uno', () => etat?.partie?.id ?? null);

  const q = (s) => el.querySelector(s);
  const refs = {
    titre: q('[data-nom]'), nom: q('[data-nom]'), code: q('[data-code]'), sens: q('[data-sens]'), sensBloc: q('[data-sens-bloc]'),
    anneau: q('[data-anneau]'), chrono: q('[data-chrono]'), chronoAnnonce: q('[data-chrono-annonce]'),
    chatBouton: q('[data-chat-bouton]'), chatFermer: q('[data-chat-fermer]'),
    sieges: q('[data-sieges]'), couleur: q('[data-couleur]'), cumul: q('[data-cumul]'), fleches: q('[data-fleches]'),
    pioche: q('[data-pioche]'), bulle: q('[data-bulle]'), piocheNb: q('[data-pioche-nb]'), dessus: q('[data-dessus]'),
    dernier: q('[data-dernier]'), annonce: q('[data-annonce]'), tapis: q('.uno-tapis'),
    moi: q('[data-moi]'), defi: q('[data-defi]'), main: q('[data-main]'), indice: q('[data-indice]'), aideTel: q('[data-aide-tel]'),
    passer: q('[data-passer]'), uno: q('[data-uno]'), contrer: q('[data-contrer]'),
    journal: q('[data-journal]'), annonceTour: q('[data-annonce-tour]'),
  };
  const chat = creerChat(q('[data-chat]'), { code, moi: ctx.moi });
  const signal = creerSignalTour();

  let etat = null;
  let occupe = false;
  let voile = null;
  let voileRetour = null;
  let dernierTour;
  let lastS;
  let journalPret = false;
  const journalVus = new Set();
  let tri = lireTri();
  let mainAvant = null;              // ids de ma main au rendu précédent (null : premier rendu)
  const enVol = new Set();           // cartes piochées pas encore arrivées (animation)
  let leve = null;                   // téléphone : id de la carte remontée par un premier appui
  let sensAvant = null;
  const nbAvant = new Map();         // nombre de cartes de chaque adversaire au rendu précédent

  /* ---------- Lecture de l'état ---------- */

  const monId = () => etat?.moi?.user_id ?? null;
  const moiJoueur = () => etat?.joueurs?.find((j) => j.user_id === monId()) || null;
  const joueurPar = (uid) => etat?.joueurs?.find((j) => j.user_id === uid) || null;
  const monTour = () => !!etat?.partie && etat.partie.statut === 'en_cours' && etat.partie.tour != null && etat.partie.tour === monId();
  const peutPiocher = () => !!etat && monTour() && !etat.partie.a_pioche && !etat.partie.defi && !occupe;
  const aucunCoup = () => !(etat?.main || []).some((c) => c.jouable);
  /** Millisecondes avant de pouvoir contrer (délai de grâce), 0 si c'est déjà possible. */
  const graceRestante = () => {
    const d = etat?.partie?.uno_depuis;
    if (!d) return 0;
    return Math.max(0, new Date(d).getTime() + GRACE_UNO - (Date.now() + (suivi.decalage?.() || 0)));
  };

  /** Les autres joueurs, en commençant par celui qui joue juste après moi. */
  function autres() {
    const js = etat?.joueurs || [];
    const i = js.findIndex((j) => j.user_id === monId());
    const ordre = i < 0 ? js : [...js.slice(i + 1), ...js.slice(0, i)];
    return ordre.filter((j) => j.user_id !== monId());
  }

  /* ---------- Rendu (chaque zone se met à jour à part) ---------- */

  function rendreBarre() {
    const p = etat.partie;
    refs.nom.textContent = p.nom || 'Partie';
    refs.code.textContent = p.code || code;
    const antihoraire = p.sens === -1;
    refs.sens.textContent = antihoraire ? 'Sens antihoraire' : 'Sens horaire';
    refs.sensBloc.classList.toggle('inverse', antihoraire);
  }

  function siege(j, pos, n) {
    const tour = etat.partie.tour === j.user_id && etat.partie.statut === 'en_cours';
    const nb = Math.min(j.nb_cartes || 0, 3);
    const eventail = Array.from({ length: nb }, () => '<span></span>').join('');
    return `<li class="uno-siege${tour ? ' est-tour' : ''}${j.exclu ? ' exclu' : ''}${n > 6 ? ' uno-serre' : ''}"
        style="--x:${pos.x.toFixed(1)}%;--y:${pos.y.toFixed(1)}%" data-joueur="${esc(j.user_id)}">
      <span class="uno-siege-photo">${avatar(j, n > 6 ? 44 : 56)}${j.uno ? '<span class="uno-badge-siege">UNO</span>' : ''}
        <span class="uno-tampon" aria-hidden="true">${ICONE_BLOQUE}</span></span>
      <span class="uno-siege-infos">
        <span class="uno-siege-nom"><strong style="color:${couleurJoueur(j)}">${esc(j.pseudo || '?')}</strong>${j.invite ? ' <span class="uno-invite-tag">invité</span>' : ''}</span>
        <span class="uno-siege-cartes"><span class="uno-mini-dos" aria-hidden="true">${eventail}</span><span>${nbCartes(j.nb_cartes)}</span></span>
        <span class="uno-etiquettes">
          ${tour ? '<span class="uno-joue">Joue</span>' : ''}
          ${j.exclu ? '<span class="uno-tag">exclu</span>' : ''}
        </span>
      </span>
      ${tour ? '<span class="visually-hidden">, à son tour</span>' : ''}${j.uno ? '<span class="visually-hidden">, a dit UNO</span>' : ''}
    </li>`;
  }

  function rendreSieges() {
    const liste = autres();
    const pos = placer(liste.length);
    refs.sieges.innerHTML = liste.map((j, k) => siege(j, pos[k], liste.length)).join('');
  }

  function rendreCentre() {
    const p = etat.partie;
    const coul = COULEURS[p.couleur];
    refs.couleur.hidden = !coul;
    refs.couleur.innerHTML = coul
      ? `<span class="uno-point" style="background:${coul.hex}" aria-hidden="true"></span>Couleur : ${esc(coul.nom)}`
      : '';
    const cumul = Number(p.cumul || 0);
    refs.cumul.hidden = cumul <= 0;
    refs.cumul.textContent = cumul > 0 ? `+${cumul} à piocher` : '';
    refs.piocheNb.textContent = p.pioche ?? 0;
    const peut = peutPiocher();
    const oblige = peut && aucunCoup();   // aucune carte jouable : il faut piocher
    refs.pioche.disabled = !peut;
    refs.pioche.classList.toggle('oblige', oblige);
    refs.bulle.hidden = !oblige;
    refs.bulle.textContent = cumul > 0 ? `Pioche ${cumul} !` : 'Pioche !';
    refs.pioche.setAttribute('aria-label', peut
      ? `${cumul > 0 ? `Piocher ${cumul} cartes` : 'Piocher une carte'}${oblige ? ' : aucune carte jouable' : ''}. Il reste ${p.pioche ?? 0} cartes`
      : `Pioche : ${p.pioche ?? 0} cartes`);
    refs.dessus.innerHTML = p.dessus ? carteHtml(p.dessus, { taille: grand.matches ? 'l' : '' }) : '<span class="uno-vide">Aucune carte</span>';
    refs.dernier.textContent = etat.journal?.[0]?.texte || '';
  }

  function rendreMoi() {
    const m = moiJoueur();
    if (!m) { refs.moi.innerHTML = ''; return; }
    const tour = monTour();
    refs.moi.innerHTML = `
      <span class="uno-siege-photo uno-moi-photo${tour ? ' est-tour' : ''}">${avatar(m, 52)}${m.uno ? '<span class="uno-badge-siege">UNO</span>' : ''}
        <span class="uno-tampon" aria-hidden="true">${ICONE_BLOQUE}</span></span>
      <div class="uno-moi-texte">
        <strong style="color:${couleurJoueur(m)}">${esc(m.pseudo || '?')} (toi)</strong>
        <span class="uno-moi-detail">${nbCartes(m.nb_cartes)}</span>
        ${tour ? '<span class="uno-joue">Ton tour</span>' : ''}
      </div>`;
  }

  /** Place les cartes de ma main en éventail (positions calculées selon la largeur disponible). */
  function placerMain() {
    const zone = refs.main;
    const boutons = [...zone.querySelectorAll('.uno-fan-carte')];
    const n = boutons.length;
    if (!n) { zone.style.height = ''; return; }
    const W = zone.clientWidth || 600;
    if (grand.matches) {
      const cw = W >= 700 ? 88 : 72; const ch = cw * 1.5;
      const rangs = n > 12 ? [Math.ceil(n / 2), n - Math.ceil(n / 2)] : [n];
      const ecart = 64;                      // décalage vertical entre les 2 arcs
      const creux = 26;                      // profondeur de l'arc
      zone.style.height = `${ch + 22 + creux + (rangs.length - 1) * ecart}px`;
      let i0 = 0;
      rangs.forEach((m, ri) => {
        const etendue = Math.min(W - cw - 24, Math.max(0, (m - 1) * cw * 0.66));
        for (let i = 0; i < m; i++) {
          const k = m > 1 ? i / (m - 1) - 0.5 : 0;
          const x = W / 2 - etendue / 2 + (m > 1 ? i * etendue / (m - 1) : 0) - cw / 2;
          const y = 12 + ri * ecart + k * k * 4 * creux;
          const b = boutons[i0 + i];
          b.style.cssText = `left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;z-index:${ri * 40 + i + 1};--r:${(k * Math.min(26, 4 + m * 2)).toFixed(1)}deg`;
        }
        i0 += m;
      });
    } else {
      const cw = 52; const ch = 78;
      const rangs = n > 9 ? [Math.ceil(n / 2), n - Math.ceil(n / 2)] : [n];
      zone.style.height = `${ch + 30 + (rangs.length - 1) * (ch + 10)}px`;
      let i0 = 0;
      rangs.forEach((m, ri) => {
        const pas = m > 1 ? Math.min(cw * 0.95, (W - cw) / (m - 1)) : 0;
        const debut = (W - cw - pas * (m - 1)) / 2;
        for (let i = 0; i < m; i++) {
          const k = m > 1 ? i / (m - 1) - 0.5 : 0;
          const b = boutons[i0 + i];
          b.style.cssText = `left:${(debut + i * pas).toFixed(1)}px;top:${(16 + ri * (ch + 10) + Math.abs(k) * 14).toFixed(1)}px;z-index:${ri * 40 + i + 1};--r:${(k * 14).toFixed(1)}deg`;
        }
        i0 += m;
      });
    }
  }

  function rendreMain() {
    const cartes = trier(etat.main || [], tri);
    const ids = cartes.map((c) => c.id);
    // Cartes nouvelles : on les fait arriver une par une depuis la pioche (seulement si la main a grandi).
    if (mainAvant && !mouvementReduit()) {
      const garde = [...mainAvant].every((id) => ids.includes(id));
      const nouvelles = ids.filter((id) => !mainAvant.has(id));
      if (garde && nouvelles.length && nouvelles.length <= 12) nouvelles.forEach((id) => enVol.add(id));
    }
    for (const id of [...enVol]) if (!ids.includes(id)) enVol.delete(id);
    mainAvant = new Set(ids);
    if (leve != null && !ids.includes(leve)) leve = null;

    el.querySelectorAll('[data-tri]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tri === tri)));
    if (etat.moi?.joue === false) {
      refs.main.innerHTML = '<p class="uno-vide">Tu suis la partie sans y jouer.</p>';
    } else if (!cartes.length) {
      refs.main.innerHTML = '<p class="uno-vide">Aucune carte en main.</p>';
    } else {
      const taille = grand.matches ? (refs.main.clientWidth >= 700 || !refs.main.clientWidth ? 'l' : '') : 's';
      refs.main.innerHTML = cartes.map((c) =>
        `<div class="uno-fan-carte${enVol.has(c.id) ? ' arrive' : ''}${leve === c.id ? ' leve' : ''}" data-id="${c.id}">${carteHtml(c, {
          taille, bouton: true, jouable: !!c.jouable, attrs: `data-cle="carte-${c.id}"`,
        })}</div>`).join('');
      refs.main.setAttribute('aria-label', `Ta main : ${nbCartes(cartes.length)}`);
      placerMain();
    }
    refs.indice.hidden = !(etat.partie.statut === 'en_cours' && !monTour() && cartes.some((c) => c.jouable));
    refs.aideTel.hidden = grand.matches || cartes.length < 2;
    if (enVol.size) faireArriver();
  }

  function rendreCommandes() {
    const p = etat.partie;
    const m = moiJoueur();
    const passer = monTour() && p.a_pioche;
    refs.passer.hidden = !passer;
    refs.passer.disabled = occupe;
    refs.passer.classList.toggle('oblige', passer && aucunCoup());
    const peutUno = !!m && m.nb_cartes === 1 && !m.uno && p.statut === 'en_cours';
    refs.uno.disabled = !peutUno || occupe;
    refs.uno.classList.toggle('actif', peutUno && !occupe);
    refs.uno.title = peutUno ? 'Dis UNO avant qu\'on te contre !' : 'Disponible juste après avoir posé ton avant-dernière carte';
    peindreContre();
  }

  /** Bouton Contre-UNO : rouge et pulsant, avec le nom de la cible ; grisé pendant les 3 secondes de grâce. */
  function peindreContre() {
    const p = etat.partie;
    const contrable = p.uno_attente && p.uno_attente !== monId() && etat.moi?.joue !== false ? joueurPar(p.uno_attente) : null;
    refs.contrer.hidden = !contrable;
    if (!contrable) { refs.contrer.dataset.cible = ''; return; }
    const reste = graceRestante();
    const nom = contrable.pseudo || '?';
    refs.contrer.dataset.cible = contrable.user_id;
    refs.contrer.disabled = occupe || reste > 0;
    refs.contrer.classList.toggle('attend', reste > 0);
    const txt = reste > 0 ? `Contre-UNO : ${nom} (${Math.ceil(reste / 1000)} s)` : `Contre-UNO : ${nom} !`;
    if (refs.contrer.textContent !== txt) refs.contrer.textContent = txt;
  }

  function rendreDefi() {
    const d = etat.partie.defi;
    const pour = !!d && d.cible === monId();
    refs.defi.hidden = !pour;
    if (!pour) { refs.defi.innerHTML = ''; return; }
    const poseur = joueurPar(d.poseur);
    refs.defi.innerHTML = `
      <p class="uno-defi-texte"><strong>${esc(poseur?.pseudo || 'Un joueur')}</strong> a posé un Joker +4. Contester ?</p>
      <div class="uno-defi-actions">
        <button type="button" class="btn btn-ghost" data-cle="defi-contester" data-defi="oui"${occupe ? ' disabled' : ''}>Contester</button>
        <button type="button" class="btn btn-primary" data-cle="defi-accepter" data-defi="non"${occupe ? ' disabled' : ''}>Accepter (+4)</button>
      </div>`;
  }

  /** Le journal ne s'ajoute qu'en tête : seules les nouvelles lignes sont annoncées (aria-relevant=additions). */
  function rendreJournal() {
    const liste = etat.journal || [];
    if (!journalPret) {
      refs.journal.innerHTML = liste.map(ligneJournal).join('');
      liste.forEach((j) => journalVus.add(j.id));
      journalPret = true;
      return;
    }
    const nouveaux = liste.filter((j) => !journalVus.has(j.id)).reverse();
    for (const j of nouveaux) {
      refs.journal.insertAdjacentHTML('afterbegin', ligneJournal(j));
      journalVus.add(j.id);
    }
    while (refs.journal.children.length > JOURNAL_MAX) refs.journal.lastElementChild.remove();
    nouveaux.forEach(effetJournal);
  }

  /* ---------- Animations ---------- */

  const rejouer = (n, cls) => { if (!n) return; n.classList.remove(cls); void n.offsetWidth; n.classList.add(cls); };
  /** Élément « photo » d'un joueur (siège, ou ma ligne). */
  const photoDe = (uid) => (uid === monId() ? refs.moi.querySelector('.uno-siege-photo')
    : refs.sieges.querySelector(`[data-joueur="${CSS.escape(String(uid))}"] .uno-siege-photo`));

  /** Grande annonce au centre de la table (« UNO ! », « Inversion »). */
  function annonce(titreHtml, sousTitre) {
    if (mouvementReduit()) return;
    refs.annonce.innerHTML = `${titreHtml}<span class="qui">${esc(sousTitre)}</span>`;
    rejouer(refs.annonce, 'go');
  }

  /** « +2 », « +4 », « Bloqué ! » qui jaillit du siège touché. */
  function coup(uid, texte, couleur, bloque = false) {
    const ph = photoDe(uid);
    if (!ph || mouvementReduit()) return;
    const r = ph.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const n = document.createElement('div');
    n.className = 'uno-coup';
    n.textContent = texte;
    n.style.cssText = `left:${r.left - b.left + r.width / 2}px;top:${r.top - b.top + 10}px;color:${couleur};--lueur:${couleur}`;
    el.append(n);
    requestAnimationFrame(() => n.classList.add('go'));
    setTimeout(() => n.remove(), 1500);
    rejouer(ph, 'touche');
    if (bloque) rejouer(ph, 'bloque');
  }

  /** Effet d'une nouvelle ligne du journal. */
  function effetJournal(j) {
    const t = j.texte || '';
    if (j.type === 'uno') {
      const nom = joueurPar(j.user_id)?.pseudo || 'Un joueur';
      annonce('<span class="uno-txt">UNO !</span>', j.user_id === monId() ? 'Tu n\'as plus qu\'une carte' : `${nom} n'a plus qu'une carte`);
    } else if (j.type === 'contre') {
      annonce('<span class="uno-txt-rouge">Contre-UNO !</span>', 'Oubli de UNO : 2 cartes de pénalité');
    } else if (j.type === 'pioche' || j.type === 'defi') {
      const m = t.match(/pioche (\d+) cartes/);
      if (m && Number(m[1]) >= 2) coup(j.user_id, `+${m[1]}`, '#FF5A5A', /passe son tour/.test(t));
    } else if (j.type === 'info' && /passe son tour\.$/.test(t) && !/garde sa carte/.test(t)) {
      coup(j.user_id, 'Bloqué !', '#FF8A4C', true);
    }
  }

  /** Les cartes piochées arrivent une par une : un dos vole de la pioche à sa place dans la main. */
  let vols = 0;
  function faireArriver() {
    if (vols) return;
    const suivante = () => {
      const id = [...enVol][0];
      if (id == null) { vols = 0; return; }
      const cible = refs.main.querySelector(`.uno-fan-carte[data-id="${id}"]`);
      const depart = refs.pioche.getBoundingClientRect();
      if (!cible || !depart.width) { enVol.delete(id); cible?.classList.remove('arrive'); suivante(); return; }
      const arrivee = cible.getBoundingClientRect();
      const v = document.createElement('div');
      v.className = 'uno-vole';
      v.innerHTML = dosHtml({ taille: grand.matches ? '' : 's' });
      v.style.left = `${depart.left}px`;
      v.style.top = `${depart.top}px`;
      document.body.append(v);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        v.style.transform = `translate(${arrivee.left - depart.left}px, ${arrivee.top - depart.top}px) rotate(8deg)`;
      }));
      setTimeout(() => {
        v.remove();
        enVol.delete(id);
        refs.main.querySelector(`.uno-fan-carte[data-id="${id}"]`)?.classList.remove('arrive');
        suivante();
      }, 420);
    };
    vols = 1;
    suivante();
  }

  /** Adversaires qui reçoivent des cartes : petits dos qui volent vers leur siège. */
  function volsAdversaires() {
    if (mouvementReduit()) { nbAvant.clear(); }
    for (const j of autres()) {
      const avant = nbAvant.get(j.user_id);
      nbAvant.set(j.user_id, j.nb_cartes || 0);
      if (avant == null || mouvementReduit()) continue;
      const plus = Math.min(4, (j.nb_cartes || 0) - avant);
      const ph = photoDe(j.user_id);
      if (plus <= 0 || plus > 4 || !ph) continue;
      const d = refs.pioche.getBoundingClientRect();
      const a = ph.getBoundingClientRect();
      for (let i = 0; i < plus; i++) {
        setTimeout(() => {
          const v = document.createElement('div');
          v.className = 'uno-vole petit';
          v.innerHTML = dosHtml({ taille: 's' });
          v.style.left = `${d.left}px`;
          v.style.top = `${d.top}px`;
          document.body.append(v);
          requestAnimationFrame(() => requestAnimationFrame(() => {
            v.style.transform = `translate(${a.left - d.left}px, ${a.top - d.top}px) scale(.45) rotate(-10deg)`;
            v.style.opacity = '.2';
          }));
          setTimeout(() => v.remove(), 480);
        }, i * 260);
      }
    }
  }

  /* ---------- Flèches dorées qui tournent sur l'anneau, dans le sens du jeu ---------- */

  let phase = 0;
  let t0 = 0;
  let raf = 0;
  function tournerFleches(now) {
    raf = requestAnimationFrame(tournerFleches);
    if (document.hidden || !etat?.partie) { t0 = now; return; }
    const dir = etat.partie.sens === -1 ? -1 : 1;
    if (!mouvementReduit()) phase += ((now - (t0 || now)) / 1000) * 0.35 * dir;
    t0 = now;
    const w = refs.fleches.clientWidth / 2;
    const h = refs.fleches.clientHeight / 2;
    if (!w || !h) return;
    [...refs.fleches.children].forEach((f, i) => {
      const a = phase + (i / NB_FLECHES) * Math.PI * 2;
      const ang = Math.atan2(Math.cos(a) * h * dir, -Math.sin(a) * w * dir) * 180 / Math.PI;
      f.style.transform = `translate(${(Math.cos(a) * w).toFixed(1)}px, ${(Math.sin(a) * h).toFixed(1)}px) rotate(${ang.toFixed(1)}deg)`;
    });
  }

  /* ---------- Chrono ---------- */

  /** Chrono : anneau, texte, anneau doré du joueur actif, et une annonce discrète à 10 secondes et à zéro. */
  function tic() {
    if (!etat?.partie) return;
    if (!refs.contrer.hidden) peindreContre();
    const s = suivi.secondesRestantes();
    if (s === lastS) return;
    lastS = s;
    const tour = etat.partie.t_tour || 0;
    refs.chrono.textContent = chrono(s);
    const fraction = s == null || !tour ? 0 : Math.min(1, s / tour);
    refs.anneau.setAttribute('stroke-dasharray', `${(fraction * CIRCONFERENCE).toFixed(2)} ${CIRCONFERENCE.toFixed(2)}`);
    el.style.setProperty('--k', fraction.toFixed(3));
    if (s === 10) refs.chronoAnnonce.textContent = 'Il reste 10 secondes.';
    if (s === 0) refs.chronoAnnonce.textContent = 'Temps écoulé.';
    const roueTemps = voile?.querySelector('[data-roue-temps]');
    if (roueTemps) roueTemps.textContent = chrono(s);
  }

  /** Annonce le changement de tour (lecteurs d'écran), sans l'annoncer à l'ouverture de la page. */
  function annoncerTour() {
    const tour = etat.partie.tour;
    if (tour === dernierTour) return;
    const premier = dernierTour === undefined;
    dernierTour = tour;
    if (premier || !tour) return;
    refs.annonceTour.textContent = tour === monId() ? "C'est ton tour." : `Au tour de ${joueurPar(tour)?.pseudo || 'un joueur'}.`;
  }

  /** Changement de sens : annonce « Inversion » (pas à l'ouverture de la page). */
  function surveillerSens() {
    const s = etat.partie.sens === -1 ? -1 : 1;
    if (sensAvant != null && s !== sensAvant) {
      annonce(`<span class="uno-txt-or">⟲ Inversion</span>`, s === -1 ? 'Le jeu tourne maintenant dans le sens antihoraire' : 'Le jeu tourne maintenant dans le sens horaire');
    }
    sensAvant = s;
  }

  /** Élément ayant le focus dans la table (pour le retrouver après un nouveau rendu). */
  function focusCle() {
    const a = document.activeElement;
    return a && el.contains(a) ? (a.dataset?.cle || null) : null;
  }

  function restaurerFocus(cle) {
    const a = document.activeElement;
    if (a && a !== document.body && !el.contains(a)) return; // le focus est ailleurs : on n'y touche pas
    let cible = el.querySelector(`[data-cle="${cle}"]:not([disabled])`);
    if (!cible && cle.startsWith('carte-')) cible = el.querySelector('.uno-main-cartes button[data-carte]:not([disabled])');
    if (!cible) cible = refs.titre;
    cible?.focus({ preventScroll: true });
  }

  function rendreTout(cle = null) {
    if (!etat?.partie) return;
    rendreBarre(); rendreSieges(); rendreCentre(); rendreMoi(); rendreMain();
    rendreCommandes(); rendreDefi(); rendreJournal();
    if (cle) restaurerFocus(cle);
  }

  /* ---------- Chat du volet et des sièges ---------- */

  const chatOuvert = () => (grand.matches ? !el.classList.contains('chat-masque') : el.classList.contains('chat-ouvert'));
  function peindreChatBouton() {
    const ouvert = chatOuvert();
    const libelle = grand.matches
      ? (ouvert ? 'Masquer le chat' : 'Afficher le chat')
      : (ouvert ? 'Fermer le chat' : 'Ouvrir le chat');
    refs.chatBouton.setAttribute('aria-expanded', String(ouvert));
    refs.chatBouton.querySelector('.uno-chat-libelle').textContent = libelle;
  }
  function surBoutonChat() {
    const ouvrir = !chatOuvert();
    if (grand.matches) el.classList.toggle('chat-masque', !ouvrir);
    else el.classList.toggle('chat-ouvert', ouvrir);
    peindreChatBouton();
    requestAnimationFrame(placerMain);
  }
  function surChangementEcran() {
    peindreChatBouton();
    if (etat?.partie) rendreTout(focusCle());
  }

  /* ---------- Fenêtres (roue des couleurs, choix de l'adversaire) ---------- */

  function piegerTab(ev, v) {
    const focusables = [...v.querySelectorAll('button:not([disabled])')];
    if (!focusables.length) return;
    const premier = focusables[0];
    const dernier = focusables[focusables.length - 1];
    if (ev.shiftKey && document.activeElement === premier) { ev.preventDefault(); dernier.focus(); }
    else if (!ev.shiftKey && document.activeElement === dernier) { ev.preventDefault(); premier.focus(); }
  }

  function fermerVoile(silencieux = false) {
    if (!voile) return;
    voile.remove();
    voile = null;
    const retour = voileRetour;
    voileRetour = null;
    if (!silencieux && retour?.isConnected) retour.focus();
  }

  function ouvrirVoile(html, retour, titre) {
    fermerVoile(true);
    const v = document.createElement('div');
    v.className = 'uno-roue-voile';
    v.setAttribute('role', 'dialog');
    v.setAttribute('aria-modal', 'true');
    v.setAttribute('aria-label', titre);
    v.innerHTML = html;
    v.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') { ev.preventDefault(); fermerVoile(); }
      else if (ev.key === 'Tab') piegerTab(ev, v);
    });
    v.addEventListener('click', (ev) => { if (ev.target === v) fermerVoile(); });
    v.querySelector('[data-annuler]')?.addEventListener('click', () => fermerVoile());
    el.append(v);
    voile = v;
    voileRetour = retour;
    v.querySelector('button')?.focus();
    return v;
  }

  /* ---------- Actions ---------- */

  /** Lance une action serveur : une seule à la fois, erreurs en toast, puis relecture de l'état. */
  async function agir(fn) {
    if (occupe) return;
    occupe = true;
    const cle = focusCle();
    rendreTout(); // boutons désactivés, sans déplacer le focus : il revient à la fin
    try {
      await fn();
    } catch (e) {
      toast(erreurTexte(e), 'error');
    } finally {
      occupe = false;
      rendreTout(focusCle() || cle);
      suivi.rafraichir();
    }
  }

  function choisirCouleur(carte, retour) {
    const roue = COULEURS_ROUE.map(([c, nom, classe]) =>
      `<button type="button" class="${classe}" data-couleur-choix="${c}"><span>${nom}</span></button>`).join('');
    const v = ouvrirVoile(`
      <h2 id="uno-voile-titre">Choisis la couleur</h2>
      <div class="uno-roue">${roue}<div class="centre">${carteHtml({ couleur: 'k', valeur: 'joker' }, { taille: 's' })}</div></div>
      <p>Touche un quart du cercle · <span data-roue-temps>${chrono(suivi.secondesRestantes())}</span> pour choisir</p>
      <button type="button" class="btn btn-ghost" data-annuler>Annuler</button>`, retour, 'Choisis la couleur');
    v.querySelectorAll('[data-couleur-choix]').forEach((b) => b.addEventListener('click', () => {
      const couleur = b.dataset.couleurChoix;
      fermerVoile();
      agir(() => uno.jouer(code, carte.id, { couleur }));
    }));
  }

  function choisirCible(carte, retour) {
    const cibles = autres().filter((j) => !j.exclu);
    if (!cibles.length) { agir(() => uno.jouer(code, carte.id)); return; }
    const liste = cibles.map((j) => `<li><button type="button" class="uno-cible" data-cible="${esc(j.user_id)}">
        ${avatar(j, 40)}
        <span class="uno-cible-nom" style="color:${couleurJoueur(j)}">${esc(j.pseudo || '?')}</span>
        <span class="uno-cible-nb">${nbCartes(j.nb_cartes)}</span></button></li>`).join('');
    const v = ouvrirVoile(`
      <h2 id="uno-voile-titre">Avec qui échanger ta main ?</h2>
      <ul class="uno-cibles">${liste}</ul>
      <button type="button" class="btn btn-ghost" data-annuler>Annuler</button>`, retour, 'Avec qui échanger ta main ?');
    v.querySelectorAll('[data-cible]').forEach((b) => b.addEventListener('click', () => {
      const cible = b.dataset.cible;
      fermerVoile();
      agir(() => uno.jouer(code, carte.id, { cible }));
    }));
  }

  /** Clic sur une carte : Joker ou +4 -> roue ; 7 en Sept-zéro -> choix de l'adversaire ; sinon on pose. */
  function jouerCarte(carte, bouton) {
    if (occupe || !etat) return;
    if (carte.valeur === 'joker' || carte.valeur === '+4') { choisirCouleur(carte, bouton); return; }
    if (carte.valeur === '7' && etat.partie.variantes?.sept_zero) { choisirCible(carte, bouton); return; }
    agir(() => uno.jouer(code, carte.id));
  }

  /* ---------- Écouteurs ---------- */

  refs.pioche.addEventListener('click', () => { if (peutPiocher()) agir(() => uno.piocher(code)); });
  refs.passer.addEventListener('click', () => agir(() => uno.passer(code)));
  refs.uno.addEventListener('click', () => agir(() => uno.direUno(code)));
  refs.contrer.addEventListener('click', () => {
    const cible = refs.contrer.dataset.cible;
    if (cible) agir(() => uno.contrer(code, cible));
  });
  refs.main.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-carte]');
    if (!b) return;
    const carte = etat?.main?.find((c) => String(c.id) === b.dataset.carte);
    if (!carte) return;
    // Téléphone : un premier appui fait remonter la carte pour la voir en entier, le second la joue.
    // (Le clavier joue directement : detail = 0 pour une activation au clavier.)
    if (!grand.matches && ev.detail !== 0 && leve !== carte.id) {
      leve = carte.id;
      refs.main.querySelectorAll('.uno-fan-carte').forEach((f) => f.classList.toggle('leve', f.dataset.id === String(carte.id)));
      return;
    }
    if (b.getAttribute('aria-disabled') === 'true') return;
    leve = null;
    jouerCarte(carte, b);
  });
  el.querySelectorAll('[data-tri]').forEach((b) => b.addEventListener('click', () => {
    tri = b.dataset.tri;
    garderTri(tri);
    if (etat?.partie) rendreMain();
  }));
  refs.defi.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-defi]');
    if (b) agir(() => uno.contester(code, b.dataset.defi === 'oui'));
  });
  refs.chatBouton.addEventListener('click', surBoutonChat);
  refs.chatFermer.addEventListener('click', () => {
    el.classList.remove('chat-ouvert');
    peindreChatBouton();
    refs.chatBouton.focus();
  });
  grand.addEventListener('change', surChangementEcran);
  const observateur = typeof ResizeObserver === 'function' ? new ResizeObserver(() => placerMain()) : null;
  observateur?.observe(refs.main);

  peindreChatBouton();
  const minuterie = setInterval(tic, 250);
  raf = requestAnimationFrame(tournerFleches);

  return {
    /** Nouvel état de la partie (appelé à chaque changement de version). */
    maj(e) {
      if (!e?.partie) return;
      etat = e;
      rendreTout(focusCle());
      chat.maj(e);
      annoncerTour();
      surveillerSens();
      volsAdversaires();
      signal.maj(monTour());
      lastS = undefined;
      tic();
    },
    /** Message du chat (ancien ou nouveau). */
    message(msg) {
      chat.ajouter(msg);
    },
    /** Arrête le chrono et retire la table de la page. */
    detruire() {
      clearInterval(minuterie);
      cancelAnimationFrame(raf);
      observateur?.disconnect();
      signal.arreter();
      grand.removeEventListener('change', surChangementEcran);
      fermerVoile(true);
      chat.detruire();
      el.remove();
    },
  };
}
