// Comptes admin : onglets « Sorties IRL », « Photos », « Idées & assistance » et « Badges » d'une fiche.
import { sb, toast, errMsg, esc, fmtDate, fmtDateTime } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { IC, check, tabError } from './common.js';
import { A, RSVP, IDEA, dropFicheCache } from './state.js';

/* ---------- Sorties IRL ---------- */
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
export async function setRsvp(eventId, status) {
  if (!status) check(await sb.from('hg_event_rsvps').delete().eq('event_id', eventId).eq('user_id', A.uid));
  else check(await sb.from('hg_event_rsvps').upsert({ event_id: eventId, user_id: A.uid, status, updated_at: new Date().toISOString() }, { onConflict: 'event_id,user_id' }));
  const res = await sb.from('hg_event_rsvps').select('event_id, status, updated_at').eq('user_id', A.uid);
  dropFicheCache();
  A.d.rsvps = { data: res.data ?? [], error: res.error };
  toast(status ? `Réponse enregistrée : ${RSVP.find(([v]) => v === status)[1]}` : 'Réponse retirée', 'ok');
}

/* ---------- Photos ---------- */
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
export async function deletePhoto(id) {
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
export async function toggleBadge(code, on) {
  const name = (A.d.badges.data ?? []).find((b) => b.code === code)?.name ?? code;
  if (on) {
    if (!(await confirmBox('Retirer ce badge ?', `${A.d.profile.pseudo} perdra le badge « ${name} ».`, { ok: 'Retirer', danger: true }))) return false;
    check(await sb.from('hg_user_badges').delete().eq('user_id', A.uid).eq('badge_code', code));
  } else {
    const res = await sb.from('hg_user_badges').insert({ user_id: A.uid, badge_code: code });
    if (res.error && res.error.code !== '23505') throw res.error;
  }
  const r = await sb.from('hg_user_badges').select('badge_code, awarded_at').eq('user_id', A.uid);
  dropFicheCache();
  A.d.ubadges = { data: r.data ?? [], error: r.error };
  toast(on ? 'Badge retiré' : `Badge « ${name} » attribué`, 'ok');
  return true;
}
