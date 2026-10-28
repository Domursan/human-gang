// ===== Humane Gang — administration : bot Discord, onglet « Annonces » (admin-bot.js) =====
// Annonce libre publiée dans les salons cochés (5 à 10 selon le réglage), avec aperçu et résultat par salon.
// Exporte : montageAnnonces(c). Contexte c : voir admin-bot.js.

import { sb, toast, esc, $, callFn } from '../../commun/core.js';
import { pluralCount } from '../../commun/utils.js';
import { ANN_MAX, BODY_MAX, MANUAL_BODY_MAX, MANUAL_TITLE_MAX, MEDIA_BUCKET, TITLE_MAX, attachmentUI, discordPreview, fnError, syncMentionSelect, truncate } from './admin-bot-commun.js';

export function montageAnnonces(c) {
  const { S, api, busy, confirmSend, container, salonName } = c;
  /* ======================= Annonce libre dans les salons ======================= */
  // Salons choisis (salon d'annonces par défaut et salons connus enregistrés), titre, message, mention, pièces jointes,
  // aperçu Discord. Publication par hg-notify (admin_dm avec la liste channels), après confirmation.
  const annForm = $('#ann-form', container);
  const annAtt = attachmentUI(container, 'ann-', renderAnnPreview);
  /** Salons proposés : le salon d'annonces par défaut d'abord, puis les salons connus (enregistrés). */
  function annOptions() {
    const def = S.bot.announce_channel_id, salons = S.bot.salons ?? [];
    const opts = [];
    if (def) opts.push({ id: def, label: salons.find((s) => s.id === def)?.nom ?? 'Salon d\'annonces', isDefault: true });
    for (const s of salons) if (s.id !== def) opts.push({ id: s.id, label: s.nom, isDefault: false });
    return opts;
  }

  /** Dessine la liste des salons de l'annonce libre. La sélection est gardée ; au premier passage, le salon par défaut est coché. */
  function renderAnnChannels() {
    const opts = annOptions();
    if (!S.annInit) { S.annInit = true; if (S.bot.announce_channel_id) S.annSel.add(S.bot.announce_channel_id); }
    for (const id of [...S.annSel]) if (!opts.some((o) => o.id === id)) S.annSel.delete(id);
    $('#ann-chan-list', container).innerHTML = opts.map((o) => `<label class="bm-row">
        <input type="checkbox" name="ann_chan" value="${esc(o.id)}"${S.annSel.has(o.id) ? ' checked' : ''}>
        <span class="bm-name">${esc(o.label)} <span class="muted small">${esc(o.id)}</span></span>
        ${o.isDefault ? '<span class="pill pill-current">Par défaut</span>' : ''}
      </label>`).join('');
    $('#ann-chan-none', container).hidden = opts.length > 0;
    syncMentionSelect($('#ann-mention', container), $('#ann-mention-hint', container), true, S.bot.mention_role_id);
    renderAnnPreview();
  }
  /** Compteurs, nombre de salons choisis et aperçu Discord de l'annonce libre. {pseudo} devient « tout le monde » (salon). */
  function renderAnnPreview() {
    const title = $('#ann-title', container).value, body = $('#ann-text', container).value;
    const picked = annOptions().filter((o) => S.annSel.has(o.id));
    $('#ann-title-count', container).textContent = `${title.length} / ${MANUAL_TITLE_MAX}`;
    $('#ann-text-count', container).textContent = `${body.length} / ${MANUAL_BODY_MAX}`;
    $('#ann-chan-count', container).textContent = `${pluralCount(S.annSel.size, 'salon choisi', 'salons choisis')} · ${ANN_MAX} au plus`;
    const mode = $('#ann-mention', container).value;
    const mention = mode === 'everyone' ? '@everyone' : mode === 'role' ? '@rôle' : '';
    const sub = (s) => s.replace(/\{pseudo\}/g, 'tout le monde');
    const attached = annAtt.files(), firstImage = attached.find((f) => f.url);
    const files = attached.map((f) => ({ name: f.file.name, size: f.file.size, inEmbed: f === firstImage }));
    $('#ann-preview-for', container).textContent = picked.length ? `dans ${pluralCount(picked.length, 'salon', 'salons')}` : 'choisis au moins un salon';
    $('#ann-preview', container).innerHTML = discordPreview({
      where: picked.map((o) => o.label).join(' · ') || 'Salon d\'annonces',
      mention,
      embed: { color: '#9E3543', title: truncate(sub(title).replace(/\s+/g, ' ').trim(), TITLE_MAX), description: truncate(sub(body).trim(), BODY_MAX), image: firstImage?.url ?? null },
      files,
    });
  }
  // Résultat par salon : { id, ok, error }. Sans détail (réponse sans « channels »), le résultat global vaut pour chaque salon.
  const annRows = (res, ids) => (Array.isArray(res?.channels) ? res.channels : ids.map((id) => ({ id, ok: res?.channel !== false })));
  /** Affiche le résultat d'une publication : nombre de salons, puis un ✓ ou un ✗ (avec l'erreur) pour chaque salon. */
  function renderAnnResult(res, ids) {
    const rows = annRows(res, ids), bad = rows.filter((r) => !r.ok).length;
    $('#ann-result', container).innerHTML = `<div class="bm-result-box">
        <div class="bm-result-head"><strong>Résultat</strong><span class="muted small">${esc(pluralCount(rows.length - bad, 'publiée', 'publiées'))}${bad ? ` · ${esc(pluralCount(bad, 'échec', 'échecs'))}` : ''}</span></div>
        <ul class="bm-res-list">${rows.map((r) => `<li class="bm-res-row"><span class="bm-name">${esc(salonName(r.id))}</span>${r.ok
    ? '<span class="pill pill-ok">✓ Publiée</span>'
    : `<span class="pill bm-pill-fail">✗ Échec</span>${r.error ? `<span class="small muted bm-reason">${esc(r.error)}</span>` : ''}`}</li>`).join('')}</ul>
        ${res?.log_error ? '<p class="small muted bm-log-warn">Envoyé, mais l\'historique n\'a pas pu être enregistré.</p>' : ''}
      </div>`;
  }
  /**
   * Publie l'annonce libre dans les salons choisis : contrôles, confirmation, téléversement des pièces jointes,
   * appel de hg-notify (admin_dm avec channels), puis résultat par salon. En cas d'échec, les fichiers déjà
   * téléversés sont retirés du stockage.
   * @param {HTMLButtonElement|null} btn Bouton « Publier ».
   */
  async function sendAnnonce(btn) {
    if (S.annSending) return;
    const title = $('#ann-title', container).value.trim(), body = $('#ann-text', container).value.trim();
    const mode = $('#ann-mention', container).value;
    const ids = annOptions().map((o) => o.id).filter((id) => S.annSel.has(id));
    if (!ids.length) { toast('Choisis au moins un salon', 'error'); return; }
    if (!body) { toast('Écris un message', 'error'); $('#ann-text', container).focus(); return; }
    if (body.length > MANUAL_BODY_MAX) { toast(`Message trop long (${MANUAL_BODY_MAX} caractères maximum)`, 'error'); return; }
    if (mode === 'role' && !S.bot.mention_role_id) { toast('Aucun rôle configuré pour la mention', 'error'); return; }
    const files = annAtt.files();
    const fileTxt = files.length ? ` Avec ${pluralCount(files.length, 'pièce jointe', 'pièces jointes')}.` : '';
    const mentionTxt = mode === 'everyone' ? ' Mention @everyone : tout le serveur sera notifié.' : mode === 'role' ? ' Le rôle mentionné sera notifié.' : '';
    if (!(await confirmSend(`Publier cette annonce dans ${pluralCount(ids.length, 'salon', 'salons')} ?${fileTxt}${mentionTxt}`))) return;
    S.annSending = true;
    const resBox = $('#ann-result', container);
    const uploaded = [];
    resBox.innerHTML = `<div class="bm-sending" role="status">${files.length ? 'Téléversement des pièces jointes…' : 'Publication en cours…'}</div>`;
    await busy(btn, async () => {
      try {
        await annAtt.upload(uploaded);
        const res = await callFn('hg-notify', { event: 'admin_dm', user_ids: [], channels: ids, title, body, mention: mode, attachments: uploaded });
        if (res?.error) throw new Error(res.error);
        renderAnnResult(res, ids);
        const bad = annRows(res, ids).filter((r) => !r.ok).length;
        toast(bad ? 'Publication terminée avec des échecs' : 'Annonce publiée', bad ? 'error' : 'ok');
        annAtt.clear();
        S.history = null;
        if ($('#bm-history', container).open) api.loadHistory();
      } catch (e) {
        // Échec : les fichiers déjà téléversés sont retirés du stockage ; le message d'erreur reste dans la zone de résultat.
        if (uploaded.length) sb.storage.from(MEDIA_BUCKET).remove(uploaded).catch(() => {});
        resBox.innerHTML = `<div class="bm-error" role="alert">Échec de la publication : ${esc(await fnError(e))}</div>`;
      } finally { S.annSending = false; }
    });
  }
  $('#ann-chan-list', container).addEventListener('change', (ev) => {
    const cb = ev.target;
    if (!(cb instanceof HTMLInputElement) || cb.name !== 'ann_chan') return;
    if (cb.checked) {
      if (S.annSel.size >= ANN_MAX) { cb.checked = false; toast(`${ANN_MAX} salons maximum par annonce`, 'error'); return; }
      S.annSel.add(cb.value);
    } else S.annSel.delete(cb.value);
    renderAnnPreview();
  });
  for (const sel of ['#ann-title', '#ann-text']) $(sel, container).addEventListener('input', renderAnnPreview);
  $('#ann-mention', container).addEventListener('change', renderAnnPreview);
  annForm.addEventListener('submit', (ev) => { ev.preventDefault(); sendAnnonce(ev.submitter ?? annForm); });



  Object.assign(api, { renderAnnChannels });
}
