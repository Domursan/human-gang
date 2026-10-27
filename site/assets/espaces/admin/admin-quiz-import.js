// ===== Humane Gang — administration : import CSV des questions du gang (idée A1) =====
// Rôle : tiroir « Importer un fichier » de Jeux et cartes › Questions du gang. Lit un fichier .csv (séparateur ; ou ,
// UTF-8 ou Windows-1252, export Google Sheets ou Excel), le découpe sans bibliothèque (guillemets, BOM, retours à la ligne
// dans une cellule), prépare chaque ligne au format de hg_quiz_save, puis demande à la base un contrôle à blanc
// (hg_quiz_import, p_dry_run = true) : chaque ligne reçoit une pastille « Prête », « Doublon » ou « Erreur » avec la raison.
// On décoche des lignes, on fixe une catégorie ou une date de début pour tout le lot (« 1 question par jour » répartit les
// dates), puis « Importer N questions » enregistre le lot en une fois (tout ou rien, migration 092).
// Colonnes : question ; type ; difficulte ; categorie ; choix ; reponse ; explication ; recompense ; debut ; fin.
// Les choix sont séparés par « | » ; la réponse donne la ou les lettres (a, b…) ou le texte des bons choix, « vrai » ou
// « faux », un nombre avec tolérance (« 26±1 »), ou les réponses écrites acceptées séparées par « | » (« manuel » : à la main).
// La clé de réponse part dans hg_quiz_import puis hg_quiz_keys : elle n'est jamais mise dans les choix visibles des membres.
// Dépendances : core.js (sb, esc, toast, errMsg), admin-events.js (heure suisse), admin/ui/drawer.js (tiroir).
// Exporte : openQuizImport({ onDone }), appelé par admin-quiz.js.
import { sb, esc, toast, errMsg } from './core.js';
import { toZurichInput, fromZurichInput } from './admin-events.js';
import { openDrawer } from './admin/ui/drawer.js';

/* ---------- Constantes ---------- */
// Limites du fichier (les mêmes côté base pour le nombre de lignes).
const MAX_ROWS = 300;
const MAX_BYTES = 1024 * 1024;
// Colonnes attendues, dans l'ordre du modèle.
const COLS = ['question', 'type', 'difficulte', 'categorie', 'choix', 'reponse', 'explication', 'recompense', 'debut', 'fin'];
// Autres noms acceptés pour une colonne (en-têtes normalisés : minuscules, sans accents).
const ALIAS = { enonce: 'question', intitule: 'question', difficulty: 'difficulte', categorie_: 'categorie', category: 'categorie',
  choices: 'choix', options: 'choix', reponses: 'reponse', bonne_reponse: 'reponse', answer: 'reponse', explanation: 'explication',
  recompenses: 'recompense', paillettes: 'recompense', reward: 'recompense', start: 'debut', fin_: 'fin', end: 'fin' };
// Types : nom normalisé → valeur en base ; libellés affichés.
const TYPE_IN = { choix_unique: 'choix_unique', unique: 'choix_unique', qcm: 'choix_unique', choix_multiple: 'choix_multiple',
  multiple: 'choix_multiple', vrai_faux: 'vrai_faux', vrai_ou_faux: 'vrai_faux', vf: 'vrai_faux', texte: 'texte',
  reponse_ecrite: 'texte', ecrite: 'texte', libre: 'texte', nombre: 'nombre', numerique: 'nombre' };
const TYPE_LABEL = { choix_unique: 'Choix unique', choix_multiple: 'Choix multiple', vrai_faux: 'Vrai ou faux', texte: 'Réponse écrite', nombre: 'Nombre' };
const DIFFS = ['facile', 'moyen', 'difficile', 'expert'];
const CHOICE_IDS = 'abcdefghij';
// Pastilles d'état.
const STATE = { pret: ['Prête', 'qi-ok'], doublon: ['Doublon', 'qi-dup'], erreur: ['Erreur', 'qi-err'] };
// Modèle et exemple téléchargeables (séparateur « ; », comme un export Excel français).
const HEAD_LINE = COLS.join(';');
const EXEMPLE = [
  HEAD_LINE,
  'Quel pays imaginaire est né d’un Worldle ?;Réponse écrite;facile;Le gang;;Tzatzikistan|Le Tzatzikistan;Né d’une partie de Worldle ratée en 2022.;50;;',
  'Comment s’appelle la voiture de Domursan ?;Choix unique;moyen;Le gang;La Domu-mobile|La Batmobile|La Gang-mobile;a;;100;;',
  '« Le livre est mieux » : vrai ou faux, c’est une blague du gang ?;Vrai ou faux;facile;Le gang;;vrai;On la ressort après chaque ciné du dimanche.;;;',
  'Combien de Worldle ont été collés sur le Discord ?;Nombre;difficile;Le gang;;130±10;;250;;',
  'Quels jeux du jour se jouent le matin sur le serveur ?;Choix multiple;moyen;Jeux;Worldle|Sutom|Fortnite|Cémantix;a|b|d;;;;',
].join('\r\n') + '\r\n';

/* ---------- Outils ---------- */
/** Texte sans accents, en minuscules, mots reliés par « _ » (en-têtes, types, réponses). */
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
/** Nombre en français (espace insécable pour les milliers). */
const nf = (n) => new Intl.NumberFormat('fr-CH').format(n);
/** Pluriel simple. */
const pl = (n, one, many) => `${nf(n)} ${n > 1 ? many : one}`;

/**
 * Découpe un texte CSV (RFC 4180 : guillemets doublés, séparateur et retours à la ligne entre guillemets).
 * @param {string} text Contenu du fichier, sans BOM.
 * @param {string} sep Séparateur (« ; » ou « , »).
 * @returns {{cells: string[], line: number}[]} Lignes non vides, avec leur numéro de ligne dans le fichier (1 = en-tête).
 */
export function parseCsv(text, sep) {
  const rows = [];
  let row = [], cell = '', quoted = false, line = 1, start = 1;
  const push = () => { row.push(cell); cell = ''; };
  const end = () => { push(); if (row.some((c) => c.trim() !== '')) rows.push({ cells: row, line: start }); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else { if (ch === '\n') line++; cell += ch; }
    } else if (ch === '"' && cell.trim() === '') { quoted = true; cell = ''; }
    else if (ch === sep) push();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      end(); line++; start = line;
    } else cell += ch;
  }
  if (cell !== '' || row.length) end();
  return rows;
}

/** Séparateur probable : celui qui revient le plus dans la première ligne (hors guillemets). */
export function guessSep(text) {
  const first = (text.split(/\r?\n/, 1)[0] || '').replace(/"[^"]*"/g, '');
  return (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
}

/**
 * Date du fichier → ISO, heure suisse. Formats : AAAA-MM-JJ, JJ/MM/AAAA ou JJ.MM.AAAA, avec HH:MM facultatif (08:00 sinon).
 * @returns {string|null|undefined} ISO, null si vide, undefined si illisible.
 */
function parseDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let y, mo, d, h = '08', mi = '00';
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2})[:h](\d{2}))?$/);
  const fr = iso ? null : s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:[ T](\d{1,2})[:h](\d{2}))?$/);
  if (iso) [, y, mo, d] = iso;
  else if (fr) [, d, mo, y] = fr;
  else return undefined;
  const m = iso || fr;
  if (m[4]) { h = m[4]; mi = m[5]; }
  const p2 = (x) => String(x).padStart(2, '0');
  return fromZurichInput(`${y}-${p2(mo)}-${p2(d)}T${p2(h)}:${mi}`) || undefined;
}

/**
 * Transforme une ligne du fichier en question au format de hg_quiz_import.
 * Une erreur de lecture (type inconnu, réponse hors des choix…) est mise dans `error`, avec la raison en clair.
 * @param {Record<string, string>} c Cellules par nom de colonne.
 * @param {number} line Numéro de ligne dans le fichier.
 * @returns {{q: object, view: {type: string, answer: string}}}
 */
export function rowToQuestion(c, line) {
  const q = { line, prompt: (c.question || '').trim(), difficulty: norm(c.difficulte) || 'moyen', category: (c.categorie || '').trim(),
    explanation: (c.explication || '').trim(), reward: (c.recompense || '').trim().replace(/[\s  ]/g, ''), options: [], key: {} };
  const view = { type: c.type || '', answer: (c.reponse || '').trim() };
  const fail = (msg) => { q.error = msg; return { q, view }; };
  const t = TYPE_IN[norm(c.type)] || (c.type ? null : ((c.choix || '').includes('|') ? 'choix_unique' : 'texte'));
  if (!t) return fail(`type « ${String(c.type).slice(0, 30)} » inconnu (choix unique, choix multiple, vrai ou faux, réponse écrite, nombre)`);
  q.qtype = t;
  view.type = TYPE_LABEL[t];
  const rep = (c.reponse || '').trim();
  const start = parseDate(c.debut), end = parseDate(c.fin);
  if (start === undefined) return fail(`date de début « ${String(c.debut).slice(0, 20)} » illisible (AAAA-MM-JJ HH:MM ou JJ.MM.AAAA)`);
  if (end === undefined) return fail(`date de fin « ${String(c.fin).slice(0, 20)} » illisible`);
  q.starts_at = start; q.ends_at = end;
  if (q.difficulty && !DIFFS.includes(q.difficulty)) return fail(`difficulté « ${String(c.difficulte).slice(0, 20)} » inconnue (facile, moyen, difficile ou expert)`);
  if (t === 'choix_unique' || t === 'choix_multiple') {
    const texts = (c.choix || '').split('|').map((x) => x.trim()).filter(Boolean);
    if (texts.length < 2 || texts.length > 10) return fail('il faut entre 2 et 10 choix, séparés par « | »');
    q.options = texts.map((text, i) => ({ id: CHOICE_IDS[i], text }));
    const ids = q.options.map((o) => o.id);
    const wanted = rep.split(/[|,]/).map((x) => x.trim()).filter(Boolean);
    if (!wanted.length) return fail('la réponse est vide');
    const correct = [];
    for (const w of wanted) {
      const byId = /^[a-j]$/i.test(w) ? w.toLowerCase() : null;
      const byText = q.options.find((o) => norm(o.text) === norm(w))?.id;
      const id = byId && ids.includes(byId) ? byId : byText;
      if (!id) return fail(`la réponse « ${w.slice(0, 30)} » n’est pas dans les choix (${ids.join(', ')})`);
      if (!correct.includes(id)) correct.push(id);
    }
    if (t === 'choix_unique' && correct.length !== 1) return fail('une seule bonne réponse pour un choix unique');
    q.key = { correct };
    view.answer = correct.join(' | ');
  } else if (t === 'vrai_faux') {
    const v = norm(rep);
    const val = ['vrai', 'v', 'true', 'oui'].includes(v) ? 'vrai' : ['faux', 'f', 'false', 'non'].includes(v) ? 'faux' : null;
    if (!val) return fail('la réponse doit être « vrai » ou « faux »');
    q.key = { correct: [val] };
    view.answer = val;
  } else if (t === 'nombre') {
    const m = rep.replace(/[\s  ]/g, '').replace(/,/g, '.').match(/^(-?\d+(?:\.\d+)?)(?:(?:±|\+-|\+\/-)(\d+(?:\.\d+)?))?$/);
    if (!m) return fail('la réponse doit être un nombre, avec une tolérance facultative (26±1)');
    q.key = { value: Number(m[1]), tolerance: m[2] ? Number(m[2]) : 0 };
    view.answer = m[2] ? `${m[1]} ± ${m[2]}` : m[1];
  } else {
    const manual = ['manuel', 'a_la_main', 'manuelle'].includes(norm(rep));
    const accepted = manual ? [] : rep.split('|').map((x) => x.trim()).filter(Boolean);
    if (!manual && !accepted.length) return fail('donne au moins une réponse acceptée (séparées par « | »), ou « manuel »');
    q.key = { accepted, manual };
    view.answer = manual ? 'à la main' : accepted.join(' | ');
  }
  return { q, view };
}

/**
 * Lit le contenu du fichier : en-tête, puis une question par ligne.
 * @param {string} text Contenu décodé.
 * @returns {{rows: {q: object, view: object}[], sep: string, error?: string}}
 */
export function readFile(text) {
  const clean = text.replace(/^﻿/, '');
  const sep = guessSep(clean);
  const all = parseCsv(clean, sep);
  if (!all.length) return { rows: [], sep, error: 'Le fichier est vide.' };
  const head = all[0].cells.map((h) => { const n = norm(h); return ALIAS[n] || n; });
  if (!head.includes('question')) return { rows: [], sep, error: 'Colonne « question » introuvable : pars du modèle CSV (première ligne = noms des colonnes).' };
  const data = all.slice(1);
  if (data.length > MAX_ROWS) return { rows: [], sep, error: `${nf(data.length)} lignes : ${MAX_ROWS} au plus par fichier. Coupe-le en plusieurs fichiers.` };
  if (!data.length) return { rows: [], sep, error: 'Le fichier ne contient que la ligne des colonnes.' };
  const rows = data.map(({ cells, line }) => {
    const c = {};
    head.forEach((h, i) => { if (COLS.includes(h)) c[h] = cells[i] ?? ''; });
    return rowToQuestion(c, line);
  });
  return { rows, sep };
}

/** Propose un fichier à enregistrer (modèle ou exemple). */
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ---------- Tiroir ---------- */
/**
 * Ouvre le tiroir d'import.
 * @param {{onDone?: () => any}} opts onDone : appelé après un import réussi (rechargement de la liste).
 */
export function openQuizImport({ onDone } = {}) {
  // État du tiroir : fichier lu, lignes préparées, rapport de la base, lignes cochées, réglages du lot.
  const st = { name: '', bytes: null, encoding: 'utf-8', sep: ';', rows: [], report: new Map(), checked: new Set(),
    lot: { category: '', start: '', daily: false }, seq: 0, timer: 0, busy: false };
  const d = openDrawer({
    title: 'Importer un fichier',
    subtitle: 'Questions du gang · fichier .csv (séparateur ; ou ,), 300 lignes et 1 Mo au plus',
    wide: true,
    submitLabel: 'Importer',
    body: `<div class="qi">
      <div class="qi-file" id="qi-file">
        <label class="qi-drop" for="qi-input">
          <span class="qi-drop-t">Choisis un fichier .csv</span>
          <span class="small muted">ou dépose-le ici · export Google Sheets ou Excel</span>
        </label>
        <input id="qi-input" class="qi-input" type="file" accept=".csv,text/csv">
        <div class="btn-row qi-models">
          <button class="btn btn-ghost btn-sm" type="button" data-qi="model">Modèle CSV</button>
          <button class="btn btn-ghost btn-sm" type="button" data-qi="example">Exemple rempli</button>
        </div>
      </div>
      <p class="qi-help small muted">Colonnes : <code>${COLS.join(' ; ')}</code>. Choix séparés par « | » ; réponse : lettre(s) ou texte des bons choix, « vrai » / « faux », un nombre (« 26±1 ») ou les réponses écrites acceptées.</p>
      <div id="qi-alert" class="qi-alert" role="alert" hidden></div>
      <div id="qi-result" hidden>
        <div class="qi-stats" aria-live="polite">
          <p class="qi-stat qi-stat-ok"><b id="qi-n-ok">0</b><span>prêtes</span></p>
          <p class="qi-stat qi-stat-dup"><b id="qi-n-dup">0</b><span>doublons</span></p>
          <p class="qi-stat qi-stat-err"><b id="qi-n-err">0</b><span>erreurs</span></p>
        </div>
        <fieldset class="qi-lot">
          <legend>Pour tout le lot</legend>
          <div class="field"><label for="qi-cat">Catégorie (vide : celle du fichier)</label><input id="qi-cat" type="text" maxlength="40" autocomplete="off"></div>
          <div class="field"><label for="qi-start">Début (heure suisse ; vide : celui du fichier)</label><input id="qi-start" type="datetime-local"></div>
          <label class="qi-daily"><input id="qi-daily" type="checkbox"> 1 question par jour</label>
        </fieldset>
        <div class="qi-head small muted" aria-hidden="true"><span></span><span>L.</span><span>Question</span><span class="qi-col-type">Type</span><span class="qi-col-rep">Réponse</span><span>État</span></div>
        <ul class="qi-rows" id="qi-rows" aria-label="Lignes du fichier"></ul>
      </div>
      <p class="qi-note small muted">Contrôle fait par la base, rien n’est encore enregistré.</p>
    </div>`,
    onSubmit: () => submit(),
  });
  d.el.classList.add('qi-drawer');
  const f = d.form;
  const $q = (s) => f.querySelector(s);
  const submitBtn = f.querySelector('[data-drawer-submit]');
  submitBtn.disabled = true;

  /** Affiche (ou cache) le message d'alerte, avec un bouton facultatif. */
  const alert = (html) => { const a = $q('#qi-alert'); a.innerHTML = html || ''; a.hidden = !html; };

  /** Décode le fichier selon st.encoding ; une erreur d'UTF-8 propose Windows-1252. */
  async function decodeAndRead() {
    alert('');
    let text;
    try {
      text = new TextDecoder(st.encoding, { fatal: st.encoding === 'utf-8' }).decode(st.bytes);
    } catch {
      st.rows = []; render();
      alert(`<p>Ce fichier n’est pas en UTF-8 : les accents seraient cassés (export Excel ?).</p>
        <button class="btn btn-ghost btn-sm" type="button" data-qi="cp1252">Réessayer en Windows-1252</button>`);
      return;
    }
    const res = readFile(text);
    st.sep = res.sep;
    if (res.error) { st.rows = []; render(); alert(`<p>${esc(res.error)}</p>`); return; }
    st.rows = res.rows;
    st.report = new Map();
    st.checked = new Set();
    await check(true);
  }

  /** Lignes à envoyer, avec les réglages du lot appliqués (catégorie, début commun, une par jour). */
  function prepared(rows) {
    const base = st.lot.start ? new Date(fromZurichInput(st.lot.start)) : null;
    return rows.map(({ q }, i) => {
      const out = { ...q };
      if (st.lot.category.trim()) out.category = st.lot.category.trim();
      if (base && !Number.isNaN(base.getTime())) out.starts_at = new Date(base.getTime() + (st.lot.daily ? i * 864e5 : 0)).toISOString();
      return out;
    });
  }

  /** Contrôle à blanc par la base ; first : les lignes prêtes sont cochées. */
  async function check(first = false) {
    const seq = ++st.seq;
    $q('#qi-result').hidden = false;
    $q('#qi-rows').innerHTML = '<li class="empty">Contrôle des lignes par la base…</li>';
    submitBtn.disabled = true;
    try {
      const { data, error } = await sb.rpc('hg_quiz_import', { p_rows: prepared(st.rows), p_dry_run: true });
      if (error) throw error;
      if (seq !== st.seq) return; // une vérification plus récente est partie
      st.report = new Map((data?.rows || []).map((r) => [r.line, r]));
      if (first) for (const { q } of st.rows) if (st.report.get(q.line)?.status === 'pret') st.checked.add(q.line);
      for (const line of [...st.checked]) if (st.report.get(line)?.status === 'erreur') st.checked.delete(line);
      render();
    } catch (e) {
      if (seq !== st.seq) return;
      $q('#qi-rows').innerHTML = `<li class="empty">Contrôle impossible : ${esc(errMsg(e))}</li>`;
    }
  }

  /** Redessine le résumé du fichier, les compteurs, les lignes et le bouton d'import. */
  function render() {
    const fileBox = $q('#qi-file');
    if (st.name) {
      fileBox.classList.add('is-loaded');
      fileBox.querySelector('.qi-drop-t').textContent = st.name;
      fileBox.querySelector('.qi-drop .small').textContent = `${pl(st.rows.length, 'ligne', 'lignes')} · séparateur « ${st.sep} » · ${st.encoding === 'utf-8' ? 'UTF-8' : 'Windows-1252'} · changer de fichier`;
    }
    $q('#qi-result').hidden = !st.rows.length;
    const counts = { pret: 0, doublon: 0, erreur: 0 };
    for (const r of st.report.values()) counts[r.status] = (counts[r.status] || 0) + 1;
    $q('#qi-n-ok').textContent = nf(counts.pret);
    $q('#qi-n-dup').textContent = nf(counts.doublon);
    $q('#qi-n-err').textContent = nf(counts.erreur);
    $q('#qi-rows').innerHTML = st.rows.map(({ q, view }) => {
      const r = st.report.get(q.line) || { status: q.error ? 'erreur' : 'pret', error: q.error };
      const [label, cls] = STATE[r.status] || STATE.erreur;
      const err = r.status === 'erreur';
      const id = `qi-c-${q.line}`;
      const note = err ? `ligne ${q.line} : ${r.error || 'erreur'}`
        : r.status === 'doublon' ? `Proche de « ${r.similar_to || ''} » (${r.similarity ?? 100} %)` : '';
      return `<li class="qi-row${err ? ' is-err' : ''}">
        <span class="qi-check"><input type="checkbox" id="${id}" data-line="${q.line}"${st.checked.has(q.line) ? ' checked' : ''}${err ? ' disabled' : ''}
          aria-label="Importer la ligne ${q.line}"></span>
        <span class="qi-line">${q.line}</span>
        <label class="qi-q" for="${id}"><span>${esc(q.prompt || '(question vide)')}</span>
          ${note ? `<span class="qi-why ${cls}-t">${esc(note)}</span>` : ''}
          ${r.warning ? `<span class="qi-why qi-dup-t">${esc(r.warning)}</span>` : ''}
          <span class="qi-meta small muted">${esc(view.type)}${view.answer ? ` · ${esc(view.answer)}` : ''}</span></label>
        <span class="qi-col-type small muted">${esc(view.type)}</span>
        <span class="qi-col-rep small">${esc(view.answer)}</span>
        <span class="qi-state"><span class="qi-pill ${cls}">${label}</span></span>
      </li>`;
    }).join('');
    const n = st.rows.filter(({ q }) => st.checked.has(q.line)).length;
    submitBtn.textContent = n ? `Importer ${pl(n, 'question', 'questions')}` : 'Importer';
    submitBtn.disabled = !n || st.busy;
  }

  /** Charge le fichier choisi (taille et extension vérifiées). */
  async function loadFile(file) {
    if (!file) return;
    if (file.size > MAX_BYTES) { alert('<p>Fichier trop lourd : 1 Mo au plus.</p>'); return; }
    if (!/\.csv$/i.test(file.name) && file.type && !/csv|text\/plain|excel/.test(file.type)) { alert('<p>Choisis un fichier .csv.</p>'); return; }
    st.name = file.name;
    st.bytes = new Uint8Array(await file.arrayBuffer());
    st.encoding = 'utf-8';
    await decodeAndRead();
  }

  /** Import réel des lignes cochées (tout ou rien). */
  async function submit() {
    const chosen = st.rows.filter(({ q }) => st.checked.has(q.line));
    if (!chosen.length) return false;
    st.busy = true;
    try {
      const { data, error } = await sb.rpc('hg_quiz_import', { p_rows: prepared(chosen), p_dry_run: false });
      if (error) throw error;
      toast(`${pl(data?.created ?? chosen.length, 'question importée', 'questions importées')}.`, 'ok');
      await onDone?.();
      return true;
    } catch (e) {
      alert(`<p>Import impossible, rien n’est enregistré : ${esc(errMsg(e))}</p>`);
      return false;
    } finally {
      st.busy = false;
    }
  }

  // Écouteurs du tiroir
  f.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'qi-input') { loadFile(t.files?.[0]); return; }
    if (t.dataset.line) {
      const line = Number(t.dataset.line);
      if (t.checked) st.checked.add(line); else st.checked.delete(line);
      render();
      return;
    }
    if (t.id === 'qi-daily' || t.id === 'qi-start' || t.id === 'qi-cat') {
      st.lot = { category: $q('#qi-cat').value, start: $q('#qi-start').value, daily: $q('#qi-daily').checked };
      if (t.id === 'qi-daily' && st.lot.daily && !st.lot.start) {
        // « 1 question par jour » sans début : demain, 08:00 (heure suisse).
        const tomorrow = new Date(Date.now() + 864e5);
        $q('#qi-start').value = toZurichInput(tomorrow.toISOString()).slice(0, 11) + '08:00';
        st.lot.start = $q('#qi-start').value;
      }
      if (st.rows.length) { clearTimeout(st.timer); st.timer = setTimeout(() => check(), 300); }
    }
  });
  f.addEventListener('click', (e) => {
    const b = e.target.closest('[data-qi]');
    if (!b) return;
    if (b.dataset.qi === 'model') download('questions-modele.csv', HEAD_LINE + '\r\n');
    else if (b.dataset.qi === 'example') download('questions-exemple.csv', EXEMPLE);
    else if (b.dataset.qi === 'cp1252') { st.encoding = 'windows-1252'; decodeAndRead(); }
  });
  // Glisser-déposer sur la zone du fichier
  const drop = $q('.qi-drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); loadFile(e.dataTransfer?.files?.[0]); });
  return d;
}
