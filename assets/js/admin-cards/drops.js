// =====================================================================
// Cartes admin : drops de cartes (Jeu de cartes › Drops). Une carte apparaît sur le site pour les membres connectés ;
// les premiers qui cliquent la gagnent. Un membre n'en gagne qu'une par drop.
// Tables hg_card_drops / hg_card_drop_claims (lecture : permission cartes). Écritures uniquement par RPC :
// hg_drop_create (lancer) et hg_drop_stop (arrêter). Affichage côté membre : assets/js/card-drops.js.
// Dépendances : core.js (sb, toast, errMsg, esc, $), cartes-ui.js (rarityLabel), ui-confirm.js, admin/ui/drawer.js,
// admin/live.js (écoute temps réel), helpers.js (fetchAll, act, fmtWhen, thumb).
// Exporte : mountDropsSection (monte la section, appelé par admin-cards.js).
// =====================================================================
import { sb, toast, errMsg, esc, $ } from '../core.js';
import { rarityLabel } from '../cartes-ui.js';
import { confirmBox } from '../ui-confirm.js';
import { openDrawer } from '../admin/ui/drawer.js';
import { onTableChange } from '../admin/live.js';
import { fetchAll, act, fmtWhen, thumb } from './helpers.js';

/* État du module : racine de la section, drops, réclamations, cartes, pseudos par identifiant, bornes. */
const D = { root: null, drops: [], claims: [], cards: [], taken: new Set(), names: new Map(), limits: limitsOf(null) };
// Bornes des drops : hg_settings.cards.drops (réglables dans Cartes › Économie). Repli = valeurs de base.
function limitsOf(cfg) {
  const d = cfg?.drops || {};
  /* Entier strictement positif, sinon la valeur par défaut. */
  const num = (v, def) => (Number.isInteger(v) && v > 0 ? v : def);
  // Plafond des exemplaires : le réglage, borné à 1000 (contrainte technique de la table hg_card_drops, migration 055).
  const qmax = Math.min(num(d.quantite_max, 50), 1000), dmax = num(d.duree_max_min, 1440);
  return { qmax, dmax, dflt: Math.min(num(d.duree_defaut_min, 30), dmax) };
}
/* Nombre formaté selon la locale suisse-française. */
const fmtN = (n) => new Intl.NumberFormat('fr-CH').format(n);

/** Monte la section : structure, bouton « Lancer un drop » et écoute des nouvelles réclamations en direct. */
export async function mountDropsSection(container) {
  if (!container) return;
  D.root = container;
  container.innerHTML = `<div class="adc">
    <div class="adc-head">
      <p class="small muted">Une carte apparaît sur le site pour les membres connectés : les premiers qui cliquent la gagnent. Chaque membre n'en gagne qu'une par drop.</p>
      <button class="btn btn-primary" type="button" data-action="drop-new">+ Lancer un drop</button>
    </div>
    <div id="drop-list" class="adc-list" aria-live="polite"><div class="empty">Chargement des drops…</div></div>
  </div>`;
  container.addEventListener('click', onClick);
  onTableChange('drops', ['hg_card_drop_claims'], reload); // temps réel : nouveaux gagnants (la liste des drops se recharge après chaque action)
  await reload();
}

/** Lit les drops, les réclamations, les cartes, les pseudos et les bornes. Lève une erreur si la liste des pseudos échoue. */
async function load() {
  const [drops, claims, cards, dir, cfg] = await Promise.all([
    fetchAll(() => sb.from('hg_card_drops').select('*').order('starts_at', { ascending: false })),
    fetchAll(() => sb.from('hg_card_drop_claims').select('*').order('claimed_at', { ascending: true })),
    fetchAll(() => sb.from('hg_cards').select('id, name, rarity, image_url, can_shiny, max_copies, active, set_id, number').order('id')),
    sb.rpc('hg_staff_directory'),
    sb.from('hg_settings').select('value').eq('key', 'cards').maybeSingle(),
  ]);
  if (dir.error) throw dir.error;
  D.limits = limitsOf(cfg.error ? null : cfg.data?.value);
  D.drops = drops;
  D.claims = claims;
  D.cards = cards;
  D.names = new Map((dir.data || []).map((p) => [p.id, p.pseudo]));
  // Cartes uniques déjà attribuées (un exemplaire existe) : elles ne peuvent plus être lancées en drop.
  const uniqueIds = cards.filter((k) => k.rarity === 'unique').map((k) => k.id);
  D.taken = new Set();
  if (uniqueIds.length) {
    const copies = await fetchAll(() => sb.from('hg_card_copies').select('card_id').in('card_id', uniqueIds).is('recycled_at', null));
    D.taken = new Set(copies.map((x) => x.card_id));
  }
}

/** Relit toutes les données puis redessine. Un message d'erreur remplace la liste si ça échoue. */
async function reload() {
  const list = $('#drop-list', D.root);
  try {
    await load();
    render();
  } catch (e) {
    if (list) list.innerHTML = `<div class="empty">Impossible de charger les drops : ${esc(errMsg(e))}</div>`;
  }
}

/* Carte d'un identifiant, dans les cartes chargées. */
const cardOf = (id) => D.cards.find((k) => k.id === id);
/* Date lisible pour les drops (fuseau de Zurich). */
const dateFmt = (iso) => fmtWhen(iso);

/** État d'un drop : [libellé, classe de pastille]. */
function stateOf(d, won, now = Date.now()) {
  if (new Date(d.ends_at).getTime() <= now) return ['Terminé', 'pill-todo'];
  if (won >= d.quantity) return ['Épuisé', 'pill-todo'];
  return ['En cours', 'pill-ok'];
}

/** Dessine la liste des drops : en cours d'abord (le plus récent en tête), puis les terminés, avec leurs gagnants. */
function render() {
  const list = $('#drop-list', D.root);
  if (!list) return;
  if (!D.drops.length) { list.innerHTML = '<div class="empty">Aucun drop pour le moment. Lance le premier avec « Lancer un drop ».</div>'; return; }
  const now = Date.now();
  const claimsBy = new Map();
  for (const c of D.claims) { if (!claimsBy.has(c.drop_id)) claimsBy.set(c.drop_id, []); claimsBy.get(c.drop_id).push(c); }
  // En cours d'abord (le plus récent en tête), puis les terminés.
  const rows = [...D.drops].sort((a, b) => {
    const ea = new Date(a.ends_at).getTime() > now, eb = new Date(b.ends_at).getTime() > now;
    return ea === eb ? new Date(b.starts_at) - new Date(a.starts_at) : ea ? -1 : 1;
  });
  list.innerHTML = rows.map((d) => {
    const k = cardOf(d.card_id);
    const winners = claimsBy.get(d.id) || [];
    const [label, cls] = stateOf(d, winners.length, now);
    const live = label === 'En cours';
    const title = k ? k.name : 'Carte supprimée';
    const winnersHtml = winners.length
      ? `<ol class="drop-winners small">${winners.map((w) => `<li>${esc(D.names.get(w.user_id) || 'Ancien membre')} <span class="muted">· ${esc(dateFmt(w.claimed_at))}</span></li>`).join('')}</ol>`
      : '<p class="small muted">Personne n\'a encore attrapé la carte.</p>';
    return `<article class="card adc-row" aria-labelledby="drop-r-${esc(d.id)}">
      <div class="adc-row-head">
        <div class="drop-head">${k ? thumb(k) : ''}<h3 class="adc-row-title" id="drop-r-${esc(d.id)}">${esc(title)}${d.shiny ? ' <span class="muted">(brillante)</span>' : ''}</h3></div>
        <span class="pill ${cls}">${esc(label)}</span>
      </div>
      <p class="small muted">${k ? esc(rarityLabel(k.rarity)) + ' · ' : ''}${esc(String(winners.length))} / ${esc(String(d.quantity))} attrapé${winners.length > 1 ? 's' : ''}${d.announce ? '' : ' · hors du fil'}</p>
      <p class="small muted">${live ? `Jusqu'au ${esc(dateFmt(d.ends_at))}` : `Du ${esc(dateFmt(d.starts_at))} au ${esc(dateFmt(d.ends_at))}`}</p>
      ${winnersHtml}
      ${live ? `<div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-action="drop-stop" data-id="${esc(d.id)}">Arrêter</button></div>` : ''}
    </article>`;
  }).join('');
}

/* ---------- Lancer un drop (tiroir) ---------- */
/* Options d'une liste déroulante de cartes, avec la carte choisie pré-sélectionnée si elle figure dans la liste. */
const optionsHtml = (cards, selected = '') => cards.map((k) => {
  const taken = D.taken.has(k.id) && k.rarity === 'unique';
  return `<option value="${esc(k.id)}"${k.id === selected ? ' selected' : ''}${taken ? ' disabled' : ''}>${esc(k.name)} — ${esc(rarityLabel(k.rarity))}${k.can_shiny ? '' : ' (pas brillante)'}${taken ? ' : déjà attribuée' : ''}</option>`;
}).join('');

/** Ouvre le tiroir « Lancer un drop » : recherche de carte, quantité, durée et options. Contrôle les bornes avant l'envoi. */
function openDropForm() {
  const cards = D.cards.filter((k) => k.active).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  if (!cards.length) { toast('Aucune carte active : crée ou active une carte d\'abord.', 'error'); return; }
  const drawer = openDrawer({
    title: 'Lancer un drop',
    subtitle: 'La carte apparaît sur le site pour les membres connectés.',
    submitLabel: 'Lancer le drop',
    wide: true,
    body: `<div class="adc-form" id="drop-form">
      <div class="field adc-wide">
        <label for="drop-q">Rechercher une carte</label>
        <input id="drop-q" type="search" autocomplete="off" placeholder="Nom de la carte…">
      </div>
      <div class="field adc-wide">
        <label for="drop-card">Carte</label>
        <select id="drop-card" size="6" required>${optionsHtml(cards)}</select>
        <p class="small muted" id="drop-card-n" aria-live="polite"></p>
      </div>
      <div class="field">
        <label for="drop-qty">Exemplaires à attraper</label>
        <input id="drop-qty" type="number" min="1" max="${D.limits.qmax}" step="1" inputmode="numeric" value="1" required>
        <p class="small muted">De 1 à ${fmtN(D.limits.qmax)}. Les premiers qui cliquent les gagnent.</p>
      </div>
      <div class="field">
        <label for="drop-min">Durée (minutes)</label>
        <input id="drop-min" type="number" min="1" max="${D.limits.dmax}" step="1" inputmode="numeric" value="${D.limits.dflt}" required>
        <p class="small muted">De 1 à ${fmtN(D.limits.dmax)} minutes.</p>
      </div>
      <div class="field adc-wide">
        <label class="switch"><input type="checkbox" id="drop-shiny"><span class="switch-ui" aria-hidden="true"></span><span>Brillante</span></label>
      </div>
      <div class="field adc-wide">
        <label class="switch"><input type="checkbox" id="drop-announce" checked><span class="switch-ui" aria-hidden="true"></span><span>Annoncer dans le fil d'actualité</span></label>
      </div>
    </div>`,
    onSubmit: async (form) => {
      const card = form.querySelector('#drop-card').value;
      const qty = Number(form.querySelector('#drop-qty').value);
      const minutes = Number(form.querySelector('#drop-min').value);
      if (!card) throw new Error('Choisis une carte dans la liste.');
      if (D.taken.has(card) && cardOf(card)?.rarity === 'unique') throw new Error('Cette carte unique est déjà attribuée : plus aucun exemplaire disponible.');
      const { qmax, dmax } = D.limits;
      if (!Number.isInteger(qty) || qty < 1 || qty > qmax) throw new Error(`Le nombre d'exemplaires doit être entre 1 et ${fmtN(qmax)}.`);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > dmax) throw new Error(`La durée doit être entre 1 et ${fmtN(dmax)} minutes.`);
      const { error } = await sb.rpc('hg_drop_create', {
        p_card: card,
        p_shiny: form.querySelector('#drop-shiny').checked,
        p_quantity: qty,
        p_minutes: minutes,
        p_announce: form.querySelector('#drop-announce').checked,
      });
      if (error) throw error;
      toast('Drop lancé : la carte apparaît sur le site.', 'ok');
      await reload();
      return true;
    },
  });
  const q = drawer.form.querySelector('#drop-q');
  const sel = drawer.form.querySelector('#drop-card');
  const shiny = drawer.form.querySelector('#drop-shiny');
  const count = drawer.form.querySelector('#drop-card-n');
  // Recherche : filtre la liste en gardant la carte choisie si elle reste visible.
  const syncShiny = () => {
    const k = cardOf(sel.value);
    shiny.disabled = !k?.can_shiny;
    if (shiny.disabled) shiny.checked = false;
    count.textContent = `${sel.options.length} carte${sel.options.length > 1 ? 's' : ''} affichée${sel.options.length > 1 ? 's' : ''}`;
  };
  q.addEventListener('input', () => {
    const term = q.value.trim().toLowerCase();
    const keep = sel.value;
    const shown = cards.filter((k) => !term || k.name.toLowerCase().includes(term));
    sel.innerHTML = optionsHtml(shown, keep);
    if (!shown.some((k) => k.id === keep)) sel.selectedIndex = -1;
    // Premier choix possible (une carte déjà attribuée est désactivée dans la liste)
    if (sel.selectedIndex < 0 && shown.length) sel.selectedIndex = [...sel.options].findIndex((o) => !o.disabled);
    syncShiny();
  });
  sel.addEventListener('change', syncShiny);
  syncShiny();
  q.focus();
}

/* ---------- Actions ---------- */
/** Délégation des clics de la section : lancer un drop ou arrêter un drop en cours. */
function onClick(e) {
  const t = e.target.closest('[data-action]');
  if (!t || !D.root.contains(t)) return;
  if (t.dataset.action === 'drop-new') openDropForm();
  else if (t.dataset.action === 'drop-stop') stopDrop(t, t.dataset.id);
}

/** Arrête un drop après confirmation. La carte disparaît du site, mais les gagnants la gardent. */
async function stopDrop(btn, id) {
  const d = D.drops.find((x) => x.id === id);
  const k = d && cardOf(d.card_id);
  const ok = await confirmBox(
    `Arrêter le drop « ${k?.name ?? 'cette carte'} » ?`,
    'La carte disparaît du site tout de suite. Les membres qui l\'ont déjà attrapée la gardent.',
    { ok: 'Arrêter le drop', danger: true });
  if (!ok) return;
  await act(btn, async () => {
    const { error } = await sb.rpc('hg_drop_stop', { p_drop: id });
    if (error) throw error;
    toast('Drop arrêté.', 'ok');
    await reload();
  });
}
