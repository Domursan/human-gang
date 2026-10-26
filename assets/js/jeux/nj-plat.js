// ===== Humane Gang — page « Jeux », onglet « Plat du jour » (jeu du jour, idée N6) =====
/*
 * Rôle : Plat du jour : la photo d'un plat ; on devine le pays d'origine (distance et direction). Moteur commun : nj-devine.js (six jeux du jour à deviner en 6 essais, admins seulement pour l'instant).
 * Contrat : mount(panel, ctx) ; resume(ctx) pour « Les missions du jour ».
 * Dépendances : jeux/nj-devine.js. Exporte : mount, resume.
 */
import { monter, resumer } from './nj-devine.js';

/** Monte l'onglet dans son panneau. */
export const mount = (p, c) => monter(p, c, 'plat');
/** Résumé pour « Les missions du jour ». */
export const resume = (c) => resumer(c, 'plat');
