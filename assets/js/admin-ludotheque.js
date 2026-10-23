// =====================================================================
// Admin : section « Ludothèque » (idée S3). Créer une fiche, choisir son icône dessinée pour le gang, sa couleur,
// son type (long cours / soirée), son ordre, l'activer ou la retirer, et nommer 1 à 3 référents (seuls à modifier
// règles et liens, avec le Staff « ludothèque »).
// Droit : permission Staff « ludothèque » (hg_ludo_save la vérifie et note chaque action au journal).
// Dépendances : core.js (sb, esc, toast, errMsg), ludotheque-icons.js, admin/common.js (sectionError).
// Données : hg_ludo_games, hg_ludo_referents, hg_ludo_players ; RPC hg_members, hg_ludo_save (migration 088).
// Exporte : mountLudothequeSection.
// =====================================================================
import { sb, esc, toast, errMsg } from './core.js';
import { GAME_ICONS, gameIcon, gameColor } from './ludotheque-icons.js';
import { sectionError } from './admin/common.js';

const S = { root: null, games: [], refs: [], players: [], people: [] };

async function load() {
  const [g, r, p, m] = await Promise.all([
    sb.from('hg_ludo_games').select('*').order('sort'),
    sb.from('hg_ludo_referents').select('game_slug,user_id'),
    sb.from('hg_ludo_players').select('game_slug,user_id'),
    sb.rpc('hg_members'),
  ]);
  if (g.error) throw g.error;
  S.games = g.data || []; S.refs = r.data || []; S.players = p.data || [];
  S.people = (m.data || []).slice().sort((a, b) => String(a.pseudo).localeCompare(String(b.pseudo), 'fr'));
}

const pseudo = (id) => S.people.find((x) => x.id === id)?.pseudo || 'Ancien membre';

function paint() {
  S.root.innerHTML = `<div class="stack">
    <div class="btn-row"><button type="button" class="btn btn-primary" data-aj-new>+ Nouvelle fiche</button>
      <a class="btn btn-ghost" href="ludotheque.html">Voir la page Jeux</a></div>
    <p class="small muted">Les référents écrivent les règles maison et les liens de leur jeu, directement sur la fiche (page Jeux). Icônes dessinées pour le gang : jamais de logo officiel.</p>
    <ul class="sv-items aj-list">${S.games.map((g) => {
      const refs = S.refs.filter((r) => r.game_slug === g.slug).map((r) => pseudo(r.user_id));
      const n = S.players.filter((x) => x.game_slug === g.slug).length;
      return `<li class="sv-row aj-row" style="--g:${gameColor(g.color)}">
        <span class="aj-ico" aria-hidden="true">${gameIcon(g.icon, 24)}</span>
        <div class="sv-main"><p class="sv-title">${esc(g.name)}${g.active ? '' : ' <span class="pill pill-todo">Retirée</span>'}</p>
          <p class="small muted">${g.kind === 'soiree' ? 'Jeu de soirée' : 'Au long cours'} · ${n} joueur${n > 1 ? 's' : ''} · ${refs.length ? `Référents : ${esc(refs.join(', '))}` : 'Pas de référent'}</p></div>
        <div class="btn-row sv-row-actions"><button type="button" class="btn btn-ghost btn-sm" data-aj-edit="${esc(g.slug)}">Modifier</button></div>
      </li>`;
    }).join('') || '<li class="empty">Aucune fiche.</li>'}</ul>
  </div>`;
}

function openForm(g = null) {
  const refs = g ? S.refs.filter((r) => r.game_slug === g.slug).map((r) => r.user_id) : [];
  const opts = (sel) => `<option value="">Aucun</option>${S.people.map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.pseudo)}</option>`).join('')}`;
  const d = document.createElement('dialog');
  d.className = 'hg-dialog sv-dialog';
  d.setAttribute('aria-labelledby', 'aj-t');
  d.innerHTML = `<form class="stack" novalidate>
    <h2 id="aj-t" class="dialog-title">${g ? `Modifier « ${esc(g.name)} »` : 'Nouvelle fiche'}</h2>
    <div class="sv-form-row">
      <div class="field"><label for="aj-name">Nom</label><input id="aj-name" name="name" maxlength="60" required value="${esc(g?.name || '')}"></div>
      <div class="field"><label for="aj-slug">Identifiant (adresse)</label><input id="aj-slug" name="slug" maxlength="30" pattern="[a-z0-9][a-z0-9-]{1,29}" ${g ? 'readonly' : 'required'} value="${esc(g?.slug || '')}" placeholder="sea-of-thieves"></div>
    </div>
    <div class="sv-form-row">
      <div class="field"><label for="aj-kind">Type</label><select id="aj-kind" name="kind"><option value="long" ${g?.kind !== 'soiree' ? 'selected' : ''}>Au long cours</option><option value="soiree" ${g?.kind === 'soiree' ? 'selected' : ''}>Jeu de soirée</option></select></div>
      <div class="field"><label for="aj-icon">Icône</label><select id="aj-icon" name="icon">${Object.entries(GAME_ICONS).map(([k, l]) => `<option value="${k}" ${(g?.icon || 'manette') === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label for="aj-color">Couleur</label><input id="aj-color" name="color" type="color" value="${esc(/^#[0-9a-f]{6}$/i.test(g?.color || '') ? g.color : '#7E93C9')}"></div>
      <div class="field"><label for="aj-sort">Ordre</label><input id="aj-sort" name="sort" type="number" step="1" min="-9999" max="9999" value="${esc(String(g?.sort ?? 0))}"></div>
    </div>
    <fieldset class="aj-refs"><legend>Référents (3 au plus)</legend>
      <div class="sv-form-row">${[0, 1, 2].map((i) => `<div class="field"><label for="aj-r${i}">Référent ${i + 1}</label><select id="aj-r${i}" name="r${i}">${opts(refs[i] || '')}</select></div>`).join('')}</div>
    </fieldset>
    <label class="check"><input type="checkbox" name="active" ${g?.active === false ? '' : 'checked'}><span>Fiche visible sur la page Jeux</span></label>
    <p class="form-error" role="alert" hidden></p>
    <div class="btn-row dialog-actions"><button type="button" class="btn btn-ghost" data-close>Annuler</button><button type="submit" class="btn btn-primary">${g ? 'Enregistrer' : 'Créer'}</button></div>
  </form>`;
  document.body.append(d);
  const f = d.querySelector('form'), err = d.querySelector('.form-error');
  d.addEventListener('close', () => d.remove(), { once: true });
  d.querySelector('[data-close]').addEventListener('click', () => d.close());
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = f.elements;
    const referents = [...new Set([v.r0.value, v.r1.value, v.r2.value].filter(Boolean))];
    const p = { slug: v.slug.value.trim().toLowerCase(), name: v.name.value.trim(), kind: v.kind.value, icon: v.icon.value, color: v.color.value,
      sort: Number(v.sort.value) || 0, active: v.active.checked, referents };
    if (!g) p.create = true;
    if (!p.name) { err.textContent = 'Donne un nom.'; err.hidden = false; return; }
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const { error } = await sb.rpc('hg_ludo_save', { p });
    btn.disabled = false;
    if (error) { err.textContent = errMsg(error); err.hidden = false; return; }
    d.close();
    toast(g ? 'Fiche enregistrée.' : 'Fiche créée.', 'ok');
    await refresh();
  });
  d.showModal();
  f.elements.name.focus();
}

async function refresh() {
  try { await load(); paint(); } catch (e) { S.root.innerHTML = sectionError(e); }
}

/** Monte la section (une fois) et charge les fiches. */
export async function mountLudothequeSection(root) {
  if (!root) return;
  S.root = root;
  if (!root.dataset.ajBound) {
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-aj-new]')) { openForm(null); return; }
      const b = e.target.closest('[data-aj-edit]');
      if (b) openForm(S.games.find((g) => g.slug === b.dataset.ajEdit));
    });
    root.dataset.ajBound = '1';
  }
  await refresh();
}
