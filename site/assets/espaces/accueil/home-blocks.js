// ===== Humane Gang — accueil personnalisable : disposition des blocs (idée P9, /pages/compte/accueil.html) =====
// Applique la disposition du membre au squelette rendu par accueil.js (renderMemberShell) : ordre des blocs, blocs masqués
// (retirés avant tout chargement : seuls les blocs visibles font leur appel), blocs ajoutés par ce module (quêtes,
// quotidien des cartes, quiz, semaine d'accueil du parrainage P8), bouton « Personnaliser » et rappel des blocs masqués.
// Les tuiles qui se suivent sont regroupées dans une grille ; deux blocs « row » qui se suivent partagent une rangée.
// Disposition : table hg_home_layout (la sienne, référence) + copie locale (localStorage hg_home_layout) pour un affichage
// immédiat ; défaut et blocs obligatoires : hg_settings.home_default (Staff « reglages »). Migration 091.
// Dépendances : core.js, home-registry.js, home-edit.js (chargé au clic), home-mentor.js (bloc parrainage).
// Exporte : applyHomeLayout(app, me), resolveLayout(available, saved, def), LS_KEY.
import { sb, esc, $, errMsg, toast, canAccess } from '../../commun/core.js';
import { HOME_BLOCKS, HOME_DEFAULT } from './home-registry.js';

/** Clé de la copie locale de la disposition. */
export const LS_KEY = 'hg_home_layout';
/** Délai maximal d'attente de la base avant d'afficher avec la copie locale (ms). */
const WAIT_MS = 1500;

/* ---------- Lecture et écriture ---------- */
/** Copie locale de la disposition (seulement si elle appartient au membre connecté). */
function readLocal(uid) {
  try { const v = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); return v && v.uid === uid && Array.isArray(v.blocks) ? v.blocks : null; } catch { return null; }
}
/** Enregistre la copie locale (erreur de stockage ignorée). */
function writeLocal(uid, blocks) { try { localStorage.setItem(LS_KEY, JSON.stringify({ uid, blocks })); } catch { /* stockage indisponible */ } }
/** Promesse qui se résout en `fallback` au bout de ms millisecondes. */
const timeout = (ms, fallback) => new Promise((r) => setTimeout(() => r(fallback), ms));
/** Nettoie une liste de blocs venue de la base ou du stockage : [{ id, on }] sans doublon, 30 au plus. */
function cleanBlocks(list) {
  const seen = new Set(), out = [];
  for (const b of Array.isArray(list) ? list : []) {
    const id = String(b?.id || '');
    if (!/^[a-z][a-z0-9_-]{1,29}$/.test(id) || seen.has(id)) continue;
    seen.add(id); out.push({ id, on: b.on !== false });
    if (out.length >= 30) break;
  }
  return out;
}

/**
 * Lit le défaut du site et la disposition du membre (base, avec repli sur la copie locale si la base tarde ou échoue).
 * @returns {Promise<{def: {ordre: string[], obligatoires: string[]}, saved: {id: string, on: boolean}[]|null}>}
 */
async function readConfig(uid) {
  const local = readLocal(uid);
  const defP = sb.from('hg_settings').select('value').eq('key', 'home_default').maybeSingle()
    .then(({ data, error }) => (error || !data?.value ? null : data.value)).catch(() => null);
  const mineP = sb.from('hg_home_layout').select('blocks').eq('user_id', uid).maybeSingle()
    .then(({ data, error }) => (error ? undefined : (data ? data.blocks : null))).catch(() => undefined);
  const [defV, mine] = await Promise.race([Promise.all([defP, mineP]), timeout(WAIT_MS, [null, undefined])]);
  const def = {
    ordre: Array.isArray(defV?.ordre) ? defV.ordre.map(String) : HOME_DEFAULT.ordre,
    obligatoires: Array.isArray(defV?.obligatoires) ? defV.obligatoires.map(String) : HOME_DEFAULT.obligatoires,
  };
  // undefined : base injoignable → copie locale ; null : pas encore de disposition en base
  let saved = mine === undefined ? local : (mine ? cleanBlocks(mine) : null);
  if (mine !== undefined) { if (saved) writeLocal(uid, saved); else try { localStorage.removeItem(LS_KEY); } catch { /* rien */ } }
  if (saved && !saved.length) saved = null;
  return { def, saved };
}

/**
 * Enregistre la disposition (base + copie locale).
 * @param {string} uid membre connecté
 * @param {{id: string, on: boolean}[]} blocks disposition complète
 */
export async function saveLayout(uid, blocks) {
  const clean = cleanBlocks(blocks);
  writeLocal(uid, clean);
  const { error } = await sb.from('hg_home_layout').upsert({ user_id: uid, blocks: clean }, { onConflict: 'user_id' });
  if (error) throw error;
}
/** Revient à l'accueil d'origine : la ligne du membre est retirée (le défaut du site s'applique). */
export async function resetLayout(uid) {
  try { localStorage.removeItem(LS_KEY); } catch { /* rien */ }
  const { error } = await sb.from('hg_home_layout').delete().eq('user_id', uid);
  if (error) throw error;
}

/* ---------- Calcul de la disposition ---------- */
/**
 * Disposition effective. Sans disposition enregistrée : les blocs du défaut, dans son ordre, les autres en réserve.
 * Avec : son ordre ; un bloc du défaut qu'elle ne connaît pas encore arrive à la fin, affiché, avec l'étiquette « Nouveau ».
 * Les blocs obligatoires sont toujours affichés. Les identifiants inconnus sont ignorés.
 * @param {{id: string, required?: boolean}[]} available blocs présents sur la page (droits compris)
 * @param {{id: string, on: boolean}[]|null} saved disposition du membre
 * @param {{ordre: string[], obligatoires: string[]}} def défaut du site
 * @returns {{id: string, on: boolean, isNew: boolean, required: boolean, placed: boolean}[]} tous les blocs disponibles, dans l'ordre
 */
export function resolveLayout(available, saved, def) {
  const byId = new Map(available.map((b) => [b.id, b]));
  const req = (id) => !!byId.get(id)?.required || def.obligatoires.includes(id);
  const out = [], seen = new Set();
  // placed : le bloc fait partie de l'accueil (affiché ou masqué par le membre) ; sinon il attend dans la réserve
  const push = (id, on, isNew = false, placed = true) => {
    if (!byId.has(id) || seen.has(id)) return;
    seen.add(id); out.push({ id, on: on || req(id), isNew, required: req(id), placed: placed || req(id) });
  };
  if (saved) {
    for (const b of saved) push(b.id, b.on);
    for (const id of def.ordre) push(id, true, true);
  } else {
    for (const id of def.ordre) push(id, true);
  }
  for (const b of available) push(b.id, req(b.id), false, false); // le reste : en réserve, sauf les obligatoires
  // Les blocs automatiques (semaine d'accueil) restent juste après les bandeaux, quelle que soit la disposition
  const autos = out.filter((x) => byId.get(x.id)?.auto);
  const rest = out.filter((x) => !byId.get(x.id)?.auto);
  const at = rest.findIndex((x) => x.id === 'evenement') + 1;
  rest.splice(at, 0, ...autos);
  return rest;
}

/* ---------- Blocs rendus par ce module ---------- */
/** Squelette d'un bloc de ce module. */
const ownShell = (id, title) => `<h2 class="card-title">${esc(title)}</h2><div class="home-own-body" data-own-body="${esc(id)}"><span class="skeleton"></span><span class="skeleton short"></span></div>`;
/** Message discret d'erreur de chargement. */
const fail = (e) => `<p class="small muted">Impossible de charger ces infos (${esc(errMsg(e))}).</p>`;

/** Quêtes de la semaine : progression et prochaines quêtes à terminer. */
async function loadQuests(box) {
  try {
    const { data, error } = await sb.rpc('hg_card_quests_me');
    if (error) throw error;
    const list = Array.isArray(data?.quests) ? data.quests : [];
    if (!list.length) { box.innerHTML = '<p class="small muted">Pas de quête cette semaine.</p>'; return; }
    const done = list.filter((q) => q.done).length;
    const todo = list.filter((q) => !q.done).slice(0, 3);
    const pct = Math.round((done / list.length) * 100);
    box.innerHTML = `
      <p class="home-own-main"><strong>${done} sur ${list.length}</strong> terminées</p>
      <div class="progress" role="progressbar" aria-label="Quêtes de la semaine" aria-valuemin="0" aria-valuemax="${list.length}" aria-valuenow="${done}"><span style="width:${pct}%"></span></div>
      ${todo.length ? `<ul class="home-own-list">${todo.map((q) => `<li>${esc(q.label)} <span class="small muted">${esc(String(Math.min(Number(q.progress) || 0, Number(q.target) || 0)))} / ${esc(String(q.target))}</span></li>`).join('')}</ul>` : '<p class="small muted">Toutes faites, bravo !</p>'}
      <a class="btn btn-ghost home-own-go" href="/pages/cartes/cartes.html#ouverture">Voir les quêtes</a>`;
  } catch (e) { box.innerHTML = fail(e); }
}

/** Quotidien des cartes : Paillettes, passage du jour (récupérable ici) et booster gratuit. */
async function loadDaily(box) {
  try {
    const { data, error } = await sb.rpc('hg_cards_me');
    if (error) throw error;
    const s = data || {};
    const nf = new Intl.NumberFormat('fr-CH');
    const freeAt = s.free_booster_at ? new Date(s.free_booster_at) : null;
    const freeTxt = !freeAt || freeAt <= new Date() ? 'Booster gratuit disponible'
      : `Booster gratuit à ${new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit' }).format(freeAt)}`;
    box.innerHTML = `
      <p class="home-own-main"><strong>${esc(nf.format(Number(s.paillettes) || 0))}</strong> Paillettes${Number(s.daily_streak) > 1 ? ` · série de ${esc(String(s.daily_streak))} jours` : ''}</p>
      <p class="small muted">${esc(freeTxt)}</p>
      <div class="btn-row">
        ${s.daily_available ? '<button class="btn btn-sand" type="button" data-daily>Récupérer le passage du jour</button>' : '<span class="pill pill-ok">Passage du jour récupéré</span>'}
        <a class="btn btn-ghost" href="/pages/cartes/cartes.html#ouverture">Ouvrir les cartes</a>
      </div>`;
    box.querySelector('[data-daily]')?.addEventListener('click', async (ev) => {
      ev.currentTarget.disabled = true;
      const { data: r, error: err } = await sb.rpc('hg_cards_daily');
      if (err) { toast(errMsg(err), 'error'); ev.currentTarget.disabled = false; return; }
      toast(`+${nf.format(Number(r?.gain) || 0)} Paillettes`, 'ok');
      loadDaily(box);
    });
  } catch (e) { box.innerHTML = fail(e); }
}

/** Questions du gang : invitation à jouer. */
function loadQuiz(box) {
  box.innerHTML = `<p class="small muted">Teste ce que tu sais du gang et gagne des Paillettes.</p>
    <a class="btn btn-ghost home-own-go" href="/pages/jeux/quiz.html">Jouer au quiz</a>`;
}

/** Chargeurs des blocs de ce module. */
const OWN = {
  quetes: { title: 'Quêtes de la semaine', load: loadQuests },
  quotidien: { title: 'Quotidien des cartes', load: loadDaily },
  quiz: { title: 'Questions du gang', load: loadQuiz },
  parrainage: { title: 'Semaine d’accueil', load: (box, ctx) => import('./home-mentor.js').then((m) => m.loadMentorBlock(box, ctx)) },
};

/* ---------- Mise en page ---------- */
/**
 * Range les blocs après l'en-tête de l'accueil, dans l'ordre de la disposition, et retire les blocs masqués.
 * @param {HTMLElement} app conteneur de la page
 * @param {object} st état (blocks : Map id → { meta, els }, layout)
 */
function arrange(app, st) {
  const head = app.querySelector('.home-head');
  const frag = document.createDocumentFragment();
  let group = null, groupKind = null;
  const close = () => { if (group) frag.append(group); group = null; groupKind = null; };
  for (const item of st.layout) {
    const b = st.blocks.get(item.id);
    if (!b) continue;
    if (!item.on) { b.els.forEach((el) => el.remove()); continue; }
    const kind = b.meta.kind || 'full';
    if (kind === 'tile' || kind === 'row') {
      if (groupKind !== kind || (kind === 'row' && group.children.length >= 2)) {
        close();
        group = document.createElement('section');
        group.className = kind === 'tile' ? 'grid home-tiles' : 'row home-row';
        if (kind === 'tile') group.setAttribute('aria-label', 'Rubriques');
        groupKind = kind;
      }
      b.els.forEach((el) => group.append(el));
    } else {
      close();
      b.els.forEach((el) => frag.append(el));
    }
  }
  close();
  // Anciens conteneurs vidés (grille des tuiles, rangée fil + anniversaires) : retirés
  app.querySelectorAll('.home-tiles, .home-row').forEach((c) => { if (!c.children.length) c.remove(); });
  head.after(frag);
  // Rappel discret des blocs masqués, en bas de page
  app.querySelector('.home-hidden-note')?.remove();
  const off = st.layout.filter((x) => x.placed && !x.on && !st.blocks.get(x.id)?.meta.auto).length;
  if (off && st.saved) {
    const p = document.createElement('p');
    p.className = 'small muted home-hidden-note';
    p.innerHTML = `${off} bloc${off > 1 ? 's' : ''} masqué${off > 1 ? 's' : ''} sur ton accueil · <button class="btn-link" type="button" data-home-edit>Personnaliser</button>`;
    app.append(p);
  }
}

/**
 * Applique la disposition du membre au squelette de l'accueil. À appeler après renderMemberShell() et le retrait des
 * tuiles interdites, avant les chargements : les blocs masqués sont retirés du DOM et ne chargent donc rien.
 * @param {HTMLElement} app conteneur de la page (#app)
 * @param {object} me profil connecté
 * @returns {Promise<{loadOwn: () => Promise<void>}>} loadOwn charge les blocs rendus par ce module
 */
export async function applyHomeLayout(app, me) {
  const blocks = new Map();
  for (const meta of HOME_BLOCKS) {
    if (meta.page && !canAccess(meta.page)) continue;
    if (meta.own) {
      const el = document.createElement('section');
      el.className = `card home-own home-own-${meta.id}`;
      el.dataset.homeId = meta.id;
      el.innerHTML = ownShell(meta.id, OWN[meta.id]?.title || meta.label);
      if (meta.auto) el.hidden = true; // affiché seulement si un parrainage est en cours
      blocks.set(meta.id, { meta, els: [el] });
      continue;
    }
    const els = (meta.sel || []).map((q) => app.querySelector(q)).filter(Boolean);
    if (!els.length) continue;
    els.forEach((el) => { el.dataset.homeId = meta.id; });
    blocks.set(meta.id, { meta, els });
  }
  // Blocs inscrits par d'autres modules (data-home-block="<id>" dans le squelette)
  for (const el of app.querySelectorAll('[data-home-block]')) {
    const id = el.dataset.homeBlock;
    if (!/^[a-z][a-z0-9_-]{1,29}$/.test(id) || blocks.has(id)) continue;
    el.dataset.homeId = id;
    blocks.set(id, { meta: { id, label: el.dataset.homeLabel || id, desc: el.dataset.homeDesc || '', kind: el.dataset.homeKind || 'full' }, els: [el] });
  }
  const available = [...blocks.values()].map((b) => b.meta);
  const { def, saved } = await readConfig(me.id);
  const st = { blocks, def, saved, layout: resolveLayout(available, saved, def) };
  arrange(app, st);

  // Bouton « Personnaliser » dans l'en-tête ; le mode édition est chargé au premier clic
  const head = app.querySelector('.home-head');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'btn btn-ghost home-perso-btn'; btn.dataset.homeEdit = '';
  btn.textContent = 'Personnaliser';
  head.append(btn);
  app.addEventListener('click', async (ev) => {
    if (!ev.target.closest?.('[data-home-edit]')) return;
    try {
      const m = await import('./home-edit.js');
      m.openHomeEditor({ app, me, st, arrange: () => arrange(app, st), save: (list) => saveLayout(me.id, list), reset: () => resetLayout(me.id) });
    } catch (e) { toast(`Personnalisation indisponible : ${errMsg(e)}`, 'error'); }
  });

  return {
    loadOwn: () => Promise.allSettled(st.layout.filter((x) => x.on && OWN[x.id] && blocks.get(x.id)).map((x) => {
      const el = blocks.get(x.id).els[0];
      return OWN[x.id].load(el.querySelector('[data-own-body]'), { me, el });
    })),
  };
}

/** Raccourci : élément d'un bloc affiché (ou null). */
export const homeBlockEl = (id) => $(`[data-home-id="${id}"]`);
