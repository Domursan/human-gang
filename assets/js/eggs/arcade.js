// ===== Humane Gang — petit moteur d'arcade (canevas) =====
/*
 * Rôle : boucle, entrées et cycle de vie communs aux mini-jeux de l'arcade (idée J18) : canevas net sur écran haute
 * densité, une image par rafraîchissement, commandes (souris, doigt, glisser, flèches), pause automatique quand
 * l'onglet est masqué, « réduire les animations » (jeu plus lent, pas de secousse), fin de partie.
 * Les règles de chaque mini-jeu sont dans eggs/jeu-paillettes.js, eggs/jeu-raclette.js, eggs/jeu-domu.js.
 * Pas de limite de temps : une partie finit quand le jeu le dit (plus de vies, ou accrochage).
 * Codes de triche cachés (pour toute la page, jusqu'au rechargement ; retaper le code l'annule), à taper sur la borne :
 *   « domu » (lettres)                    → s.triche.coeurs : plus aucun piège, tout ce qui s'attrape devient un cœur rouge ;
 *   → → ← ← ↓ ↑ ↓ ↑ (flèches)            → s.triche.immortel : les pièges et accrochages ne coûtent plus rien.
 *   Pendant une partie d'un jeu qui utilise haut et bas (jeu.directions ou jeu.action), flèches et glissements servent
 *   au jeu et ne comptent pas pour les codes (ailleurs, ils comptent) ;
 *   « domu » peut se taper à tout moment.
 *   Chaque mini-jeu lit s.triche (même objet pendant toute la partie : un code tapé en jeu s'applique tout de suite).
 *   Une partie jouée avec un code compte comme les autres (record, classement, Paillettes).
 * Exporte : W, H (taille logique du canevas), creeArcade(options), etoile(ctx, x, y, r) et coeur(ctx, x, y, r, couleur)
 * (sprites partagés), triche (état des codes).
 */

/** Taille logique du canevas (pixels CSS) ; la taille réelle suit la densité de l'écran. */
export const W = 360, H = 420;

/**
 * Trace une étoile à quatre branches (la paillette du site).
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {number} x centre
 * @param {number} y centre
 * @param {number} r rayon
 */
export function etoile(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.closePath();
}

/**
 * Trace un cœur plein (le cœur du gang), centré en (x, y).
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {number} x centre
 * @param {number} y centre
 * @param {number} r demi-largeur
 * @param {string} [couleur]
 */
export function coeur(ctx, x, y, r, couleur = '#E0303F') {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.95);
  ctx.bezierCurveTo(x - r * 1.35, y + r * 0.05, x - r * 0.95, y - r * 1.05, x, y - r * 0.4);
  ctx.bezierCurveTo(x + r * 0.95, y - r * 1.05, x + r * 1.35, y + r * 0.05, x, y + r * 0.95);
  ctx.closePath();
  ctx.fillStyle = couleur; ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.beginPath(); ctx.ellipse(x - r * 0.42, y - r * 0.35, r * 0.18, r * 0.12, -0.6, 0, Math.PI * 2); ctx.fill();
}

/** Codes de triche actifs (partagés par toutes les bornes de la page). */
export const triche = { coeurs: false, immortel: false };
const CODES = [
  { cle: 'coeurs', suite: ['d', 'o', 'm', 'u'], nom: 'Mode Domu' },
  { cle: 'immortel', suite: ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'ArrowDown', 'ArrowUp'], nom: 'Immortel' },
];

/**
 * Crée une borne d'arcade sur un canevas pour un mini-jeu.
 * Le mini-jeu est un objet { init(s), update(s, dt, entree), draw(ctx, s), score(s), fini(s), vies(s) } :
 *   s est l'état de la partie (créé par init), entree = { cible, cibleY, fleche, pas, vertical, dir, action, tenu } :
 *   cible : position horizontale visée par le pointeur (ou null), fleche : -1, 0 ou 1 (flèche tenue),
 *   pas : -1 ou 1 pour un changement de voie ponctuel (flèche pressée, appui à gauche ou à droite, glissement), sinon 0.
 *   Options du mini-jeu (facultatives) :
 *   jeu.directions = true : les flèches haut et bas servent au jeu (la page ne défile pas) ; entree.vertical = -1 (haut),
 *     0 ou 1 (bas) tant qu'une flèche est tenue ; entree.dir = 'haut' | 'bas' | 'gauche' | 'droite' pour une flèche
 *     pressée ou un glissement du doigt (une seule image, puis null) ; cibleY = position verticale du pointeur (ou null).
 *   jeu.action = true : espace, flèche haut (si pas jeu.directions), clic ou appui du doigt donnent entree.action = true
 *     pendant une image (saut, tir, rotation…) ; entree.tenu = vrai tant que l'espace ou le doigt reste appuyé.
 *   jeu.tapeSeul = true (avec jeu.action) : au doigt et à la souris, l'action vient d'une TAPE (appui court sans glisser,
 *     au relâcher) et non de l'appui : un glissement ne déclenche pas d'action.
 *   entree.glisse = true pendant l'image où entree.dir vient d'un glissement du doigt (et non d'une flèche du clavier).
 *   Les codes de triche restent actifs : les flèches tapées comptent aussi pour eux.
 * @param {{canvas: HTMLCanvasElement, jeu: object, onHud?: Function, onFin?: Function, onDebut?: Function}} o
 *   onHud(score, vies) à chaque image, vies étant { left, max } ou null (pas de vies) ;
 *   onFin(score, s) à la fin ; onDebut() au lancement.
 * @returns {{demarre: Function, arrete: Function, pause: Function, enJeu: Function, dessine: Function}}
 */
export function creeArcade({ canvas, jeu, onHud = () => {}, onFin = () => {}, onDebut = () => {} }) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const reduit = matchMedia('(prefers-reduced-motion: reduce)').matches;

  let etat = 'attente'; // 'attente' | 'jeu' | 'pause' | 'fin'
  let s = jeu.init({ reduit });
  s.triche = triche;
  let dernierT = null, raf = 0;
  const touches = []; // dernières touches (codes de triche)
  let bandeau = null; // { texte, t } : message « code activé » affiché un instant
  const entree = { cible: null, cibleY: null, fleche: 0, pas: 0, vertical: 0, dir: null, glisse: false, action: false, tenu: false };
  let depart = null; // appui du doigt (pour reconnaître un glissement)
  let manuelle = false; // pause demandée par le joueur (l'onglet visible ne la lève pas)

  /** Position horizontale (coordonnées du canevas) d'un pointeur. */
  const posX = (e) => {
    const r = canvas.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * W;
  };

  /** Fond de borne : damier sombre en pixel art (le jeu peut le recouvrir, comme la route de Domu-mobile). */
  const fond = () => {
    ctx.fillStyle = '#14122a'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#18162f';
    for (let y = 0; y < H; y += 24) for (let x = (y / 24) % 2 ? 24 : 0; x < W; x += 48) ctx.fillRect(x, y, 24, 24);
  };
  /** Pastilles des codes actifs (coin haut gauche) et message d'activation. */
  const surcouche = () => {
    // Pastilles en haut au centre (le score est en haut à gauche, les vies en haut à droite).
    const n = (triche.coeurs ? 1 : 0) + (triche.immortel ? 1 : 0);
    let x = W / 2 - (n * 22) / 2 + 11;
    if (triche.coeurs) { coeur(ctx, x, 16, 7); x += 22; }
    if (triche.immortel) { ctx.fillStyle = '#FBD32D'; ctx.font = 'bold 18px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('∞', x, 16); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'start'; }
    if (bandeau) {
      const a = Math.max(0, 1 - (performance.now() - bandeau.t) / 1800);
      if (a <= 0) { bandeau = null; return; }
      ctx.globalAlpha = a;
      ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(0, H / 2 - 26, W, 52);
      ctx.fillStyle = '#F2EFEA'; ctx.font = '18px "Archivo Black", system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(bandeau.texte, W / 2, H / 2 + 7); ctx.textAlign = 'start';
      ctx.globalAlpha = 1;
    }
  };
  const dessine = () => { ctx.clearRect(0, 0, W, H); fond(); jeu.draw(ctx, s); surcouche(); };

  /** Note une touche ; si les dernières forment un code, il s'active (ou se désactive). */
  const noteTouche = (k) => {
    touches.push(k.length === 1 ? k.toLowerCase() : k);
    if (touches.length > 8) touches.shift();
    for (const c of CODES) {
      const fin = touches.slice(-c.suite.length);
      if (fin.length === c.suite.length && fin.every((t, i) => t === c.suite[i])) {
        triche[c.cle] = !triche[c.cle];
        touches.length = 0;
        bandeau = { texte: `${c.nom} ${triche[c.cle] ? 'activé' : 'désactivé'}`, t: performance.now() };
        if (etat !== 'jeu') { dessine(); const re = () => { if (etat === 'jeu' || !bandeau) return; dessine(); requestAnimationFrame(re); }; requestAnimationFrame(re); }
      }
    }
  };

  /** Une image : avance le jeu, affiche, termine si le jeu le dit. */
  const boucle = (t) => {
    if (etat !== 'jeu') return;
    const dt = dernierT === null ? 0 : Math.min(0.05, (t - dernierT) / 1000);
    dernierT = t;
    jeu.update(s, dt, entree);
    entree.pas = 0; entree.dir = null; entree.glisse = false; entree.action = false;
    onHud(jeu.score(s), jeu.vies(s));
    dessine();
    if (jeu.fini(s)) { fin(); return; }
    raf = requestAnimationFrame(boucle);
  };

  /** Lance une partie (sans effet pendant une partie). */
  const demarre = () => {
    if (etat === 'jeu' || etat === 'pause') return;
    s = jeu.init({ reduit });
    s.triche = triche;
    entree.cible = null; entree.cibleY = null; entree.fleche = 0; entree.pas = 0; entree.vertical = 0; entree.dir = null; entree.action = false; entree.tenu = false;
    dernierT = null; manuelle = false;
    etat = 'jeu';
    onDebut();
    onHud(jeu.score(s), jeu.vies(s));
    canvas.focus({ preventScroll: true });
    raf = requestAnimationFrame(boucle);
  };

  /** Fin de partie : dernière image, puis rappel onFin(score). */
  const fin = () => {
    etat = 'fin';
    cancelAnimationFrame(raf);
    dessine();
    onFin(jeu.score(s), s);
  };

  /** Pause demandée par le joueur (bouton) : true si la partie est maintenant en pause. */
  const pause = () => {
    if (etat === 'jeu') { etat = 'pause'; manuelle = true; cancelAnimationFrame(raf); return true; }
    if (etat === 'pause') { etat = 'jeu'; manuelle = false; dernierT = null; canvas.focus({ preventScroll: true }); raf = requestAnimationFrame(boucle); }
    return false;
  };
  /** Arrête la borne (onglet quitté) sans fin de partie. */
  const arrete = () => { cancelAnimationFrame(raf); etat = 'attente'; document.removeEventListener('visibilitychange', visibilite); document.removeEventListener('keydown', codesClavier, true); };

  /** Vrai pendant une partie d'un jeu qui utilise haut et bas (Snake, Tetris, Flappy…) : flèches et glissements jouent. */
  const flechesAuJeu = () => etat === 'jeu' && !!(jeu.directions || jeu.action);

  /* ---------- Codes de triche : clavier n'importe où sur la page (la borne visible), glissements sur la borne ---------- */
  const codesClavier = (e) => {
    if (!canvas.isConnected || !canvas.offsetParent || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t instanceof Element && t !== canvas && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
    // Pendant une partie d'un jeu où haut et bas servent (directions ou action), les flèches ne comptent pas pour
    // les codes : une suite de déplacements activerait « immortel » sans le vouloir. Les lettres comptent toujours.
    if (!(flechesAuJeu() && e.key.startsWith('Arrow'))) noteTouche(e.key);
    // Haut et bas ne servent qu'aux codes : la page ne défile pas pendant qu'on joue ou qu'on tape un code.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown' || (e.key === ' ' && jeu.action)) && (document.activeElement === canvas || etat === 'jeu')) e.preventDefault();
  };
  document.addEventListener('keydown', codesClavier, true);

  /** Onglet masqué : pause ; de retour : reprise (le temps masqué ne compte pas). */
  const visibilite = () => {
    if (document.hidden && etat === 'jeu') { etat = 'pause'; cancelAnimationFrame(raf); }
    else if (!document.hidden && etat === 'pause' && !manuelle) { etat = 'jeu'; dernierT = null; raf = requestAnimationFrame(boucle); }
  };
  document.addEventListener('visibilitychange', visibilite);

  /* ---------- Commandes ---------- */
  /** Position verticale (coordonnées du canevas) d'un pointeur. */
  const posY = (e) => {
    const r = canvas.getBoundingClientRect();
    return ((e.clientY - r.top) / r.height) * H;
  };
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || depart) { entree.cible = posX(e); entree.cibleY = posY(e); } });
  canvas.addEventListener('pointerdown', (e) => {
    const x = posX(e);
    depart = { x, y: ((e.clientY - canvas.getBoundingClientRect().top) / canvas.getBoundingClientRect().height) * H, t: performance.now() };
    entree.cible = x; entree.cibleY = posY(e);
    if (etat === 'pause') return;
    if (etat !== 'jeu') { demarre(); return; }
    if (jeu.action && !jeu.tapeSeul) { entree.action = true; entree.tenu = true; }
    if (jeu.voies) entree.pas = x < W / 2 ? -1 : 1; // jeu à voies : appui à gauche ou à droite
  });
  canvas.addEventListener('pointerup', (e) => {
    // Glissement net sur la borne (doigt) : compte comme une flèche pour les codes de triche.
    if (depart && e.pointerType !== 'mouse') {
      const r = canvas.getBoundingClientRect();
      const gx = posX(e) - depart.x, gy = ((e.clientY - r.top) / r.height) * H - depart.y;
      if (Math.max(Math.abs(gx), Math.abs(gy)) > 30) {
        const k = Math.abs(gx) > Math.abs(gy) ? (gx > 0 ? 'ArrowRight' : 'ArrowLeft') : (gy > 0 ? 'ArrowDown' : 'ArrowUp');
        if (!flechesAuJeu()) noteTouche(k); // glissement qui sert au jeu : pas compté pour les codes
        if (jeu.directions && etat === 'jeu') { entree.dir = { ArrowRight: 'droite', ArrowLeft: 'gauche', ArrowDown: 'bas', ArrowUp: 'haut' }[k]; entree.glisse = true; }
      } else if (jeu.action && jeu.tapeSeul && etat === 'jeu' && performance.now() - depart.t < 350) entree.action = true; // tape
    } else if (depart && jeu.action && jeu.tapeSeul && etat === 'jeu') entree.action = true; // clic de souris
    entree.tenu = false;
    if (depart && jeu.voies) {
      const dx = posX(e) - depart.x;
      if (Math.abs(dx) > 24) entree.pas = dx < 0 ? -1 : 1; // glissement
    }
    depart = null;
    if (e.pointerType !== 'mouse') entree.cible = null;
  });
  canvas.addEventListener('pointercancel', () => { depart = null; entree.tenu = false; });
  canvas.addEventListener('keydown', (e) => {
    // Espace (et flèche haut sans jeu.directions) : action du jeu (saut, tir, rotation…).
    if (jeu.action && (e.key === ' ' || (e.key === 'ArrowUp' && !jeu.directions))) {
      e.preventDefault();
      if (etat === 'pause') return;
      if (etat !== 'jeu') { demarre(); return; }
      if (!e.repeat) entree.action = true;
      entree.tenu = true;
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!jeu.directions) return; // utiles aux codes seulement (codesClavier)
      e.preventDefault();
      if (etat === 'pause') return;
      if (etat !== 'jeu') { demarre(); return; }
      if (!e.repeat) entree.dir = e.key === 'ArrowUp' ? 'haut' : 'bas';
      entree.vertical = e.key === 'ArrowUp' ? -1 : 1;
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const d = e.key === 'ArrowLeft' ? -1 : 1;
    entree.cible = null;
    if (etat === 'pause') return;
    if (etat !== 'jeu') { demarre(); return; }
    if (!e.repeat) { entree.pas = d; if (jeu.directions) entree.dir = d < 0 ? 'gauche' : 'droite'; }
    entree.fleche = d;
  });
  canvas.addEventListener('keyup', (e) => {
    if ((e.key === 'ArrowLeft' && entree.fleche < 0) || (e.key === 'ArrowRight' && entree.fleche > 0)) entree.fleche = 0;
    if ((e.key === 'ArrowUp' && entree.vertical < 0) || (e.key === 'ArrowDown' && entree.vertical > 0)) entree.vertical = 0;
    if (e.key === ' ' || e.key === 'ArrowUp') entree.tenu = false;
  });
  canvas.addEventListener('blur', () => { entree.fleche = 0; entree.vertical = 0; entree.tenu = false; });

  dessine();
  return { demarre, arrete, pause, enJeu: () => etat === 'jeu' || etat === 'pause', dessine, triche };
}
