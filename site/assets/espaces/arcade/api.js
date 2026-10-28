// ===== Humane Gang — secrets cachés : appel commun au serveur =====
/*
 * Rôle : signaler au serveur qu'un membre a trouvé un secret caché (easter egg) et afficher le résultat.
 * Le serveur (RPC hg_egg_found, migration 062) vérifie ce qui peut l'être (heure et date de Zurich), verse la récompense
 * une seule fois par période et renvoie un message. Un visiteur sans compte voit seulement l'effet, sans récompense.
 * Dépendances : core/supabase.js (sb, hasSession), core/ui.js (toast).
 * Exporte : eggFound(code, extra), eggsMe().
 * Codes : konami, logo, humane, jeu404 (extra.score ≥ 1), heure_gang, anniversaire, console, lettre_1 … lettre_7,
 *         secousse, nuit, rembobine, tzatziki, champi_<saison> (printemps, ete, automne, hiver), livre, kc, creeper,
 *         serge, domumobile.
 */
import { paillSym } from '../../commun/paillettes.js';
import { sb, hasSession } from '../../commun/core/supabase.js';
import { toast } from '../../commun/core/ui.js';

/** Secrets déjà signalés dans cet onglet, pour ne pas rappeler le serveur à chaque répétition. */
const dejaEnvoyes = new Set();

/**
 * Signale un secret trouvé. Affiche le message du serveur (gain, carte, badge) dans une notification.
 * Ne lève jamais d'exception : une erreur (hors de l'heure, déjà trouvé…) est montrée doucement ou ignorée.
 * @param {string} code identifiant du secret (voir la liste en tête de fichier)
 * @param {object} [extra] données utiles au serveur (par ex. { score } pour le jeu de la page 404)
 * @param {{ silencieux?: boolean }} [opts] silencieux : pas de notification si le secret était déjà trouvé
 * @returns {Promise<object|null>} réponse du serveur { new, reward, message, card, badge, found }, ou null
 */
export async function eggFound(code, extra = {}, opts = {}) {
  const cle = `${code}:${JSON.stringify(extra)}`;
  if (dejaEnvoyes.has(cle)) return null;
  dejaEnvoyes.add(cle);
  try {
    if (!(await hasSession())) return null;
    const { data, error } = await sb.rpc('hg_egg_found', { p_egg: code, p_extra: extra });
    if (error) { dejaEnvoyes.delete(cle); return null; }
    if (data?.new) {
      const gains = [data.reward > 0 ? `+${data.reward} ${paillSym()}` : '', data.card ? `carte « ${data.card} »` : '', data.badge ? `badge « ${data.badge} »` : '']
        .filter(Boolean).join(' · ');
      toast(`🔍 ${data.message}${gains ? ` (${gains})` : ''}`, 'success', 'egg-toast');
    } else if (data && !opts.silencieux) {
      toast(`🔍 ${data.message}`, '', 'egg-toast');
    }
    return data ?? null;
  } catch {
    dejaEnvoyes.delete(cle);
    return null;
  }
}

/**
 * Secrets déjà trouvés par le membre connecté (page secrète, compteur).
 * @returns {Promise<{found: number, total: number, eggs: {egg: string, first: string}[], letters: number}|null>}
 */
export async function eggsMe() {
  try {
    if (!(await hasSession())) return null;
    const { data, error } = await sb.rpc('hg_eggs_me');
    return error ? null : data;
  } catch {
    return null;
  }
}
