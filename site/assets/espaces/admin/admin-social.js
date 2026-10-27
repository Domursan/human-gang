// ===== Humane Gang — administration : Membres › Vie sociale (migration 090) =====
/*
 * Rôle : éditeur de la clé hg_settings « social » : plateformes du profil gaming (clé, libellé, couleur, exemple),
 * jeux proposés en favoris (nom, plateforme associée) et plafonds des mercis, groupes et sondages.
 * Le serveur borne toujours les plafonds (hg_social_cap) et retombe sur la liste par défaut si une liste est invalide.
 * Droits : admin et Staff « reglages » (RLS hg_settings_admin, hg_settings_perm('social') = 'reglages').
 * Route : #place/social (admin.js). Conteneur : #social-root.
 * Dépendances : core.js, social.js (valeurs par défaut), ui-confirm.js.
 * Exporte : mountSocialSection, validateSocial.
 * (Ce fichier réunit aussi les sections de la migration 091 : Parrainage, Compétences, Accueil des membres, plus bas.)
 */
import { sb, esc, toast, errMsg } from '../../commun/core.js';
import { DEFAULT_SOCIAL } from '../compte/social.js';
import { confirmBox } from '../../commun/ui-confirm.js';
import { HOME_BLOCKS, HOME_DEFAULT } from '../accueil/home-registry.js';
import { slugId } from './admin-champs.js';

/** Plafonds réglables : clé, libellé, minimum, maximum (mêmes bornes que le serveur). */
const CAPS = [
  ['mercis_jour', 'Mercis donnés par jour et par membre', 1, 10],
  ['groupe_membres_max', 'Personnes par groupe', 2, 50],
  ['groupes_semaine', 'Groupes libres créés par semaine et par membre', 1, 20],
  ['sondages_jour', 'Sondages créés par jour et par membre', 1, 10],
  ['sondages_accueil', 'Sondages ouverts affichés en carte sur l’accueil', 1, 10],
];
const KEY_RE = /^[a-z][a-z0-9_]{1,30}$/;

/**
 * Vérifie et normalise la valeur à enregistrer ; renvoie { value } ou { error }.
 * @param {{plateformes: Array, jeux: Array, plafonds: object}} v
 */
export function validateSocial(v) {
  const seen = new Set();
  const plats = [];
  for (const p of v.plateformes) {
    const key = String(p.key || '').trim(), label = String(p.label || '').trim();
    if (!KEY_RE.test(key)) return { error: `Clé de plateforme invalide : « ${key} » (minuscules, chiffres, _)` };
    if (seen.has(key)) return { error: `Clé en double : ${key}` };
    if (!label || label.length > 40) return { error: `Libellé de « ${key} » : 1 à 40 caractères` };
    seen.add(key);
    plats.push({ key, label, color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#ABA7A0', ...(p.placeholder ? { placeholder: String(p.placeholder).slice(0, 40) } : {}) });
  }
  if (!plats.length || plats.length > 30) return { error: '1 à 30 plateformes' };
  const names = new Set();
  const jeux = [];
  for (const j of v.jeux) {
    const nom = String(j.nom || '').trim();
    if (!nom || nom.length > 30) return { error: 'Nom de jeu : 1 à 30 caractères' };
    if (names.has(nom.toLowerCase())) return { error: `Jeu en double : ${nom}` };
    names.add(nom.toLowerCase());
    jeux.push({ nom, plateforme: seen.has(j.plateforme) ? j.plateforme : null });
  }
  if (!jeux.length || jeux.length > 40) return { error: '1 à 40 jeux' };
  const plafonds = {};
  for (const [k, , min, max] of CAPS) {
    const n = Number(v.plafonds[k]);
    if (!Number.isInteger(n) || n < min || n > max) return { error: `Plafond « ${k} » : entre ${min} et ${max}` };
    plafonds[k] = n;
  }
  return { value: { gaming: { plateformes: plats, jeux }, plafonds } };
}

/** État : valeur en cours d'édition et conteneur. */
const S = { root: null, v: null, busy: false };

/**
 * Monte la section et charge la clé « social » (valeurs par défaut si absente).
 * @param {HTMLElement} root conteneur #social-root
 */
export async function mountSocialSection(root) {
  if (!root) return;
  S.root = root;
  let raw = null;
  try {
    const { data, error } = await sb.from('hg_settings').select('value').eq('key', 'social').maybeSingle();
    if (error) throw error;
    raw = data?.value || null;
  } catch (e) { root.innerHTML = `<div class="empty">Lecture impossible : ${esc(errMsg(e))}</div>`; return; }
  const d = structuredClone(DEFAULT_SOCIAL);
  S.v = {
    plateformes: Array.isArray(raw?.gaming?.plateformes) ? structuredClone(raw.gaming.plateformes) : d.gaming.plateformes,
    jeux: Array.isArray(raw?.gaming?.jeux) ? structuredClone(raw.gaming.jeux) : d.gaming.jeux,
    plafonds: { ...d.plafonds, ...(raw?.plafonds || {}) },
  };
  render();
  root.addEventListener('click', onClick);
  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);
}

/** Dessine l'éditeur. */
function render() {
  const v = S.v;
  S.root.innerHTML = `<form class="asoc stack" id="asoc-form" novalidate>
    <p class="small muted">Profil gaming (fiche des membres), mercis, groupes de la messagerie et sondages de l’accueil. Les valeurs hors bornes sont refusées ; le site garde sa liste d’origine si une liste est invalide.</p>
    <fieldset class="asoc-block"><legend>Plateformes du profil gaming</legend>
      <ul class="asoc-list">${v.plateformes.map((p, i) => `<li class="asoc-row">
        <label class="asoc-f"><span class="small muted">Libellé</span><input data-p="${i}" data-k="label" maxlength="40" value="${esc(p.label || '')}"></label>
        <label class="asoc-f"><span class="small muted">Clé</span><input data-p="${i}" data-k="key" maxlength="31" value="${esc(p.key || '')}"></label>
        <label class="asoc-f asoc-color"><span class="small muted">Couleur</span><input type="color" data-p="${i}" data-k="color" value="${esc(/^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#ABA7A0')}"></label>
        <label class="asoc-f"><span class="small muted">Exemple</span><input data-p="${i}" data-k="placeholder" maxlength="40" value="${esc(p.placeholder || '')}"></label>
        <button type="button" class="btn btn-ghost" data-act="rm-p" data-i="${i}" aria-label="Retirer la plateforme ${esc(p.label || p.key || '')}">Retirer</button>
      </li>`).join('')}</ul>
      <div class="btn-row"><button type="button" class="btn btn-ghost" data-act="add-p">Ajouter une plateforme</button></div>
    </fieldset>
    <fieldset class="asoc-block"><legend>Jeux proposés (favoris, « Qui joue à… »)</legend>
      <ul class="asoc-list">${v.jeux.map((j, i) => `<li class="asoc-row">
        <label class="asoc-f"><span class="small muted">Jeu</span><input data-j="${i}" data-k="nom" maxlength="30" value="${esc(j.nom || '')}"></label>
        <label class="asoc-f"><span class="small muted">Pseudo affiché</span><select data-j="${i}" data-k="plateforme"><option value="">Aucun</option>${v.plateformes.map((p) => `<option value="${esc(p.key)}"${p.key === j.plateforme ? ' selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>
        <button type="button" class="btn btn-ghost" data-act="rm-j" data-i="${i}" aria-label="Retirer le jeu ${esc(j.nom || '')}">Retirer</button>
      </li>`).join('')}</ul>
      <div class="btn-row"><button type="button" class="btn btn-ghost" data-act="add-j">Ajouter un jeu</button></div>
    </fieldset>
    <fieldset class="asoc-block"><legend>Plafonds</legend>
      <div class="asoc-caps">${CAPS.map(([k, l, min, max]) => `<label class="asoc-f"><span>${esc(l)} <span class="small muted">(${min} à ${max})</span></span>
        <input type="number" inputmode="numeric" min="${min}" max="${max}" step="1" data-cap="${k}" value="${esc(String(v.plafonds[k]))}"></label>`).join('')}</div>
    </fieldset>
    <p class="form-error" id="asoc-err" role="alert" hidden></p>
    <div class="btn-row">
      <button type="submit" class="btn btn-primary" data-act="save">Enregistrer</button>
      <button type="button" class="btn btn-ghost" data-act="reset">Revenir aux valeurs d’origine</button>
    </div>
  </form>`;
  S.root.querySelector('#asoc-form').addEventListener('submit', (e) => { e.preventDefault(); save(); });
}

/** Saisie : met à jour la valeur en mémoire sans redessiner. */
function onInput(e) {
  const t = e.target;
  if (t.dataset.p !== undefined) S.v.plateformes[Number(t.dataset.p)][t.dataset.k] = t.value;
  else if (t.dataset.j !== undefined) S.v.jeux[Number(t.dataset.j)][t.dataset.k] = t.value || null;
  else if (t.dataset.cap) S.v.plafonds[t.dataset.cap] = Number(t.value);
}

/** Boutons : ajout, retrait, valeurs d'origine. */
async function onClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b || b.dataset.act === 'save') return;
  const a = b.dataset.act;
  if (a === 'add-p') S.v.plateformes.push({ key: '', label: '', color: '#ABA7A0' });
  else if (a === 'rm-p') S.v.plateformes.splice(Number(b.dataset.i), 1);
  else if (a === 'add-j') S.v.jeux.push({ nom: '', plateforme: null });
  else if (a === 'rm-j') S.v.jeux.splice(Number(b.dataset.i), 1);
  else if (a === 'reset') {
    if (!(await confirmBox('Revenir aux valeurs d’origine ?', 'Plateformes, jeux et plafonds reprennent leurs valeurs par défaut (pas encore enregistrées).', { ok: 'Revenir' }))) return;
    const d = structuredClone(DEFAULT_SOCIAL);
    S.v = { plateformes: d.gaming.plateformes, jeux: d.gaming.jeux, plafonds: d.plafonds };
  }
  render();
}

/** Vérifie puis enregistre la clé « social ». */
async function save() {
  const err = S.root.querySelector('#asoc-err');
  const r = validateSocial(S.v);
  if (r.error) { err.textContent = r.error; err.hidden = false; return; }
  err.hidden = true;
  if (S.busy) return;
  S.busy = true;
  try {
    const { error } = await sb.from('hg_settings').upsert({ key: 'social', value: r.value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    toast('Réglages de la vie sociale enregistrés', 'ok');
  } catch (e) { err.textContent = `Enregistrement impossible : ${errMsg(e)}`; err.hidden = false; }
  finally { S.busy = false; }
}

// ===== Humane Gang — administration : idées « Social et profils » (P6, P7, P8, P9) =====
/*
 * Trois sous-sections, chacune montée à sa première visite (admin.js, modules facultatifs) :
 *  - Membres › Parrainage (#place/parrainage, droit « membres ») : réglage hg_settings.parrainage (Paillettes 0 à 200,
 *    durée, filleuls par parrain, cartes Parrain / Filleul), attribution d'un parrain volontaire à un nouveau
 *    (RPC hg_mentor_assign, journalisée), duos en cours (annulation : hg_mentor_cancel), parrain d'un lien d'invitation
 *    (hg_invite_link_set_mentor).
 *  - Membres › Compétences (#place/competences, droit « membres ») : catalogue hg_settings.competences (code figé une
 *    fois enregistré, libellé, ordre). Pas de compétences humoristiques qui visent quelqu'un.
 *  - Site › Accueil des membres (#place/accueil, droit « reglages ») : accueil par défaut (hg_settings.home_default : ordre,
 *    blocs affichés, blocs obligatoires) et encart « Toi et … » (hg_settings.social.amitie).
 * Bornes et journal admin : trigger hg_settings_social_guard (migration 091).
 * Dépendances : core.js, home-registry.js, admin-champs.js (slugId). Exporte : mountParrainageSection,
 * mountCompetencesSection, mountAccueilSection.
 */

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
        <p class="small muted">Les cartes « Parrain » et « Filleul » se créent dans Le jeu de cartes › Cartes (série « Hors série »). Le badge « Parrain » (niveaux 1, 3 et 5 filleuls) est attribué automatiquement.</p>
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
