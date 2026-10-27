// ===== Humane Gang — « Qui sait faire quoi » (idée P7) =====
// Compétences déclarées volontairement (8 au plus) dans une liste tenue par le Staff (hg_settings.competences).
//  - fiche membre : pastilles « Peut aider pour… » (/pages/compte/membre.html) ;
//  - annuaire « Le gang » : filtre « Qui sait faire… » et bouton « Demander un coup de main » (conversation préremplie) ;
//  - compte : saisie des compétences et d'une précision courte (/pages/compte/compte.html, via compte-social.js).
// Pas de notes, pas de niveaux, pas d'avis : c'est déclaratif et bienveillant. Aucune récompense.
// Tables et RPC : hg_settings (competences), hg_member_skills, hg_skills_list (migration 091).
// Exporte : SKILLS_MAX, loadSkillCatalog, mountSkillPills, mountSkillFilter, mountSkillEditor.
import { sb, esc, avatarHtml, errMsg, toast } from '../../commun/core.js';

/** Nombre maximum de compétences par membre (même limite que la base). */
export const SKILLS_MAX = 8;
/** Longueur maximale de la précision (même limite que la base). */
const NOTE_MAX = 80;

let catalogP = null;
/**
 * Catalogue des compétences ({ code, label }[]), lu une fois par page. Liste vide si le réglage est absent.
 * @returns {Promise<{code: string, label: string}[]>}
 */
export function loadSkillCatalog() {
  catalogP ||= sb.from('hg_settings').select('value').eq('key', 'competences').maybeSingle()
    .then(({ data, error }) => {
      if (error) throw error;
      const list = Array.isArray(data?.value) ? data.value : [];
      return list.filter((c) => c && typeof c.code === 'string' && typeof c.label === 'string');
    })
    .catch((e) => { console.warn('[compétences]', e?.message || e); return []; });
  return catalogP;
}
/** Libellé d'un code (le code lui-même si la compétence a été retirée du catalogue). */
const labelOf = (cat, code) => cat.find((c) => c.code === code)?.label || code;

/**
 * Pastilles « Peut aider pour… » sur la fiche d'un membre. Sans compétence : rien (ou une invitation sur sa propre fiche).
 * @param {HTMLElement} el conteneur (masqué au départ)
 * @param {string} userId membre affiché
 * @param {boolean} isMe vrai sur sa propre fiche
 */
export async function mountSkillPills(el, userId, isMe) {
  if (!el) return;
  try {
    const [cat, { data, error }] = await Promise.all([
      loadSkillCatalog(),
      sb.from('hg_member_skills').select('skill_code,note').eq('user_id', userId),
    ]);
    if (error) throw error;
    const list = (data || []).filter((r) => cat.some((c) => c.code === r.skill_code)).sort((a, b) => labelOf(cat, a.skill_code).localeCompare(labelOf(cat, b.skill_code), 'fr'));
    if (!list.length && !isMe) return;
    el.innerHTML = `
      <h2 class="mb-section-title sk-title">Peut aider pour</h2>
      ${list.length ? `<ul class="sk-pills">${list.map((s) => `
        <li class="sk-pill"><strong>${esc(labelOf(cat, s.skill_code))}</strong>${s.note ? `<span class="small muted"> · ${esc(s.note)}</span>` : ''}</li>`).join('')}</ul>`
        : '<p class="small muted">Tu n’as encore rien indiqué. <a href="/pages/compte/compte.html#entraide">Dis au gang pour quoi tu peux donner un coup de main</a>.</p>'}`;
    el.hidden = false;
  } catch (e) { console.warn('[compétences]', e?.message || e); }
}

/**
 * Lien vers une conversation directe avec un brouillon prérempli (messages.js lit ?brouillon=).
 * @param {string} userId destinataire
 * @param {string} pseudo pseudo du destinataire
 * @param {string} label compétence
 */
const helpHref = (userId, pseudo, label) => `/pages/compte/messages.html?to=${encodeURIComponent(userId)}&brouillon=${encodeURIComponent(`Salut ${pseudo}, tu pourrais me donner un coup de main pour « ${label} » ? `)}`;

/**
 * Filtre « Qui sait faire… » de l'annuaire : une rangée de pastilles (une par compétence, bouton à bascule) ; une compétence
 * choisie remplace la grille du gang par les volontaires (précision, autres compétences) et un bouton
 * « Demander un coup de main ». « Tout le gang » revient à la grille.
 * @param {HTMLElement} el conteneur du filtre
 * @param {{grid: HTMLElement, meId: string}} o grille de l'annuaire (masquée pendant le filtre) et id de la personne connectée
 */
export async function mountSkillFilter(el, { grid, meId }) {
  if (!el) return;
  const cat = await loadSkillCatalog();
  if (!cat.length) return;
  el.innerHTML = `
    <div class="sk-filter" role="group" aria-labelledby="sk-filter-lbl">
      <p class="small muted" id="sk-filter-lbl">Qui sait faire…</p>
      <div class="sk-chips">
        <button type="button" class="sk-chip" data-sk-code="" aria-pressed="true">Tout le gang</button>
        ${cat.map((c) => `<button type="button" class="sk-chip" data-sk-code="${esc(c.code)}" aria-pressed="false">${esc(c.label)}</button>`).join('')}
      </div>
    </div>
    <p class="small muted sk-note" id="sk-hint" aria-live="polite" hidden></p>
    <ul class="sk-results" id="sk-results" hidden></ul>`;
  el.hidden = false;
  const out = el.querySelector('#sk-results'), hint = el.querySelector('#sk-hint');
  let all = null; // toutes les compétences déclarées (pour « aussi : … »), lues une fois
  el.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-sk-code]');
    if (!b) return;
    const code = b.dataset.skCode;
    el.querySelectorAll('[data-sk-code]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (!code) { out.hidden = true; hint.hidden = true; out.innerHTML = ''; if (grid) grid.hidden = false; return; }
    if (grid) grid.hidden = true;
    out.hidden = false; hint.hidden = false;
    hint.textContent = 'Chargement…';
    out.innerHTML = '';
    try {
      if (!all) {
        const { data, error } = await sb.rpc('hg_skills_list', { p_code: null });
        if (error) throw error;
        all = Array.isArray(data) ? data : [];
      }
      const label = labelOf(cat, code);
      const list = all.filter((r) => r.skill_code === code);
      const others = (uid) => all.filter((r) => r.user_id === uid && r.skill_code !== code && cat.some((c) => c.code === r.skill_code)).map((r) => labelOf(cat, r.skill_code));
      hint.innerHTML = list.length
        ? `${list.length} volontaire${list.length > 1 ? 's' : ''} pour <strong>${esc(label)}</strong>. C’est volontaire : chacun aide quand il peut.`
        : `Personne n’a encore coché « ${esc(label)} ». Et toi ? <a href="/pages/compte/compte.html#entraide">Indique tes compétences</a>`;
      out.innerHTML = list.map((r) => {
        const also = others(r.user_id);
        return `
        <li class="card sk-result">
          <a class="sk-who" href="/pages/compte/membre.html?id=${encodeURIComponent(r.user_id)}">${avatarHtml({ ...r, id: r.user_id }, 40)}
            <span class="sk-who-txt"><strong>${esc(r.pseudo)}${r.user_id === meId ? ' <span class="gang-me">toi</span>' : ''}</strong>${also.length ? `<span class="small muted">aussi : ${esc(also.join(', '))}</span>` : ''}</span></a>
          <p class="sk-result-note"><span class="sk-pill sk-pill-on">${esc(label)}</span>${r.note ? ` <span class="small">« ${esc(r.note)} »</span>` : ''}</p>
          ${r.user_id === meId ? '' : `<a class="btn btn-ghost sk-help" href="${esc(helpHref(r.user_id, r.pseudo, label))}">Demander un coup de main</a>`}
        </li>`;
      }).join('');
    } catch (e) { hint.textContent = `Impossible de charger la liste (${errMsg(e)}).`; }
  });
}

/**
 * Saisie des compétences dans le compte : cases à cocher (8 au plus) et précision facultative pour chacune.
 * L'enregistrement n'écrit que les différences (ajouts, retraits, précisions modifiées).
 * @param {HTMLElement} el conteneur
 * @param {{id: string}} me profil connecté
 */
export async function mountSkillEditor(el, me) {
  if (!el) return;
  const cat = await loadSkillCatalog();
  let saved = new Map();
  try {
    const { data, error } = await sb.from('hg_member_skills').select('skill_code,note').eq('user_id', me.id);
    if (error) throw error;
    saved = new Map((data || []).map((r) => [r.skill_code, r.note || '']));
  } catch (e) { el.innerHTML = `<p class="small muted">Impossible de charger tes compétences (${esc(errMsg(e))}).</p>`; return; }
  if (!cat.length) { el.innerHTML = '<p class="small muted">La liste des compétences n’est pas encore prête.</p>'; return; }
  el.innerHTML = `
    <fieldset class="sk-edit">
      <legend class="small muted">Coche jusqu’à ${SKILLS_MAX} compétences. Une compétence manque ? Propose-la dans la <a href="/pages/compte/accueil.html#idees">boîte à idées</a>.</legend>
      <ul class="sk-edit-list">${cat.map((c) => {
        const on = saved.has(c.code);
        return `<li class="sk-edit-item">
          <label class="check"><input type="checkbox" data-sk="${esc(c.code)}"${on ? ' checked' : ''}> <span>${esc(c.label)}</span></label>
          <input class="sk-edit-note" data-sk-note="${esc(c.code)}" maxlength="${NOTE_MAX}" placeholder="Précision (facultatif)" aria-label="Précision pour ${esc(c.label)}" value="${esc(saved.get(c.code) || '')}"${on ? '' : ' hidden'}>
        </li>`;
      }).join('')}</ul>
      <p class="small sk-count" aria-live="polite"></p>
      <div class="btn-row"><button class="btn btn-ghost" type="button" data-sk-save>Enregistrer mes compétences</button></div>
    </fieldset>`;
  const boxes = [...el.querySelectorAll('[data-sk]')];
  const count = el.querySelector('.sk-count');
  /** Met à jour le compteur et bloque les cases au-delà du maximum. */
  const refresh = () => {
    const n = boxes.filter((b) => b.checked).length;
    count.textContent = `${n} / ${SKILLS_MAX}`;
    for (const b of boxes) b.disabled = !b.checked && n >= SKILLS_MAX;
  };
  for (const b of boxes) {
    b.addEventListener('change', () => {
      const note = el.querySelector(`[data-sk-note="${CSS.escape(b.dataset.sk)}"]`);
      if (note) note.hidden = !b.checked;
      refresh();
    });
  }
  refresh();
  el.querySelector('[data-sk-save]').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const want = new Map(boxes.filter((b) => b.checked).map((b) => [b.dataset.sk, el.querySelector(`[data-sk-note="${CSS.escape(b.dataset.sk)}"]`)?.value.trim().slice(0, NOTE_MAX) || '']));
    const add = [...want].filter(([c]) => !saved.has(c));
    const gone = [...saved.keys()].filter((c) => !want.has(c));
    const changed = [...want].filter(([c, n]) => saved.has(c) && saved.get(c) !== n);
    btn.disabled = true;
    try {
      if (gone.length) { const { error } = await sb.from('hg_member_skills').delete().eq('user_id', me.id).in('skill_code', gone); if (error) throw error; }
      if (add.length) { const { error } = await sb.from('hg_member_skills').insert(add.map(([c, n]) => ({ user_id: me.id, skill_code: c, note: n || null }))); if (error) throw error; }
      for (const [c, n] of changed) { const { error } = await sb.from('hg_member_skills').update({ note: n || null }).eq('user_id', me.id).eq('skill_code', c); if (error) throw error; }
      saved = want;
      toast('Compétences enregistrées.', 'ok');
    } catch (e) { toast(`Enregistrement impossible : ${errMsg(e)}`, 'error'); }
    btn.disabled = false;
  });
}
