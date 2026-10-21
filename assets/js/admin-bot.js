// ===== Humane Gang — administration : bot Discord =====
// Trois blocs : réglages (hg_settings.bot), messages types (hg_settings.bot_templates, défauts partagés avec les
// fonctions edge dans supabase/functions/_shared/bot-templates.json) et message manuel (hg-notify « admin_dm »,
// historique hg_bot_log).
import { sb, toast, errMsg, esc, $, $$, callFn, avatarHtml, currentLogo } from './core.js';
import { svg } from './icons.js';
import { pluralCount } from './utils.js';
import { matches, searchHtml, bindSearch, setCount, emptyHtml, PAGE_SIZE, SEARCH_DELAY } from './admin/list-tools.js';

const TEMPLATES_URL = new URL('../../supabase/functions/_shared/bot-templates.json', import.meta.url).href;
const NOTIFY = [
  ['draw', 'Tirage du Secret Santa', 'annonce + MP aux participants'],
  ['gift', 'Cadeaux', 'MP « envoyé » / « reçu »'],
  ['irl', 'Nouvelles sorties IRL', 'annonce dans le salon'],
  ['birthday', 'Anniversaires', 'chaque matin : MP + annonce si partagé'],
  ['support', 'Demandes d\'assistance', 'MP à toi'],
  ['messages', 'Nouveaux messages', 'MP au destinataire (pas à chaque message d\'une discussion en cours)'],
  ['card_pull', 'Belle carte obtenue', 'annonce dans le salon : carte légendaire, mythique ou identité'],
  ['card_trade', 'Échange conclu', 'annonce dans le salon (désactivée par défaut)'],
];
const NOTIFY_KEYS = NOTIFY.map(([k]) => k);
const DISCORD_ID = /^\d{17,20}$/;
const TITLE_MAX = 256, BODY_MAX = 4096, MANUAL_TITLE_MAX = 200, MANUAL_BODY_MAX = 2000, CONFIRM_ABOVE = 5;
const MAX_RECIPIENTS = 100;
const ICON = {
  search: svg('search2', { stroke: 2 }),
  send: svg('send', { stroke: 2 }),
  undo: svg('undo', { stroke: 2 }),
  plus: svg('plus', { stroke: 2 }),
};
const STATUS = {
  ok: ['Discord OK', 'pill-ok'],
  nodiscord: ['Pas d\'ID Discord', 'pill-warn'],
  optout: ['A refusé les MP du bot', 'pill-warn'],
  noprofile: ['Compte sans profil', 'pill-todo'],
};
const RESULT = { sent: ['Envoyé', 'pill-ok'], failed: ['Échec', 'bm-pill-fail'], skipped: ['Ignoré', 'pill-todo'] };

function check(res) { if (res.error) throw res.error; return res.data; }
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const timeFmt = new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit' });
const logFmt = new Intl.DateTimeFormat('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const filled = (v) => typeof v === 'string' && v.trim() !== '';

function loadStyles() {
  if (document.querySelector('link[data-admin-bot]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('../css/admin-bot.css', import.meta.url).href; l.dataset.adminBot = '';
  document.head.append(l);
}

/** Message d'erreur lisible, y compris le JSON { error } renvoyé par une fonction edge. */
async function fnError(e) {
  try {
    const ctx = e?.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
    }
  } catch { /* corps illisible */ }
  return errMsg(e);
}

/* ---------- Rendu des modèles (même logique que supabase/functions/_shared/templates.ts) ---------- */
function fillVars(text, vars, allowed) {
  return String(text ?? '').replace(/\{([a-z_]+)\}/g, (_m, name) => (allowed && !allowed.has(name) ? '' : String(vars[name] ?? '')));
}
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const unknownVars = (text, allowed) => [...new Set([...String(text ?? '').matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((v) => !allowed.has(v)))];

/** Mini-markdown Discord pour l'aperçu (gras, italique, souligné, barré, code, liens). Le texte est échappé d'abord. */
function discordMd(text) {
  let h = esc(text);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)/g, (_m, label, url, bare) => `<span class="dc-link">${label ?? bare}</span>`);
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/__([^_\n]+)__/g, '<u>$1</u>');
  h = h.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  h = h.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return h;
}

/** Aperçu façon Discord. `embed` : { color, title, description, fields: [[nom, valeur]], footer }, `content` facultatif. */
function discordPreview({ content = '', embed, where = '' }) {
  const now = timeFmt.format(new Date());
  const fields = (embed.fields ?? []).filter(([, v]) => filled(v));
  return `
    <div class="dc" role="img" aria-label="Aperçu du message Discord">
      ${where ? `<div class="dc-where">${esc(where)}</div>` : ''}
      <div class="dc-msg">
        <img class="dc-avatar" src="${esc(currentLogo())}" alt="">
        <div class="dc-main">
          <div class="dc-head"><span class="dc-name">Humane Gang</span><span class="dc-app">APP</span><span class="dc-time">Aujourd'hui à ${now}</span></div>
          ${content ? `<div class="dc-content">${discordMd(content)}</div>` : ''}
          <div class="dc-embed" style="--dc-bar:${esc(embed.color || '#9E3543')}">
            ${embed.title ? `<div class="dc-title${embed.url ? ' dc-title-link' : ''}">${discordMd(embed.title)}</div>` : ''}
            ${embed.description ? `<div class="dc-desc">${discordMd(embed.description)}</div>` : ''}
            ${!embed.title && !embed.description ? '<div class="dc-desc dc-empty">(message vide)</div>' : ''}
            ${fields.length ? `<div class="dc-fields">${fields.map(([n, v]) => `<div class="dc-field"><div class="dc-fname">${esc(n)}</div><div class="dc-fval">${discordMd(v)}</div></div>`).join('')}</div>` : ''}
            <div class="dc-footer">${esc(embed.footer || 'Humane Gang')} • Aujourd'hui à ${now}</div>
          </div>
        </div>
      </div>
    </div>`;
}

/* ========================================================================== */
export function mountBotSection(container) {
  if (!container) return;
  loadStyles();
  const S = {
    bot: { announce_channel_id: null, admin_discord_id: null, notify: {} },
    histFilter: 'all', histQ: '', histLimit: PAGE_SIZE, histMore: false,
    defs: null, custom: {}, drafts: new Map(), current: null, lastField: 'body',
    people: [], pseudo: new Map(), selected: new Set(), q: '', history: null, sending: false,
  };

  container.innerHTML = `
    <div class="bot-admin">
      <form class="card stack" id="bot-form" novalidate>
        <h3 class="card-title">Réglages</h3>
        <p class="muted small">Le jeton du bot n'est jamais stocké ici : il se règle dans les secrets Supabase. Toute la marche à suivre est dans le <a href="BOT.md" target="_blank" rel="noopener">guide du bot</a>.</p>
        <div class="grid-2">
          <div class="field">
            <label for="bot-channel">ID du salon d'annonces</label>
            <input id="bot-channel" name="announce_channel_id" inputmode="numeric" autocomplete="off" placeholder="ex. 112233445566778899">
          </div>
          <div class="field">
            <label for="bot-admin">Ton ID Discord (MP assistance)</label>
            <input id="bot-admin" name="admin_discord_id" inputmode="numeric" autocomplete="off" placeholder="ex. 998877665544332211">
          </div>
        </div>
        <fieldset class="toggles">
          <legend class="label">Notifications envoyées</legend>
          ${NOTIFY.map(([k, label, hint]) => `<label class="switch"><input type="checkbox" role="switch" name="${k}"><span class="switch-ui" aria-hidden="true"></span><span>${esc(label)} <span class="muted small">${esc(hint)}</span></span></label>`).join('')}
        </fieldset>
        <div class="btn-row">
          <button class="btn btn-primary" type="submit">Enregistrer</button>
          <button class="btn btn-ghost" type="button" id="bot-test">Envoyer un message de test</button>
        </div>
      </form>

      <div class="card stack bt-card" id="bt-card">
        <div>
          <h3 class="card-title">Messages types</h3>
          <p class="muted small bt-intro">Personnalise le texte de chaque message automatique. Les <strong>variables</strong> entre accolades (ex. <code>{pseudo}</code>) sont remplacées à l'envoi ; une variable non prévue pour ce message reste vide. Les champs fixes (budget, lieu…) ne sont pas modifiables.</p>
        </div>
        <div id="bt-body"><div class="empty">Chargement des modèles…</div></div>
      </div>

      <div class="card stack bm-card" id="bm-card">
        <div>
          <h3 class="card-title">Envoyer un message</h3>
          <p class="muted small">Message privé du bot aux comptes choisis. Les membres qui ont refusé les MP du bot ou sans ID Discord ne peuvent pas être sélectionnés.</p>
        </div>
        <div id="bm-body"><div class="empty">Chargement des comptes…</div></div>
        <details class="bm-history" id="bm-history">
          <summary>Historique des envois</summary>
          <div class="filters bm-hist-filters" role="group" aria-label="Filtrer l'historique" id="bm-hist-filters">
            <button class="chip" type="button" data-hf="all" aria-pressed="true">Toutes</button>
            <button class="chip" type="button" data-hf="failed" aria-pressed="false">Échecs</button>
          </div>
          <div id="bm-history-list" class="bm-history-list"><div class="empty">Chargement…</div></div>
          <p class="small muted">Les échecs sur le salon d'annonces ne sont pas enregistrés dans l'historique : ils n'apparaissent que dans le résultat de l'envoi, sur le moment.</p>
        </details>
      </div>
    </div>
    <dialog class="hg-dialog" id="bm-dlg" aria-labelledby="bm-dlg-t">
      <form method="dialog" class="stack">
        <h2 id="bm-dlg-t" class="dialog-title">Envoyer ce message ?</h2>
        <p id="bm-dlg-p" class="muted"></p>
        <div class="btn-row dialog-actions">
          <button class="btn btn-ghost" value="cancel" type="submit">Annuler</button>
          <button class="btn btn-primary" value="ok" type="submit">Envoyer</button>
        </div>
      </form>
    </dialog>`;

  const form = $('#bot-form', container);
  const dlg = $('#bm-dlg', container);

  /** Action en cours : bouton désactivé avec indicateur, pas de second envoi. */
  async function busy(btn, fn) {
    if (btn?.dataset.busy) return undefined;
    if (btn) { btn.disabled = true; btn.dataset.busy = '1'; btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true'); }
    try { return await fn(); } catch (e) { toast(await fnError(e), 'error'); return undefined; } finally {
      if (btn) { delete btn.dataset.busy; btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); if (btn.isConnected) btn.disabled = false; }
    }
  }
  function confirmSend(text) {
    $('#bm-dlg-p', container).textContent = text;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
  }

  /* ======================= Réglages ======================= */
  function renderSettings() {
    form.announce_channel_id.value = S.bot.announce_channel_id ?? '';
    form.admin_discord_id.value = S.bot.admin_discord_id ?? '';
    for (const k of NOTIFY_KEYS) form.elements[k].checked = S.bot.notify[k] !== false;
  }
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(ev.submitter, async () => {
      const channel = form.announce_channel_id.value.trim(), admin = form.admin_discord_id.value.trim();
      if (channel && !DISCORD_ID.test(channel)) throw new Error('L\'ID du salon doit être un nombre de 17 à 20 chiffres.');
      if (admin && !DISCORD_ID.test(admin)) throw new Error('Ton ID Discord doit être un nombre de 17 à 20 chiffres.');
      const value = {
        ...S.bot, announce_channel_id: channel || null, admin_discord_id: admin || null,
        notify: Object.fromEntries(NOTIFY_KEYS.map((k) => [k, form.elements[k].checked])),
      };
      check(await sb.from('hg_settings').upsert({ key: 'bot', value, updated_at: new Date().toISOString() }));
      S.bot = value;
      syncChannelOption();
      toast('Réglages du bot enregistrés', 'ok');
    });
  });
  $('#bot-test', container).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    const res = await callFn('hg-notify', { event: 'bot_test' });
    const parts = [];
    if (res?.channel !== undefined) parts.push(`salon : ${res.channel ? 'OK' : 'échec'}`);
    if (res?.dm !== undefined) parts.push(`MP : ${res.dm ? 'OK' : 'échec'}`);
    if (res?.error) throw new Error(res.error);
    toast(parts.length ? `Test envoyé (${parts.join(', ')})` : 'Test envoyé', res?.channel === false || res?.dm === false ? 'error' : 'ok');
  }));

  /* ======================= Messages types ======================= */
  const tplBody = $('#bt-body', container);
  const keys = () => Object.keys(S.defs.templates);
  const meta = (k) => S.defs.meta[k] ?? { vars: {} };
  const def = (k) => S.defs.templates[k];
  /** Modèle enregistré (personnalisé champ par champ, sinon défaut). */
  const saved = (k) => {
    const c = S.custom[k] ?? {};
    return { title: filled(c.title) ? c.title : def(k).title, body: filled(c.body) ? c.body : def(k).body };
  };
  const current = (k) => S.drafts.get(k) ?? saved(k);
  const same = (a, b) => a.title === b.title && a.body === b.body;
  const isCustom = (k) => !same(saved(k), def(k));
  const isDirty = (k) => S.drafts.has(k) && !same(S.drafts.get(k), saved(k));
  const dirtyKeys = () => keys().filter(isDirty);
  const allowedOf = (k) => new Set(Object.keys(meta(k).vars ?? {}));
  const examplesOf = (k) => Object.fromEntries(Object.entries(meta(k).vars ?? {}).map(([n, v]) => [n, v.example ?? '']));

  function renderTemplatesShell() {
    const groups = S.defs.groups ?? [];
    tplBody.innerHTML = `
      <div class="bt-layout">
        <nav class="bt-list" aria-label="Modèles de messages">
          ${groups.map((g) => {
            const items = keys().filter((k) => meta(k).group === g.id);
            if (!items.length) return '';
            return `<div class="bt-group" role="group" aria-labelledby="bt-g-${esc(g.id)}">
              <div class="bt-group-label" id="bt-g-${esc(g.id)}">${esc(g.label)}</div>
              ${items.map((k) => `<button type="button" class="bt-item" data-key="${esc(k)}">
                  <span class="bt-item-label">${esc(meta(k).label ?? k)}</span>
                  <span class="bt-item-sub">${esc(meta(k).target ?? '')}</span>
                  <span class="bt-item-state" data-state="${esc(k)}"></span>
                </button>`).join('')}
            </div>`;
          }).join('')}
        </nav>
        <div class="bt-main">
          <div class="bt-editor stack" id="bt-editor"></div>
          <div class="bt-preview">
            <div class="bt-preview-head"><span class="label">Aperçu</span><span class="muted small">avec des valeurs d'exemple</span></div>
            <div id="bt-preview" aria-live="polite"></div>
          </div>
        </div>
      </div>`;
    $$('.bt-item', tplBody).forEach((b) => b.addEventListener('click', () => selectTemplate(b.dataset.key)));
    refreshListStates();
  }

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

  function selectTemplate(k) {
    S.current = k;
    S.lastField = 'body';
    const m = meta(k), t = current(k), d = def(k);
    const vars = Object.entries(m.vars ?? {});
    $('#bt-editor', tplBody).innerHTML = `
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
        <button type="button" class="btn btn-primary" id="bt-save">Enregistrer</button>
        <button type="button" class="btn btn-ghost" id="bt-reset">${ICON.undo}Rétablir le texte par défaut</button>
        <span class="muted small bt-status" id="bt-status" aria-live="polite"></span>
      </div>`;
    const title = $('#bt-title', tplBody), text = $('#bt-text', tplBody);
    title.value = t.title; text.value = t.body;
    const onInput = () => {
      S.drafts.set(k, { title: title.value, body: text.value });
      updateEditorMeta(); renderTplPreview(); refreshListStates();
    };
    title.addEventListener('input', onInput);
    text.addEventListener('input', onInput);
    title.addEventListener('focus', () => { S.lastField = 'title'; });
    text.addEventListener('focus', () => { S.lastField = 'body'; });
    $$('.bt-var', tplBody).forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault())); // garde le curseur
    $$('.bt-var', tplBody).forEach((b) => b.addEventListener('click', () => {
      const el = S.lastField === 'title' ? title : text;
      const token = `{${b.dataset.var}}`;
      if (el.value.length + token.length > el.maxLength) { toast('Texte trop long', 'error'); return; }
      const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
      el.setRangeText(token, start, end, 'end');
      el.focus();
      onInput();
    }));
    $('#bt-save', tplBody).addEventListener('click', (e) => saveTemplates(e.currentTarget));
    $('#bt-reset', tplBody).addEventListener('click', () => {
      title.value = d.title; text.value = d.body;
      onInput();
      toast(isDirty(k) ? 'Texte par défaut rétabli : pense à enregistrer' : 'C\'est déjà le texte par défaut', 'ok');
    });
    updateEditorMeta(); renderTplPreview(); refreshListStates();
  }

  function updateEditorMeta() {
    const k = S.current; if (!k) return;
    const t = current(k), allowed = allowedOf(k);
    $('#bt-title-count', tplBody).textContent = `${t.title.length} / ${TITLE_MAX}`;
    $('#bt-text-count', tplBody).textContent = `${t.body.length} / ${BODY_MAX}`;
    const unknown = unknownVars(`${t.title} ${t.body}`, allowed);
    const warn = $('#bt-warn', tplBody);
    warn.hidden = !unknown.length;
    warn.textContent = unknown.length ? `${unknown.length > 1 ? 'Variables inconnues' : 'Variable inconnue'} pour ce message : ${unknown.map((v) => `{${v}}`).join(', ')} (${unknown.length > 1 ? 'seront laissées' : 'sera laissée'} vide${unknown.length > 1 ? 's' : ''}).` : '';
    $('#bt-reset', tplBody).disabled = same(t, def(k));
  }

  function renderTplPreview() {
    const k = S.current; if (!k) return;
    const m = meta(k), t = current(k), allowed = allowedOf(k), ex = examplesOf(k);
    const eff = { title: filled(t.title) ? t.title : def(k).title, body: filled(t.body) ? t.body : def(k).body };
    const title = truncate(fillVars(eff.title, ex, allowed).replace(/\s+/g, ' ').trim(), TITLE_MAX);
    const description = truncate(fillVars(eff.body, ex, allowed).trim(), BODY_MAX);
    $('#bt-preview', tplBody).innerHTML = discordPreview({
      where: m.target,
      content: m.content ? fillVars(m.content, ex, allowed) : '',
      embed: {
        color: m.color, title, description, url: ex.lien,
        fields: (m.fields ?? []).map(([n, v]) => [n, fillVars(v, ex, allowed)]),
        footer: m.footer,
      },
    });
  }

  async function saveTemplates(btn) {
    const pending = dirtyKeys();
    if (!pending.length) return;
    await busy(btn, async () => {
      // Relit la valeur en base pour ne pas écraser une modification faite ailleurs entre-temps.
      const row = check(await sb.from('hg_settings').select('value').eq('key', 'bot_templates').maybeSingle());
      const base = row?.value && typeof row.value === 'object' && !Array.isArray(row.value) ? { ...row.value } : {};
      for (const k of pending) {
        const t = S.drafts.get(k), d = def(k);
        const title = t.title.trim() === d.title ? '' : t.title.trim();
        const body = t.body.trim() === d.body ? '' : t.body.replace(/\s+$/, '');
        if (!title && !body) delete base[k]; else base[k] = { title, body };
      }
      check(await sb.from('hg_settings').upsert({ key: 'bot_templates', value: base, updated_at: new Date().toISOString() }));
      S.custom = base;
      for (const k of pending) S.drafts.delete(k);
      refreshListStates(); updateEditorMeta();
      toast(pending.length > 1 ? `${pending.length} modèles enregistrés` : 'Modèle enregistré', 'ok');
    });
  }

  window.addEventListener('beforeunload', (e) => {
    if (S.defs && dirtyKeys().length) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ======================= Message manuel ======================= */
  const bmBody = $('#bm-body', container);
  const reachable = (p) => p.status === 'ok';
  const visible = () => {
    const q = norm(S.q);
    return S.people.filter((p) => !q || norm(p.name).includes(q) || norm(p.email).includes(q));
  };

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
    const onInput = () => { renderManualCounts(); renderManualPreview(); };
    title.addEventListener('input', onInput);
    text.addEventListener('input', onInput);
    $('#bm-channel', bmBody).addEventListener('change', renderManualPreview);
    const varBtn = $('#bm-var', bmBody);
    varBtn.addEventListener('mousedown', (e) => e.preventDefault());
    varBtn.addEventListener('click', () => {
      if (last.value.length + 8 > last.maxLength) { toast('Texte trop long', 'error'); return; }
      last.setRangeText('{pseudo}', last.selectionStart ?? last.value.length, last.selectionEnd ?? last.value.length, 'end');
      last.focus(); onInput();
    });
    $('#bm-form', bmBody).addEventListener('submit', (e) => { e.preventDefault(); sendManual(e.submitter); });
    syncChannelOption();
    renderRecipients(); renderManualCounts(); renderManualPreview();
  }

  function syncChannelOption() {
    const cb = $('#bm-channel', bmBody); if (!cb) return;
    const has = !!S.bot.announce_channel_id;
    cb.disabled = !has;
    if (!has) cb.checked = false;
    $('#bm-channel-wrap', bmBody).classList.toggle('is-disabled', !has);
    $('#bm-channel-hint', bmBody).textContent = has ? '' : '(renseigne d\'abord l\'ID du salon dans les réglages)';
  }

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
  function renderCount() {
    const n = S.selected.size, total = S.people.filter(reachable).length, off = S.people.length - total;
    $('#bm-count', bmBody).textContent = `${pluralCount(n, 'sélectionné', 'sélectionnés')} sur ${pluralCount(total, 'compte joignable', 'comptes joignables')}${off ? ` · ${pluralCount(off, 'compte non joignable', 'comptes non joignables')}` : ''}`;
  }
  function renderManualCounts() {
    $('#bm-title-count', bmBody).textContent = `${$('#bm-title', bmBody).value.length} / ${MANUAL_TITLE_MAX}`;
    $('#bm-text-count', bmBody).textContent = `${$('#bm-text', bmBody).value.length} / ${MANUAL_BODY_MAX}`;
  }
  function renderManualPreview() {
    const firstId = [...S.selected][0];
    const who = firstId ? S.pseudo.get(firstId) ?? 'Alex' : null;
    const channel = $('#bm-channel', bmBody).checked;
    const pseudo = who ?? (channel ? 'tout le monde' : 'Alex');
    const sub = (s) => s.replace(/\{pseudo\}/g, pseudo);
    const title = truncate(sub($('#bm-title', bmBody).value).replace(/\s+/g, ' ').trim(), TITLE_MAX);
    const description = truncate(sub($('#bm-text', bmBody).value).trim(), BODY_MAX);
    $('#bm-preview-for', bmBody).textContent = who ? `pour ${who}` : channel && !S.selected.size ? 'dans le salon' : 'avec un pseudo d\'exemple';
    $('#bm-preview', bmBody).innerHTML = discordPreview({ where: who ? 'Message privé' : channel ? 'Salon d\'annonces' : 'Message privé', embed: { color: '#9E3543', title, description } });
  }

  async function sendManual(btn) {
    if (S.sending) return;
    const title = $('#bm-title', bmBody).value.trim(), body = $('#bm-text', bmBody).value.trim();
    const channel = $('#bm-channel', bmBody).checked;
    const ids = [...S.selected];
    if (!body) { toast('Écris un message', 'error'); $('#bm-text', bmBody).focus(); return; }
    if (body.length > MANUAL_BODY_MAX) { toast(`Message trop long (${MANUAL_BODY_MAX} caractères maximum)`, 'error'); return; }
    if (!ids.length && !channel) { toast('Choisis au moins un destinataire', 'error'); return; }
    if (ids.length > CONFIRM_ABOVE) {
      const txt = `Le bot va envoyer ce message en privé à ${ids.length} personnes${channel ? ' et le publier dans le salon d\'annonces' : ''}. L'envoi prend quelques secondes par destinataire.`;
      if (!(await confirmSend(txt))) return;
    }
    S.sending = true;
    const resBox = $('#bm-result', bmBody);
    resBox.innerHTML = `<div class="bm-sending" role="status">Envoi en cours (${pluralCount(ids.length, 'destinataire', 'destinataires')})…</div>`;
    await busy(btn, async () => {
      try {
        const res = await callFn('hg-notify', { event: 'admin_dm', user_ids: ids, title, body, channel });
        if (res?.error) throw new Error(res.error);
        renderResult(res);
        const failed = (res?.failed ?? 0) + (res?.channel === false ? 1 : 0);
        toast(failed ? 'Envoi terminé avec des échecs' : 'Message envoyé', failed ? 'error' : 'ok');
        S.history = null;
        if ($('#bm-history', container).open) loadHistory();
      } catch (e) {
        resBox.innerHTML = `<div class="bm-error" role="alert">Échec de l'envoi : ${esc(await fnError(e))}</div>`;
        throw e;
      } finally { S.sending = false; }
    });
  }

  function recipientsHtml(list) {
    return `<ul class="bm-res-list">${(list ?? []).map((r) => {
      const st = r.status ?? (r.ok ? 'sent' : 'failed');
      const [label, cls] = RESULT[st] ?? RESULT.failed;
      const name = r.pseudo ?? S.pseudo.get(r.user_id) ?? 'Compte inconnu';
      return `<li class="bm-res-row"><span class="bm-name">${esc(name)}</span><span class="pill ${cls}">${esc(label)}</span>${r.reason ? `<span class="small muted bm-reason">${esc(r.reason)}</span>` : ''}</li>`;
    }).join('')}</ul>`;
  }

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
      </div>`;
  }

  /* ---------- Historique ---------- */
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
  async function fetchHistory(failedOnly) {
    const cols = 'id, sent_by, kind, title, body, recipients, channel, created_at';
    const base = () => sb.from('hg_bot_log').select(cols).order('created_at', { ascending: false });
    const n = S.histLimit;
    if (!failedOnly) return check(await base().limit(n)) ?? [];
    const [a, b, c] = await Promise.all([
      base().contains('recipients', [{ status: 'failed' }]).limit(n),
      base().contains('recipients', [{ ok: false }]).limit(n),
      base().neq('kind', 'manual').ilike('body', '%échec%').limit(n),
    ]);
    const seen = new Map();
    for (const r of [...(check(a) ?? []), ...(check(b) ?? []), ...(check(c) ?? [])]) seen.set(r.id, r);
    return [...seen.values()].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))).slice(0, n);
  }
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
        return `<details class="bm-log">
          <summary>
            <span class="bm-log-date">${esc(logFmt.format(new Date(r.created_at)))}</span>
            <span class="bm-log-title">${esc(head)}</span>
            <span class="bm-log-stats">
              <span class="pill pill-ok">${sent} envoyé${sent > 1 ? 's' : ''}</span>
              ${failed ? `<span class="pill bm-pill-fail">${failed} échec${failed > 1 ? 's' : ''}</span>` : ''}
              ${skipped ? `<span class="pill pill-todo">${skipped} ignoré${skipped > 1 ? 's' : ''}</span>` : ''}
              ${r.channel ? '<span class="pill pill-current">Salon</span>' : ''}
            </span>
          </summary>
          <div class="bm-log-body stack">
            <p class="small muted">Par ${esc(S.pseudo.get(r.sent_by) ?? 'un admin')}${r.kind && r.kind !== 'manual' ? ` · ${esc(r.kind)}` : ''}${r.channel ? ' · publié dans le salon d\'annonces' : ''}</p>
            ${r.title ? `<p class="bm-log-t">${esc(r.title)}</p>` : ''}
            <p class="bm-log-text">${esc(r.body ?? '')}</p>
            ${rec.length ? recipientsHtml(rec) : '<p class="small muted">Aucun MP (salon uniquement).</p>'}
          </div>
        </details>`;
      }).join('') + more : emptyHtml(S.histQ, failedOnly ? 'Aucun échec enregistré.' : 'Aucun message envoyé pour l\'instant.');
  }

  /* ======================= Chargement ======================= */
  (async () => {
    const [settings, defs, accounts, profiles] = await Promise.allSettled([
      sb.from('hg_settings').select('key, value').in('key', ['bot', 'bot_templates']).then(check),
      fetch(TEMPLATES_URL, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      sb.rpc('hg_admin_accounts').then(check),
      sb.from('hg_profiles').select('id, pseudo, discord_id, bot_optin, avatar_url, color, is_admin').then(check),
    ]);

    // Réglages
    if (settings.status === 'fulfilled') {
      const get = (k) => (settings.value ?? []).find((r) => r.key === k)?.value;
      S.bot = get('bot') ?? S.bot;
      S.bot.notify = { draw: true, gift: true, irl: true, birthday: true, support: true, messages: true, card_pull: true, card_trade: false, ...(S.bot.notify || {}) };
      const c = get('bot_templates');
      S.custom = c && typeof c === 'object' && !Array.isArray(c) ? c : {};
    } else {
      toast(`Réglages du bot : ${errMsg(settings.reason)}`, 'error');
    }
    renderSettings();

    // Modèles
    if (defs.status === 'fulfilled' && defs.value?.templates) {
      S.defs = defs.value;
      renderTemplatesShell();
      selectTemplate(keys()[0]);
    } else {
      tplBody.innerHTML = `<div class="empty">Impossible de charger les textes par défaut (<code>supabase/functions/_shared/bot-templates.json</code>)${defs.status === 'rejected' ? ` : ${esc(errMsg(defs.reason))}` : ''}. Sur GitHub Pages, vérifie la présence du fichier <code>.nojekyll</code> à la racine.</div>`;
    }

    // Comptes
    const profs = profiles.status === 'fulfilled' ? profiles.value ?? [] : [];
    const byId = new Map(profs.map((p) => [p.id, p]));
    const accs = accounts.status === 'fulfilled' && Array.isArray(accounts.value) ? accounts.value : profs.map((p) => ({ id: p.id, pseudo: p.pseudo }));
    if (accounts.status === 'rejected' && profiles.status === 'rejected') {
      bmBody.innerHTML = `<div class="empty">Impossible de charger les comptes : ${esc(errMsg(accounts.reason))}</div>`;
      return;
    }
    S.people = accs.map((a) => {
      const p = byId.get(a.id);
      const status = !p ? 'noprofile' : !DISCORD_ID.test(String(p.discord_id ?? '')) ? 'nodiscord' : !p.bot_optin ? 'optout' : 'ok';
      return {
        id: a.id, name: p?.pseudo ?? a.pseudo ?? a.email ?? 'Compte sans pseudo', email: a.email ?? '',
        avatar_url: p?.avatar_url ?? null, color: p?.color ?? null, is_admin: !!(p?.is_admin ?? a.is_admin), status,
      };
    }).sort((a, b) => (a.status !== 'ok') - (b.status !== 'ok') || a.name.localeCompare(b.name, 'fr'));
    for (const p of profs) S.pseudo.set(p.id, p.pseudo);
    for (const p of S.people) if (!S.pseudo.has(p.id)) S.pseudo.set(p.id, p.name);
    renderManualShell();
  })();
}
