// ===== Humane Gang — « Signaler » un contenu (idée A6), côté membre =====
// Menu « … » posé sur un moment de l'historique, une photo d'album ou un message privé : il propose « Signaler ».
// Une petite fenêtre demande la raison (« Blessant ou gênant », « Information privée », « Spam ou doublon », « Autre »)
// et un mot facultatif, puis confirme : « Merci, le Staff regarde. La personne concernée ne saura pas que c’est toi. »
// Envoi : RPC hg_report (migration 093) : une fois par contenu, 10 fois par jour au plus, masquage automatique au
// 3e membre distinct. Le Staff traite dans Communication › Assistance (filtre « Signalements »).
// Utilisation : reportButtonHtml(kind, id, quoi) dans le HTML de la page ; la délégation est posée à l'import.
// Mention d'un contenu masqué (vue de l'auteur) : hiddenNoteHtml(kind).
// Dépendances : core.js (sb, toast, errMsg, esc), feuilles ui-confirm.css et report.css (chargées à la demande).
// Exporte : reportButtonHtml, hiddenNoteHtml, openReport.
import { sb, toast, errMsg, esc } from './core.js';

const CSS = [new URL('../css/ui-confirm.css', import.meta.url).href, new URL('../css/report.css', import.meta.url).href];
const REASONS = [['blessant', 'Blessant ou gênant'], ['prive', 'Information privée'], ['spam', 'Spam ou doublon'], ['autre', 'Autre']];
/** Ce qui est signalé, pour le titre (« Signaler cette photo »). */
const WHAT = { moment: 'ce moment', photo: 'cette photo', message: 'ce message' };
let seq = 0;

/** Charge les feuilles de style une seule fois. */
function ensureStyles() {
  for (const href of CSS) {
    const name = href.split('/').pop();
    if (document.querySelector(`link[href$="${name}"]`)) continue;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    document.head.append(l);
  }
}

/**
 * Bouton « … » (menu avec « Signaler ») pour un contenu.
 * @param {'moment'|'photo'|'message'} kind Type de contenu.
 * @param {string|number} id Identifiant du contenu.
 * @param {string} [label] Nom du contenu pour les lecteurs d'écran.
 * @returns {string} HTML
 */
export function reportButtonHtml(kind, id, label = '') {
  return `<span class="rp-wrap"><button type="button" class="rp-more" data-report-kind="${esc(kind)}" data-report-ref="${esc(String(id))}"
    aria-haspopup="menu" aria-expanded="false" aria-label="Plus d’actions${label ? ` : ${esc(label)}` : ''}"><span aria-hidden="true">…</span></button></span>`;
}

/** Mention affichée à l'auteur d'un contenu masqué (les autres membres ne le voient plus). */
export function hiddenNoteHtml(kind = 'moment') {
  const quoi = { moment: 'Ce moment est masqué', photo: 'Cette photo est masquée', message: 'Message masqué' }[kind] || 'Contenu masqué';
  return `<p class="rp-hidden small" role="note">${quoi} par le Staff : les autres membres ne le voient plus.
    <a href="assistance.html">Demander une relecture</a></p>`;
}

/** Ferme le menu ouvert, s'il y en a un. */
function closeMenu(focusBtn = false) {
  const m = document.querySelector('.rp-menu');
  if (!m) return;
  const btn = m.previousElementSibling;
  m.remove();
  if (btn) { btn.setAttribute('aria-expanded', 'false'); if (focusBtn) btn.focus(); }
}

/** Ouvre le menu sous le bouton « … ». */
function openMenu(btn) {
  closeMenu();
  ensureStyles();
  const m = document.createElement('div');
  m.className = 'rp-menu';
  m.setAttribute('role', 'menu');
  m.innerHTML = '<button type="button" role="menuitem" class="rp-item">Signaler</button>';
  btn.after(m);
  btn.setAttribute('aria-expanded', 'true');
  const item = m.querySelector('button');
  item.addEventListener('click', () => {
    const { reportKind, reportRef } = btn.dataset;
    closeMenu();
    openReport(reportKind, reportRef, btn);
  });
  item.focus();
}

/**
 * Fenêtre de signalement : raison, mot facultatif, envoi, confirmation.
 * @param {'moment'|'photo'|'message'} kind
 * @param {string} ref Identifiant du contenu.
 * @param {HTMLElement|null} [opener] Élément qui reprend le focus à la fermeture.
 */
export function openReport(kind, ref, opener = null) {
  ensureStyles();
  const n = ++seq;
  const dlg = document.createElement('dialog');
  dlg.className = 'hg-dialog rp-dialog';
  dlg.setAttribute('aria-labelledby', `rp-t-${n}`);
  dlg.innerHTML = `<form method="dialog" class="stack" novalidate>
      <h2 class="dialog-title" id="rp-t-${n}">Signaler ${esc(WHAT[kind] || 'ce contenu')}</h2>
      <fieldset class="rp-reasons"><legend class="small muted">Pourquoi ?</legend>
        ${REASONS.map(([v, l], i) => `<label class="rp-opt"><input type="radio" name="reason" value="${v}"${i === 0 ? ' required' : ''}><span>${esc(l)}</span></label>`).join('')}
      </fieldset>
      <label class="field"><span>Un mot pour le Staff <span class="muted small">(facultatif)</span></span>
        <textarea name="note" rows="3" maxlength="500" placeholder="Ce qui pose problème, en quelques mots"></textarea></label>
      <p class="small muted">La personne concernée ne saura pas que c’est toi.</p>
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row dialog-actions">
        <button type="submit" value="cancel" formnovalidate class="btn btn-ghost">Annuler</button>
        <button type="button" class="btn btn-primary" data-rp-send>Envoyer au Staff</button>
      </div>
    </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const err = dlg.querySelector('.form-error');
  const send = dlg.querySelector('[data-rp-send]');
  dlg.addEventListener('close', () => { dlg.remove(); opener?.focus?.(); });
  send.addEventListener('click', async () => {
    const reason = form.elements.reason.value;
    err.hidden = true;
    if (!reason) { err.textContent = 'Choisis une raison.'; err.hidden = false; form.querySelector('input[name="reason"]').focus(); return; }
    send.disabled = true;
    try {
      const { data, error } = await sb.rpc('hg_report', { p_kind: kind, p_ref: String(ref), p_reason: reason, p_note: form.elements.note.value.trim() || null });
      if (error) throw error;
      form.innerHTML = `<h2 class="dialog-title" id="rp-t-${n}">Merci, le Staff regarde.</h2>
        <p class="muted">La personne concernée ne saura pas que c’est toi. Tu recevras la réponse du Staff dans Assistance › Mes demandes.</p>
        ${data?.masque ? '<p class="small muted">Plusieurs membres l’ont signalé : le contenu est masqué en attendant la décision.</p>' : ''}
        <div class="btn-row dialog-actions"><button type="submit" value="ok" class="btn btn-primary">Fermer</button></div>`;
      form.querySelector('button').focus();
      toast('Signalement envoyé', 'ok');
    } catch (e) {
      err.textContent = errMsg(e);
      err.hidden = false;
      send.disabled = false;
    }
  });
  dlg.showModal();
  form.querySelector('input[name="reason"]').focus();
}

// Délégation : bouton « … », fermeture du menu au clic ailleurs ou sur Échap.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.rp-more');
  if (btn) {
    e.preventDefault();
    if (btn.getAttribute('aria-expanded') === 'true') closeMenu(); else openMenu(btn);
    return;
  }
  if (!e.target.closest('.rp-menu')) closeMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.querySelector('.rp-menu')) closeMenu(true); });
