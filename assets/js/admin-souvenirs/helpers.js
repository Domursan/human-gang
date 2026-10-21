// ===== Humane Gang — administration : souvenirs, photos et réactions (outils communs) =====
import { sb, esc, fmtDate, fmtDateTime } from '../core.js';
import { ghostDirectory } from '../admin-ghosts.js';

export const PAGE = 30; // lignes par page (on lit PAGE + 1 pour savoir s'il existe une page suivante)

/** Date SQL (AAAA-MM-JJ) → libellé français, sans décalage de fuseau. */
export const dayLabel = (d) => (d ? fmtDate(`${String(d).slice(0, 10)}T12:00:00`) : '');
export const stampLabel = (iso) => (iso ? fmtDateTime(iso) : '');
export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Terme de recherche sûr pour ilike : les caractères spéciaux sont remplacés par des espaces. */
export const searchTerm = (q) => String(q || '').replace(/[%_,()*\\]/g, ' ').trim();

/** Plage PostgREST (inclusive) pour la page demandée. */
export const pageRange = (page) => [page * PAGE, page * PAGE + PAGE];

/** Découpe la réponse « PAGE + 1 lignes » : { rows, hasNext }. */
export function pageOf(data) {
  const all = data ?? [];
  return { rows: all.slice(0, PAGE), hasNext: all.length > PAGE };
}

/** Boutons précédent / suivant (vide s'il n'y a qu'une page). */
export function pagerHtml(page, hasNext) {
  if (!page && !hasNext) return '';
  return `<nav class="sv-pager" aria-label="Pages">
    <button type="button" class="btn btn-ghost btn-sm" data-sv-page="${page - 1}" ${page ? '' : 'disabled'}>Précédent</button>
    <span class="small muted" aria-live="polite">Page ${page + 1}</span>
    <button type="button" class="btn btn-ghost btn-sm" data-sv-page="${page + 1}" ${hasNext ? '' : 'disabled'}>Suivant</button>
  </nav>`;
}

/** Membres inscrits et fantômes, indexés par identifiant. */
export async function loadPeople() {
  const [m, ghosts] = await Promise.all([sb.rpc('hg_members'), ghostDirectory()]);
  if (m.error) throw m.error;
  const map = new Map((m.data || []).map((x) => [x.id, x]));
  for (const [id, g] of ghosts) map.set(id, g);
  return map;
}

/** Options <option> triées par pseudo ; `first` ajoute une option vide en tête. Les fantômes ne sont proposés
 *  que s'ils sont déjà la valeur `selected` (souvenir ancien) : les choix ne montrent que les comptes actifs. */
export function peopleOptions(people, selected = '', first = null) {
  const list = [...people.values()].filter((p) => !p.is_ghost || p.id === selected)
    .sort((a, b) => String(a.pseudo).localeCompare(String(b.pseudo), 'fr'));
  const head = first === null ? '' : `<option value="">${first}</option>`;
  return head + list.map((p) => `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.pseudo)}</option>`).join('');
}
