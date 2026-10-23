// ===== Humane Gang — administration : idées « Social et profils » (P6, P7, P8, P9) =====
/*
 * Trois sous-sections, chacune montée à sa première visite (admin.js, modules facultatifs) :
 *  - Membres › Parrainage (#membres/parrainage, droit « membres ») : réglage hg_settings.parrainage (Paillettes 0 à 200,
 *    durée, filleuls par parrain, cartes Parrain / Filleul), attribution d'un parrain volontaire à un nouveau
 *    (RPC hg_mentor_assign, journalisée), duos en cours (annulation : hg_mentor_cancel), parrain d'un lien d'invitation
 *    (hg_invite_link_set_mentor).
 *  - Membres › Compétences (#membres/competences, droit « membres ») : catalogue hg_settings.competences (code figé une
 *    fois enregistré, libellé, ordre). Pas de compétences humoristiques qui visent quelqu'un.
 *  - Site › Accueil des membres (#site/accueil, droit « reglages ») : accueil par défaut (hg_settings.home_default : ordre,
 *    blocs affichés, blocs obligatoires) et encart « Toi et … » (hg_settings.social.amitie).
 * Bornes et journal admin : trigger hg_settings_social_guard (migration 091).
 * Dépendances : core.js, home-registry.js, admin-champs.js (slugId). Exporte : mountParrainageSection,
 * mountCompetencesSection, mountAccueilSection.
 */
import { sb, toast, errMsg, esc } from './core.js';
import { HOME_BLOCKS, HOME_DEFAULT } from './home-registry.js';
import { slugId } from './admin-champs.js';

/** Lit une clé de hg_settings (valeur ou null). */
async function readKey(key) {
  const { data, error } = await sb.from('hg_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}
/** Écrit une clé de hg_settings. */
async function writeKey(key, value) {
  const { error } = await sb.from('hg_settings').upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}
/** Entier borné lu dans un champ. */
const intIn = (el, min, max, def) => { const n = Math.round(Number(el.value)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };

/* =====================================================================
   Parrainage (P8)
   ===================================================================== */
/**
 * Monte la sous-section Parrainage.
 * @param {HTMLElement} root conteneur #parrainage-root
 */
export async function mountParrainageSection(root) {
  root.innerHTML = '<div class="empty">Chargement du parrainage…</div>';
  let cfg, cards, people, duos, links;
  try {
    const [c, k, p, d, l] = await Promise.all([
      readKey('parrainage'),
      sb.from('hg_cards').select('id,name,active').eq('active', true).order('name'),
      sb.from('hg_profiles').select('id,pseudo,joined_on,mentor_volunteer,is_ghost').order('pseudo'),
      sb.from('hg_mentorships').select('*').order('started_at', { ascending: false }),
      sb.from('hg_invite_links').select('id,label,token,active,mentor_id').order('created_at', { ascending: false }),
    ]);
    for (const r of [k, p, d, l]) if (r.error) throw r.error;
    cfg = { actif: true, paillettes: 50, duree_jours: 7, max_filleuls: 2, nouveau_jours: 30, carte_parrain: null, carte_filleul: null, ...(c || {}) };
    cards = k.data || []; people = (p.data || []).filter((x) => !x.is_ghost); duos = d.data || []; links = (l.data || []).filter((x) => x.active);
  } catch (e) { root.innerHTML = `<p class="empty">Impossible de charger le parrainage (${esc(errMsg(e))}).</p>`; return; }
  const name = (id) => people.find((x) => x.id === id)?.pseudo || 'Ancien membre';
  const cutoff = new Date(Date.now() - cfg.nouveau_jours * 864e5).toISOString().slice(0, 10);
  const mentored = new Set(duos.map((x) => x.mentee_id));
  const news = people.filter((x) => (x.joined_on || '') >= cutoff && !mentored.has(x.id));
  const vols = people.filter((x) => x.mentor_volunteer);
  const cardSel = (id, val) => `<select id="${id}"><option value="">Aucune carte</option>${cards.map((c) => `<option value="${esc(c.id)}"${c.id === val ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
  const now = Date.now();
  const status = (x) => (x.cancelled_at ? 'Annulé' : x.claimed_mentor_at && x.claimed_mentee_at ? 'Réussi'
    : new Date(x.ends_at).getTime() + 864e5 < now ? 'Terminé sans tout finir' : 'En cours');
  root.innerHTML = `
    <div class="stack">
      <form class="card stack" id="pr-cfg" novalidate>
        <h3 class="card-title">Réglages</h3>
        <label class="check"><input type="checkbox" id="pr-actif"${cfg.actif !== false ? ' checked' : ''}> <span>Parrainage actif</span></label>
        <div class="grid">
          <div class="field"><label for="pr-pai">Paillettes pour chacun (0 à 200)</label><input id="pr-pai" type="number" min="0" max="200" value="${esc(String(cfg.paillettes))}"></div>
          <div class="field"><label for="pr-duree">Durée de la semaine d’accueil (jours, 3 à 30)</label><input id="pr-duree" type="number" min="3" max="30" value="${esc(String(cfg.duree_jours))}"></div>
          <div class="field"><label for="pr-max">Filleuls en cours par parrain (1 à 5)</label><input id="pr-max" type="number" min="1" max="5" value="${esc(String(cfg.max_filleuls))}"></div>
          <div class="field"><label for="pr-new">« Nouveau » : arrivé depuis (jours, 1 à 90)</label><input id="pr-new" type="number" min="1" max="90" value="${esc(String(cfg.nouveau_jours))}"></div>
          <div class="field"><label for="pr-cp">Carte du parrain</label>${cardSel('pr-cp', cfg.carte_parrain)}</div>
          <div class="field"><label for="pr-cf">Carte du filleul</label>${cardSel('pr-cf', cfg.carte_filleul)}</div>
        </div>
        <p class="small muted">Les cartes « Parrain » et « Filleul » se créent dans Jeux et cartes › Cartes (série « Hors série »). Le badge « Parrain » (niveaux 1, 3 et 5 filleuls) est attribué automatiquement.</p>
        <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer</button></div>
      </form>

      <form class="card stack" id="pr-assign" novalidate>
        <h3 class="card-title">Attribuer un parrain</h3>
        <p class="small muted">Facultatif : seulement pour un nouveau (arrivé depuis moins de ${esc(String(cfg.nouveau_jours))} jours), et un parrain qui a coché « Je veux bien parrainer ».</p>
        <div class="grid">
          <div class="field"><label for="pr-mentee">Nouveau</label><select id="pr-mentee"><option value="">Choisir…</option>${news.map((x) => `<option value="${esc(x.id)}">${esc(x.pseudo)}</option>`).join('')}</select></div>
          <div class="field"><label for="pr-mentor">Parrain ou marraine</label><select id="pr-mentor"><option value="">Choisir…</option>${vols.map((x) => `<option value="${esc(x.id)}">${esc(x.pseudo)}</option>`).join('')}</select></div>
        </div>
        ${!vols.length ? '<p class="small muted">Aucun volontaire pour l’instant.</p>' : ''}
        <div class="btn-row"><button class="btn btn-primary" type="submit">Attribuer</button></div>
      </form>

      <div class="card stack">
        <h3 class="card-title">Duos</h3>
        ${duos.length ? `<ul class="pr-duos">${duos.map((x) => `<li class="pr-duo">
          <span><strong>${esc(name(x.mentee_id))}</strong> ← ${esc(name(x.mentor_id))} <span class="small muted">· ${esc(status(x))}${x.source === 'lien' ? ' · par lien' : ''}</span></span>
          ${!x.cancelled_at && !x.claimed_mentor_at && !x.claimed_mentee_at ? `<button class="btn btn-ghost" type="button" data-pr-cancel="${esc(x.mentee_id)}">Annuler</button>` : ''}
        </li>`).join('')}</ul>` : '<p class="small muted">Aucun parrainage pour l’instant.</p>'}
      </div>

      <div class="card stack">
        <h3 class="card-title">Parrain d’un lien d’invitation</h3>
        <p class="small muted">Les personnes qui rejoignent par ce lien reçoivent automatiquement ce parrain (si les conditions sont réunies).</p>
        ${links.length ? `<ul class="pr-duos">${links.map((x) => `<li class="pr-duo">
          <label for="pr-link-${esc(x.id)}">${esc(x.label || 'Lien sans nom')}</label>
          <select id="pr-link-${esc(x.id)}" data-pr-link="${esc(x.id)}"><option value="">Aucun parrain</option>${vols.map((v) => `<option value="${esc(v.id)}"${v.id === x.mentor_id ? ' selected' : ''}>${esc(v.pseudo)}</option>`).join('')}</select>
        </li>`).join('')}</ul>` : '<p class="small muted">Aucun lien actif.</p>'}
      </div>
    </div>`;

  root.querySelector('#pr-cfg').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const value = {
      actif: root.querySelector('#pr-actif').checked,
      paillettes: intIn(root.querySelector('#pr-pai'), 0, 200, 50),
      duree_jours: intIn(root.querySelector('#pr-duree'), 3, 30, 7),
      max_filleuls: intIn(root.querySelector('#pr-max'), 1, 5, 2),
      nouveau_jours: intIn(root.querySelector('#pr-new'), 1, 90, 30),
      carte_parrain: root.querySelector('#pr-cp').value || null,
      carte_filleul: root.querySelector('#pr-cf').value || null,
    };
    try { await writeKey('parrainage', value); toast('Réglages du parrainage enregistrés.', 'ok'); mountParrainageSection(root); }
    catch (e) { toast(`Enregistrement impossible : ${errMsg(e)}`, 'error'); }
  });
  root.querySelector('#pr-assign').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const mentee = root.querySelector('#pr-mentee').value, mentor = root.querySelector('#pr-mentor').value;
    if (!mentee || !mentor) { toast('Choisis le nouveau et son parrain.', 'error'); return; }
    const { error } = await sb.rpc('hg_mentor_assign', { p_mentee: mentee, p_mentor: mentor });
    if (error) { toast(errMsg(error), 'error'); return; }
    toast(`${name(mentor)} parraine ${name(mentee)} cette semaine.`, 'ok');
    mountParrainageSection(root);
  });
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-pr-cancel]');
    if (!b) return;
    b.disabled = true;
    const { error } = await sb.rpc('hg_mentor_cancel', { p_mentee: b.dataset.prCancel });
    if (error) { toast(errMsg(error), 'error'); b.disabled = false; return; }
    toast('Parrainage annulé.', 'ok');
    mountParrainageSection(root);
  });
  root.addEventListener('change', async (ev) => {
    const s = ev.target.closest('[data-pr-link]');
    if (!s) return;
    const { error } = await sb.rpc('hg_invite_link_set_mentor', { p_link: s.dataset.prLink, p_mentor: s.value || null });
    if (error) toast(errMsg(error), 'error'); else toast('Parrain du lien enregistré.', 'ok');
  });
}

/* =====================================================================
   Compétences (P7)
   ===================================================================== */
/**
 * Monte la sous-section Compétences : liste ordonnée { code, label }, 40 au plus.
 * @param {HTMLElement} root conteneur #competences-root
 */
export async function mountCompetencesSection(root) {
  root.innerHTML = '<div class="empty">Chargement des compétences…</div>';
  let list;
  try { const v = await readKey('competences'); list = (Array.isArray(v) ? v : []).map((c) => ({ ...c, saved: true })); }
  catch (e) { root.innerHTML = `<p class="empty">Impossible de lire les compétences (${esc(errMsg(e))}).</p>`; return; }
  const render = () => {
    root.innerHTML = `
      <form class="card stack" id="cp-form" novalidate>
        <p class="small muted">Liste proposée dans « Je peux aider pour… » (page Compte). ${list.length} compétence${list.length > 1 ? 's' : ''} sur 40. Le code d’une compétence enregistrée est figé : les choix des membres en dépendent. Pas de compétence humoristique qui vise quelqu’un.</p>
        <ol class="cp-list">${list.map((c, i) => `<li class="cp-row" data-i="${i}">
          <div class="field"><label for="cp-l-${i}">Libellé</label><input id="cp-l-${i}" data-cp-label maxlength="40" value="${esc(c.label)}"></div>
          <span class="small muted">Code : <code>${esc(c.code || slugId(c.label))}</code></span>
          <div class="btn-row">
            <button class="btn btn-ghost" type="button" data-cp="up" aria-label="Monter « ${esc(c.label)} »"${i ? '' : ' disabled'}>↑</button>
            <button class="btn btn-ghost" type="button" data-cp="down" aria-label="Descendre « ${esc(c.label)} »"${i < list.length - 1 ? '' : ' disabled'}>↓</button>
            <button class="btn btn-ghost" type="button" data-cp="remove" aria-label="Retirer « ${esc(c.label)} »">Retirer</button>
          </div>
        </li>`).join('')}</ol>
        <div class="field"><label for="cp-new">Nouvelle compétence</label><input id="cp-new" maxlength="40" placeholder="ex. Photographie"></div>
        <div class="btn-row"><button class="btn btn-ghost" type="button" data-cp="add"${list.length >= 40 ? ' disabled' : ''}>Ajouter</button><button class="btn btn-primary" type="submit">Enregistrer</button></div>
      </form>`;
  };
  render();
  root.addEventListener('input', (ev) => {
    const inp = ev.target.closest('[data-cp-label]');
    if (inp) list[Number(inp.closest('.cp-row').dataset.i)].label = inp.value;
  });
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-cp]');
    if (!b) return;
    const i = Number(b.closest('.cp-row')?.dataset.i);
    if (b.dataset.cp === 'up' && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
    if (b.dataset.cp === 'down' && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
    if (b.dataset.cp === 'remove') list.splice(i, 1);
    if (b.dataset.cp === 'add') {
      const label = root.querySelector('#cp-new').value.trim();
      if (label.length < 2) { toast('Libellé de 2 caractères au moins.', 'error'); return; }
      let code = slugId(label).slice(0, 30) || 'competence', n = 2;
      while (list.some((c) => c.code === code)) code = `${slugId(label).slice(0, 27)}_${n++}`;
      list.push({ code, label, saved: false });
    }
    render();
  });
  root.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const value = list.map((c) => ({ code: c.code, label: String(c.label).trim() }));
    if (value.some((c) => c.label.length < 2)) { toast('Chaque compétence a un libellé de 2 caractères au moins.', 'error'); return; }
    try { await writeKey('competences', value); list.forEach((c) => { c.saved = true; }); toast('Compétences enregistrées.', 'ok'); }
    catch (e) { toast(`Enregistrement impossible : ${errMsg(e)}`, 'error'); }
  });
}

/* =====================================================================
   Accueil des membres (P9) et encart « Toi et … » (P6)
   ===================================================================== */
/**
 * Monte la sous-section Accueil des membres.
 * @param {HTMLElement} root conteneur #accueil-root
 */
export async function mountAccueilSection(root) {
  root.innerHTML = '<div class="empty">Chargement…</div>';
  let def, social;
  try {
    const [d, s] = await Promise.all([readKey('home_default'), readKey('social')]);
    def = { ordre: Array.isArray(d?.ordre) ? d.ordre : HOME_DEFAULT.ordre, obligatoires: Array.isArray(d?.obligatoires) ? d.obligatoires : HOME_DEFAULT.obligatoires };
    social = s && typeof s === 'object' ? s : { amitie: true };
  } catch (e) { root.innerHTML = `<p class="empty">Impossible de lire les réglages (${esc(errMsg(e))}).</p>`; return; }
  const blocks = HOME_BLOCKS.filter((b) => !b.auto);
  // Ordre : les blocs du défaut d'abord, puis les autres (en réserve)
  let rows = [...def.ordre.filter((id) => blocks.some((b) => b.id === id)), ...blocks.map((b) => b.id).filter((id) => !def.ordre.includes(id))]
    .map((id) => ({ id, on: def.ordre.includes(id), req: def.obligatoires.includes(id) || !!blocks.find((b) => b.id === id)?.required }));
  const label = (id) => blocks.find((b) => b.id === id)?.label || id;
  const render = () => {
    root.innerHTML = `
      <form class="stack" id="ha-form" novalidate>
        <div class="card stack">
          <h3 class="card-title">Souvenirs communs (« Toi et … »)</h3>
          <label class="check"><input type="checkbox" id="ha-amitie"${social.amitie !== false ? ' checked' : ''}> <span>Afficher l’encart « Toi et … » sur les fiches des membres (chaque membre peut aussi le masquer pour lui)</span></label>
        </div>
        <div class="card stack">
          <h3 class="card-title">Accueil par défaut</h3>
          <p class="small muted">Ordre des blocs pour les membres qui n’ont pas personnalisé leur accueil. Un bloc décoché reste dans la réserve « Blocs disponibles ». Un bloc obligatoire ne peut pas être masqué.</p>
          <ol class="ha-list">${rows.map((r, i) => `<li class="ha-row" data-i="${i}">
            <strong class="ha-name">${esc(label(r.id))}</strong>
            <label class="check"><input type="checkbox" data-ha="on"${r.on || r.req ? ' checked' : ''}${r.req ? ' disabled' : ''}> <span>Affiché</span></label>
            <label class="check"><input type="checkbox" data-ha="req"${r.req ? ' checked' : ''}${blocks.find((b) => b.id === r.id)?.required ? ' disabled' : ''}> <span>Obligatoire</span></label>
            <button class="btn btn-ghost" type="button" data-ha="up" aria-label="Monter « ${esc(label(r.id))} »"${i ? '' : ' disabled'}>↑</button>
            <button class="btn btn-ghost" type="button" data-ha="down" aria-label="Descendre « ${esc(label(r.id))} »"${i < rows.length - 1 ? '' : ' disabled'}>↓</button>
          </li>`).join('')}</ol>
        </div>
        <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer</button></div>
      </form>`;
  };
  render();
  root.addEventListener('change', (ev) => {
    const c = ev.target.closest('[data-ha]');
    if (!c) return;
    const r = rows[Number(c.closest('.ha-row').dataset.i)];
    if (c.dataset.ha === 'on') r.on = c.checked;
    if (c.dataset.ha === 'req') { r.req = c.checked; if (r.req) r.on = true; render(); }
  });
  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-ha]');
    if (!b) return;
    const i = Number(b.closest('.ha-row').dataset.i), j = b.dataset.ha === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= rows.length) return;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    render();
  });
  root.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await writeKey('home_default', { ordre: rows.filter((r) => r.on || r.req).map((r) => r.id), obligatoires: rows.filter((r) => r.req).map((r) => r.id) });
      await writeKey('social', { ...social, amitie: root.querySelector('#ha-amitie').checked });
      toast('Accueil enregistré.', 'ok');
    } catch (e) { toast(`Enregistrement impossible : ${errMsg(e)}`, 'error'); }
  });
}
