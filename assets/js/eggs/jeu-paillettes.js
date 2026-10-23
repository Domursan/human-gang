// ===== Humane Gang — arcade : « Paillettes » (le jeu de la page 404, sur le moteur commun) =====
/*
 * Rôle : des paillettes tombent ; le chapeau du gang les attrape pendant 30 secondes. 1 point par paillette.
 * Moteur : eggs/arcade.js (creeArcade). Animation réduite : chute plus lente, pas d'étincelles.
 * Exporte : JEU (règles du mini-jeu pour creeArcade).
 */
import { W, H, etoile } from './arcade.js';

const DUREE = 30, SOL = H - 52, DEMI = 36;
const OR = '#FBD32D', COURONNE = '#9E3543', BANDE = '#E2C77E', BORD = '#F2EFEA';
const borne = (v, a, b) => Math.min(b, Math.max(a, v));

export const JEU = {
  id: 'paillettes',
  titre: 'Paillettes',
  aide: 'Souris, doigt ou flèches gauche et droite : déplace le chapeau pour attraper les paillettes. 30 secondes.',
  init: ({ reduit }) => ({ reduit, lent: reduit ? 0.75 : 1, score: 0, ecoule: 0, pousse: 0, x: W / 2, cible: W / 2, items: [], eclats: [] }),
  update(s, dt, e) {
    s.ecoule += dt;
    if (e.cible !== null) s.cible = borne(e.cible, DEMI - 4, W - DEMI + 4);
    if (e.fleche) s.cible = borne(s.cible + e.fleche * 280 * dt, DEMI - 4, W - DEMI + 4);
    s.x += (s.cible - s.x) * Math.min(1, dt * 14);
    s.pousse += dt;
    if (s.pousse >= Math.max(0.3, 0.7 - s.ecoule * 0.01)) {
      s.pousse = 0;
      s.items.push({ x: 14 + Math.random() * (W - 28), y: -14, v: (90 + s.ecoule * 3 + Math.random() * 30) * s.lent, r: 7 + Math.random() * 5, t: Math.random() * 6 });
    }
    for (const p of s.items) { p.y += p.v * dt; p.t += dt; }
    s.items = s.items.filter((p) => {
      if (p.y >= SOL && p.y <= H - 24 && Math.abs(p.x - s.x) < DEMI) {
        s.score++;
        if (!s.reduit) for (let i = 0; i < 6; i++) { const a = (Math.PI * 2 * i) / 6; s.eclats.push({ x: p.x, y: p.y, vx: Math.cos(a) * 80, vy: Math.sin(a) * 80 - 40, vie: 0.5 }); }
        return false;
      }
      return p.y < H + 20;
    });
    for (const c of s.eclats) { c.vie -= dt; c.x += c.vx * dt; c.y += c.vy * dt; c.vy += 220 * dt; }
    s.eclats = s.eclats.filter((c) => c.vie > 0);
  },
  draw(ctx, s) {
    ctx.fillStyle = OR;
    for (const p of s.items) { etoile(ctx, p.x, p.y, p.r * (0.85 + 0.15 * Math.sin(p.t * 6))); ctx.fill(); }
    for (const c of s.eclats) { ctx.globalAlpha = Math.max(0, c.vie / 0.5); ctx.beginPath(); ctx.arc(c.x, c.y, 2.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    const y = H - 30;
    ctx.fillStyle = COURONNE; ctx.fillRect(s.x - 18, y - 24, 36, 20);
    ctx.fillStyle = BANDE; ctx.fillRect(s.x - 18, y - 8, 36, 4);
    ctx.fillStyle = BORD; ctx.beginPath(); ctx.ellipse(s.x, y - 2, 34, 6, 0, 0, Math.PI * 2); ctx.fill();
  },
  score: (s) => s.score,
  temps: (s) => Math.max(0, Math.ceil(DUREE - s.ecoule)),
  fini: (s) => s.ecoule >= DUREE,
};
