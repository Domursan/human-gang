// ===== Humane Gang — suivi des quêtes de la semaine (côté client) =====
// Signale au serveur une action du membre que les quêtes hebdomadaires peuvent compter (tuto lu, fiche consultée…).
// Le serveur déduplique par semaine ; ici on se contente d'éviter les envois répétés dans la même session.
/*
 * Rôle : exporte questTrack(kind, ref), qui appelle la RPC hg_quest_track. N'émet jamais d'exception :
 * une erreur est ignorée (un avertissement dans la console au plus), pour ne jamais bloquer la page.
 * Page : toutes les pages qui signalent une action (aide.js, membre.js, prefs.js, site-boot.js).
 * Dépendances : core/supabase.js (client sb et hasSession).
 * Stockage : sessionStorage « hg-qt:<genre>:<repère> » pour ne pas renvoyer la même action dans la session.
 * Exporte : questTrack.
 */
import { sb, hasSession } from './core/supabase.js';

/**
 * Lit si une action a déjà été signalée dans cette session du navigateur.
 * @param {string} key clé sessionStorage
 * @returns {boolean} true si la clé est déjà marquée ; false si le stockage est bloqué ou absent
 */
function dejaSignale(key) {
  try { return sessionStorage.getItem(key) === '1'; } catch { return false; }
}

/**
 * Marque (ou démarque) une action dans sessionStorage. Un stockage bloqué est ignoré.
 * @param {string} key clé sessionStorage
 * @param {boolean} on true pour marquer, false pour retirer la marque
 */
function marque(key, on) {
  try {
    if (on) sessionStorage.setItem(key, '1');
    else sessionStorage.removeItem(key);
  } catch { /* stockage indisponible : pas de dédoublonnage local, le serveur dédoublonne déjà */ }
}

/**
 * Signale une action du membre aux quêtes de la semaine. Ne fait rien si personne n'est connecté,
 * ni si la même action a déjà été signalée dans cette session. En cas d'erreur, la marque est retirée
 * pour qu'une prochaine visite réessaie. Ne lève jamais d'exception.
 * @param {string} kind genre d'action : 'fiche_vue', 'carte_identite', 'app_installee', 'tuto_lu' ou 'theme_change'
 * @param {string|number} ref repère de l'action (id du membre consulté, slug du tuto, nom du thème…)
 * @returns {Promise<void>}
 */
export async function questTrack(kind, ref) {
  try {
    const r = String(ref ?? '');
    const key = `hg-qt:${kind}:${r}`;
    if (dejaSignale(key)) return;
    if (!(await hasSession())) return;
    marque(key, true);
    const { error } = await sb.rpc('hg_quest_track', { p_kind: kind, p_ref: r });
    if (error) {
      marque(key, false);
      console.warn('[quetes]', error.message || error);
    }
  } catch (e) {
    console.warn('[quetes]', e?.message || e);
  }
}
