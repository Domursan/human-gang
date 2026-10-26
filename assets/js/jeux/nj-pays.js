// ===== Humane Gang — page « Jeux », onglet « Pays du jour » (jeu du jour, idée N5) =====
/*
 * Rôle : Pays du jour : la silhouette d'un pays ; distance et direction à chaque essai, photo à la 3e erreur. Moteur commun : nj-devine.js (six jeux du jour à deviner en 6 essais, admins seulement pour l'instant).
 * Contrat : mount(panel, ctx) ; resume(ctx) pour « Les missions du jour ».
 * Dépendances : jeux/nj-devine.js. Exporte : mount, resume.
 */
import { monter, resumer } from './nj-devine.js';

/** Monte l'onglet dans son panneau. */
export const mount = (p, c) => monter(p, c, 'pays');
/** Résumé pour « Les missions du jour ». */
export const resume = (c) => resumer(c, 'pays');
