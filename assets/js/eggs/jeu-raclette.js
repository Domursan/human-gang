// ===== Humane Gang — arcade : « Raclette » =====
/*
 * Rôle : des tranches de fromage tombent ; le poêlon les attrape (+1). Les cornichons sont à éviter (−2, jamais
 * en dessous de 0). 30 secondes. Sprites dessinés en pixel art (rectangles), comme les paillettes.
 * Moteur : eggs/arcade.js (creeArcade). Animation réduite : chute plus lente, pas de secousse.
 * Exporte : JEU (règles du mini-jeu pour creeArcade).
 */
import { W, H } from './arcade.js';

const DUREE = 30, SOL = H - 50, DEMI = 38;
const FROMAGE = '#FBD32D', DESSUS = '#FCA301', TROU = '#e2a52c', CROUTE = '#8a5200', CORNICHON = '#5f8f33', CORN_FONCE = '#4f7a2a', CORN_CLAIR = '#8fc35f', POELE = '#2b2f38', MANCHE = '#6b3a12';
const borne = (v, a, b) => Math.min(b, Math.max(a, v));

export const JEU = {
  id: 'raclette',
  titre: 'Raclette',
  aide: 'Souris, doigt ou flèches : déplace le poêlon. Attrape le fromage, évite les cornichons ! 30 secondes.',
  init: ({ reduit }) => ({ reduit, lent: reduit ? 0.75 : 1, score: 0, ecoule: 0, pousse: 0, x: W / 2, cible: W / 2, items: [], secousse: 0, flash: 0 }),
  update(s, dt, e) {
    s.ecoule += dt;
    if (e.cible !== null) s.cible = borne(e.cible, DEMI, W - DEMI);
    if (e.fleche) s.cible = borne(s.cible + e.fleche * 300 * dt, DEMI, W - DEMI);
    s.x += (s.cible - s.x) * Math.min(1, dt * 14);
    s.pousse += dt;
    if (s.pousse >= Math.max(0.32, 0.75 - s.ecoule * 0.012)) {
      s.pousse = 0;
      const corn = Math.random() < Math.min(0.35, 0.15 + s.ecoule * 0.008);
      s.items.push({ corn, x: 18 + Math.random() * (W - 36), y: -16, v: (95 + s.ecoule * 3.2 + Math.random() * 35) * s.lent, a: Math.random() * 6 });
    }
    for (const p of s.items) { p.y += p.v * dt; p.a += dt * 3; }
    s.items = s.items.filter((p) => {
      if (p.y >= SOL && p.y <= H - 22 && Math.abs(p.x - s.x) < DEMI) {
        if (p.corn) { s.score = Math.max(0, s.score - 2); s.flash = 0.25; if (!s.reduit) s.secousse = 0.2; } else s.score++;
        return false;
      }
      return p.y < H + 20;
    });
    s.secousse = Math.max(0, s.secousse - dt);
    s.flash = Math.max(0, s.flash - dt);
  },
  draw(ctx, s) {
    const dx = s.secousse > 0 ? (Math.random() - 0.5) * 6 : 0;
    ctx.save();
    ctx.translate(dx, 0);
    for (const p of s.items) {
      if (p.corn) {
        ctx.fillStyle = CORN_FONCE; ctx.fillRect(p.x - 4, p.y - 11, 8, 22);
        ctx.fillStyle = CORNICHON; ctx.fillRect(p.x - 6, p.y - 9, 12, 18);
        ctx.fillStyle = CORN_CLAIR; ctx.fillRect(p.x - 3, p.y - 6, 2, 2); ctx.fillRect(p.x + 1, p.y, 2, 2);
      } else {
        const w = 30, h = 16, x = Math.round(p.x - w / 2), y = Math.round(p.y - h / 2 + Math.sin(p.a) * 1.5);
        ctx.fillStyle = FROMAGE; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = DESSUS; ctx.fillRect(x, y, w, 4);
        ctx.fillStyle = TROU; ctx.fillRect(x + 6, y + 7, 4, 4); ctx.fillRect(x + 19, y + 9, 4, 4);
        ctx.fillStyle = CROUTE; ctx.fillRect(x, y + h, w, 2);
      }
    }
    // Poêlon : manche, poêle, fromage déjà fondu au fond
    const y = H - 34;
    ctx.fillStyle = MANCHE; ctx.fillRect(s.x + DEMI - 4, y + 10, 30, 6);
    ctx.fillStyle = POELE; ctx.fillRect(s.x - DEMI, y + 6, DEMI * 2, 14);
    ctx.fillStyle = '#4b4f5b'; ctx.fillRect(s.x - DEMI + 2, y + 2, DEMI * 2 - 4, 6);
    ctx.fillStyle = FROMAGE; ctx.fillRect(s.x - DEMI + 8, y, DEMI * 2 - 16, 4);
    ctx.restore();
    if (s.flash > 0) { ctx.fillStyle = `rgba(94, 140, 58, ${s.flash})`; ctx.fillRect(0, 0, W, H); }
  },
  score: (s) => s.score,
  temps: (s) => Math.max(0, Math.ceil(DUREE - s.ecoule)),
  fini: (s) => s.ecoule >= DUREE,
};
