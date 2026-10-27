// ===== Humane Gang — conversations de groupe de la messagerie (idée P3, migration 090) =====
/*
 * Rôle : création d'un groupe libre (nom, couleur, membres), pile d'avatars, panneau du groupe (membres, ajout, retrait,
 * renommage pour le responsable ; sourdine et départ pour chacun), messages système centrés.
 * Les discussions de sortie (créées depuis /pages/irl/irl.html, lien /pages/compte/messages.html?event=<id>) sont des groupes liés à une sortie.
 * Modèle de sécurité inchangé : tout passe par des RPC qui vérifient l'appartenance (aucun accès direct aux tables).
 * Dépendances : core.js, social.js (réglages, boîte de dialogue), ui-confirm.js, icons.js.
 * RPC : hg_group_create, hg_group_info, hg_group_add, hg_group_remove, hg_group_rename, hg_group_leave, hg_group_mute,
 * hg_event_conv_open.
 * Exporte : isGroup, groupAvatarHtml, groupSubtitle, systemRowHtml, openGroupCreate, openGroupPanel, openEventConv, muteLabel.
 */
import { sb, esc, toast, errMsg, avatarHtml } from '../../commun/core.js';
import { socialSettings, openDialog } from '../compte/social.js';
import { confirmBox } from '../../commun/ui-confirm.js';
import { svg } from '../../commun/icons.js';

const I = {
  users: svg('users2', { size: 16, stroke: 2 }),
  bell: svg('megaphone', { size: 16, stroke: 2 }),
  out: svg('out', { size: 16, stroke: 2 }),
  edit: svg('edit', { size: 16, stroke: 2 }),
  close: svg('close', { size: 16, stroke: 2 }),
  cal: svg('cal', { size: 14, stroke: 2 }),
};
/** Couleurs proposées pour un groupe. */
export const GROUP_COLORS = ['#9E3543', '#CF7055', '#D8A75E', '#6FA37F', '#7E93C9', '#9A88C4', '#E0909A', '#5B5B63'];
/** Sourdines proposées : valeur envoyée à hg_group_mute, libellé. */
const MUTES = [['8h', 'Pendant 8 h'], ['semaine', 'Pendant une semaine'], ['toujours', 'Toujours'], ['off', 'Réactiver les notifications']];

/** Vrai pour une conversation de groupe (libre ou discussion de sortie). */
export const isGroup = (c) => c?.kind === 'group';
/** Texte normalisé (sans accents, minuscules) pour la recherche de membres. */
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Libellé de sourdine (« en sourdine jusqu’à … ») ou chaîne vide si les notifications sont actives.
 * @param {string|null} until fin de la sourdine (ISO, 'infinity' ou null)
 */
export function muteLabel(until) {
  if (!until) return '';
  if (String(until).includes('infinity')) return 'En sourdine';
  const d = new Date(until);
  if (!(d > new Date())) return '';
  return `En sourdine jusqu’au ${new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d)}`;
}

/**
 * Pile d'avatars d'un groupe (3 au plus) avec une pastille de couleur.
 * @param {object} c conversation (member_ids, color, title)
 * @param {Map<string, object>} members annuaire
 * @param {number} [size=44]
 */
export function groupAvatarHtml(c, members, size = 44) {
  const ids = (c.member_ids || []).slice(0, 3);
  const s = Math.round(size * 0.64);
  const avs = ids.length
    ? ids.map((id) => avatarHtml(members.get(id) || { id, pseudo: '?' }, s)).join('')
    : `<span class="grp-initial" style="width:${s}px;height:${s}px">${esc(String(c.title || 'G').slice(0, 1).toUpperCase())}</span>`;
  const col = /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : 'var(--slate)';
  return `<span class="grp-av" style="width:${size}px;height:${size}px;--grp:${col}" aria-hidden="true">${avs}</span>`;
}

/** Sous-titre d'un groupe : « Groupe · 4 membres » ou « Discussion de la sortie · 9 membres ». */
export function groupSubtitle(c) {
  const n = Number(c.members_count) || 0;
  return `${c.event_id ? 'Discussion de la sortie' : 'Groupe'} · ${n} membre${n > 1 ? 's' : ''}`;
}

/** Ligne d'un message système (« Wae a ajouté Mycethyst »), centrée et discrète. */
export function systemRowHtml(m) {
  return `<p class="msg-sys" data-id="${esc(m.id)}"><span>${esc(m.body)}</span></p>`;
}

/** Liste de membres à cocher (recherche par pseudo), pour la création et l'ajout. */
function pickHtml(list, prefix) {
  return list.map((m) => `<li><label class="grp-pick"><input type="checkbox" value="${esc(m.id)}" data-name="${esc(norm(m.pseudo))}" id="${prefix}-${esc(m.id)}">
    ${avatarHtml(m, 32)}<span>${esc(m.pseudo)}</span></label></li>`).join('');
}
/** Branche la recherche et le compteur d'une liste de membres à cocher. */
function bindPick(dlg, max) {
  const boxes = [...dlg.querySelectorAll('.grp-pick input')];
  const count = dlg.querySelector('[data-grp-count]');
  const sync = () => {
    const n = boxes.filter((b) => b.checked).length;
    boxes.forEach((b) => { b.disabled = !b.checked && n >= max; });
    if (count) count.textContent = `${n} choisi${n > 1 ? 's' : ''} · ${max} au plus`;
  };
  boxes.forEach((b) => b.addEventListener('change', sync));
  dlg.querySelector('[data-grp-search]')?.addEventListener('input', (e) => {
    const q = norm(e.target.value);
    boxes.forEach((b) => { b.closest('li').hidden = !!q && !b.dataset.name.includes(q); });
  });
  sync();
  return () => boxes.filter((b) => b.checked).map((b) => b.value);
}

/**
 * Boîte « Nouveau groupe » : nom, couleur, membres. Appelle onCreated(id) après la création.
 * @param {{members: Map<string, object>, me: {id: string}, onCreated: Function}} o
 */
export async function openGroupCreate({ members, me, onCreated }) {
  const cfg = await socialSettings();
  const max = (cfg.plafonds.groupe_membres_max || 30) - 1;
  const list = [...members.values()].filter((m) => m.id !== me.id).sort((a, b) => String(a.pseudo).localeCompare(String(b.pseudo), 'fr'));
  const dlg = openDialog({ id: 'grp-new-dlg', title: 'Nouveau groupe', body: `<form class="stack" id="grp-form" novalidate>
    <div class="field"><label for="grp-title">Nom du groupe</label><input id="grp-title" maxlength="60" required placeholder="Nouvel an chez Litver"></div>
    <fieldset class="grp-colors"><legend>Couleur</legend><div class="grp-color-row">${GROUP_COLORS.map((c, i) => `<label class="grp-color">
      <input type="radio" name="grp-color" value="${c}"${i === 4 ? ' checked' : ''}><span style="background:${c}" aria-hidden="true"></span><span class="visually-hidden">Couleur ${c}</span></label>`).join('')}</div></fieldset>
    <div class="field"><label for="grp-search">Membres</label><input id="grp-search" type="search" data-grp-search autocomplete="off" placeholder="Chercher un membre…">
      <span class="small muted" data-grp-count aria-live="polite"></span></div>
    <ul class="grp-pick-list" aria-label="Membres à ajouter">${pickHtml(list, 'grp-new')}</ul>
    <p class="small muted">${cfg.plafonds.groupes_semaine} groupes par semaine au plus. Les groupes servent à s’organiser : le salon du gang reste sur Discord.</p>
    <p class="form-error" id="grp-err" role="alert" hidden></p>
    <div class="btn-row"><button class="btn btn-primary" type="submit">Créer le groupe</button></div>
  </form>` });
  const picked = bindPick(dlg, max);
  dlg.querySelector('#grp-title').focus();
  dlg.querySelector('#grp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = dlg.querySelector('#grp-err'), btn = e.target.querySelector('[type=submit]');
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    const title = dlg.querySelector('#grp-title').value.trim(), ids = picked();
    if (!title) return fail('Donne un nom au groupe.');
    if (!ids.length) return fail('Choisis au moins un membre.');
    btn.disabled = true; err.hidden = true;
    try {
      const { data, error } = await sb.rpc('hg_group_create', { p_title: title, p_color: dlg.querySelector('input[name="grp-color"]:checked')?.value || null, p_members: ids });
      if (error) throw error;
      dlg.close();
      toast('Groupe créé.', 'ok');
      await onCreated?.(Array.isArray(data) ? data[0] : data);
    } catch (ex) { fail(errMsg(ex)); btn.disabled = false; }
  });
}

/**
 * Panneau d'un groupe : membres, sourdine, départ ; ajout, retrait et renommage pour le responsable.
 * @param {string} conv identifiant de la conversation
 * @param {{members: Map<string, object>, me: {id: string}, onChange: Function, onLeft: Function}} o
 */
export async function openGroupPanel(conv, { members, me, onChange, onLeft }) {
  let g;
  try {
    const { data, error } = await sb.rpc('hg_group_info', { p_conv: conv });
    if (error) throw error;
    g = data;
  } catch (e) { toast(errMsg(e), 'error'); return; }
  const resp = g.my_role === 'resp';
  const inside = new Set((g.members || []).map((m) => m.id));
  const others = [...members.values()].filter((m) => !inside.has(m.id)).sort((a, b) => String(a.pseudo).localeCompare(String(b.pseudo), 'fr'));
  const room = Math.max(0, (g.max || 30) - inside.size);
  const muted = muteLabel(g.muted_until);
  const dlg = openDialog({ id: 'grp-dlg', title: g.title || 'Groupe', body: `
    ${g.event_id ? `<p class="small grp-event">${I.cal}<span>Discussion de la sortie « ${esc(g.event_title || g.title)} » : les réponses « oui » et « peut-être » y entrent d’elles-mêmes. <a href="/pages/irl/irl.html#event-${esc(g.event_id)}">Voir la sortie</a></span></p>` : ''}
    ${resp ? `<form class="stack grp-rename" id="grp-rename" novalidate>
      <div class="field"><label for="grp-rn">Nom du groupe</label><input id="grp-rn" maxlength="60" value="${esc(g.title || '')}"></div>
      <fieldset class="grp-colors"><legend>Couleur</legend><div class="grp-color-row">${GROUP_COLORS.map((c) => `<label class="grp-color">
        <input type="radio" name="grp-rc" value="${c}"${c.toLowerCase() === String(g.color || '').toLowerCase() ? ' checked' : ''}><span style="background:${c}" aria-hidden="true"></span><span class="visually-hidden">Couleur ${c}</span></label>`).join('')}</div></fieldset>
      <div class="btn-row"><button class="btn btn-ghost" type="submit">${I.edit}<span>Enregistrer le nom</span></button></div></form>` : ''}
    <h3 class="grp-h">${I.users} ${g.members.length} membre${g.members.length > 1 ? 's' : ''}</h3>
    <ul class="grp-members">${g.members.map((m) => `<li class="grp-member">${avatarHtml(m, 32)}<span class="grp-member-name">${esc(m.pseudo)}${m.id === me.id ? ' <span class="muted">(toi)</span>' : ''}</span>
      ${m.role === 'resp' ? '<span class="pill pill-current grp-resp">Responsable</span>' : ''}
      ${resp && m.id !== me.id ? `<button type="button" class="btn btn-ghost btn-sm" data-grp-rm="${esc(m.id)}" aria-label="Retirer ${esc(m.pseudo)} du groupe">Retirer</button>` : ''}</li>`).join('')}</ul>
    ${resp && others.length && room ? `<details class="grp-add"><summary>Ajouter des membres</summary>
      <div class="field"><label for="grp-add-search" class="visually-hidden">Chercher un membre</label><input id="grp-add-search" type="search" data-grp-search placeholder="Chercher un membre…">
        <span class="small muted" data-grp-count aria-live="polite"></span></div>
      <ul class="grp-pick-list">${pickHtml(others, 'grp-add')}</ul>
      <div class="btn-row"><button type="button" class="btn btn-primary" id="grp-add-go">Ajouter</button></div></details>` : ''}
    <fieldset class="grp-mute"><legend>Notifications${muted ? ` · <span class="muted">${esc(muted)}</span>` : ''}</legend>
      <div class="btn-row">${MUTES.filter(([v]) => v !== 'off' || muted).map(([v, l]) => `<button type="button" class="btn btn-ghost btn-sm" data-grp-mute="${v}">${l}</button>`).join('')}</div>
      <p class="small muted">En sourdine : plus de notification push, mais le compteur de non-lus reste.</p></fieldset>
    <div class="btn-row"><button type="button" class="btn btn-danger" id="grp-leave">${I.out}<span>Quitter le groupe</span></button></div>` });
  const picked = dlg.querySelector('.grp-add') ? bindPick(dlg, room) : () => [];
  /** Exécute une RPC du groupe puis rafraîchit la conversation. */
  const run = async (fn, args, ok) => {
    try {
      const { error } = await sb.rpc(fn, args);
      if (error) throw error;
      if (ok) toast(ok, 'ok');
      return true;
    } catch (e) { toast(errMsg(e), 'error'); return false; }
  };
  dlg.querySelector('#grp-rename')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await run('hg_group_rename', { p_conv: conv, p_title: dlg.querySelector('#grp-rn').value.trim(), p_color: dlg.querySelector('input[name="grp-rc"]:checked')?.value || null }, 'Groupe renommé.')) {
      dlg.close(); onChange?.();
    }
  });
  dlg.querySelector('#grp-add-go')?.addEventListener('click', async () => {
    const ids = picked();
    if (!ids.length) { toast('Coche au moins un membre.', 'error'); return; }
    if (await run('hg_group_add', { p_conv: conv, p_users: ids }, 'Membres ajoutés.')) { dlg.close(); onChange?.(); }
  });
  dlg.querySelectorAll('[data-grp-rm]').forEach((b) => b.addEventListener('click', async () => {
    const name = members.get(b.dataset.grpRm)?.pseudo || g.members.find((m) => m.id === b.dataset.grpRm)?.pseudo || 'ce membre';
    if (!(await confirmBox(`Retirer ${name} ?`, 'Il ou elle perd l’accès à toute la conversation.', { ok: 'Retirer', danger: true }))) return;
    if (await run('hg_group_remove', { p_conv: conv, p_user: b.dataset.grpRm }, `${name} a été retiré.`)) { dlg.close(); onChange?.(); }
  }));
  dlg.querySelectorAll('[data-grp-mute]').forEach((b) => b.addEventListener('click', async () => {
    const v = b.dataset.grpMute;
    if (await run('hg_group_mute', { p_conv: conv, p_mode: v }, v === 'off' ? 'Notifications réactivées.' : 'Groupe en sourdine.')) { dlg.close(); onChange?.(); }
  }));
  dlg.querySelector('#grp-leave').addEventListener('click', async () => {
    if (!(await confirmBox('Quitter le groupe ?', 'Tu ne verras plus ses messages.', { ok: 'Quitter', danger: true }))) return;
    if (await run('hg_group_leave', { p_conv: conv }, 'Tu as quitté le groupe.')) { dlg.close(); onLeft?.(); }
  });
}

/**
 * Ouvre (ou crée) la discussion d'une sortie et renvoie son identifiant ; null en cas de refus (message affiché).
 * @param {string} eventId identifiant de la sortie
 */
export async function openEventConv(eventId) {
  try {
    const { data, error } = await sb.rpc('hg_event_conv_open', { p_event: eventId });
    if (error) throw error;
    return Array.isArray(data) ? data[0] : data;
  } catch (e) { toast(`Discussion indisponible : ${errMsg(e)}`, 'error'); return null; }
}
