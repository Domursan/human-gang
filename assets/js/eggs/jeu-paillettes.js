// ===== Humane Gang — arcade : « Paillettes » (le jeu de la page 404, sur le moteur commun) =====
/*
 * Rôle : des paillettes tombent ; le chapeau du gang les attrape. 1 point par paillette, rien si on en rate une.
 * Trois vies (cœurs). Pièges : la « fausse paillette » (étoile violet sombre à huit pointes acérées, contour et cœur rouges) et, à partir
 * de 30 s, le « grêlon » (cristal bleu pâle hexagonal, plus rapide). Attraper un piège coûte une vie.
 * La partie finit à zéro vie ; pas de limite de temps. Les pièges et la vitesse montent doucement puis plafonnent
 * (PLAFOND) : la partie reste jouable longtemps. Cadence des paillettes : au plus une toutes les 0,3 s (3,3 par seconde,
 * sous le plafond serveur de 6 points par seconde).
 * Moteur : eggs/arcade.js (creeArcade). Animation réduite : chute plus lente, pas d'étincelles ni de secousse.
 * Exporte : JEU (règles du mini-jeu pour creeArcade).
 */
import { W, H, etoile } from './arcade.js';

const VIES = 3, SOL = H - 52, DEMI = 36;
/** Au-delà de cette seconde, la vitesse ne monte plus (la partie reste jouable longtemps). */
const PLAFOND = 60;
const OR = '#FBD32D', COURONNE = '#9E3543', BANDE = '#E2C77E', BORD = '#F2EFEA';
const VIOLET = '#4A2070', ROUGE = '#FF5A6A', GLACE = '#CFEAF7', GLACE_FONCE = '#5FA8D3';
const borne = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Fausse paillette : étoile violet sombre à huit pointes acérées, contour et cœur rouges (forme et couleur bien différentes de l'or).
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {number} x centre
 * @param {number} y centre
 * @param {number} r rayon des pointes
 */
function fausse(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (Math.PI * i) / 8 - Math.PI / 2, k = i % 2 ? 0.55 : 1;
    ctx.lineTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
  }
  ctx.closePath();
  ctx.fillStyle = VIOLET; ctx.fill();
  ctx.strokeStyle = ROUGE; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = ROUGE; ctx.beginPath(); ctx.arc(x, y, r * 0.3, 0, Math.PI * 2); ctx.fill();
}

/**
 * Grêlon : cristal hexagonal bleu pâle, bordure bleue et reflet blanc (forme géométrique, pas une étoile).
 * @param {CanvasRenderingContext2D} ctx contexte du canevas
 * @param {number} x centre
 * @param {number} y centre
 * @param {number} r rayon
 */
function greleon(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI * i) / 3;
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = GLACE; ctx.fill();
  ctx.strokeStyle = GLACE_FONCE; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x - r * 0.5, y - r * 0.3); ctx.lineTo(x - r * 0.1, y - r * 0.6); ctx.stroke();
}

/** Perte d'une vie : flash rouge et secousse (sauf animation réduite). */
function perdUneVie(s) {
  s.vies--;
  s.flash = 0.35;
  if (!s.reduit) s.secousse = 0.3;
}

export const JEU = {
  id: 'paillettes',
  titre: 'Paillettes',
  aide: 'Souris, doigt ou flèches gauche et droite : déplace le chapeau pour attraper les paillettes. 3 vies : évite les pièges (fausses paillettes violettes, grêlons).',
  init: ({ reduit }) => ({ reduit, lent: reduit ? 0.75 : 1, score: 0, vies: VIES, ecoule: 0, pousse: 0, x: W / 2, cible: W / 2, items: [], eclats: [], flash: 0, secousse: 0 }),
  update(s, dt, e) {
    s.ecoule += dt;
    if (e.cible !== null) s.cible = borne(e.cible, DEMI - 4, W - DEMI + 4);
    if (e.fleche) s.cible = borne(s.cible + e.fleche * 280 * dt, DEMI - 4, W - DEMI + 4);
    s.x += (s.cible - s.x) * Math.min(1, dt * 14);
    const t = Math.min(s.ecoule, PLAFOND);
    s.pousse += dt;
    if (s.pousse >= Math.max(0.3, 0.7 - Math.min(s.ecoule, 40) * 0.01)) {
      s.pousse = 0;
      // Pièges : 8 % au début, 25 % au plafond (atteint vers 57 s). Le grêlon apparaît après 30 s.
      const piege = Math.random() < Math.min(0.25, 0.08 + t * 0.003);
      const type = !piege ? null : (t >= 30 && Math.random() < 0.4 ? 'grele' : 'fausse');
      s.items.push({
        x: 14 + Math.random() * (W - 28), y: -14,
        v: (90 + t * 3 + Math.random() * 30) * s.lent * (type === 'grele' ? 1.5 : 1),
        r: type === 'fausse' ? 10 + Math.random() * 3 : 7 + Math.random() * 5,
        t: Math.random() * 6, piege: type,
      });
    }
    for (const p of s.items) { p.y += p.v * dt; p.t += dt; }
    s.items = s.items.filter((p) => {
      if (p.y >= SOL && p.y <= H - 24 && Math.abs(p.x - s.x) < DEMI) {
        if (p.piege) { perdUneVie(s); return false; }
        s.score++;
        if (!s.reduit) for (let i = 0; i < 6; i++) { const a = (Math.PI * 2 * i) / 6; s.eclats.push({ x: p.x, y: p.y, vx: Math.cos(a) * 80, vy: Math.sin(a) * 80 - 40, vie: 0.5 }); }
        return false;
      }
      return p.y < H + 20;
    });
    for (const c of s.eclats) { c.vie -= dt; c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 220 * dt; }
    s.eclats = s.eclats.filter((c) => c.vie > 0);
    s.secousse = Math.max(0, s.secousse - dt);
    s.flash = Math.max(0, s.flash - dt);
  },
  draw(ctx, s) {
    const dx = s.secousse > 0 ? (Math.random() - 0.5) * 8 : 0;
    ctx.save();
    ctx.translate(dx, 0);
    for (const p of s.items) {
      if (p.piege === 'fausse') fausse(ctx, p.x, p.y, p.r);
      else if (p.piege === 'grele') greleon(ctx, p.x, p.y, p.r);
      else { ctx.fillStyle = OR; etoile(ctx, p.x, p.y, p.r * (0.85 + 0.15 * Math.sin(p.t * 6))); ctx.fill(); }
    }
    ctx.fillStyle = OR;
    for (const c of s.eclats) { ctx.globalAlpha = Math.max(0, c.vie / 0.5); ctx.beginPath(); ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    const y = H - 30;
    ctx.fillStyle = COURONNE; ctx.fillRect(s.x - 18, y - 24, 36, 20);
    ctx.fillStyle = BANDE; ctx.fillRect(s.x - 18, y - 8, 36, 4);
    ctx.fillStyle = BORD; ctx.beginPath(); ctx.ellipse(s.x, y - 2, 34, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (s.flash > 0) { ctx.fillStyle = `rgba(224, 64, 75, ${s.flash})`; ctx.fillRect(0, 0, W, H); }
  },
  score: (s) => s.score,
  vies: (s) => ({ left: s.vies, max: VIES }),
  fini: (s) => s.vies <= 0,
};
