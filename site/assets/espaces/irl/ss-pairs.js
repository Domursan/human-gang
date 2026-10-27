// ===== Humane Gang — paires « qui offre à qui » d'une édition Secret Santa =====
// Partagé par historique.js et secret-santa.js. Les paires viennent de hg_ss_reveal, qui ne répond que pour une édition
// en révélation ou terminée. Un membre ne peut pas lire le profil d'un fantôme (hg_members les exclut) : le pseudo
// vient donc de la RPC, et l'avatar par défaut (initiales) est affiché. L'admin voit aussi les avatars des fantômes.
import { sb, esc, avatarHtml } from '../../commun/core.js';
import { svg } from '../../commun/icons.js';

/* ---------- Constantes ---------- */
const ARROW = svg('arrow', { size: 16, stroke: 2 });
/** Tri alphabétique en français (accents pris en compte), pour un ordre stable des pseudos. */
const collator = new Intl.Collator('fr');

/* ---------- Chargement des paires ---------- */
/**
 * Paires { giver, receiver } (pseudos) d'une édition. Une requête par édition ; [] si la RPC échoue.
 * @param {string} editionId identifiant de l'édition Secret Santa
 * @returns {Promise<Array<{giver: string, receiver: string}>>}
 */
export async function fetchPairs(editionId) {
  const { data, error } = await sb.rpc('hg_ss_reveal', { p_edition: editionId });
  if (error) { console.warn('[hg_ss_reveal]', error); return []; }
  return (data || []).map((r) => ({ giver: r.giver, receiver: r.receiver }));
}

/* ---------- Annuaire et ordre de la chaîne ---------- */
/** Annuaire { pseudo → personne } à partir de S.members. Les entrées fantômes (admin) portent « (fantôme) » : retiré ici. */
export function peopleByPseudo(members) {
  const map = new Map();
  for (const m of members.values()) {
    if (m?.pseudo) map.set(m.pseudo.replace(/ \(fantôme\)$/, ''), m);
  }
  return map;
}

/**
 * Ordonne les paires pour suivre la chaîne : on part d'un donneur, on enchaîne sur son receveur, puis sur le
 * receveur de celui-ci, jusqu'à revenir au départ (une boucle) ou à une fin de chaîne. Renvoie un tableau de chaînes.
 */
export function chainOrder(pairs) {
  const byGiver = new Map(pairs.map((p) => [p.giver, p]));
  const receivers = new Set(pairs.map((p) => p.receiver));
  const givers = [...byGiver.keys()].sort((a, b) => collator.compare(a, b));
  // Donneurs qui ne reçoivent de personne d'abord (début de chaîne), puis le reste (boucles fermées).
  const starts = [...givers.filter((g) => !receivers.has(g)), ...givers.filter((g) => receivers.has(g))];
  const seen = new Set();
  const chains = [];
  for (const g of starts) {
    if (seen.has(g)) continue;
    const chain = [];
    let cur = byGiver.get(g);
    while (cur && !seen.has(cur.giver)) {
      seen.add(cur.giver);
      chain.push(cur);
      cur = byGiver.get(cur.receiver);
    }
    if (chain.length) chains.push(chain);
  }
  return chains;
}

/* ---------- Rendu HTML de la chaîne ---------- */
/**
 * Liste « Chaîne des cadeaux » : « [avatar] Donneur → [avatar] Receveur ».
 * people : Map pseudo → personne (avatar, couleur). Un pseudo inconnu garde les initiales.
 * @param {Array<{giver: string, receiver: string}>} pairs paires de l'édition
 * @param {Map<string, object>} people annuaire pseudo → personne
 * @param {{mePseudo?: string|null, emptyText?: string}} [options] pseudo de la personne connectée (mise en évidence) et texte si vide
 * @returns {string} HTML de la liste
 */
export function pairsHtml(pairs, people, { mePseudo = null, emptyText = 'Aucune attribution à afficher.' } = {}) {
  if (!pairs.length) return `<p class="small muted">${esc(emptyText)}</p>`;
  // Données d'avatar de la personne, avec le pseudo forcé (même si l'annuaire ne la connaît pas).
  const who = (name) => ({ ...(people.get(name) || {}), pseudo: name });
  const rows = chainOrder(pairs).flatMap((chain, ci) => chain.map((p, i) => {
    // Ligne de la personne connectée (donneuse ou receveuse) : mise en évidence.
    const mine = !!mePseudo && (p.giver === mePseudo || p.receiver === mePseudo);
    // Premier élément d'une chaîne suivante : séparation visuelle entre deux chaînes.
    const cls = ['ssp-item', mine ? 'is-me' : '', ci > 0 && i === 0 ? 'is-chain-start' : ''].filter(Boolean).join(' ');
    return `<li class="${cls}">
      <span class="ssp-who">${avatarHtml(who(p.giver), 32)}<span class="ssp-name">${esc(p.giver)}</span></span>
      <span class="ssp-arrow" aria-hidden="true">${ARROW}</span><span class="visually-hidden"> offre à </span>
      <span class="ssp-who">${avatarHtml(who(p.receiver), 32)}<span class="ssp-name">${esc(p.receiver)}</span></span>
    </li>`;
  }));
  return `<ol class="ssp-list" aria-label="Chaîne des cadeaux">${rows.join('')}</ol>`;
}
