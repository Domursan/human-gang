// ===== Humane Gang — arcade : « Domu-mobile » =====
/*
 * Rôle : la voiture avance seule sur trois voies ; on change de voie pour éviter les bouchons et attraper les jerricans.
 * La vitesse monte (plafonnée après 60 s). Score : 1 point par seconde
 * de route + 3 par jerrican. Premier accrochage : « T’es en retard ! », fin de partie. Pas de limite de temps.
 * Plafond serveur : 8 points par seconde ; ici, au plus 1 + 3 × 2,2 = 7,7 par seconde (un jerrican au plus toutes les 0,45 s).
 * Codes de triche (s.triche, eggs/arcade.js) : coeurs = plus de bouchons, jerricans et voiture en cœurs ; immortel = bouchons traversés.
 * Moteur : eggs/arcade.js (creeArcade ; jeu « à voies » : flèche, appui à gauche ou à droite, glisser).
 * Animation réduite : route plus lente, pas de secousse.
 * Exporte : JEU (règles du mini-jeu pour creeArcade).
 */
import { W, H, coeur } from './arcade.js';

const VOIES = 3, LV = W / VOIES, CY = H - 70;
/** Vitesse : plafond à 60 s ; intervalle entre deux rangées : plancher atteint vers 81 s. */
const PLAFOND_VITESSE = 60, PLAFOND_RYTHME = 81;
const ROUTE = '#26262A', LIGNE = '#E2C77E', VOITURE = '#9E3543', VITRE = '#7E93C9', BOUCHON = ['#5A5A62', '#7A4F8F', '#4F6A8F'], JERRY = '#CF7055';
const xVoie = (v) => LV * v + LV / 2;

export const JEU = {
  id: 'domu',
  titre: 'Domu-mobile',
  voies: true,
  aide: 'Flèches, appui à gauche ou à droite, ou glisse le doigt : change de voie. Évite les bouchons, attrape les jerricans !',
  init: ({ reduit }) => ({ reduit, lent: reduit ? 0.7 : 1, ecoule: 0, jerry: 0, voie: 1, x: xVoie(1), items: [], pousse: 0.6, defile: 0, crash: false, secousse: 0 }),
  update(s, dt, e) {
    if (s.crash) { s.secousse = Math.max(0, s.secousse - dt); return; }
    s.ecoule += dt;
    if (e.pas) s.voie = Math.min(VOIES - 1, Math.max(0, s.voie + e.pas));
    s.x += (xVoie(s.voie) - s.x) * Math.min(1, dt * 16);
    const v = (170 + Math.min(s.ecoule, PLAFOND_VITESSE) * 6) * s.lent;
    s.defile = (s.defile + v * dt) % 40;
    s.pousse -= dt;
    if (s.pousse <= 0) {
      s.pousse = Math.max(0.45, 1.1 - Math.min(s.ecoule, PLAFOND_RYTHME) * 0.008);
      const libre = Math.floor(Math.random() * VOIES);
      for (let i = 0; i < VOIES; i++) {
        if (i === libre) { if (Math.random() < 0.5) s.items.push({ j: true, voie: i, y: -20 }); continue; }
        if (!s.triche?.coeurs && Math.random() < 0.45) s.items.push({ j: false, voie: i, y: -30, c: BOUCHON[Math.floor(Math.random() * BOUCHON.length)] });
      }
    }
    if (s.triche?.coeurs) s.items = s.items.filter((it) => it.j); // code « domu » : plus aucun bouchon
    for (const it of s.items) it.y += v * dt;
    s.items = s.items.filter((it) => {
      const touche = Math.abs(xVoie(it.voie) - s.x) < LV * 0.45 && Math.abs(it.y - CY) < (it.j ? 26 : 38);
      if (touche && it.j) { s.jerry++; return false; }
      if (touche && !it.j) { if (s.triche?.immortel) return false; s.crash = true; s.secousse = s.reduit ? 0 : 0.35; }
      return it.y < H + 40;
    });
  },
  draw(ctx, s) {
    const dx = s.secousse > 0 ? (Math.random() - 0.5) * 8 : 0;
    ctx.save();
    ctx.translate(dx, 0);
    ctx.fillStyle = ROUTE; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = LIGNE;
    for (let i = 1; i < VOIES; i++) for (let y = -40 + s.defile; y < H; y += 40) ctx.fillRect(LV * i - 2, y, 4, 20);
    for (const it of s.items) {
      const x = xVoie(it.voie);
      if (it.j && s.triche?.coeurs) coeur(ctx, x, it.y, 13);
      else if (it.j) {
        ctx.fillStyle = JERRY; ctx.fillRect(x - 10, it.y - 13, 20, 26);
        ctx.fillStyle = '#F2EFEA'; ctx.fillRect(x - 6, it.y - 17, 8, 5); ctx.fillRect(x - 6, it.y - 4, 12, 3);
      } else {
        ctx.fillStyle = it.c; ctx.fillRect(x - 22, it.y - 30, 44, 60);
        ctx.fillStyle = '#121212'; ctx.fillRect(x - 16, it.y + 12, 32, 10);
        ctx.fillStyle = '#E0909A'; ctx.fillRect(x - 20, it.y + 24, 8, 4); ctx.fillRect(x + 12, it.y + 24, 8, 4);
      }
    }
    // Domu-mobile (en cœur rouge avec le code « domu »)
    if (s.triche?.coeurs) { coeur(ctx, s.x, CY, 30); ctx.restore(); return; }
    ctx.fillStyle = VOITURE; ctx.fillRect(s.x - 20, CY - 32, 40, 64);
    ctx.fillStyle = VITRE; ctx.fillRect(s.x - 14, CY - 22, 28, 14);
    ctx.fillStyle = '#FBD32D'; ctx.fillRect(s.x - 18, CY - 34, 8, 4); ctx.fillRect(s.x + 10, CY - 34, 8, 4);
    ctx.fillStyle = '#121212'; ctx.fillRect(s.x - 24, CY - 24, 4, 14); ctx.fillRect(s.x + 20, CY - 24, 4, 14);
    ctx.fillRect(s.x - 24, CY + 12, 4, 14); ctx.fillRect(s.x + 20, CY + 12, 4, 14);
    ctx.restore();
    if (s.crash) {
      ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, H / 2 - 34, W, 68);
      ctx.fillStyle = '#F2EFEA'; ctx.font = '22px "Archivo Black", system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('T’es en retard !', W / 2, H / 2 + 8);
      ctx.textAlign = 'start';
    }
  },
  score: (s) => Math.floor(s.ecoule) + s.jerry * 3,
  /* Pas de vies : la partie finit au premier accrochage. */
  vies: () => null,
  fini: (s) => s.crash,
};
