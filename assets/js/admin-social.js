// ===== Humane Gang — administration : Membres › Vie sociale (migration 090) =====
/*
 * Rôle : éditeur de la clé hg_settings « social » : plateformes du profil gaming (clé, libellé, couleur, exemple),
 * jeux proposés en favoris (nom, plateforme associée) et plafonds des mercis, groupes et sondages.
 * Le serveur borne toujours les plafonds (hg_social_cap) et retombe sur la liste par défaut si une liste est invalide.
 * Droits : admin et Staff « reglages » (RLS hg_settings_admin, hg_settings_perm('social') = 'reglages').
 * Route : #membres/social (admin.js). Conteneur : #social-root.
 * Dépendances : core.js, social.js (valeurs par défaut), ui-confirm.js.
 * Exporte : mountSocialSection, validateSocial.
 */
import { sb, esc, toast, errMsg } from './core.js';
import { DEFAULT_SOCIAL } from './social.js';
import { confirmBox } from './ui-confirm.js';

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
