// ===== Humane Gang — Duels : table du Morpion (classique 3×3, ultime, gomoku 15×15) =====
/*
 * Rôle : dessine le plateau dans le cadre commun (vues/commun.js) et envoie les coups (duel.jouer).
 *   Croix bleues = place 1 (#6FB3F2), ronds dorés = place 2 (#E8B04B). Le dernier coup s'anime (la marque se pose : agrandissement et fondu) ;
 *   au gomoku il est aussi marqué d'un point.
 *   Ultime : case = grille * 9 + position (partie.grille : 81 caractères). Les petites grilles gagnées sont
 *   recouvertes, la nulle est grisée, la grille imposée est entourée d'or (ou tout est libre si cible est null).
 *   Après chaque manche, la grille finale reste affichée quelques secondes avec la ligne gagnante barrée.
 *   Une case vide est un <button type="button"> (désactivée hors de mon tour), une marque un <span role="img">.
 * Dépendances : core.js (esc, toast), ../api.js (duel, erreurTexte), ./commun.js (creerCadre, nomJoueur).
 * Exporte : creer(root, ctx) → { maj(etat), message(msg), detruire() } (contrat de vues/partie.js).
 */
import { esc, toast } from '../../core.js';
import { duel, erreurTexte } from '../api.js';
import { creerCadre, nomJoueur } from './commun.js';
import { voisinGrille } from '../../grille-clavier.js';

const CROIX = '#6FB3F2';
const ROND = '#E8B04B';
const DUREE_RECAP = 3500;
const POS = ['en haut à gauche', 'en haut', 'en haut à droite', 'à gauche', 'au centre', 'à droite',
  'en bas à gauche', 'en bas', 'en bas à droite'];
const REGLES = {
  classique: ['Chacun joue à son tour sur une case libre.',
    'Aligne 3 marques : ligne, colonne ou diagonale.',
    'Le premier alignement gagne la manche ; si la grille est pleine, c’est nul.'],
  ultime: ['Gagne une petite grille en alignant 3 marques.',
    'La case jouée envoie l’adversaire dans la grille du même numéro.',
    'Aligne 3 petites grilles pour gagner la partie.'],
  gomoku: ['Chacun pose une marque sur une case libre, à son tour.',
    'Aligne exactement 5 marques : ligne, colonne ou diagonale.',
    'Le dernier coup est marqué d’un point.'],
};

/** Marque d'une case : '1' croix bleue, '2' rond doré. anime : apparition animée (dernier coup). */
function svgMarque(c, anime) {
  const trace = anime ? ' is-trace' : '';
  return c === '1'
    // Deux traits séparés (et non un seul chemin à deux morceaux) : certains navigateurs ne traçaient que le premier.
    ? `<svg class="morpion-marque${trace}" viewBox="0 0 32 32" aria-hidden="true"><path d="M8 8L24 24" fill="none" stroke="${CROIX}" stroke-width="4" stroke-linecap="round"/><path d="M24 8L8 24" fill="none" stroke="${CROIX}" stroke-width="4" stroke-linecap="round"/></svg>`
    : `<svg class="morpion-marque${trace}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="10" fill="none" stroke="${ROND}" stroke-width="4"/></svg>`;
}

/** Grande marque semi-transparente posée sur une petite grille gagnée. */
function svgGrande(c) {
  return c === '1'
    ? `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 6L26 26M26 6L6 26" fill="none" stroke="${CROIX}" stroke-width="3" stroke-linecap="round"/></svg>`
    : `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="11" fill="none" stroke="${ROND}" stroke-width="3"/></svg>`;
}

/** Libellé (aria-label) d'une case vide. */
function libelleCase(variante, w, i) {
  if (variante === 'ultime') return `Grille ${Math.floor(i / 9) + 1}, case ${(i % 9) + 1}`;
  if (variante === 'gomoku') return `Ligne ${Math.floor(i / w) + 1}, colonne ${(i % w) + 1}`;
  return `Case ${i + 1}`;
}

/**
 * Barre la ligne gagnante (du centre de la première case au centre de la dernière) par-dessus le plateau.
 * @param {HTMLElement} cadreEl conteneur positionné qui contient les cases et le svg.
 * @param {number[]} cases indices des cases gagnantes.
 */
function tracerBarre(cadreEl, cases) {
  const svg = cadreEl.querySelector('.morpion-barre');
  const pts = (cases || []).map((i) => cadreEl.querySelector(`[data-case="${Number(i)}"]`)).filter(Boolean);
  if (!svg || pts.length < 2) return;
  const base = cadreEl.getBoundingClientRect();
  const centre = (el) => {
    const r = el.getBoundingClientRect();
    return [r.left - base.left + r.width / 2, r.top - base.top + r.height / 2];
  };
  const [x1, y1] = centre(pts[0]);
  const [x2, y2] = centre(pts[pts.length - 1]);
  svg.setAttribute('viewBox', `0 0 ${base.width} ${base.height}`);
  svg.innerHTML = `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
  svg.hidden = false;
}

/**
 * Crée la table du Morpion.
 * @param {HTMLElement} root conteneur de la vue.
 * @param {{code: string, naviguer: Function, moi: object|null, suivi: object}} ctx contexte de vues/partie.js.
 * @returns {{maj: Function, message: Function, detruire: Function}}
 */
export function creer(root, ctx) {
  const cadre = creerCadre(root, ctx, { classe: 'duels-morpion' });
  // provisoire : case que je viens de jouer, affichée tout de suite (avant la réponse du serveur) ;
  // masque : coup du robot reçu en même temps que le mien, montré un instant après (on voit d'abord son propre coup).
  const st = { etat: null, nbManches: null, recap: null, timer: null, dernierVu: '', envoi: false, vivant: true,
    provisoire: null, masque: null, tMasque: null,
    /* curseur : case de la tabulation (une seule, roving tabindex) ; par : cases affichées (index → élément) ;
       geo : forme de la grille affichée (lignes, colonnes, passage index ↔ ligne/colonne). */
    curseur: 0, par: new Map(), geo: null };

  // Délégation : un seul écouteur sur le plateau, même après les redessins.
  cadre.plateau.addEventListener('click', (ev) => {
    const b = ev.target.closest?.('button[data-case]');
    if (!b || b.disabled || st.envoi) return;
    jouer(Number(b.dataset.case));
  });

  // Clavier : flèches (et Début, Fin) pour passer d'une case à l'autre, marques comprises ; Entrée ou Espace jouent
  // la case (bouton natif). Les cases désactivées sont sautées.
  cadre.plateau.addEventListener('keydown', (ev) => {
    const cel = ev.target.closest?.('[data-case]');
    const geo = st.geo;
    if (!cel || !geo) return;
    const [r, c] = geo.versRC(Number(cel.dataset.case));
    const cible = voisinGrille(ev.key, r, c, geo.lignes, geo.colonnes,
      (rr, cc) => { const el = st.par.get(geo.versI(rr, cc)); return !!el && !el.disabled; });
    if (!cible) return;
    ev.preventDefault();
    allerA(geo.versI(cible[0], cible[1]));
  });

  /** Place le focus (et le curseur) sur la case i. */
  function allerA(i) {
    st.curseur = i;
    st.par.forEach((el, k) => { el.tabIndex = k === i ? 0 : -1; });
    st.par.get(i)?.focus();
  }

  /** Envoie un coup. Les cases restent désactivées jusqu'à la mise à jour de l'état (maj). */
  async function jouer(i) {
    st.envoi = true;
    st.provisoire = i;
    rendre();
    try {
      await duel.jouer(ctx.code, i);
      ctx.suivi?.rafraichir?.();
    } catch (err) {
      st.envoi = false;
      st.provisoire = null;
      toast(erreurTexte(err), 'error');
      rendre();
    }
  }

  /** Quand une manche vient de finir, garde sa grille finale affichée quelques secondes (ligne barrée). */
  function suivreManche(e) {
    const h = e.partie.historique || [];
    if (st.nbManches === null) { st.nbManches = h.length; return; }
    if (h.length <= st.nbManches) return;
    st.nbManches = h.length;
    const d = h[h.length - 1];
    if (!d?.grille) return;
    st.recap = { manche: d.manche, grille: d.grille, petites: d.petites, ligne: d.ligne };
    clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      st.recap = null;
      if (st.vivant && st.etat) rendre();
    }, DUREE_RECAP);
  }

  /** Statut sous la barre. Le spectateur garde le texte posé par le cadre. */
  function statut(e) {
    if (!e.moi?.joue || e.partie.statut !== 'en_cours') return;
    if (cadre.monTour(e)) { cadre.statut('À toi de jouer'); return; }
    const t = (e.joueurs || []).find((j) => j.user_id === e.partie.tour);
    if (t?.robot) cadre.statut('Le robot réfléchit…');
    else cadre.statut(`Au tour de ${t?.pseudo || 'ton adversaire'}`);
  }

  /** Fait défiler le plateau (gomoku sur téléphone) pour que la case jouée reste visible. */
  function defiler(i) {
    const d = cadre.plateau.querySelector('.morpion-defile');
    const c = cadre.plateau.querySelector(`[data-case="${i}"]`);
    if (!d || !c || d.scrollWidth <= d.clientWidth) return;
    const r = c.getBoundingClientRect();
    const dr = d.getBoundingClientRect();
    d.scrollLeft += (r.left + r.width / 2) - (dr.left + dr.width / 2);
  }

  /** Dessine le plateau : partie en cours, ou grille finale d'une manche qui vient de finir. */
  function rendre() {
    const e = st.etat;
    if (!e || !st.vivant) return;
    const p = e.partie;
    const v = REGLES[p.variante] ? p.variante : 'classique';
    const w = v === 'gomoku' ? (Number(p.w) || 15) : 3;
    const N = v === 'ultime' ? 81 : w * w;
    const recap = st.recap;

    const grilleTxt = recap ? recap.grille : p.grille;
    const petitesTxt = recap ? recap.petites : p.petites;
    const g = Array.from({ length: N }, (_, i) => grilleTxt?.[i] || '.');
    const petites = Array.from({ length: 9 }, (_, k) => petitesTxt?.[k] || '.');

    const parPlace = (n) => (e.joueurs || []).find((j) => j.place === n) || null;
    const nom1 = parPlace(1)?.pseudo || '?';
    const nom2 = parPlace(2)?.pseudo || '?';
    const nomDe = (c) => (c === '1' ? nom1 : nom2);

    const monTour = cadre.monTour(e);
    const peut = !recap && monTour && !st.envoi;
    const cible = v === 'ultime' && p.cible != null && p.cible >= 0 && p.cible <= 8 ? Number(p.cible) : null;
    const cibleOk = cible !== null && petites[cible] === '.';
    const jouable = (i) => {
      if (!peut || g[i] !== '.') return false;
      if (v !== 'ultime') return true;
      const k = Math.floor(i / 9);
      return petites[k] === '.' && (!cibleOk || k === cible);
    };

    const dernier = !recap && p.dernier && p.dernier.case != null ? Number(p.dernier.case) : -1;
    const cleDernier = `${p.id}:${p.manche}:${p.nb_coups}:${dernier}`;
    const masque = recap ? null : st.masque;
    const animer = !recap && masque === null && dernier >= 0 && cleDernier !== st.dernierVu;
    if (!recap && masque === null) st.dernierVu = cleDernier;
    const maMarque = String(e.moi?.place ?? '');

    /** Une case : marque (span) ou case vide (bouton). */
    const caseHtml = (i) => {
      const c = g[i];
      const estDernier = i === dernier;
      if (i === masque) return `<button type="button" class="morpion-case" data-case="${i}" aria-label="${esc(libelleCase(v, w, i))}" disabled></button>`;
      if (c === '.' && st.envoi && st.provisoire === i && (maMarque === '1' || maMarque === '2')) {
        return `<span class="morpion-case is-dernier" data-case="${i}" tabindex="-1" role="img" aria-label="${maMarque === '1' ? 'Croix' : 'Rond'} jouée">${svgMarque(maMarque, true)}</span>`;
      }
      if (c === '1' || c === '2') {
        const etiquette = `${c === '1' ? 'Croix' : 'Rond'} de ${nomDe(c)}`;
        const point = estDernier && v === 'gomoku' ? '<span class="morpion-point" aria-hidden="true"></span>' : '';
        return `<span class="morpion-case${estDernier ? ' is-dernier' : ''}" data-case="${i}" tabindex="-1" role="img" aria-label="${esc(etiquette)}">${svgMarque(c, estDernier && animer)}${point}</span>`;
      }
      const off = jouable(i) ? '' : ' disabled';
      return `<button type="button" class="morpion-case" data-case="${i}" aria-label="${esc(libelleCase(v, w, i))}"${off}></button>`;
    };

    /** Une petite grille de l'ultime, avec son voile si elle est gagnée ou nulle. */
    const petiteHtml = (k) => {
      const etat = petites[k];
      const classes = ['morpion-petite'];
      if (etat === '1' || etat === '2') classes.push('is-gagnee');
      if (etat === '=') classes.push('is-nulle');
      if (peut && cibleOk && k === cible) classes.push('is-cible');
      else if (peut && !cibleOk && etat === '.') classes.push('is-libre');
      let voile = '';
      if (etat === '1' || etat === '2') {
        voile = `<div class="morpion-voile is-${etat === '1' ? 'croix' : 'rond'}">${svgGrande(etat)}<span class="morpion-voile-txt">Gagnée par ${esc(nomDe(etat))}</span></div>`;
      } else if (etat === '=') {
        voile = '<div class="morpion-voile is-nulle"><span class="morpion-voile-txt">Nulle</span></div>';
      }
      const cases = Array.from({ length: 9 }, (_, pos) => caseHtml(k * 9 + pos)).join('');
      return `<div class="${classes.join(' ')}">${cases}${voile}</div>`;
    };

    // Consigne au-dessus du plateau (ultime : grille imposée).
    let consigne = '';
    if (recap) {
      consigne = `<p class="morpion-consigne">Manche ${esc(String(recap.manche))} terminée : grille finale.</p>`;
    } else if (v === 'ultime' && p.statut === 'en_cours') {
      if (monTour && cibleOk) consigne = `<p class="morpion-consigne" aria-live="polite"><strong>Tu dois jouer ici</strong> : grille ${cible + 1}, ${POS[cible]}.</p>`;
      else if (monTour) consigne = '<p class="morpion-consigne" aria-live="polite">Tu peux jouer dans n’importe quelle grille libre.</p>';
      else if (cibleOk) consigne = `<p class="morpion-consigne">Grille imposée : grille ${cible + 1}, ${POS[cible]}.</p>`;
    }

    // Légende : symboles selon la place (croix bleues = place 1, ronds dorés = place 2).
    const monPlace = e.moi?.joue ? e.moi.place : null;
    let legende;
    if (monPlace === 1) legende = `Toi : croix bleues · ${esc(nom2)} : ronds dorés`;
    else if (monPlace === 2) legende = `Toi : ronds dorés · ${esc(nom1)} : croix bleues`;
    else legende = `Croix bleues : ${esc(nom1)} · Ronds dorés : ${esc(nom2)}`;

    const note = v === 'classique' && Number(p.format) === 1
      ? '<p class="morpion-note">Le meilleur des 5 est conseillé : à deux bons joueurs, une manche finit souvent en nul.</p>'
      : '';

    const corps = v === 'ultime'
      ? `<div class="morpion-grand">${Array.from({ length: 9 }, (_, k) => petiteHtml(k)).join('')}</div>`
      : `<div class="morpion-grille" style="grid-template-columns: repeat(${w}, var(--mc))">${Array.from({ length: N }, (_, i) => caseHtml(i)).join('')}</div>`;

    // Cote : règle, et pour l'ultime les petites grilles gagnées par chacun.
    let cote = `<h2 class="duels-h3">Règle</h2><ol class="morpion-regle">${REGLES[v].map((t) => `<li>${esc(t)}</li>`).join('')}</ol>`;
    if (v === 'ultime') {
      const n1 = petites.filter((c) => c === '1').length;
      const n2 = petites.filter((c) => c === '2').length;
      cote += `<h2 class="duels-h3">Petites grilles</h2>
        <p class="morpion-score">${nomJoueur(parPlace(1))} : ${n1} grille${n1 > 1 ? 's' : ''} (croix)</p>
        <p class="morpion-score">${nomJoueur(parPlace(2))} : ${n2} grille${n2 > 1 ? 's' : ''} (ronds)</p>`;
    }
    cadre.cote.innerHTML = cote;

    // Garde le focus sur la case où il était (si elle est encore vide et jouable).
    const foc = cadre.plateau.contains(document.activeElement) ? document.activeElement.dataset?.case : undefined;
    cadre.plateau.innerHTML = `<div class="morpion-tab is-${v}">${consigne}<div class="morpion-defile"${v === 'gomoku' ? ' tabindex="0" role="region" aria-label="Plateau du gomoku, défilable"' : ''}><div class="morpion-cadre">${corps}<svg class="morpion-barre" hidden aria-hidden="true"></svg></div></div>
      <p class="morpion-legende">${legende}</p>${note}</div>`;
    // Forme de la grille affichée (ultime : 9 × 9 visuel, les petites grilles de 3 × 3 ; sinon w × w) et cases affichées.
    st.geo = v === 'ultime'
      ? { lignes: 9, colonnes: 9,
        versRC: (i) => [Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3), (Math.floor(i / 9) % 3) * 3 + (i % 9) % 3],
        versI: (r, c) => (Math.floor(r / 3) * 3 + Math.floor(c / 3)) * 9 + (r % 3) * 3 + (c % 3) }
      : { lignes: w, colonnes: w, versRC: (i) => [Math.floor(i / w), i % w], versI: (r, c) => r * w + c };
    st.par = new Map([...cadre.plateau.querySelectorAll('[data-case]')].map((el) => [Number(el.dataset.case), el]));
    const accessible = (i) => { const el = st.par.get(i); return !!el && !el.disabled; };
    // Une seule case dans l'ordre de tabulation : le curseur, ou la première case accessible.
    if (!accessible(st.curseur)) st.curseur = [...st.par.keys()].find(accessible) ?? 0;
    st.par.forEach((el, k) => { el.tabIndex = k === st.curseur ? 0 : -1; });
    if (foc !== undefined) {
      const el = st.par.get(Number(foc));
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }

    const cadreEl = cadre.plateau.querySelector('.morpion-cadre');
    requestAnimationFrame(() => {
      if (!st.vivant) return;
      // Ultime : le serveur renvoie les petites grilles alignées (0-8) ; on barre de centre de grille à centre de grille.
      if (recap?.ligne?.length) tracerBarre(cadreEl, v === 'ultime' ? recap.ligne.map((k) => Number(k) * 9 + 4) : recap.ligne);
      if (animer) defiler(dernier);
    });
  }

  return {
    /** Met à jour la barre, le journal, le chat, le plateau, la colonne latérale et le statut. */
    maj(e) {
      st.etat = e;
      st.envoi = false;
      cadre.maj(e);
      suivreManche(e);
      // Contre le robot, sa réponse arrive avec mon coup : on la montre 450 ms plus tard, pour voir les deux coups l'un après l'autre.
      const prov = st.provisoire;
      st.provisoire = null;
      const d = e.partie?.dernier?.case;
      if (prov !== null && d != null && Number(d) !== prov && !st.recap && e.partie?.grille?.[prov] === String(e.moi?.place)) {
        st.masque = Number(d);
        clearTimeout(st.tMasque);
        st.tMasque = setTimeout(() => { st.masque = null; if (st.vivant && st.etat) rendre(); }, 450);
      }
      rendre();
      statut(e);
    },
    /** Message du chat. */
    message(m) { cadre.message(m); },
    detruire() {
      st.vivant = false;
      clearTimeout(st.timer);
      clearTimeout(st.tMasque);
      cadre.detruire();
    },
  };
}
