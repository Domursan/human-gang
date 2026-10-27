// ===== Humane Gang — outils communs des pages « Contenu et souvenirs » =====
// Citations (citations.html), Playlist (playlist.html).
/*
 * Rôle : petites briques partagées par ces deux pages : annuaire des membres, dates à l'heure de Zurich,
 * boîte de dialogue de formulaire (vrai <dialog>, focus, Échap, message d'erreur), filtres en pastilles.
 * Dépendances : core.js (sb, esc, errMsg).
 * Exporte : FUSEAU, fmtJour, fmtMois, loadPeople, pseudoOf, formDialog, chipsHtml, setPressed.
 */
import { sb, esc, errMsg } from './core.js';

/** Fuseau d'affichage : toujours l'heure de Zurich, quel que soit l'appareil. */
export const FUSEAU = 'Europe/Zurich';
const fJour = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: FUSEAU });
const fMois = new Intl.DateTimeFormat('fr-CH', { month: 'long', year: 'numeric', timeZone: FUSEAU });

/** « 12 mars 2026 » (chaîne vide si la date manque). Une date seule (AAAA-MM-JJ) est lue à midi pour ne pas changer de jour. */
export const fmtJour = (d) => (d ? fJour.format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00` : d)) : '');
/** « mars 2026 ». */
export const fmtMois = (d) => (d ? fMois.format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00` : d)) : '');

/**
 * Annuaire des membres (RPC hg_members) : Map id -> { id, pseudo, color, avatar_url }. Ne jette jamais.
 * @returns {Promise<Map<string, object>>}
 */
export async function loadPeople() {
  try {
    const { data, error } = await sb.rpc('hg_members');
    if (error) throw error;
    return new Map((data || []).map((p) => [p.id, p]));
  } catch (e) {
    console.warn('[annuaire]', e);
    return new Map();
  }
}

/** Pseudo d'un membre (« Ancien membre » s'il n'est plus dans l'annuaire). */
export const pseudoOf = (people, id) => (id ? people.get(id)?.pseudo ?? 'Ancien membre' : '');

/**
 * Ouvre une boîte de dialogue de formulaire. Le formulaire est envoyé par onSubmit(form) ; une erreur jetée
 * s'affiche dans la boîte (role="alert") et la boîte reste ouverte. Le focus revient au déclencheur à la fermeture.
 * @param {{title: string, body: string, submit: string, onSubmit: (form: HTMLFormElement) => Promise<*>, id?: string}} o
 *   body : HTML des champs (le texte venant de la base doit déjà être passé par esc()).
 * @returns {HTMLDialogElement}
 */
export function formDialog({ title, body, submit, onSubmit, id = 'ct-dlg' }) {
  const back = document.activeElement;
  document.getElementById(id)?.remove();
  const dlg = document.createElement('dialog');
  dlg.className = 'ct-dialog';
  dlg.id = id;
  dlg.setAttribute('aria-labelledby', `${id}-t`);
  dlg.innerHTML = `<form class="ct-dlg-form" method="dialog" novalidate>
    <div class="ct-dlg-head"><h2 id="${id}-t">${esc(title)}</h2>
      <button type="button" class="btn btn-ghost ct-dlg-x" data-close aria-label="Fermer">✕</button></div>
    <div class="ct-dlg-body stack">${body}</div>
    <p class="ct-dlg-err" role="alert" hidden></p>
    <div class="btn-row ct-dlg-actions"><button type="button" class="btn btn-ghost" data-close>Annuler</button>
      <button type="submit" class="btn btn-sand">${esc(submit)}</button></div>
  </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const err = dlg.querySelector('.ct-dlg-err');
  const close = () => { dlg.close(); dlg.remove(); back?.focus?.(); };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    if (btn.disabled) return;
    err.hidden = true;
    btn.disabled = true;
    try {
      await onSubmit(form);
      close();
    } catch (x) {
      console.warn('[formulaire]', x);
      err.textContent = errMsg(x);
      err.hidden = false;
      btn.disabled = false;
    }
  });
  dlg.showModal();
  dlg.querySelector('input, textarea, select')?.focus();
  return dlg;
}

/**
 * Pastilles de filtre : un groupe de boutons à bascule (aria-pressed).
 * @param {Array<[string, string]>} items [valeur, libellé]
 * @param {string} current Valeur active.
 * @param {string} attr Nom de l'attribut data- qui porte la valeur (ex. 'f' donne data-f).
 * @returns {string} HTML des boutons.
 */
export function chipsHtml(items, current, attr = 'f') {
  return items.map(([v, l]) => `<button type="button" class="ct-chip" data-${attr}="${esc(v)}" aria-pressed="${v === current}">${esc(l)}</button>`).join('');
}

/** Met à jour aria-pressed dans un groupe de pastilles. */
export function setPressed(root, attr, value) {
  root.querySelectorAll(`[data-${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
}
