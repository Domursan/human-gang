// =====================================================================
// Comptes admin : outils communs (icônes, bouton « occupé », validations, message d'erreur d'onglet).
// Importé par les autres fichiers de assets/js/admin-accounts/.
// Dépendances : core.js (toast, errMsg, esc), icons.js (svg).
// Exporte : IC, busy, check, nullIfEmpty, toLocalInput, fromLocalInput, norm, tabError.
// =====================================================================
import { toast, errMsg, esc } from '../../../commun/core.js';
import { svg } from '../../../commun/icons.js';

/* ---------- Icônes ---------- */
// Icônes SVG réutilisées dans la fiche (retour, retrait, œil, recherche...).
export const IC = {
  back: svg('back2', { stroke: 2 }),
  chev: svg('chev', { stroke: 2 }),
  trash: svg('trash', { stroke: 2 }),
  eye: svg('eye', { stroke: 2 }),
  eyeOff: svg('eyeOff', { stroke: 2 }),
  check: svg('check2', { stroke: 2.2 }),
  arrow: svg('arrow2', { stroke: 2 }),
  search: svg('search', { stroke: 2 }),
};

/* ---------- Petits outils (copie locale : admin.js n'exporte rien) ---------- */
/**
 * Lance une action liée à un bouton : le bouton est désactivé pendant l'appel,
 * pour éviter un second envoi. Une erreur s'affiche en toast au lieu de planter la page.
 * @param {HTMLElement|null} btn bouton à désactiver (peut être null).
 * @param {Function} fn action asynchrone à exécuter.
 * @returns {Promise<*>} la valeur renvoyée par fn, ou undefined si elle a échoué.
 */
export async function busy(btn, fn) {
  if (btn?.dataset.busy) return undefined;
  if (btn) { btn.disabled = true; btn.dataset.busy = '1'; btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); } catch (e) { toast(errMsg(e), 'error'); return undefined; } finally {
    if (btn) { delete btn.dataset.busy; btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); if (btn.isConnected) btn.disabled = false; }
  }
}
/**
 * Réponse Supabase : lève l'erreur si elle existe, sinon renvoie les données.
 * Permet d'écrire `const x = check(await sb.from(...))` sans tester error à chaque fois.
 * @param {{data: *, error: *}} res réponse brute de Supabase.
 * @returns {*} res.data.
 * @throws {*} res.error s'il est renseigné.
 */
export function check(res) { if (res.error) throw res.error; return res.data; }
/** Texte nettoyé, ou null si la saisie est vide. */
export const nullIfEmpty = (v) => (String(v ?? '').trim() === '' ? null : String(v).trim());
/**
 * ISO -> valeur pour <input type="datetime-local"> (heure locale).
 * L'input n'accepte pas le fuseau : on retire le décalage avant de couper la chaîne.
 * @param {string} iso date au format ISO.
 * @returns {string} 'AAAA-MM-JJTHH:MM', ou '' si la date est vide.
 */
export function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
/** Valeur d'un <input type="datetime-local"> -> ISO (UTC), ou null si vide. */
export const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);
/** Texte normalisé pour la recherche : minuscules et sans accents (é -> e). */
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Message d'erreur à afficher à la place d'un onglet qui n'a pas pu charger ; chaîne vide si tout va bien. */
export const tabError = (r) => (r?.error ? `<div class="empty">Impossible de charger : ${esc(errMsg(r.error))}</div>` : '');
