// ===== Humane Gang — Destins : la table de jeu (plateaux/jeux/destins/table.js) =====
/*
 * Rôle : affiche une partie de Destins en cours (jeu de la vie : études, métier, mariage, maison, retraite).
 *   Bandeau (joueurs, chrono, quitter), chemin de vie avec les pions, roue (1 à 10) et « Tourner la roue »,
 *   carte Événement tirée, panneau de choix selon la phase, ma fiche (avec Rembourser), classement provisoire,
 *   journal, chat (à droite sur ordinateur, en tiroir sur téléphone).
 *   La mise en page est dans assets/css/plateaux/destins.css ; ici, le contenu et les actions.
 *   Les zones sont reconstruites seulement quand leur contenu change (le focus et les saisies restent en place).
 * Dépendances : core.js (esc, initials, toast), ../../api.js (plat, erreurTexte, nomDe, imageExiste),
 *   ../../vues/commun.js (bandeauHtml, brancherChrono, journalHtml, imagePlateau, envoyer, moiJoueur, joueurDe),
 *   ../../vues/chat.js (creerChat, tiroirChat), ./plateau.js (plateauHtml, POSITIONS).
 * Exporte : creer(root, ctx) -> { maj(etat), message(msg), detruire() }.
 *   ctx = { code, naviguer, moi, suivi, contenus } ; suivi = retour de suivrePartie.
 */
import { esc, initials, toast } from '../../../../commun/core.js';
import { plat, erreurTexte, nomDe, imageExiste } from '../../api.js';
import { bandeauHtml, brancherChrono, journalHtml, imagePlateau, envoyer, moiJoueur, joueurDe } from '../../vues/commun.js';
import { creerChat, tiroirChat } from '../../vues/chat.js';
import { plateauHtml, POSITIONS } from './plateau.js';

const ECRAN_GRAND = '(min-width: 761px)';
const NB_CASES = POSITIONS.length;
const SAISIE_MIN = 25000;   // montant à réunir pour rembourser un prêt
const ASSURANCE = { habitation: 20000, auto: 10000 };
const ICONE_QUITTER = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H5v16h4M14 8l4 4-4 4M18 12H9"></path></svg>';

/** Montant en euros, format français. */
const euros = (n) => `${Math.round(Number(n) || 0).toLocaleString('fr-FR')} €`;
/** Couleur de profil sûre (sinon texte clair). */
const couleurDe = (j) => (/^#[0-9a-f]{6}$/i.test(j?.couleur || '') && !j?.invite ? j.couleur : '#F2EFEA');
/** Pion : initiales du pseudo (deux lettres). */
const initialesPseudo = (pseudo) => initials(pseudo || '?');

/** Gabarit statique : les zones variables sont remplies à chaque mise à jour. */
function squelette() {
  return `
  <header class="ds-bandeau" data-bandeau></header>
  <div class="ds-barre" role="toolbar" aria-label="Actions de la partie">
    <span class="ds-code small muted" data-code></span>
    <button type="button" class="ds-btn ds-btn-ghost ds-quitter" data-quitter>${ICONE_QUITTER}<span>Quitter la partie</span></button>
  </div>
  <p class="ds-elimine" data-elimine hidden></p>
  <div class="ds-corps">
    <div class="ds-colonne-plan">
      <section class="ds-plan-zone" aria-label="Chemin de vie" data-plan></section>
      <div class="ds-roue-zone">
        <section class="ds-bloc ds-roue-bloc" aria-labelledby="ds-roue-titre">
          <h2 id="ds-roue-titre" class="ds-bloc-titre">La roue</h2>
          <div class="ds-roue" data-roue aria-hidden="true"><span data-roue-val>-</span></div>
          <p class="ds-note" data-roue-texte></p>
          <dl class="ds-prochaines">
            <div><dt>Prochaine case</dt><dd data-prochaine>-</dd></div>
            <div><dt>Jour de paie</dt><dd data-paie>-</dd></div>
          </dl>
        </section>
        <section class="ds-bloc ds-carte-zone" aria-labelledby="ds-carte-titre" data-carte></section>
      </div>
      <section class="ds-panneau" aria-labelledby="ds-tour-titre" aria-live="polite" data-panneau></section>
    </div>
    <aside class="ds-colonne-cote" aria-label="Fiche, classement, journal et chat">
      <section class="ds-bloc ds-fiche" aria-labelledby="ds-fiche-titre" data-fiche></section>
      <section class="ds-bloc" aria-labelledby="ds-classement-titre" data-classement></section>
      <section class="ds-bloc" aria-labelledby="ds-journal-titre">
        <h2 id="ds-journal-titre" class="ds-bloc-titre">Journal</h2>
        <div data-journal></div>
      </section>
      <div class="ds-chat-zone" data-chat></div>
    </aside>
  </div>
  <div class="ds-tiroir-chat" data-tiroir-chat></div>
  <p class="visually-hidden" aria-live="polite" data-annonce></p>`;
}

/**
 * Monte la table de Destins dans root.
 * @param {HTMLElement} root conteneur de l'écran.
 * @param {{code: string, naviguer: Function, moi: object|null, suivi: object, contenus: object}} ctx
 * @returns {{ maj: (etat: object) => void, message: (msg: object) => void, detruire: () => void }}
 */
export function creer(root, ctx) {
  const { code, suivi } = ctx;
  const contenus = ctx.contenus || {};
  const grand = window.matchMedia(ECRAN_GRAND);

  const el = document.createElement('section');
  el.className = 'ds-table';
  el.innerHTML = squelette();
  root.append(el);

  const q = (s) => el.querySelector(s);
  const refs = {
    bandeau: q('[data-bandeau]'), code: q('[data-code]'), elimine: q('[data-elimine]'), quitter: q('[data-quitter]'),
    plan: q('[data-plan]'), roue: q('[data-roue]'), roueVal: q('[data-roue-val]'), roueTexte: q('[data-roue-texte]'),
    prochaine: q('[data-prochaine]'), paie: q('[data-paie]'), carte: q('[data-carte]'), panneau: q('[data-panneau]'),
    fiche: q('[data-fiche]'), classement: q('[data-classement]'), journal: q('[data-journal]'),
    chatZone: q('[data-chat]'), tiroirChatZone: q('[data-tiroir-chat]'), annonce: q('[data-annonce]'),
  };
  refs.code.textContent = `Code ${code}`;

  let etat = null;
  let occupe = false;
  let arretChrono = null;
  let imageFond = null;                    // URL de l'image du chemin, si elle existe
  const cles = {};                         // clé du dernier rendu de chaque zone
  let choixAssur = { habitation: false, auto: false };   // cases de l'assurance (gardées entre deux rendus)
  let tourneLa = false;                    // animation de la roue en cours
  let dernierTour = null;                  // pour annoncer « À toi de jouer »

  /* ---------- Chat : colonne (ordinateur) ou tiroir (téléphone) ---------- */

  let chat = null;
  const messagesVus = [];
  function monterChat() {
    chat?.detruire();
    refs.chatZone.innerHTML = '';
    refs.tiroirChatZone.innerHTML = '';
    chat = grand.matches
      ? creerChat(refs.chatZone, { code, moi: ctx.moi })
      : tiroirChat(refs.tiroirChatZone, { code, moi: ctx.moi });
    messagesVus.forEach((m) => chat.message(m));
    if (etat) chat.maj(etat);
  }
  monterChat();
  const surEcran = () => monterChat();
  grand.addEventListener('change', surEcran);

  /* ---------- Outils de lecture ---------- */

  const monId = () => moiJoueur(etat)?.user_id ?? null;
  const moiEst = (uid) => !!uid && uid === monId();
  const pseudoDe = (uid) => (uid == null ? '' : (joueurDe(etat, uid)?.pseudo || '?'));
  const nom = (liste, id) => nomDe(contenus, liste, id);
  const jeu = () => etat?.jeu || {};
  const phase = () => jeu().phase;
  const monTour = () => !!monId() && jeu().actif === monId();
  const jeAiSorti = () => !!moiJoueur(etat)?.elimine;
  const peutAgir = () => !occupe && !jeAiSorti() && etat?.partie?.statut === 'en_cours';
  const acteurPseudo = () => pseudoDe(jeu().actif);
  /** Ma situation (état de mon joueur dans la partie), ou {} si je ne joue pas. */
  const monEtat = () => moiJoueur(etat)?.etat || {};
  /** Cases de moi et de chacun, avec le numéro de case (0 à 90). */
  const caseDe = (j) => Number(j?.etat?.case ?? 0);
  /** Nombre de cases avant le prochain jour de paie (serveur, sinon vide). */
  const paieDans = () => (jeu().prochaine_paie || {})[monId()];

  /* ---------- Rendu : bandeau et chrono ---------- */

  function rendreBandeau() {
    const titre = esc(contenus.nom || 'Destins');
    const sous = contenus.sous_titre ? esc(contenus.sous_titre) : '';
    const html = bandeauHtml(etat, { titre, sousTitre: sous });
    if (cles.bandeau === html) return;
    cles.bandeau = html;
    arretChrono?.();
    refs.bandeau.innerHTML = html;
    arretChrono = brancherChrono(refs.bandeau, suivi);
  }

  function rendreElimine() {
    const on = jeAiSorti();
    refs.elimine.hidden = !on;
    refs.elimine.textContent = on ? 'Tu es sorti du jeu : tu regardes la suite.' : '';
    refs.quitter.disabled = !moiJoueur(etat) || moiJoueur(etat)?.parti === true;
  }

  /* ---------- Rendu : chemin de vie ---------- */

  function rendrePlan() {
    const j = jeu();
    const pions = (etat.joueurs || []).filter((x) => !x.parti && x.etat).map((x) => ({
      couleur: couleurDe(x), initiale: initialesPseudo(x.pseudo), pseudo: x.pseudo || '?', nom: x.pseudo || '?',
      invite: !!x.invite, case: caseDe(x),
    }));
    const moi = monId() != null ? caseDe(moiJoueur(etat)) : null;
    const prochaine = moi == null ? null : (moi + 1) % NB_CASES;
    const opts = { image: imageFond, types: j.plateau || [], pions, prochaine, moi };
    const cle = JSON.stringify(opts);
    if (cles.plan === cle) return;
    cles.plan = cle;
    refs.plan.innerHTML = `<div class="ds-plan-tete"><span class="ds-tag">Tour ${esc(etat.partie?.nb_tours ?? 0)} · Chemin de vie</span></div>${plateauHtml(opts)}`;
  }

  /* ---------- Rendu : roue et prochaines cases ---------- */

  function rendreRoue() {
    const val = jeu().roue;
    const moi = monEtat();
    const cle = JSON.stringify([val, paieDans(), moi.case, jeu().roue2 ?? null]);
    if (cles.roue === cle) return;
    cles.roue = cle;
    refs.roueVal.textContent = val == null ? '-' : String(val);
    refs.roueTexte.innerHTML = val == null
      ? 'Tourne la roue pour avancer.'
      : `Tu as fait <strong>${esc(val)}</strong> : avance de ${esc(val)} case${val > 1 ? 's' : ''}.`;
    const suivante = monId() != null ? (moi.case ?? 0) + 1 : null;
    refs.prochaine.textContent = suivante == null ? '-' : (contenus.cases?.find((c) => c.id === jeu().plateau?.[suivante % NB_CASES])?.nom
      || `Case ${suivante % NB_CASES}`);
    refs.paie.textContent = paieDans() == null ? '-' : (paieDans() === 0 ? 'Ce tour-ci' : `dans ${paieDans()} case${paieDans() > 1 ? 's' : ''}`);
  }

  /* ---------- Rendu : carte Événement ---------- */

  function rendreCarte() {
    const c = jeu().carte;
    const cle = JSON.stringify(c || null);
    if (cles.carte === cle) return;
    cles.carte = cle;
    if (!c?.id) {
      refs.carte.innerHTML = '<h2 id="ds-carte-titre" class="ds-bloc-titre">Carte Événement</h2><p class="ds-note">Aucune carte tirée pour l\'instant.</p>';
      return;
    }
    const ev = (contenus.evenements || []).find((x) => x.id === c.id) || {};
    const pour = c.pour != null ? pseudoDe(c.pour) : '';
    const montant = ev.montant ? ` ${ev.montant < 0 ? 'Tu reçois' : 'Paie'} ${euros(Math.abs(ev.montant))}.` : '';
    refs.carte.innerHTML = `<div class="ds-carte">
        <div class="ds-carte-tete"><span class="ds-etiquette">Carte Événement</span><span class="ds-muet small">Case ${esc(c.case ?? '')}${pour ? ` · ${esc(pour)}` : ''}</span></div>
        <h2 id="ds-carte-titre" class="ds-carte-titre">${esc(ev.texte || 'Un événement.')}</h2>
        ${ev.effet ? `<p class="ds-carte-effet">${esc(ev.effet)}</p>` : ''}
        ${montant ? `<p class="ds-carte-effet">${esc(montant.trim())}</p>` : ''}
      </div>`;
  }

  /* ---------- Rendu : fiche, classement, journal ---------- */

  function rendreFiche() {
    const moi = moiJoueur(etat);
    const e = moi?.etat || {};
    const cle = JSON.stringify([moi?.pseudo, e, jeu().actif, monTour(), phase(), etat.partie?.statut, occupe]);
    if (cles.fiche === cle) return;
    cles.fiche = cle;
    if (!moi) { refs.fiche.innerHTML = '<h2 id="ds-fiche-titre" class="ds-bloc-titre">Ma fiche</h2><p class="ds-note">Tu ne joues pas dans cette partie.</p>'; return; }
    const maisons = (e.maisons || []).map((id) => nom('maisons', id)).join(', ') || 'aucune';
    const famille = `${e.marie ? 'Marié' : 'Célibataire'}, ${e.enfants || 0} enfant${(e.enfants || 0) > 1 ? 's' : ''}`;
    const assur = [e.assurance_habitation ? 'habitation' : '', e.assurance_auto ? 'auto' : ''].filter(Boolean).join(', ') || 'aucune';
    const prets = Number(e.prets) || 0;
    const peutRembourser = monTour() && prets > 0 && (Number(e.argent) || 0) >= SAISIE_MIN && peutAgir();
    refs.fiche.innerHTML = `
      <div class="ds-fiche-tete"><h2 id="ds-fiche-titre" class="ds-bloc-titre">Ma fiche</h2><span class="ds-argent">${esc(euros(e.argent))}</span></div>
      <dl class="ds-dl">
        <dt>Métier</dt><dd>${esc(e.metier ? nom('metiers', e.metier) : 'Sans métier')}</dd>
        <dt>Salaire</dt><dd>${esc(euros(e.salaire || 0))} par tour</dd>
        <dt>Famille</dt><dd>${esc(famille)}</dd>
        <dt>Maison</dt><dd>${esc(maisons)}</dd>
        <dt>Assurance</dt><dd>${esc(assur)}</dd>
        <dt>Prêts</dt><dd>${esc(prets)} (${esc(euros(prets * SAISIE_MIN))} à rendre)</dd>
      </dl>
      <div class="ds-pied"><button type="button" class="ds-btn" data-rembourser${peutRembourser ? '' : ' disabled'}>Rembourser un prêt</button></div>`;
  }

  function rendreClassement() {
    const fortunes = jeu().fortunes || {};
    const lignes = (etat.joueurs || []).filter((j) => !j.parti).map((j) => ({
      j, f: Number(fortunes[j.user_id]) || 0,
    })).sort((a, b) => b.f - a.f);
    const cle = JSON.stringify([lignes.map((l) => [l.j.user_id, l.f]), monId()]);
    if (cles.classement === cle) return;
    cles.classement = cle;
    refs.classement.innerHTML = `<h2 id="ds-classement-titre" class="ds-bloc-titre">Classement provisoire</h2>
      <ol class="ds-classement">${lignes.map((l) => `<li><strong style="color:${esc(couleurDe(l.j))}">${esc(l.j.pseudo || '?')}</strong>${l.j.invite ? ' <span class="ds-invite">invité</span>' : ''} · ${esc(euros(l.f))}${moiEst(l.j.user_id) ? ' (toi)' : ''}</li>`).join('') || '<li class="ds-vide">Pas encore de classement.</li>'}</ol>`;
  }

  function rendreJournal() {
    const html = journalHtml(etat.journal || [], etat);
    if (cles.journal === html) return;
    cles.journal = html;
    refs.journal.innerHTML = html;
  }

  /* ---------- Rendu : panneau d'action ---------- */

  /** Liste de cartes cliquables (métier, maison, voie…). */
  const cartes = (items, attrs) => items.map((it) => `<button type="button" class="ds-carte-choix" ${attrs(it)}>${it.html}</button>`).join('');

  function vueDepart() {
    const voies = (contenus.voies || []).filter((v) => ['universite', 'carriere'].includes(v.id));
    return `<h2 id="ds-tour-titre" class="ds-titre" tabindex="-1">Ton départ</h2>
      <p>Choisis ta voie : études ou travail.</p>
      <div class="ds-choix" role="group" aria-label="Voies de départ">${cartes(voies.map((v) => ({ ...v, html: `<strong>${esc(v.nom)}</strong><span>${esc(v.texte || '')}</span>` })), (v) => `data-voie="${esc(v.id)}"`)}</div>`;
  }

  function vueMetier() {
    const ids = jeu().choix?.metiers || [];
    const items = ids.map((id) => {
      const m = (contenus.metiers || []).find((x) => x.id === id) || { id, nom: id };
      return { id, html: `<strong>${esc(m.nom)}</strong><span>${esc(m.diplome ? `Diplôme : ${m.diplome}` : 'Sans diplôme')}</span><span>${esc(euros(m.salaire))} par tour</span>` };
    });
    return `<h2 id="ds-tour-titre" class="ds-titre" tabindex="-1">Choisis ton métier</h2>
      <div class="ds-choix" role="group" aria-label="Métiers proposés">${cartes(items, (it) => `data-metier="${esc(it.id)}"`)}</div>`;
  }

  function vueAchat() {
    const ids = jeu().choix?.maisons || [];
    const items = ids.map((id) => {
      const m = (contenus.maisons || []).find((x) => x.id === id) || { id, nom: id, prix: 0, vente: 0 };
      return { id, html: `<strong>${esc(m.nom)}</strong><span>Prix ${esc(euros(m.prix))}</span><span>Revente ${esc(euros(m.vente))}</span>` };
    });
    return `<h2 id="ds-tour-titre" class="ds-titre" tabindex="-1">Acheter une maison ?</h2>
      <p>Tu peux acheter une maison, ou passer.</p>
      <div class="ds-choix" role="group" aria-label="Maisons à vendre">${cartes(items, (it) => `data-maison="${esc(it.id)}"`)}</div>
      <div class="ds-pied"><button type="button" class="ds-btn ds-btn-ghost" data-passer>Passer</button></div>`;
  }

  function vueAssurance() {
    return `<h2 id="ds-tour-titre" class="ds-titre" tabindex="-1">Assurances</h2>
      <p>Sans assurance, un coup dur coûte cher. Une assurance coûte une fois pour toutes.</p>
      <form class="ds-form-assur" data-form-assur>
        <label class="ds-coche"><input type="checkbox" name="habitation" ${choixAssur.habitation ? 'checked' : ''}> Assurance habitation (${esc(euros(ASSURANCE.habitation))})</label>
        <label class="ds-coche"><input type="checkbox" name="auto" ${choixAssur.auto ? 'checked' : ''}> Assurance auto (${esc(euros(ASSURANCE.auto))})</label>
        <div class="ds-pied"><button type="submit" class="ds-btn ds-btn-primary">Valider</button></div>
      </form>`;
  }

  function vueVoie2() {
    const ids = jeu().choix?.voies || [];
    const items = ids.map((id) => {
      const v = (contenus.voies || []).find((x) => x.id === id) || { id, nom: id, texte: '' };
      return { id, html: `<strong>${esc(v.nom)}</strong><span>${esc(v.texte || '')}</span>` };
    });
    return `<h2 id="ds-tour-titre" class="ds-titre" tabindex="-1">Prends le chemin</h2>
      <div class="ds-choix" role="group" aria-label="Chemins possibles">${cartes(items, (it) => `data-voie2="${esc(it.id)}"`)}</div>`;
  }

  function vueCible() {
    const cibles = (etat.joueurs || []).filter((x) => !x.parti && !x.elimine && x.user_id !== monId());
    const items = cibles.map((x) => ({ id: x.user_id, html: `<strong style="color:${esc(couleurDe(x))}">${esc(x.pseudo || '?')}</strong><span>${esc(euros(x.etat?.argent))}</span>` }));
    return `<h2 id="ds-tour-titre" class="ds-titre" tabindex="-1">Procès : choisis une cible</h2>
      <p>Qui vises-tu ? Le procès coûte cher à celui qui le perd.</p>
      <div class="ds-choix" role="group" aria-label="Joueurs ciblés">${cartes(items, (it) => `data-cible="${esc(it.id)}"`)}</div>`;
  }

  function vueRetraite() {
    const ids = jeu().choix?.voies || [];
    const items = ids.map((id) => {
      const v = (contenus.voies || []).find((x) => x.id === id) || { id, nom: id === 'domaine' ? 'Domaine des millionnaires' : 'Maison de retraite', texte: '' };
      return { id, html: `<strong>${esc(v.nom)}</strong><span>${esc(v.texte || '')}</span>` };
    });
    return `<h2 id="ds-tour-titre" class="ds-titre" tabindex="-1">Où prends-tu ta retraite ?</h2>
      <div class="ds-choix" role="group" aria-label="Lieux de retraite">${cartes(items, (it) => `data-retraite="${esc(it.id)}"`)}</div>`;
  }

  function vueTourner() {
    return `<h2 id="ds-tour-titre" class="ds-titre" tabindex="-1">Ton tour</h2>
      <p>Tourne la roue et avance sur le chemin de vie.</p>
      <div class="ds-pied"><button type="button" class="ds-btn ds-btn-primary ds-grand" data-tourner${peutAgir() ? '' : ' disabled'}>Tourner la roue</button></div>`;
  }

  /** Contenu du panneau selon la phase et mon rôle. */
  function contenuPanneau() {
    if (jeAiSorti()) return `<h2 id="ds-tour-titre" class="ds-titre" tabindex="-1">Tu regardes la suite</h2>`;
    if (!monId()) return `<h2 id="ds-tour-titre" class="ds-titre" tabindex="-1">La partie continue</h2><p>${esc(acteurPseudo())} joue.</p>`;
    if (phase() === 'fin' || etat.partie?.statut !== 'en_cours') return `<h2 id="ds-tour-titre" class="ds-titre" tabindex="-1">Partie terminée</h2>`;
    if (!monTour()) {
      return `<h2 id="ds-tour-titre" class="ds-titre" tabindex="-1">C'est à ${esc(acteurPseudo())} de jouer</h2>
        <p>${esc(acteurPseudo())} est sur le chemin.</p>`;
    }
    switch (phase()) {
      case 'depart': return vueDepart();
      case 'metier': return vueMetier();
      case 'tourner': return vueTourner();
      case 'achat': return vueAchat();
      case 'assurance': return vueAssurance();
      case 'voie': return vueVoie2();
      case 'cible': return vueCible();
      case 'retraite': return vueRetraite();
      default: return `<h2 id="ds-tour-titre" class="ds-titre" tabindex="-1">Ton tour</h2><p>Attends la suite de la partie.</p>`;
    }
  }

  /** Redessine le panneau si son contenu a changé (pas pendant un envoi, sauf forcé). */
  function rendrePanneau(force = false) {
    if (occupe && !force) return;
    const cle = JSON.stringify([phase(), jeu().actif, monId(), monTour(), jeAiSorti(), etat?.partie?.statut,
      jeu().choix, jeu().roue, choixAssur, !!peutAgir()]);
    if (!force && cles.panneau === cle) return;
    cles.panneau = cle;
    refs.panneau.innerHTML = contenuPanneau();
  }

  /* ---------- Rendu : carte Événement, roue animée ---------- */

  /** Fait tourner la roue le temps de l'animation (1,5 s), puis la montre. */
  function animerRoue() {
    tourneLa = true;
    refs.roue.classList.remove('is-tourne');
    void refs.roue.offsetWidth;
    refs.roue.classList.add('is-tourne');
    setTimeout(() => { tourneLa = false; refs.roue.classList.remove('is-tourne'); }, 1500);
  }

  /* ---------- Actions ---------- */

  /** Envoie une action de jeu : un seul envoi à la fois, boutons désactivés, puis relecture. */
  function agir(bouton, action, args = {}) {
    if (occupe) return;
    occupe = true;
    envoyer(bouton, async () => {
      try {
        await plat.agir(code, action, args);
      } catch (e) {
        toast(erreurTexte(e), 'error');
      } finally {
        occupe = false;
        cles.panneau = null;
        cles.fiche = null;
        rendrePanneau(true);
        rendreFiche();
        suivi.rafraichir();
      }
    }, suivi);
  }

  /** Clics du panneau d'action (un bouton = une intention envoyée au serveur). */
  function surPanneau(ev) {
    const b = ev.target.closest('button');
    if (!b || b.disabled) return;
    if (b.hasAttribute('data-voie')) return agir(b, 'voie', { voie: b.dataset.voie });
    if (b.hasAttribute('data-voie2')) return agir(b, 'voie', { voie: b.dataset.voie2 });
    if (b.hasAttribute('data-metier')) return agir(b, 'metier', { metier: b.dataset.metier });
    if (b.hasAttribute('data-maison')) return agir(b, 'acheter', { maison: b.dataset.maison });
    if (b.hasAttribute('data-passer')) return agir(b, 'acheter', {});
    if (b.hasAttribute('data-cible')) return agir(b, 'cible', { cible: b.dataset.cible });
    if (b.hasAttribute('data-retraite')) return agir(b, 'retraite', { lieu: b.dataset.retraite });
    if (b.hasAttribute('data-tourner')) {
      if (!peutAgir()) return;
      animerRoue();
      return agir(b, 'tourner');
    }
  }

  /** Validation de l'assurance. */
  function surSubmitPanneau(ev) {
    ev.preventDefault();
    const f = ev.target;
    if (!f.hasAttribute('data-form-assur') || occupe) return;
    return agir(ev.submitter || f.querySelector('button[type=submit]'), 'assurer', {
      habitation: !!choixAssur.habitation, auto: !!choixAssur.auto,
    });
  }

  /** Cases de l'assurance : on garde le choix sans relancer le rendu. */
  function surCoche(ev) {
    const c = ev.target;
    if (c.name in choixAssur) choixAssur[c.name] = c.checked;
  }

  /** Clics de la fiche : rembourser un prêt. */
  function surFiche(ev) {
    const b = ev.target.closest('button[data-rembourser]');
    if (!b || b.disabled || occupe) return;
    agir(b, 'rembourser');
  }

  function surQuitter(ev) {
    if (occupe) return;
    if (!confirm('Quitter la partie ? Tu ne pourras plus jouer dans cette manche.')) return;
    envoyer(ev.currentTarget, () => plat.quitter(code), suivi);
  }

  /* ---------- Écouteurs ---------- */

  refs.panneau.addEventListener('click', surPanneau);
  refs.panneau.addEventListener('submit', surSubmitPanneau);
  refs.panneau.addEventListener('change', surCoche);
  refs.fiche.addEventListener('click', surFiche);
  refs.quitter.addEventListener('click', surQuitter);

  // Image du chemin si elle existe (sinon, le dessin de repli).
  const urlImage = imagePlateau('destins', 'plateau');
  imageExiste(urlImage).then((ok) => {
    if (!ok) return;
    imageFond = urlImage;
    cles.plan = null;
    if (etat) rendrePlan();
  });

  /* ---------- Contrat de la vue ---------- */

  return {
    /** Nouvel état de la partie (appelé à chaque changement de version). */
    maj(e) {
      if (!e?.partie) return;
      etat = e;
      rendreBandeau();
      rendreElimine();
      rendrePlan();
      rendreRoue();
      rendreCarte();
      rendrePanneau();
      rendreFiche();
      rendreClassement();
      rendreJournal();
      const tour = jeu().actif ?? null;
      if (tour !== dernierTour) {
        if (monTour()) refs.annonce.textContent = 'À toi de jouer.';
        dernierTour = tour;
      }
      chat.maj(e);
    },
    /** Message du chat (ancien ou nouveau). */
    message(msg) {
      messagesVus.push(msg);
      if (messagesVus.length > 200) messagesVus.shift();
      chat.message(msg);
    },
    /** Arrête le chrono, retire le chat et la table de la page. */
    detruire() {
      arretChrono?.();
      grand.removeEventListener('change', surEcran);
      chat?.detruire();
      el.remove();
    },
  };
}
