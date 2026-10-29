// ===== Humane Gang — Catan du gang : effets de partie (plateaux/jeux/catan/effets.js) =====
/*
 * Rôle : ce qui se voit et s'entend quand la partie change (maquette validée, « Voir : … ») :
 *   - dés qui roulent à chaque nouveau lancer (le sien ou celui d'un autre) ;
 *   - tuiles qui produisent qui s'illuminent ;
 *   - ressources qui volent vers « Ta main » (les tiennes seulement) ;
 *   - route ou colonie qui apparaît, ville qui apparaît ;
 *   - voleur déplacé ;
 *   - « à toi de jouer » : ton siège et le bouton « Lancer les dés » qui pulsent (le son et l'onglet restent dans
 *     commun/tour-signal.js, à ne pas dupliquer ici).
 *   Tout part d'un vrai changement entre deux états : changements(avant, apres) compare ; le premier état reçu
 *   n'anime rien (la table ne le passe pas avec un état « avant »). Sons : jouerSonJeu('catan', n) (sons-jeux.js).
 *   Mouvement réduit (motionAllowed) : aucune animation, mais les sons restent. Les calques ajoutés sont en
 *   pointer-events: none, retirés en 2,5 s au plus, et ne bloquent jamais le jeu.
 * Dépendances : commun/core.js (motionAllowed), commun/sons-jeux.js (jouerSonJeu), ./plateau.js (RESSOURCES).
 * Exporte : changements(avant, apres, moi) -> fx (ou null sans état précédent) ; jouerEffets(fx, zones, { aToi }).
 *   zones = { plateau, panneau, main, bandeau } (éléments de la table) ; fx = { lancer, produits, jetons, routes,
 *   batiments, voleur, des }.
 */
import { motionAllowed } from '../../../../commun/core.js';
import { jouerSonJeu } from '../../../../commun/sons-jeux.js';
import { RESSOURCES } from './plateau.js';

/** Nombre maximal de ressources qui volent vers la main (au-delà, on n'en montre pas davantage). */
const MAX_JETONS = 6;

/** Deux dés valides (nombres) ? Le serveur envoie « ? » tant qu'il n'y a pas eu de lancer. */
const valides = (d) => Array.isArray(d) && d.length === 2 && Number.isFinite(d[0]) && Number.isFinite(d[1]);
const memes = (a, b) => a[0] === b[0] && a[1] === b[1];
const cles = (t) => Object.keys(t || {});

/**
 * Ce qui a changé entre deux états de la partie.
 * @param {object} avant état précédent (etat.jeu et etat.moi, comme reçu par la table).
 * @param {object} apres nouvel état.
 * @param {string|number|null} moi identifiant du joueur qui regarde (etat.moi.user_id).
 * @returns {{ lancer: boolean, produits: string[], jetons: {hexe: string, res: string}[], routes: string[],
 *   batiments: string[], voleur: boolean }|null} null si l'un des états manque.
 */
export function changements(avant, apres, moi) {
  const a = avant?.jeu;
  const b = apres?.jeu;
  if (!a || !b) return null;
  const estMoi = (u) => u != null && moi != null && String(u) === String(moi);
  const fx = { lancer: false, des: null, produits: [], jetons: [], routes: [], batiments: [], voleur: false };

  // Nouveau lancer : les dés changent, ou la phase quitte « lancer » (donc il y a eu un lancer).
  const dA = a.de;
  const dB = b.de;
  if (valides(dB) && (!valides(dA) || !memes(dA, dB) || (a.phase === 'lancer' && b.phase !== 'lancer'))) {
    fx.lancer = true;
    fx.des = dB;
  }

  if (fx.lancer) {
    // Tuiles qui produisent : numéro = total, pas de voleur dessus, pas le désert.
    const tuiles = b.tuiles || {};
    const total = dB[0] + dB[1];
    fx.produits = cles(tuiles).filter((h) => Number(tuiles[h]?.num) === total && tuiles[h]?.res !== 'desert' &&
      String(b.voleur) !== String(h));

    // Ressources reçues par moi : une par bâtiment touchant la tuile (ville : deux), dans la limite du gain.
    const r0 = a.mes_ressources || {};
    const r1 = b.mes_ressources || {};
    const gagnes = {};
    Object.keys(r1).forEach((k) => {
      const d = (Number(r1[k]) || 0) - (Number(r0[k]) || 0);
      if (d > 0) gagnes[k] = d;
    });
    const H = new Map((b.geo?.hexes || []).map((h) => [String(h.id), h]));
    const mien = (v) => (estMoi(b.villes?.[v]) ? 2 : estMoi(b.colonies?.[v]) ? 1 : 0);
    for (const h of fx.produits) {
      const res = tuiles[h].res;
      const hx = H.get(String(h));
      if (!hx || !gagnes[res]) continue;
      const touches = (hx.sommets || []).reduce((s, v) => s + mien(v), 0);
      const n = Math.min(touches, gagnes[res], MAX_JETONS - fx.jetons.length);
      for (let i = 0; i < n; i++) fx.jetons.push({ hexe: String(h), res });
      gagnes[res] -= n;
      if (fx.jetons.length >= MAX_JETONS) break;
    }
  }

  // Constructions : routes, colonies, villes qui n'existaient pas dans l'état précédent.
  fx.routes = cles(b.routes).filter((k) => a.routes?.[k] == null);
  const nouveaux = (x, y) => cles(y).filter((k) => x?.[k] == null);
  fx.batiments = [...new Set([...nouveaux(a.colonies, b.colonies), ...nouveaux(a.villes, b.villes)])];

  // Voleur déplacé.
  fx.voleur = a.voleur !== undefined && b.voleur !== undefined && String(a.voleur) !== String(b.voleur);
  return fx;
}

/** Ajoute une classe d'effet à un élément et la retire après ms (le calque ne reste jamais en place). */
function marquer(el, cls, ms) {
  if (!el) return;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

/**
 * Ressources qui volent de leur tuile vers « Ta main ». Calques fixes, sans interaction, retirés après leur vol.
 * @param {{hexe: string, res: string}[]} jetons ressources à faire voler.
 * @param {HTMLElement} plateau zone du plateau (tuiles en [data-hex]).
 * @param {HTMLElement} main zone « Ta main ».
 */
function voler(jetons, plateau, main) {
  const cible = main?.getBoundingClientRect();
  if (!cible || !plateau) return;
  jetons.forEach((j, i) => {
    setTimeout(() => {
      const src = plateau.querySelector(`[data-hex="${Number(j.hexe)}"] .ct-hex`);
      if (!src) return;
      const r = src.getBoundingClientRect();
      const x0 = r.left + r.width / 2;
      const y0 = r.top + r.height / 2;
      const el = document.createElement('span');
      el.className = 'ct-jeton-vol';
      el.setAttribute('aria-hidden', 'true');
      el.style.background = RESSOURCES[j.res]?.couleur || '#F2EFEA';
      el.style.left = `${x0 - 9}px`;
      el.style.top = `${y0 - 9}px`;
      document.body.append(el);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        el.style.transform = `translate(${cible.left + cible.width / 2 - x0}px, ${cible.top + cible.height / 2 - y0}px) scale(.7)`;
        el.style.opacity = '.3';
      }));
      setTimeout(() => el.remove(), 1200);
    }, 200 + i * 180);
  });
  setTimeout(() => marquer(main, 'ct-touche', 2400), 1400);
}

/**
 * Deux dés qui roulent au-dessus du plateau, puis s'arrêtent sur le lancer. Calque temporaire (pointer-events: none),
 * retiré après 1 s : les dés du panneau ne sont pas toujours affichés (phase « action »), il faut donc les montrer ici.
 * @param {number[]} des les deux faces du lancer.
 * @param {HTMLElement} plateau zone du plateau.
 */
function rouler(des, plateau) {
  const cadre = plateau?.closest('.ct-zone-plateau') || plateau;
  if (!cadre) return;
  const calque = document.createElement('div');
  calque.className = 'ct-des-vol';
  calque.setAttribute('aria-hidden', 'true');
  calque.innerHTML = des.map((f) => `<span class="ct-de">${Number(f)}</span>`).join('');
  cadre.append(calque);
  setTimeout(() => calque.remove(), 1000);
}

/**
 * Joue les effets d'un changement dans les zones de la table. Ne lève jamais d'erreur bloquante.
 * @param {object|null} fx résultat de changements() ; null ne fait rien.
 * @param {{plateau: HTMLElement, panneau: HTMLElement, main: HTMLElement, bandeau: HTMLElement}} zones
 * @param {{ aToi?: boolean }} [opts] aToi : c'est devenu mon tour (siège et bouton « Lancer » pulsent).
 */
export function jouerEffets(fx, zones, { aToi = false } = {}) {
  if (!fx && !aToi) return;
  const anime = motionAllowed();
  try {
    if (fx?.lancer) {
      jouerSonJeu('catan', 1);
      // Le lancer local a déjà sa propre animation (animerDes) : on ne la double pas.
      if (anime) rouler(fx.des, zones.plateau);
      if (anime) fx.produits.forEach((h) => zones.plateau?.querySelectorAll(`[data-hex="${Number(h)}"] .ct-hex`)
        .forEach((p) => marquer(p, 'ct-produit', 2400)));
    }
    if (fx?.jetons.length) {
      jouerSonJeu('catan', 2);
      if (anime) voler(fx.jetons, zones.plateau, zones.main);
    }
    if (fx?.routes.length || fx?.batiments.length) {
      if (fx.routes.length) jouerSonJeu('catan', 3);
      if (fx.batiments.length) jouerSonJeu('catan', 4);
      if (anime) {
        fx.routes.forEach((r) => zones.plateau?.querySelectorAll(`[data-route="${Number(r)}"]`)
          .forEach((el) => marquer(el, 'ct-neuf', 700)));
        fx.batiments.forEach((b) => zones.plateau?.querySelectorAll(`[data-batiment="${Number(b)}"]`)
          .forEach((el) => marquer(el, 'ct-neuf', 700)));
      }
    }
    if (fx?.voleur) {
      jouerSonJeu('catan', 5);
      if (anime) zones.plateau?.querySelectorAll('.ct-voleur').forEach((el) => marquer(el, 'ct-arrive', 800));
    }
    if (aToi && anime) {
      zones.bandeau?.querySelectorAll('.plat-bandeau-joueur').forEach((li) => {
        if (/À toi de jouer/.test(li.textContent)) marquer(li, 'ct-a-toi', 2500);
      });
      zones.panneau?.querySelectorAll('[data-lancer]').forEach((b) => marquer(b, 'ct-a-toi', 2500));
    }
  } catch (e) {
    console.warn('[catan effets]', e);
  }
}
