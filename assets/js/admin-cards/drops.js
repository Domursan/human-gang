// =====================================================================
// Cartes admin : drops de cartes (Jeu de cartes › Drops). Une carte apparaît sur le site pour les membres connectés ;
// les premiers qui cliquent la gagnent. Un membre n'en gagne qu'une par drop.
// Tables hg_card_drops / hg_card_drop_claims (lecture : permission cartes). Écritures uniquement par RPC :
// hg_drop_create (lancer) et hg_drop_stop (arrêter). Affichage côté membre : assets/js/card-drops.js.
// La carte se choisit sur ses visuels (admin/visual-pick.js). Une carte unique déjà attribuée, ou sans exemplaire
// disponible, ne peut pas être lancée (chargerRestants). Annonce Discord facultative : hg-notify, événement card_drop.
// Dépendances : core.js (sb, toast, errMsg, esc, $, notify), cartes-ui.js (rarityLabel), ui-confirm.js, admin/ui/drawer.js,
// admin/live.js (écoute temps réel), admin/visual-pick.js (sélecteur de carte, restants, aperçu), helpers.js (fetchAll, act, fmtWhen, nf).
// Exporte : mountDropsSection (monte la section, appelé par admin-cards.js).
// =====================================================================
import { sb, toast, errMsg, esc, $, notify } from '../core.js';
import { rarityLabel } from '../cartes-ui.js';
import { confirmBox } from '../ui-confirm.js';
import { openDrawer } from '../admin/ui/drawer.js';
import { onTableChange } from '../admin/live.js';
import { cardPicker, chargerRestants, visuelHtml, libelleEpuisee } from '../admin/visual-pick.js';
import { fetchAll, act, fmtWhen, thumb, nf } from './helpers.js';

/* État du module : racine de la section, drops, réclamations, cartes, séries, exemplaires restants, pseudos, bornes. */
const D = { root: null, drops: [], claims: [], cards: [], sets: [], restants: new Map(), names: new Map(), limits: limitsOf(null) };
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

/** Lit les drops, les réclamations, les cartes, les séries, les exemplaires restants, les pseudos et les bornes. Lève une erreur si la liste des pseudos échoue. */
async function load() {
  const [drops, claims, cards, sets, dir, cfg] = await Promise.all([
    fetchAll(() => sb.from('hg_card_drops').select('*').order('starts_at', { ascending: false })),
    fetchAll(() => sb.from('hg_card_drop_claims').select('*').order('claimed_at', { ascending: true })),
    fetchAll(() => sb.from('hg_cards').select('*').order('id')),
    fetchAll(() => sb.from('hg_card_sets').select('id, name, sort').order('sort')),
    sb.rpc('hg_staff_directory'),
    sb.from('hg_settings').select('value').eq('key', 'cards').maybeSingle(),
  ]);
  if (dir.error) throw dir.error;
  D.limits = limitsOf(cfg.error ? null : cfg.data?.value);
  D.drops = drops;
  D.claims = claims;
  D.cards = cards;
  D.sets = sets;
  D.names = new Map((dir.data || []).map((p) => [p.id, p.pseudo]));
  // Exemplaires restants (cartes à tirage limité) et cartes uniques déjà attribuées : elles ne peuvent plus être lancées.
  D.restants = (await chargerRestants(cards)).restants;
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
/** Ouvre le tiroir « Lancer un drop » : carte choisie sur ses visuels, quantité, durée et options. Contrôle les bornes avant l'envoi. */
function openDropForm() {
  const cards = D.cards.filter((k) => k.active).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  if (!cards.length) { toast('Aucune carte active : crée ou active une carte d\'abord.', 'error'); return; }
  const setsById = new Map(D.sets.map((s) => [s.id, s]));
  cards.forEach((k) => { k.set_name = setsById.get(k.set_id)?.name; });
  /** Motif qui interdit le choix : tous les exemplaires attribués (unique), ou plus aucun exemplaire (numéros épuisés). */
  const bloque = (k) => (D.restants.has(k.id) && D.restants.get(k.id) <= 0 ? libelleEpuisee(k) : '');
  /** Sélecteur visuel de carte (monté après l'ouverture du tiroir). */
  let pick = null;
  const drawer = openDrawer({
    title: 'Lancer un drop',
    subtitle: 'La carte apparaît sur le site pour les membres connectés.',
    submitLabel: 'Lancer le drop',
    wide: true,
    body: `<div class="adc-form" id="drop-form">
      <div class="field adc-wide">
        <p class="small muted">Carte</p>
        <div id="drop-pick"></div>
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
        <label class="switch"><input type="checkbox" id="drop-announce" checked><span class="switch-ui" aria-hidden="true"></span><span>Annoncer dans le fil d'actualité</span></label>
      </div>
      <div class="field adc-wide">
        <label class="switch"><input type="checkbox" id="drop-discord" checked><span class="switch-ui" aria-hidden="true"></span><span>Annoncer sur Discord</span></label>
        <p class="small muted">Le bot poste « Une carte sauvage est apparue ! » dans le salon (réglages dans Pilotage › Bot Discord).</p>
      </div>
      <div class="vp-preview adc-wide" id="drop-visual" hidden></div>
      <p class="acd-sum adc-wide" id="drop-recap" aria-live="polite"></p>
    </div>`,
    onSubmit: async () => {
      const v = pick.value();
      const card = v.card;
      const qty = Number(drawer.form.querySelector('#drop-qty').value);
      const minutes = Number(drawer.form.querySelector('#drop-min').value);
      if (!card) throw new Error('Choisis une carte dans la liste.');
      if (bloque(v.obj)) throw new Error(v.obj?.rarity === 'unique'
        ? (Number(v.obj.max_copies) > 1 ? 'Tous les exemplaires de cette carte unique sont attribués : plus aucun exemplaire disponible.' : 'Cette carte unique est déjà attribuée : plus aucun exemplaire disponible.')
        : 'Cette carte n’a plus d’exemplaire disponible.');
      const { qmax, dmax } = D.limits;
      if (!Number.isInteger(qty) || qty < 1 || qty > qmax) throw new Error(`Le nombre d'exemplaires doit être entre 1 et ${fmtN(qmax)}.`);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > dmax) throw new Error(`La durée doit être entre 1 et ${fmtN(dmax)} minutes.`);
      const discord = drawer.form.querySelector('#drop-discord').checked;
      const { data: dropId, error } = await sb.rpc('hg_drop_create', {
        p_card: card,
        p_shiny: v.shiny,
        p_quantity: qty,
        p_minutes: minutes,
        p_announce: drawer.form.querySelector('#drop-announce').checked,
      });
      if (error) throw error;
      toast('Drop lancé : la carte apparaît sur le site.', 'ok');
      // Annonce Discord : ne bloque jamais le lancement (notify signale lui-même une erreur à l'admin).
      if (discord && typeof dropId === 'string') notify('card_drop', { drop_id: dropId });
      await reload();
      return true;
    },
  });
  const form = drawer.form;
  pick = cardPicker(form.querySelector('#drop-pick'), { cards, sets: D.sets, restants: D.restants, bloque, idp: 'drop' });
  /** Récapitulatif en direct : texte et visuel de la carte choisie. */
  const recap = () => {
    const v = pick.value();
    const qty = Number(form.querySelector('#drop-qty').value);
    const minutes = Number(form.querySelector('#drop-min').value);
    form.querySelector('#drop-recap').textContent = v.card
      ? `Lancer « ${v.name} »${v.shiny ? ' (brillante)' : ''} : ${Number.isInteger(qty) && qty > 0 ? nf(qty) : '–'} exemplaire${qty > 1 ? 's' : ''} à attraper pendant ${Number.isInteger(minutes) && minutes > 0 ? nf(minutes) : '–'} min.`
      : 'Choisis une carte.';
    const vis = form.querySelector('#drop-visual');
    vis.innerHTML = visuelHtml('carte', v.obj);
    vis.hidden = !v.obj;
  };
  form.addEventListener('input', recap);
  form.addEventListener('change', recap);
  recap();
  pick.focus();
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
