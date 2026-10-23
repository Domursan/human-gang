// ===== Humane Gang — administration : saisons de classement (J16) et soirées complètes (J19) =====
/*
 * Rôle : sous-section « Jeux et cartes › Jeux › Saisons et soirées » (permission Staff « cartes »).
 *   - Saisons : libellé, dates, barème (points par action et plafond hebdomadaire de chaque catégorie), récompenses de fin
 *     de saison ; clôture d'une saison terminée (la clôture se fait aussi seule à la première lecture du classement).
 *   - Soirées : réglages par défaut (seuil en % des membres actifs du mois, récompense), création, modification et
 *     annulation des soirées (défi « soirée complète »).
 * Toutes les écritures passent par des RPC bornées et journalisées (migration 086) : hg_season_save, hg_season_settle,
 * hg_night_save, hg_night_cancel, hg_night_defaults_set ; lectures : hg_season_board, hg_seasons, hg_nights_admin.
 * Dépendances : core.js (sb, toast, esc, errMsg), admin-events.js (heure suisse des champs date).
 * Exporte : mountJeux4Section(root).
 */
import { sb, toast, esc, errMsg } from './core.js';
import { toZurichInput, fromZurichInput } from './admin-events.js';

const dateFmt = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const R = { root: null };

/** Bouton occupé pendant un envoi. */
function occupe(btn, on) { if (!btn) return; btn.disabled = on; if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy'); }

/**
 * Monte la sous-section dans son conteneur.
 * @param {HTMLElement} root conteneur (#jeux4-root)
 */
export async function mountJeux4Section(root) {
  if (!root) return;
  R.root = root;
  root.innerHTML = `<div class="adc ajx">
    <section class="card" aria-labelledby="ajx-s-h"><h3 class="adc-h" id="ajx-s-h">Saison de classement</h3><div id="ajx-saison"><div class="empty">Chargement…</div></div></section>
    <section class="card" aria-labelledby="ajx-n-h"><h3 class="adc-h" id="ajx-n-h">Soirées complètes</h3><div id="ajx-soirees"><div class="empty">Chargement…</div></div></section>
  </div>`;
  await Promise.allSettled([chargeSaison(), chargeSoirees()]);
}

/* ---------- Saisons ---------- */

/** Charge la saison en cours (barème, récompenses) et les saisons terminées non clôturées. */
async function chargeSaison() {
  const box = R.root.querySelector('#ajx-saison');
  try {
    const [{ data: b, error }, { data: rows, error: e2 }] = await Promise.all([
      sb.rpc('hg_season_board'),
      sb.from('hg_seasons').select('id,label,starts_at,ends_at,settled_at').order('starts_at', { ascending: false }).limit(8),
    ]);
    if (error) throw error;
    if (e2) throw e2;
    renderSaison(box, b, rows || []);
  } catch (e) {
    box.innerHTML = `<div class="empty">Impossible de charger la saison : ${esc(errMsg(e))}</div>`;
  }
}

/**
 * Formulaire de la saison en cours et liste des saisons passées.
 * @param {HTMLElement} box conteneur
 * @param {object} b réponse de hg_season_board
 * @param {Array} rows saisons récentes
 */
function renderSaison(box, b, rows) {
  const s = b.season, rw = b.rewards || {};
  const cats = (b.cats || []).map((c) => `<tr>
      <th scope="row">${esc(c.label)}</th>
      <td><input type="number" inputmode="numeric" min="0" max="100" step="1" name="pts.${esc(c.cat)}" value="${esc(String(c.pts))}" aria-label="${esc(c.label)} : points par action"></td>
      <td><input type="number" inputmode="numeric" min="0" max="1000" step="1" name="cap.${esc(c.cat)}" value="${esc(String(c.cap))}" aria-label="${esc(c.label)} : plafond par semaine"></td>
    </tr>`).join('');
  const passees = rows.filter((r) => new Date(r.ends_at) <= new Date());
  box.innerHTML = `
    <form class="adc-form" id="ajx-saison-form" novalidate>
      <p class="small muted">Saison ${esc(s.id)} · ${esc(String(b.participants || 0))} membres classés. Les points se calculent à partir des gains déjà plafonnés (quiz, jeux du jour, quêtes, captures et drops, cartes nouvelles, défis du gang).</p>
      <div class="adc-grid">
        <div class="field adc-wide"><label for="ajx-label">Libellé</label><input id="ajx-label" name="label" maxlength="60" required value="${esc(s.label)}"></div>
        <div class="field"><label for="ajx-debut">Début (heure suisse)</label><input id="ajx-debut" name="debut" type="datetime-local" required value="${esc(toZurichInput(s.starts_at))}"></div>
        <div class="field"><label for="ajx-fin">Fin (heure suisse)</label><input id="ajx-fin" name="fin" type="datetime-local" required value="${esc(toZurichInput(s.ends_at))}"></div>
      </div>
      <div class="ajx-table-wrap"><table class="ajx-table">
        <caption class="small muted">Barème : points par action et plafond par semaine (0 à 100 points, plafond 0 à 1 000).</caption>
        <thead><tr><th scope="col">Catégorie</th><th scope="col">Points</th><th scope="col">Plafond / semaine</th></tr></thead>
        <tbody>${cats}</tbody>
      </table></div>
      <div class="adc-grid">
        ${[0, 1, 2].map((i) => `<div class="field"><label for="ajx-p${i}">Podium ${i + 1}${i ? 'e' : 'er'} (Paillettes)</label><input id="ajx-p${i}" name="podium.${i}" type="number" min="0" max="5000" value="${esc(String(rw.podium?.[i] ?? 0))}"></div>`).join('')}
        ${[0, 1, 2].map((i) => `<div class="field"><label for="ajx-n${i}">Nouveaux ${i + 1}${i ? 'e' : 'er'} (Paillettes)</label><input id="ajx-n${i}" name="nouveaux.${i}" type="number" min="0" max="5000" value="${esc(String(rw.nouveaux?.[i] ?? 0))}"></div>`).join('')}
        <div class="field"><label for="ajx-pp">Palier (points)</label><input id="ajx-pp" name="palier_points" type="number" min="1" max="10000" value="${esc(String(rw.palier_points ?? 100))}"></div>
        <div class="field"><label for="ajx-pg">Bonus du palier (Paillettes)</label><input id="ajx-pg" name="palier_gain" type="number" min="0" max="1000" value="${esc(String(rw.palier_gain ?? 0))}"></div>
      </div>
      <p class="form-error" id="ajx-saison-err" role="alert" hidden></p>
      <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer la saison</button></div>
    </form>
    ${passees.length ? `<h4 class="ajx-h4">Saisons terminées</h4><ul class="ajx-list">${passees.map((r) => `<li>
        <span>${esc(r.label)} <span class="small muted">(${esc(r.id)})</span></span>
        ${r.settled_at ? '<span class="pill pill-ok">Clôturée</span>' : `<button class="btn btn-ghost" type="button" data-settle="${esc(r.id)}">Clôturer</button>`}
      </li>`).join('')}</ul>` : ''}`;
  const form = box.querySelector('#ajx-saison-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form), err = box.querySelector('#ajx-saison-err');
    const caps = {}, rewards = { podium: [], nouveaux: [] };
    for (const c of b.cats || []) caps[c.cat] = { pts: Number(fd.get(`pts.${c.cat}`)), cap: Number(fd.get(`cap.${c.cat}`)) };
    for (const i of [0, 1, 2]) { rewards.podium[i] = Number(fd.get(`podium.${i}`)); rewards.nouveaux[i] = Number(fd.get(`nouveaux.${i}`)); }
    rewards.palier_points = Number(fd.get('palier_points'));
    rewards.palier_gain = Number(fd.get('palier_gain'));
    const debut = fromZurichInput(String(fd.get('debut') || '')), fin = fromZurichInput(String(fd.get('fin') || ''));
    const bad = Object.values(caps).some((c) => !Number.isInteger(c.pts) || c.pts < 0 || c.pts > 100 || !Number.isInteger(c.cap) || c.cap < 0 || c.cap > 1000);
    err.hidden = true;
    if (bad) { err.textContent = 'Barème : des nombres entiers (points 0 à 100, plafond 0 à 1 000).'; err.hidden = false; return; }
    if (!debut || !fin) { err.textContent = 'Indique le début et la fin.'; err.hidden = false; return; }
    const btn = form.querySelector('[type="submit"]');
    occupe(btn, true);
    try {
      const { error } = await sb.rpc('hg_season_save', { p_id: s.id, p_label: String(fd.get('label') || '').trim(), p_starts: debut, p_ends: fin, p_caps: caps, p_rewards: rewards });
      if (error) throw error;
      toast('Saison enregistrée.', 'success');
      await chargeSaison();
    } catch (x) {
      err.textContent = errMsg(x); err.hidden = false;
    } finally { occupe(btn, false); }
  });
  box.querySelectorAll('[data-settle]').forEach((b2) => b2.addEventListener('click', async () => {
    occupe(b2, true);
    try {
      const { data, error } = await sb.rpc('hg_season_settle', { p_season: b2.dataset.settle });
      if (error) throw error;
      toast(`Saison clôturée (${data?.versements ?? 0} versements).`, 'success');
      await chargeSaison();
    } catch (x) { toast(errMsg(x), 'error'); occupe(b2, false); }
  }));
}

/* ---------- Soirées ---------- */

/** Charge les réglages par défaut et les soirées des 60 derniers jours et à venir. */
async function chargeSoirees() {
  const box = R.root.querySelector('#ajx-soirees');
  try {
    const { data, error } = await sb.rpc('hg_nights_admin');
    if (error) throw error;
    renderSoirees(box, data || {});
  } catch (e) {
    box.innerHTML = `<div class="empty">Impossible de charger les soirées : ${esc(errMsg(e))}</div>`;
  }
}

/** État d'une soirée : libellé et classe de pastille. */
function etatSoiree(n) {
  if (n.cancelled) return ['Annulée', 'pill-todo'];
  if (n.completed_at) return ['Complète', 'pill-ok'];
  if (new Date(n.ends_at) <= new Date()) return ['Terminée', 'pill'];
  if (new Date(n.starts_at) <= new Date()) return ['En cours', 'pill-current'];
  return ['À venir', 'pill'];
}

/**
 * Réglages par défaut, formulaire de création et liste des soirées.
 * @param {HTMLElement} box conteneur
 * @param {{defaults: object, nights: Array}} d réponse de hg_nights_admin
 */
function renderSoirees(box, d) {
  const df = d.defaults || {}, nights = d.nights || [];
  box.innerHTML = `
    <p class="small muted">Pendant une soirée, un bouton « J’y suis » apparaît sur l’accueil. Au seuil de présents, chaque présent reçoit la récompense (2 soirées payées par semaine au plus). On ne liste jamais les absents.</p>
    <form class="adc-form" id="ajx-def-form" novalidate>
      <h4 class="ajx-h4">Réglages par défaut</h4>
      <div class="adc-grid">
        <div class="field"><label for="ajx-pct">Seuil (% des membres actifs du mois)</label><input id="ajx-pct" name="pct" type="number" min="10" max="100" required value="${esc(String(df.seuil_pct ?? 60))}"></div>
        <div class="field"><label for="ajx-rew">Récompense (Paillettes)</label><input id="ajx-rew" name="rew" type="number" min="0" max="500" required value="${esc(String(df.recompense ?? 30))}"></div>
      </div>
      <p class="small muted">${esc(String(df.actifs ?? 0))} membres actifs ce mois : seuil par défaut de ${esc(String(df.seuil ?? 2))} présents.</p>
      <div class="btn-row"><button class="btn btn-ghost" type="submit">Enregistrer les réglages</button></div>
    </form>
    <form class="adc-form" id="ajx-night-form" novalidate>
      <h4 class="ajx-h4">Nouvelle soirée</h4>
      <div class="adc-grid">
        <div class="field adc-wide"><label for="ajx-nt">Titre</label><input id="ajx-nt" name="titre" maxlength="80" required placeholder="Soirée Gartic du vendredi"></div>
        <div class="field"><label for="ajx-nd">Début (heure suisse)</label><input id="ajx-nd" name="debut" type="datetime-local" required></div>
        <div class="field"><label for="ajx-nf">Fin (heure suisse)</label><input id="ajx-nf" name="fin" type="datetime-local" required></div>
        <div class="field"><label for="ajx-ns">Seuil de présents</label><input id="ajx-ns" name="seuil" type="number" min="2" max="100" placeholder="${esc(String(df.seuil ?? ''))} (défaut)"></div>
        <div class="field"><label for="ajx-nr">Récompense</label><input id="ajx-nr" name="recompense" type="number" min="0" max="500" placeholder="${esc(String(df.recompense ?? ''))} (défaut)"></div>
      </div>
      <p class="form-error" id="ajx-night-err" role="alert" hidden></p>
      <div class="btn-row"><button class="btn btn-primary" type="submit">Créer la soirée</button></div>
    </form>
    <h4 class="ajx-h4">Soirées</h4>
    ${nights.length ? `<ul class="ajx-list">${nights.map((n) => {
      const [lbl, cls] = etatSoiree(n);
      const action = n.completed_at ? '' : n.cancelled ? `<button class="btn btn-ghost" type="button" data-cancel="${esc(n.id)}" data-v="false">Rétablir</button>`
        : `<button class="btn btn-ghost" type="button" data-cancel="${esc(n.id)}" data-v="true">Annuler</button>`;
      return `<li><span><strong>${esc(n.title)}</strong><br><span class="small muted">${esc(dateFmt.format(new Date(n.starts_at)))} → ${esc(dateFmt.format(new Date(n.ends_at)))} · ${esc(String(n.presents))} / ${esc(String(n.threshold))} présents · ${esc(String(n.reward))} ✦</span></span>
        <span class="ajx-actions"><span class="pill ${cls}">${esc(lbl)}</span>${action}</span></li>`;
    }).join('')}</ul>` : '<div class="empty">Aucune soirée prévue.</div>'}`;

  box.querySelector('#ajx-def-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget), btn = e.currentTarget.querySelector('[type="submit"]');
    occupe(btn, true);
    try {
      const { error } = await sb.rpc('hg_night_defaults_set', { p_pct: Number(fd.get('pct')), p_reward: Number(fd.get('rew')) });
      if (error) throw error;
      toast('Réglages des soirées enregistrés.', 'success');
      await chargeSoirees();
    } catch (x) { toast(errMsg(x), 'error'); occupe(btn, false); }
  });
  box.querySelector('#ajx-night-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget, fd = new FormData(form), err = box.querySelector('#ajx-night-err'), btn = form.querySelector('[type="submit"]');
    const titre = String(fd.get('titre') || '').trim();
    const debut = fromZurichInput(String(fd.get('debut') || '')), fin = fromZurichInput(String(fd.get('fin') || ''));
    const seuil = String(fd.get('seuil') || '').trim(), rec = String(fd.get('recompense') || '').trim();
    err.hidden = true;
    if (!titre || !debut || !fin) { err.textContent = 'Titre, début et fin sont obligatoires.'; err.hidden = false; return; }
    occupe(btn, true);
    try {
      const { error } = await sb.rpc('hg_night_save', { p_id: null, p_title: titre, p_starts: debut, p_ends: fin,
        p_threshold: seuil === '' ? null : Number(seuil), p_reward: rec === '' ? null : Number(rec) });
      if (error) throw error;
      toast('Soirée créée.', 'success');
      await chargeSoirees();
    } catch (x) { err.textContent = errMsg(x); err.hidden = false; occupe(btn, false); }
  });
  box.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    occupe(b, true);
    try {
      const { error } = await sb.rpc('hg_night_cancel', { p_id: b.dataset.cancel, p_cancel: b.dataset.v === 'true' });
      if (error) throw error;
      toast(b.dataset.v === 'true' ? 'Soirée annulée.' : 'Soirée rétablie.', 'success');
      await chargeSoirees();
    } catch (x) { toast(errMsg(x), 'error'); occupe(b, false); }
  }));
}
