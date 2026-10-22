// ===== Humane Gang — administration : éditeur des thèmes (hg_themes + hg_settings.theme) =====
// Rôle : liste des thèmes du site (cartes), réglage du mode (automatique ou thème forcé), aperçu sur toute la page
// et éditeur (tiroir) : nom, identifiant, période, priorité, logo, emojis, effet et couleurs avec contrôle de contraste.
// Dépendances : core.js (Supabase, application du thème, contrastes, périodes), icons.js, ui-confirm.js,
// image-compress.js (préparation du logo), admin/list-tools.js (recherche), admin/ui/drawer.js (tiroir).
// Tables et stockage : hg_themes (thèmes), hg_settings (clé 'theme' : mode et thème forcé), bucket hg-assets (logos themes/).
// Exporte : themeActions (boutons de l'en-tête), mountThemesSection (montage de la section).
import {
  sb, toast, errMsg, esc, $,
  applyTheme, paintTheme, pickTheme, isValidMd, isHex, contrast, todayMd, mdInRange, getActiveTheme,
  DEFAULT_THEME, THEME_EFFECTS, THEME_COLOR_KEYS,
} from './core.js';
import { svg } from './icons.js';
import { confirmBox } from './ui-confirm.js';
import { prepareImage } from './image-compress.js';
import { matches, searchHtml, bindSearch, emptyHtml, SEARCH_DELAY } from './admin/list-tools.js';
import { openDrawer } from './admin/ui/drawer.js';

// Bouton « + Nouveau thème » de l'en-tête de zone (admin.js) : appelle l'éditeur ouvert par la section montée.
let openNewTheme = null;
/**
 * Crée le bouton « + Nouveau thème » de l'en-tête de zone. Il ouvre l'éditeur de la section montée.
 * @returns {HTMLButtonElement[]} Liste de boutons pour la barre d'actions.
 */
export function themeActions() {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn btn-primary btn-sm'; b.textContent = '+ Nouveau thème';
  b.addEventListener('click', () => openNewTheme?.());
  return [b];
}

// Libellés des couleurs : [nom affiché, aide courte]. L'ordre suit THEME_COLOR_KEYS.
const COLOR_LABELS = {
  accent: ['Accent', 'boutons principaux'],
  bg: ['Fond', 'arrière-plan de la page'],
  surface: ['Surface', 'cartes et blocs'],
  text: ['Texte', 'texte principal'],
  muted: ['Texte secondaire', 'légendes, aides'],
  highlight: ['Mise en valeur', 'liens, sur-titres'],
};
// Noms des mois, complets puis abrégés, pour les menus de période et les dates affichées.
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
// Extension de fichier à partir du type MIME d'une image (logo de thème).
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/gif': 'gif' };
// Icônes SVG des boutons de la liste et de l'éditeur.
const ICON = {
  edit: svg('edit3', { stroke: 2 }),
  copy: svg('copy', { stroke: 2 }),
  trash: svg('trash', { stroke: 2 }),
  eye: svg('eye', { stroke: 2 }),
  plus: svg('plus', { stroke: 2 }),
  upload: svg('upload', { stroke: 2 }),
  warn: svg('warn2', { stroke: 2 }),
};

/* ---------- Outils ---------- */
/** Renvoie les données d'une réponse Supabase, ou lève l'erreur si la requête a échoué. */
function check(res) { if (res.error) throw res.error; return res.data; }
/** Action en cours : bouton désactivé avec indicateur, pas de second envoi. */
async function busy(btn, fn) {
  if (btn?.dataset.busy) return undefined;
  if (btn) { btn.disabled = true; btn.dataset.busy = '1'; btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); } catch (e) { toast(errMsg(e), 'error'); return undefined; } finally {
    if (btn) { delete btn.dataset.busy; btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy'); if (btn.isConnected) btn.disabled = false; }
  }
}
/**
 * Transforme un texte en identifiant d'URL : minuscules, sans accents, tirets, 40 caractères au plus.
 * @param {string} s Texte source (nom du thème).
 * @returns {string}
 */
function slugify(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
/**
 * Découpe la saisie des emojis (séparés par des espaces). Une suite d'emojis sans espace est aussi découpée.
 * Au plus 12 emojis sont gardés.
 * @param {string} str Saisie brute.
 * @returns {string[]}
 */
function parseEmojis(str) {
  const out = [];
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('fr', { granularity: 'grapheme' }) : null;
  for (const tok of String(str || '').split(/\s+/).filter(Boolean)) {
    if (seg && /\p{Extended_Pictographic}/u.test(tok)) {
      const parts = [...seg.segment(tok)].map((x) => x.segment);
      // « 🎃👻 » (sans espace) → deux emojis ; un mot normal reste entier
      if (parts.every((p) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(p))) { out.push(...parts); continue; }
    }
    out.push(tok);
  }
  return out.slice(0, 12);
}
/**
 * Date « MM-JJ » en texte court (ex. « 1er oct. »). Chaîne vide si la date est invalide.
 * @param {string} md Date au format MM-JJ.
 * @returns {string}
 */
function fmtMd(md) {
  if (!isValidMd(md)) return '';
  const [m, d] = md.split('-').map(Number);
  return `${d === 1 ? '1er' : d} ${MONTHS_SHORT[m - 1]}`;
}
/** Période d'un thème en texte (« 1er déc. → 6 janv. »), ou « Sans période ». */
const rangeLabel = (t) => (isValidMd(t.start_md) && isValidMd(t.end_md) ? `${fmtMd(t.start_md)} → ${fmtMd(t.end_md)}` : 'Sans période');
/** Ajoute la feuille de style de l'éditeur de thèmes à la page, une seule fois. */
function loadStyles() {
  if (document.querySelector('link[data-admin-themes]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('../css/admin-themes.css', import.meta.url).href; l.dataset.adminThemes = '';
  document.head.append(l);
}

/* =========================================================
   Montage
   ========================================================= */
/**
 * Affiche la section (mode, liste des thèmes, éditeur) dans le conteneur, puis charge les thèmes.
 * @param {HTMLElement} container Élément qui recevra la section.
 */
export async function mountThemesSection(container) {
  if (!container) return;
  loadStyles();

  // État de la section : thèmes, réglage (mode, thème forcé), brouillon de l'éditeur, id en cours de modification,
  // thème en aperçu, recherche. slugTouched : l'identifiant ne suit plus le nom une fois modifié à la main.
  const S = { themes: [], setting: { mode: 'auto', forced_slug: null }, draft: null, editingId: null, previewing: null, slugTouched: false, query: '' };

  // Éditeur : nœud persistant, rattaché au corps du tiroir large à chaque ouverture (les écouteurs restent liés)
  const editorHost = document.createElement('div');
  editorHost.className = 'th-editor-host';
  let drawerApi = null, drawerForm = null;

  container.innerHTML = `
    <div class="th-root stack">
      <form class="card stack" data-el="mode-form">
        <h3 class="card-title">Thème du site</h3>
        <p class="th-today" data-el="today"></p>
        <fieldset class="toggles">
          <legend class="label">Mode</legend>
          <label class="check"><input type="radio" name="th-mode" value="auto"> <span>Automatique <span class="muted small">selon les périodes et les priorités ci-dessous</span></span></label>
          <label class="check"><input type="radio" name="th-mode" value="forced"> <span>Forcer un thème</span></label>
        </fieldset>
        <div class="field narrow" data-el="forced-wrap">
          <label for="th-forced">Thème forcé</label>
          <select id="th-forced" data-el="forced"></select>
        </div>
        <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer le mode</button></div>
      </form>

      <div class="th-listhead">
        <h3 class="sub-title">Thèmes <span class="muted small" data-el="count"></span></h3>
      </div>
      <div class="th-list" data-el="list"><div class="empty">Chargement des thèmes…</div></div>
      <p class="muted small">Quand plusieurs périodes se chevauchent, le thème de plus haute priorité l'emporte (à égalité, la période la plus courte). Hors de toute période : thème par défaut.</p>
    </div>`;
  /** Élément de la section repéré par son attribut data-el. */
  const el = (name) => container.querySelector(`[data-el="${name}"]`);

  // Barre d'aperçu flottante (visible partout sur la page)
  const bar = document.createElement('div');
  bar.className = 'th-preview-bar'; bar.hidden = true; bar.setAttribute('role', 'status');
  bar.innerHTML = `<span data-el="bar-label"></span><button class="btn btn-light btn-sm" type="button">Annuler l'aperçu</button>`;
  document.body.append(bar);
  bar.querySelector('button').addEventListener('click', () => stopPreview());

  // Recherche dans la liste des thèmes (le champ reste en place pendant la frappe)
  el('list').insertAdjacentHTML('beforebegin', searchHtml({ id: 'th-search', label: 'Rechercher un thème', placeholder: 'Nom ou identifiant…', count: false }));
  bindSearch(container.querySelector('#th-search'), (q) => { S.query = q; renderList(); }, SEARCH_DELAY);

  /* ---------- Données ---------- */
  /** Charge les thèmes et le réglage du site (mode et thème forcé). */
  async function load() {
    const [t, s] = await Promise.all([
      sb.from('hg_themes').select('*').order('is_default', { ascending: false }).order('priority', { ascending: false }).order('name'),
      sb.from('hg_settings').select('value').eq('key', 'theme').maybeSingle(),
    ]);
    S.themes = check(t) ?? [];
    const v = check(s)?.value ?? {};
    S.setting = { mode: v.mode === 'forced' ? 'forced' : 'auto', forced_slug: v.forced_slug ?? v.forced ?? null };
  }
  // Thème qui s'applique aujourd'hui, selon le réglage (mode automatique ou forcé).
  const todayTheme = () => pickTheme(S.themes, S.setting);
  // Thème qui s'appliquerait en mode automatique, sans forçage.
  const autoTheme = () => pickTheme(S.themes, { mode: 'auto' });

  /* ---------- Aperçu ---------- */
  /**
   * Applique un thème à toute la page sans l'enregistrer, et affiche la barre « Aperçu ».
   * @param {object} theme Thème (ou brouillon avec __draft) à montrer.
   * @param {string} [label] Nom affiché dans la barre.
   */
  function startPreview(theme, label) {
    S.previewing = theme;
    paintTheme(theme);
    bar.hidden = false;
    bar.querySelector('[data-el="bar-label"]').textContent = `Aperçu : ${label || theme.name || 'thème'}`;
  }
  /** Arrête l'aperçu : la barre disparaît et le thème du jour est remis. */
  function stopPreview() {
    if (!S.previewing) return;
    S.previewing = null;
    bar.hidden = true;
    paintTheme(todayTheme());
  }

  /* ---------- Mode ---------- */
  /** Remplit le bloc « Mode » : mode choisi, menu du thème forcé, et ce qui s'applique aujourd'hui. */
  function renderMode() {
    const f = el('mode-form');
    f.querySelector(`input[value="${S.setting.mode}"]`).checked = true;
    const sel = el('forced');
    const forcedSlug = S.setting.forced_slug && S.themes.some((t) => t.slug === S.setting.forced_slug) ? S.setting.forced_slug : autoTheme().slug;
    sel.innerHTML = S.themes.map((t) => `<option value="${esc(t.slug)}"${t.slug === forcedSlug ? ' selected' : ''}>${esc(t.name)}${t.active ? '' : ' (inactif)'}</option>`).join('');
    el('forced-wrap').hidden = S.setting.mode !== 'forced';
    const now = todayTheme(), auto = autoTheme();
    const d = new Date();
    el('today').innerHTML = `Aujourd'hui (${d.getDate() === 1 ? '1er' : d.getDate()} ${MONTHS[d.getMonth()]}) : <strong>${esc(now.name)}</strong>${
      S.setting.mode === 'forced' ? ' <span class="pill pill-warn">forcé</span>' : ''}${
      S.setting.mode === 'forced' && auto.slug !== now.slug ? ` <span class="muted small">— en automatique ce serait ${esc(auto.name)}</span>` : ''}`;
  }
  el('mode-form').addEventListener('change', (ev) => {
    if (ev.target.name === 'th-mode') { S.setting.mode = ev.target.value; el('forced-wrap').hidden = S.setting.mode !== 'forced'; }
  });
  el('mode-form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(ev.submitter, async () => {
      const mode = el('mode-form').querySelector('input[name="th-mode"]:checked')?.value === 'forced' ? 'forced' : 'auto';
      const value = { mode, forced_slug: mode === 'forced' ? el('forced').value : null };
      check(await sb.from('hg_settings').upsert({ key: 'theme', value, updated_at: new Date().toISOString() }));
      S.setting = value;
      await refreshSite();
      renderAll();
      toast(mode === 'forced' ? `Thème « ${todayTheme().name} » forcé sur tout le site` : 'Mode automatique rétabli', 'ok');
    });
  });

  /* ---------- Liste ---------- */
  /**
   * Pastilles de couleur d'un thème (une par clé de couleur). Une valeur invalide donne du noir.
   * @param {object} colors Couleurs du thème.
   * @returns {string} HTML.
   */
  function swatches(colors = {}) {
    return `<span class="th-swatches" aria-hidden="true">${THEME_COLOR_KEYS.map((k) => `<span style="background:${esc(isHex(colors[k]) ? colors[k] : '#000')}"></span>`).join('')}</span>`;
  }
  /** Dessine la liste des cartes de thèmes selon la recherche, avec leurs pastilles d'état. */
  function renderList() {
    const now = todayTheme();
    const shown = S.themes.filter((t) => matches(S.query, t.name, t.slug));
    el('count').textContent = S.query.trim() ? `(${shown.length} sur ${S.themes.length})` : `(${S.themes.length})`;
    if (!S.themes.length) { el('list').innerHTML = '<div class="empty">Aucun thème.</div>'; return; }
    if (!shown.length) { el('list').innerHTML = emptyHtml(S.query, 'Aucun thème.'); return; }
    el('list').innerHTML = shown.map((t) => {
      const pills = [
        t.is_default ? '<span class="pill">Par défaut</span>' : '',
        t.slug === now.slug ? '<span class="pill pill-ok">Actif aujourd\'hui</span>' : '',
        S.setting.mode === 'forced' && S.setting.forced_slug === t.slug ? '<span class="pill pill-warn">Forcé</span>' : '',
        t.active ? '' : '<span class="pill pill-todo">Désactivé</span>',
      ].join('');
      const md = todayMd();
      const inRange = !t.is_default && t.active && mdInRange(md, t.start_md, t.end_md);
      return `<article class="th-card${t.slug === now.slug ? ' is-now' : ''}${t.active ? '' : ' is-off'}" data-id="${esc(t.id)}">
        <div class="th-card-top">
          ${swatches(t.colors)}
          <div class="th-emojis" aria-label="Emojis">${(t.emojis || []).map((e) => `<span>${esc(e)}</span>`).join('') || '<span class="muted small">aucun emoji</span>'}</div>
        </div>
        <div class="th-card-body">
          <div class="th-name">${esc(t.name)} <code class="muted small">${esc(t.slug)}</code></div>
          <div class="th-pills">${pills}</div>
          <dl class="th-meta">
            <div><dt>Période</dt><dd>${t.is_default ? 'Toute l\'année (secours)' : esc(rangeLabel(t))}${inRange && t.slug !== now.slug ? ' <span class="muted">· couvert par un thème prioritaire</span>' : ''}</dd></div>
            <div><dt>Priorité</dt><dd>${esc(t.priority ?? 0)}</dd></div>
            <div><dt>Effet</dt><dd>${esc(THEME_EFFECTS[t.effect] || 'Aucun')}</dd></div>
            <div><dt>Logo</dt><dd>${t.logo_url ? 'Personnalisé' : 'Logo du site'}</dd></div>
          </dl>
        </div>
        <div class="th-actions">
          <button class="btn btn-ghost btn-sm" type="button" data-act="preview">${ICON.eye}Aperçu</button>
          <button class="btn btn-ghost btn-sm" type="button" data-act="edit">${ICON.edit}Modifier</button>
          <button class="btn btn-ghost btn-sm btn-icon" type="button" data-act="dup" aria-label="Dupliquer ${esc(t.name)}" title="Dupliquer">${ICON.copy}</button>
          ${t.is_default ? '' : `<button class="btn btn-danger btn-sm btn-icon" type="button" data-act="del" aria-label="Supprimer ${esc(t.name)}" title="Supprimer">${ICON.trash}</button>`}
        </div>
      </article>`;
    }).join('');
  }
  // Boutons des cartes : aperçu, modifier, dupliquer, supprimer (le thème est retrouvé par son id).
  container.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    if (!b || !container.contains(b)) return;
    const act = b.dataset.act;
    const t = S.themes.find((x) => String(x.id) === b.closest('[data-id]')?.dataset.id);
    if (act === 'new') openEditor(null);
    else if (act === 'edit' && t) openEditor(t);
    else if (act === 'dup' && t) openEditor(t, { duplicate: true });
    else if (act === 'preview' && t) startPreview(t);
    else if (act === 'del' && t) deleteTheme(t, b);
  });

  /**
   * Supprime un thème non par défaut après confirmation. Si c'était le thème forcé, le site repasse en automatique.
   * @param {object} t Thème à supprimer.
   * @param {HTMLButtonElement} btn Bouton « Supprimer ».
   */
  async function deleteTheme(t, btn) {
    if (t.is_default) return;
    const ok = await confirmBox(`Supprimer « ${t.name} » ?`, 'Le thème sera définitivement supprimé. Si c\'était le thème forcé, le site repasse en mode automatique.', { ok: 'Supprimer', danger: true });
    if (!ok) return;
    await busy(btn, async () => {
      check(await sb.from('hg_themes').delete().eq('id', t.id));
      if (S.setting.mode === 'forced' && S.setting.forced_slug === t.slug) {
        S.setting = { mode: 'auto', forced_slug: null };
        check(await sb.from('hg_settings').upsert({ key: 'theme', value: S.setting, updated_at: new Date().toISOString() }));
      }
      if (S.editingId === t.id) closeEditor();
      await refreshSite();
      renderAll();
      toast(`Thème « ${t.name} » supprimé`, 'ok');
    });
  }

  /* ---------- Éditeur ---------- */
  // Options « jour » (1 à 31) pour les menus de période, avec le jour sélectionné.
  const dayOpts = (sel) => Array.from({ length: 31 }, (_, i) => `<option value="${String(i + 1).padStart(2, '0')}"${Number(sel) === i + 1 ? ' selected' : ''}>${i + 1}</option>`).join('');
  /** Options « mois » pour les menus de période, avec le mois sélectionné. */
  const monthOpts = (sel) => MONTHS.map((m, i) => `<option value="${String(i + 1).padStart(2, '0')}"${Number(sel) === i + 1 ? ' selected' : ''}>${m}</option>`).join('');

  /**
   * Ouvre le tiroir de l'éditeur : nouveau thème, modification, ou copie d'un thème existant (copie désactivée, sans slug repris).
   * @param {object|null} theme Thème de départ (null pour un nouveau).
   * @param {{duplicate?: boolean}} [opts] Vrai pour dupliquer.
   */
  function openEditor(theme, { duplicate = false } = {}) {
    stopPreview();
    const base = theme ? structuredClone(theme) : { ...structuredClone(DEFAULT_THEME), name: '', slug: '', is_default: false, priority: 1, effect: 'aucun', emojis: [], start_md: '01-01', end_md: '01-31' };
    if (duplicate) {
      base.name = `${base.name} (copie)`;
      let slug = slugify(base.name), n = 2;
      while (S.themes.some((t) => t.slug === slug)) slug = `${slugify(theme.name)}-copie-${n++}`;
      base.slug = slug; base.is_default = false; base.active = false;
      if (!isValidMd(base.start_md)) { base.start_md = '01-01'; base.end_md = '01-31'; }
    }
    base.colors = { ...DEFAULT_THEME.colors, ...(base.colors || {}) };
    S.draft = base;
    S.editingId = theme && !duplicate ? theme.id : null;
    S.slugTouched = !!S.editingId;
    editorHost.remove(); // détaché de l'ancien tiroir : sinon l'analyseur ignore le <form> interne (formulaire imbriqué)
    renderEditor();
    const title = S.editingId ? `Modifier « ${base.name} »` : 'Nouveau thème';
    const d = openDrawer({
      title, subtitle: 'Thème du site', body: editorHost, wide: true, submitLabel: 'Enregistrer',
      onSubmit: () => saveTheme(),
      onClose: () => { drawerApi = null; drawerForm = null; stopPreview(); S.draft = null; S.editingId = null; editorHost.remove(); editorHost.innerHTML = ''; },
    });
    drawerApi = d; drawerForm = d.form;
    editorHost.querySelector('input[name="tname"]')?.focus({ preventScroll: true });
  }
  /** Ferme le tiroir de l'éditeur s'il est ouvert. */
  function closeEditor() { drawerApi?.close(); }
  // Relie le bouton « + Nouveau thème » de l'en-tête à cet éditeur.
  openNewTheme = () => openEditor(null);

  /** Écrit le formulaire de l'éditeur à partir du brouillon (S.draft), puis le met à jour. */
  function renderEditor() {
    const d = S.draft;
    const isNew = !S.editingId;
    const hasRange = isValidMd(d.start_md) && isValidMd(d.end_md);
    const [sm, sd] = (d.start_md || '01-01').split('-');
    const [em, ed] = (d.end_md || '01-31').split('-');
    editorHost.innerHTML = `
      <form class="stack th-editor" novalidate>
        <div class="th-editor-head">
          <h3 class="card-title">${isNew ? 'Nouveau thème' : `Modifier « ${esc(d.name)} »`}</h3>
          ${d.is_default ? '<span class="pill">Thème par défaut</span>' : ''}
        </div>

        <div class="grid-2">
          <div class="field"><label for="th-name">Nom</label><input id="th-name" name="tname" required maxlength="40" value="${esc(d.name)}"></div>
          <div class="field"><label for="th-slug">Identifiant (slug)</label><input id="th-slug" name="slug" maxlength="40" pattern="[a-z0-9\\-]+" value="${esc(d.slug)}"${isNew ? '' : ' readonly'} autocomplete="off" spellcheck="false">
            <span class="muted small">${isNew ? 'Créé automatiquement à partir du nom.' : 'Non modifiable après création.'}</span></div>
        </div>

        ${d.is_default ? '<p class="muted small">Le thème par défaut s\'applique hors de toute période ; il est toujours actif et ne peut pas être supprimé.</p>' : `
        <label class="switch"><input type="checkbox" role="switch" name="active"${d.active ? ' checked' : ''}><span class="switch-ui" aria-hidden="true"></span><span>Actif <span class="muted small">(un thème désactivé ne s'applique jamais automatiquement)</span></span></label>

        <fieldset class="th-fieldset">
          <legend class="label">Période (chaque année)</legend>
          <label class="check"><input type="checkbox" name="has_range"${hasRange ? ' checked' : ''}> <span>Appliquer automatiquement pendant une période</span></label>
          <div class="th-range" data-el="range"${hasRange ? '' : ' hidden'}>
            <div class="th-date"><span class="label">Du</span>
              <select name="start_d" aria-label="Jour de début">${dayOpts(sd)}</select>
              <select name="start_m" aria-label="Mois de début">${monthOpts(sm)}</select></div>
            <div class="th-date"><span class="label">au</span>
              <select name="end_d" aria-label="Jour de fin">${dayOpts(ed)}</select>
              <select name="end_m" aria-label="Mois de fin">${monthOpts(em)}</select></div>
            <p class="muted small th-range-note" data-el="range-note"></p>
          </div>
        </fieldset>

        <div class="field narrow"><label for="th-priority">Priorité</label><input id="th-priority" name="priority" type="number" inputmode="numeric" min="0" max="100" step="1" value="${esc(d.priority ?? 0)}">
          <span class="muted small">La plus haute l'emporte si plusieurs périodes se chevauchent (ex. Halloween 5 &gt; Automne 1).</span></div>`}

        <fieldset class="th-fieldset">
          <legend class="label">Logo</legend>
          <div class="th-logo">
            <div class="th-logo-preview" data-el="logo-preview"></div>
            <div class="stack grow">
              <div class="field"><label for="th-logo">Adresse de l'image <span class="muted small">(vide = logo du site)</span></label><input id="th-logo" name="logo_url" type="url" inputmode="url" placeholder="https://…" value="${esc(d.logo_url || '')}"></div>
              <div class="btn-row">
                <button class="btn btn-ghost btn-sm" type="button" data-ed="upload">${ICON.upload}Téléverser une image</button>
                <button class="btn btn-ghost btn-sm" type="button" data-ed="nologo">Logo du site</button>
              </div>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" hidden data-el="file">
            </div>
          </div>
        </fieldset>

        <div class="grid-2">
          <div class="field"><label for="th-emojis">Emojis <span class="muted small">(séparés par des espaces)</span></label><input id="th-emojis" name="emojis" value="${esc((d.emojis || []).join(' '))}" autocomplete="off">
            <span class="th-emoji-preview" data-el="emoji-preview" aria-hidden="true"></span></div>
          <div class="field"><label for="th-effect">Effet visuel</label><select id="th-effect" name="effect">${Object.entries(THEME_EFFECTS).map(([k, v]) => `<option value="${k}"${d.effect === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select>
            <span class="muted small">Léger, derrière le contenu ; coupé si l'appareil demande moins d'animations.</span></div>
        </div>

        <fieldset class="th-fieldset">
          <legend class="label">Couleurs</legend>
          <div class="th-colors">
            ${THEME_COLOR_KEYS.map((k) => `<div class="th-color">
              <input type="color" name="c_${k}" value="${esc(d.colors[k].toLowerCase())}" aria-label="${esc(COLOR_LABELS[k][0])} (sélecteur)">
              <div class="th-color-text"><label for="th-hex-${k}">${esc(COLOR_LABELS[k][0])}</label><span class="muted small">${esc(COLOR_LABELS[k][1])}</span></div>
              <input class="input th-hex" id="th-hex-${k}" name="h_${k}" value="${esc(d.colors[k].toUpperCase())}" maxlength="7" spellcheck="false" autocomplete="off">
            </div>`).join('')}
          </div>
          <div class="th-warn" data-el="contrast" hidden></div>
        </fieldset>

        <div class="th-sample" data-el="sample" aria-hidden="true">
          <div class="th-sample-card">
            <span class="th-sample-eyebrow">Sur-titre</span>
            <strong>Carte d'exemple</strong>
            <span class="th-sample-muted">Texte secondaire et <u>lien</u></span>
            <span class="th-sample-btns"><span class="th-sample-btn">Action</span><span class="th-sample-ghost">Annuler</span></span>
          </div>
        </div>

        <p class="th-error" data-el="error" role="alert" hidden></p>
        <div class="btn-row">
          <button class="btn btn-primary" type="submit">${isNew ? 'Créer le thème' : 'Enregistrer'}</button>
          <button class="btn btn-ghost" type="button" data-ed="preview">${ICON.eye}Aperçu en direct</button>
          <button class="btn btn-ghost" type="button" data-ed="cancel">Fermer</button>
        </div>
      </form>`;
    syncEditor();
  }

  /** Lit le formulaire dans S.draft et renvoie la liste des erreurs de saisie. */
  function readForm() {
    const f = editorHost.querySelector('form');
    const d = S.draft;
    const errors = [];
    d.name = f.tname.value.trim();
    if (!S.editingId) d.slug = f.slug.value.trim();
    if (!d.name) errors.push('Donne un nom au thème.');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.slug)) errors.push('Identifiant invalide : lettres minuscules, chiffres et tirets.');
    else if (S.themes.some((t) => t.slug === d.slug && t.id !== S.editingId)) errors.push(`L'identifiant « ${d.slug} » est déjà pris.`);
    if (!d.is_default) {
      d.active = f.active.checked;
      if (f.has_range.checked) {
        d.start_md = `${f.start_m.value}-${f.start_d.value}`;
        d.end_md = `${f.end_m.value}-${f.end_d.value}`;
        if (!isValidMd(d.start_md)) errors.push(`Date de début impossible (${Number(f.start_d.value)} ${MONTHS[Number(f.start_m.value) - 1]}).`);
        if (!isValidMd(d.end_md)) errors.push(`Date de fin impossible (${Number(f.end_d.value)} ${MONTHS[Number(f.end_m.value) - 1]}).`);
      } else { d.start_md = null; d.end_md = null; }
      const p = Number(f.priority.value);
      if (!Number.isInteger(p) || p < 0 || p > 100) errors.push('Priorité : un nombre entier entre 0 et 100.');
      d.priority = Number.isFinite(p) ? Math.round(p) : 0;
    }
    const logo = f.logo_url.value.trim();
    if (logo && !/^https?:\/\//i.test(logo)) errors.push("L'adresse du logo doit commencer par https://");
    d.logo_url = logo || null;
    d.emojis = parseEmojis(f.emojis.value);
    d.effect = THEME_EFFECTS[f.effect.value] ? f.effect.value : 'aucun';
    for (const k of THEME_COLOR_KEYS) {
      const h = f[`h_${k}`].value.trim();
      if (isHex(h)) d.colors[k] = h.toUpperCase();
      else errors.push(`Couleur « ${COLOR_LABELS[k][0]} » invalide (format #RRGGBB).`);
    }
    if (d.effect === 'pluie' && !d.emojis.length) errors.push("L'effet « Pluie d'emojis » a besoin d'au moins un emoji.");
    return errors;
  }

  /**
   * Met à jour tout l'éditeur à partir du formulaire : période, logo, emojis, échantillon, contrastes, erreurs et aperçu en direct.
   * @returns {string[]} Erreurs de saisie.
   */
  function syncEditor() {
    const root = editorHost;
    const f = root.querySelector('form');
    if (!f) return;
    const errors = readForm();
    const d = S.draft;
    // Période
    if (!d.is_default) {
      root.querySelector('[data-el="range"]').hidden = !f.has_range.checked;
      const note = root.querySelector('[data-el="range-note"]');
      if (f.has_range.checked && isValidMd(d.start_md) && isValidMd(d.end_md)) {
        note.textContent = d.start_md > d.end_md ? `Du ${fmtMd(d.start_md)} au ${fmtMd(d.end_md)} de l'année suivante (passe le nouvel an)` : `Du ${fmtMd(d.start_md)} au ${fmtMd(d.end_md)}`;
      } else note.textContent = '';
    }
    // Logo
    root.querySelector('[data-el="logo-preview"]').innerHTML = `<img src="${esc(d.logo_url || new URL('../img/logo-512.webp', import.meta.url).href)}" alt="" data-on-error="text" data-fallback="Image introuvable">`;
    // Emojis
    root.querySelector('[data-el="emoji-preview"]').textContent = d.emojis.length ? `${d.emojis.length} emoji${d.emojis.length > 1 ? 's' : ''} : ${d.emojis.join('  ')}` : '';
    // Échantillon (variables locales, n'affecte pas la page)
    const c = d.colors;
    const sample = root.querySelector('[data-el="sample"]');
    sample.style.cssText = `--s-bg:${c.bg};--s-surface:${c.surface};--s-text:${c.text};--s-muted:${c.muted};--s-accent:${c.accent};--s-hl:${c.highlight};--s-accent-text:${contrast(c.accent, '#ffffff') >= contrast(c.accent, '#121212') ? '#fff' : '#121212'}`;
    // Contrastes
    const warns = [];
    if (contrast(c.text, c.surface) < 4.5) warns.push(`texte sur surface (${contrast(c.text, c.surface).toFixed(1)}:1)`);
    if (contrast(c.text, c.bg) < 4.5) warns.push(`texte sur fond (${contrast(c.text, c.bg).toFixed(1)}:1)`);
    if (contrast(c.muted, c.surface) < 3) warns.push(`texte secondaire sur surface (${contrast(c.muted, c.surface).toFixed(1)}:1)`);
    if (contrast(c.highlight, c.bg) < 3) warns.push(`mise en valeur sur fond (${contrast(c.highlight, c.bg).toFixed(1)}:1)`);
    const w = root.querySelector('[data-el="contrast"]');
    w.hidden = !warns.length;
    w.innerHTML = warns.length ? `${ICON.warn}<span>Contraste faible : ${esc(warns.join(', '))}. Le texte risque d'être difficile à lire.</span>` : '';
    // Erreurs (affichées seulement après une tentative d'enregistrement)
    const errBox = root.querySelector('[data-el="error"]');
    if (!errBox.hidden) { errBox.textContent = errors.join(' '); errBox.hidden = !errors.length; }
    // Aperçu en direct sur la page
    if (S.previewing === d || S.previewing?.__draft) startPreview({ ...d, colors: { ...d.colors }, __draft: true }, d.name || 'nouveau thème');
    return errors;
  }

  // Saisie : le nom remplit l'identifiant (tant qu'il n'a pas été modifié), sélecteur et texte de couleur restent liés.
  editorHost.addEventListener('input', (ev) => {
    const f = ev.target.form;
    if (!f) return;
    const n = ev.target.name;
    if (n === 'tname' && !S.editingId && !S.slugTouched) f.slug.value = slugify(f.tname.value);
    if (n === 'slug') S.slugTouched = true;
    if (n?.startsWith('c_')) f[`h_${n.slice(2)}`].value = ev.target.value.toUpperCase();
    if (n?.startsWith('h_')) {
      let v = ev.target.value.trim();
      if (/^[0-9a-f]{6}$/i.test(v)) v = `#${v}`;
      if (isHex(v)) f[`c_${n.slice(2)}`].value = v.toLowerCase();
    }
    syncEditor();
  });
  editorHost.addEventListener('change', (ev) => { if (ev.target.form) syncEditor(); });
  // Quitter un champ de couleur invalide remet la dernière couleur valide.
  editorHost.addEventListener('focusout', (ev) => {
    if (ev.target.name?.startsWith('h_')) {
      const k = ev.target.name.slice(2);
      ev.target.value = S.draft?.colors[k] ?? ev.target.value;
    }
  });
  editorHost.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-ed]');
    if (!b) return;
    const f = editorHost.querySelector('form');
    const act = b.dataset.ed;
    if (act === 'cancel') closeEditor();
    else if (act === 'preview') {
      const errors = syncEditor().filter((e) => e.includes('Couleur'));
      if (errors.length) { toast(errors[0], 'error'); return; }
      startPreview({ ...S.draft, colors: { ...S.draft.colors }, __draft: true }, S.draft.name || 'nouveau thème');
    } else if (act === 'nologo') { f.logo_url.value = ''; syncEditor(); }
    else if (act === 'upload') uploadLogo(b);
  });

  /**
   * Ouvre le sélecteur de fichier, envoie l'image choisie dans le stockage et l'inscrit comme logo du thème.
   * @param {HTMLButtonElement} btn Bouton « Téléverser une image ».
   */
  async function uploadLogo(btn) {
    const input = editorHost.querySelector('[data-el="file"]');
    input.value = '';
    const file = await new Promise((resolve) => { input.onchange = () => resolve(input.files?.[0] ?? null); input.click(); });
    if (!file) return;
    await busy(btn, async () => {
      if (!EXT[file.type]) throw new Error('Choisis une image (PNG, JPG, WebP, GIF ou SVG).');
      if (file.size > 5 * 1024 * 1024) throw new Error('Image trop lourde (5 Mo maximum).');
      const img = await prepareImage(file);
      const f = editorHost.querySelector('form');
      const slug = slugify(f.slug.value) || 'theme';
      const path = `themes/${slug}-${Date.now()}.${img.ext}`;
      check(await sb.storage.from('hg-assets').upload(path, img.blob, { upsert: true, contentType: img.contentType, cacheControl: '3600' }));
      const { data } = sb.storage.from('hg-assets').getPublicUrl(path);
      f.logo_url.value = data.publicUrl;
      syncEditor();
      toast('Logo téléversé (pense à enregistrer le thème)', 'ok');
    });
  }

  // Entrée dans un champ : même chose que le bouton « Enregistrer » du pied du tiroir
  editorHost.addEventListener('submit', (ev) => { ev.preventDefault(); drawerForm?.requestSubmit(); });

  /** Enregistre le thème en cours d'édition. Renvoie false si une erreur de saisie garde le tiroir ouvert. */
  async function saveTheme() {
    const errBox = editorHost.querySelector('[data-el="error"]');
    errBox.hidden = false;
    const errors = syncEditor();
    if (errors.length) { errBox.focus?.(); return false; }
    const d = S.draft;
    const row = {
      slug: d.slug, name: d.name, logo_url: d.logo_url, emojis: d.emojis, effect: d.effect,
      colors: Object.fromEntries(THEME_COLOR_KEYS.map((k) => [k, d.colors[k]])),
    };
    if (!d.is_default) Object.assign(row, { active: d.active, start_md: d.start_md, end_md: d.end_md, priority: d.priority });
    if (S.editingId) check(await sb.from('hg_themes').update(row).eq('id', S.editingId));
    else check(await sb.from('hg_themes').insert({ ...row, is_default: false }));
    const name = d.name;
    closeEditor();
    await refreshSite();
    renderAll();
    toast(`Thème « ${name} » enregistré`, 'ok');
    return true;
  }

  /* ---------- Cycle ---------- */
  /** Recharge les thèmes et recalcule le thème du site (et son cache local). */
  async function refreshSite() {
    await load();
    await applyTheme({ force: true }); // recalcule le thème du site + met à jour le cache local
  }
  /** Redessine le bloc Mode et la liste. */
  function renderAll() { renderMode(); renderList(); }

  try {
    await load();
    renderAll();
    // Le thème réellement appliqué peut différer si applyTheme a échoué : on se cale sur les données fraîches
    if (getActiveTheme()?.slug !== todayTheme().slug) paintTheme(todayTheme());
  } catch (e) {
    console.error(e);
    el('list').innerHTML = `<div class="empty">Impossible de charger les thèmes : ${esc(errMsg(e))}</div>`;
  }
}
