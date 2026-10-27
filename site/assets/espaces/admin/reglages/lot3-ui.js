// =====================================================================
// Admin : réglages du lot 3 (Secret Santa, sorties IRL, souvenirs et albums), affichés en tête de chaque sous-section.
// Un bloc repliable : formulaire groupé, aide sous chaque champ, validation, « Rétablir la valeur par défaut »
// par champ et par groupe. Enregistrement dans hg_settings (clés ss, irl, albums, photos).
// La politique RLS de hg_settings exige l'administrateur ou le droit « reglages » : sans l'un des deux, le bloc est en lecture seule.
// Dépendances : core.js (sb, toast, errMsg, esc), core/profile.js, core/perms.js (hasPerm), keys-lot3.js (champs et domaines),
// reglages-valeurs-lot3.js (lecture et écriture en mémoire des valeurs).
// Exporte : blocReglages (le bloc à insérer dans une sous-section).
// =====================================================================
import { sb, toast, errMsg, esc } from '../core.js';
import { getCachedProfile } from '../core/profile.js';
import { hasPerm } from '../core/perms.js';
import { CHAMPS_LOT3, DOMAINES_LOT3 } from './keys-lot3.js';
import { chargerReglagesLot3, majReglagesLot3, reglage, objetLot3 } from '../reglages-valeurs-lot3.js';

/* Vrai si l'utilisateur peut enregistrer ces réglages : administrateur, ou droit « reglages ». */
const peutEcrire = () => !!getCachedProfile()?.is_admin || hasPerm('reglages');
/* Champs d'un domaine (ss, irl ou souvenirs). */
const champsDe = (domaine) => CHAMPS_LOT3.filter((c) => c.domaine === domaine);
/* Identifiant HTML d'un champ de réglage, unique sur la page. */
const idOf = (c) => `rg3-${c.cle}-${c.champ}`;

/* Styles du bloc, ajoutés une seule fois dans la page. */
const STYLE = `
.rg3-bloc { margin: 0 0 16px; }
.rg3-bloc > summary { cursor: pointer; font-weight: 600; padding: 6px 0; }
.rg3-body { padding-top: 8px; }
.rg3-groupe { border: 1px solid currentColor; border-color: color-mix(in srgb, currentColor 22%, transparent); border-radius: 12px; padding: 10px 14px 12px; margin: 0 0 14px; min-width: 0; }
.rg3-groupe legend { padding: 0 6px; font-weight: 600; }
.rg3-field { margin-bottom: 12px; }
.rg3-line { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; margin: 4px 0 0; }
.rg3-line > .small { flex: 1 1 220px; }
.rg3-check { display: flex; gap: 8px; align-items: center; }
.rg3-actions { margin-top: 8px; }
`;
/** Ajoute la feuille de style du bloc dans le document, une seule fois. */
function ajouterStyle() {
  if (document.getElementById('rg3-style')) return;
  const st = document.createElement('style');
  st.id = 'rg3-style';
  st.textContent = STYLE;
  document.head.append(st);
}

/** Bloc de réglages d'un domaine (« ss », « irl » ou « souvenirs »). À insérer en tête de la sous-section. */
export function blocReglages(domaine) {
  ajouterStyle();
  const det = document.createElement('details');
  det.className = 'rg3-bloc';
  det.dataset.domaine = domaine;
  det.innerHTML = `<summary>Réglages : ${esc(DOMAINES_LOT3[domaine].titre)}</summary>
    <div class="rg3-body"><p class="small muted">Chargement des réglages…</p></div>`;
  det.addEventListener('click', (e) => onClick(e, det));
  det.addEventListener('submit', (e) => onSubmit(e, det));
  chargerReglagesLot3({ force: true }).then(() => render(det, domaine));
  return det;
}

/** Dessine le formulaire d'un domaine : groupes, champs, boutons. Lecture seule sans droit d'écriture. */
function render(det, domaine) {
  const ecriture = peutEcrire();
  const champs = champsDe(domaine);
  const groupes = [...new Set(champs.map((c) => c.groupe))];
  det.querySelector('.rg3-body').innerHTML = `
    <p class="small muted">Ces réglages s'appliquent au site dès l'enregistrement. Vide ou « Rétablir » : la valeur par défaut de l'application.</p>
    ${ecriture ? '' : '<p class="small muted" role="note">Lecture seule : ton rôle ne permet pas de modifier ces réglages.</p>'}
    <form class="rg3-form" novalidate>
      ${groupes.map((g) => `
        <fieldset class="rg3-groupe">
          <legend>${esc(g)}</legend>
          ${champs.filter((c) => c.groupe === g).map((c) => fieldHtml(c, ecriture)).join('')}
          ${ecriture ? `<p class="rg3-line"><button class="btn btn-ghost btn-sm" type="button" data-rg3-reset-groupe="${esc(domaine)}|${esc(g)}">Rétablir ce groupe</button></p>` : ''}
        </fieldset>`).join('')}
      ${ecriture ? '<div class="rg3-actions"><button class="btn btn-primary btn-sm" type="submit">Enregistrer</button></div>' : ''}
    </form>`;
}

/** HTML d'un champ : contrôle adapté à son type, aide avec la valeur par défaut, bouton « Rétablir ». */
function fieldHtml(c, ecriture) {
  const id = idOf(c);
  const val = reglage(`${c.cle}.${c.champ}`);
  const dis = ecriture ? '' : ' disabled';
  const defTxt = c.defaut === null || c.defaut === undefined ? 'vide' : c.type === 'bool' ? (c.defaut ? 'oui' : 'non') : String(c.defaut).replace('.', ',');
  const aide = `<span class="small muted" id="${id}-h">${esc(c.aide)} Défaut : ${esc(defTxt)}.</span>`;
  let control;
  if (c.type === 'bool') {
    control = `<label class="rg3-check"><input id="${id}" name="v" type="checkbox"${val ? ' checked' : ''}${dis} aria-describedby="${id}-h"> ${esc(c.label)}</label>`;
  } else if (c.type === 'texte') {
    control = `<label for="${id}">${esc(c.label)}</label>
      <input id="${id}" name="v" type="text" maxlength="${c.max}" value="${esc(val ?? '')}" aria-describedby="${id}-h"${dis}>`;
  } else {
    const step = c.type === 'entier' ? '1' : '0.01';
    const shown = val === null || val === undefined ? '' : String(val);
    control = `<label for="${id}">${esc(c.label)}</label>
      <input id="${id}" name="v" type="number" inputmode="decimal" min="${c.min}" max="${c.max}" step="${step}" value="${esc(shown)}"${c.nullable ? ' placeholder="Vide : pas de limite"' : ''} aria-describedby="${id}-h"${dis}>`;
  }
  const reset = ecriture ? `<button class="btn btn-ghost btn-sm" type="button" data-rg3-reset="${esc(c.cle)}|${esc(c.champ)}">Rétablir la valeur par défaut</button>` : '';
  return `<div class="field rg3-field" data-champ="${esc(c.cle)}.${esc(c.champ)}">
    ${control}
    <div class="rg3-line">${aide}${reset}</div>
    <p class="form-error" role="alert" hidden></p>
  </div>`;
}

/** Enregistre un objet complet pour une clé (les champs inconnus sont conservés). */
async function persister(cle, patch) {
  const value = { ...objetLot3(cle), ...patch };
  const { error } = await sb.from('hg_settings').upsert({ key: cle, value, updated_at: new Date().toISOString() });
  if (error) throw error;
  majReglagesLot3(cle, value);
  return value;
}

/** Gère les boutons « Rétablir » (un champ ou un groupe). Ne fait rien si le clic vient d'ailleurs. */
function onClick(e, det) {
  const btnChamp = e.target.closest('[data-rg3-reset]');
  const btnGroupe = e.target.closest('[data-rg3-reset-groupe]');
  if (!btnChamp && !btnGroupe) return;
  e.preventDefault();
  const domaine = det.dataset.domaine;
  const cibles = btnGroupe
    ? champsDe(domaine).filter((c) => `${domaine}|${c.groupe}` === btnGroupe.dataset.rg3ResetGroupe)
    : CHAMPS_LOT3.filter((c) => `${c.cle}|${c.champ}` === btnChamp.dataset.rg3Reset);
  if (!cibles.length) return;
  resetCibles(cibles, det, btnChamp || btnGroupe);
}

/**
 * Remet les valeurs par défaut des champs choisis, puis redessine le bloc.
 * @param {Object[]} cibles champs à remettre à leur défaut.
 * @param {HTMLElement} det bloc de réglages.
 * @param {HTMLButtonElement} btn bouton cliqué (désactivé pendant l'envoi).
 */
async function resetCibles(cibles, det, btn) {
  btn.disabled = true;
  try {
    // Un enregistrement par clé touchée, avec les défauts des champs choisis
    const parCle = {};
    for (const c of cibles) (parCle[c.cle] ??= {})[c.champ] = c.defaut;
    for (const [cle, patch] of Object.entries(parCle)) await persister(cle, patch);
    toast('Valeur par défaut rétablie.', 'ok');
    render(det, det.dataset.domaine);
  } catch (ex) {
    toast(`Rétablissement impossible : ${errMsg(ex)}`, 'error');
    btn.disabled = false;
  }
}

/** Lit et valide un champ du formulaire. Renvoie { value } ou { error }. */
function lire(c, el) {
  if (c.type === 'bool') return { value: !!el.checked };
  const raw = String(el.value ?? '').trim();
  if (c.type === 'texte') {
    if (!raw && c.nullable) return { value: null };
    if (raw.length > c.max) return { error: `Le texte dépasse ${c.max} caractères.` };
    return { value: raw };
  }
  if (!raw) return c.nullable ? { value: null } : { error: 'Saisis un nombre.' };
  const n = Number(raw.replace(',', '.'));
  if (!Number.isFinite(n)) return { error: 'Saisis un nombre.' };
  if (c.type === 'entier' && !Number.isInteger(n)) return { error: 'Saisis un nombre entier.' };
  if (n < c.min || n > c.max) return { error: `Entre ${String(c.min).replace('.', ',')} et ${String(c.max).replace('.', ',')}.` };
  return { value: n };
}

/**
 * Envoie le formulaire du domaine : valide chaque champ, vérifie que le maximum d'un sondage n'est pas
 * sous son minimum, puis enregistre. Rien n'est envoyé si une erreur subsiste.
 */
async function onSubmit(e, det) {
  e.preventDefault();
  const domaine = det.dataset.domaine;
  const form = det.querySelector('.rg3-form');
  const champs = champsDe(domaine);
  const erreurs = [];
  const parCle = {};
  for (const c of champs) {
    const wrap = form.querySelector(`[data-champ="${c.cle}.${c.champ}"]`);
    const el = wrap?.querySelector('[name="v"]');
    const err = wrap?.querySelector('.form-error');
    if (!el) continue;
    const r = lire(c, el);
    if (err) { err.hidden = !r.error; err.textContent = r.error || ''; }
    if (r.error) { erreurs.push(el); continue; }
    (parCle[c.cle] ??= {})[c.champ] = r.value;
  }
  // Cohérence : le maximum d'un sondage ne peut pas être inférieur au minimum
  const sMin = parCle.irl?.sondage_min, sMax = parCle.irl?.sondage_max;
  if (sMin !== undefined && sMax !== undefined && sMax < sMin) {
    const wrap = form.querySelector('[data-champ="irl.sondage_max"]');
    const err = wrap?.querySelector('.form-error');
    if (err) { err.hidden = false; err.textContent = 'Le maximum doit être au moins égal au minimum.'; }
    erreurs.push(wrap?.querySelector('[name="v"]'));
  }
  if (erreurs.length) { erreurs[0]?.focus(); toast('Corrige les champs signalés.', 'error'); return; }
  const btn = form.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    for (const [cle, patch] of Object.entries(parCle)) await persister(cle, patch);
    toast('Réglages enregistrés.', 'ok');
    render(det, domaine);
  } catch (ex) {
    toast(`Enregistrement impossible : ${errMsg(ex)}`, 'error');
    if (btn) btn.disabled = false;
  }
}
