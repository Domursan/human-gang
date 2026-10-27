// =====================================================================
// Cartes admin : séries (liste, création et modification, activation, suppression).
// Une série regroupe des cartes. Elle peut être masquée, ou limitée à une période (dates en heure suisse).
// Dépendances : core.js (sb, toast, esc, $), ui-confirm.js (confirmBox), admin-events.js (dates en heure suisse),
// constants.js (ICON), state.js (C), helpers.js, data.js (refresh), admin/ui/drawer.js, admin/list-tools.js.
// Exporte : setsListData (liste retenue par la recherche), setsPanel (onglet), openSetDialog, toggleSet, deleteSet.
// =====================================================================
import { sb, toast, esc, $ } from '../../../commun/core.js';
import { confirmBox } from '../../../commun/ui-confirm.js';
import { toZurichInput, fromZurichInput } from '../admin-events.js';
import { ICON } from './constants.js';
import { C } from './state.js';
import { check, act, friendly, group, nf, nextSetSort, period, setState, removeImages } from './helpers.js';
import { openDrawer } from '../ui/drawer.js';
import { refresh } from './data.js';
import { matches, searchHtml } from '../list-tools.js';
import { ecrireReglage } from '../reglages-merge.js';

/* =========================================================
   Séries
   ========================================================= */
/** Vignette d'une série : image de sa première carte illustrée, sinon initiales. */
function setThumb(s, cards) {
  const first = cards.filter((k) => k.image_url).sort((a, b) => a.number - b.number)[0];
  if (first) return `<img class="acd-setcard-img" src="${esc(first.image_url)}" alt="" loading="lazy">`;
  const ini = String(s.name || '?').trim().slice(0, 2).toUpperCase();
  return `<span class="acd-setcard-img acd-setcard-ph" aria-hidden="true">${esc(ini)}</span>`;
}
/** Carte d'une série dans la grille : vignette, nom, code, période, interrupteur Active / Masquée et boutons. */
function setCard(s, cards) {
  const id = esc(s.id);
  const [cls, label] = setState(s);
  // Pastille seulement pour les états de calendrier (à venir, terminée) : Active et Masquée se lisent sur l'interrupteur.
  const state = s.active && label !== 'Active' ? `<span class="pill ${cls}">${esc(label)}</span>` : '';
  return `<li class="acd-setcard${s.active ? '' : ' is-off'}">
    <div class="acd-setcard-top">
      ${setThumb(s, cards)}
      <div class="acd-setcard-txt">
        <p class="acd-setcard-name"><strong>${esc(s.name)}</strong></p>
        <p class="small muted"><code class="acd-code">${esc(s.code)}</code> · ordre ${esc(s.sort)}</p>
        <p class="small muted">${nf(cards.length)} carte${cards.length > 1 ? 's' : ''}</p>
        <p class="small muted">${esc(period(s))}</p>
        ${state}
        ${s.proposals_open ? '<span class="pill">Propositions ouvertes</span>' : ''}
        ${s.booster_scope ? `<span class="pill">${s.booster_scope === 'saison' ? 'Booster de saison' : 'Hors boosters'}</span>` : ''}
      </div>
    </div>
    ${s.description ? `<p class="small acd-setcard-desc">${esc(s.description)}</p>` : ''}
    <div class="acd-setcard-foot">
      <button class="acd-switch" type="button" role="switch" aria-checked="${s.active ? 'true' : 'false'}" data-act="set-toggle" data-id="${id}"
        aria-label="Série « ${esc(s.name)} » ${s.active ? 'active' : 'masquée'}">
        <span class="acd-switch-track" aria-hidden="true"></span><span class="acd-switch-label">${s.active ? 'Active' : 'Masquée'}</span></button>
      <div class="btn-row acd-setcard-btns">
        <button class="btn btn-ghost btn-sm" type="button" data-act="set-edit" data-id="${id}">${ICON.edit} Modifier</button>
        <button class="btn btn-danger btn-sm btn-icon" type="button" data-act="set-del" data-id="${id}" aria-label="Supprimer ${esc(s.name)}" title="Supprimer">${ICON.trash}</button>
      </div>
    </div>
    ${s.active ? '' : `<p class="acd-note acd-setcard-note" role="note"><strong>Masquée :</strong> ses cartes ne sortent pas dans les boosters et les membres ne la voient pas.</p>`}
  </li>`;
}

/** Séries retenues par la recherche : { html, shown, total } (la grille seule, pour la mise à jour sans perte de frappe). */
export function setsListData() {
  const counts = group(C.cards, (k) => k.set_id);
  const rows = C.sets.filter((s) => matches(C.q.series, s.name, s.code, s.description));
  const html = rows.length ? `<ul class="acd-setgrid">${rows.map((s) => setCard(s, counts.get(s.id) || [])).join('')}</ul>`
    : (C.q.series.trim() ? `<div class="empty">Aucun résultat pour « ${esc(C.q.series.trim())} ».</div>`
      : '<div class="empty">Aucune série pour l\'instant. Crée la première pour y ajouter des cartes.</div>');
  return { html, shown: rows.length, total: C.sets.length };
}
/** HTML de l'onglet Séries : bouton de création, recherche et grille des séries. */
export function setsPanel() {
  return `<div class="acd-head">
      <p class="small muted">Une série regroupe des cartes. Supprimer une série supprime aussi toutes ses cartes et les exemplaires qu'en ont les membres.</p>
      <button class="btn btn-primary" type="button" data-act="set-new">${ICON.plus} Nouvelle série</button>
    </div>
    ${C.sets.length ? searchHtml({ id: 'acd-search-series', label: 'Rechercher une série', placeholder: 'Nom, code ou description…', value: C.q.series, attrs: 'data-search="series"' }) : ''}
    <div id="acd-sets-list">${setsListData().html}</div>
    ${tagsPanel()}
    <div id="acd-props"></div>`;
}

/* Libellé d'un tag sans réglage : mise en forme du tag (« sea-of-thieves » -> « Sea of thieves »), comme la base. */
const tagFallback = (t) => String(t || '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * Libellés des jeux (tags de carte) : cards.tag_labels, tag -> nom affiché. Un champ vide garde le libellé d'origine.
 * Les tags sont ceux des cartes existantes et ceux déjà renommés ; un nouveau tag s'ajoute en bas.
 * @returns {string} HTML de la section.
 */
export function tagsPanel() {
  const custom = C.cfgRaw?.tag_labels && typeof C.cfgRaw.tag_labels === 'object' && !Array.isArray(C.cfgRaw.tag_labels) ? C.cfgRaw.tag_labels : {};
  const tags = [...new Set([...C.cards.map((k) => k.tag).filter(Boolean), ...Object.keys(custom)])].sort();
  return `<section class="stack acd-tags" aria-labelledby="acd-tags-h">
    <h3 id="acd-tags-h">Libellés des jeux</h3>
    <p class="small muted">Nom affiché pour chaque tag de jeu des cartes (regroupement « par jeu » de la Collection, titre « Pilier de … »). Un champ vide garde le libellé d’origine.</p>
    <form id="acd-tags-form" class="stack acd-form" novalidate>
      <p class="form-error" role="alert" hidden></p>
      ${tags.length ? `<div class="acd-grid-2">${tags.map((t) => `<div class="field"><label for="acd-tag-${esc(t)}"><code class="acd-code">${esc(t)}</code></label>
        <input id="acd-tag-${esc(t)}" data-tag="${esc(t)}" maxlength="40" autocomplete="off" value="${esc(custom[t] ?? '')}" placeholder="${esc(tagFallback(t))}"></div>`).join('')}</div>`
        : '<p class="small muted">Aucune carte n’a encore de tag de jeu.</p>'}
      <div class="acd-grid-2">
        <div class="field"><label for="acd-tag-new">Nouveau tag</label>
          <input id="acd-tag-new" name="new_tag" maxlength="32" autocomplete="off" placeholder="ex. minecraft" aria-describedby="acd-tag-new-h">
          <span class="small muted" id="acd-tag-new-h">Minuscules, chiffres et tirets.</span></div>
        <div class="field"><label for="acd-tag-newl">Libellé du nouveau tag</label>
          <input id="acd-tag-newl" name="new_label" maxlength="40" autocomplete="off"></div>
      </div>
      <div class="btn-row"><button class="btn btn-ghost" type="submit">Enregistrer les libellés</button></div>
    </form>
  </section>`;
}

/**
 * Enregistre les libellés des jeux (cards.tag_labels) par fusion dans hg_settings.cards : le reste du réglage est gardé.
 * @param {HTMLFormElement} form formulaire « Libellés des jeux ».
 * @param {HTMLElement|null} btn bouton d'envoi.
 */
export async function saveTagLabels(form, btn) {
  const err = form.querySelector('.form-error');
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  err.hidden = true;
  const next = {};
  for (const el of form.querySelectorAll('input[data-tag]')) { const v = el.value.trim(); if (v) next[el.dataset.tag] = v; }
  const nt = form.elements.new_tag.value.trim().toLowerCase(), nl = form.elements.new_label.value.trim();
  if (nt || nl) {
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(nt)) return fail('Nouveau tag : minuscules, chiffres et tirets (ex. minecraft, sea-of-thieves).');
    if (!nl) return fail('Donne un libellé au nouveau tag.');
    next[nt] = nl;
  }
  const trop = Object.values(next).find((l) => l.length > 40);
  if (trop) return fail(`« ${trop} » dépasse 40 caractères.`);
  await act(btn, async () => {
    await ecrireReglage('cards', (c) => { c.tag_labels = next; });
    toast('Libellés des jeux enregistrés.', 'ok');
    await refresh();
  });
}

/** Formulaire de série, ouvert dans le tiroir. */
export function openSetDialog(s = null) {
  const isNew = !s;
  const v = s || {};
  openDrawer({
    title: isNew ? 'Nouvelle série' : `Modifier « ${s.name} »`,
    submitLabel: isNew ? 'Créer la série' : 'Enregistrer',
    body: `<div class="stack acd-form" id="acd-set-form">
      <p class="form-error" role="alert" hidden></p>
      <div class="acd-grid-2">
        <div class="field"><label for="acs-code">Code unique</label>
          <input id="acs-code" name="code" required maxlength="32" autocomplete="off" placeholder="ex. hiver-2026" value="${esc(v.code ?? '')}">
          <span class="small muted">Lettres minuscules, chiffres et tirets.</span></div>
        <div class="field"><label for="acs-name">Nom</label><input id="acs-name" name="name" required maxlength="60" autocomplete="off" value="${esc(v.name ?? '')}"></div>
      </div>
      <div class="field"><label for="acs-desc">Description</label><textarea id="acs-desc" name="description" rows="2" maxlength="300">${esc(v.description ?? '')}</textarea></div>
      <fieldset class="acd-fs"><legend>Disponibilité <span class="muted small">(heure suisse, facultatif)</span></legend>
        <div class="acd-grid-2">
          <div class="field"><label for="acs-start">Début</label><input id="acs-start" name="starts_at" type="datetime-local" value="${esc(toZurichInput(v.starts_at))}"></div>
          <div class="field"><label for="acs-end">Fin</label><input id="acs-end" name="ends_at" type="datetime-local" value="${esc(toZurichInput(v.ends_at))}"></div>
        </div>
        <p class="small muted">Sans dates, la série est toujours disponible. Hors période, ses cartes ne sortent plus dans les boosters.</p>
      </fieldset>
      <div class="acd-grid-2">
        <div class="field"><label for="acs-sort">Ordre d'affichage</label><input id="acs-sort" name="sort" type="number" step="1" value="${esc(v.sort ?? nextSetSort())}"></div>
        <label class="switch"><input type="checkbox" name="active"${(v.active ?? true) ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Série active</span></label>
      </div>
      <div class="acd-grid-2">
        <div class="field"><label for="acs-scope">Dans les boosters</label>
          <select id="acs-scope" name="booster_scope" aria-describedby="acs-scope-h">
            <option value="">Tous les boosters</option>
            <option value="saison"${v.booster_scope === 'saison' ? ' selected' : ''}>Seulement son booster de saison</option>
            <option value="hors_boosters"${v.booster_scope === 'hors_boosters' ? ' selected' : ''}>Jamais (cartes données)</option>
          </select>
          <span class="small muted" id="acs-scope-h">« Booster de saison » : le type dont la « Série unique » est cette série.</span></div>
        <label class="switch"><input type="checkbox" name="proposals_open"${v.proposals_open ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Propositions des membres ouvertes</span></label>
      </div>
    </div>`,
    onSubmit: async (form) => {
      const err = $('.form-error', form);
      /* Affiche le message d'erreur dans le formulaire, ou le masque si le message est vide. */
      const showErr = (m) => { err.textContent = m; err.hidden = !m; };
      showErr('');
      const E = form.elements;
      const row = {
        code: E.code.value.trim().toLowerCase(), name: E.name.value.trim(), description: E.description.value.trim() || null,
        starts_at: fromZurichInput(E.starts_at.value), ends_at: fromZurichInput(E.ends_at.value),
        sort: Math.round(Number(E.sort.value) || 0), active: E.active.checked,
        // Migration 080 : séries réservées et propositions de cartes des membres.
        booster_scope: E.booster_scope.value || null, proposals_open: E.proposals_open.checked,
      };
      if (!/^[a-z0-9][a-z0-9-]{1,31}$/.test(row.code)) return showErr('Le code doit faire 2 à 32 caractères : lettres minuscules, chiffres et tirets.'), false;
      if (row.name.length < 2) return showErr('Donne un nom à la série (2 caractères minimum).'), false;
      if (row.starts_at && row.ends_at && new Date(row.ends_at) <= new Date(row.starts_at)) return showErr('La fin doit être après le début.'), false;
      try {
        if (isNew) check(await sb.from('hg_card_sets').insert(row));
        else check(await sb.from('hg_card_sets').update(row).eq('id', s.id));
        toast(isNew ? `Série « ${row.name} » créée` : 'Série enregistrée', 'ok');
        await refresh();
      } catch (err2) {
        showErr(friendly(err2, { 23505: 'Ce code de série existe déjà.' }));
        return false;
      }
    },
  });
}

/** Active ou désactive une série (réversible : pas de confirmation). */
export async function toggleSet(btn, id) {
  const s = C.setById.get(id);
  if (!s) return;
  await act(btn, async () => {
    check(await sb.from('hg_card_sets').update({ active: !s.active }).eq('id', id));
    toast(s.active ? `Série « ${s.name} » désactivée` : `Série « ${s.name} » activée`, 'ok');
    await refresh();
  });
}

/**
 * Supprime une série après confirmation, avec toutes ses cartes et leurs images.
 * Les échanges concernés restent visibles sans ces cartes (c'est la base qui le gère).
 * @param {string} id identifiant de la série.
 */
export async function deleteSet(id) {
  const s = C.setById.get(id);
  if (!s) return;
  const cards = C.cards.filter((k) => k.set_id === id);
  const copies = cards.reduce((n, k) => n + (C.copiesByCard.get(k.id)?.length || 0), 0);
  const ok = await confirmBox(`Supprimer la série « ${s.name} » ?`,
    `Ses ${nf(cards.length)} carte${cards.length > 1 ? 's' : ''} seront supprimées définitivement, ainsi que ${nf(copies)} exemplaire${copies > 1 ? 's' : ''} chez les membres. Les échanges concernés restent visibles sans ces cartes. Action définitive.`,
    { ok: 'Supprimer', danger: true });
  if (!ok) return;
  check(await sb.from('hg_card_sets').delete().eq('id', id));
  await removeImages(cards.map((k) => k.image_url));
  toast('Série supprimée', 'ok');
  await refresh();
}
