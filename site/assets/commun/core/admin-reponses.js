// ===== Humane Gang — bouton « Réponses » des jeux (administrateurs seulement) =====
/*
 * Rôle : un petit bouton « Réponses » posé dans chaque jeu, visible des seuls comptes administrateurs (pas en vue
 * « comme un membre »). Il ouvre une fenêtre spéciale (bandeau rayé ADMIN) qui affiche les réponses cachées du jeu :
 * mot du jour, lieu de la photo, code secret, rôles des joueurs, enveloppe du Cluedo…
 * Les réponses viennent du serveur, au clic seulement : RPC hg_admin_reponses(p_jeu, p_ref) (migration 133), qui
 * refuse tout compte non administrateur et note la consultation dans le journal admin.
 * Format renvoyé : { titre, note?, sections: [{ titre, lignes?: [{ label, valeur, ton? }], liste?: [texte], grille?: [[texte]] }] }
 *   ton : 'ok' | 'ko' | 'neutre' | 'rouge' | 'bleu' | 'noir' | 'rose' | 'jaune' | 'vert' (pastille de couleur).
 * Page : tous les jeux (appels : grep boutonReponses).
 * Dépendances : supabase.js, profile.js, view-as.js, util.js. Styles : base.css (.adrep-*).
 * Exporte : boutonReponses, ouvrirReponses, estAdminJeux.
 */
import { sb } from './supabase.js';
import { getCachedProfile, getProfile } from './profile.js';
import { viewAsActive } from './view-as.js';
import { esc } from './util.js';

const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';

/**
 * Le compte connecté est-il administrateur (et pas en vue « comme un membre ») ?
 * @returns {Promise<boolean>}
 */
export async function estAdminJeux() {
  let p = getCachedProfile();
  if (p === undefined) { try { p = await getProfile(); } catch { return false; } }
  return !!p?.is_admin && !viewAsActive();
}

/** HTML d'une section de réponses. */
function sectionHtml(s) {
  const lignes = (s.lignes || []).map((l) => `<div class="adrep-l"><dt>${esc(l.label ?? '')}</dt><dd>${l.ton ? `<span class="adrep-ton adrep-${esc(l.ton)}" aria-hidden="true"></span>` : ''}${esc(l.valeur ?? '—')}</dd></div>`).join('');
  const liste = (s.liste || []).length ? `<ul class="adrep-liste">${s.liste.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const grille = (s.grille || []).length ? `<div class="adrep-grille-wrap"><table class="adrep-grille">${s.grille.map((r) => `<tr>${r.map((c) => `<td>${esc(c ?? '')}</td>`).join('')}</tr>`).join('')}</table></div>` : '';
  return `<section class="adrep-sec">${s.titre ? `<h3>${esc(s.titre)}</h3>` : ''}${lignes ? `<dl>${lignes}</dl>` : ''}${liste}${grille}</section>`;
}

/**
 * Ouvre la fenêtre des réponses d'un jeu.
 * @param {string} jeu identifiant du jeu (ex. 'sutom', 'cluedo')
 * @param {string|null} [ref] référence de la manche ou de la partie (uuid, numéro…), si le jeu en a besoin
 */
export async function ouvrirReponses(jeu, ref = null) {
  const d = document.createElement('dialog');
  d.className = 'adrep';
  d.setAttribute('aria-labelledby', 'adrep-h');
  d.innerHTML = `<div class="adrep-bandeau" aria-hidden="true"><span>ADMIN · RÉPONSES</span></div>
    <div class="adrep-corps"><div class="adrep-tete"><h2 id="adrep-h">Réponses</h2>
      <button type="button" class="adrep-x" aria-label="Fermer">×</button></div>
      <div class="adrep-contenu" aria-live="polite"><p class="muted">Chargement…</p></div>
      <p class="adrep-pied small muted">Visible des administrateurs seulement. Chaque consultation est notée dans le journal admin.</p></div>`;
  document.body.appendChild(d);
  d.querySelector('.adrep-x').addEventListener('click', () => d.close());
  d.addEventListener('close', () => d.remove());
  d.showModal();
  const box = d.querySelector('.adrep-contenu');
  try {
    const { data, error } = await sb.rpc('hg_admin_reponses', { p_jeu: jeu, p_ref: ref == null ? null : String(ref) });
    if (error) throw error;
    d.querySelector('#adrep-h').textContent = data?.titre || 'Réponses';
    const secs = (data?.sections || []).map(sectionHtml).join('');
    box.innerHTML = (data?.note ? `<p class="adrep-note">${esc(data.note)}</p>` : '') + (secs || '<p class="muted">Rien à révéler pour le moment.</p>');
  } catch (e) {
    box.innerHTML = `<p class="adrep-err">Impossible de charger les réponses : ${esc(e?.message || String(e))}</p>`;
  }
}

/**
 * Crée le bouton « Réponses » (ou rien pour un non-administrateur) et l'insère dans `cible`.
 * @param {Element|null} cible élément où ajouter le bouton (à la fin)
 * @param {string} jeu identifiant du jeu
 * @param {() => (string|null)} [refDe] fonction qui donne la référence au moment du clic (partie en cours…)
 * @returns {Promise<HTMLButtonElement|null>}
 */
export async function boutonReponses(cible, jeu, refDe = () => null) {
  if (!cible || !(await estAdminJeux())) return null;
  cible.querySelector(`:scope > .adrep-btn[data-jeu="${jeu}"]`)?.remove();
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'adrep-btn';
  b.dataset.jeu = jeu;
  b.innerHTML = `${ICON}<span>Réponses</span>`;
  b.title = 'Voir les réponses (administrateur)';
  b.addEventListener('click', () => ouvrirReponses(jeu, refDe()));
  cible.appendChild(b);
  return b;
}
