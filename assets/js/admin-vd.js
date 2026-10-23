// ===== Humane Gang — administration : calendrier, ciné-club et commandes slash (idées V8, V9, D3) =====
/*
 * Rôle : deux sous-sections du panel.
 *   - Vie du gang › Calendrier et ciné (droit « evenements ») : rendez-vous récurrents du calendrier (modifier la fin,
 *     retirer) et réglage du ciné-club (projectionnistes, seuil de votants, jour et heure par défaut, clôture du vote).
 *   - Communication › Commandes slash (droit « bot ») : interrupteur par commande Discord (/paillettes, /carte, /sortie, /quiz).
 * Toutes les écritures passent par des RPC bornées et journalisées : hg_gang_slot_save, hg_gang_slot_archive,
 * hg_cine_config_set, hg_bot_commands_set (migration 087). Lectures : hg_gang_slots, hg_cine_state, hg_bot_commands_get,
 * hg_staff_directory (pseudos).
 * Routes : #vie/rdv (section #rdv, conteneur #rdv-root) et #communication/commandes (section #commandes, #commandes-root),
 * branchées par admin.js (modules facultatifs).
 * Dépendances : core.js, ui-confirm.js. Exporte : mountRdvSection, mountCommandesSection.
 */
import { sb, toast, errMsg, esc } from './core.js';
import { confirmBox } from './ui-confirm.js';

const WEEKDAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const JOURS_CINE = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const COMMANDES = [
  ['paillettes', '/paillettes', 'Solde, passage du jour et quêtes de la semaine (réponse privée).'],
  ['carte', '/carte', 'Fiche d’une carte avec autocomplétion, exemplaires et doubles (réponse privée).'],
  ['sortie', '/sortie', 'Prochaine sortie IRL avec les boutons J’y vais / Peut-être / Non.'],
  ['quiz', '/quiz', 'Une question du gang avec boutons de réponse (une seule tentative, mêmes gains que le site).'],
];

/** Pseudos des membres (annuaire du Staff). */
async function directory() {
  const { data, error } = await sb.rpc('hg_staff_directory');
  if (error) return new Map();
  return new Map((data || []).filter((p) => !p.is_ghost).map((p) => [p.id, p.pseudo]));
}

/* ---------- Vie du gang › Calendrier et ciné ---------- */

/**
 * Monte la section « Calendrier et ciné ».
 * @param {HTMLElement} root Conteneur (#rdv-root).
 */
export async function mountRdvSection(root) {
  if (!root) return;
  root.innerHTML = '<div class="empty">Chargement…</div>';
  const [slotsR, stateR, names] = await Promise.all([
    sb.from('hg_gang_slots').select('id, title, kind, weekday, every_weeks, at_time, starts_on, ends_on, link, group_slug, created_by, archived_at').is('archived_at', null).order('weekday'),
    sb.rpc('hg_cine_state'),
    directory(),
  ]);
  if (slotsR.error || stateR.error) { root.innerHTML = `<p class="empty" role="alert">Chargement impossible : ${esc(errMsg(slotsR.error || stateR.error))}</p>`; return; }
  const slots = slotsR.data || [], cfg = stateR.data?.cfg || {};
  const hosts = new Set(cfg.host_ids || []);
  root.innerHTML = `<div class="avd">
    <div class="card avd-card">
      <h3 class="avd-h">Rendez-vous récurrents du calendrier</h3>
      <p class="small muted">Créés par les membres sur la page Calendrier (5 par membre, 30 au total). Tu peux corriger leur fin ou les retirer ; chaque action est notée dans le journal.</p>
      ${slots.length ? `<ul class="avd-list">${slots.map((s) => `<li class="avd-row">
        <div class="avd-txt"><strong>${esc(s.title)}</strong><span class="small muted">${esc(`${Number(s.every_weeks) > 1 ? `toutes les ${s.every_weeks} semaines le` : 'chaque'} ${WEEKDAYS[s.weekday - 1]} à ${String(s.at_time).slice(0, 5)} · par ${names.get(s.created_by) || 'ancien membre'}${s.ends_on ? ` · jusqu’au ${s.ends_on}` : ''}`)}</span></div>
        <div class="avd-act">
          <label class="visually-hidden" for="avd-end-${esc(s.id)}">Fin de « ${esc(s.title)} »</label>
          <input class="input avd-date" type="date" id="avd-end-${esc(s.id)}" value="${esc(s.ends_on || '')}">
          <button type="button" class="btn btn-ghost" data-avd="end" data-id="${esc(s.id)}">Enregistrer la fin</button>
          <button type="button" class="btn btn-danger" data-avd="archive" data-id="${esc(s.id)}">Retirer</button>
        </div></li>`).join('')}</ul>` : '<p class="empty">Aucun rendez-vous récurrent.</p>'}
    </div>
    <form class="card avd-card stack" id="avd-cine" novalidate>
      <h3 class="avd-h">Ciné-club</h3>
      <p class="small muted">Les projectionnistes programment les séances et choisissent parmi les propositions (le Staff « evenements » le peut aussi). Sous le seuil de votants à la clôture, la séance est reportée d’une semaine ; après cinq reports, elle est annulée.</p>
      <fieldset class="avd-hosts"><legend>Projectionnistes (10 au plus)</legend>
        ${[...names.entries()].sort((a, b) => a[1].localeCompare(b[1], 'fr')).map(([id, p]) => `<label class="check"><input type="checkbox" name="host" value="${esc(id)}"${hosts.has(id) ? ' checked' : ''}><span>${esc(p)}</span></label>`).join('')}
      </fieldset>
      <div class="avd-grid">
        <div class="field"><label for="avd-seuil">Votants minimum</label><input id="avd-seuil" name="seuil" type="number" min="1" max="20" step="1" value="${esc(cfg.seuil ?? 4)}"></div>
        <div class="field"><label for="avd-jour">Jour par défaut</label><select id="avd-jour" name="jour">${JOURS_CINE.map((j, i) => `<option value="${i}"${Number(cfg.jour ?? 0) === i ? ' selected' : ''}>${j}</option>`).join('')}</select></div>
        <div class="field"><label for="avd-heure">Heure par défaut</label><input id="avd-heure" name="heure" type="time" value="${esc(cfg.heure || '20:30')}"></div>
        <div class="field"><label for="avd-clo">Clôture du vote (heures avant)</label><input id="avd-clo" name="cloture_heures" type="number" min="1" max="72" step="1" value="${esc(cfg.cloture_heures ?? 22)}"></div>
      </div>
      <p class="avd-err" role="alert" hidden></p>
      <div class="btn-row"><button type="submit" class="btn btn-primary">Enregistrer le ciné-club</button></div>
    </form>
  </div>`;
  root.querySelector('#avd-cine').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, err = f.querySelector('.avd-err');
    const host_ids = [...f.querySelectorAll('input[name="host"]:checked')].map((i) => i.value);
    const p = { host_ids, seuil: Number(f.seuil.value), jour: Number(f.jour.value), heure: f.heure.value, cloture_heures: Number(f.cloture_heures.value) };
    if (host_ids.length > 10) { err.textContent = '10 projectionnistes au plus.'; err.hidden = false; return; }
    err.hidden = true;
    const { error } = await sb.rpc('hg_cine_config_set', { p });
    if (error) { err.textContent = errMsg(error); err.hidden = false; return; }
    toast('Ciné-club enregistré');
  });
  root.onclick = async (e) => {
    const b = e.target.closest('[data-avd]'); if (!b) return;
    const s = slots.find((x) => x.id === b.dataset.id); if (!s) return;
    if (b.dataset.avd === 'archive') {
      if (!(await confirmBox(`Retirer « ${s.title} » ?`, 'Il disparaît du calendrier de tout le monde.', { ok: 'Retirer', danger: true }))) return;
      const { error } = await sb.rpc('hg_gang_slot_archive', { p_id: s.id });
      if (error) toast(errMsg(error), 'error'); else { toast('Rendez-vous retiré'); mountRdvSection(root); }
    } else if (b.dataset.avd === 'end') {
      const v = root.querySelector(`#avd-end-${CSS.escape(s.id)}`).value || null;
      const { error } = await sb.rpc('hg_gang_slot_save', { p: { id: s.id, title: s.title, kind: s.kind, weekday: s.weekday, every_weeks: s.every_weeks,
        at_time: String(s.at_time).slice(0, 5), starts_on: s.starts_on, ends_on: v, group_slug: s.group_slug, link: s.link } });
      if (error) toast(errMsg(error), 'error'); else { toast('Fin enregistrée'); mountRdvSection(root); }
    }
  };
}

/* ---------- Communication › Commandes slash ---------- */

/**
 * Monte la section « Commandes slash » (interrupteurs).
 * @param {HTMLElement} root Conteneur (#commandes-root).
 */
export async function mountCommandesSection(root) {
  if (!root) return;
  const { data, error } = await sb.rpc('hg_bot_commands_get');
  if (error) { root.innerHTML = `<p class="empty" role="alert">Chargement impossible : ${esc(errMsg(error))}</p>`; return; }
  const on = data || {};
  root.innerHTML = `<div class="card avd-card stack">
    <p class="small muted">Commandes tapées dans Discord avec « / ». Seuls les membres dont l’identifiant Discord est enregistré (fiche du compte) peuvent s’en servir ; les réponses personnelles ne sont visibles que de leur auteur. Une commande coupée répond « désactivée ».</p>
    <ul class="avd-list">${COMMANDES.map(([k, name, desc]) => `<li class="avd-row">
      <label class="switch-row avd-switch"><input type="checkbox" role="switch" data-cmd="${k}"${on[k] !== false ? ' checked' : ''}>
        <span class="avd-txt"><strong>${esc(name)}</strong><span class="small muted">${esc(desc)}</span></span></label></li>`).join('')}</ul>
    <p class="small muted">Mise en service : voir BOT.md (section « Commandes slash ») pour l’adresse d’interactions et l’enregistrement des commandes.</p>
  </div>`;
  root.onchange = async (e) => {
    const i = e.target.closest('[data-cmd]'); if (!i) return;
    i.disabled = true;
    const { error: err } = await sb.rpc('hg_bot_commands_set', { p: { [i.dataset.cmd]: i.checked } });
    i.disabled = false;
    if (err) { i.checked = !i.checked; toast(errMsg(err), 'error'); return; }
    toast(`/${i.dataset.cmd} ${i.checked ? 'activée' : 'désactivée'}`);
  };
}
