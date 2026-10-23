// Admin : signalements de contenus (idée A6), dans Communication › Assistance.
// Un signalement est une demande d'assistance « Signalement » liée à une ligne de hg_reports (migration 093).
// La demande ouverte montre un aperçu du seul contenu signalé (vignette de la photo, texte du moment, ou le seul
// message signalé, jamais le reste de la conversation), la raison, le mot facultatif, le nombre de signalements sur ce
// contenu, et trois actions : « Masquer », « Supprimer » (avec confirmation) ou « Ne rien faire ». Un contenu masqué
// peut être réaffiché. Chaque signaleur reçoit une réponse courte ; la décision est journalisée (hg_report_resolve).
// L'identité du signaleur n'est visible que du Staff « support » (jamais de l'auteur).
// Utilisé par support.js (reportOf, reportItem, reportCard). Dépend de core.js, ui-confirm.js, state.js, photos.js.
import { sb, toast, errMsg, esc, fmtDateTime } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { signedUrl, removeObjects } from '../photos.js';
import { S } from './state.js';

/** Libellés des contenus et des raisons (mêmes clés que la base). */
export const KIND = { moment: 'Moment', photo: 'Photo', message: 'Message privé' };
export const REASON = { blessant: 'Blessant ou gênant', prive: 'Information privée', spam: 'Spam ou doublon', autre: 'Autre' };
/** Seuil de masquage automatique affiché (réglage hg_settings.support.signalements, 3 par défaut). */
const SEUIL = 3;

/** Signalement lié à une demande d'assistance, ou undefined. */
export const reportOf = (supportId) => (S.reports || []).find((r) => r.support_id === supportId);
/** Signalements ouverts sur le même contenu. */
const sameContent = (r) => (S.reports || []).filter((x) => x.kind === r.kind && x.ref_id === r.ref_id);

/** Titre court du contenu signalé (« Photo · Nouvel an chez Litver », « Moment · « … » », « Message privé · 21 oct. »). */
export function reportTitle(r) {
  const s = r.snapshot || {};
  if (r.kind === 'photo') return `Photo · ${s.event_title || 'album'}`;
  if (r.kind === 'moment') return `Moment · « ${s.title || '…'} »`;
  return `Message privé · ${s.sent_at ? new Date(s.sent_at).toLocaleDateString('fr-CH', { day: 'numeric', month: 'short' }) : ''}`.trim();
}
/** Champs de liste (ui/list.js) d'une demande de signalement. */
export function reportItem(r) {
  const n = sameContent(r).filter((x) => x.status === 'ouverte').length || 1;
  return { title: reportTitle(r), excerpt: `${REASON[r.reason] || r.reason} · ${n} signalement${n > 1 ? 's' : ''}`, report: true };
}

/** Aperçu du seul contenu signalé (copie prise au moment du signalement). */
function previewHtml(r, url) {
  const s = r.snapshot || {};
  if (r.kind === 'photo') {
    return `${url ? `<img class="rp-photo" src="${esc(url)}" alt="Photo signalée${s.caption ? ` : ${esc(s.caption)}` : ''}">` : '<p class="small muted">Aperçu de la photo indisponible (supprimée ?).</p>'}
      ${s.caption ? `<p class="small muted">Légende : ${esc(s.caption)}</p>` : ''}`;
  }
  if (r.kind === 'moment') {
    return `${url ? `<img class="rp-photo" src="${esc(url)}" alt="">` : ''}<blockquote class="rp-quote"><strong>${esc(s.title || '')}</strong>${s.body ? `\n${esc(s.body)}` : ''}</blockquote>`;
  }
  return `<blockquote class="rp-quote">${esc(s.body || '')}</blockquote>
    <p class="small muted">Seul ce message est visible ici, jamais le reste de la conversation.</p>`;
}

/** Sous-titre : d'où vient le contenu et qui l'a publié. */
function originHtml(r) {
  const s = r.snapshot || {};
  const by = s.author ? ` · ${r.kind === 'message' ? 'écrit' : 'ajouté'} par ${esc(s.author)}` : '';
  if (r.kind === 'photo') return `Album${s.event_title ? ` de « ${esc(s.event_title)} »` : ''}${s.event_at ? ` du ${esc(new Date(s.event_at).toLocaleDateString('fr-CH', { day: 'numeric', month: 'short', year: 'numeric' }))}` : ''}${by}`;
  if (r.kind === 'moment') return `Moment culte${s.happened_on ? ` du ${esc(new Date(`${s.happened_on}T12:00:00`).toLocaleDateString('fr-CH', { day: 'numeric', month: 'short', year: 'numeric' }))}` : ''}${by}`;
  return `Conversation privée${s.sent_at ? ` · envoyé le ${esc(fmtDateTime(s.sent_at))}` : ''}${by}`;
}

/**
 * Carte du signalement (au-dessus du fil de la demande) avec les actions. onDone : rechargement après une décision.
 * @param {object} r Ligne de hg_reports.
 * @param {() => Promise<void>} onDone
 * @returns {HTMLElement}
 */
export function reportCard(r, onDone) {
  const el = document.createElement('section');
  el.className = 'rp-card';
  el.setAttribute('aria-label', 'Contenu signalé');
  const all = sameContent(r);
  const open = all.filter((x) => x.status === 'ouverte');
  const done = r.status !== 'ouverte';
  const actionTxt = { masquer: 'masqué', supprimer: 'supprimé', rien: 'laissé en ligne', reafficher: 'réaffiché' };
  const s = r.snapshot || {};
  const path = r.kind === 'photo' ? s.path : r.kind === 'moment' ? s.image_path : null;
  const paint = (url) => {
    el.innerHTML = `<div class="rp-head"><div><h3 class="rp-title">${esc(reportTitle(r))}</h3><p class="small muted">${originHtml(r)}</p></div>
        <span class="rp-reason" data-r="${esc(r.reason)}">${esc(REASON[r.reason] || r.reason)}</span></div>
      ${previewHtml(r, url)}
      ${r.note ? `<div class="rp-note"><span class="er-lbl">Mot du signalement</span><br>${esc(r.note)}</div>` : ''}
      <p class="small muted">Signalé par ${open.length || all.length} membre${(open.length || all.length) > 1 ? 's' : ''} (identité visible du Staff seulement) · masquage automatique à ${SEUIL} signalements</p>
      ${done ? `<p class="small rp-state">Décision prise : contenu ${esc(actionTxt[r.action] || 'traité')}${r.resolved_at ? ` le ${esc(fmtDateTime(r.resolved_at))}` : ''}.</p>` : ''}
      <div class="rp-actions">
        ${done ? '<span></span>' : '<button type="button" class="btn btn-ghost btn-sm" data-rp="rien">Ne rien faire</button>'}
        <div>
          ${done && r.action === 'supprimer' ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-rp="reafficher">Réafficher</button>'}
          ${done ? '' : '<button type="button" class="btn btn-ghost btn-sm" data-rp="supprimer">Supprimer</button><button type="button" class="btn btn-primary btn-sm" data-rp="masquer">Masquer</button>'}
        </div>
      </div>`;
  };
  paint(null);
  if (path) signedUrl(path).then((u) => paint(u)).catch(() => {});
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-rp]');
    if (!b) return;
    const action = b.dataset.rp;
    if (action === 'supprimer' && !(await confirmBox('Supprimer ce contenu ?', 'Il disparaît pour tout le monde, définitivement. Les personnes qui l’ont signalé reçoivent « C’est réglé ».', { ok: 'Supprimer', danger: true }))) return;
    b.disabled = true;
    try {
      const { data, error } = await sb.rpc('hg_report_resolve', { p_report: r.id, p_action: action });
      if (error) throw error;
      // Fichier de la photo ou de l'image du moment supprimé : retiré du stockage si le Staff en a le droit (sinon il reste, sans lien)
      if (action === 'supprimer' && data?.path) removeObjects([data.path]).catch(() => {});
      toast({ masquer: 'Contenu masqué', supprimer: 'Contenu supprimé', rien: 'Signalement classé', reafficher: 'Contenu réaffiché' }[action], 'ok');
      await onDone();
    } catch (ex) { toast(errMsg(ex), 'error'); b.disabled = false; }
  });
  return el;
}
