// Casse-briques (eggs/jeu-briques.js) : règles, cadence serveur et codes de triche, sans navigateur : node tests/arcade-briques.mjs
// Le générateur aléatoire est remplacé par une suite déterministe (graines fixes) pour que le test se répète à l'identique.
import { JEU as B } from '../assets/js/eggs/jeu-briques.js';
import { simule } from './lib/faux-canevas.mjs';
let ok = 0, ko = 0;
const check = (c, m) => { if (c) { ok++; console.log('OK     ' + m); } else { ko++; console.log('ECHEC  ' + m); } };

/** Remplace Math.random par une suite déterministe (mulberry32), le temps de fn. */
function avecGraine(graine, fn) {
  const reel = Math.random;
  let g = graine >>> 0;
  Math.random = () => {
    g = (g + 0x6D2B79F5) >>> 0;
    let t = g;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { return fn(); } finally { Math.random = reel; }
}

const CADENCE_SERVEUR = 40, CIBLE = 20; // points par seconde : plafond serveur, et cible de conception (en pic)
const VAL_MAX_ARRONDI = 15; // une seconde de compteur à 14 points, plus l'arrondi
/** Joueur adroit : la raquette va sous la balle un peu en avance sur sa trajectoire, et relance la balle à chaque occasion. */
const adroit = (s) => ({ cible: s.bx + s.vx * 0.25, action: s.attente });
/** Joueur maladroit : la raquette ne bouge jamais ; il lance la balle, puis la relance à chaque vie perdue. */
const maladroit = (s) => ({ cible: null, action: s.attente });
const triche = (coeurs, immortel) => ({ coeurs, immortel });

// 1. Joueur adroit, 120 s : pas d'exception, score plausible, niveaux qui passent.
let r1 = null, erreur1 = null;
avecGraine(1, () => {
  try { r1 = simule(B, { secondes: 120, triche: triche(false, false), entree: adroit }); } catch (e) { erreur1 = e; }
});
check(!erreur1, `joueur adroit : 120 s sans exception${erreur1 ? ' (' + erreur1.message + ')' : ''}`);
const sc1 = B.score(r1.s);
console.log(`       adroit : score ${sc1}, ${(sc1 / r1.t).toFixed(1)} par seconde, niveau ${r1.s.niveau}, vies ${r1.s.vies}, vitesse ${r1.s.vit.toFixed(0)}`);
check(Number.isInteger(sc1) && sc1 >= 100 && sc1 <= 14 * r1.t + VAL_MAX_ARRONDI, `joueur adroit : score entier et plausible (${sc1}, au plus la cadence du compteur)`);
// 1 bis. Niveau suivant : une partie plus longue (400 s, même graine) passe au moins un niveau, la vitesse reste plafonnée.
const r1b = avecGraine(1, () => simule(B, { secondes: 400, triche: triche(false, false), entree: adroit }));
check(r1b.s.niveau >= 2 && r1b.s.vit <= 320 + 1e-9, `joueur adroit : niveau suivant atteint en 400 s (niveau ${r1b.s.niveau}, vitesse ${r1b.s.vit.toFixed(0)} px/s)`);

// 2. Cadence : jamais plus de CIBLE points par seconde, et jamais au-dessus du plafond serveur.
check(r1.maxParSeconde <= CIBLE && sc1 / r1.t <= CIBLE, `joueur adroit : pic ${r1.maxParSeconde} par seconde, moyenne ${(sc1 / r1.t).toFixed(1)} (cible ${CIBLE}, serveur ${CADENCE_SERVEUR})`);
check(r1.s.vit <= 320 + 1e-9, `vitesse de balle plafonnée (${r1.s.vit.toFixed(0)} px/s)`);

// 3. Codes de triche : la partie continue même en jouant mal (balle qui rebondit sur le bas, aucune vie perdue).
const r2 = avecGraine(2, () => simule(B, { secondes: 120, triche: triche(true, false), entree: maladroit }));
check(!B.fini(r2.s) && r2.s.vies === 3, `code « domu » : 120 s en jouant mal, partie en cours, 3 vies (score ${B.score(r2.s)})`);
check(r2.maxParSeconde <= CIBLE, `code « domu » : pic ${r2.maxParSeconde} par seconde`);
const r3 = avecGraine(3, () => simule(B, { secondes: 120, triche: triche(false, true), entree: maladroit }));
check(!B.fini(r3.s) && r3.s.vies === 3, `code immortel : 120 s en jouant mal, partie en cours, 3 vies (score ${B.score(r3.s)})`);
check(r3.maxParSeconde <= CIBLE, `code immortel : pic ${r3.maxParSeconde} par seconde`);

// 4. Sans code et sans bouger la raquette : la balle se perd, la partie finit.
const finies = [11, 12, 13].map((g) => avecGraine(g, () => simule(B, { secondes: 300, triche: triche(false, false), entree: maladroit })));
check(finies.every((r) => B.fini(r.s) && r.s.vies === 0), `sans code, raquette immobile : la partie finit (durées ${finies.map((r) => r.t.toFixed(0) + ' s').join(', ')})`);
check(finies.every((r) => r.maxParSeconde <= CIBLE), `sans code, raquette immobile : pic ${Math.max(...finies.map((r) => r.maxParSeconde))} par seconde au plus`);

console.log(`\n${ok} OK, ${ko} ECHEC(S)`);
process.exit(ko ? 1 : 0);
