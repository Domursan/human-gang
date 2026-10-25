// ===== Humane Gang — Duels : table Mastermind (#partie/CODE, jeu mastermind) =====
/*
 * Rôle : une table Mastermind dans le cadre commun (vues/commun.js).
 *   Phase 'codes' : je fixe le code que l'autre devra percer (4 trous + palette, « Valider mon code »).
 *   Phase 'jeu' : mon plateau de 10 rangées (essais et indices), palette, « Valider l'essai ».
 *   Colonne latérale : mon code, la progression de l'adversaire (indices seulement), le mode daltonien,
 *   et le lien vers le code du jour. Spectateur (moi.joue faux) : plateau seul, aucune action.
 * Couleurs : COULEURS_MM (désaturées). Un pion = rond de la couleur ; la lettre n'apparaît qu'en mode daltonien.
 * Clavier (facultatif, quand le focus est dans la table) : touches 1 à 6, Retour arrière, Entrée.
 * Dépendances : core.js (esc, toast), ../api.js (duel, erreurTexte, COULEURS_MM, estInvite), ./commun.js (creerCadre, nomJoueur).
 * Exporte : creer.
 */
import { esc, toast } from '../../core.js';
import { duel, erreurTexte, COULEURS_MM, estInvite } from '../api.js';
import { creerCadre, nomJoueur, deNom } from './commun.js';

const CLE_DALTO = 'hg_duel_daltonien';
const ESSAIS_MAX = 10;
const LARGEUR = 4;
const LETTRES = COULEURS_MM.map((x) => x.c);

/** Mode daltonien mémorisé dans le navigateur (sans effet si le stockage est refusé). */
function lireDalto() { try { return localStorage.getItem(CLE_DALTO) === '1'; } catch { return false; } }
function ecrireDalto(v) { try { localStorage.setItem(CLE_DALTO, v ? '1' : '0'); } catch { /* navigation privée stricte */ } }

/** Couleur d'après sa lettre serveur (r o y g b p). */
function infoCouleur(c) { return COULEURS_MM.find((x) => x.c === c) || { c, nom: '?', hex: '#9A9A9F', lettre: '?' }; }
/** Rond coloré ; la lettre n'est affichée qu'en mode daltonien. */
function pion(c, { petit = false, dalto = false } = {}) {
  const i = infoCouleur(c);
  return `<span class="mm-pion${petit ? ' is-petit' : ''}" role="img" aria-label="${esc(i.nom)}" style="--mm-c:${i.hex}">${dalto ? esc(i.lettre) : ''}</span>`;
}
/** Indices : pleins = bien placés, cerclés = mal placés, plus le texte « 2 bien, 1 mal ». */
function indices(bien, mal) {
  const pts = '<span class="mm-fb mm-fb-ok" aria-hidden="true"></span>'.repeat(bien)
    + '<span class="mm-fb mm-fb-no" aria-hidden="true"></span>'.repeat(mal);
  return `<span class="mm-indices"><span class="mm-fbs">${pts}</span><span class="mm-indices-txt">${bien} bien, ${mal} mal</span></span>`;
}
/** Rangée de 4 cases (pions ou trous) ; la première rangée d'un essai reçoit son numéro. */
function rangee(num, cases, droite = '', classe = '') {
  return `<li class="mm-rangee${classe ? ' ' + classe : ''}"><span class="mm-num">${num}</span>
    <span class="mm-cases">${cases}</span><span class="mm-droite">${droite}</span></li>`;
}
const vide = () => [null, null, null, null];
const ordinal = (n) => (n === 1 ? '1er' : `${n}e`);

/**
 * Crée la table Mastermind.
 * @param {HTMLElement} root conteneur de la vue.
 * @param {{code: string, naviguer: Function, moi: object|null, suivi: object}} ctx contexte de vues/partie.js.
 * @returns {{maj(etat: object): void, message(msg: object): void, detruire(): void}}
 */
export function creer(root, ctx) {
  const cadre = creerCadre(root, ctx, { classe: 'duels-mm' });
  const st = { etat: null, brouillon: vide(), occupe: false, phaseVue: null, dalto: lireDalto() };

  /** Vrai si je peux agir maintenant (joueur, duel en cours, pas déjà fini, pas d'envoi en cours). */
  const peutJouer = () => {
    const e = st.etat;
    if (!e || st.occupe || !e.moi?.joue || e.partie.statut !== 'en_cours') return false;
    const ms = e.mastermind || {};
    if (e.partie.phase === 'codes') return !ms.mon_code_pret;
    return !termine(e);
  };
  /** Ai-je fini ma partie (code trouvé ou plus d'essais) ? */
  const termine = (e) => {
    const moiJ = cadre.joueurMoi(e);
    const n = (e.mastermind?.mes_essais || []).length;
    return !!moiJ?.trouve_en || n >= ESSAIS_MAX;
  };

  /** Ajoute une couleur dans le premier trou libre de la rangée en cours. */
  const ajouter = (c) => {
    const i = st.brouillon.indexOf(null);
    if (i < 0) return;
    st.brouillon[i] = c;
    rendre();
  };
  /** Vide le trou d'indice i de la rangée en cours. */
  const vider = (i) => { st.brouillon[i] = null; rendre(); };

  /** Envoie le code (phase codes) ou l'essai (phase jeu) quand les 4 trous sont remplis. */
  async function valider() {
    if (!st.brouillon.every(Boolean) || st.occupe) return;
    const phase = st.etat.partie.phase;
    const texte = st.brouillon.join('');
    st.occupe = true; rendre();
    try {
      if (phase === 'codes') await duel.codeSecret(ctx.code, texte);
      else await duel.essayer(ctx.code, texte);
      st.brouillon = vide();
    } catch (err) {
      toast(erreurTexte(err), 'error');
    } finally {
      st.occupe = false;
      ctx.suivi?.rafraichir();
      rendre();
    }
  }

  /** Une rangée de l'essai en cours : trous remplis (cliquables pour les vider) et trous vides. */
  function rangeeCourante(n, peut) {
    const cases = st.brouillon.map((c, i) => {
      if (c) {
        const info = infoCouleur(c);
        const bouton = peut
          ? `<button type="button" class="mm-case-btn" data-act="trou" data-i="${i}" data-k="trou-${i}" aria-label="${esc(info.nom)}, vider ce trou"
               style="--mm-c:${info.hex}">${st.dalto ? esc(info.lettre) : ''}</button>`
          : pion(c, { dalto: st.dalto });
        return bouton;
      }
      return peut
        ? `<button type="button" class="mm-case-btn is-trou" data-act="trou" data-i="${i}" data-k="trou-${i}" aria-label="Trou ${i + 1} vide" disabled></button>`
        : '<span class="mm-trou" aria-label="Trou vide"></span>';
    }).join('');
    return rangee(n, cases, '<span class="mm-droite-txt">En cours</span>', 'is-cur');
  }

  /** Palette des 6 couleurs (gros boutons) + Effacer et Valider. */
  function commandes(cible) {
    const pal = COULEURS_MM.map((x) => `<button type="button" class="mm-pal" data-act="pal" data-c="${x.c}" data-k="pal-${x.c}"
        style="--mm-c:${x.hex}" aria-label="${esc(x.nom)}${st.dalto ? ' (' + x.lettre + ')' : ''}">${st.dalto ? esc(x.lettre) : ''}</button>`).join('');
    const complet = st.brouillon.every(Boolean);
    return `<div class="mm-palette" role="group" aria-label="Palette de couleurs">${pal}</div>
      <div class="mm-commandes">
        <button type="button" class="btn btn-ghost" data-act="effacer" data-k="effacer" ${st.occupe ? 'disabled' : ''}>Effacer</button>
        <button type="button" class="btn btn-primary" data-act="valider" data-k="valider" ${complet && !st.occupe ? '' : 'disabled'}>${esc(cible)}</button>
      </div>`;
  }

  /** Redessine le plateau et la colonne latérale selon l'état courant. */
  function rendre() {
    const e = st.etat; if (!e) return;
    const p = e.partie;
    const ms = e.mastermind || {};
    const peut = !!e.moi?.joue && p.statut === 'en_cours';
    const adv = cadre.adversaire(e);
    const moiJ = cadre.joueurMoi(e);
    const nomAdv = esc(adv?.pseudo || 'ton adversaire');
    const focus = root.contains(document.activeElement) ? document.activeElement.dataset.k : null;
    const plateau = cadre.plateau;
    let html = '';

    if (p.phase === 'codes') {
      if (!peut) {
        html = `<p class="mm-attente">Le code est en cours de choix.</p>`;
      } else if (ms.mon_code_pret) {
        html = `<p class="mm-attente">Ton code est prêt. En attente ${deNom(nomAdv)}…</p>`;
      } else {
        const cases = st.brouillon.map((c, i) => (c
          ? `<button type="button" class="mm-case-btn" data-act="trou" data-i="${i}" data-k="trou-${i}" aria-label="${esc(infoCouleur(c).nom)}, vider ce trou" style="--mm-c:${infoCouleur(c).hex}">${st.dalto ? esc(infoCouleur(c).lettre) : ''}</button>`
          : `<button type="button" class="mm-case-btn is-trou" data-act="trou" data-i="${i}" data-k="trou-${i}" aria-label="Trou ${i + 1} vide"></button>`)).join('');
        html = `<div class="mm-titre"><h2 class="duels-h3">Choisis le code que ${nomAdv} devra percer</h2></div>
          <div class="mm-cases mm-cases-grandes">${cases}</div>
          ${commandes('Valider mon code')}`;
      }
    } else {
      const mesEssais = ms.mes_essais || [];
      const fini = termine(e);
      const lignes = [];
      for (let n = 1; n <= ESSAIS_MAX; n += 1) {
        const essai = mesEssais.find((x) => x.n === n);
        if (essai) {
          const cases = [...String(essai.essai)].map((c) => pion(c, { dalto: st.dalto })).join('');
          lignes.push(rangee(n, cases, indices(essai.bien, essai.mal)));
        } else if (n === mesEssais.length + 1 && peut && !fini) {
          lignes.push(rangeeCourante(n, true));
        } else if (n === mesEssais.length + 1 && !peut && !fini) {
          lignes.push(rangee(n, '<span class="mm-trou"></span>'.repeat(LARGEUR), '', 'is-cur'));
        } else {
          lignes.push(rangee(n, '<span class="mm-trou"></span>'.repeat(LARGEUR), '', 'is-vide'));
        }
      }
      let bas = '';
      if (peut && !fini) {
        bas = commandes("Valider l'essai");
      } else if (fini) {
        const trouve = moiJ?.trouve_en;
        const texte = trouve ? `Code trouvé en ${trouve} essai${trouve > 1 ? 's' : ''} !` : 'Plus d\'essais.';
        bas = `<p class="mm-fin" aria-live="polite">${esc(texte)}</p>${adv && !adv.trouve_en ? `<p class="mm-attente">En attente ${deNom(nomAdv)}</p>` : ''}`;
      }
      html = `<div class="mm-titre"><h2 class="duels-h3">${peut ? 'Mon plateau' : 'Plateau'}</h2>
          ${peut ? `<span class="mm-sous">Trouve le code ${deNom(nomAdv)} en ${ESSAIS_MAX} essais</span>` : ''}</div>
        <ol class="mm-plateau" aria-label="Rangées">${lignes.join('')}</ol>
        <p class="mm-legende"><span class="mm-fb mm-fb-ok" aria-hidden="true"></span>Bien placé
          <span class="mm-fb mm-fb-no" aria-hidden="true"></span>Mal placé</p>
        ${bas}`;
    }
    plateau.innerHTML = html;

    peindreCote(e, ms, adv, peut);
    if (focus) root.querySelector(`[data-k="${focus}"]:not([disabled])`)?.focus();
  }

  /** Colonne latérale : mon code, progression adverse, daltonien, code du jour. */
  function peindreCote(e, ms, adv, peut) {
    const cote = cadre.cote;
    const monCode = ms.mon_code ? [...String(ms.mon_code)].map((c) => pion(c, { petit: true, dalto: st.dalto })).join('') : '';
    const essaisAdv = (adv && ms.essais_adverses?.[adv.user_id]) || [];
    const nAdv = Math.min(essaisAdv.length + 1, ESSAIS_MAX);
    const progression = essaisAdv.length
      ? essaisAdv.map((x, i) => `<li class="mm-prog"><span>Essai ${i + 1}</span>${indices(x.bien, x.mal)}</li>`).join('')
      : '<li class="mm-prog muted">Pas encore d\'essai.</li>';
    cote.innerHTML = `
      ${monCode ? `<section class="mm-bloc"><h2 class="duels-h3">Ton code</h2><div class="mm-codes" aria-label="Ton code">${monCode}</div></section>` : ''}
      ${adv && e.partie.phase === 'jeu' ? `<section class="mm-bloc"><h2 class="duels-h3">${nomJoueur(adv)} en est à son ${ordinal(nAdv)} essai</h2>
        <p class="mm-aide">Indices seulement, les couleurs restent cachées.</p>
        <ol class="mm-progs">${progression}</ol></section>` : ''}
      <section class="mm-bloc mm-dalto">
        <div><span id="mm-dalto-titre" class="mm-dalto-titre">Mode daltonien</span>
          <span id="mm-dalto-aide" class="mm-aide">Affiche une lettre sur chaque couleur</span></div>
        <button type="button" role="switch" data-act="dalto" data-k="dalto" aria-checked="${st.dalto}"
          aria-labelledby="mm-dalto-titre" aria-describedby="mm-dalto-aide" class="mm-switch${st.dalto ? ' is-on' : ''}"><span class="mm-switch-bille"></span></button>
      </section>
      ${estInvite() ? '' : '<section class="mm-bloc"><a href="#jour">Code du jour</a></section>'}`;
  }

  /** Touches 1 à 6, Retour arrière, Entrée : seulement quand le focus est dans la table. */
  function surTouche(ev) {
    if (!peutJouer() || ev.target.closest('input, textarea')) return;
    if (/^[1-6]$/.test(ev.key)) { ev.preventDefault(); ajouter(LETTRES[Number(ev.key) - 1]); return; }
    if (ev.key === 'Backspace') {
      const i = st.brouillon.reduce((acc, c, k) => (c ? k : acc), -1);
      if (i >= 0) { ev.preventDefault(); vider(i); }
      return;
    }
    if (ev.key === 'Enter' && st.brouillon.every(Boolean)) { ev.preventDefault(); valider(); }
  }

  /** Clics : palette, trous, effacer, valider, interrupteur daltonien (délégation sur la table). */
  function surClic(ev) {
    const b = ev.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'dalto') { st.dalto = !st.dalto; ecrireDalto(st.dalto); rendre(); return; }
    if (!peutJouer()) return;
    if (act === 'pal') ajouter(b.dataset.c);
    else if (act === 'trou') vider(Number(b.dataset.i));
    else if (act === 'effacer') { st.brouillon = vide(); rendre(); }
    else if (act === 'valider') valider();
  }

  root.addEventListener('click', surClic);
  root.addEventListener('keydown', surTouche);

  return {
    /** Nouvel état : barre et chat via le cadre, puis plateau et colonne latérale. */
    maj(e) {
      st.etat = e;
      cadre.maj(e);
      if (st.phaseVue !== e.partie.phase) { st.phaseVue = e.partie.phase; st.brouillon = vide(); }
      const peut = !!e.moi?.joue && e.partie.statut === 'en_cours';
      let statut = '';
      if (!e.moi?.joue) statut = 'Tu regardes ce duel en spectateur.';
      else if (e.partie.phase === 'codes') statut = peut && !e.mastermind?.mon_code_pret ? 'Choisis le code de ton adversaire.' : '';
      else if (peut && !termine(e)) statut = `Essai ${((e.mastermind?.mes_essais || []).length + 1)} en cours.`;
      cadre.statut(statut);
      rendre();
    },
    message(m) { cadre.message(m); },
    detruire() {
      root.removeEventListener('click', surClic);
      root.removeEventListener('keydown', surTouche);
      cadre.detruire();
    },
  };
}
