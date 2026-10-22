// Admin : badges (attribution par membre, création et édition, image, suppression).
// Grille des badges avec recherche, puis, pour un membre choisi, ses badges à cocher. Le formulaire des critères
// automatiques est monté par badges-criteres.js, au-dessus de la grille.
// Utilisé par admin.js (badgesSub, bindBadges) et par ideas.js / support.js (hasBadge, awardBadge, badgeName).
// Dépend de core.js, confirm, admin-badges-edit.js (édition et suppression), admin-events.js, badge-levels.js (niveaux).
import { sb, toast, esc, $ } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { openBadgeEditor, deleteBadge, isAutoBadge } from '../admin-badges-edit.js';
import { refreshEventsSection } from '../admin-events.js';
import { hasLevels, sortedLevels, roman, METRIC_LABEL } from '../badge-levels.js';
import { S, pseudoOf } from './state.js';
import { ICON, busy, check, uploadAsset, pickFile } from './common.js';
import { loadBadges } from './loaders.js';
import { renderMembers } from './invites.js';
import { matches, mountSearch, bindSearch, setCount, emptyHtml } from './list-tools.js';
import { mountBadgesCriteres } from './badges-criteres.js';

/* =========================================================
   Badges
   ========================================================= */
/** Image d'un badge : son image téléversée, sinon l'icône par défaut. */
const badgeImg = (b) => (b.image_url ? `<img src="${esc(b.image_url)}" alt="">` : ICON.badge);

/**
 * Redessine la grille des badges (filtrée par la recherche) et la liste de sélection du membre.
 * Un badge « à niveaux » affiche ses niveaux en chiffres romains.
 */
export function renderBadges() {
  // Détenteurs de chaque badge, pour l'affichage « Voir les membres ».
  const holders = new Map();
  for (const ub of S.userBadges) {
    if (!holders.has(ub.badge_code)) holders.set(ub.badge_code, []);
    const b = S.badges.find((x) => x.code === ub.badge_code);
    holders.get(ub.badge_code).push(pseudoOf(ub.user_id) + (hasLevels(b) ? ` (${roman(ub.level || 1)})` : ''));
  }
  const shown = S.badges.filter((b) => matches(S.q.badges, b.name, b.description, b.code));
  setCount($('#badge-search-count'), shown.length, S.badges.length, S.q.badges, ['badge', 'badges']);
  $('#badge-grid').innerHTML = shown.map((b) => {
    const h = holders.get(b.code) || [];
    const names = h.slice().sort((x, y) => x.localeCompare(y, 'fr'));
    const auto = isAutoBadge(b.code);
    return `<div class="badge-card">
      <div class="badge-top"><div class="badge-img">${badgeImg(b)}</div>
        <div><div class="badge-name">${esc(b.name)}</div><div class="small muted">${esc(b.description)}</div></div></div>
      <div class="badge-tags"><span class="pill ${auto || hasLevels(b) ? 'pill-muted' : 'pill-current'}">${auto || hasLevels(b) ? 'automatique' : 'manuel'}</span>${hasLevels(b) ? `<span class="pill pill-warn" title="${esc(METRIC_LABEL[b.metric] || b.metric || '')}">${sortedLevels(b).length} niveaux · ${esc(METRIC_LABEL[b.metric] || b.metric || '')}</span>` : ''}<span class="small muted code-sm">${esc(b.code)}</span></div>
      <div class="badge-holders"><span class="pill ${h.length ? 'pill-ok' : 'pill-todo'}">${h.length} détenteur${h.length > 1 ? 's' : ''}</span>${h.length ? `<details class="badge-who"><summary>Voir les membres</summary><p class="small muted">${esc(names.join(', '))}</p></details>` : ''}</div>
      <div class="badge-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-badge-edit="${esc(b.code)}">Modifier</button>
        <button class="btn btn-ghost btn-sm btn-icon" type="button" data-badge-img="${esc(b.code)}" title="${b.image_url ? 'Changer l\'image' : 'Ajouter une image'}" aria-label="${b.image_url ? 'Changer l\'image' : 'Ajouter une image'} du badge ${esc(b.name)}">${ICON.upload}</button>
        <button class="btn btn-danger btn-sm btn-icon" type="button" data-badge-del="${esc(b.code)}" aria-label="Supprimer le badge ${esc(b.name)}" title="Supprimer">${ICON.trash}</button>
      </div>
    </div>`;
  }).join('') || emptyHtml(S.q.badges, 'Aucun badge.');

  const sel = $('#badge-member');
  // Les comptes fantômes ne reçoivent pas de badge tant qu'ils ne sont pas liés à un compte actif (migration 035).
  const pickable = S.members.filter((m) => !m.is_ghost).map((m) => ({ id: m.id, label: m.pseudo }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
  sel.innerHTML = '<option value="">Choisir un membre…</option>' +
    pickable.map((m) => `<option value="${esc(m.id)}"${m.id === S.badgeMember ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
  renderBadgeToggles();
}
/** Pastilles des badges du membre choisi : une pastille par badge, cochée s'il le possède. */
function renderBadgeToggles() {
  const uid = S.badgeMember;
  const box = $('#badge-toggles');
  if (!uid) { box.innerHTML = '<p class="small muted">Choisis un membre pour voir et modifier ses badges.</p>'; return; }
  const owned = new Set(S.userBadges.filter((u) => u.user_id === uid).map((u) => u.badge_code));
  box.innerHTML = S.badges.map((b) => `<button class="chip" type="button" data-toggle-badge="${esc(b.code)}" aria-pressed="${owned.has(b.code)}">${owned.has(b.code) ? ICON.check : ''}${esc(b.name)}</button>`).join('');
}
/**
 * Attribue un badge à un membre (ignore le doublon 23505), puis recharge badges et membres.
 * @param {string} userId
 * @param {string} code Code du badge.
 */
export async function awardBadge(userId, code) {
  const res = await sb.from('hg_user_badges').insert({ user_id: userId, badge_code: code });
  if (res.error && res.error.code !== '23505') throw res.error;
  await loadBadges(); renderBadges(); renderMembers();
}
/** Le membre possède-t-il ce badge ? */
export const hasBadge = (uid, code) => S.userBadges.some((u) => u.user_id === uid && u.badge_code === code);
/** Nom affiché d'un badge (son code si le badge est introuvable). */
export const badgeName = (code) => S.badges.find((b) => b.code === code)?.name ?? code;

/** Section « Badges » (registerSub) : le bouton « Nouveau badge » est dans la barre de zone. */
export const badgesSub = {
  /** Montage unique : branche les écouteurs et monte le formulaire des critères au-dessus de la grille. */
  main() { bindBadges(); mountBadgesCriteres($('#badge-grid')); },
  /** À chaque visite : pose le bouton « + Nouveau badge » dans la barre de zone. */
  open() {
    const z = $('#zone-actions');
    if (z) z.innerHTML = `<button class="btn btn-primary" type="button" id="badge-new">+ Nouveau badge</button>`;
  },
};

// Vrai une fois les écouteurs branchés : bindBadges ne s'exécute qu'une fois.
let bound = false;
/** Branche la recherche, le choix du membre et les clics (une seule fois). */
export function bindBadges() {
  if (bound) return;
  bound = true;
  const search = mountSearch($('#badge-grid'), { id: 'badge-search', label: 'Rechercher un badge', placeholder: 'Nom, description ou code…' });
  bindSearch(search.input, (q) => { S.q.badges = q; renderBadges(); });
  $('#badge-member').addEventListener('change', (ev) => { S.badgeMember = ev.target.value; renderBadgeToggles(); });
  document.addEventListener('click', onBadgeClick); // barre de zone (hors de la section) et grille
}

/**
 * Clics sur la section : nouveau badge, retirer ou attribuer un badge au membre, modifier, supprimer, changer l'image.
 * Les boutons de la barre de zone sont hors de la section : on ne filtre que les boutons de la grille (#badges).
 */
async function onBadgeClick(ev) {
  const t = ev.target.closest('button');
  if (!t) return;
  if (t.id === 'badge-new') {
    openBadgeEditor({ badges: S.badges, onSaved: async () => { await loadBadges(); renderBadges(); refreshEventsSection(); } });
    return;
  }
  if (!t.closest('#badges')) return;
  if (t.dataset.toggleBadge) {
    const code = t.dataset.toggleBadge, uid = S.badgeMember, on = t.getAttribute('aria-pressed') === 'true';
    if (on && !(await confirmBox('Retirer ce badge ?', `${pseudoOf(uid)} perdra le badge « ${badgeName(code)} ».`, { ok: 'Retirer', danger: true }))) return;
    await busy(t, async () => {
      if (on) {
        check(await sb.from('hg_user_badges').delete().eq('user_id', uid).eq('badge_code', code));
        await loadBadges(); renderBadges(); renderMembers();
      } else await awardBadge(uid, code);
      toast(on ? 'Badge retiré' : `Badge « ${badgeName(code)} » attribué à ${pseudoOf(uid)}`, 'ok');
    });
  }
  if (t.dataset.badgeEdit) {
    const badge = t.dataset.badgeEdit ? S.badges.find((b) => b.code === t.dataset.badgeEdit) : null;
    openBadgeEditor({ badge, badges: S.badges, onSaved: async () => { await loadBadges(); renderBadges(); refreshEventsSection(); } });
    return;
  }
  if (t.dataset.badgeDel) {
    const badge = S.badges.find((b) => b.code === t.dataset.badgeDel);
    if (!badge) return;
    const holders = S.userBadges.filter((u) => u.badge_code === badge.code).length;
    await busy(t, async () => {
      if (await deleteBadge(badge, holders)) {
        if (t.isConnected) t.disabled = false;
        await loadBadges(); renderBadges();
        toast(`Badge « ${badge.name} » supprimé`, 'ok');
      }
    });
    return;
  }
  if (t.dataset.badgeImg) {
    const code = t.dataset.badgeImg;
    const file = await pickFile($('#badge-file'));
    if (!file) return;
    await busy(t, async () => {
      const url = await uploadAsset(`badges/${code}`, file);
      check(await sb.from('hg_badges').update({ image_url: url }).eq('code', code));
      await loadBadges(); renderBadges();
      toast('Image du badge mise à jour', 'ok');
    });
  }
}
