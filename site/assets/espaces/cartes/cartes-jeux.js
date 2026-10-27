// ===== Cartes : regroupement « par jeu » de la Collection et titres « Pilier de … » (idée C7, migration 081) =====
// Les cartes portent un tag (hg_cards.tag, ex. « minecraft ») : la Collection peut les grouper par jeu (compteur 3/4,
// pastilles par carte possédée, « Titre obtenu » quand le groupe est complet). Compléter un jeu donne le titre de profil
// « Pilier de <jeu> » (calculé, aucune Paillette). Libellés des jeux : RPC hg_card_tags_complete (réglage
// cards.tag_labels), sinon les libellés connus ci-dessous.
// Rendu pur : aucune requête sauf loadTagLabels. Utilisé par cartes.js (drawCollection) et membre.js (titres).
// Exporte : TAG_LABELS, tagLabel, hasTags, loadTagLabels, tagGroupsHtml, titlesOf.
import { sb, esc } from '../../commun/core.js';
import { TINT } from './cartes-zoom.js';

/** Libellés connus (repli si la base ne répond pas). */
export const TAG_LABELS = { minecraft: 'Minecraft', aoe2: 'Age of Empires 2', lol: 'LoL', 'sea-of-thieves': 'Sea of Thieves', satisfactory: 'Satisfactory', soiree: 'Jeux de soirée' };
const labels = new Map(Object.entries(TAG_LABELS));
/** Libellé d'un tag (« Minecraft »), sinon le tag mis en forme. */
export const tagLabel = (t) => labels.get(t) || String(t || '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
/** Vrai si au moins une carte de la liste porte un tag. */
export const hasTags = (cards) => cards.some((c) => c.tag);
/** Cartes qui comptent dans un groupe (ni identité ni unique, comme le calcul du titre). */
const counts = (c) => c.tag && c.rarity !== 'identite' && c.rarity !== 'unique';

let loaded = null;
/**
 * Charge les libellés et les groupes du membre (hg_card_tags_complete) ; ne lève jamais d'erreur.
 * @param {string|null} [userId] membre (null = moi)
 * @returns {Promise<object[]>} groupes [{ tag, label, have, total, complete, title }] (vide si indisponible)
 */
export async function loadTagLabels(userId = null) {
  try {
    const { data, error } = await sb.rpc('hg_card_tags_complete', { p_user: userId });
    if (error) throw error;
    const list = Array.isArray(data) ? data : [];
    for (const g of list) if (g.tag && g.label) labels.set(g.tag, g.label);
    return list;
  } catch (e) {
    console.warn('[jeux]', e?.message || e);
    return [];
  }
}
/** Une seule lecture pour la page (titres du membre connecté). */
export const myTags = () => (loaded ||= loadTagLabels(null));

/**
 * Titres complets d'une liste de groupes : [« Pilier de LoL », …].
 * @param {object[]} groups groupes de hg_card_tags_complete
 */
export const titlesOf = (groups) => (groups || []).filter((g) => g.complete).map((g) => g.title || `Pilier de ${tagLabel(g.tag)}`);

/**
 * Vue « Grouper par jeu » : un bloc ouvert (le jeu choisi, sinon le premier incomplet), les autres en lignes à ouvrir,
 * puis les titres obtenus. Les cartes sans tag ne sont pas affichées dans cette vue.
 * @param {object} o
 * @param {object[]} o.cards cartes affichées (déjà filtrées)
 * @param {object[]} o.all toutes les cartes des séries concernées (compteurs sans filtre)
 * @param {(id: string) => object[]} o.copiesOf exemplaires possédés d'une carte
 * @param {(c: object) => string} o.cell HTML d'une case de carte (celle de la Collection)
 * @param {string|null} o.open tag ouvert
 * @param {string} o.title titre au-dessus des groupes (ex. « Série « Le gang joue » »)
 * @returns {string} HTML
 */
export function tagGroupsHtml({ cards, all, copiesOf, cell, open, title }) {
  const tags = [...new Set(all.filter(counts).map((c) => c.tag))].sort((a, b) => tagLabel(a).localeCompare(tagLabel(b), 'fr'));
  if (!tags.length) return '<p class="empty">Aucune carte de cette sélection n’est rattachée à un jeu.</p>';
  const shownIds = new Set(cards.map((c) => c.id));
  const groups = tags.map((t) => {
    const members = all.filter((c) => counts(c) && c.tag === t).sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    const have = members.filter((c) => copiesOf(c.id).length > 0).length;
    return { tag: t, members, have, total: members.length, done: have === members.length, shown: members.filter((c) => shownIds.has(c.id)) };
  });
  const haveAll = groups.reduce((a, g) => a + g.have, 0), totalAll = groups.reduce((a, g) => a + g.total, 0);
  const cur = groups.find((g) => g.tag === open) || groups.find((g) => !g.done) || groups[0];
  const pips = (g) => g.members.map((c) => (copiesOf(c.id).length
    ? `<span class="c2-pip" style="background:${TINT[c.rarity] || '#c4c9d6'}"></span>` : '<span class="c2-pip is-off"></span>')).join('');
  const openHtml = (g) => {
    const miss = g.members.filter((c) => !copiesOf(c.id).length);
    const flavor = g.members.find((c) => copiesOf(c.id).length && c.flavor)?.flavor;
    const hint = [flavor ? `« ${flavor} »` : '', miss.length === 1 ? `il te manque ${miss[0].name}.` : miss.length ? `il te manque ${miss.length} cartes.` : 'groupe complet : titre obtenu.']
      .filter(Boolean).join(' · ');
    return `<section class="card c2-jeu-open" aria-labelledby="c2-jeu-${esc(g.tag)}">
        <div class="c2-jeu-head"><h3 class="c2-jeu-name" id="c2-jeu-${esc(g.tag)}">${esc(tagLabel(g.tag))}</h3>
          ${g.done ? '<span class="pill pill-sand">Titre obtenu</span>' : `<span class="c2-jeu-n">${g.have} / ${g.total}</span>`}</div>
        <div class="cartes-grid c2-jeu-grid">${(g.shown.length ? g.shown : []).map(cell).join('')}</div>
        ${g.shown.length < g.members.length ? '<p class="muted small">Certaines cartes sont masquées par les filtres.</p>' : ''}
        <p class="muted small c2-jeu-hint">${esc(hint)}</p>
        ${miss.length ? '<div class="btn-row"><button type="button" class="btn btn-ghost" data-action="jeu-trade">Chercher un échange</button></div>' : ''}
      </section>`;
  };
  const rows = groups.filter((g) => g !== cur).map((g) => `<li><button type="button" class="c2-jeu-row" data-action="jeu-open" data-tag="${esc(g.tag)}" aria-label="Ouvrir ${esc(tagLabel(g.tag))} : ${g.have} sur ${g.total}${g.done ? ', titre obtenu' : ''}">
        <span class="c2-pips" aria-hidden="true">${pips(g)}</span>
        <span class="c2-jeu-row-name">${esc(tagLabel(g.tag))}</span>
        ${g.done ? '<span class="pill pill-sand">Titre obtenu</span>' : `<span class="c2-jeu-n">${g.have} / ${g.total}</span>`}
        <svg class="c2-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
      </button></li>`).join('');
  const titles = groups.filter((g) => g.done).map((g) => `<span class="pill pill-sand">Pilier de ${esc(tagLabel(g.tag))}</span>`).join(' ');
  return `<div class="c2-jeux">
      <div class="c2-jeux-head"><h2 class="c2-jeux-title">${esc(title)}</h2><p class="muted small">${haveAll} / ${totalAll} cartes</p></div>
      ${openHtml(cur)}
      ${rows ? `<ul class="card c2-jeu-list">${rows}</ul>` : ''}
      ${titles ? `<div class="card c2-titres"><p class="muted small">Sur ta fiche membre</p><p>${titles}</p></div>` : ''}
      <p class="muted small">Compléter les cartes d’un jeu donne un titre de profil. Pas de Paillettes : on complète pour le plaisir.</p>
    </div>`;
}
