// ===== Humane Gang — Duels : table « Qui est-ce ? » (#partie/CODE, jeu quiestce) =====
/*
 * Rôle : une table « Qui est-ce ? » dans le cadre commun (vues/commun.js).
 *   Plateau : 24 personnages (portrait + prénom). Un clic baisse ou relève une carte (dos de carte Uno) ;
 *   les changements partent groupés (600 ms sans clic) vers duel.baisser, liste complète. Aide-mémoire seulement.
 *   « Baisser automatiquement » : baisse les personnages éliminés par mes questions déjà répondues.
 *   Côté (ordinateur) : mon personnage secret, personnages debout, poser une question, historique de la manche.
 *   Téléphone (le panneau est replié) : barre compacte au-dessus du plateau, questions collées en bas du plateau.
 *   Mon tour : poser une question (toute prête, ou libre si permise), « Je sais qui c'est ! ».
 *   Question libre reçue : bandeau « X te demande… » avec Oui / Non, avant le reste.
 *   Spectateur : plateau seul, sans action ni personnage secret.
 *   Nouvelle manche (partie.manche change) : personnages rechargés, baisses remises à zéro.
 * Dépendances : core.js (esc, toast), ../api.js (duel, erreurTexte), ./commun.js (creerCadre, nomJoueur),
 *   ./portrait.js (portraitSvg : SVG viewBox 100 × 120 d'après les attributs).
 * Exporte : creer.
 */
import { esc, toast } from '../../core.js';
import { duel, erreurTexte } from '../api.js';
import { creerCadre, nomJoueur, deNom } from './commun.js';
import { portraitSvg } from './portrait.js';

const DELAI_ENVOI = 600;
const ANNONCE_MS = 6000;
const LIBRE_MIN = 4;
const LIBRE_MAX = 140;
/** Groupes des questions toutes prêtes ; les clés absentes d'ici vont dans « Autres ». */
const GROUPES = [
  ['Tête', ['chapeau']],
  ['Cheveux', ['cheveux', 'longs']],
  ['Yeux', ['yeux', 'lunettes']],
  ['Visage', ['barbe', 'boucles', 'peau']],
];
/** Attributs booléens (oui / non). */
const BOOLEENS = ['lunettes', 'barbe', 'boucles', 'longs'];
/** Dos de carte Uno (règles recopiées dans quiestce.css, classes qec-dos*). */
const DOS = '<span class="qec-dos" aria-hidden="true"><span class="qec-dos-f"><span class="qec-dos-bande"></span>'
  + '<span class="qec-dos-rond"><span class="qec-dos-hg">HG</span></span></span></span>';

/** Vrai si la valeur d'une question vaut « oui ». */
const vaut = (v) => v === true || v === 'oui' || v === 'true' || v === 1;

/**
 * Le personnage correspond-il à la question (clé, valeur) ?
 * Booléens : le trait est présent. Chapeau : « oui » = porte un chapeau, quel qu'il soit. Sinon égalité.
 * @param {object} a attributs du personnage.
 * @returns {boolean}
 */
function correspond(a = {}, cle, valeur) {
  if (BOOLEENS.includes(cle)) return !!a[cle] === vaut(valeur);
  if (cle === 'chapeau') {
    if (valeur === 'oui') return a.chapeau !== 'aucun';
    if (valeur === 'non') return a.chapeau === 'aucun';
  }
  return a[cle] === valeur;
}

/**
 * Répartit les questions toutes prêtes par groupe (en gardant leur index dans le catalogue).
 * @returns {Array<[string, Array<{qu: object, i: number}>]>} groupes non vides.
 */
function groupesDe(liste) {
  const indexees = liste.map((qu, i) => ({ qu, i }));
  const sortie = GROUPES.map(([titre, cles]) => [titre, indexees.filter(({ qu }) => cles.includes(qu.cle))]);
  const reste = indexees.filter(({ qu }) => !GROUPES.some(([, cles]) => cles.includes(qu.cle)));
  if (reste.length) sortie.push(['Autres', reste]);
  return sortie.filter(([, items]) => items.length);
}

/**
 * Crée la table « Qui est-ce ? ».
 * @param {HTMLElement} root conteneur de la vue.
 * @param {{code: string, naviguer: Function, moi: object|null, suivi: object}} ctx contexte de vues/partie.js.
 * @returns {{maj(etat: object): void, message(msg: object): void, detruire(): void}}
 */
export function creer(root, ctx) {
  const cadre = creerCadre(root, ctx, { classe: 'duels-qec' });
  const st = {
    etat: null,
    detruit: false,
    plateau: null, chargement: null, jeton: 0,        // personnages et questions (chargés une fois par manche)
    manche: null, baisses: new Set(),                 // manche vue ; mes personnages baissés (ids)
    timerEnvoi: null, envoi: Promise.resolve(),       // envoi groupé des baisses, dans l'ordre
    mode: 'normal',                                   // 'normal' | 'designation' (« Je sais qui c'est ! »)
    occupe: false, libre: '', reponse: null,          // envoi en cours ; brouillon de question libre ; dernière réponse
    annonce: null, timerAnnonce: null,                // message annoncé aux lecteurs d'écran (statut)
    telOuvert: false,                                 // volet « Poser une question » sur téléphone
  };

  const joue = (e) => !!e?.moi?.joue && e?.partie?.statut === 'en_cours';
  const monTour = (e) => cadre.monTour(e);
  /** Une question libre attend-elle une réponse ? */
  const attente = (e) => (e?.quiestce?.question_en_attente ?? null) !== null;
  const questions = () => st.etat?.quiestce?.questions || [];
  const catalogue = () => st.plateau?.questions || [];
  const persos = () => st.plateau?.persos || [];
  const adversaire = () => cadre.adversaire(st.etat);
  const pseudoA = () => adversaire()?.pseudo || 'ton adversaire';
  const monRestant = () => persos().filter((p) => !st.baisses.has(p.id)).length;
  const textePose = (q) => q.texte
    || catalogue().find((x) => x.cle === q.cle && String(x.valeur) === String(q.valeur))?.texte || q.cle;
  const dejaPosee = (qu) => questions().some((x) => x.type === 'attribut' && x.cle === qu.cle && String(x.valeur) === String(qu.valeur));

  /** Texte de statut (lu par les lecteurs d'écran) selon la situation. */
  function statutTexte(e) {
    if (!e?.moi?.joue) return 'Tu regardes ce duel en spectateur.';
    const adv = pseudoA();
    if (attente(e)) return monTour(e) ? `${adv} te demande : réponds oui ou non.` : `En attente de la réponse ${deNom(adv)}.`;
    if (monTour(e)) return st.mode === 'designation' ? `Clique sur le personnage ${deNom(adv)}.` : 'À toi : pose une question ou désigne le personnage.';
    return `${adv} réfléchit…`;
  }
  const majStatut = () => cadre.statut(st.annonce || (st.etat ? statutTexte(st.etat) : ''));
  /** Annonce une information (réponse, envoi) dans le statut, quelques secondes. */
  function annoncer(texte) {
    st.annonce = texte;
    cadre.statut(texte);
    clearTimeout(st.timerAnnonce);
    st.timerAnnonce = setTimeout(() => { st.annonce = null; majStatut(); }, ANNONCE_MS);
  }

  /* ---------- Personnages baissés : envoi groupé ---------- */

  /** Programme l'envoi de la liste des baisses après un temps sans clic. */
  function planifierEnvoi() {
    clearTimeout(st.timerEnvoi);
    const manche = st.manche;
    st.timerEnvoi = setTimeout(() => { st.timerEnvoi = null; envoyerBaisses(manche); }, DELAI_ENVOI);
  }
  /** Envoie la liste complète des baisses (une manche donnée ; sans effet si la manche a changé). */
  function envoyerBaisses(manche) {
    if (manche !== st.manche) return;
    const ids = [...st.baisses];
    st.envoi = st.envoi
      .then(() => duel.baisser(ctx.code, ids))
      .catch((err) => toast(erreurTexte(err), 'error'));
  }

  /** Charge les personnages et les questions toutes prêtes (une fois par manche). */
  function charger() {
    if (st.plateau || st.chargement) return;
    const jeton = ++st.jeton;
    st.chargement = duel.plateau(ctx.code)
      .then((p) => { if (jeton === st.jeton && !st.detruit) st.plateau = p; })
      .catch((err) => { if (jeton === st.jeton) toast(erreurTexte(err), 'error'); })
      .finally(() => {
        if (jeton !== st.jeton) return;
        st.chargement = null;
        if (st.plateau) rendre();
      });
  }

  /** Baisse les personnages éliminés par mes questions déjà répondues. */
  function baisserAuto() {
    const mon = st.etat.moi.user_id;
    const mes = questions().filter((x) => x.auteur === mon && x.type === 'attribut' && x.reponse != null);
    if (!mes.length) { toast('Aucune de tes questions n’a encore de réponse.'); return; }
    let n = 0;
    for (const p of persos()) {
      if (st.baisses.has(p.id)) continue;
      if (mes.some((x) => correspond(p.attributs, x.cle, x.valeur) !== !!x.reponse)) { st.baisses.add(p.id); n += 1; }
    }
    if (n) planifierEnvoi();
    rendre();
    toast(n ? `${n} personnage${n > 1 ? 's' : ''} baissé${n > 1 ? 's' : ''}.` : 'Les personnages éliminés sont déjà baissés.');
  }

  /** Clic sur une carte : baisse ou relève ; en mode désignation, c'est une proposition. */
  function cliqueCarte(id) {
    const p = persos().find((x) => String(x.id) === id);
    if (!p || !joue(st.etat)) return;
    if (st.mode === 'designation') { deviner(p); return; }
    if (st.baisses.has(p.id)) st.baisses.delete(p.id); else st.baisses.add(p.id);
    planifierEnvoi();
    rendre();
  }

  /* ---------- Actions de jeu ---------- */

  /** Envoie une action au serveur, boutons désactivés pendant l'envoi. Renvoie true si elle a réussi. */
  async function agir(fn) {
    if (st.occupe) return false;
    st.occupe = true;
    rendre();
    try { await fn(); return true; } catch (err) { toast(erreurTexte(err), 'error'); return false; } finally {
      st.occupe = false;
      ctx.suivi?.rafraichir();
      rendre();
    }
  }

  /** Question toute prête : la réponse s'affiche tout de suite, puis le tour passe. */
  async function poser(i) {
    const qu = catalogue()[i];
    if (!qu || dejaPosee(qu)) return;
    let reponse = null;
    const ok = await agir(async () => { reponse = await duel.question(ctx.code, qu.cle, qu.valeur); });
    if (!ok || typeof reponse !== 'boolean') return;
    st.reponse = { texte: qu.texte, oui: reponse };
    annoncer(`Réponse : ${reponse ? 'Oui' : 'Non'} à « ${qu.texte} ».`);
    rendre();
  }

  /** Question libre : l'adversaire doit répondre. */
  async function envoyerLibre(brut) {
    const texte = String(brut || '').trim();
    if (texte.length < LIBRE_MIN || texte.length > LIBRE_MAX) {
      toast(`La question doit faire entre ${LIBRE_MIN} et ${LIBRE_MAX} caractères.`, 'error');
      return;
    }
    const ok = await agir(() => duel.questionLibre(ctx.code, texte));
    if (ok) {
      st.libre = '';
      annoncer(`Question envoyée. En attente de la réponse ${deNom(pseudoA())}.`);
    }
    rendre();
  }

  /** Réponse à la question libre qui m'attend. */
  async function repondre(oui) {
    const ok = await agir(() => duel.repondre(ctx.code, oui));
    if (ok) annoncer(`Tu as répondu ${oui ? 'oui' : 'non'}.`);
  }

  /** « Je pense que c'est… » : juste → manche gagnée, faux → manche perdue. */
  async function deviner(p) {
    if (!confirm(`Tu penses que c'est ${p.prenom} ? Si tu te trompes, tu perds la manche.`)) return;
    st.mode = 'normal';
    let juste = null;
    const ok = await agir(async () => { juste = await duel.deviner(ctx.code, p.id); });
    if (ok) toast(juste ? 'Bien joué, tu gagnes la manche !' : 'Raté, tu perds la manche.', juste ? 'ok' : 'error');
  }

  /* ---------- Rendu ---------- */

  /** Carte d'un personnage : portrait (levé) ou dos de carte (baissé). */
  function carte(p, { ouvert, mon, designation }) {
    const baisse = st.baisses.has(p.id);
    const moiPerso = p.id === mon;
    const bloque = !ouvert || (designation && (baisse || st.occupe));
    const label = `${p.prenom}, ${baisse ? 'baissé' : 'levé'}${moiPerso ? ', ton personnage' : ''}`;
    const id = esc(String(p.id));
    const visuel = baisse ? DOS : `<span class="qec-portrait" aria-hidden="true">${portraitSvg(p.attributs, { titre: p.prenom })}</span>`;
    return `<button type="button" class="qec-carte${baisse ? ' is-baisse' : ''}${moiPerso ? ' is-mon' : ''}${designation && !baisse ? ' is-cible' : ''}"
        data-act="carte" data-id="${id}" data-k="carte-${id}" aria-pressed="${baisse}" aria-label="${esc(label)}" ${bloque ? 'disabled' : ''}>
      ${visuel}<span class="qec-nom">${esc(p.prenom)}</span>${moiPerso ? '<span class="qec-tag">Ton perso</span>' : ''}
    </button>`;
  }

  /** Barre compacte de téléphone : mon personnage et les compteurs. */
  function barreTel(p, nbMoi, nbAdv) {
    return `<div class="qec-tel qec-barre-tel">
      <span class="qec-mini" aria-hidden="true">${portraitSvg(p.attributs, { titre: p.prenom })}</span>
      <div><span class="qec-petit">Ton personnage</span><strong class="qec-grand-nom">${esc(p.prenom)}</strong></div>
      <span class="qec-petit qec-droite">Il te reste ${nbMoi ?? '…'}${adversaire()?.robot ? '' : `<br>${esc(pseudoA())} en a ${nbAdv ?? '?'}`}</span>
    </div>`;
  }

  /** Bloc « question » : réponse attendue, attente, ou commandes de question (selon le tour). */
  function blocQuestions(e, tel) {
    const q = e.quiestce || {};
    const adv = esc(pseudoA());
    const occ = st.occupe;
    const tour = monTour(e);
    if (attente(e)) {
      const pend = questions().find((x) => x.id === q.question_en_attente);
      if (tour) {
        return `<div class="qec-attend" role="group" aria-label="Répondre à ${adv}">
          <p><strong>${adv} te demande :</strong> « ${esc(pend?.texte || '')} »</p>
          <div class="qec-oui-non">
            <button type="button" class="btn btn-primary qec-btn" data-act="repondre" data-oui="1" data-k="rep-oui" ${occ ? 'disabled' : ''}>Oui</button>
            <button type="button" class="btn btn-ghost qec-btn" data-act="repondre" data-oui="0" data-k="rep-non" ${occ ? 'disabled' : ''}>Non</button>
          </div></div>`;
      }
      return pend?.auteur === e.moi.user_id
        ? `<p class="qec-attente">En attente de la réponse ${deNom(adv)} à « ${esc(pend.texte || '')} ».</p>`
        : `<p class="qec-attente">${adv} réfléchit…</p>`;
    }
    if (!tour) return `<p class="qec-attente">${adv} réfléchit…</p>`;
    if (st.mode === 'designation') {
      return `<div class="qec-desig" role="group" aria-label="Désigner un personnage">
        <p>Clique sur le personnage que tu penses être celui ${deNom(adv)}. Une erreur fait perdre la manche.</p>
        <button type="button" class="btn btn-ghost qec-btn" data-act="annuler" data-k="annuler">Annuler</button></div>`;
    }
    return controles(e, tel);
  }

  /** Commandes de mon tour : questions toutes prêtes, question libre, « Je sais qui c'est ! ». */
  function controles(e, tel) {
    const occ = st.occupe;
    const groupes = groupesDe(catalogue()).map(([titre, items]) => `
      <div class="qec-groupe"><h3 class="qec-groupe-titre">${titre}</h3>
        <div class="qec-chips">${items.map(({ qu, i }) => {
          const deja = dejaPosee(qu);
          return `<button type="button" class="qec-chip" data-act="question" data-i="${i}" data-k="q-${i}" ${occ || deja ? 'disabled' : ''}>`
            + `${esc(qu.texte)}${deja ? ' <span class="qec-deja">(déjà posée)</span>' : ''}</button>`;
        }).join('')}</div></div>`).join('');
    const retour = st.reponse
      ? `<p class="qec-retour">Dernière réponse : <strong>${st.reponse.oui ? 'Oui' : 'Non'}</strong> à « ${esc(st.reponse.texte)} ».</p>`
      : '';
    const libre = e.quiestce?.libres ? `<form class="qec-libre" data-act="libre">
        <label class="qec-libre-lab">Question libre
          <input type="text" name="texte" value="${esc(st.libre)}" maxlength="${LIBRE_MAX}" autocomplete="off" data-k="libre"
            placeholder="Ex. Il a un air sérieux ?" ${occ ? 'disabled' : ''}>
        </label>
        <button type="submit" class="btn btn-ghost qec-btn" data-k="libre-envoyer" ${occ ? 'disabled' : ''}>Envoyer</button>
      </form>` : '';
    const corps = `${retour}<div class="qec-groupes">${groupes}</div>${libre}`;
    const designer = `<div class="qec-actions"><button type="button" class="btn btn-primary qec-btn" data-act="designer" data-k="designer" ${occ ? 'disabled' : ''}>Je sais qui c'est !</button></div>`;
    if (tel) return `<details class="qec-details" ${st.telOuvert ? 'open' : ''}><summary>Poser une question</summary>${corps}</details>${designer}`;
    return `<h2 class="duels-h3">Poser une question</h2>${corps}${designer}`;
  }

  /** Historique des questions de la manche (les deux joueurs). */
  function historique(e) {
    const liste = questions();
    if (!liste.length) return '<p class="qec-attente">Aucune question pour l’instant.</p>';
    const moi = e.moi.user_id;
    return `<ol class="qec-histo" aria-label="Questions de la manche">${liste.map((x) => {
      const j = (e.joueurs || []).find((jj) => jj.user_id === x.auteur);
      const qui = x.auteur === moi && e.moi.joue ? 'Toi' : nomJoueur(j);
      const rep = x.reponse === true ? '<span class="qec-rep is-oui">Oui</span>'
        : x.reponse === false ? '<span class="qec-rep is-non">Non</span>'
          : '<span class="qec-rep is-attente">sans réponse</span>';
      return `<li><span class="qec-histo-qui">${qui} :</span> <span>${esc(textePose(x))}</span> ${rep}</li>`;
    }).join('')}</ol>`;
  }

  /** Retient l'élément qui a le focus (pour le retrouver après un nouveau rendu). */
  function focusCourant() {
    const a = document.activeElement;
    if (!a || !root.contains(a) || !a.dataset) return null;
    return { k: a.dataset.k, debut: a.selectionStart ?? null };
  }
  /** Rend le focus à l'élément de même clé (la copie visible si le plateau existe en deux exemplaires). */
  function restaurerFocus(f) {
    if (!f?.k) return;
    const el = [...root.querySelectorAll('[data-k]')]
      .find((x) => x.dataset.k === f.k && !x.disabled && x.getClientRects().length);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (f.debut !== null && el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length);
  }

  /** Redessine le plateau et le côté selon l'état courant. */
  function rendre() {
    const e = st.etat;
    if (!e || st.detruit) return;
    const f = focusCourant();
    const q = e.quiestce || {};
    const ouvert = joue(e);
    const liste = persos();
    const mon = q.mon_perso;
    const monPerso = liste.find((p) => p.id === mon);
    const designation = st.mode === 'designation';
    const nbMoi = st.plateau ? monRestant() : null;
    const advId = (e.joueurs || []).find((j) => j.user_id !== e.moi.user_id)?.user_id;
    const nbAdv = advId ? q.restants_adverses?.[advId] : undefined;
    const nomAdv = esc(pseudoA());
    const cartes = liste.map((p) => carte(p, { ouvert, mon, designation })).join('');

    cadre.plateau.innerHTML = `
      <div class="qec-entete">
        <h2 class="duels-h3">Les habitants de Paleto</h2>
        ${ouvert ? `<button type="button" class="btn btn-ghost qec-btn" data-act="auto" data-k="auto" ${st.occupe || !liste.length ? 'disabled' : ''}>Baisser automatiquement</button>` : ''}
      </div>
      ${ouvert && monPerso ? barreTel(monPerso, nbMoi, nbAdv) : ''}
      ${st.plateau ? `<div class="qec-grille" role="group" aria-label="Personnages">${cartes}</div>` : '<p class="qec-attente">Chargement des personnages…</p>'}
      ${ouvert ? `<div class="qec-tel qec-ask-tel">${blocQuestions(e, true)}</div>` : ''}`;

    cadre.cote.innerHTML = `
      ${ouvert && monPerso ? `<section class="qec-bloc qec-perso qec-ord" aria-label="Ton personnage">
          <p class="qec-petit">Ton personnage</p>
          <div class="qec-portrait qec-portrait-grand" role="img" aria-label="Portrait de ${esc(monPerso.prenom)}">${portraitSvg(monPerso.attributs, { titre: monPerso.prenom })}</div>
          <strong class="qec-grand-nom">${esc(monPerso.prenom)}</strong>
          <p class="qec-aide">${nomAdv} doit deviner ce personnage.</p>
        </section>` : ''}
      ${ouvert && st.plateau ? `<section class="qec-bloc qec-ord">
          <h2 class="duels-h3">Personnages debout</h2>
          <p class="qec-aide">Il te reste <strong>${nbMoi}</strong>.${adversaire()?.robot ? '' : ` Chez ${nomAdv} : <strong>${nbAdv ?? '?'}</strong>.`}</p>
        </section>` : ''}
      ${ouvert ? `<section class="qec-bloc qec-ord">${blocQuestions(e, false)}</section>` : ''}
      <section class="qec-bloc">
        <h2 class="duels-h3">Questions de la manche</h2>
        ${historique(e)}
      </section>`;
    restaurerFocus(f);
  }

  /* ---------- Écouteurs (délégation sur la racine) ---------- */

  function surClic(ev) {
    const b = ev.target.closest('[data-act]');
    if (!b || b.disabled || !st.etat) return;
    switch (b.dataset.act) {
      case 'carte': cliqueCarte(b.dataset.id); break;
      case 'auto': baisserAuto(); break;
      case 'question': poser(Number(b.dataset.i)); break;
      case 'repondre': repondre(b.dataset.oui === '1'); break;
      case 'designer': st.mode = 'designation'; majStatut(); rendre(); break;
      case 'annuler': st.mode = 'normal'; majStatut(); rendre(); break;
      default: break;
    }
  }
  function surSoumission(ev) {
    const formulaire = ev.target;
    if (formulaire.dataset?.act !== 'libre') return;
    ev.preventDefault();
    envoyerLibre(formulaire.querySelector('input[name="texte"]')?.value);
  }
  function surSaisie(ev) {
    if (ev.target.dataset?.k === 'libre') st.libre = ev.target.value;
  }
  function surTouche(ev) {
    if (ev.key === 'Escape' && st.mode === 'designation') { st.mode = 'normal'; majStatut(); rendre(); }
  }
  function surOuverture(ev) {
    if (ev.target.classList?.contains('qec-details')) st.telOuvert = ev.target.open;
  }

  root.addEventListener('click', surClic);
  root.addEventListener('submit', surSoumission);
  root.addEventListener('input', surSaisie);
  root.addEventListener('keydown', surTouche);
  root.addEventListener('toggle', surOuverture, true);

  return {
    /** Nouvel état : nouvelle manche = personnages rechargés et baisses à zéro ; puis barre, statut et rendu. */
    maj(e) {
      if (st.detruit) return;
      st.etat = e;
      const manche = e.partie?.manche;
      if (st.manche !== manche) {
        st.manche = manche;
        st.baisses = new Set(e.quiestce?.mes_baisses || []);
        clearTimeout(st.timerEnvoi); st.timerEnvoi = null;
        st.mode = 'normal'; st.reponse = null;
        st.plateau = null; st.chargement = null;
      }
      if (st.mode === 'designation' && !(monTour(e) && !attente(e))) st.mode = 'normal';
      charger();
      cadre.maj(e);
      majStatut();
      rendre();
    },
    message(m) { cadre.message(m); },
    detruire() {
      if (st.detruit) return;
      st.detruit = true;
      root.removeEventListener('click', surClic);
      root.removeEventListener('submit', surSoumission);
      root.removeEventListener('input', surSaisie);
      root.removeEventListener('keydown', surTouche);
      root.removeEventListener('toggle', surOuverture, true);
      clearTimeout(st.timerAnnonce);
      if (st.timerEnvoi) { clearTimeout(st.timerEnvoi); st.timerEnvoi = null; envoyerBaisses(st.manche); }
      cadre.detruire();
    },
  };
}
