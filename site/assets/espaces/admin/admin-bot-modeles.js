// ===== Humane Gang — administration : bot Discord, onglet « Messages types » (admin-bot.js) =====
// Modèles de messages automatiques : édition dans un tiroir, aperçu façon Discord, enregistrement groupé. Les textes par défaut viennent de bot-templates.json (copié à côté de admin-bot.js à la publication).
// Exporte : montageModeles(c). Contexte c : voir admin-bot.js.

import { sb, toast, errMsg, esc, $, $$ } from '../../commun/core.js';
import { pluralCount } from '../../commun/utils.js';
import { openDrawer } from './ui/drawer.js';
import { BODY_MAX, ICON, TITLE_MAX, check, discordPreview, fillVars, filled, truncate, unknownVars } from './admin-bot-commun.js';

export function montageModeles(c) {
  const { S, api, container } = c;
  /* ======================= Messages types ======================= */
  // Zone de la liste des messages types.
  const tplBody = $('#bt-body', container);
  let edRoot = null; // corps du tiroir d'édition (ouvert à la demande)
  // Accès aux définitions des modèles : clés, méta-données (libellé, variables, groupe) et texte par défaut.
  const keys = () => Object.keys(S.defs.templates);
  /** Méta-données d'un modèle (libellé, cible, variables). Objet vide si le modèle n'en a pas. */
  const meta = (k) => S.defs.meta[k] ?? { vars: {} };
  /** Texte par défaut d'un modèle, tel que fourni par bot-templates.json. */
  const def = (k) => S.defs.templates[k];
  /** Modèle enregistré (personnalisé champ par champ, sinon défaut). */
  const saved = (k) => {
    const c = S.custom[k] ?? {};
    return { title: filled(c.title) ? c.title : def(k).title, body: filled(c.body) ? c.body : def(k).body };
  };
  // Texte en cours d'un modèle : le brouillon s'il existe, sinon le texte enregistré.
  const current = (k) => S.drafts.get(k) ?? saved(k);
  // Vrai si les deux textes (titre et corps) sont identiques.
  const same = (a, b) => a.title === b.title && a.body === b.body;
  // Vrai si le modèle enregistré diffère du texte par défaut (personnalisé).
  const isCustom = (k) => !same(saved(k), def(k));
  // Vrai si un brouillon existe et diffère de ce qui est enregistré (modification non enregistrée).
  const isDirty = (k) => S.drafts.has(k) && !same(S.drafts.get(k), saved(k));
  // Clés des modèles ayant une modification non enregistrée.
  const dirtyKeys = () => keys().filter(isDirty);
  // Variables autorisées pour un modèle.
  const allowedOf = (k) => new Set(Object.keys(meta(k).vars ?? {}));
  // Valeurs d'exemple des variables, pour l'aperçu.
  const examplesOf = (k) => Object.fromEntries(Object.entries(meta(k).vars ?? {}).map(([n, v]) => [n, v.example ?? '']));

  // Groupes de modèles repliés par défaut (la liste reste courte) ; le premier groupe reste ouvert.
  const TPL_REPLIES = new Set(['cards', 'jeux', 'test']);

  /** Dessine la liste des messages types, groupée par destination, avec son bouton « Enregistrer ». */
  function renderTemplatesShell() {
    const groups = S.defs.groups ?? [];
    tplBody.innerHTML = `
      <div class="bt-listbar">
        <span class="muted small bt-status" id="bt-status" aria-live="polite"></span>
        <button type="button" class="btn btn-primary btn-sm" id="bt-save" disabled>Enregistrer</button>
      </div>
      <div class="bt-list" role="list" aria-label="Modèles de messages">
        ${groups.map((g) => {
          const items = keys().filter((k) => meta(k).group === g.id);
          if (!items.length) return '';
          return `<div class="bt-group" role="group" aria-labelledby="bt-g-${esc(g.id)}">
            ${TPL_REPLIES.has(g.id) ? `<details class="bt-fold"><summary class="bt-group-label" id="bt-g-${esc(g.id)}">${esc(g.label)} (${items.length})</summary>` : `<div class="bt-group-label" id="bt-g-${esc(g.id)}">${esc(g.label)}</div>`}
            ${items.map((k) => `<div role="listitem"><button type="button" class="bt-item" data-key="${esc(k)}" aria-label="Modifier « ${esc(meta(k).label ?? k)} »">
                <span class="bt-item-main"><span class="bt-item-label">${esc(meta(k).label ?? k)}</span>
                <span class="bt-item-sub">${esc(meta(k).target ?? '')}</span></span>
                <span class="bt-item-state" data-state="${esc(k)}"></span>
                <span class="bt-item-go" aria-hidden="true">Modifier</span>
              </button></div>`).join('')}
            ${TPL_REPLIES.has(g.id) ? '</details>' : ''}
          </div>`;
        }).join('')}
      </div>`;
    $$('.bt-item', tplBody).forEach((b) => b.addEventListener('click', () => selectTemplate(b.dataset.key)));
    $('#bt-save', tplBody).addEventListener('click', (e) => saveTemplates(e.currentTarget));
    refreshListStates();
  }

  /** Met à jour l'état de chaque modèle dans la liste (non enregistré, personnalisé), le bouton Enregistrer et le compteur. */
  function refreshListStates() {
    for (const k of keys()) {
      const el = $(`[data-state="${k}"]`, tplBody);
      if (!el) continue;
      const dirty = isDirty(k), custom = isCustom(k);
      el.textContent = dirty ? 'Non enregistré' : custom ? 'Personnalisé' : '';
      el.className = `bt-item-state${dirty ? ' is-dirty' : custom ? ' is-custom' : ''}`;
    }
    $$('.bt-item', tplBody).forEach((b) => {
      if (b.dataset.key === S.current) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    const n = dirtyKeys().length;
    const save = $('#bt-save', tplBody);
    if (save) {
      save.disabled = n === 0;
      save.textContent = n > 1 ? `Enregistrer (${n} modèles)` : 'Enregistrer';
    }
    const st = $('#bt-status', tplBody);
    if (st) st.textContent = n ? `${pluralCount(n, 'modification non enregistrée', 'modifications non enregistrées')}` : '';
  }

  /** Ouvre le modèle k dans le tiroir large (édition, aperçu, rétablir). L'enregistrement passe par le pied du tiroir. */
  function selectTemplate(k) {
    S.current = k;
    S.lastField = 'body';
    const m = meta(k), t = current(k), d = def(k);
    const vars = Object.entries(m.vars ?? {});
    const body = document.createElement('div');
    body.className = 'bt-editor stack';
    body.innerHTML = `
      <div class="bt-ed-head">
        <div>
          <h4 class="bt-ed-title">${esc(m.label ?? k)}</h4>
          <p class="muted small bt-ed-desc">${esc(m.description ?? '')}</p>
        </div>
        <span class="pill pill-todo bt-target">${esc(m.target ?? '')}</span>
      </div>
      <div class="field">
        <div class="bt-label-row"><label for="bt-title">Titre</label><span class="muted small bt-count" id="bt-title-count"></span></div>
        <input id="bt-title" maxlength="${TITLE_MAX}" autocomplete="off" placeholder="${esc(d.title)}">
      </div>
      <div class="field">
        <div class="bt-label-row"><label for="bt-text">Texte</label><span class="muted small bt-count" id="bt-text-count"></span></div>
        <textarea id="bt-text" rows="6" maxlength="${BODY_MAX}" placeholder="${esc(d.body)}"></textarea>
        <p class="small muted bt-hint">Vide = texte par défaut. Mise en forme Discord possible : <code>**gras**</code>, <code>*italique*</code>, <code>[lien](https://…)</code>.</p>
      </div>
      <div class="bt-vars" role="group" aria-labelledby="bt-vars-l">
        <div class="label" id="bt-vars-l">Variables disponibles <span class="small">(clic = insérer à l'endroit du curseur)</span></div>
        <div class="bt-chips">
          ${vars.map(([n, v]) => `<button type="button" class="chip bt-var" data-var="${esc(n)}" title="${esc(v.label)} — ex. ${esc(v.example)}" aria-label="Insérer {${esc(n)}} : ${esc(v.label)}">${ICON.plus}<code>{${esc(n)}}</code><span class="bt-var-label">${esc(v.label)}</span></button>`).join('')}
        </div>
      </div>
      <p class="bt-warn small" id="bt-warn" role="status" hidden></p>
      ${k === 'message_new_santa' ? '<p class="small bt-note">Par sécurité, aucune variable ne permet d\'afficher le Santa dans ce message.</p>' : ''}
      <div class="btn-row bt-actions">
        <button type="button" class="btn btn-ghost" id="bt-reset">${ICON.undo}Rétablir le texte par défaut</button>
      </div>
      <div class="bt-preview">
        <div class="bt-preview-head"><span class="label">Aperçu</span><span class="muted small">avec des valeurs d'exemple</span></div>
        <div id="bt-preview" aria-live="polite"></div>
      </div>`;
    edRoot = body;
    openDrawer({
      title: m.label ?? k, subtitle: m.target ? `Destination : ${m.target}` : '', body, wide: true,
      submitLabel: 'Enregistrer', onSubmit: () => saveTemplates(null, [k]),
    });
    const title = $('#bt-title', edRoot), text = $('#bt-text', edRoot);
    title.value = t.title; text.value = t.body;
    /** Enregistre le brouillon à chaque frappe, puis met à jour les compteurs, l'aperçu et les états de la liste. */
    const onInput = () => {
      S.drafts.set(k, { title: title.value, body: text.value });
      updateEditorMeta(); renderTplPreview(); refreshListStates();
    };
    title.addEventListener('input', onInput);
    text.addEventListener('input', onInput);
    title.addEventListener('focus', () => { S.lastField = 'title'; });
    text.addEventListener('focus', () => { S.lastField = 'body'; });
    $$('.bt-var', edRoot).forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault())); // garde le curseur
    $$('.bt-var', edRoot).forEach((b) => b.addEventListener('click', () => {
      const el = S.lastField === 'title' ? title : text;
      const token = `{${b.dataset.var}}`;
      if (el.value.length + token.length > el.maxLength) { toast('Texte trop long', 'error'); return; }
      const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
      el.setRangeText(token, start, end, 'end');
      el.focus();
      onInput();
    }));
    $('#bt-reset', edRoot).addEventListener('click', () => {
      title.value = d.title; text.value = d.body;
      onInput();
      toast(isDirty(k) ? 'Texte par défaut rétabli : pense à enregistrer' : 'C\'est déjà le texte par défaut', 'ok');
    });
    updateEditorMeta(); renderTplPreview(); refreshListStates();
  }

  /** Met à jour le compteur de caractères, l'avertissement des variables inconnues et l'état du bouton « Rétablir ». */
  function updateEditorMeta() {
    const k = S.current; if (!k) return;
    const t = current(k), allowed = allowedOf(k);
    $('#bt-title-count', edRoot).textContent = `${t.title.length} / ${TITLE_MAX}`;
    $('#bt-text-count', edRoot).textContent = `${t.body.length} / ${BODY_MAX}`;
    const unknown = unknownVars(`${t.title} ${t.body}`, allowed);
    const warn = $('#bt-warn', edRoot);
    warn.hidden = !unknown.length;
    warn.textContent = unknown.length ? `${unknown.length > 1 ? 'Variables inconnues' : 'Variable inconnue'} pour ce message : ${unknown.map((v) => `{${v}}`).join(', ')} (${unknown.length > 1 ? 'seront laissées' : 'sera laissée'} vide${unknown.length > 1 ? 's' : ''}).` : '';
    $('#bt-reset', edRoot).disabled = same(t, def(k));
  }

  /** Met à jour l'aperçu Discord du modèle en cours, rempli avec des valeurs d'exemple. */
  function renderTplPreview() {
    const k = S.current; if (!k) return;
    const m = meta(k), t = current(k), allowed = allowedOf(k), ex = examplesOf(k);
    const eff = { title: filled(t.title) ? t.title : def(k).title, body: filled(t.body) ? t.body : def(k).body };
    const title = truncate(fillVars(eff.title, ex, allowed).replace(/\s+/g, ' ').trim(), TITLE_MAX);
    const description = truncate(fillVars(eff.body, ex, allowed).trim(), BODY_MAX);
    $('#bt-preview', edRoot).innerHTML = discordPreview({
      where: m.target,
      content: m.content ? fillVars(m.content, ex, allowed) : '',
      embed: {
        color: m.color, title, description, url: ex.lien,
        fields: (m.fields ?? []).map(([n, v]) => [n, fillVars(v, ex, allowed)]),
        footer: m.footer,
      },
    });
  }

  /** Enregistre les modèles modifiés (tous, ou la liste `only`). Renvoie false en cas d'échec : le tiroir reste ouvert. */
  async function saveTemplates(btn, only = null) {
    const pending = only ?? dirtyKeys();
    if (!pending.length) return true;
    if (btn) btn.disabled = true;
    try {
      // Relit la valeur en base pour ne pas écraser une modification faite ailleurs entre-temps.
      const row = check(await sb.from('hg_settings').select('value').eq('key', 'bot_templates').maybeSingle());
      const base = row?.value && typeof row.value === 'object' && !Array.isArray(row.value) ? { ...row.value } : {};
      for (const k of pending) {
        const t = S.drafts.get(k) ?? saved(k), d = def(k);
        const title = t.title.trim() === d.title ? '' : t.title.trim();
        const body = t.body.trim() === d.body ? '' : t.body.replace(/\s+$/, '');
        if (!title && !body) delete base[k]; else base[k] = { title, body };
      }
      check(await sb.from('hg_settings').upsert({ key: 'bot_templates', value: base, updated_at: new Date().toISOString() }));
      S.custom = base;
      for (const k of pending) S.drafts.delete(k);
      refreshListStates(); if (edRoot?.isConnected) updateEditorMeta();
      toast(pending.length > 1 ? `${pending.length} modèles enregistrés` : 'Modèle enregistré', 'ok');
      return true;
    } catch (e) {
      toast(errMsg(e), 'error');
      return false;
    } finally {
      if (btn?.isConnected) btn.disabled = false;
    }
  }

  // Avertit avant de quitter la page s'il reste des modèles non enregistrés.
  window.addEventListener('beforeunload', (e) => {
    if (S.defs && dirtyKeys().length) { e.preventDefault(); e.returnValue = ''; }
  });


  Object.assign(api, { renderTemplatesShell });
}
