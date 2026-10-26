// ===== Humane Gang — Shadow Hunters : la table de jeu (plateaux/jeux/shadow/table.js) =====
/*
 * Rôle : affiche une partie de Shadow Hunters en cours (règles officielles : dés d6 et d4, 7 = au choix).
 *   Colonne gauche : mon personnage (carte, révéler, PV), pioches, mes équipements.
 *   Centre : panneau « Ton tour » selon la phase, plan des 3 groupes de lieux, piste des blessures.
 *   Droite : joueurs (camps, PV, équipements), journal, chat (en tiroir sur téléphone).
 *   Une carte Vision reçue s'affiche dans une fenêtre (maquette OmbresVisionTel).
 *   La mise en page est dans assets/css/plateaux/shadow.css ; les dessins dans ./plateau.js.
 *   Chaque zone n'est reconstruite que si son HTML change (le focus et les listes restent en place).
 * Dépendances : core.js (esc, initials, toast), ../../api.js (plat, erreurTexte, nomDe, imageExiste),
 *   ../../vues/commun.js (avatarHtml, pseudoHtml, bandeauHtml, brancherChrono, journalHtml, imagePlateau,
 *   envoyer, moiJoueur, joueurDe), ../../vues/chat.js (creerChat, tiroirChat), ./plateau.js.
 * Exporte : creer(root, ctx) -> { maj(etat), message(msg), detruire() }.
 *   ctx = { code, naviguer, moi, suivi, contenus } ; suivi = retour de suivrePartie.
 */
import { esc } from '../../../core.js';
import { plat, nomDe, imageExiste } from '../../api.js';
import { avatarHtml, pseudoHtml, bandeauHtml, brancherChrono, journalHtml, imagePlateau, envoyer, moiJoueur, joueurDe } from '../../vues/commun.js';
import { creerChat, tiroirChat } from '../../vues/chat.js';
import { LIEUX, GROUPES, PV_MAX, CAMP_LIBELLE, campDe, voisinsDe, plateauHtml, pisteHtml, persoVisuelHtml } from './plateau.js';

const ECRAN_GRAND = '(min-width: 761px)';
const ICONE_QUITTER = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H5v16h4M14 8l4 4-4 4M18 12H9"></path></svg>';
/** Cartes à utiliser ou non (règle : choix oui / non). */
const CARTE_UTILISER = ['avenement', 'chocolat', 'rituel'];
/** Cartes qui visent un joueur et un équipement. */
const CARTE_EQUIPEMENT = ['gobelin', 'gobelin2', 'banane'];
/** Pouvoirs qui visent un joueur, ou non. */
const POUVOIR_CIBLE = ['franklin', 'georges'];
const POUVOIR_SANS_CIBLE = ['allie'];
const MITRAILLEUSE = 'T:mitrailleuse';
/** Préfixe de carte → liste des contenus. */
const LISTE_CARTE = { V: 'vision', L: 'lumiere', T: 'tenebres' };
/** Libellé du bouton d'un lieu où l'action est une pioche automatique. */
const ACTION_LIEU = { ermite: 'Piocher une carte Vision', monastere: 'Piocher une carte Lumière', cimetiere: 'Piocher une carte Ténèbres' };
const OEIL = '<svg viewBox="0 0 354 104" preserveAspectRatio="xMidYMid slice" focusable="false" aria-hidden="true"><defs><radialGradient id="sh-glow-vision" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#9FD8A8" stop-opacity=".5"/><stop offset="1" stop-color="#9FD8A8" stop-opacity="0"/></radialGradient></defs><circle cx="177" cy="52" r="90" fill="url(#sh-glow-vision)"/><path d="M70 52 Q177 6 284 52 Q177 98 70 52 Z" fill="#163A22" stroke="#9FD8A8" stroke-width="2"/><circle cx="177" cy="52" r="20" fill="#3F8A52" stroke="#D8F2DE" stroke-width="2"/><circle cx="177" cy="52" r="7" fill="#0A1A10"/></svg>';

const plur = (n, mot) => `${n} ${mot}${n > 1 ? 's' : ''}`;
const typeCarte = (c) => String(c || '').split(':')[0];
const idCarte = (c) => String(c || '').slice(2);

/** Gabarit statique : les zones variables sont remplies à chaque mise à jour. */
function squelette() {
  return `
  <header class="sh-bandeau" data-bandeau></header>
  <div class="sh-barre">
    <p class="sh-composition" data-composition></p>
    <button type="button" class="sh-btn sh-btn-ghost sh-quitter" data-quitter>${ICONE_QUITTER}<span>Quitter la partie</span></button>
  </div>
  <p class="sh-elimine" data-elimine hidden></p>

  <div class="sh-corps">
    <aside class="sh-colonne sh-gauche" aria-label="Ton personnage et les pioches">
      <section class="sh-bloc sh-perso" aria-labelledby="sh-perso-titre" data-perso></section>
      <section class="sh-bloc" aria-labelledby="sh-pioches-titre" data-pioches></section>
      <section class="sh-bloc" aria-labelledby="sh-mes-titre" data-mes-equip></section>
    </aside>
    <section class="sh-colonne sh-centre" aria-label="Le jeu">
      <section class="sh-panneau" aria-labelledby="sh-tour-titre" aria-live="polite" data-panneau></section>
      <section class="sh-plateau-zone" aria-label="Les lieux" data-plateau></section>
      <section class="sh-bloc" aria-labelledby="sh-piste-titre">
        <div class="sh-piste-tete">
          <h2 id="sh-piste-titre" class="sh-bloc-titre">Blessures et points de vie</h2>
          <p class="sh-legende">Pion plein : blessures. Anneau : PV maximum d'un personnage révélé.</p>
        </div>
        <div class="sh-piste-defile" data-piste></div>
      </section>
    </section>
    <aside class="sh-colonne sh-droite" aria-label="Joueurs, journal et chat">
      <section class="sh-bloc" aria-labelledby="sh-joueurs-titre">
        <h2 id="sh-joueurs-titre" class="sh-bloc-titre">Joueurs</h2>
        <ul class="sh-joueurs" data-joueurs></ul>
      </section>
      <section class="sh-bloc" aria-labelledby="sh-journal-titre">
        <h2 id="sh-journal-titre" class="sh-bloc-titre">Journal</h2>
        <div data-journal></div>
      </section>
      <div class="sh-chat-zone" data-chat></div>
    </aside>
  </div>
  <div class="sh-tiroir-chat" data-tiroir-chat></div>

  <div class="sh-modale" data-modale hidden>
    <div class="sh-modale-fond" aria-hidden="true"></div>
    <section class="sh-modale-boite" role="dialog" aria-modal="true" aria-labelledby="sh-vision-titre" data-modale-boite></section>
  </div>
  <p class="visually-hidden" aria-live="polite" data-annonce></p>`;
}

/**
 * Monte la table de Shadow Hunters dans root.
 * @param {HTMLElement} root conteneur de l'écran.
 * @param {{code: string, naviguer: Function, moi: object|null, suivi: object, contenus: object}} ctx
 * @returns {{ maj: (etat: object) => void, message: (msg: object) => void, detruire: () => void }}
 */
export function creer(root, ctx) {
  const { code, suivi } = ctx;
  const contenus = ctx.contenus || {};
  const grand = window.matchMedia(ECRAN_GRAND);

  const el = document.createElement('section');
  el.className = 'sh-table';
  el.innerHTML = squelette();
  root.append(el);

  const q = (s) => el.querySelector(s);
  const refs = {
    bandeau: q('[data-bandeau]'), composition: q('[data-composition]'), quitter: q('[data-quitter]'), elimine: q('[data-elimine]'),
    perso: q('[data-perso]'), pioches: q('[data-pioches]'), mesEquip: q('[data-mes-equip]'),
    panneau: q('[data-panneau]'), plateau: q('[data-plateau]'), piste: q('[data-piste]'),
    joueurs: q('[data-joueurs]'), journal: q('[data-journal]'), chatZone: q('[data-chat]'), tiroirZone: q('[data-tiroir-chat]'),
    modale: q('[data-modale]'), modaleBoite: q('[data-modale-boite]'), annonce: q('[data-annonce]'),
  };

  let etat = null;
  let occupe = false;
  let arretChrono = null;
  let chat = null;
  let modaleOuverte = false;
  const messagesVus = [];
  const cles = {};                                         // HTML déjà posé dans chaque zone
  const saisie = { cible: '', equip: '', mode: 'blesser', lieu: '' };   // choix gardés entre deux rendus
  const imagesLieux = {};                                  // lieu -> URL du visuel (s'il existe)
  const imagesPerso = {};                                  // personnage -> URL du visuel (s'il existe)
  const persoTeste = new Set();
  const lieuxMap = Object.fromEntries((contenus.lieux || []).map((l) => [l.id, l]));

  /* ---------- Chat : colonne (ordinateur) ou tiroir (téléphone) ---------- */

  function monterChat() {
    chat?.detruire();
    refs.chatZone.innerHTML = '';
    refs.tiroirZone.innerHTML = '';
    chat = grand.matches
      ? creerChat(refs.chatZone, { code, moi: ctx.moi })
      : tiroirChat(refs.tiroirZone, { code, moi: ctx.moi });
    messagesVus.forEach((m) => chat.message(m));
    if (etat) chat.maj(etat);
  }
  monterChat();
  const surEcran = () => monterChat();
  grand.addEventListener('change', surEcran);

  /* ---------- Images (facultatives : sinon le dessin de la maquette) ---------- */

  for (const id of Object.keys(LIEUX)) {
    const url = imagePlateau('shadow', id);
    imageExiste(url).then((ok) => {
      if (!ok) return;
      imagesLieux[id] = url;
      cles.plateau = null;
      if (etat) rendrePlateau();
    });
  }
  function verifierImagePerso(perso) {
    if (!perso || persoTeste.has(perso)) return;
    persoTeste.add(perso);
    const url = imagePlateau('shadow', `perso-${perso}`);
    imageExiste(url).then((ok) => {
      if (!ok) return;
      imagesPerso[perso] = url;
      cles.perso = null;
      if (etat) rendrePerso();
    });
  }

  /* ---------- Lecture de l'état ---------- */

  const monId = () => moiJoueur(etat)?.user_id ?? null;
  const moiEtat = () => moiJoueur(etat)?.etat || {};
  const moiPerso = () => jeu().moi?.perso || moiEtat().perso || null;
  const jeu = () => etat?.jeu || {};
  const phase = () => jeu().phase || '';
  const partieEnCours = () => etat?.partie?.statut === 'en_cours';
  const jeAiSorti = () => !!moiJoueur(etat)?.elimine;
  const monTour = () => !!monId() && etat?.partie?.tour === monId() && partieEnCours();
  const pseudoDe = (uid) => (uid == null ? '' : (joueurDe(etat, uid)?.pseudo || '?'));
  const acteur = () => pseudoDe(etat?.partie?.tour || jeu().actif);
  const etatDe = (uid) => joueurDe(etat, uid)?.etat || {};
  const vivants = () => (etat?.joueurs || []).filter((j) => !j.parti && !j.elimine);
  const autresVivants = () => vivants().filter((j) => j.user_id !== monId());
  const equipDe = (uid) => (uid ? (etatDe(uid).equip || []) : []);
  const aMitrailleuse = () => equipDe(monId()).includes(MITRAILLEUSE);
  const zones = () => jeu().zones || GROUPES;
  const nomPerso = (id) => nomDe(contenus, 'personnages', id);
  const persoInfo = (id) => (contenus.personnages || []).find((p) => p.id === id) || {};
  const nomLieu = (id) => nomDe(contenus, 'lieux', id);
  const carteItem = (c) => (contenus[LISTE_CARTE[typeCarte(c)]] || []).find((x) => x.id === idCarte(c)) || null;
  const carteNom = (c) => carteItem(c)?.nom || idCarte(c);
  const optionsJoueurs = (liste) => liste.map((j) => ({ value: j.user_id, label: `${j.pseudo || '?'}${j.invite ? ' (invité)' : ''}` }));
  const champ = (nom) => {
    const f = el.querySelector(`[name="${nom}"]`);
    return f ? f.value : (saisie[nom] ?? '');
  };
  const modeChoisi = () => el.querySelector('input[name="mode"]:checked')?.value || saisie.mode;

  /* ---------- Outils de rendu ---------- */

  /** Pose le HTML d'une zone si il a changé. Renvoie vrai si la zone a été reconstruite. */
  function poser(cle, zone, html) {
    if (!zone || cles[cle] === html) return false;
    cles[cle] = html;
    zone.innerHTML = html;
    return true;
  }
  const titre = (t) => `<h2 id="sh-tour-titre" class="sh-titre" tabindex="-1">${esc(t)}</h2>`;
  const vueAttente = (t) => `${titre(`C'est à ${acteur()} de jouer`)}<p>${esc(t)}</p>`;
  const noteDes = () => {
    const d = jeu().des;
    if (!d) return '';
    return `<p class="sh-note">Dés : ${esc(d.d6)} (dé 6) et ${esc(d.d4)} (dé 4), soit ${esc((d.d6 ?? 0) + (d.d4 ?? 0))}.</p>`;
  };

  /** Liste déroulante ; garde la valeur choisie si elle existe encore. */
  function champSelect(nom, libelle, options, valeur = '') {
    const voulue = options.some((o) => o.value === valeur) ? valeur : (options[0]?.value ?? '');
    saisie[nom] = voulue;
    return `<div class="sh-champ"><label for="sh-${nom}-${esc(code)}">${esc(libelle)}</label>
      <select id="sh-${nom}-${esc(code)}" name="${nom}" class="sh-select">${options.map((o) =>
        `<option value="${esc(o.value)}"${o.value === voulue ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`;
  }

  /** Options d'équipement de uid (optionnel : « Aucun » en tête). */
  function optionsEquip(uid, optionnel, valeur) {
    const liste = equipDe(uid).map((c) => ({ value: c, label: carteNom(c) }));
    const tous = optionnel ? [{ value: '', label: 'Aucun' }, ...liste] : liste;
    const v = tous.some((o) => o.value === valeur) ? valeur : (tous[0]?.value ?? '');
    return { html: tous.map((o) => `<option value="${esc(o.value)}"${o.value === v ? ' selected' : ''}>${esc(o.label)}</option>`).join(''), valeur: v };
  }
  /** Liste des équipements : source 'cible' (équipement du joueur visé) ou 'moi' (le mien). */
  function champEquip(libelle, source, optionnel = false) {
    const uid = source === 'cible' ? saisie.cible : monId();
    const { html, valeur } = optionsEquip(uid, optionnel, saisie.equip);
    saisie.equip = valeur;
    return `<div class="sh-champ"><label for="sh-equip-${esc(code)}">${esc(libelle)}</label>
      <select id="sh-equip-${esc(code)}" name="equip" class="sh-select" data-source="${source}"${optionnel ? ' data-optionnel="1"' : ''}>${html}</select></div>`;
  }
  /** Quand le joueur visé change : la liste d'équipements suit. */
  function majEquip() {
    const sel = el.querySelector('select[name="equip"]');
    if (!sel) return;
    const uid = sel.dataset.source === 'cible' ? champ('cible') : monId();
    const { html, valeur } = optionsEquip(uid, sel.dataset.optionnel === '1', '');
    sel.innerHTML = html;
    sel.value = valeur;
    saisie.equip = valeur;
  }

  /* ---------- Panneau « Ton tour » ---------- */

  function vueDebut() {
    const mon = moiEtat();
    const perso = moiPerso();
    const pouvoirOk = !!mon.revele && !mon.pouvoir;
    let h = titre('Ton tour') + '<p>Tu peux utiliser ton personnage avant de lancer les dés.</p>';
    if (!mon.revele) h += '<p class="sh-note">Tu n\'as pas encore révélé ton personnage (bouton sous ta carte).</p>';
    if (pouvoirOk && POUVOIR_CIBLE.includes(perso)) {
      const cibles = optionsJoueurs(autresVivants());
      h += `<div class="sh-ligne">${champSelect('cible', 'Joueur visé', cibles, saisie.cible)}
        <button type="button" class="sh-btn" data-act="pouvoir"${cibles.length ? '' : ' disabled'}>Utiliser le pouvoir</button></div>`;
    }
    if (pouvoirOk && POUVOIR_SANS_CIBLE.includes(perso)) {
      h += '<div class="sh-ligne"><button type="button" class="sh-btn" data-act="pouvoir" data-sans-cible>Utiliser le pouvoir</button></div>';
    }
    if (mon.revele && perso === 'emi' && mon.lieu) {
      const voisins = voisinsDe(mon.lieu, zones());
      h += `<div class="sh-ligne"><span class="sh-label">Téléporter vers</span>${voisins.map((l) =>
        `<button type="button" class="sh-btn" data-act="teleporter" data-lieu="${esc(l)}">${esc(nomLieu(l))}</button>`).join('')}</div>`;
    }
    h += '<div class="sh-pied"><button type="button" class="sh-btn sh-btn-primary" data-act="lancer">Lancer les dés</button></div>';
    return h;
  }
  function vueChoisirZone() {
    const opts = jeu().options || [];
    const choix = opts.includes(saisie.lieu) ? saisie.lieu : (opts[0] || '');
    saisie.lieu = choix;
    const d = jeu().des;
    const total = d ? (d.d6 ?? 0) + (d.d4 ?? 0) : null;
    let h = titre('Où vas-tu ?') + `<p>${total != null ? `Tu as fait ${esc(total)}. ` : ''}Choisis un lieu parmi ceux proposés.</p>`;
    h += `<div class="sh-choix" role="group" aria-label="Lieux possibles">${opts.map((l) =>
      `<button type="button" class="sh-chip" aria-pressed="${l === choix ? 'true' : 'false'}" data-act="choisir-lieu" data-lieu="${esc(l)}">${esc(nomLieu(l))}</button>`).join('')}</div>`;
    h += `<div class="sh-pied"><button type="button" class="sh-btn sh-btn-primary" data-act="aller"${choix ? '' : ' disabled'}>${choix ? `Aller à ${esc(nomLieu(choix))}` : 'Choisis un lieu'}</button></div>`;
    return h;
  }

  function vueZone() {
    const lieu = moiEtat().lieu;
    const texte = lieuxMap[lieu]?.texte || '';
    let h = titre(lieu ? nomLieu(lieu) : 'Zone') + (texte ? `<p>${esc(texte)}</p>` : '');
    if (lieu === 'porte') {
      h += '<div class="sh-ligne">' + [['vision', 'Vision'], ['lumiere', 'Lumière'], ['tenebres', 'Ténèbres']].map(([k, l]) =>
        `<button type="button" class="sh-btn" data-act="zone" data-pioche="${k}">Piocher ${l}</button>`).join('') + '</div>';
    } else if (lieu === 'foret') {
      const mode = saisie.mode;
      h += `<div class="sh-ligne">${champSelect('cible', 'Joueur visé', optionsJoueurs(vivants()), saisie.cible)}</div>
        <fieldset class="sh-fieldset"><legend>Effet</legend>
          <label class="sh-radio"><input type="radio" name="mode" value="blesser"${mode === 'blesser' ? ' checked' : ''}> Blesser de 2</label>
          <label class="sh-radio"><input type="radio" name="mode" value="soigner"${mode === 'soigner' ? ' checked' : ''}> Soigner de 1</label>
        </fieldset>
        <div class="sh-pied"><button type="button" class="sh-btn sh-btn-primary" data-act="zone">Appliquer dans la forêt</button></div>`;
    } else if (lieu === 'sanctuaire') {
      const cibles = autresVivants().filter((j) => equipDe(j.user_id).length > 0);
      if (cibles.length) {
        h += `<div class="sh-ligne">${champSelect('cible', 'Joueur à voler', optionsJoueurs(cibles), saisie.cible)}${champEquip('Équipement volé', 'cible')}</div>
          <div class="sh-pied"><button type="button" class="sh-btn sh-btn-primary" data-act="zone">Voler cet équipement</button></div>`;
      } else {
        h += '<p class="sh-note">Personne n\'a d\'équipement à voler.</p>';
      }
    } else {
      h += `<div class="sh-pied"><button type="button" class="sh-btn sh-btn-primary" data-act="zone">${esc(ACTION_LIEU[lieu] || 'Utiliser ce lieu')}</button></div>`;
    }
    h += '<div class="sh-pied sh-pied-fin"><button type="button" class="sh-btn sh-btn-ghost" data-act="passer">Passer à l\'attaque</button>'
      + '<button type="button" class="sh-btn sh-btn-ghost" data-act="finir">Finir mon tour</button></div>';
    return h;
  }

  function vueDonner() {
    const main = jeu().moi?.vision_main || '';
    const cibles = autresVivants();
    let h = titre('Donne une carte Vision');
    if (!main) return h + '<p>Tu n\'as pas de carte Vision à donner.</p>';
    h += `<p>Tu as pioché : <strong>${esc(carteNom(main))}</strong>. ${esc(carteItem(main)?.texte || '')}</p>`;
    if (!cibles.length) return h + '<p>Personne d\'autre n\'est en vie.</p>';
    h += `<p class="sh-note">Choisis qui la reçoit. Cette personne la lit seule, puis répond.</p>
      <div class="sh-ligne">${champSelect('cible', 'Joueur visé', optionsJoueurs(cibles), saisie.cible)}</div>
      <div class="sh-pied"><button type="button" class="sh-btn sh-btn-primary" data-act="donner">Donner la carte</button></div>`;
    return h;
  }

  function vueCarte() {
    const c = jeu().carte || '';
    const id = idCarte(c);
    const item = carteItem(c);
    let h = titre(carteNom(c)) + (item?.texte ? `<p>${esc(item.texte)}</p>` : '');
    if (CARTE_UTILISER.includes(id)) {
      // Condition de la carte, connue de moi seul (mon personnage) : sans elle, seul « Ne pas l'utiliser » est proposé.
      const perso = jeu().moi?.perso;
      const camp = jeu().moi?.camp;
      const ok = (id === 'avenement' && camp === 'hunter') || (id === 'rituel' && camp === 'shadow')
        || (id === 'chocolat' && ['allie', 'emi', 'inconnu'].includes(perso));
      return h + `<div class="sh-pied">
        ${ok ? '<button type="button" class="sh-btn sh-btn-primary" data-act="carte" data-utiliser="true">Utiliser la carte</button>'
          : '<p class="sh-note">Tu ne remplis pas la condition de cette carte.</p>'}
        <button type="button" class="sh-btn sh-btn-ghost" data-act="carte" data-utiliser="false">Ne pas l'utiliser</button></div>`;
    }
    const equipement = CARTE_EQUIPEMENT.includes(id);
    let cibles;
    if (id === 'secours') cibles = vivants();
    else if (id.startsWith('gobelin')) cibles = autresVivants().filter((j) => equipDe(j.user_id).length > 0);
    else cibles = autresVivants();
    if (!cibles.length) return h + '<p>Personne ne peut subir cette carte.</p>';
    h += `<div class="sh-ligne">${champSelect('cible', 'Joueur visé', optionsJoueurs(cibles), saisie.cible)}`;
    let inutilisable = false;
    if (equipement) {
      const source = id === 'banane' ? 'moi' : 'cible';
      h += champEquip(source === 'cible' ? 'Équipement à voler' : 'Équipement à donner', source);
      inutilisable = (source === 'moi' ? equipDe(monId()) : equipDe(saisie.cible)).length === 0;
    }
    h += `</div><div class="sh-pied"><button type="button" class="sh-btn sh-btn-primary" data-act="carte"${inutilisable ? ' disabled' : ''}>Jouer la carte</button></div>`;
    return h;
  }

  function vueAttaque() {
    const portee = (jeu().moi?.portee || []).map((uid) => joueurDe(etat, uid)).filter(Boolean);
    const attaques = jeu().attaques ?? 0;
    let h = titre('Attaque') + noteDes();
    h += `<p class="sh-note">Attaques ce tour : ${esc(attaques)}.</p>`;
    if (portee.length) {
      h += `<div class="sh-ligne">${portee.map((j) =>
        `<button type="button" class="sh-btn" data-act="attaquer" data-cible="${esc(j.user_id)}">Attaquer ${esc(j.pseudo || '?')}</button>`).join('')}</div>`;
    } else {
      h += '<p>Personne n\'est à ta portée.</p>';
    }
    if (aMitrailleuse() && portee.length) {
      h += '<div class="sh-ligne"><button type="button" class="sh-btn" data-act="tirer">Tirer sans cible (mitrailleuse)</button></div>';
    }
    if (moiPerso() === 'charles' && moiEtat().revele && attaques > 0) {
      h += '<p class="sh-note">Charles : tu peux subir 2 Blessures pour attaquer encore.</p>';
    }
    h += '<div class="sh-pied"><button type="button" class="sh-btn sh-btn-ghost" data-act="finir">Finir mon tour</button></div>';
    return h;
  }

  /** Contenu du panneau selon la phase et mon rôle. */
  function corpsPanneau() {
    const j = jeu();
    if (jeAiSorti()) return titre('Tu regardes la suite') + '<p>Tu as été éliminé. Tu peux suivre la partie.</p>';
    if (!monId()) return vueAttente(`${acteur()} joue.`);
    if (phase() === 'vision') {
      if (monTour() && j.vision?.pour === monId()) return titre('Une carte Vision te concerne') + '<p>Réponds dans la fenêtre.</p>';
      return vueAttente(`${pseudoDe(etat?.partie?.tour)} répond à une carte Vision de ${pseudoDe(j.vision?.de)}.`);
    }
    if (!monTour()) return vueAttente(`${acteur()} joue.`) + noteDes();
    switch (phase()) {
      case 'debut': return vueDebut();
      case 'choisir_zone': return vueChoisirZone();
      case 'zone': return vueZone();
      case 'vision_donner': return vueDonner();
      case 'carte': return vueCarte();
      case 'attaque': return vueAttaque();
      default: return vueAttente(`${acteur()} joue.`);
    }
  }

  /** Clé de rendu du panneau : il n'est refait que si ce qu'il montre change (les choix en cours sont gardés). */
  function cleTour() {
    return JSON.stringify([
      phase(), etat?.partie?.tour, etat?.partie?.statut, monId(), jeAiSorti(), monTour(),
      jeu().des, jeu().options, jeu().carte, jeu().vision, jeu().attaques, jeu().moi, moiEtat(),
      (etat?.joueurs || []).map((j) => [j.user_id, j.elimine, j.parti, j.pseudo, j.etat?.lieu, (j.etat?.equip || []).length, j.etat?.revele]),
    ]);
  }
  function rendrePanneau(force = false) {
    if (occupe && !force) return;
    const cle = cleTour();
    if (!force && cles.panneau === cle) return;
    cles.panneau = cle;
    refs.panneau.innerHTML = corpsPanneau();
  }

  /* ---------- Personnage, pioches, mes équipements ---------- */

  function persoHtml() {
    const perso = moiPerso();
    if (!perso) return '<h2 id="sh-perso-titre" class="sh-bloc-titre">Ton personnage</h2><p class="sh-note">Tu regardes la partie.</p>';
    const mon = moiEtat();
    const camp = jeu().moi?.camp || campDe(perso);
    const info = persoInfo(perso);
    const max = PV_MAX[perso] ?? null;
    const pv = max != null ? Math.max(0, max - (mon.degats ?? 0)) : null;
    const pct = max ? Math.round((pv / max) * 100) : 0;
    const pouvoirPossible = POUVOIR_CIBLE.includes(perso) || POUVOIR_SANS_CIBLE.includes(perso);
    const peutReveler = !mon.revele && monTour();
    return `<h2 id="sh-perso-titre" class="sh-bloc-titre">Mon personnage</h2>
      <span class="sh-pastille">${mon.revele ? 'Révélé : tout le monde voit ton personnage' : 'Seulement visible par toi'}</span>
      <div class="sh-perso-visuel">${persoVisuelHtml(camp, imagesPerso[perso] || null)}</div>
      <div class="sh-perso-nom"><strong>${esc(nomPerso(perso))}</strong><span class="sh-camp is-${esc(camp || 'inconnu')}">${esc(CAMP_LIBELLE[camp] || 'Camp inconnu')}</span></div>
      ${info.victoire ? `<p class="sh-perso-texte"><span class="sh-label">Victoire</span> ${esc(info.victoire)}</p>` : ''}
      ${info.pouvoir ? `<p class="sh-perso-texte"><span class="sh-label">Pouvoir</span> ${esc(info.pouvoir)}${pouvoirPossible ? ` <em>${mon.pouvoir ? '(utilisé)' : '(disponible)'}</em>` : ''}</p>` : ''}
      <div class="sh-pv">
        <div class="sh-pv-tete"><span>Points de vie</span><strong>${pv ?? '?'} / ${max ?? '?'}</strong></div>
        <div class="sh-barre-pv" aria-hidden="true"><span style="width:${pct}%"></span></div>
      </div>
      <button type="button" class="sh-btn sh-btn-outline sh-pleine" data-revele${peutReveler ? '' : ' disabled'}>${mon.revele ? 'Personnage révélé' : 'Me révéler'}</button>
      ${!mon.revele && !monTour() ? '<p class="sh-note">Tu peux te révéler pendant ton tour.</p>' : ''}`;
  }

  function piochesHtml() {
    const p = jeu().pioches || {};
    const ligne = (cle, nom, n) => `<li class="sh-pioche is-${cle}"><span class="sh-dos" aria-hidden="true"></span><span>${esc(nom)} : ${esc(plur(n ?? 0, 'carte'))}</span></li>`;
    return `<h2 id="sh-pioches-titre" class="sh-bloc-titre">Pioches</h2><ul class="sh-pioches">${ligne('vision', 'Vision', p.vision)}${ligne('lumiere', 'Lumière', p.lumiere)}${ligne('tenebres', 'Ténèbres', p.tenebres)}</ul>`;
  }

  /** Liste d'équipements : nom, texte au clic (détails). */
  function equipementsHtml(cartes, qui) {
    if (!cartes.length) return '';
    return `<ul class="sh-equip" aria-label="Équipements de ${esc(qui || '?')}">${cartes.map((c) =>
      `<li><details class="sh-equip-item"><summary>${esc(carteNom(c))}</summary><p>${esc(carteItem(c)?.texte || '')}</p></details></li>`).join('')}</ul>`;
  }

  /* ---------- Joueurs, piste, plateau ---------- */

  function joueursHtml() {
    const moi = monId();
    const connus = jeu().moi?.connus || {};
    const pvMax = etat.pv || {};
    const tour = etat.partie?.tour;
    return (etat.joueurs || []).filter((j) => !j.parti).map((j) => {
      const s = j.etat || {};
      const estMoi = !!moi && j.user_id === moi;
      const estTour = !!tour && tour === j.user_id && partieEnCours();
      const connu = s.revele ? s.perso : (estMoi ? moiPerso() : null);
      const apprisPar = !s.revele && !estMoi && connus[j.user_id] ? connus[j.user_id] : null;
      let identite;
      if (connu) identite = `${nomPerso(connu)} · ${CAMP_LIBELLE[campDe(connu)] || 'Camp inconnu'}${s.revele ? '' : ' (caché)'}`;
      else if (apprisPar) identite = `Tu sais : ${nomPerso(apprisPar)} · ${CAMP_LIBELLE[campDe(apprisPar)] || ''}`;
      else identite = 'Camp inconnu';
      const deg = s.degats ?? 0;
      const max = s.revele ? (pvMax[j.user_id] ?? null) : (estMoi ? (jeu().moi?.pv ?? null) : null);
      const pvTxt = max != null ? `${Math.max(0, max - deg)} / ${max} PV` : plur(deg, 'blessure');
      const lieuTxt = j.elimine ? 'Éliminé' : (s.lieu ? `Lieu : ${nomLieu(s.lieu)}` : 'Pas encore entré');
      const etiquettes = [];
      if (estMoi) etiquettes.push('<span class="sh-etiquette">Toi</span>');
      if (estTour) etiquettes.push(`<span class="sh-etiquette is-tour">${estMoi ? 'À toi' : 'Son tour'}</span>`);
      if (j.elimine) etiquettes.push('<span class="sh-etiquette is-mort">Mort</span>');
      if (s.ange) etiquettes.push('<span class="sh-etiquette">Ange gardien</span>');
      if (j.absent) etiquettes.push('<span class="sh-etiquette">Absent</span>');
      return `<li class="sh-joueur${estTour ? ' is-tour' : ''}${j.elimine ? ' is-mort' : ''}${estMoi ? ' is-moi' : ''}"${estTour ? ' aria-current="true"' : ''}>
        ${avatarHtml(j, 36)}
        <div class="sh-joueur-corps">
          <div class="sh-joueur-tete">${j.elimine ? `<s>${pseudoHtml(j)}</s>` : pseudoHtml(j)} ${etiquettes.join(' ')}</div>
          <p class="sh-joueur-perso">${esc(identite)}</p>
          <p class="sh-joueur-lieu">${esc(lieuTxt)} · ${esc(pvTxt)}</p>
          ${estMoi ? '' : equipementsHtml(s.equip || [], j.pseudo)}
        </div>
      </li>`;
    }).join('');
  }

  /** Fenêtre « Vision » : seulement pour celui qui reçoit la carte. */
  function modaleHtml() {
    const j = jeu();
    if (!(phase() === 'vision' && monTour() && j.vision?.pour === monId() && !jeAiSorti())) return null;
    const carte = j.vision.carte || '';
    const item = carte ? carteItem(carte) : null;
    const perso = moiPerso();
    const peutMentir = perso === 'inconnu' && idCarte(carte) !== 'v16';
    const max = PV_MAX[perso] ?? null;
    const pv = max != null ? Math.max(0, max - (moiEtat().degats ?? 0)) : null;
    return `<p class="sh-pastille">Carte Vision · de ${esc(pseudoDe(j.vision.de))}</p>
      <div class="sh-vision-oeil">${OEIL}</div>
      <h2 id="sh-vision-titre" class="sh-titre" tabindex="-1">${esc(item?.nom || 'Vision')}</h2>
      <blockquote class="sh-vision-texte">${esc(item?.texte || 'Carte non reçue.')}</blockquote>
      <p class="sh-note">Toi seul vois cette carte. Réponds honnêtement : le jeu vérifie.${peutMentir ? ' En tant qu\'Inconnu, tu peux aussi mentir.' : ''}</p>
      <p class="sh-vision-pv">Tes points de vie : <strong>${pv ?? '?'} / ${max ?? '?'}</strong></p>
      <div class="sh-pied sh-pied-vision">
        <button type="button" class="sh-btn sh-btn-primary sh-btn-large" data-act="repondre" data-mentir="false">Appliquer</button>
        ${peutMentir ? '<button type="button" class="sh-btn sh-btn-ghost" data-act="repondre" data-mentir="true">Mentir</button>' : ''}
      </div>`;
  }

  /* ---------- Rendu des zones ---------- */

  function rendreBandeau() {
    const html = bandeauHtml(etat, { titre: contenus.nom || 'Shadow Hunters', sousTitre: `Code ${code}` });
    if (!poser('bandeau', refs.bandeau, html)) return;
    arretChrono?.();
    arretChrono = brancherChrono(refs.bandeau, suivi);
  }

  function rendreElimine() {
    const on = jeAiSorti();
    refs.elimine.hidden = !on;
    refs.elimine.textContent = on ? 'Tu as été éliminé : tu peux encore suivre la partie.' : '';
    refs.quitter.disabled = !moiJoueur(etat) || moiJoueur(etat)?.parti === true;
  }

  function rendreComposition() {
    const c = jeu().composition;
    const txt = c ? `Hunters ${c.hunter ?? 0} · Shadows ${c.shadow ?? 0} · Neutres ${c.neutre ?? 0}` : '';
    poser('composition', refs.composition, esc(txt));
  }

  function rendrePerso() {
    poser('perso', refs.perso, persoHtml());
  }

  function rendrePioches() {
    poser('pioches', refs.pioches, piochesHtml());
  }

  function rendreMesEquip() {
    const cartes = moiEtat().equip || [];
    poser('mesEquip', refs.mesEquip, `<h2 id="sh-mes-titre" class="sh-bloc-titre">Tes équipements</h2>${equipementsHtml(cartes, 'toi') || '<p class="sh-note">Aucun équipement.</p>'}`);
  }

  function rendrePlateau() {
    const options = phase() === 'choisir_zone' ? (jeu().options || []) : [];
    const html = plateauHtml({
      zones: jeu().zones,
      lieux: lieuxMap,
      joueurs: etat.joueurs || [],
      options,
      choix: options.includes(saisie.lieu) ? saisie.lieu : null,
      images: imagesLieux,
      moiId: monId(),
      tour: etat.partie?.tour,
    });
    poser('plateau', refs.plateau, html);
  }

  function rendrePiste() {
    poser('piste', refs.piste, pisteHtml({ joueurs: etat.joueurs || [], pv: etat.pv || {}, moiId: monId(), tour: etat.partie?.tour }));
  }

  function rendreJoueurs() {
    poser('joueurs', refs.joueurs, joueursHtml());
  }

  function rendreJournal() {
    poser('journal', refs.journal, journalHtml(etat.journal || [], etat));
  }

  function rendreModale() {
    const html = modaleHtml();
    if (!html) {
      refs.modale.hidden = true;
      modaleOuverte = false;
      cles.modale = null;
      return;
    }
    const etaitOuverte = modaleOuverte;
    refs.modale.hidden = false;
    modaleOuverte = true;
    if (poser('modale', refs.modaleBoite, html) && !etaitOuverte) {
      refs.modaleBoite.querySelector('h2')?.focus();
    }
  }

  /* ---------- Actions ---------- */

  /** Envoie une action de jeu : un seul envoi à la fois, boutons désactivés, puis relecture. */
  function agir(bouton, action, args = {}) {
    if (occupe) return;
    occupe = true;
    envoyer(bouton, async () => {
      try {
        await plat.agir(code, action, args);
      } finally {
        occupe = false;
        rendrePanneau(true);
        suivi.rafraichir();
      }
    }, suivi);
  }

  /** Choix d'un lieu dans la liste (sans relancer le rendu, pour garder le focus). */
  function choisirLieu(b) {
    saisie.lieu = b.dataset.lieu || '';
    refs.panneau.querySelectorAll('[data-act="choisir-lieu"]').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    const aller = refs.panneau.querySelector('[data-act="aller"]');
    if (aller) {
      aller.disabled = false;
      aller.textContent = `Aller à ${nomLieu(saisie.lieu)}`;
    }
    cles.plateau = null;
    rendrePlateau();
  }

  /** Arguments d'une action « lieu » selon le lieu où je suis. */
  function argsZone(b) {
    if (b.dataset.pioche) return { pioche: b.dataset.pioche };
    const lieu = moiEtat().lieu;
    if (lieu === 'foret') return { cible: champ('cible'), mode: modeChoisi() };
    if (lieu === 'sanctuaire') return { cible: champ('cible'), equipement: champ('equip') };
    return {};
  }

  /** Arguments d'une carte à jouer selon la carte. */
  function argsCarte(b) {
    if (b.dataset.utiliser !== undefined) return { utiliser: b.dataset.utiliser === 'true' };
    const args = { cible: champ('cible') };
    if (CARTE_EQUIPEMENT.includes(idCarte(jeu().carte))) args.equipement = champ('equip');
    return args;
  }

  function surAction(ev) {
    const b = ev.target.closest('button[data-act]');
    if (!b || b.disabled) return;
    switch (b.dataset.act) {
      case 'choisir-lieu': return choisirLieu(b);
      case 'lancer': return agir(b, 'lancer');
      case 'teleporter': return agir(b, 'teleporter', { lieu: b.dataset.lieu });
      case 'pouvoir': return agir(b, 'pouvoir', b.hasAttribute('data-sans-cible') ? {} : { cible: champ('cible') });
      case 'aller': return agir(b, 'aller', { lieu: saisie.lieu });
      case 'zone': return agir(b, 'lieu', argsZone(b));
      case 'passer': return agir(b, 'passer');
      case 'finir': return agir(b, 'finir');
      case 'donner': return agir(b, 'donner_vision', { cible: champ('cible') });
      case 'carte': return agir(b, 'jouer_carte', argsCarte(b));
      case 'attaquer': return agir(b, 'attaquer', { cible: b.dataset.cible });
      case 'tirer': return agir(b, 'attaquer', {});
      case 'repondre': return agir(b, 'repondre', { mentir: b.dataset.mentir === 'true' });
      default: return undefined;
    }
  }

  function surPerso(ev) {
    const b = ev.target.closest('button[data-revele]');
    if (!b || b.disabled || occupe) return;
    if (!confirm('Te révéler ? Tout le monde verra ton personnage et ton camp.')) return;
    agir(b, 'reveler');
  }

  /** Choix dans les listes : garde la valeur ; le joueur visé change la liste d'équipements. */
  function surChoix(ev) {
    const s = ev.target;
    if (!s?.name) return;
    if (s.name === 'mode') { saisie.mode = s.value; return; }
    if (!(s.name in saisie)) return;
    saisie[s.name] = s.value;
    if (s.name === 'cible') majEquip();
  }

  function surQuitter(ev) {
    if (occupe) return;
    if (!confirm('Quitter la partie ? Tu ne pourras plus jouer dans cette manche.')) return;
    envoyer(ev.currentTarget, () => plat.quitter(code), suivi);
  }

  /* ---------- Écouteurs ---------- */

  refs.panneau.addEventListener('click', surAction);
  refs.panneau.addEventListener('change', surChoix);
  refs.modaleBoite.addEventListener('click', surAction);
  refs.perso.addEventListener('click', surPerso);
  refs.quitter.addEventListener('click', surQuitter);

  /* ---------- Contrat de la vue ---------- */

  return {
    /** Nouvel état de la partie (appelé à chaque changement de version). */
    maj(e) {
      if (!e?.partie) return;
      const avant = etat?.partie?.tour;
      etat = e;
      verifierImagePerso(moiPerso());
      rendreBandeau();
      rendreElimine();
      rendreComposition();
      rendrePerso();
      rendrePioches();
      rendreMesEquip();
      rendrePanneau();
      rendrePlateau();
      rendrePiste();
      rendreJoueurs();
      rendreJournal();
      rendreModale();
      if (avant !== undefined && e.partie.tour !== avant && monTour()) refs.annonce.textContent = 'À toi de jouer.';
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
