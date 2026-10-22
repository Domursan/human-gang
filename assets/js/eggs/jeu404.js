// ===== Humane Gang — secret de la page 404 : le jeu des paillettes =====
/*
 * Rôle : petit jeu sur la page introuvable (404.html). Des paillettes (étoiles dorées) tombent ; le joueur déplace
 * le chapeau du gang (souris, doigt ou flèches) pour les attraper pendant 30 secondes. Fin de partie avec au moins
 * une paillette : le score est signalé au serveur (secret « jeu404 », une récompense par jour). Sans compte, le jeu
 * reste jouable et un message invite à se connecter.
 * Effets : la rafale d'étincelles est retirée si l'utilisateur demande moins d'animations (prefers-reduced-motion).
 * Page : 404.html uniquement (module chargé en fin de page).
 * Dépendances : eggs/api.js (eggFound), core/supabase.js (hasSession).
 * Exporte : rien (effets de bord : dessine et lance le jeu sur le canevas #jeu-canvas).
 */
import { eggFound } from './api.js';
import { hasSession } from '../core/supabase.js';

/* ---------- Constantes ---------- */

/** Taille logique du canevas (en pixels CSS) ; la taille réelle suit le rapport de pixels de l'écran. */
const W = 360, H = 420;
/** Durée d'une partie, en secondes. */
const DUREE = 30;
/** Hauteur du bord supérieur du chapeau : une paillette qui atteint cette ligne peut être attrapée. */
const SOL = H - 52;
/** Demi-largeur du chapeau (zone de capture horizontale). */
const DEMI = 36;
/** Couleurs du jeu (palette du site). */
const OR = '#FBD32D', COURONNE = '#9E3543', BANDE = '#E2C77E', BORD = '#F2EFEA';

/* ---------- Éléments de la page ---------- */

const canvas = document.getElementById('jeu-canvas');
const scoreEl = document.getElementById('jeu-score');
const tempsEl = document.getElementById('jeu-temps');
const bouton = document.getElementById('jeu-bouton');
const message = document.getElementById('jeu-message');
if (canvas && scoreEl && tempsEl && bouton && message) demarrageJeu();

/**
 * Initialise le jeu : taille du canevas, écouteurs (souris, doigt, clavier, bouton) et premier dessin.
 * Appelée une seule fois, quand la page contient le canevas.
 */
function demarrageJeu() {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* État de la partie */
  let etat = 'attente'; // 'attente' | 'jeu' | 'fin'
  let score = 0, ecoule = 0, restant = DUREE, pousse = 0;
  let dernierT = null, raf = 0;
  let chapeau = W / 2, cible = W / 2, fleche = 0;
  let paillettes = [], eclats = [];

  /** Borne une valeur entre min et max. */
  const borne = (v, min, max) => Math.min(max, Math.max(min, v));

  /** Nouvelle paillette : en haut du canevas, à une position au hasard, plus rapide au fil de la partie. */
  const nouvelle = () => ({
    x: 14 + Math.random() * (W - 28), y: -14,
    v: 90 + ecoule * 3 + Math.random() * 30,
    r: 7 + Math.random() * 5, t: Math.random() * 6,
  });

  /** Rafale d'étincelles à l'endroit d'une paillette attrapée (aucune si l'animation est réduite). */
  const rafale = (x, y) => {
    if (reduit) return;
    for (let i = 0; i < 6; i++) {
      const a = (Math.PI * 2 * i) / 6 + Math.random() * 0.5;
      eclats.push({ x, y, vx: Math.cos(a) * 80, vy: Math.sin(a) * 80 - 40, vie: 0.5 });
    }
  };

  /** Position horizontale du chapeau visée par un pointeur (souris ou doigt), en coordonnées du canevas. */
  const visee = (e) => {
    const r = canvas.getBoundingClientRect();
    return borne(((e.clientX - r.left) / r.width) * W, DEMI - 4, W - DEMI + 4);
  };

  /**
   * Avance la partie d'un pas de temps : déplacement du chapeau, apparition et chute des paillettes,
   * captures, étincelles, compteurs.
   * @param {number} dt durée écoulée depuis la dernière image, en secondes
   */
  const miseAJour = (dt) => {
    ecoule += dt;
    restant = Math.max(0, DUREE - ecoule);
    if (fleche) cible = borne(cible + fleche * 280 * dt, DEMI - 4, W - DEMI + 4);
    chapeau += (cible - chapeau) * Math.min(1, dt * 14);
    pousse += dt;
    if (pousse >= Math.max(0.3, 0.7 - ecoule * 0.01)) { pousse = 0; paillettes.push(nouvelle()); }
    for (const p of paillettes) { p.y += p.v * dt; p.t += dt; }
    paillettes = paillettes.filter((p) => {
      if (p.y >= SOL && p.y <= H - 24 && Math.abs(p.x - chapeau) < DEMI) {
        score++;
        rafale(p.x, p.y);
        return false;
      }
      return p.y < H + 20;
    });
    for (const e of eclats) { e.vie -= dt; e.x += e.vx * dt; e.y += e.vy * dt; e.vy += 220 * dt; }
    eclats = eclats.filter((e) => e.vie > 0);
    afficheHud();
  };

  /** Met à jour le score et le temps restant affichés (seulement s'ils ont changé). */
  const afficheHud = () => {
    const s = String(score), t = String(Math.ceil(restant));
    if (scoreEl.textContent !== s) scoreEl.textContent = s;
    if (tempsEl.textContent !== t) tempsEl.textContent = t;
  };

  /** Trace une étoile à quatre branches (centre x, y ; rayon r). */
  const etoile = (x, y, r) => {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y);
    ctx.quadraticCurveTo(x, y, x, y - r);
    ctx.closePath();
  };

  /** Trace le chapeau du gang centré sur x (couronne, bande, bord). */
  const chapeauDessin = (x) => {
    const y = H - 30;
    ctx.fillStyle = COURONNE;
    ctx.fillRect(x - 18, y - 24, 36, 20);
    ctx.fillStyle = BANDE;
    ctx.fillRect(x - 18, y - 8, 36, 4);
    ctx.fillStyle = BORD;
    ctx.beginPath();
    ctx.ellipse(x, y - 2, 34, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  /** Dessine une image : paillettes, étincelles et chapeau. */
  const dessine = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = OR;
    for (const p of paillettes) {
      etoile(p.x, p.y, p.r * (0.85 + 0.15 * Math.sin(p.t * 6)));
      ctx.fill();
    }
    ctx.fillStyle = OR;
    for (const e of eclats) {
      ctx.globalAlpha = Math.max(0, e.vie / 0.5);
      ctx.beginPath();
      ctx.arc(e.x, e.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    chapeauDessin(chapeau);
  };

  /** Boucle d'animation : une image par rafraîchissement d'écran, tant que la partie dure. */
  const boucle = (t) => {
    const dt = dernierT === null ? 0 : Math.min(0.05, (t - dernierT) / 1000);
    dernierT = t;
    if (etat !== 'jeu') return;
    miseAJour(dt);
    if (restant <= 0) { fin(); return; }
    dessine();
    raf = requestAnimationFrame(boucle);
  };

  /** Lance une partie (depuis le bouton, un clic ou une flèche). Sans effet pendant une partie. */
  const demarre = () => {
    if (etat === 'jeu') return;
    etat = 'jeu';
    score = 0; ecoule = 0; restant = DUREE; pousse = 0;
    chapeau = W / 2; cible = W / 2; fleche = 0;
    paillettes = []; eclats = []; dernierT = null;
    scoreEl.textContent = '0';
    tempsEl.textContent = String(DUREE);
    message.textContent = '';
    bouton.hidden = true;
    canvas.focus({ preventScroll: true });
    raf = requestAnimationFrame(boucle);
  };

  /**
   * Termine la partie : affiche le score, propose de rejouer et signale le score au serveur
   * (une récompense par jour). Sans compte, un message invite à se connecter.
   */
  const fin = async () => {
    etat = 'fin';
    cancelAnimationFrame(raf);
    restant = 0;
    afficheHud();
    dessine();
    bouton.textContent = 'Rejouer';
    bouton.hidden = false;
    if (score < 1) { message.textContent = 'Aucune paillette cette fois. Rejoue, le chapeau est patient !'; return; }
    message.textContent = `Tu as attrapé ${score} paillette${score > 1 ? 's' : ''} !`;
    if (!(await hasSession())) { message.textContent += ' Connecte-toi pour gagner des Paillettes.'; return; }
    eggFound('jeu404', { score });
  };

  /* ---------- Commandes ---------- */

  // Souris et doigt : le chapeau suit le pointeur ; un appui lance la partie (et le doigt ne fait pas défiler la page).
  canvas.addEventListener('pointermove', (e) => { cible = visee(e); });
  canvas.addEventListener('pointerdown', (e) => {
    cible = visee(e);
    if (etat !== 'jeu') demarre();
  });

  // Clavier : flèches gauche et droite (la page ne défile pas) ; la première flèche lance la partie.
  canvas.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    fleche = e.key === 'ArrowLeft' ? -1 : 1;
    if (etat !== 'jeu') demarre();
  });
  canvas.addEventListener('keyup', (e) => {
    if ((e.key === 'ArrowLeft' && fleche < 0) || (e.key === 'ArrowRight' && fleche > 0)) fleche = 0;
  });
  canvas.addEventListener('blur', () => { fleche = 0; });

  bouton.addEventListener('click', demarre);

  dessine();
}
