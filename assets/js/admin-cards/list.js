// Cartes admin : liste des cartes (filtres, tableau) et bloc des cartes Identité.
import { esc } from '../core.js';
import { RARITIES, FAMILIES, rarityLabel, familyLabel } from '../cartes-ui.js';
import { ICON } from './constants.js';
import { C } from './state.js';
import { identSetId, liveCount, maxSerialOf, nf, pseudo, selField, thumb } from './helpers.js';

/* =========================================================
   Cartes
   ========================================================= */
function identityBox() {
  const idSet = identSetId();
  const ident = C.cards.filter((k) => k.set_id === idSet && k.rarity === 'identite');
  const missing = C.profiles.filter((p) => !ident.some((k) => k.member_id === p.id));
  return `<section class="card acd-ident" aria-labelledby="acd-ident-h">
    <h3 class="card-title" id="acd-ident-h">Cartes Identité</h3>
    <p class="small muted">Les cartes Identité sont les plus rares : une par membre, numérotée (max_copies conseillé : 5 à 10).</p>
    ${C.sets.length ? `<div class="acd-ident-row">
      ${selField('acd-ident-set', 'Série', 'identSet', C.sets.map((s) => [s.id, s.name]), idSet)}
      <button class="btn btn-sand" type="button" data-act="ident-make"${missing.length ? '' : ' disabled'}>${ICON.plus} Créer les cartes Identité manquantes</button>
    </div>
    <p class="small muted">${missing.length
      ? `${nf(missing.length)} membre${missing.length > 1 ? 's' : ''} sans carte Identité dans cette série : une carte par membre sera créée.`
      : 'Tous les membres ont leur carte Identité dans cette série.'}</p>`
    : '<p class="small muted">Crée une série pour pouvoir ajouter des cartes Identité.</p>'}
  </section>`;
}

function cardRow(k) {
  const id = esc(k.id);
  const exemp = k.max_copies
    ? `<span title="Numéros déjà distribués">${nf(maxSerialOf(k.id))} / ${nf(k.max_copies)}</span>`
    : `${nf(liveCount(k.id))} en circulation`;
  return `<tr${k.active ? '' : ' class="is-off"'}>
    <td>#${esc(k.number)}</td>
    <td><span class="acd-cardcell">${thumb(k)}<span>${esc(k.name)}${k.caption ? `<br><span class="small acd-caption">${esc(k.caption)}</span>` : ''}${k.member_id && pseudo(k.member_id) !== k.name ? `<br><span class="small muted">${esc(pseudo(k.member_id))}</span>` : ''}</span></span></td>
    <td>${esc(C.setById.get(k.set_id)?.name ?? '—')}</td>
    <td>${esc(familyLabel(k.family))}</td>
    <td><span class="pill acd-rar acd-rar-${esc(k.rarity)}">${esc(rarityLabel(k.rarity))}</span></td>
    <td>${exemp}</td>
    <td>${k.active ? '<span class="pill pill-ok">Active</span>' : '<span class="pill pill-todo">Désactivée</span>'}</td>
    <td class="acd-actions">
      <button class="btn btn-ghost btn-sm" type="button" data-act="card-edit" data-id="${id}">${ICON.edit} Modifier</button>
      <button class="btn btn-ghost btn-sm" type="button" data-act="card-toggle" data-id="${id}">${k.active ? `${ICON.off} Désactiver` : `${ICON.on} Activer`}</button>
      <button class="btn btn-danger btn-sm btn-icon" type="button" data-act="card-del" data-id="${id}" aria-label="Supprimer ${esc(k.name)}" title="Supprimer">${ICON.trash}</button>
    </td>
  </tr>`;
}

export function cardsPanel() {
  if (!C.sets.length) return `${identityBox()}<div class="empty">Crée d'abord une série : les cartes s'y rangent.</div>`;
  const f = C.f;
  const list = C.cards
    .filter((k) => (!f.set || k.set_id === f.set) && (!f.rarity || k.rarity === f.rarity) && (!f.family || k.family === f.family))
    .sort((a, b) => (C.setById.get(a.set_id)?.sort ?? 0) - (C.setById.get(b.set_id)?.sort ?? 0) || a.number - b.number);
  return `${identityBox()}
    <div class="acd-toolbar" role="group" aria-label="Filtrer les cartes">
      ${selField('acd-f-set', 'Série', 'set', [['', 'Toutes les séries'], ...C.sets.map((s) => [s.id, s.name])], f.set)}
      ${selField('acd-f-rarity', 'Rareté', 'rarity', [['', 'Toutes les raretés'], ...RARITIES.map((r) => [r.id, r.label])], f.rarity)}
      ${selField('acd-f-family', 'Famille', 'family', [['', 'Toutes les familles'], ...FAMILIES.map((x) => [x.id, x.label])], f.family)}
      <button class="btn btn-primary" type="button" data-act="card-new">${ICON.plus} Nouvelle carte</button>
    </div>
    <p class="small muted">${nf(list.length)} carte${list.length > 1 ? 's' : ''} affichée${list.length > 1 ? 's' : ''} sur ${nf(C.cards.length)}.</p>
    ${list.length ? `<div class="acd-scroll" tabindex="0" role="region" aria-label="Liste des cartes">
      <table class="acd-table">
        <thead><tr><th scope="col">N°</th><th scope="col">Carte</th><th scope="col">Série</th><th scope="col">Famille</th><th scope="col">Rareté</th><th scope="col">Exemplaires</th><th scope="col">État</th><th scope="col"><span class="acd-sr">Actions</span></th></tr></thead>
        <tbody>${list.map(cardRow).join('')}</tbody>
      </table></div>`
      : '<div class="empty">Aucune carte ne correspond à ces filtres.</div>'}`;
}
