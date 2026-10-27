// ===== Humane Gang — panel : rendez-vous saisonniers (migration 096) =====
/*
 * Rôle : section « Saisons » du panel (Vie du gang › Rendez-vous), trois parties :
 *   - avent : les 24 cases du calendrier de l'Avent (sorte, Paillettes, carte, souvenir, question, booster, case
 *     collective), « Remplir automatiquement » (souvenirs du même jour dans les années passées), aperçu « comme un
 *     membre le N décembre » et réglages du calendrier (saisons.avent : actif, seuil, seuil en %, Paillettes de repli) ;
 *   - worlds : interrupteur « Saison des Worlds » (thème, booster de la saison, quêtes ; badges à l'extinction), dates,
 *     type de booster (identifiant, C1), mots des moments esport, quêtes de la saison et page des pronostics
 *     (saisons.worlds.quetes et pronos, enregistrées par fusion) ;
 *   - anniv : anniversaire du gang (année de création, fenêtre, carte de l'année, photo de famille, booster du cadeau
 *     saisons.anniversaire.booster), moments retenus pour la rétrospective, date de test (administrateur seulement, 2 h).
 * Droits : Staff « themes » (hg_has_perm côté serveur) ; « souvenirs » pour retenir un moment. Toutes les écritures passent
 * par des RPC qui vérifient, bornent et journalisent.
 * RPC : hg_advent_admin, hg_advent_day_save, hg_advent_autofill, hg_saison_admin, hg_saison_set, hg_anniv_admin,
 *   hg_moment_retro_set, hg_saisons_test_date. Lectures : hg_cards, hg_card_sets, hg_moments, hg_quiz_questions.
 * Dépendances : core.js (sb, esc, toast, errMsg, getCachedPerms), saisons-css.js (styles de l'aperçu).
 * Exporte : mountSaisonsSection(root), showSaisonsPart(part).
 */
import { sb, esc, toast, errMsg, getCachedPerms } from '../../commun/core.js';
import { loadSeasonCss } from '../accueil/saisons-css.js';
import { ecrireReglage } from './reglages-merge.js';

const KINDS = [['paillettes', 'Paillettes'], ['carte', 'Carte'], ['souvenir', 'Souvenir'], ['question', 'Question bonus'], ['booster', 'Booster']];
/* Adresse d'une page des pronostics : nom de fichier .html, ancre facultative (même règle que hg_saison_worlds_cfg). */
const PRONOS_RE = /^[a-z0-9_-]+\.html(#[a-z0-9_-]+)?$/;
/* Identifiant d'un type de booster (même règle que les RPC). */
const BOOSTER_RE = /^[a-z0-9_]{2,30}$/;
const Z = { root: null, part: 'avent', year: null, adv: null, lists: null, sai: null, ann: null, preview: null, tpl: null, types: null };

const defaultYear = () => { const d = new Date(); return d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - (d.getMonth() === 0 ? 1 : 0); };
const opt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
const isoLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); if (Number.isNaN(d.getTime())) return ''; const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

/** Listes de choix (cartes, souvenirs, questions, types de booster), lues une fois. */
async function loadLists() {
  if (Z.lists) return Z.lists;
  const [cards, moments, quiz, types] = await Promise.all([
    sb.from('hg_cards').select('id,name,rarity,set_id').order('name').limit(2000),
    sb.from('hg_moments').select('id,title,happened_on').order('happened_on', { ascending: false }).limit(500),
    sb.from('hg_quiz_questions').select('id,prompt,active').order('created_at', { ascending: false }).limit(500),
    sb.from('hg_booster_types').select('id,name').order('sort'),
  ]);
  Z.lists = { cards: cards.data || [], moments: moments.data || [], quiz: quiz.data || [], types: types.data || [] };
  return Z.lists;
}

/** Modèles de quêtes (hg_card_quests_templates), lus une fois : choix des quêtes de la Saison des Worlds. */
async function loadQuestTemplates() {
  if (Z.tpl) return Z.tpl;
  const { data, error } = await sb.from('hg_card_quests_templates').select('code,label,reward,active').order('sort').order('code');
  if (error) throw error;
  Z.tpl = data || [];
  return Z.tpl;
}

/** Types de booster (hg_booster_types), lus une fois : choix du cadeau d'anniversaire. */
async function loadBoosterTypes() {
  if (Z.types) return Z.types;
  const { data, error } = await sb.from('hg_booster_types').select('id,name').order('sort');
  if (error) throw error;
  Z.types = data || [];
  return Z.types;
}

/* ---------- Partie « Calendrier de l'Avent » ---------- */
/** Réglages du calendrier (saisons.avent) : interrupteur, seuil de la case collective, Paillettes de repli. */
function aventCfgHtml(c) {
  return `<details class="zav-cfg" open><summary><strong>Réglages du calendrier</strong> <span class="muted small">actif, seuil de la case collective, Paillettes de repli</span></summary>
    <form class="stack" data-zac style="padding:12px 0;max-width:640px">
      <label class="check"><input type="checkbox" name="actif"${c.actif !== false ? ' checked' : ''}> Calendrier actif (les membres peuvent ouvrir les cases)</label>
      <div class="row" style="gap:12px;flex-wrap:wrap">
        <div class="field"><label for="zac-s">Seuil de la case collective (membres)</label>
          <input id="zac-s" name="seuil" type="number" min="1" max="200" step="1" inputmode="numeric" value="${esc(c.seuil ?? 10)}" aria-describedby="zac-s-h">
          <span class="small muted" id="zac-s-h">Nombre de membres qui doivent ouvrir une case collective pour débloquer son bonus (1 à 200).</span></div>
        <div class="field"><label for="zac-p">Seuil en % du gang</label>
          <input id="zac-p" name="seuil_pct" type="number" min="10" max="100" step="1" inputmode="numeric" value="${esc(c.seuil_pct ?? 70)}" aria-describedby="zac-p-h">
          <span class="small muted" id="zac-p-h">Le seuil ne dépasse jamais ce pourcentage des membres (10 à 100).</span></div>
      </div>
      <div class="field"><label for="zac-r">Paillettes de repli (0 à 200)</label>
        <input id="zac-r" name="carte_repli" type="number" min="0" max="200" step="1" inputmode="numeric" value="${esc(c.carte_repli ?? 20)}" aria-describedby="zac-r-h">
        <span class="small muted" id="zac-r-h">Versées en plus de la case quand la carte ne peut plus être donnée (plus d'exemplaire disponible).</span></div>
      <div class="btn-row"><button class="btn btn-sand" type="submit">Enregistrer le calendrier</button></div>
    </form></details>`;
}

/** Formulaire d'une case. */
function dayForm(d) {
  const L = Z.lists;
  const k = d.kind || 'paillettes';
  const grp = d.group_target != null;
  const sum = !d.ready ? 'à remplir' : `${KINDS.find((x) => x[0] === k)?.[1] || k}${d.reward ? ` · ${d.reward} ✦` : ''}${grp ? ' · collective' : ''} · ${d.opens || 0} ouverture(s)`;
  const id = `zav-${d.day}`;
  return `<details class="zav-day" data-day="${d.day}"><summary><strong>${d.day} décembre</strong> <span class="muted small">${esc(sum)}</span></summary>
    <form class="stack zav-form" data-day="${d.day}" style="padding:12px 0">
      <div class="field"><label for="${id}-k">Sorte</label><select id="${id}-k" name="kind">${KINDS.map(([v, l]) => opt(v, l, v === k)).join('')}</select></div>
      <div class="field"><label for="${id}-r">Paillettes de la case (0 à 200)</label><input id="${id}-r" name="reward" type="number" min="0" max="200" value="${Number(d.reward) || 0}"></div>
      <div class="field" data-for="carte"><label for="${id}-c">Carte</label><select id="${id}-c" name="card_id"><option value="">—</option>${L.cards.map((c) => opt(c.id, `${c.name} (${c.rarity})`, c.id === d.card_id)).join('')}</select>
        <label class="check"><input type="checkbox" name="shiny"${d.shiny ? ' checked' : ''}> Brillante</label></div>
      <div class="field" data-for="souvenir"><label for="${id}-m">Souvenir (moment de l’historique)</label><select id="${id}-m" name="moment_id"><option value="">—</option>${L.moments.map((m) => opt(m.id, `${m.happened_on} · ${m.title}`, m.id === d.moment_id)).join('')}</select>
        <label for="${id}-e">ou sortie (identifiant)</label><input id="${id}-e" name="event_id" value="${esc(d.event_id || '')}" placeholder="facultatif"></div>
      <div class="field" data-for="question"><label for="${id}-q">Question (une question inactive reste réservée au calendrier)</label>
        ${L.quiz.length ? `<select id="${id}-q" name="quiz_id"><option value="">—</option>${L.quiz.map((q) => opt(q.id, `${q.active ? '' : '[réservée] '}${q.prompt.slice(0, 80)}`, q.id === d.quiz_id)).join('')}</select>`
          : `<input id="${id}-q" name="quiz_id" value="${esc(d.quiz_id || '')}" placeholder="identifiant de la question (droit « quiz » pour la liste)">`}</div>
      <div class="field" data-for="booster"><label for="${id}-b">Type de booster (mis dans le stock)</label><select id="${id}-b" name="booster_type"><option value="">—</option>${L.types.map((t) => opt(t.id, t.name, t.id === d.booster_type)).join('')}</select></div>
      <label class="check"><input type="checkbox" name="group"${grp ? ' checked' : ''}> Case collective (bonus quand assez de membres l’ont ouverte)</label>
      <div class="row" style="gap:12px;flex-wrap:wrap">
        <div class="field"><label for="${id}-gt">Seuil (membres)</label><input id="${id}-gt" name="group_target" type="number" min="1" max="200" value="${grp ? Number(d.group_target) : 10}"></div>
        <div class="field"><label for="${id}-gr">Bonus du gang (0 à 200)</label><input id="${id}-gr" name="group_reward" type="number" min="0" max="200" value="${Number(d.group_reward) || 25}"></div>
      </div>
      ${grp && d.group_target_eff != null && d.group_target_eff !== d.group_target ? `<p class="small muted">Seuil effectif : ${d.group_target_eff} (borné par la taille du gang).</p>` : ''}
      <div class="field"><label for="${id}-l">Petit mot (facultatif)</label><input id="${id}-l" name="label" maxlength="120" value="${esc(d.label || '')}"></div>
      <div class="btn-row"><button class="btn btn-sand" type="submit">Enregistrer le ${d.day}</button></div>
    </form></details>`;
}

/** Aperçu de la grille telle qu'un membre la voit le jour N (toutes les cases passées ouvertes). */
function previewHtml(n) {
  if (!n) return '';
  const lab = (d) => (d.kind === 'paillettes' ? `+${d.reward}` : KINDS.find((x) => x[0] === d.kind)?.[1] || '—');
  return `<ul class="zav-prev" aria-label="Aperçu le ${n} décembre">${Z.adv.days.map((d) => `<li class="zav-p ${d.day < n ? 'is-open' : d.day === n ? 'is-today' : 'is-locked'}">
    <span>${d.day}${d.group_target != null ? ' 👥' : ''}</span><b>${d.day <= n ? esc(d.ready ? lab(d) : 'vide') : '🔒'}</b></li>`).join('')}</ul>`;
}

function renderAvent(host) {
  const a = Z.adv;
  const empty = a.days.filter((d) => !d.ready).length;
  host.innerHTML = `
    <div class="stack">
      <p class="muted small">Du 1er au 24 décembre, une case s’ouvre chaque matin à 6 h (heure de Zurich) ; une case oubliée se rattrape jusqu’au 31.
        Budget conseillé : environ 500 Paillettes par membre sur le mois (plafond « avent_mois » : ${esc(a.cfg?.plafond ?? 600)}). Gang : ${esc(a.gang)} membres.</p>
      ${aventCfgHtml(a.cfg || {})}
      <div class="row" style="gap:12px;flex-wrap:wrap;align-items:flex-end">
        <div class="field"><label for="zav-year">Année</label><input id="zav-year" type="number" min="2024" max="2100" value="${esc(a.year)}"></div>
        <button class="btn btn-ghost" type="button" data-zav="reload">Afficher</button>
        <button class="btn btn-ghost" type="button" data-zav="autofill">Remplir automatiquement</button>
        <div class="field"><label for="zav-prev">Aperçu comme un membre le</label><select id="zav-prev"><option value="">—</option>${Array.from({ length: 24 }, (_, i) => opt(i + 1, `${i + 1} décembre`, Z.preview === i + 1)).join('')}</select></div>
      </div>
      ${empty ? `<p class="small" role="status">${empty} case(s) à remplir : un membre ne peut pas ouvrir une case vide.</p>` : ''}
      <div id="zav-preview">${previewHtml(Z.preview)}</div>
      <div class="zav-days">${a.days.map(dayForm).join('')}</div>
    </div>`;
  for (const f of host.querySelectorAll('.zav-form')) syncKind(f);
}

/** N'affiche que les champs utiles à la sorte choisie. */
function syncKind(f) {
  const k = f.querySelector('[name="kind"]').value;
  for (const el of f.querySelectorAll('[data-for]')) el.hidden = el.dataset.for !== k;
  const grp = f.querySelector('[name="group"]').checked;
  for (const n of ['group_target', 'group_reward']) f.querySelector(`[name="${n}"]`).closest('.field').hidden = !grp;
}

async function loadAvent() {
  const { data, error } = await sb.rpc('hg_advent_admin', { p_year: Z.year });
  if (error) throw error;
  Z.adv = data;
}

/* ---------- Partie « Saison des Worlds » ---------- */
function renderWorlds(host) {
  const s = Z.sai, w = s.worlds || {};
  host.innerHTML = `
    <form class="stack" data-zw style="max-width:640px">
      <p class="muted small">Allumer la saison active d’un coup le thème « Saison des Worlds » (pendant les dates), le booster de la saison en boutique
        et trois quêtes en plus des quêtes de la semaine. L’éteindre les retire et attribue les badges « Pick’em parfait » et « Fidèle de la saison ».</p>
      <p class="small">État : <strong>${w.en_cours ? 'en cours' : w.actif ? 'allumée (hors dates)' : 'éteinte'}</strong>
        · thème ${s.theme?.active ? 'actif' : 'inactif'}</p>
      <label class="check"><input type="checkbox" name="actif"${w.actif ? ' checked' : ''}> Saison des Worlds allumée</label>
      <div class="field"><label for="zw-deb">Début</label><input id="zw-deb" name="debut" type="datetime-local" value="${esc(isoLocal(w.debut))}"></div>
      <div class="field"><label for="zw-fin">Fin (120 jours au plus après le début)</label><input id="zw-fin" name="fin" type="datetime-local" value="${esc(isoLocal(w.fin))}"></div>
      <div class="field"><label for="zw-b">Booster de la saison</label><select id="zw-b" name="booster"><option value="">—</option>${(s.booster_types || []).map((t) => opt(t.id, `${t.name} (${t.id})`, t.id === w.booster)).join('')}</select></div>
      <div class="field"><label for="zw-m">Mots des moments esport (quête « Réagis à un moment culte esport »), séparés par des virgules</label>
        <input id="zw-m" name="mots" value="${esc((w.mots || []).join(', '))}"></div>
      <fieldset class="stack" style="border:0;padding:0;margin:0">
        <legend><strong>Quêtes de la saison</strong> <span class="muted small">(6 au plus, en plus des quêtes de la semaine)</span></legend>
        ${(Z.tpl || []).map((q) => `<label class="check"><input type="checkbox" name="quete" value="${esc(q.code)}"${(w.quetes || []).includes(q.code) ? ' checked' : ''}> ${esc(q.label)} <span class="muted small">(${esc(q.code)} · ${esc(q.reward)} ✦${q.active ? '' : ' · inactive'})</span></label>`).join('') || '<p class="muted small">Aucun modèle de quête. Crée-en dans Fabrique › Quêtes.</p>'}
      </fieldset>
      <div class="field"><label for="zw-p">Page des pronostics</label>
        <input id="zw-p" name="pronos" maxlength="80" value="${esc(w.pronos || '/pages/jeux/jeux.html#pronos')}" aria-describedby="zw-p-h">
        <span class="small muted" id="zw-p-h">Adresse d’une page du site, avec ou sans ancre (ex. /pages/jeux/jeux.html#pronos). Vide : /pages/jeux/jeux.html#pronos.</span></div>
      <div class="btn-row"><button class="btn btn-sand" type="submit">Enregistrer la saison</button></div>
    </form>`;
}

/* ---------- Partie « Anniversaire du gang » ---------- */
/** Options du choix de booster : les types existants ; la valeur enregistrée est gardée même si son type n'existe plus. */
function annivBoosterOptions(cur) {
  const types = Z.types || [];
  const known = types.some((t) => t.id === cur);
  return types.map((t) => opt(t.id, `${t.name} (${t.id})`, t.id === cur)).join('') + (known ? '' : opt(cur, `${cur} (introuvable)`, true));
}

function renderAnniv(host) {
  const a = Z.ann, i = a.info || {}, c = a.cfg || {};
  const isAdmin = !!getCachedPerms()?.is_admin;
  const yCard = String(i.date || '').slice(0, 4);
  host.innerHTML = `
    <div class="stack" style="max-width:720px">
      <p class="small">Prochain anniversaire : <strong>${esc(i.date)}</strong> · le gang aura <strong>${esc(i.age)} ans</strong> ·
        fenêtre du ${esc(i.debut)} au ${esc(i.fin)} ${i.dans_fenetre ? '(en cours)' : ''} · ${esc(a.claims)} cadeau(x) réclamé(s).</p>
      <form class="stack" data-za>
        <div class="field"><label for="za-y">Année de création du serveur</label><input id="za-y" name="annee" type="number" min="2000" max="2100" value="${esc(c.annee ?? 2022)}"></div>
        <div class="field"><label for="za-f">Jours avant et après le jour J (0 à 3)</label><input id="za-f" name="fenetre" type="number" min="0" max="3" value="${esc(c.fenetre ?? 1)}"></div>
        <div class="field"><label for="za-c">Carte datée ${esc(yCard)} (série « Anniversaires du gang »)</label><select id="za-c" name="carte"><option value="">—</option>${(a.cards || []).map((k) => opt(k.id, k.name, k.id === i.carte)).join('')}</select></div>
        <div class="field"><label for="za-b">Booster du cadeau d’anniversaire</label><select id="za-b" name="booster" aria-describedby="za-b-h">${annivBoosterOptions(i.booster || 'anniversaire')}</select>
          <span class="small muted" id="za-b-h">Le booster offert au membre pendant la fenêtre du cadeau. Les types se gèrent dans Fabrique › Boosters.</span></div>
        <div class="field"><label for="za-p">Photo de famille (identifiant d’une photo d’album, facultatif)</label><input id="za-p" name="photo_id" value="${esc(c.photo_id || '')}"></div>
        <div class="btn-row"><button class="btn btn-sand" type="submit">Enregistrer</button><a class="btn btn-ghost" href="/pages/irl/recap.html?retro=1" target="_blank" rel="noopener">Voir la rétrospective</a></div>
      </form>
      <h3>Moments retenus pour la rétrospective</h3>
      <p class="muted small">Seulement des moments validés : rien de blessant, personne qui a demandé à ne pas apparaître (droit « souvenirs »).</p>
      <ul class="zan-moments" style="list-style:none;padding:0;margin:0;max-height:360px;overflow:auto">${(a.moments || []).map((m) => `<li><label class="check" style="min-height:44px;align-items:center">
        <input type="checkbox" data-retro="${esc(m.id)}"${m.retro ? ' checked' : ''}> <span>${esc(m.happened_on)} · ${esc(m.title)}</span></label></li>`).join('')}</ul>
      ${isAdmin ? `<h3>Date de test (administrateur)</h3>
        <p class="muted small">Pour toi seul, pendant 2 h : le calendrier, la saison et l’anniversaire se comportent comme à cette date.</p>
        <div class="row" style="gap:12px;flex-wrap:wrap;align-items:flex-end"><div class="field"><label for="za-t">Date et heure</label><input id="za-t" type="datetime-local"></div>
        <button class="btn btn-ghost" type="button" data-zt="set">Activer</button><button class="btn btn-ghost" type="button" data-zt="off">Retirer</button></div>` : ''}
    </div>`;
}

/* ---------- Montage et événements ---------- */
async function paint() {
  const host = Z.root.querySelector('#zs-body');
  host.innerHTML = '<div class="empty">Chargement…</div>';
  try {
    if (Z.part === 'avent') { await Promise.all([loadAvent(), loadLists()]); renderAvent(host); }
    else if (Z.part === 'worlds') {
      Z.tpl = null; // modèles relus à chaque visite (une quête ajoutée apparaît tout de suite)
      const [r] = await Promise.all([sb.rpc('hg_saison_admin'), loadQuestTemplates()]);
      if (r.error) throw r.error; Z.sai = r.data; renderWorlds(host);
    } else {
      Z.types = null;
      const [r] = await Promise.all([sb.rpc('hg_anniv_admin', { p: null }), loadBoosterTypes()]);
      if (r.error) throw r.error; Z.ann = r.data; renderAnniv(host);
    }
  } catch (e) {
    host.innerHTML = `<div class="empty">Impossible de charger (${esc(errMsg(e))}).</div>`;
  }
}

/**
 * Affiche une partie de la section (avent, worlds, anniv).
 * @param {'avent'|'worlds'|'anniv'} part
 */
export async function showSaisonsPart(part) {
  Z.part = ['avent', 'worlds', 'anniv'].includes(part) ? part : 'avent';
  if (Z.root) await paint();
}

async function onSubmit(e) {
  const f = e.target;
  e.preventDefault();
  const btn = f.querySelector('button[type="submit"]');
  btn.disabled = true;
  try {
    if (f.matches('.zav-form')) {
      const v = (n) => f.querySelector(`[name="${n}"]`)?.value ?? '';
      const grp = f.querySelector('[name="group"]').checked;
      const p = { kind: v('kind'), reward: v('reward'), card_id: v('card_id'), shiny: f.querySelector('[name="shiny"]').checked, moment_id: v('moment_id'),
        event_id: v('event_id'), quiz_id: v('quiz_id'), booster_type: v('booster_type'), label: v('label'),
        group_target: grp ? v('group_target') : '', group_reward: grp ? v('group_reward') : '0' };
      const { error } = await sb.rpc('hg_advent_day_save', { p_year: Z.year, p_day: Number(f.dataset.day), p });
      if (error) throw error;
      toast(`Case du ${f.dataset.day} enregistrée`, 'success');
      await loadAvent();
      renderAvent(Z.root.querySelector('#zs-body'));
    } else if (f.matches('[data-zac]')) {
      const ent = (name, lo, hi, lib) => {
        const v = f.querySelector(`[name="${name}"]`).value.trim(), x = Number(v);
        if (v === '' || !Number.isInteger(x) || x < lo || x > hi) throw new Error(`${lib} : nombre entier de ${lo} à ${hi}.`);
        return x;
      };
      const p = { actif: f.querySelector('[name="actif"]').checked, seuil: ent('seuil', 1, 200, 'Seuil de la case collective'),
        seuil_pct: ent('seuil_pct', 10, 100, 'Seuil en %'), carte_repli: ent('carte_repli', 0, 200, 'Paillettes de repli') };
      // Fusion dans saisons.avent : les autres sous-clés (worlds, anniversaire) restent en place.
      await ecrireReglage('saisons', (s) => { s.avent = { ...(s.avent || {}), ...p }; });
      toast('Réglages du calendrier enregistrés', 'success');
      await paint();
    } else if (f.matches('[data-zw]')) {
      const val = (n) => f.querySelector(`[name="${n}"]`).value;
      const iso = (s) => (s ? new Date(s).toISOString() : '');
      const p = { actif: f.querySelector('[name="actif"]').checked, debut: iso(val('debut')), fin: iso(val('fin')), booster: val('booster'),
        mots: val('mots').split(',').map((x) => x.trim()).filter(Boolean) };
      // Quêtes et page des pronostics : pas dans hg_saison_set, enregistrées ensuite dans saisons.worlds (fusion).
      const quetes = [...f.querySelectorAll('input[name="quete"]:checked')].map((x) => x.value);
      if (quetes.length > 6) throw new Error('Six quêtes au plus pour la saison.');
      const pronos = val('pronos').trim() || '/pages/jeux/jeux.html#pronos';
      if (!PRONOS_RE.test(pronos)) throw new Error('Page des pronostics : nom d’une page .html, avec une ancre facultative (ex. /pages/jeux/jeux.html#pronos).');
      const { data, error } = await sb.rpc('hg_saison_set', { p_slug: 'worlds', p });
      if (error) throw error;
      await ecrireReglage('saisons', (s) => { s.worlds = { ...(s.worlds || {}), quetes, pronos }; });
      toast(p.actif ? 'Saison des Worlds allumée' : `Saison éteinte${data?.badges ? ` · ${data.badges} badge(s) attribué(s)` : ''}`, 'success');
      await paint();
    } else if (f.matches('[data-za]')) {
      const val = (n) => f.querySelector(`[name="${n}"]`).value;
      const booster = val('booster');
      if (!BOOSTER_RE.test(booster)) throw new Error('Type de booster invalide.');
      const p = { annee: val('annee'), fenetre: val('fenetre'), carte: val('carte'), photo_id: val('photo_id') };
      const { error } = await sb.rpc('hg_anniv_admin', { p });
      if (error) throw error;
      await ecrireReglage('saisons', (s) => { s.anniversaire = { ...(s.anniversaire || {}), booster }; });
      toast('Anniversaire enregistré', 'success');
      await paint();
    }
  } catch (err) {
    toast(errMsg(err), 'error');
  } finally { btn.disabled = false; }
}

async function onClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.zav === 'reload') {
    Z.year = Number(Z.root.querySelector('#zav-year').value) || defaultYear();
    await paint();
  } else if (b.dataset.zav === 'autofill') {
    b.disabled = true;
    try {
      const { data, error } = await sb.rpc('hg_advent_autofill', { p_year: Z.year });
      if (error) throw error;
      let n = 0;
      for (const s of data || []) {
        const m = s.moments?.[0], ev = s.events?.[0];
        const f = Z.root.querySelector(`.zav-form[data-day="${s.day}"]`);
        const d = Z.adv.days.find((x) => x.day === s.day);
        if (!f || (!m && !ev) || (d?.ready && d.kind !== 'paillettes')) continue;
        f.querySelector('[name="kind"]').value = 'souvenir';
        if (m) f.querySelector('[name="moment_id"]').value = m.id;
        if (!m && ev) f.querySelector('[name="event_id"]').value = ev.id;
        syncKind(f);
        f.closest('details').open = true;
        n++;
      }
      toast(n ? `${n} souvenir(s) proposé(s) : vérifie puis enregistre chaque case.` : 'Aucun souvenir trouvé aux mêmes dates.', n ? 'success' : undefined);
    } catch (err) { toast(errMsg(err), 'error'); } finally { b.disabled = false; }
  } else if (b.dataset.zt) {
    const v = Z.root.querySelector('#za-t')?.value;
    if (b.dataset.zt === 'set' && !v) { toast('Choisis une date', 'error'); return; }
    const { error } = await sb.rpc('hg_saisons_test_date', { p_at: b.dataset.zt === 'set' ? new Date(v).toISOString() : null });
    toast(error ? errMsg(error) : b.dataset.zt === 'set' ? 'Date de test active pour 2 h (pour toi seul)' : 'Date de test retirée', error ? 'error' : 'success');
  }
}

async function onChange(e) {
  const t = e.target;
  if (t.matches('.zav-form select[name="kind"], .zav-form input[name="group"]')) syncKind(t.closest('form'));
  else if (t.id === 'zav-prev') { Z.preview = Number(t.value) || null; Z.root.querySelector('#zav-preview').innerHTML = previewHtml(Z.preview); }
  else if (t.dataset.retro) {
    t.disabled = true;
    const { error } = await sb.rpc('hg_moment_retro_set', { p_moment: t.dataset.retro, p_on: t.checked });
    t.disabled = false;
    if (error) { t.checked = !t.checked; toast(errMsg(error), 'error'); } else toast(t.checked ? 'Moment retenu pour la rétrospective' : 'Moment retiré de la rétrospective', 'success');
  }
}

/**
 * Monte la section (une fois) dans root.
 * @param {HTMLElement} root
 */
export async function mountSaisonsSection(root) {
  if (!root) return;
  Z.root = root;
  Z.year = Z.year || defaultYear();
  root.innerHTML = '<div id="zs-body"></div>';
  if (!root.dataset.zsBound) {
    root.dataset.zsBound = '1';
    root.addEventListener('submit', onSubmit);
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
  }
  loadSeasonCss();
  // La partie est dessinée par showSaisonsPart (appelée à chaque visite d'une sous-section).
}
