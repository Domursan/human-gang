// ===== Humane Gang — accueil personnalisable : mode édition (idée P9, accueil.html) =====
// Chargé au clic sur « Personnaliser ». La page passe en mode édition : liste des blocs affichés avec poignée
// (glisser-déposer à la souris), boutons Monter / Descendre (clavier et tactile), interrupteur Affiché / Masqué,
// étiquette « Obligatoire » ou « Nouveau » ; réserve « Blocs disponibles » ; profils types en un tap
// (« Fan de cartes », « Fan d'IRL », « Accueil d'origine »). Chaque déplacement est annoncé (aria-live).
// « Terminé » enregistre (base + copie locale) : un simple changement d'ordre est appliqué sur place, un bloc affiché
// ou masqué recharge la page (seuls les blocs visibles chargent leurs données).
// Dépendances : core.js, home-registry.js. Exporte : openHomeEditor(o).
import { esc, toast, errMsg } from './core.js';
import { HOME_PROFILES } from './home-registry.js';

const GRIP = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/></svg>';
const UP = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const DOWN = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';

/**
 * Ouvre le mode édition.
 * @param {object} o
 * @param {HTMLElement} o.app conteneur de la page
 * @param {object} o.st état de home-blocks.js (blocks, def, saved, layout)
 * @param {() => void} o.arrange range à nouveau les blocs selon o.st.layout
 * @param {(list: object[]) => Promise<void>} o.save enregistre la disposition
 * @param {() => Promise<void>} o.reset revient à l'accueil d'origine (efface la disposition)
 */
export function openHomeEditor({ app, st, arrange, save, reset }) {
  if (app.querySelector('.home-editor')) return;
  const meta = (id) => st.blocks.get(id)?.meta || { id, label: id };
  // Copie de travail (sans les blocs automatiques, qui ne se règlent pas)
  let work = st.layout.filter((x) => !meta(x.id).auto).map((x) => ({ ...x }));
  const before = JSON.stringify(st.layout.map((x) => [x.id, x.on]));
  let resetAsked = false, profile = null;

  const head = app.querySelector('.home-head');
  const title = head.querySelector('.page-title');
  const oldTitle = title.textContent;
  app.classList.add('home-editing');
  title.textContent = 'Mon accueil';
  const ed = document.createElement('section');
  ed.className = 'home-editor';
  ed.setAttribute('aria-label', 'Personnaliser mon accueil');
  head.after(ed);

  /** Une ligne de la liste des blocs affichés. */
  const rowHtml = (x, i, n) => {
    const m = meta(x.id);
    return `<li class="he-row${x.on ? '' : ' is-off'}" data-id="${esc(x.id)}" draggable="true">
      <span class="he-grip" aria-hidden="true">${GRIP}</span>
      <span class="he-txt"><span class="he-name"><strong>${esc(m.label)}</strong>${x.isNew ? '<span class="pill he-new">Nouveau</span>' : ''}</span>
        <span class="small muted">${x.on ? esc(m.desc || '') : 'masqué'}</span></span>
      <button class="btn btn-ghost he-move" type="button" data-move="-1" aria-label="Monter « ${esc(m.label)} »"${i === 0 ? ' disabled' : ''}>${UP}</button>
      <button class="btn btn-ghost he-move" type="button" data-move="1" aria-label="Descendre « ${esc(m.label)} »"${i === n - 1 ? ' disabled' : ''}>${DOWN}</button>
      ${x.required ? '<span class="pill he-req">Obligatoire</span>'
        : `<input class="pref-switch he-switch" type="checkbox" role="switch" data-toggle${x.on ? ' checked' : ''} aria-label="Afficher « ${esc(m.label)} »">`}
    </li>`;
  };
  /** Dessine le mode édition à partir de la copie de travail. */
  const render = (focusSel) => {
    const shown = work.filter((x) => x.placed);
    const reserve = work.filter((x) => !shown.includes(x));
    ed.innerHTML = `
      <div class="he-bar">
        <div class="he-profiles" role="group" aria-labelledby="he-prof-lbl">
          <span class="small muted" id="he-prof-lbl">Profils types</span>
          <div class="he-chips">${HOME_PROFILES.map((p) => `<button type="button" class="he-chip" data-profile="${esc(p.id)}" aria-pressed="${profile === p.id}">${esc(p.label)}</button>`).join('')}</div>
        </div>
        <button class="btn btn-sand he-done" type="button" data-done>${CHECK} Terminé</button>
      </div>
      <ol class="he-list" aria-label="Blocs de mon accueil">${shown.map((x, i) => rowHtml(x, i, shown.length)).join('')}</ol>
      <div class="card he-reserve">
        <h2 class="he-reserve-title">Blocs disponibles</h2>
        ${reserve.length ? `<div class="he-chips">${reserve.map((x) => `<button type="button" class="he-chip" data-add="${esc(x.id)}">${PLUS} ${esc(meta(x.id).label)}</button>`).join('')}</div>`
          : '<p class="small muted">Tous les blocs sont déjà sur ton accueil.</p>'}
      </div>
      <p class="he-note small muted">Ta disposition suit ton compte sur tous tes appareils. Les blocs d’une page à laquelle tu n’as pas accès ne sont pas proposés.</p>
      <p class="visually-hidden" aria-live="polite" id="he-live"></p>`;
    if (focusSel) ed.querySelector(focusSel)?.focus();
  };
  /** Annonce un changement aux lecteurs d'écran. */
  const say = (t) => { const l = ed.querySelector('#he-live'); if (l) l.textContent = t; };
  /** Position dans la liste affichée. */
  const shownIds = () => work.filter((x) => x.placed).map((x) => x.id);
  /** Déplace le bloc id de delta places parmi les blocs affichés. */
  const move = (id, delta) => {
    const ids = shownIds();
    const i = ids.indexOf(id), j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    const a = work.findIndex((x) => x.id === id), b = work.findIndex((x) => x.id === ids[j]);
    const [it] = work.splice(a, 1);
    work.splice(b, 0, it);
    profile = null;
    render(`.he-row[data-id="${CSS.escape(id)}"] [data-move="${delta}"]:not([disabled])`) ;
    if (!ed.contains(document.activeElement) || document.activeElement === document.body) ed.querySelector(`.he-row[data-id="${CSS.escape(id)}"] .he-move:not([disabled])`)?.focus();
    say(`${meta(id).label} déplacé en position ${j + 1}`);
  };

  ed.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button, input');
    if (!t) return;
    const row = t.closest('.he-row');
    if (t.dataset.move && row) { move(row.dataset.id, Number(t.dataset.move)); return; }
    if (t.hasAttribute('data-toggle') && row) {
      const x = work.find((w) => w.id === row.dataset.id);
      x.on = t.checked; profile = null;
      row.classList.toggle('is-off', !x.on);
      row.querySelector('.he-txt .small').textContent = x.on ? (meta(x.id).desc || '') : 'masqué';
      say(`${meta(x.id).label} ${x.on ? 'affiché' : 'masqué'}`);
      return;
    }
    if (t.dataset.add) {
      const x = work.find((w) => w.id === t.dataset.add);
      const [it] = work.splice(work.indexOf(x), 1);
      it.on = true; it.placed = true;
      work.push(it); // ajouté à la fin des blocs
      profile = null;
      render(`.he-row[data-id="${CSS.escape(it.id)}"] [data-toggle]`);
      say(`${meta(it.id).label} ajouté à la fin`);
      return;
    }
    if (t.dataset.profile) {
      const p = HOME_PROFILES.find((q) => q.id === t.dataset.profile);
      profile = p.id;
      const order = p.ordre || st.def.ordre;
      const known = work.map((x) => x.id);
      const head2 = order.filter((id) => known.includes(id));
      work = [...head2, ...known.filter((id) => !head2.includes(id))].map((id) => {
        const x = work.find((w) => w.id === id);
        return { ...x, on: x.required || head2.includes(id), isNew: false, placed: x.required || head2.includes(id) };
      });
      resetAsked = p.id === 'origine';
      render(`[data-profile="${CSS.escape(p.id)}"]`);
      say(`Profil « ${p.label} » appliqué`);
      return;
    }
    if (t.hasAttribute('data-done')) {
      t.disabled = true;
      // Seuls les blocs placés sont enregistrés : les autres restent dans la réserve
      const list = work.filter((x) => x.placed).map((x) => ({ id: x.id, on: !!(x.on || x.required) }));
      // Les blocs automatiques gardent leur place (juste après les bandeaux)
      const autos = st.layout.filter((x) => meta(x.id).auto);
      try {
        if (resetAsked) await reset(); else await save(list);
      } catch (e) { toast(`Enregistrement impossible : ${errMsg(e)}`, 'error'); t.disabled = false; return; }
      const next = [...list.map((x) => ({ ...x, isNew: false, placed: true, required: !!work.find((w) => w.id === x.id)?.required })),
        ...work.filter((x) => !x.placed).map((x) => ({ ...x, on: false, isNew: false }))];
      const at = next.findIndex((x) => x.id === 'evenement') + 1;
      next.splice(at, 0, ...autos);
      const visChanged = JSON.stringify(st.layout.filter((x) => x.on).map((x) => x.id).sort()) !== JSON.stringify(next.filter((x) => x.on).map((x) => x.id).sort());
      st.layout = next; st.saved = resetAsked ? null : list;
      close();
      if (JSON.stringify(next.map((x) => [x.id, x.on])) === before) return;
      if (visChanged) { location.reload(); return; }
      arrange();
      toast('Ton accueil est enregistré.', 'ok');
    }
  });

  // Glisser-déposer à la souris (les boutons Monter / Descendre restent l'accès principal)
  let dragId = null;
  ed.addEventListener('dragstart', (ev) => { const r = ev.target.closest?.('.he-row'); if (!r) return; dragId = r.dataset.id; r.classList.add('is-drag'); ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', dragId); } catch { /* rien */ } });
  ed.addEventListener('dragover', (ev) => { if (dragId && ev.target.closest?.('.he-row')) ev.preventDefault(); });
  ed.addEventListener('drop', (ev) => {
    const r = ev.target.closest?.('.he-row');
    if (!dragId || !r || r.dataset.id === dragId) return;
    ev.preventDefault();
    const ids = shownIds();
    move(dragId, ids.indexOf(r.dataset.id) - ids.indexOf(dragId));
  });
  ed.addEventListener('dragend', () => { dragId = null; ed.querySelectorAll('.is-drag').forEach((n) => n.classList.remove('is-drag')); });

  /** Quitte le mode édition sans rien changer. */
  const close = () => { ed.remove(); app.classList.remove('home-editing'); title.textContent = oldTitle; head.querySelector('[data-home-edit]')?.focus(); };
  ed.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
  render('[data-done]');
}
