// ===== Humane Gang — vitrine de cartes (3 emplacements) sur la fiche membre =====
// Lecture : hg_card_showcase → hg_card_copies → hg_cards (tous les membres peuvent lire, voir 018 c).
// Édition (sur sa propre fiche seulement) : une <dialog> qui liste ses exemplaires non recyclés.
// Rendu : cardHtml() de cartes-ui.js. Styles : cartes-card.css + cartes-showcase.css (préfixe shw-).
import { sb, esc, errMsg, toast, canAccess } from './core.js';
import { cardHtml, rarityRank } from './cartes-ui.js';

const SLOTS = [1, 2, 3];
const CARD_COLS = 'id, set_id, number, name, family, rarity, image_url, flavor, caption, member_id, max_copies';
const PAGE = 1000; // pagination PostgREST (plafond par défaut de la base)

/* Données d'affichage communes à la page : une seule requête groupée (cartes + nom de série, pour le total et le nom),
   et l'arrivée des membres (RPC déjà utilisée par l'annuaire) seulement si une carte Identité doit être affichée. Mises en cache. */
let metaP = null, sinceP = null;
function loadMeta() {
  return metaP ??= (async () => {
    const names = new Map(), totals = new Map();
    try {
      const rows = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from('hg_cards').select('set_id, hg_card_sets(name)').order('id').range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      for (const r of rows) {
        totals.set(r.set_id, (totals.get(r.set_id) || 0) + 1);
        if (r.hg_card_sets?.name) names.set(r.set_id, r.hg_card_sets.name);
      }
    } catch { /* facultatif : la carte s'affiche sans nom ni total de série */ }
    return { names, totals };
  })();
}
function loadSince() {
  return sinceP ??= (async () => {
    try {
      const { data, error } = await sb.rpc('hg_members');
      if (error) throw error;
      return new Map((data || []).map((m) => [m.id, m.member_since]));
    } catch { return new Map(); }
  })();
}
/** Ajoute à une carte les champs d'affichage disponibles (série, total, arrivée du membre pour une Identité). */
async function withMeta(cards) {
  const [meta, since] = await Promise.all([loadMeta(), cards.some((c) => c?.rarity === 'identite') ? loadSince() : null]);
  const decorate = (card) => (card ? {
    ...card,
    set_name: meta.names.get(card.set_id), set_total: meta.totals.get(card.set_id),
    member_since: card.rarity === 'identite' ? (since?.get(card.member_id) ?? null) : null,
  } : card);
  return decorate;
}

/** Emplacements : slot → { copy_id, shiny, serial, card }. Ignore tout exemplaire qui n'est plus à ce membre. */
async function loadShowcase(userId) {
  const { data, error } = await sb.from('hg_card_showcase')
    .select(`slot, copy_id, hg_card_copies(id, owner_id, shiny, serial, recycled_at, hg_cards(${CARD_COLS}))`)
    .eq('user_id', userId).order('slot');
  if (error) throw error;
  const bySlot = new Map();
  for (const row of data || []) {
    const c = row.hg_card_copies;
    if (!c?.hg_cards || c.owner_id !== userId || c.recycled_at) continue;
    bySlot.set(row.slot, { copy_id: c.id, shiny: !!c.shiny, serial: c.serial, card: c.hg_cards });
  }
  return bySlot;
}

/** Exemplaires non recyclés du membre (pour l'éditeur), les plus rares d'abord. */
async function loadCollection(userId) {
  const { data, error } = await sb.from('hg_card_copies')
    .select(`id, shiny, serial, hg_cards(${CARD_COLS})`)
    .eq('owner_id', userId).is('recycled_at', null).limit(1000);
  if (error) throw error;
  return (data || []).filter((r) => r.hg_cards)
    .sort((a, b) => rarityRank(b.hg_cards.rarity) - rarityRank(a.hg_cards.rarity)
      || (a.hg_cards.number ?? 0) - (b.hg_cards.number ?? 0) || a.id - b.id);
}

/** Affiche la vitrine dans `el`. Pour un autre membre sans vitrine, la section est masquée. */
export async function mountShowcase(el, { userId, isMe }) {
  if (!el || !userId) return;
  if (!canAccess('cartes')) { el.hidden = true; return; }
  el.hidden = false;
  el.classList.add('shw');
  el.setAttribute('aria-labelledby', 'shw-title');
  el.innerHTML = `
    <div class="shw-head">
      <h2 class="mb-section-title" id="shw-title">Vitrine</h2>
      ${isMe ? '<button type="button" class="btn btn-ghost shw-edit">Modifier ma vitrine</button>' : ''}
    </div>
    <div class="shw-body" aria-busy="true"><div class="shw-skel" aria-hidden="true"></div></div>`;
  const body = el.querySelector('.shw-body');

  const paint = (bySlot, decorate) => {
    if (!isMe && !bySlot.size) { el.hidden = true; return; }
    const items = SLOTS.filter((s) => bySlot.has(s) || isMe).map((s) => {
      const hit = bySlot.get(s);
      return `<li>${hit
        ? cardHtml(decorate(hit.card), { shiny: hit.shiny, serial: hit.serial })
        : `<div class="shw-empty" aria-label="Emplacement ${s} libre"><span>Emplacement ${s} libre</span></div>`}</li>`;
    });
    body.innerHTML = `<ul class="shw-slots">${items.join('')}</ul>`;
  };
  const refresh = async () => {
    body.setAttribute('aria-busy', 'true');
    try {
      const bySlot = await loadShowcase(userId);
      paint(bySlot, await withMeta([...bySlot.values()].map((h) => h.card)));
    }
    catch (e) { body.innerHTML = `<p class="empty">Vitrine indisponible (${esc(errMsg(e))}).</p>`; }
    body.setAttribute('aria-busy', 'false');
  };

  el.querySelector('.shw-edit')?.addEventListener('click', (e) => openEditor(userId, refresh, e.currentTarget));
  await refresh();
}

/** Éditeur : choisir jusqu'à 3 exemplaires (un par emplacement), puis enregistrer. */
async function openEditor(userId, onSaved, btn) {
  btn.disabled = true;
  let collection, current;
  try {
    [collection, current] = await Promise.all([loadCollection(userId), loadShowcase(userId)]);
  } catch (e) {
    btn.disabled = false;
    toast(`Vitrine : ${errMsg(e)}`, 'error');
    return;
  }
  btn.disabled = false;

  const picks = SLOTS.map((s) => current.get(s)?.copy_id ?? null);
  const decorate = await withMeta(collection.map((r) => r.hg_cards));
  const byCopy = new Map(collection.map((r) => [String(r.id), r]));

  const dlg = document.createElement('dialog');
  dlg.className = 'shw-dlg';
  dlg.setAttribute('aria-labelledby', 'shw-dlg-title');
  dlg.innerHTML = `
    <div class="shw-dlg-inner">
      <header>
        <h2 id="shw-dlg-title" class="shw-dlg-title">Ma vitrine</h2>
        <p class="muted small">Choisis jusqu'à 3 cartes dans ta collection. Touche une carte pour l'ajouter ou la retirer, touche un emplacement pour le libérer.</p>
      </header>
      <div class="shw-dlg-picks" role="group" aria-label="Emplacements de la vitrine"></div>
      <h3 class="shw-sub">Ma collection <span class="muted small shw-count"></span></h3>
      <div class="shw-dlg-grid" role="group" aria-label="Ma collection"></div>
      <p class="shw-dlg-msg" role="status" aria-live="polite"></p>
      <div class="btn-row shw-dlg-actions">
        <button class="btn btn-ghost" type="button" data-cancel>Annuler</button>
        <button class="btn btn-primary" type="button" data-save>Enregistrer</button>
      </div>
    </div>`;
  document.body.append(dlg);
  const picksEl = dlg.querySelector('.shw-dlg-picks');
  const gridEl = dlg.querySelector('.shw-dlg-grid');
  const msgEl = dlg.querySelector('.shw-dlg-msg');
  const saveBtn = dlg.querySelector('[data-save]');
  const say = (t) => { msgEl.textContent = t; };

  const paint = () => {
    picksEl.innerHTML = SLOTS.map((s, i) => {
      const r = picks[i] != null ? byCopy.get(String(picks[i])) : null;
      return r
        ? `<button type="button" class="shw-pick" data-slot="${i}" aria-label="Libérer l'emplacement ${s} (${esc(r.hg_cards.name)})">${cardHtml(decorate(r.hg_cards), { shiny: r.shiny, serial: r.serial, size: 'sm' })}<span class="shw-pick-x">Libérer</span></button>`
        : `<div class="shw-pick shw-pick-empty"><span>Emplacement ${s}</span></div>`;
    }).join('');
    gridEl.innerHTML = collection.length ? collection.map((r) => {
      const idx = picks.findIndex((p) => p != null && String(p) === String(r.id));
      const label = `${r.hg_cards.name}${idx >= 0 ? `, dans la vitrine, emplacement ${idx + 1}` : ', ajouter à la vitrine'}`;
      return `<button type="button" class="shw-pickable${idx >= 0 ? ' is-picked' : ''}" data-copy="${esc(r.id)}" aria-label="${esc(label)}">${cardHtml(decorate(r.hg_cards), { shiny: r.shiny, serial: r.serial, size: 'sm' })}${idx >= 0 ? `<span class="shw-badge" aria-hidden="true">${idx + 1}</span>` : ''}</button>`;
    }).join('') : '<p class="empty">Tu n\'as pas encore de carte. Ouvre un booster pour commencer.</p>';
    dlg.querySelector('.shw-count').textContent = collection.length ? `(${collection.length} exemplaire${collection.length > 1 ? 's' : ''})` : '';
  };

  gridEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const idx = picks.findIndex((p) => p != null && String(p) === b.dataset.copy);
    if (idx >= 0) picks[idx] = null;
    else {
      const free = picks.indexOf(null);
      if (free < 0) { say('La vitrine est pleine : libère un emplacement d\'abord.'); return; }
      picks[free] = byCopy.get(b.dataset.copy).id;
    }
    say('');
    paint();
  });
  picksEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-slot]');
    if (!b) return;
    picks[Number(b.dataset.slot)] = null;
    say('');
    paint();
  });

  dlg.querySelector('[data-cancel]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // clic sur le fond
  dlg.addEventListener('close', () => dlg.remove(), { once: true });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    say('');
    try {
      const rows = SLOTS.flatMap((s, i) => (picks[i] != null ? [{ user_id: userId, slot: s, copy_id: picks[i] }] : []));
      const emptied = SLOTS.filter((s, i) => picks[i] == null);
      if (rows.length) {
        const { error } = await sb.from('hg_card_showcase').upsert(rows, { onConflict: 'user_id,slot' });
        if (error) throw error;
      }
      if (emptied.length) {
        const { error } = await sb.from('hg_card_showcase').delete().eq('user_id', userId).in('slot', emptied);
        if (error) throw error;
      }
      dlg.close();
      toast('Vitrine mise à jour', 'ok');
      await onSaved();
    } catch (e) {
      say(`Enregistrement impossible : ${errMsg(e)}`);
      saveBtn.disabled = false;
    }
  });

  paint();
  dlg.showModal();
}
