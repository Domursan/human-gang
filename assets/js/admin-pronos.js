// ===== Humane Gang — administration : Pronostics (J5, route cartes/pronos) =====
// Rôle : le Staff « pronos » crée les compétitions (Worlds, LEC, F1, JO, Eurovision…), colle une liste de matchs
// (une ligne par match), saisit les résultats (les gains sont versés par le serveur, une seule fois) et annule un
// match reporté (toutes les mises rendues). Chaque action est journalisée côté serveur (hg_admin_audit).
// RPC : hg_pick_admin, hg_pick_comp_save, hg_pick_items_add, hg_pick_item_edit, hg_pick_settle, hg_pick_cancel (084).
// Dépendances : core.js (sb, toast, esc, errMsg), admin-events.js (heure suisse), ui-confirm.js (confirmation).
// Exporte : mountPronosSection(container), parseMatchs(texte) (pour les tests).
import { sb, toast, esc, errMsg } from './core.js';
import { toZurichInput, fromZurichInput } from './admin-events.js';
import { confirmBox } from './ui-confirm.js';

const TYPES = [['lol', 'LoL (Worlds, LEC)'], ['f1', 'Formule 1'], ['jo', 'Jeux olympiques'], ['eurovision', 'Eurovision'], ['autre', 'Autre']];
const QUAND = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });

/** Identifiant court d'un choix à partir de son libellé (lettres et chiffres, 20 au plus). */
const slug = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'x';

/**
 * Lit la liste collée : une ligne par match, « [Titre :] A ; B[ ; C…] ; date ». Date : « 30.10.2026 18:00 » ou
 * « 2026-10-30 18:00 », heure suisse. Sans titre : « A contre B ».
 * @param {string} texte Texte collé.
 * @returns {{items: object[], errors: string[]}}
 */
export function parseMatchs(texte) {
  const items = [], errors = [];
  String(texte || '').split('\n').map((l) => l.trim()).filter(Boolean).forEach((l, n) => {
    let titre = '';
    const deux = l.indexOf(' : ');
    if (deux > 0) { titre = l.slice(0, deux).trim(); l = l.slice(deux + 3); }
    const parts = l.split(';').map((x) => x.trim()).filter(Boolean);
    const date = parts.pop() || '';
    let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2})[:h](\d{2})$/.exec(date);
    let v = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}` : null;
    if (!v) { m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(date); if (m) v = `${m[1]}-${m[2]}-${m[3]}T${m[4].padStart(2, '0')}:${m[5]}`; }
    const iso = v ? fromZurichInput(v) : null;
    if (!iso) { errors.push(`Ligne ${n + 1} : date illisible (« ${date} »).`); return; }
    if (parts.length < 2) { errors.push(`Ligne ${n + 1} : il faut au moins deux choix.`); return; }
    const vus = new Set();
    const options = parts.map((p) => { let id = slug(p); while (vus.has(id)) id = `${id.slice(0, 18)}-${vus.size}`; vus.add(id); return { id, label: p.slice(0, 40) }; });
    items.push({ label: (titre || parts.slice(0, 2).join(' contre ')).slice(0, 80), options, locks_at: iso });
  });
  return { items, errors };
}

/**
 * Monte la section.
 * @param {HTMLElement} root Conteneur.
 */
export async function mountPronosSection(root) {
  if (!root) return;
  const S = { d: null, comp: null };

  /** Charge les compétitions et les matchs de la compétition choisie. */
  async function charge(comp = S.comp) {
    const { data, error } = await sb.rpc('hg_pick_admin', { p_comp: comp });
    if (error) throw error;
    S.d = data || { comps: [], items: [] };
    S.comp = S.d.comp;
  }

  /** Une ligne de match. */
  function ligne(it) {
    const lib = (id) => it.options.find((o) => o.id === id)?.label ?? id;
    const ouvert = new Date(it.locks_at) > new Date();
    const etat = it.cancelled ? 'Annulé (mises rendues)' : it.settled_at ? `Résultat : ${lib(it.result)}` : ouvert ? 'Pronostics ouverts' : 'À régler';
    const dist = (it.dist || []).map((d) => `${lib(d.choice)} : ${d.n} (${d.stake} ✦)`).join(' · ');
    const actions = it.cancelled || it.settled_at ? '' : `<div class="adp-actions">
        ${ouvert ? `<label class="visually-hidden" for="adp-l-${esc(it.id)}">Début du match</label><input class="input" type="datetime-local" id="adp-l-${esc(it.id)}" value="${esc(toZurichInput(it.locks_at))}">
          <button type="button" class="btn btn-ghost btn-sm" data-act="lock" data-id="${esc(it.id)}">Changer l’heure</button>`
        : `<label class="visually-hidden" for="adp-r-${esc(it.id)}">Résultat</label><select class="input" id="adp-r-${esc(it.id)}">${it.options.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('')}</select>
          <button type="button" class="btn btn-primary btn-sm" data-act="settle" data-id="${esc(it.id)}">Valider le résultat</button>`}
        <button type="button" class="btn btn-ghost btn-sm" data-act="cancel" data-id="${esc(it.id)}">Annuler le match</button></div>`;
    return `<li class="adp-item${!ouvert && !it.settled_at && !it.cancelled ? ' is-todo' : ''}">
      <div class="adp-between"><strong>${esc(it.label)}</strong><span class="pill small">${esc(etat)}</span></div>
      <p class="small muted">${esc(it.options.map((o) => o.label).join(' · '))} — début ${esc(QUAND.format(new Date(it.locks_at)))} — ${esc(String(it.bets))} prono${it.bets > 1 ? 's' : ''}${dist ? ` — ${esc(dist)}` : ''}</p>
      ${actions}</li>`;
  }

  /** Dessine la section. */
  function dessine() {
    const d = S.d;
    const comp = d.comps.find((c) => c.id === S.comp);
    const puces = d.comps.map((c) => `<button type="button" class="adp-comp" data-act="comp" data-id="${esc(c.id)}" aria-pressed="${c.id === S.comp}">${esc(c.title)}${c.active ? '' : ' (masquée)'}${c.todo ? ` · ${c.todo} à régler` : ''}</button>`).join('');
    const typeOpts = (k) => TYPES.map(([v, l]) => `<option value="${v}"${v === k ? ' selected' : ''}>${esc(l)}</option>`).join('');
    root.innerHTML = `<div class="adp stack">
      <section class="card stack">
        <div><h3 class="card-title">Compétitions</h3>
        <p class="small muted">Les membres misent de 0 à 50 Paillettes par match jusqu’à l’heure de début (300 par semaine au plus). Les résultats versent les gains tout de suite : mise, part de la cagnotte des perdants et 5 Paillettes de bonus par bon prono.</p></div>
        ${d.comps.length ? `<div class="adp-comps" role="group" aria-label="Compétitions">${puces}</div>` : '<p class="muted">Aucune compétition pour le moment.</p>'}
        <form class="adp-form" data-form="comp" novalidate>
          <div class="field"><label for="adp-title">${comp ? 'Titre de la compétition' : 'Nouvelle compétition'}</label><input class="input" id="adp-title" name="title" maxlength="80" value="${esc(comp?.title || '')}" placeholder="Worlds 2026"></div>
          <div class="field"><label for="adp-kind">Type</label><select class="input" id="adp-kind" name="kind">${typeOpts(comp?.kind || 'lol')}</select></div>
          ${comp ? `<label class="check"><input type="checkbox" name="active"${comp.active ? ' checked' : ''}> Visible des membres</label>` : ''}
          <div class="btn-row"><button type="submit" class="btn btn-primary">${comp ? 'Enregistrer' : 'Créer'}</button>${comp ? '<button type="button" class="btn btn-ghost" data-act="new">Nouvelle compétition</button>' : ''}</div>
        </form>
      </section>
      ${comp ? `<section class="card stack">
        <h3 class="card-title">Ajouter des matchs à « ${esc(comp.title)} »</h3>
        <div class="field"><label for="adp-lines">Une ligne par match : « [Titre :] Choix A ; Choix B[ ; Choix C…] ; date et heure de début »</label>
          <textarea class="input" id="adp-lines" rows="4" placeholder="Quart de finale · BO5 : KC ; G2 ; 30.10.2026 18:00&#10;GP de Monza : Verstappen ; Leclerc ; Norris ; 2026-09-06 15:00"></textarea>
          <p class="small muted">Heure suisse. Les pronostics ferment à l’heure de début.</p></div>
        <p class="small adp-err" role="alert" hidden></p>
        <div class="btn-row"><button type="button" class="btn btn-primary" data-act="add">Ajouter les matchs</button></div>
      </section>
      <section class="card stack"><h3 class="card-title">Matchs</h3>
        ${d.items.length ? `<ol class="adp-items">${d.items.map(ligne).join('')}</ol>` : '<p class="muted">Pas encore de match.</p>'}
      </section>` : ''}
    </div>`;
  }

  /** Lance une action avec retour visuel ; recharge la section ensuite. */
  async function action(b, fn, ok) {
    b.disabled = true;
    try { await fn(); toast(ok, 'ok'); await charge(); dessine(); }
    catch (x) { toast(errMsg(x), 'error'); b.disabled = false; }
  }
  /** Lève l'erreur d'une réponse RPC. */
  const rpc = async (f, a) => { const { data, error } = await sb.rpc(f, a); if (error) throw error; return data; };

  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const id = b.dataset.id, act = b.dataset.act;
    if (act === 'comp') { await charge(id).catch((x) => toast(errMsg(x), 'error')); dessine(); return; }
    if (act === 'new') { S.comp = null; S.d.comp = null; dessine(); root.querySelector('#adp-title')?.focus(); return; }
    if (act === 'add') {
      const { items, errors } = parseMatchs(root.querySelector('#adp-lines').value);
      const err = root.querySelector('.adp-err');
      if (errors.length || !items.length) { err.textContent = errors.join(' ') || 'Colle au moins une ligne.'; err.hidden = false; return; }
      return action(b, () => rpc('hg_pick_items_add', { p_comp: S.comp, p_items: items }), `${items.length} match${items.length > 1 ? 's' : ''} ajouté${items.length > 1 ? 's' : ''}`);
    }
    const it = S.d.items.find((x) => x.id === id);
    if (act === 'lock') {
      const iso = fromZurichInput(root.querySelector(`#adp-l-${CSS.escape(id)}`).value);
      if (!iso) { toast('Date invalide', 'error'); return; }
      return action(b, () => rpc('hg_pick_item_edit', { p_item: id, p: { locks_at: iso } }), 'Heure de début modifiée');
    }
    if (act === 'settle') {
      const r = root.querySelector(`#adp-r-${CSS.escape(id)}`).value;
      const lib = it.options.find((o) => o.id === r)?.label ?? r;
      if (!(await confirmBox(`Résultat : ${lib} ?`, 'Les gains sont versés tout de suite et le résultat ne pourra plus changer.', { ok: 'Valider le résultat' }))) return;
      return action(b, () => rpc('hg_pick_settle', { p_item: id, p_result: r }), 'Résultat enregistré, gains versés');
    }
    if (act === 'cancel') {
      if (!(await confirmBox('Annuler ce match ?', 'Toutes les mises sont rendues aux membres. Le match ne pourra plus être réglé.', { ok: 'Annuler le match', danger: true }))) return;
      return action(b, () => rpc('hg_pick_cancel', { p_item: id }), 'Match annulé, mises rendues');
    }
  });
  root.addEventListener('submit', (e) => {
    if (!e.target.matches('[data-form="comp"]')) return;
    e.preventDefault();
    const f = e.target, b = f.querySelector('[type="submit"]');
    const el = f.elements;
    const p = { title: el.title.value.trim(), kind: el.kind.value, active: el.active ? el.active.checked : true };
    action(b, async () => { S.comp = await rpc('hg_pick_comp_save', { p_id: S.comp, p }); }, S.comp ? 'Compétition enregistrée' : 'Compétition créée');
  });

  root.innerHTML = '<div class="empty">Chargement des pronostics…</div>';
  try { await charge(null); dessine(); }
  catch (x) { root.innerHTML = `<div class="empty">Pronostics indisponibles : ${esc(errMsg(x))}</div>`; }
}
