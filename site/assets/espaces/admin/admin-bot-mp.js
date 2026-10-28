// ===== Humane Gang — administration : bot Discord, onglet « Messages privés » (admin-bot.js) =====
// Envoi manuel de MP (destinataires, pièces jointes, confirmation, résultat) et historique des envois (recherche, échecs seulement).
// Exporte : montageMp(c). Contexte c : voir admin-bot.js.

import { sb, toast, errMsg, esc, $, $$, callFn, avatarHtml } from '../../commun/core.js';
import { pluralCount } from '../../commun/utils.js';
import { matches, searchHtml, bindSearch, setCount, emptyHtml, PAGE_SIZE, SEARCH_DELAY } from './list-tools.js';
import { BODY_MAX, CONFIRM_ABOVE, ICON, MANUAL_BODY_MAX, MANUAL_TITLE_MAX, MAX_RECIPIENTS, MEDIA_BUCKET, MENTION_MODES, RESULT, STATUS, TITLE_MAX, attachFieldHtml, attachmentUI, discordPreview, fnError, kindLabel, logFmt, norm, syncMentionSelect, truncate } from './admin-bot-commun.js';

export function montageMp(c) {
  const { S, api, busy, confirmSend, container, salonName } = c;
  /* ======================= Message manuel ======================= */
  // Zone de l'envoi manuel : destinataires, rédaction, pièces jointes, aperçu et résultat.
  const bmBody = $('#bm-body', container);
  let mAtt = null; // pièces jointes du message manuel (attachmentUI, créées avec la liste des comptes)
  /** Vrai si le compte peut recevoir un MP du bot (ID Discord présent et MP non refusés). */
  const reachable = (p) => p.status === 'ok';
  /** Comptes affichés dans la liste, filtrés par la recherche (nom ou courriel, sans accents ni casse). */
  const visible = () => {
    const q = norm(S.q);
    return S.people.filter((p) => !q || norm(p.name).includes(q) || norm(p.email).includes(q));
  };

  /** Dessine le formulaire d'envoi manuel et branche ses contrôles : recherche, sélection, salon, pièces jointes, envoi. */
  function renderManualShell() {
    bmBody.innerHTML = `
      <div class="bm-layout">
        <fieldset class="bm-recipients">
          <legend class="label">Destinataires</legend>
          <div class="bm-tools">
            <div class="field bm-search">
              <label for="bm-q" class="visually-hidden">Rechercher un compte</label>
              <span class="bm-search-icon">${ICON.search}</span>
              <input id="bm-q" type="search" placeholder="Rechercher…" autocomplete="off">
            </div>
            <button type="button" class="btn btn-ghost btn-sm" id="bm-all">Tous</button>
            <button type="button" class="btn btn-ghost btn-sm" id="bm-none">Aucun</button>
          </div>
          <p class="small muted bm-count" id="bm-count" aria-live="polite"></p>
          <div class="bm-list" id="bm-list"></div>
        </fieldset>
        <form class="bm-compose stack" id="bm-form" novalidate>
          <label class="switch" id="bm-channel-wrap"><input type="checkbox" role="switch" id="bm-channel"><span class="switch-ui" aria-hidden="true"></span><span>Publier aussi dans le salon d'annonces <span class="muted small" id="bm-channel-hint"></span></span></label>
          <div class="field bm-mention-field" id="bm-mention-wrap">
            <label for="bm-mention">Mention dans le salon</label>
            <select id="bm-mention" name="mention" disabled aria-describedby="bm-mention-hint">
              ${MENTION_MODES.map(([v, t]) => `<option value="${v}">${esc(v === 'everyone' ? '@everyone (tout le serveur)' : t)}</option>`).join('')}
            </select>
            <p class="small muted" id="bm-mention-hint"></p>
          </div>
          <div class="field">
            <div class="bt-label-row"><label for="bm-title">Titre <span class="muted small">(facultatif)</span></label><span class="muted small bt-count" id="bm-title-count"></span></div>
            <input id="bm-title" maxlength="${MANUAL_TITLE_MAX}" autocomplete="off" placeholder="ex. Info importante">
          </div>
          <div class="field">
            <div class="bt-label-row"><label for="bm-text">Message</label><span class="muted small bt-count" id="bm-text-count"></span></div>
            <textarea id="bm-text" rows="6" maxlength="${MANUAL_BODY_MAX}" required aria-describedby="bm-text-hint" placeholder="Salut {pseudo} !"></textarea>
            <div class="bm-hint-row">
              <button type="button" class="chip bt-var" id="bm-var" aria-label="Insérer {pseudo} : pseudo du destinataire">${ICON.plus}<code>{pseudo}</code><span class="bt-var-label">Pseudo du destinataire</span></button>
              <p class="small muted" id="bm-text-hint">Dans le salon, <code>{pseudo}</code> devient « tout le monde ».</p>
            </div>
          </div>
          ${attachFieldHtml('bm-')}
          <div class="bt-preview">
            <div class="bt-preview-head"><span class="label">Aperçu</span><span class="muted small" id="bm-preview-for"></span></div>
            <div id="bm-preview" aria-live="polite"></div>
          </div>
          <div class="btn-row">
            <button type="submit" class="btn btn-primary" id="bm-send">${ICON.send}Envoyer</button>
          </div>
          <div id="bm-result" class="bm-result" aria-live="polite"></div>
        </form>
      </div>`;

    $('#bm-q', bmBody).addEventListener('input', (e) => { S.q = e.target.value; renderRecipients(); });
    // « Tous » ajoute les comptes visibles et joignables, dans la limite de MAX_RECIPIENTS.
    $('#bm-all', bmBody).addEventListener('click', () => {
      for (const p of visible().filter(reachable)) if (S.selected.size < MAX_RECIPIENTS) S.selected.add(p.id);
      if (visible().filter(reachable).some((p) => !S.selected.has(p.id))) toast(`${MAX_RECIPIENTS} destinataires maximum par envoi`, 'error');
      renderRecipients(); renderManualPreview();
    });
    $('#bm-none', bmBody).addEventListener('click', () => {
      for (const p of visible()) S.selected.delete(p.id);
      renderRecipients(); renderManualPreview();
    });
    $('#bm-list', bmBody).addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"]'); if (!cb) return;
      if (cb.checked) {
        if (S.selected.size >= MAX_RECIPIENTS) { cb.checked = false; toast(`${MAX_RECIPIENTS} destinataires maximum par envoi`, 'error'); return; }
        S.selected.add(cb.value);
      } else S.selected.delete(cb.value);
      renderCount(); renderManualPreview();
    });
    const title = $('#bm-title', bmBody), text = $('#bm-text', bmBody);
    let last = text;
    title.addEventListener('focus', () => { last = title; });
    text.addEventListener('focus', () => { last = text; });
    /** Met à jour les compteurs et l'aperçu à chaque frappe dans le message manuel. */
    const onInput = () => { renderManualCounts(); renderManualPreview(); };
    title.addEventListener('input', onInput);
    text.addEventListener('input', onInput);
    $('#bm-channel', bmBody).addEventListener('change', () => { syncManualMention(); renderManualPreview(); });
    $('#bm-mention', bmBody).addEventListener('change', renderManualPreview);
    // Pièces jointes du message manuel : liste, aperçu et téléversement (attachmentUI)
    mAtt = attachmentUI(bmBody, 'bm-', renderManualPreview);
    const varBtn = $('#bm-var', bmBody);
    varBtn.addEventListener('mousedown', (e) => e.preventDefault());
    // Insère {pseudo} à la position du curseur, dans le champ utilisé en dernier.
    varBtn.addEventListener('click', () => {
      if (last.value.length + 8 > last.maxLength) { toast('Texte trop long', 'error'); return; }
      last.setRangeText('{pseudo}', last.selectionStart ?? last.value.length, last.selectionEnd ?? last.value.length, 'end');
      last.focus(); onInput();
    });
    // Envoi : passe par sendManual (confirmation, téléversement des pièces jointes, résultat).
    $('#bm-form', bmBody).addEventListener('submit', (e) => { e.preventDefault(); sendManual(e.submitter); });
    syncChannelOption();
    renderRecipients(); renderManualCounts(); renderManualPreview();
  }

  /** Active la case « Publier aussi dans le salon » seulement si un salon d'annonces est configuré. */
  function syncChannelOption() {
    const cb = $('#bm-channel', bmBody); if (!cb) return;
    const has = !!S.bot.announce_channel_id;
    cb.disabled = !has;
    if (!has) cb.checked = false;
    $('#bm-channel-wrap', bmBody).classList.toggle('is-disabled', !has);
    $('#bm-channel-hint', bmBody).textContent = has ? '' : '(renseigne d\'abord l\'ID du salon dans les réglages)';
    syncManualMention();
  }

  /** Mention du message manuel : active seulement si on publie dans le salon. Le rôle n'est proposé que s'il est configuré. */
  function syncManualMention() {
    const sel = $('#bm-mention', bmBody); if (!sel) return;
    syncMentionSelect(sel, $('#bm-mention-hint', bmBody), !!$('#bm-channel', bmBody)?.checked, S.bot.mention_role_id);
  }


  /** Dessine la liste des comptes avec leur case, leur pastille d'état et leur mention « admin ». */
  function renderRecipients() {
    const list = $('#bm-list', bmBody);
    const rows = visible();
    list.innerHTML = rows.length ? rows.map((p) => {
      const [label, cls] = STATUS[p.status];
      const ok = reachable(p);
      return `<label class="bm-row${ok ? '' : ' is-off'}">
        <input type="checkbox" value="${esc(p.id)}" ${S.selected.has(p.id) ? 'checked' : ''} ${ok ? '' : 'disabled'} aria-describedby="bm-st-${esc(p.id)}">
        ${avatarHtml({ pseudo: p.name, avatar_url: p.avatar_url, color: p.color }, 32)}
        <span class="bm-name">${esc(p.name)}${p.is_admin ? ' <span class="muted small">(admin)</span>' : ''}</span>
        <span class="pill ${cls} bm-st" id="bm-st-${esc(p.id)}">${esc(label)}</span>
      </label>`;
    }).join('') : '<div class="empty">Aucun compte trouvé.</div>';
    renderCount();
  }
  /** Affiche le nombre de destinataires choisis, par rapport aux comptes joignables et non joignables. */
  function renderCount() {
    const n = S.selected.size, total = S.people.filter(reachable).length, off = S.people.length - total;
    $('#bm-count', bmBody).textContent = `${pluralCount(n, 'sélectionné', 'sélectionnés')} sur ${pluralCount(total, 'compte joignable', 'comptes joignables')}${off ? ` · ${pluralCount(off, 'compte non joignable', 'comptes non joignables')}` : ''}`;
  }
  /** Met à jour les compteurs de caractères du titre et du message manuel. */
  function renderManualCounts() {
    $('#bm-title-count', bmBody).textContent = `${$('#bm-title', bmBody).value.length} / ${MANUAL_TITLE_MAX}`;
    $('#bm-text-count', bmBody).textContent = `${$('#bm-text', bmBody).value.length} / ${MANUAL_BODY_MAX}`;
  }
  /**
   * Met à jour l'aperçu du message manuel. Le premier destinataire choisi sert d'exemple pour {pseudo} ;
   * sans destinataire, l'aperçu est celui du salon (« tout le monde »).
   */
  function renderManualPreview() {
    const firstId = [...S.selected][0];
    const who = firstId ? S.pseudo.get(firstId) ?? 'Alex' : null;
    const channel = $('#bm-channel', bmBody).checked;
    const pseudo = who ?? (channel ? 'tout le monde' : 'Alex');
    /** Remplace {pseudo} par le pseudo d'exemple de l'aperçu. */
    const sub = (s) => s.replace(/\{pseudo\}/g, pseudo);
    const title = truncate(sub($('#bm-title', bmBody).value).replace(/\s+/g, ' ').trim(), TITLE_MAX);
    const description = truncate(sub($('#bm-text', bmBody).value).trim(), BODY_MAX);
    // Mention : elle ne concerne que la publication dans le salon. L'aperçu d'un MP ne l'affiche pas (une note le précise).
    const mode = channel ? $('#bm-mention', bmBody).value : 'none';
    const salonMention = mode === 'everyone' ? '@everyone' : mode === 'role' ? '@rôle' : '';
    const mention = !who ? salonMention : '';
    const attached = mAtt?.files() ?? [], firstImage = attached.find((f) => f.url);
    const files = attached.map((f) => ({ name: f.file.name, size: f.file.size, inEmbed: f === firstImage }));
    $('#bm-preview-for', bmBody).textContent = who
      ? `pour ${who}${salonMention ? ` · dans le salon : ${salonMention} en tête du message` : ''}`
      : channel && !S.selected.size ? 'dans le salon' : 'avec un pseudo d\'exemple';
    $('#bm-preview', bmBody).innerHTML = discordPreview({
      where: who ? 'Message privé' : channel ? 'Salon d\'annonces' : 'Message privé', mention,
      embed: { color: '#9E3543', title, description, image: firstImage?.url ?? null }, files,
    });
  }

  /**
   * Envoie le message manuel : contrôles, confirmation si l'envoi est large ou mentionne @everyone, téléversement des
   * pièces jointes, appel de hg-notify (admin_dm), puis résultat et rafraîchissement de l'historique.
   * En cas d'échec, les fichiers déjà téléversés sont retirés du stockage.
   * @param {HTMLButtonElement|null} btn Bouton « Envoyer ».
   */
  async function sendManual(btn) {
    if (S.sending) return;
    const title = $('#bm-title', bmBody).value.trim(), body = $('#bm-text', bmBody).value.trim();
    const channel = $('#bm-channel', bmBody).checked;
    const mode = channel ? $('#bm-mention', bmBody).value : 'none';
    const ids = [...S.selected];
    if (!body) { toast('Écris un message', 'error'); $('#bm-text', bmBody).focus(); return; }
    if (body.length > MANUAL_BODY_MAX) { toast(`Message trop long (${MANUAL_BODY_MAX} caractères maximum)`, 'error'); return; }
    if (!ids.length && !channel) { toast('Choisis au moins un destinataire', 'error'); return; }
    if (mode === 'role' && !S.bot.mention_role_id) { toast('Aucun rôle configuré pour la mention', 'error'); return; }
    const files = mAtt.files();
    const fileTxt = files.length ? ` avec ${pluralCount(files.length, 'pièce jointe', 'pièces jointes')}` : '';
    const mentionTxt = mode === 'everyone' ? ' Mention @everyone : tout le serveur sera notifié.'
      : mode === 'role' ? ' Le rôle mentionné sera notifié.' : '';
    // Confirmation : grand envoi, pièces jointes ou mention @everyone (notifie tout le serveur)
    if (mode === 'everyone' || ids.length > CONFIRM_ABOVE || files.length) {
      const parts = [];
      if (ids.length) parts.push(`en privé à ${pluralCount(ids.length, 'personne', 'personnes')}`);
      if (channel) parts.push('publier dans le salon d\'annonces');
      const txt = `Le bot va ${parts.join(' et ')}${fileTxt}.${mentionTxt}${ids.length > CONFIRM_ABOVE ? ' L\'envoi prend quelques secondes par destinataire.' : ''}`;
      if (!(await confirmSend(txt))) return;
    }
    S.sending = true;
    const resBox = $('#bm-result', bmBody);
    const uploaded = [];
    resBox.innerHTML = `<div class="bm-sending" role="status">${files.length ? 'Téléversement des pièces jointes…' : `Envoi en cours (${pluralCount(ids.length, 'destinataire', 'destinataires')})…`}</div>`;
    await busy(btn, async () => {
      try {
        await mAtt.upload(uploaded);
        resBox.innerHTML = `<div class="bm-sending" role="status">Envoi en cours (${pluralCount(ids.length, 'destinataire', 'destinataires')})…</div>`;
        const res = await callFn('hg-notify', { event: 'admin_dm', user_ids: ids, title, body, channel, mention: mode, attachments: uploaded });
        if (res?.error) throw new Error(res.error);
        renderResult(res);
        const failed = (res?.failed ?? 0) + (res?.channel === false ? 1 : 0);
        toast(failed ? 'Envoi terminé avec des échecs' : 'Message envoyé', failed ? 'error' : 'ok');
        mAtt.clear();
        S.history = null;
        if ($('#bm-history', container).open) loadHistory();
      } catch (e) {
        // Échec : les fichiers déjà téléversés sont retirés du stockage (rien ne reste sans message)
        if (uploaded.length) sb.storage.from(MEDIA_BUCKET).remove(uploaded).catch(() => {});
        // Un seul signal d'erreur : le message reste affiché dans la zone de résultat (pas de toast en plus).
        resBox.innerHTML = `<div class="bm-error" role="alert">Échec de l'envoi : ${esc(await fnError(e))}</div>`;
      } finally { S.sending = false; }
    });
  }

  /**
   * Liste des résultats par destinataire : nom, état (envoyé, échec, ignoré) et raison éventuelle.
   * @param {object[]} list Résultats renvoyés par hg-notify ou stockés dans l'historique.
   * @returns {string}
   */
  function recipientsHtml(list) {
    return `<ul class="bm-res-list">${(list ?? []).map((r) => {
      const st = r.status ?? (r.ok ? 'sent' : 'failed');
      const [label, cls] = RESULT[st] ?? RESULT.failed;
      const name = r.pseudo ?? S.pseudo.get(r.user_id) ?? 'Compte inconnu';
      return `<li class="bm-res-row"><span class="bm-name">${esc(name)}</span><span class="pill ${cls}">${esc(label)}</span>${r.reason ? `<span class="small muted bm-reason">${esc(r.reason)}</span>` : ''}</li>`;
    }).join('')}</ul>`;
  }

  /**
   * Affiche le résultat d'un envoi : totaux, état de la publication dans le salon et détail par destinataire.
   * @param {object} res Réponse de hg-notify (sent, failed, skipped, channel, recipients).
   */
  function renderResult(res) {
    const parts = [];
    if (res.sent) parts.push(pluralCount(res.sent, 'envoyé', 'envoyés'));
    if (res.failed) parts.push(pluralCount(res.failed, 'échec', 'échecs'));
    if (res.skipped) parts.push(pluralCount(res.skipped, 'ignoré', 'ignorés'));
    const ch = res.channel === true ? '<span class="pill pill-ok">Publié dans le salon</span>'
      : res.channel === false ? `<span class="pill bm-pill-fail">Salon : échec</span>${res.channel_error ? ` <span class="small muted">${esc(res.channel_error)}</span>` : ''}` : '';
    $('#bm-result', bmBody).innerHTML = `
      <div class="bm-result-box">
        <div class="bm-result-head"><strong>Résultat</strong><span class="muted small">${esc(parts.join(' · ') || 'aucun MP')}</span>${ch}</div>
        ${(res.recipients ?? []).length ? recipientsHtml(res.recipients) : ''}
        ${res.log_error ? '<p class="small muted bm-log-warn">Envoyé, mais l\'historique n\'a pas pu être enregistré.</p>' : ''}
      </div>`;
  }

  /* ---------- Historique ---------- */
  // Panneau « Historique des envois » (repliable) : l'historique est chargé à la première ouverture.
  const histDetails = $('#bm-history', container);
  histDetails.addEventListener('toggle', () => { if (histDetails.open && !S.history) loadHistory(); });
  $('#bm-hist-filters', container).addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-hf]');
    if (!b) return;
    S.histFilter = b.dataset.hf;
    S.histLimit = PAGE_SIZE;
    $$('#bm-hist-filters .chip', container).forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    loadHistory();
  });
  // Recherche dans les envois chargés (texte, titre, auteur, type) ; « Afficher plus » charge le lot suivant
  $('#bm-history-list', container).insertAdjacentHTML('beforebegin', searchHtml({ id: 'bm-hist-search', label: 'Rechercher dans l\'historique', placeholder: 'Titre, texte, auteur…' }));
  bindSearch(container.querySelector('#bm-hist-search'), (q) => { S.histQ = q; renderHistory(); }, SEARCH_DELAY);
  $('#bm-history-list', container).addEventListener('click', (ev) => {
    if (!ev.target.closest('#bm-hist-more')) return;
    S.histLimit += PAGE_SIZE;
    loadHistory();
  });
  // Lignes d'échec : un envoi a un destinataire « failed » (ou ok:false, ancien format) dans recipients,
  // ou le passage automatique a signalé des échecs dans son texte. hg_bot_log n'a pas de colonne de statut.
  /**
   * Charge les envois de l'historique, les plus récents d'abord. Pour « échecs seulement », on interroge trois formes de lignes
   * (nouveau format, ancien format, passage automatique) puis on fusionne sans doublon.
   * @param {boolean} failedOnly Vrai pour ne garder que les envois avec un échec.
   * @returns {Promise<object[]>}
   */
  async function fetchHistory(failedOnly) {
    const n = S.histLimit;
    /** Requêtes de l'historique (colonnes données). Le filtre « salon en échec » n'existe que si la colonne channels est là. */
    const queries = (cols) => (failedOnly ? [
      sb.from('hg_bot_log').select(cols).contains('recipients', [{ status: 'failed' }]).order('created_at', { ascending: false }).limit(n),
      sb.from('hg_bot_log').select(cols).contains('recipients', [{ ok: false }]).order('created_at', { ascending: false }).limit(n),
      sb.from('hg_bot_log').select(cols).neq('kind', 'manual').ilike('body', '%échec%').order('created_at', { ascending: false }).limit(n),
      cols.includes('channels') ? sb.from('hg_bot_log').select(cols).contains('channels', [{ ok: false }]).order('created_at', { ascending: false }).limit(n) : null,
    ] : [sb.from('hg_bot_log').select(cols).order('created_at', { ascending: false }).limit(n)]).filter(Boolean);
    /** Exécute les requêtes ; une erreur fait remonter la première. */
    const runAll = async (cols) => (await Promise.all(queries(cols))).map((r) => { if (r.error) throw r.error; return r.data ?? []; });
    let lists;
    try {
      lists = await runAll('id, sent_by, kind, title, body, recipients, channel, channels, created_at');
    } catch (e) {
      // Colonne « channels » absente (migration 070 non appliquée en base) : on relance sans elle.
      if (!(e?.code === '42703' || e?.code === 'PGRST204' || /channels/i.test(e?.message ?? ''))) throw e;
      lists = await runAll('id, sent_by, kind, title, body, recipients, channel, created_at');
    }
    if (!failedOnly) return lists[0];
    const seen = new Map();
    for (const r of lists.flat()) seen.set(r.id, r);
    return [...seen.values()].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))).slice(0, n);
  }
  /** Charge l'historique selon le filtre et la limite en cours, puis l'affiche. En cas d'erreur, affiche le message. */
  async function loadHistory() {
    const box = $('#bm-history-list', container);
    box.setAttribute('aria-busy', 'true');
    try {
      const failedOnly = S.histFilter === 'failed';
      const rows = await fetchHistory(failedOnly);
      S.history = rows;
      S.histMore = rows.length >= S.histLimit; // le lot demandé est plein : il en reste peut-être
      box.setAttribute('aria-busy', 'false');
      renderHistory();
    } catch (e) {
      box.innerHTML = `<div class="empty">Impossible de charger l'historique : ${esc(errMsg(e))}</div>`;
    }
  }
  /**
   * Dessine l'historique filtré par la recherche : une ligne repliable par envoi, avec ses compteurs et ses destinataires.
   * Le bouton « Afficher plus » apparaît s'il reste des envois à charger.
   */
  function renderHistory() {
    const box = $('#bm-history-list', container);
    const failedOnly = S.histFilter === 'failed';
    const all = S.history ?? [];
    const rows = all.filter((r) => matches(S.histQ, r.title, r.body, S.pseudo.get(r.sent_by), r.kind));
    setCount($('#bm-hist-search-count', container), rows.length, all.length, S.histQ, ['envoi', 'envois']);
    const more = S.histMore ? '<div class="lt-more"><button class="btn btn-ghost btn-sm" type="button" id="bm-hist-more">Afficher plus</button></div>' : '';
    box.innerHTML = rows.length ? rows.map((r) => {
        const rec = Array.isArray(r.recipients) ? r.recipients : [];
        const sent = rec.filter((x) => (x.status ?? (x.ok ? 'sent' : 'failed')) === 'sent').length;
        const failed = rec.filter((x) => (x.status ?? (x.ok ? 'sent' : 'failed')) === 'failed').length;
        const skipped = rec.length - sent - failed;
        const head = r.title || String(r.body ?? '').replace(/\s+/g, ' ').slice(0, 80);
        // Résultat par salon (colonne channels) ; les anciens envois n'ont que le drapeau « channel ».
        const chans = Array.isArray(r.channels) && r.channels.length ? r.channels : null;
        const chBad = chans ? chans.filter((c) => !c.ok).length : 0;
        return `<details class="bm-log">
          <summary>
            <span class="bm-log-date">${esc(logFmt.format(new Date(r.created_at)))}</span>
            <span class="bm-log-title">${esc(head)}</span>
            <span class="bm-log-stats">
              <span class="pill pill-ok">${sent} envoyé${sent > 1 ? 's' : ''}</span>
              ${failed ? `<span class="pill bm-pill-fail">${failed} échec${failed > 1 ? 's' : ''}</span>` : ''}
              ${skipped ? `<span class="pill pill-todo">${skipped} ignoré${skipped > 1 ? 's' : ''}</span>` : ''}
              ${chans ? (chBad ? `<span class="pill bm-pill-fail">${pluralCount(chBad, 'salon en échec', 'salons en échec')}</span>` : `<span class="pill pill-current">${pluralCount(chans.length, 'salon', 'salons')}</span>`) : (r.channel ? '<span class="pill pill-current">Salon</span>' : '')}
            </span>
          </summary>
          <div class="bm-log-body stack">
            <p class="small muted">Par ${esc(S.pseudo.get(r.sent_by) ?? 'un admin')}${r.kind && r.kind !== 'manual' ? ` · ${esc(kindLabel(r.kind))}` : ''}${r.channel ? ' · publié dans le salon d\'annonces' : ''}</p>
            ${r.title ? `<p class="bm-log-t">${esc(r.title)}</p>` : ''}
            <p class="bm-log-text">${esc(r.body ?? '')}</p>
            ${chans ? `<ul class="bm-res-list">${chans.map((c) => `<li class="bm-res-row"><span class="bm-name">${esc(salonName(c.id))}${c.ref ? ` <span class="small muted">· ${esc(c.ref)}</span>` : ''}</span>${c.ok
    ? '<span class="pill pill-ok">✓ Publiée</span>'
    : `<span class="pill bm-pill-fail">✗ Échec</span>${c.error ? `<span class="small muted bm-reason">${esc(c.error)}</span>` : ''}`}</li>`).join('')}</ul>` : ''}
            ${rec.length ? recipientsHtml(rec) : (chans ? '' : '<p class="small muted">Aucun MP (salon uniquement).</p>')}
          </div>
        </details>`;
      }).join('') + more : emptyHtml(S.histQ, failedOnly ? 'Aucun échec enregistré.' : 'Aucun message envoyé pour l\'instant.');
  }


  Object.assign(api, { syncChannelOption, loadHistory, renderManualShell });
}
