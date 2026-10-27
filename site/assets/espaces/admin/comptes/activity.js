// =====================================================================
// Comptes admin : onglets « Sorties IRL », « Photos », « Idées & assistance » et « Badges » d'une fiche.
// Chaque onglet a son rendu (…Html) et, si besoin, son action d'écriture (set…, delete…, toggle…).
// Dépendances : core.js (sb, toast, errMsg, esc, dates), ui-confirm.js (confirmBox), common.js (IC, check, tabError),
// state.js (A, RSVP, IDEA, dropFicheCache).
// Tables/Storage : hg_event_rsvps, hg_photos + bucket hg-photos, hg_ideas, hg_support, hg_user_badges.
// Exporte : irlHtml, setRsvp, photosHtml, deletePhoto, contribHtml, badgesHtml, toggleBadge.
// =====================================================================
import { sb, toast, errMsg, esc, fmtDate, fmtDateTime } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { IC, check, tabError } from './common.js';
import { A, RSVP, IDEA, dropFicheCache } from './state.js';

/* ---------- Sorties IRL ---------- */
/** HTML de l'onglet Sorties IRL : une ligne par sortie, avec la réponse du membre modifiable. */
export function irlHtml() {
  const d = A.d;
  if (d.events.error) return tabError(d.events);
  const evs = d.events.data ?? [];
  const by = new Map((d.rsvps.data ?? []).map((r) => [r.event_id, r]));
  if (!evs.length) return '<div class="empty">Aucune sortie pour l\'instant.</div>';
  const now = Date.now();
  return `
    <p class="small muted">Change la réponse de ${esc(d.profile.pseudo)} : elle est enregistrée tout de suite.</p>
    <ul class="acc-events">${evs.map((e) => {
      const r = by.get(e.id);
      return `<li class="acc-event">
        <div class="acc-event-main"><strong>${esc(e.title)}</strong>
          <div class="small muted">${e.starts_at ? esc(fmtDateTime(e.starts_at)) : 'Date à définir'}${e.location ? ` · ${esc(e.location)}` : ''}${e.starts_at && new Date(e.starts_at) < now ? ' · passée' : ''}${r ? ` · répondu le ${esc(fmtDate(r.updated_at))}` : ''}</div></div>
        <div class="field acc-rsvp"><label for="ar-${esc(e.id)}" class="visually-hidden">Réponse à ${esc(e.title)}</label>
          <select id="ar-${esc(e.id)}" data-rsvp="${esc(e.id)}">${RSVP.map(([v, l]) => `<option value="${v}"${(r?.status ?? '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      </li>`;
    }).join('')}</ul>`;
}
/**
 * Enregistre la réponse du membre à une sortie. Un statut vide retire la réponse.
 * Relit ensuite toutes ses réponses pour rafraîchir l'onglet.
 * @param {string} eventId identifiant de la sortie.
 * @param {string} status 'oui', 'peut-etre', 'non' ou '' (sans réponse).
 */
export async function setRsvp(eventId, status) {
  // RPC journalisée (migration 076) : un statut vide retire la réponse.
  check(await sb.rpc('hg_rsvp_admin_set', { p_event: eventId, p_user: A.uid, p_status: status || null }));
  const res = await sb.from('hg_event_rsvps').select('event_id, status, updated_at').eq('user_id', A.uid);
  dropFicheCache();
  A.d.rsvps = { data: res.data ?? [], error: res.error };
  toast(status ? `Réponse enregistrée : ${RSVP.find(([v]) => v === status)[1]}` : 'Réponse retirée', 'ok');
}

/* ---------- Photos ---------- */
/** HTML de l'onglet Photos : miniatures signées et bouton de suppression pour chaque photo. */
export function photosHtml() {
  const d = A.d;
  if (d.photos.error) return tabError(d.photos);
  const list = d.photos.data ?? [];
  if (!list.length) return `<div class="empty">${esc(d.profile.pseudo)} n'a ajouté aucune photo.</div>`;
  const evTitle = new Map((d.events.data ?? []).map((e) => [e.id, e.title]));
  return `
    <p class="small muted">${list.length} photo${list.length > 1 ? 's' : ''} ajoutée${list.length > 1 ? 's' : ''} aux albums.</p>
    <ul class="acc-photos">${list.map((p) => {
      const url = d.signed.get(p.path);
      return `<li class="acc-photo">
        <a class="acc-photo-img" ${url ? `href="${esc(url)}" target="_blank" rel="noopener"` : ''} aria-label="Ouvrir la photo en grand">${url ? `<img src="${esc(url)}" alt="${esc(p.caption || '')}" loading="lazy">` : '<span class="small muted">Aperçu indisponible</span>'}</a>
        <div class="acc-photo-meta small"><strong>${esc(evTitle.get(p.event_id) || 'Sans sortie')}</strong>
          <span class="muted">${esc(fmtDate(p.created_at))}${p.caption ? ` · ${esc(p.caption)}` : ''}</span></div>
        <button class="btn btn-danger btn-sm" type="button" data-del-photo="${esc(p.id)}">${IC.trash} Supprimer</button>
      </li>`;
    }).join('')}</ul>`;
}
/**
 * Supprime une photo après confirmation : le fichier dans le stockage, puis la ligne en base.
 * Si seul le fichier échoue, la fiche est tout de même supprimée et un message le signale.
 * @param {string} id identifiant de la photo.
 * @returns {Promise<boolean>} true si la photo a été supprimée, false si annulé ou introuvable.
 */
export async function deletePhoto(id) {
  /* Photo à supprimer, retrouvée par son identifiant. */
  const p = (A.d.photos.data ?? []).find((x) => x.id === id);
  if (!p) return false;
  if (!(await confirmBox('Supprimer cette photo ?', 'Le fichier et sa fiche seront supprimés définitivement de l\'album.', { ok: 'Supprimer', danger: true }))) return false;
  const st = await sb.storage.from('hg-photos').remove([p.path]);
  check(await sb.from('hg_photos').delete().eq('id', id));
  dropFicheCache();
  if (st.error) toast(`Fiche supprimée, mais le fichier n'a pas pu l'être : ${errMsg(st.error)}`, 'error');
  else toast('Photo supprimée', 'ok');
  return true;
}

/* ---------- Idées & assistance ---------- */
/** HTML de l'onglet Idées & assistance : la boîte à idées puis les demandes d'aide du membre. */
export function contribHtml() {
  const d = A.d;
  const ideas = d.ideas.data ?? [], sup = d.support.data ?? [];
  return `
    <h4 class="sub-title">Boîte à idées (${ideas.length})</h4>
    ${d.ideas.error ? tabError(d.ideas) : ideas.length ? ideas.map((i) => `
      <article class="item">
        <div class="item-meta"><span>${esc(fmtDateTime(i.created_at))}</span></div>
        <p class="item-body">${esc(i.body)}</p>
        <div class="acc-inline">
          <div class="field"><label for="aid-${esc(i.id)}" class="visually-hidden">Statut de l'idée</label>
            <select id="aid-${esc(i.id)}" data-idea-status="${esc(i.id)}">${Object.entries(IDEA).map(([k, l]) => `<option value="${k}"${k === i.status ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
          <button class="btn btn-danger btn-sm btn-icon" type="button" data-del-idea="${esc(i.id)}" aria-label="Supprimer cette idée">${IC.trash}</button>
        </div>
      </article>`).join('') : '<p class="small muted">Aucune idée envoyée.</p>'}
    <h4 class="sub-title acc-sub2">Demandes d'assistance (${sup.length})</h4>
    ${d.support.error ? tabError(d.support) : sup.length ? sup.map((s) => `
      <article class="item">
        <div class="item-meta"><strong>${esc(s.subject)}</strong><span>${esc(fmtDateTime(s.created_at))}</span>
          <span class="pill ${s.status === 'ouverte' ? 'pill-current' : 'pill-ok'}">${s.status === 'ouverte' ? 'Ouverte' : 'Traitée'}</span></div>
        <p class="item-body">${esc(s.message)}</p>
        ${s.contact ? `<div class="small muted">Contact : <strong class="text">${esc(s.contact)}</strong></div>` : ''}
        <div class="btn-row">
          <button class="btn btn-ghost btn-sm" type="button" data-support="${esc(s.id)}" data-status="${s.status === 'ouverte' ? 'traitee' : 'ouverte'}">${s.status === 'ouverte' ? `${IC.check} Marquer traitée` : 'Rouvrir'}</button>
          <button class="btn btn-danger btn-sm btn-icon" type="button" data-del-support="${esc(s.id)}" aria-label="Supprimer cette demande">${IC.trash}</button>
        </div>
      </article>`).join('') : '<p class="small muted">Aucune demande d\'assistance.</p>'}`;
}

/* ---------- Badges ---------- */
/** HTML de l'onglet Badges : une puce par badge, « pressée » si le membre le possède. */
export function badgesHtml() {
  const d = A.d;
  if (d.badges.error) return tabError(d.badges);
  const owned = new Map((d.ubadges.data ?? []).map((u) => [u.badge_code, u]));
  return `
    <p class="small muted">${owned.size} badge${owned.size > 1 ? 's' : ''} sur ${(d.badges.data ?? []).length}. Touche un badge pour l'attribuer ou le retirer.</p>
    <div class="badge-toggles">${(d.badges.data ?? []).map((b) => {
      const u = owned.get(b.code);
      return `<button class="chip" type="button" data-toggle-badge="${esc(b.code)}" aria-pressed="${!!u}" title="${esc(b.description)}${u ? ` (depuis le ${esc(fmtDate(u.awarded_at))})` : ''}">${u ? IC.check : ''}${esc(b.name)}</button>`;
    }).join('')}</div>`;
}
/**
 * Attribue ou retire un badge. Le retrait demande confirmation.
 * Une attribution déjà existante (erreur 23505, doublon) n'est pas considérée comme une erreur.
 * @param {string} code code du badge.
 * @param {boolean} on true si le membre possède déjà le badge (on le retire), false sinon (on l'attribue).
 * @returns {Promise<boolean>} true si la fiche a changé, false si annulé.
 */
export async function toggleBadge(code, on) {
  /* Nom du badge, pour les messages. */
  const name = (A.d.badges.data ?? []).find((b) => b.code === code)?.name ?? code;
  if (on) {
    if (!(await confirmBox('Retirer ce badge ?', `${A.d.profile.pseudo} perdra le badge « ${name} ».`, { ok: 'Retirer', danger: true }))) return false;
    check(await sb.from('hg_user_badges').delete().eq('user_id', A.uid).eq('badge_code', code));
  } else {
    check(await sb.rpc('hg_badge_award', { p_user: A.uid, p_code: code })); // RPC journalisée (migration 076)
  }
  const r = await sb.from('hg_user_badges').select('badge_code, awarded_at').eq('user_id', A.uid);
  dropFicheCache();
  A.d.ubadges = { data: r.data ?? [], error: r.error };
  toast(on ? 'Badge retiré' : `Badge « ${name} » attribué`, 'ok');
  return true;
}
