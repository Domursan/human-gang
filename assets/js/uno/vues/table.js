// ===== Humane Gang — Uno : la table de jeu « Nuit arc-en-ciel » (#partie, partie en cours) =====
/*
 * Rôle : affiche une partie en cours. Barre du haut (nom, code, sens, chrono, bouton du chat), autres joueurs autour
 * de la table ovale (anneau arc-en-ciel), pioche et défausse, couleur et cumul, ma main, boutons Piocher / Passer /
 * UNO ! / Contrer, défi d'un Joker +4, journal et chat.
 * Sur ordinateur : table à gauche, chat à droite. Sous 760 px : une colonne, les joueurs défilent en bande et le chat
 * s'ouvre en volet. La mise en page est dans assets/css/uno/table.css ; ici, seulement le contenu et les actions.
 * Une seule action à la fois (anti double clic). Après chaque action : ctx.suivi.rafraichir().
 * Dépendances : core.js (esc, initials, toast), uno/api.js (uno, erreurTexte), uno/cartes.js (carteHtml, dosHtml, COULEURS),
 *   ./chat.js (creerChat), uno.css (.uno-btn, .uno-roue, .uno-roue-voile, .uno-invite-tag).
 * Exporte : creer(root, ctx) -> { maj(etat), message(msg), detruire() }.
 *   ctx = { code, naviguer, moi, suivi } ; suivi = retour de suivrePartie (rafraichir, secondesRestantes, etat).
 */
import { esc, initials, toast } from '../../core.js';
import { uno, erreurTexte } from '../api.js';
import { carteHtml, dosHtml, COULEURS } from '../cartes.js';
import { creerChat } from './chat.js';

const RAYON = 16;
const CIRCONFERENCE = 2 * Math.PI * RAYON;
const ECRAN_GRAND = '(min-width: 761px)';
const JOURNAL_MAX = 15;
const COULEURS_ROUE = [['r', 'Rouge', 'q-r'], ['b', 'Bleu', 'q-b'], ['g', 'Vert', 'q-g'], ['y', 'Jaune', 'q-y']];
const HEX = /^#[0-9a-f]{6}$/i;

const ETOILE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#FFFFFF" aria-hidden="true"><path d="M12 2l2.4 7.2H22l-6 4.6 2.3 7.2L12 16.6 5.7 21l2.3-7.2-6-4.6h7.6z"></path></svg>';
const ICONE_SENS = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E2C77E" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7"></path><path d="M20 4v4h-4"></path></svg>';
const ICONE_CHAT = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"></path></svg>';

/** Couleur d'affichage d'un joueur : sa couleur de profil, gris pour un invité. */
const couleurJoueur = (j) => (j?.invite ? '#9A968F' : (HEX.test(j?.couleur || '') ? j.couleur : '#F2EFEA'));
const nbCartes = (n) => (n === 1 ? '1 carte' : `${n ?? 0} cartes`);
/** Chrono « 0:18 », ou un tiret quand il n'y a pas de tour en cours. */
const chrono = (s) => (s == null ? '–' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
const ligneJournal = (j) => `<li class="uno-journal-ligne">${esc(j.texte)}</li>`;

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
    <p class="uno-sens"><span class="uno-sens-icone" data-sens-icone>${ICONE_SENS}</span><span data-sens>Sens horaire</span></p>
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
        <div class="uno-tapis-centre">
          <p class="uno-pilules">
            <span class="uno-pilule" data-couleur hidden></span>
            <span class="uno-pilule uno-pilule-cumul" data-cumul hidden></span>
          </p>
          <div class="uno-pile">
            <div class="uno-pile-bloc">
              <button type="button" class="uno-pioche" data-cle="pioche" data-pioche aria-label="Piocher">
                <span class="uno-pile-dos" aria-hidden="true">${dosHtml()}</span>
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
    <div class="uno-bas-ligne">
      <div class="uno-moi" data-moi></div>
      <div class="uno-main-zone">
        <p class="uno-indice" data-indice hidden>Interception possible</p>
        <div class="uno-main-cartes" data-main></div>
      </div>
      <div class="uno-commandes">
        <button type="button" class="btn btn-ghost uno-cmd" data-cle="piocher" data-piocher>Piocher</button>
        <button type="button" class="btn btn-ghost uno-cmd" data-cle="passer" data-passer hidden>Passer</button>
        <button type="button" class="uno-btn" data-cle="uno" data-uno>${ETOILE}<span>UNO !</span>${ETOILE}</button>
        <button type="button" class="btn btn-ghost uno-cmd" data-cle="contrer" data-contrer hidden></button>
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

  const q = (s) => el.querySelector(s);
  const refs = {
    titre: q('[data-nom]'), nom: q('[data-nom]'), code: q('[data-code]'), sens: q('[data-sens]'), sensIcone: q('[data-sens-icone]'),
    anneau: q('[data-anneau]'), chrono: q('[data-chrono]'), chronoAnnonce: q('[data-chrono-annonce]'),
    chatBouton: q('[data-chat-bouton]'), chatFermer: q('[data-chat-fermer]'),
    sieges: q('[data-sieges]'), couleur: q('[data-couleur]'), cumul: q('[data-cumul]'),
    pioche: q('[data-pioche]'), piocheNb: q('[data-pioche-nb]'), dessus: q('[data-dessus]'), dernier: q('[data-dernier]'),
    moi: q('[data-moi]'), defi: q('[data-defi]'), main: q('[data-main]'), indice: q('[data-indice]'),
    piocher: q('[data-piocher]'), passer: q('[data-passer]'), uno: q('[data-uno]'), contrer: q('[data-contrer]'),
    journal: q('[data-journal]'), annonceTour: q('[data-annonce-tour]'),
  };
  const chat = creerChat(q('[data-chat]'), { code, moi: ctx.moi });

  let etat = null;
  let occupe = false;
  let voile = null;
  let voileRetour = null;
  let dernierTour;
  let lastS;
  let journalPret = false;
  const journalVus = new Set();

  /* ---------- Lecture de l'état ---------- */

  const monId = () => etat?.moi?.user_id ?? null;
  const moiJoueur = () => etat?.joueurs?.find((j) => j.user_id === monId()) || null;
  const joueurPar = (uid) => etat?.joueurs?.find((j) => j.user_id === uid) || null;
  const monTour = () => !!etat?.partie && etat.partie.tour != null && etat.partie.tour === monId();
  const peutPiocher = () => !!etat && monTour() && !etat.partie.a_pioche && !occupe;
  const tailleMain = () => (grand.matches ? 'l' : '');

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
    refs.sensIcone.style.transform = antihoraire ? 'scaleX(-1)' : '';
  }

  function siege(j, pos, n) {
    const c = couleurJoueur(j);
    const tour = etat.partie.tour === j.user_id;
    const nb = Math.min(j.nb_cartes || 0, 3);
    const eventail = Array.from({ length: nb }, (_, i) =>
      `<span class="uno-eventail-carte" style="--i:${i}">${dosHtml({ taille: 's' })}</span>`).join('');
    return `<li class="uno-siege${tour ? ' est-tour' : ''}${j.exclu ? ' exclu' : ''}${n > 6 ? ' uno-serre' : ''}"
        style="--x:${pos.x.toFixed(1)}%;--y:${pos.y.toFixed(1)}%" data-joueur="${esc(j.user_id)}">
      <span class="uno-avatar" style="--c:${c}" aria-hidden="true">${esc(initials(j.pseudo))}</span>
      <span class="uno-siege-infos">
        <span class="uno-siege-nom"><strong style="color:${c}">${esc(j.pseudo || '?')}</strong>${j.invite ? ' <span class="uno-invite-tag">invité</span>' : ''}</span>
        <span class="uno-siege-cartes"><span class="uno-eventail" aria-hidden="true">${eventail}</span><span>${nbCartes(j.nb_cartes)}</span></span>
        <span class="uno-etiquettes">
          ${j.uno ? '<span class="uno-badge-uno">UNO !</span>' : ''}
          ${j.exclu ? '<span class="uno-tag">exclu</span>' : ''}
        </span>
      </span>
      ${tour ? '<span class="visually-hidden">, à son tour</span>' : ''}
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
    refs.pioche.disabled = !peutPiocher();
    refs.pioche.setAttribute('aria-label', `Piocher. Il reste ${p.pioche ?? 0} cartes`);
    refs.dessus.innerHTML = p.dessus ? carteHtml(p.dessus) : '<span class="uno-vide">Aucune carte</span>';
    refs.dernier.textContent = etat.journal?.[0]?.texte || '';
  }

  function rendreMoi() {
    const m = moiJoueur();
    if (!m) { refs.moi.innerHTML = ''; return; }
    const c = couleurJoueur(m);
    const tour = monTour();
    refs.moi.innerHTML = `
      <span class="uno-avatar uno-avatar-moi${tour ? ' est-tour' : ''}" style="--c:${c}" aria-hidden="true">${esc(initials(m.pseudo))}</span>
      <div class="uno-moi-texte">
        <strong style="color:${c}">${esc(m.pseudo || '?')} (toi)</strong>
        <span class="uno-moi-detail">${nbCartes(m.nb_cartes)}${m.uno ? ' · <span class="uno-badge-uno">UNO !</span>' : ''}</span>
        ${tour ? '<span class="uno-pilule uno-pilule-or">Ton tour</span>' : ''}
      </div>`;
  }

  function rendreMain() {
    const cartes = etat.main || [];
    if (etat.moi?.joue === false) {
      refs.main.innerHTML = '<p class="uno-vide">Tu suis la partie sans y jouer.</p>';
    } else if (!cartes.length) {
      refs.main.innerHTML = '<p class="uno-vide">Aucune carte en main.</p>';
    } else {
      const taille = tailleMain();
      const n = cartes.length;
      refs.main.innerHTML = cartes.map((c, i) =>
        `<div class="uno-eventail-main" style="--rot:${((i - (n - 1) / 2) * 4).toFixed(1)}deg">${carteHtml(c, {
          taille, bouton: true, jouable: !!c.jouable, attrs: `data-cle="carte-${c.id}"`,
        })}</div>`).join('');
    }
    refs.indice.hidden = !(etat.partie.statut === 'en_cours' && !monTour() && cartes.some((c) => c.jouable));
  }

  function rendreCommandes() {
    const p = etat.partie;
    const m = moiJoueur();
    const cumul = Number(p.cumul || 0);
    refs.piocher.textContent = cumul > 0 ? `Piocher ${cumul}` : 'Piocher';
    refs.piocher.disabled = !peutPiocher();
    refs.passer.hidden = !(monTour() && p.a_pioche);
    refs.passer.disabled = occupe;
    const peutUno = !!m && (m.nb_cartes === 1 || m.nb_cartes === 2) && !m.uno;
    refs.uno.disabled = !peutUno || occupe;
    refs.uno.classList.toggle('actif', peutUno && !occupe);
    const contrable = p.uno_attente && p.uno_attente !== monId() ? joueurPar(p.uno_attente) : null;
    refs.contrer.hidden = !contrable;
    refs.contrer.textContent = contrable ? `Contrer ${contrable.pseudo || ''}` : '';
    refs.contrer.dataset.cible = contrable?.user_id || '';
    refs.contrer.disabled = occupe;
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
  }

  /** Chrono : anneau, texte, et une annonce discrète à 10 secondes et à zéro (pas à chaque seconde). */
  function tic() {
    if (!etat?.partie) return;
    const s = suivi.secondesRestantes();
    if (s === lastS) return;
    lastS = s;
    const tour = etat.partie.t_tour || 0;
    refs.chrono.textContent = chrono(s);
    const fraction = s == null || !tour ? 0 : Math.min(1, s / tour);
    refs.anneau.setAttribute('stroke-dasharray', `${(fraction * CIRCONFERENCE).toFixed(2)} ${CIRCONFERENCE.toFixed(2)}`);
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
    const liste = cibles.map((j) => {
      const c = couleurJoueur(j);
      return `<li><button type="button" class="uno-cible" data-cible="${esc(j.user_id)}">
        <span class="uno-avatar" style="--c:${c}" aria-hidden="true">${esc(initials(j.pseudo))}</span>
        <span class="uno-cible-nom" style="color:${c}">${esc(j.pseudo || '?')}</span>
        <span class="uno-cible-nb">${nbCartes(j.nb_cartes)}</span></button></li>`;
    }).join('');
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
  refs.piocher.addEventListener('click', () => { if (peutPiocher()) agir(() => uno.piocher(code)); });
  refs.passer.addEventListener('click', () => agir(() => uno.passer(code)));
  refs.uno.addEventListener('click', () => agir(() => uno.direUno(code)));
  refs.contrer.addEventListener('click', () => {
    const cible = refs.contrer.dataset.cible;
    if (cible) agir(() => uno.contrer(code, cible));
  });
  refs.main.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-carte]');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    const carte = etat?.main?.find((c) => String(c.id) === b.dataset.carte);
    if (carte) jouerCarte(carte, b);
  });
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

  peindreChatBouton();
  const minuterie = setInterval(tic, 250);

  return {
    /** Nouvel état de la partie (appelé à chaque changement de version). */
    maj(e) {
      if (!e?.partie) return;
      etat = e;
      rendreTout(focusCle());
      chat.maj(e);
      annoncerTour();
      tic();
    },
    /** Message du chat (ancien ou nouveau). */
    message(msg) {
      chat.ajouter(msg);
    },
    /** Arrête le chrono et retire la table de la page. */
    detruire() {
      clearInterval(minuterie);
      grand.removeEventListener('change', surChangementEcran);
      fermerVoile(true);
      chat.detruire();
      el.remove();
    },
  };
}
