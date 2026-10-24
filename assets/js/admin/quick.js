// =====================================================================
// Panel d'administration : actions rapides du plateau (Give, Nouvelle enchère, Lancer un drop).
// Le plateau (accueil du panel) envoie : document.dispatchEvent(new CustomEvent('hg:quick', { detail: { action } })),
// action = 'give' | 'enchere' | 'drop'. Si la personne a la permission « cartes », ce module appelle preventDefault()
// et ouvre une petite fenêtre (<dialog>) ; sans la permission, il ne fait rien et le bouton suit son lien (repli).
// Chaque fenêtre garde les mêmes contrôles et la même charge (RPC) que la page complète, qu'elle renvoie en lien
// « Ouvrir la page complète » :
//   give    : hg_cards_admin_bulk_give (validation, récapitulatif et arguments : admin-cards/bulk.js). Carte et booster
//             se choisissent sur leurs visuels (admin/visual-pick.js). Page : Fabrique › Gestion globale.
//   enchere : hg_auctions_admin (lecture), hg_auction_create (règles : enchere-regles.js). Page : Fabrique › Enchères.
//   drop    : hg_drop_create, puis hg-notify « card_drop » si la case Discord est cochée. Carte choisie sur ses visuels.
//             Page : Fabrique › Drops.
// Lectures : hg_members, hg_card_sets, hg_cards, hg_card_copies (restants), hg_booster_types, hg_settings (clé « cards », bornes des drops).
// Focus : la fenêtre est modale (<dialog>), Tab reste dedans, Échap ferme, le focus revient au bouton d'origine.
// Exporte : initQuick (à appeler une fois, dans admin.js), QUICK_PERM.
// Dépendances : core.js, cartes-ui.js (rarityLabel), admin-cards/helpers.js (check, fetchAll, fmtWhen, nf),
// admin-cards/bulk.js (KIND, recapText, invalide, argsDon), admin-cards/auctions.js (nextWeekend), enchere-regles.js,
// admin/visual-pick.js (sélecteurs visuels).
// =====================================================================
import { sb, toast, errMsg, esc, notify, getCachedPerms, hasPerm } from '../core.js';
import { check, fetchAll, fmtWhen, nf } from '../admin-cards/helpers.js';
import { KIND, recapText, invalide, argsDon } from '../admin-cards/bulk.js';
import { nextWeekend } from '../admin-cards/auctions.js';
import { rulesFieldsHtml, readRules } from '../enchere-regles.js';
import { cardPicker, boosterPicker, chargerBoosters, chargerRestants, visuelHtml } from './visual-pick.js';

/** Permission exigée pour les trois actions (Jeu de cartes). */
export const QUICK_PERM = 'cartes';
/** Feuille de style du module, chargée une fois à l'initialisation. */
const CSS_HREF = new URL('../../css/admin-quick.css', import.meta.url).href;

/** Fenêtre ouverte (une seule à la fois). */
let current = null;
/** Compteur pour des identifiants uniques. */
let seq = 0;

/* ---------- Petits utilitaires ---------- */
/** Texte normalisé pour la recherche : minuscules, sans accents. */
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Nombre suivi du mot au singulier ou au pluriel. */
const plur = (n, one, many) => `${nf(n)} ${n > 1 ? many : one}`;
/** Nombre entier formaté (locale suisse), comme dans la page des drops. */
const fmtN = (n) => new Intl.NumberFormat('fr-CH').format(n);
/** Valeur d'un champ datetime-local (heure locale). */
const toLocal = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
/** Bornes des drops : hg_settings.cards.drops, avec les valeurs de base en repli (comme admin-cards/drops.js). */
function limitsOf(cfg) {
  const d = cfg?.drops || {};
  const num = (v, def) => (Number.isInteger(v) && v > 0 ? v : def);
  const qmax = Math.min(num(d.quantite_max, 50), 1000), dmax = num(d.duree_max_min, 1440);
  return { qmax, dmax, dflt: Math.min(num(d.duree_defaut_min, 30), dmax) };
}

/* ---------- Coquille de fenêtre (commune aux trois actions) ---------- */
/**
 * Ouvre la fenêtre modale : titre, lien vers la page complète, zone de contenu (« Chargement… » au début) et pied.
 * @returns {{dlg: HTMLDialogElement, form: HTMLFormElement, body: HTMLElement, btns: HTMLElement, close: () => void}}
 */
function openShell({ title, sub, color, href, trigger }) {
  const id = `qk-${++seq}`;
  const dlg = document.createElement('dialog');
  dlg.className = 'qk-dlg';
  dlg.style.setProperty('--qk-c', color);
  dlg.setAttribute('aria-labelledby', `${id}-t`);
  dlg.setAttribute('aria-describedby', `${id}-s`);
  dlg.innerHTML = `<form class="qk-form" novalidate>
      <header class="qk-head">
        <div><h2 class="qk-title" id="${id}-t">${esc(title)}</h2><p class="qk-sub" id="${id}-s">${esc(sub)}</p></div>
        <button class="qk-x" type="button" data-qk-close aria-label="Fermer">×</button>
      </header>
      <div class="qk-body"><p class="small muted">Chargement…</p></div>
      <footer class="qk-foot">
        <a class="qk-link" href="${esc(href)}">Ouvrir la page complète</a>
        <div class="qk-btns"></div>
      </footer>
    </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const ui = { dlg, form, body: dlg.querySelector('.qk-body'), btns: dlg.querySelector('.qk-btns'), close };
  /** Ferme la fenêtre si elle est ouverte. */
  function close() { if (dlg.open) dlg.close(); }
  // Fermeture (croix, Annuler, Échap, voile) : la fenêtre se retire du DOM et le focus revient au bouton d'origine.
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (current === ui) current = null;
    if (trigger && trigger.isConnected) trigger.focus();
  });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-qk-close]')) { e.preventDefault(); close(); return; }
    if (e.target === dlg) close(); // clic sur le voile
  });
  dlg.addEventListener('keydown', trapTab);
  dlg.showModal();
  current = ui;
  return ui;
}

/** Garde le focus dans la fenêtre : Tab et Maj+Tab bouclent sur les éléments atteignables. */
function trapTab(e) {
  if (e.key !== 'Tab') return;
  const dlg = e.currentTarget;
  const f = [...dlg.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])')]
    .filter((el) => el.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  const inside = dlg.contains(document.activeElement);
  if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
}

/** Affiche le message d'erreur en haut du contenu ; vide = masqué. */
function showErr(ui, msg) {
  const err = ui.body.querySelector('.qk-err');
  if (!err) return;
  err.textContent = msg || '';
  err.hidden = !msg;
}

/** Affiche une erreur à la place du contenu (chargement échoué). */
function failLoad(ui, e) {
  ui.body.innerHTML = `<p class="qk-err" role="alert">Impossible de charger : ${esc(errMsg(e))}</p>`;
  ui.btns.innerHTML = '<button class="btn btn-ghost" type="button" data-qk-close>Fermer</button>';
}

/**
 * Deux volets dans le contenu (formulaire, confirmation) : on n'affiche que le volet demandé et le pied suit.
 * @param {object} ui fenêtre (openShell)
 * @param {'form'|'confirm'} pane volet à afficher
 * @param {{submit: string, confirm?: string}} labels libellés des boutons du pied
 */
function showPane(ui, pane, labels) {
  ui.body.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== pane; });
  showErr(ui, '');
  ui.btns.innerHTML = pane === 'form'
    ? `<button class="btn btn-ghost" type="button" data-qk-close>Annuler</button><button class="btn btn-primary" type="submit" data-qk-submit>${esc(labels.submit)}</button>`
    : `<button class="btn btn-ghost" type="button" data-qk-back>Retour</button><button class="btn btn-primary" type="button" data-qk-confirm>${esc(labels.confirm)}</button>`;
  const target = ui.body.querySelector(`[data-pane="${pane}"] [data-focus]`) || ui.btns.querySelector(pane === 'form' ? '[data-qk-submit]' : '[data-qk-confirm]');
  target?.focus();
}

/**
 * Branche le pied (Retour, Confirmer) et la soumission du formulaire.
 * @param {object} ui fenêtre
 * @param {() => void} onBack retour au formulaire
 * @param {(btn: HTMLButtonElement) => void} onConfirm confirmation et envoi
 * @param {() => void} onReview passage au récapitulatif (soumission du formulaire)
 */
function bindActions(ui, { onBack, onConfirm, onReview }) {
  ui.btns.addEventListener('click', (e) => {
    if (e.target.closest('[data-qk-back]')) { onBack(); return; }
    const c = e.target.closest('[data-qk-confirm]');
    if (c) onConfirm(c);
  });
  ui.form.addEventListener('submit', (e) => { e.preventDefault(); onReview(); });
}

/** Passe le bouton d'envoi en attente (désactivé, aria-busy) ; rétablit ensuite. */
function busyOn(btn) { if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); } }
function busyOff(btn) { if (btn) { btn.disabled = false; btn.removeAttribute('aria-busy'); } }

/* =========================================================
   1. Give : cartes, paillettes ou boosters à plusieurs membres
   ========================================================= */
/** Ouvre « Give ». Mêmes règles et même RPC que le tiroir « Don groupé » (admin-cards/bulk.js). */
async function openGive(trigger) {
  const ui = openShell({ title: 'Give', sub: 'Offrir quelque chose à des membres', color: '#159946', href: 'admin.html#fabrique/gestion', trigger });
  let members, sets, cards;
  try {
    [members, sets, cards] = await Promise.all([
      sb.rpc('hg_members').then(check),
      fetchAll(() => sb.from('hg_card_sets').select('id, name, sort').order('sort')),
      fetchAll(() => sb.from('hg_cards').select('*').eq('active', true).order('number')),
    ]);
  } catch (e) { failLoad(ui, e); return; }
  members = members ?? [];
  sets = (sets ?? []).sort((a, b) => a.sort - b.sort);
  cards = cards ?? [];
  const setsById = new Map(sets.map((s) => [s.id, s]));
  cards.forEach((k) => { k.set_name = setsById.get(k.set_id)?.name; });
  // Exemplaires restants et boosters : une lecture qui échoue ne bloque pas la fenêtre (le sélecteur reste utilisable).
  const [rest, boost] = await Promise.allSettled([chargerRestants(cards), chargerBoosters()]);
  const restants = rest.status === 'fulfilled' ? rest.value.restants : new Map();
  const types = boost.status === 'fulfilled' ? boost.value : null;
  const st = { kind: 'paillettes', amountRaw: String(KIND.paillettes.defaut), ids: new Set(), all: false, announce: true, note: '' };
  const titles = { paillettes: 'Montant par membre', carte: KIND.carte.champ, boosters: KIND.boosters.champ };
  /** Sélecteurs visuels (montés après le contenu) : carte et booster. */
  let carte = null, booster = null;

  ui.body.innerHTML = `
    <p class="qk-err" role="alert" hidden></p>
    <div class="qk-pane" data-pane="form">
      <section class="qk-sec">
        <p class="qk-label">Pour qui · <span data-count aria-live="polite"></span></p>
        <div class="field"><label for="qk-g-q">Rechercher un membre</label><input id="qk-g-q" type="search" autocomplete="off" placeholder="Pseudo" data-focus></div>
        <label class="check"><input type="checkbox" name="all"> <span>Tout le gang (${plur(members.length, 'membre actif', 'membres actifs')})</span></label>
        <div class="qk-chips" role="group" aria-label="Membres">${members.map((m) => `<button type="button" class="qk-chip" data-id="${esc(m.id)}" data-name="${esc(norm(m.pseudo))}" aria-pressed="false">${esc(m.pseudo)}</button>`).join('') || '<p class="small muted">Aucun membre actif.</p>'}</div>
      </section>
      <section class="qk-sec">
        <p class="qk-label" id="qk-g-kind-l">Quoi donner</p>
        <div class="qk-seg" role="group" aria-labelledby="qk-g-kind-l">
          <button type="button" data-kind="paillettes" aria-pressed="true">Paillettes</button>
          <button type="button" data-kind="carte" aria-pressed="false">Carte</button>
          <button type="button" data-kind="boosters" aria-pressed="false">Booster</button>
        </div>
      </section>
      <section class="qk-sec qk-card" hidden>
        <p class="qk-label">Carte</p>
        <div id="qk-g-cardhost"></div>
      </section>
      <section class="qk-sec qk-boost" hidden>
        <p class="qk-label">Booster</p>
        <div id="qk-g-boosthost">${types ? '' : `<p class="form-error" role="alert">Impossible de charger les boosters : ${esc(errMsg(boost.reason))}</p>`}</div>
      </section>
      <section class="qk-sec">
        <p class="qk-label" id="qk-g-amt-l">${esc(titles.paillettes)}</p>
        <div class="qk-step">
          <button type="button" class="qk-step-btn" data-step="-1" aria-label="Diminuer">−</button>
          <div class="field qk-amount"><input id="qk-g-amt" name="amount" type="number" inputmode="numeric" step="1" min="${KIND.paillettes.min}" max="${KIND.paillettes.max}" value="${KIND.paillettes.defaut}" aria-labelledby="qk-g-amt-l"></div>
          <button type="button" class="qk-step-btn" data-step="1" aria-label="Augmenter">+</button>
        </div>
      </section>
      <section class="qk-sec">
        <label class="check"><input type="checkbox" name="announce" checked> <span>Afficher dans le fil d'actualité (une seule ligne groupée)</span></label>
        <div class="field"><label for="qk-g-note">Note <span class="muted small">(facultatif, réservée au journal admin)</span></label><input id="qk-g-note" name="note" maxlength="200" autocomplete="off"></div>
      </section>
      <p class="qk-sum" aria-live="polite"></p>
    </div>
    <div class="qk-pane" data-pane="confirm" hidden>
      <div class="vp-preview" data-confirm-visual></div>
      <p class="qk-sum qk-sum-strong" data-confirm></p>
      <p class="small muted" data-confirm-who></p>
      <p class="small muted">Le don est définitif. Les MP Discord ne sont pas envoyés par ce formulaire.</p>
    </div>`;

  /** Lecture du formulaire, au format attendu par recapText et argsDon (admin-cards/bulk.js). */
  const read = () => {
    const kind = st.kind;
    const all = st.all;
    const cp = carte ? carte.value() : { card: '', name: '', obj: null, shiny: false };
    const bo = booster ? booster.value() : { id: '', name: '', obj: null };
    const estCarte = kind === 'carte', estBoost = kind === 'boosters';
    return {
      kind, cfg: KIND[kind], amount: Number(String(st.amountRaw).trim()),
      card: estCarte ? cp.card : '', shiny: estCarte && cp.shiny, carteNom: cp.name,
      booster: estBoost ? bo.id : '', boosterNom: estBoost ? bo.name : '',
      visuel: estCarte ? cp.obj : estBoost ? bo.obj : null,
      all, ids: [...st.ids], n: all ? members.length : st.ids.size,
      announce: st.announce, note: st.note.trim(),
    };
  };
  /** Met à jour les états affichés (type, carte ou booster, montant, compteur, récapitulatif). */
  const refresh = () => {
    const v = read();
    ui.body.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === st.kind)));
    ui.body.querySelector('.qk-card').hidden = st.kind !== 'carte';
    ui.body.querySelector('.qk-boost').hidden = st.kind !== 'boosters';
    ui.body.querySelector('#qk-g-amt-l').textContent = titles[st.kind];
    const amt = ui.body.querySelector('#qk-g-amt');
    amt.min = v.cfg.min; amt.max = v.cfg.max;
    ui.body.querySelector('[data-count]').textContent = st.all ? `tout le gang (${plur(members.length, 'membre', 'membres')})` : `${nf(st.ids.size)} choisi${st.ids.size > 1 ? 's' : ''}`;
    ui.body.querySelectorAll('.qk-chip').forEach((c) => { c.setAttribute('aria-pressed', String(st.ids.has(c.dataset.id))); c.disabled = st.all; });
    const sum = ui.body.querySelector('.qk-sum:not(.qk-sum-strong)');
    sum.textContent = recapText(v);
    sum.classList.toggle('is-warn', invalide(v));
  };

  bindActions(ui, {
    onBack: () => showPane(ui, 'form', { submit: 'Donner' }),
    onReview: () => {
      const v = read();
      if (invalide(v)) { showErr(ui, recapText(v)); ui.body.querySelector('[data-pane="form"]').scrollIntoView?.({ block: 'nearest' }); return; }
      const who = v.all ? 'Destinataires : tout le gang.' : `Destinataires : ${[...st.ids].map((id) => (members.find((m) => m.id === id)?.pseudo ?? '')).filter(Boolean).join(', ')}.`;
      ui.body.querySelector('[data-confirm]').textContent = recapText(v);
      ui.body.querySelector('[data-confirm-who]').textContent = who;
      ui.body.querySelector('[data-confirm-visual]').innerHTML = visuelHtml(v.kind, v.visuel);
      showPane(ui, 'confirm', { submit: 'Donner', confirm: 'Confirmer le don' });
    },
    onConfirm: (btn) => sendGive(ui, read(), btn),
  });

  ui.body.addEventListener('click', (e) => {
    const chip = e.target.closest('.qk-chip');
    if (chip && !st.all) { const id = chip.dataset.id; st.ids.has(id) ? st.ids.delete(id) : st.ids.add(id); refresh(); return; }
    const kindBtn = e.target.closest('[data-kind]');
    if (kindBtn) {
      const old = KIND[st.kind];
      const next = kindBtn.dataset.kind;
      // Quand on change de type, le montant revient à la valeur par défaut du nouveau type (sinon on garde la saisie).
      if (next !== st.kind && Number(st.amountRaw) === old.defaut) { st.amountRaw = String(KIND[next].defaut); ui.body.querySelector('#qk-g-amt').value = st.amountRaw; }
      st.kind = next; refresh(); return;
    }
    const step = e.target.closest('[data-step]');
    if (step) {
      const cfg = KIND[st.kind];
      const cur = Number(String(st.amountRaw).trim()) || 0;
      const val = Math.min(cfg.max, Math.max(cfg.min, cur + Number(step.dataset.step)));
      st.amountRaw = String(val); ui.body.querySelector('#qk-g-amt').value = st.amountRaw; refresh();
    }
  });
  ui.body.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'qk-g-q') {
      const needle = norm(t.value.trim());
      ui.body.querySelectorAll('.qk-chip').forEach((c) => { c.hidden = !!needle && !c.dataset.name.includes(needle); });
    } else if (t.id === 'qk-g-amt') { st.amountRaw = t.value; }
    else if (t.id === 'qk-g-note') { st.note = t.value; }
    refresh();
  });
  ui.body.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'all') st.all = t.checked;
    else if (t.name === 'announce') st.announce = t.checked;
    refresh();
  });

  // Sélecteurs visuels : montés une fois le contenu en place ; chaque choix relance le récapitulatif.
  carte = cardPicker(ui.body.querySelector('#qk-g-cardhost'), { cards, sets, restants, idp: 'qk-gc', onChange: () => refresh() });
  if (types) booster = boosterPicker(ui.body.querySelector('#qk-g-boosthost'), { types, idp: 'qk-gb', value: 'classique', onChange: () => refresh() });
  showPane(ui, 'form', { submit: 'Donner' });
  refresh();
}

/**
 * Envoie le don : même appel que donnerGroupe (admin-cards/bulk.js), sans la confirmation de ce module (déjà affichée).
 * @param {object} ui fenêtre
 * @param {object} v valeurs lues (read)
 * @param {HTMLButtonElement} btn bouton « Confirmer le don »
 */
async function sendGive(ui, v, btn) {
  if (invalide(v)) { showErr(ui, recapText(v)); return; }
  busyOn(btn);
  try {
    const res = check(await sb.rpc('hg_cards_admin_bulk_give', argsDon(v)));
    const servis = Number(res?.membres) || v.n;
    toast(`Don envoyé à ${plur(servis, 'membre', 'membres')}`, 'ok');
    ui.close();
  } catch (e) {
    showErr(ui, errMsg(e));
    busyOff(btn);
  }
}

/* =========================================================
   2. Nouvelle enchère : une carte unique, planifiée
   ========================================================= */
/** Ouvre « Nouvelle enchère ». Mêmes contrôles que le formulaire d'admin-cards/auctions.js (carte unique, règles). */
async function openEnchere(trigger) {
  const ui = openShell({ title: 'Nouvelle enchère', sub: 'Une carte unique, mise aux enchères pour le week-end par défaut.', color: '#FCA301', href: 'admin.html#fabrique/encheres', trigger });
  let cards, copies, auctions;
  try {
    cards = await fetchAll(() => sb.from('hg_cards').select('id, name, rarity, member_id, family').order('id'));
    const uniqueIds = cards.filter((k) => k.rarity === 'unique').map((k) => k.id);
    copies = uniqueIds.length ? await fetchAll(() => sb.from('hg_card_copies').select('card_id').in('card_id', uniqueIds)) : [];
    auctions = check(await sb.rpc('hg_auctions_admin')) ?? [];
  } catch (e) { failLoad(ui, e); return; }
  // Mêmes filtres que la page : carte unique, pas une carte de membre, pas encore attribuée, pas déjà aux enchères.
  const owned = new Set(copies.map((x) => x.card_id));
  const booked = new Set(auctions.filter((a) => a.status === 'prevue' || a.status === 'ouverte').map((a) => a.card_id));
  const eligible = cards.filter((k) => k.rarity === 'unique' && !k.member_id && k.family !== 'membre' && !owned.has(k.id) && !booked.has(k.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const byId = new Map(cards.map((k) => [k.id, k]));
  const { start, end } = nextWeekend();

  if (!eligible.length) {
    ui.body.innerHTML = '<p class="qk-empty">Aucune carte unique disponible : crée une carte de rareté « Unique » (Catalogue › Cartes).</p>';
    ui.btns.innerHTML = '<button class="btn btn-ghost" type="button" data-qk-close>Fermer</button>';
    return;
  }
  ui.body.innerHTML = `
    <p class="qk-err" role="alert" hidden></p>
    <div class="qk-pane" data-pane="form">
      <section class="qk-sec">
        <div class="field"><label for="qk-a-card">Carte unique</label>
          <select id="qk-a-card" name="card_id" data-focus>${eligible.map((k) => `<option value="${esc(k.id)}">${esc(k.name)}</option>`).join('')}</select></div>
        <div class="qk-pair">
          <div class="field"><label for="qk-a-start">Début</label><input id="qk-a-start" name="starts_at" type="datetime-local" value="${toLocal(start)}" required></div>
          <div class="field"><label for="qk-a-end">Fin</label><input id="qk-a-end" name="ends_at" type="datetime-local" value="${toLocal(end)}" required></div>
        </div>
      </section>
      <details class="qk-adv">
        <summary>Règles de l’enchère (valeurs par défaut)</summary>
        ${rulesFieldsHtml('qk-auc')}
      </details>
    </div>
    <div class="qk-pane" data-pane="confirm" hidden>
      <p class="qk-sum qk-sum-strong" data-confirm></p>
      <p class="small muted">Les Paillettes du gagnant sont détruites. La carte reste en réserve si personne n'offre.</p>
    </div>`;

  bindActions(ui, {
    onBack: () => showPane(ui, 'form', { submit: 'Planifier l’enchère' }),
    onReview: () => {
      const f = ui.form;
      const card = byId.get(f.elements.card_id.value);
      const s = f.elements.starts_at.value, e = f.elements.ends_at.value;
      if (!card) { showErr(ui, 'Choisis une carte.'); return; }
      if (!s || !e || new Date(e) <= new Date(s)) { showErr(ui, 'La fin doit être après le début.'); return; }
      const r = readRules(f);
      ui.body.querySelector('[data-confirm]').textContent =
        `« ${card.name} » aux enchères du ${fmtWhen(new Date(s).toISOString())} au ${fmtWhen(new Date(e).toISOString())}. `
        + `Mise de départ ${nf(r.min_bid)} ✦, pas de ${nf(r.step)} ✦.`;
      showPane(ui, 'confirm', { submit: 'Planifier l’enchère', confirm: 'Planifier l’enchère' });
    },
    onConfirm: (btn) => sendAuction(ui, btn),
  });
  showPane(ui, 'form', { submit: 'Planifier l’enchère' });
}

/**
 * Crée l'enchère : mêmes champs que le formulaire de la page (règles lues telles quelles, dates en ISO).
 * @param {object} ui fenêtre
 * @param {HTMLButtonElement} btn bouton de confirmation
 */
async function sendAuction(ui, btn) {
  busyOn(btn);
  try {
    const f = ui.form;
    const p = { ...readRules(f), card_id: f.elements.card_id.value, starts_at: new Date(f.elements.starts_at.value).toISOString(), ends_at: new Date(f.elements.ends_at.value).toISOString() };
    check(await sb.rpc('hg_auction_create', { p }));
    toast('Enchère planifiée', 'ok');
    ui.close();
  } catch (e) {
    showErr(ui, errMsg(e));
    busyOff(btn);
  }
}

/* =========================================================
   3. Lancer un drop : une carte sauvage pour les premiers qui cliquent
   ========================================================= */
/** Ouvre « Lancer un drop ». Mêmes bornes, mêmes contrôles et même RPC que admin-cards/drops.js. */
async function openDrop(trigger) {
  const ui = openShell({ title: 'Lancer un drop', sub: 'La carte apparaît sur le site pour les membres connectés.', color: '#2B5AE2', href: 'admin.html#fabrique/drops', trigger });
  let cards, sets, restants, cfg;
  try {
    [cards, sets, cfg] = await Promise.all([
      fetchAll(() => sb.from('hg_cards').select('*').order('id')),
      fetchAll(() => sb.from('hg_card_sets').select('id, name, sort').order('sort')),
      sb.from('hg_settings').select('value').eq('key', 'cards').maybeSingle(),
    ]);
    ({ restants } = await chargerRestants(cards));
  } catch (e) { failLoad(ui, e); return; }
  const limits = limitsOf(cfg.error ? null : cfg.data?.value);
  const actives = cards.filter((k) => k.active).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const setsById = new Map((sets ?? []).map((s) => [s.id, s]));
  actives.forEach((k) => { k.set_name = setsById.get(k.set_id)?.name; });
  if (!actives.length) {
    ui.body.innerHTML = '<p class="qk-empty">Aucune carte active : crée ou active une carte d’abord.</p>';
    ui.btns.innerHTML = '<button class="btn btn-ghost" type="button" data-qk-close>Fermer</button>';
    return;
  }
  /** Motif qui interdit le choix : exemplaire unique déjà attribué, ou plus aucun exemplaire (numéros épuisés). */
  const bloque = (k) => (restants.has(k.id) && restants.get(k.id) <= 0 ? (k.rarity === 'unique' ? 'Déjà attribuée' : 'Épuisée') : '');
  /** Message d'erreur pour une carte bloquée (même texte que la page des drops). */
  const motifRefus = (k) => (k?.rarity === 'unique'
    ? 'Cette carte unique est déjà attribuée : plus aucun exemplaire disponible.'
    : 'Cette carte n’a plus d’exemplaire disponible.');
  /** Sélecteur visuel de carte (monté après le contenu). */
  let pick = null;

  ui.body.innerHTML = `
    <p class="qk-err" role="alert" hidden></p>
    <div class="qk-pane" data-pane="form">
      <section class="qk-sec">
        <p class="qk-label">Carte</p>
        <div id="qk-d-pick"></div>
        <div class="qk-pair">
          <div class="field"><label for="qk-d-qty">Exemplaires à attraper</label>
            <input id="qk-d-qty" type="number" min="1" max="${limits.qmax}" step="1" inputmode="numeric" value="1">
            <p class="small muted">De 1 à ${fmtN(limits.qmax)}. Les premiers qui cliquent les gagnent.</p></div>
          <div class="field"><label for="qk-d-min">Durée (minutes)</label>
            <input id="qk-d-min" type="number" min="1" max="${limits.dmax}" step="1" inputmode="numeric" value="${limits.dflt}">
            <p class="small muted">De 1 à ${fmtN(limits.dmax)} minutes.</p></div>
        </div>
        <label class="check"><input type="checkbox" name="announce" checked> <span>Annoncer dans le fil d'actualité</span></label>
        <label class="check"><input type="checkbox" name="discord" checked> <span>Annoncer sur Discord</span></label>
      </section>
    </div>
    <div class="qk-pane" data-pane="confirm" hidden>
      <div class="vp-preview" data-confirm-visual></div>
      <p class="qk-sum qk-sum-strong" data-confirm></p>
      <p class="small muted" data-confirm-opts></p>
    </div>`;

  pick = cardPicker(ui.body.querySelector('#qk-d-pick'), { cards: actives, sets, restants, bloque, idp: 'qk-d' });
  ui.body.querySelector('#qk-d-q')?.setAttribute('data-focus', '');

  /** Lecture et contrôle, mêmes messages que la page des drops. Renvoie { error } ou les valeurs. */
  const lire = () => {
    const v = pick.value();
    const qty = Number(ui.body.querySelector('#qk-d-qty').value);
    const minutes = Number(ui.body.querySelector('#qk-d-min').value);
    if (!v.card) return { error: 'Choisis une carte dans la liste.' };
    if (bloque(v.obj)) return { error: motifRefus(v.obj) };
    if (!Number.isInteger(qty) || qty < 1 || qty > limits.qmax) return { error: `Le nombre d'exemplaires doit être entre 1 et ${fmtN(limits.qmax)}.` };
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > limits.dmax) return { error: `La durée doit être entre 1 et ${fmtN(limits.dmax)} minutes.` };
    return {
      card: v.card, obj: v.obj, qty, minutes,
      shiny: !!v.shiny,
      announce: ui.body.querySelector('[name="announce"]').checked,
      discord: ui.body.querySelector('[name="discord"]').checked,
    };
  };

  bindActions(ui, {
    onBack: () => showPane(ui, 'form', { submit: 'Lancer le drop' }),
    onReview: () => {
      const v = lire();
      if (v.error) { showErr(ui, v.error); return; }
      ui.body.querySelector('[data-confirm]').textContent =
        `Lancer « ${v.obj?.name ?? 'cette carte'} »${v.shiny ? ' (brillante)' : ''} : ${plur(v.qty, 'exemplaire à attraper', 'exemplaires à attraper')} pendant ${nf(v.minutes)} min.`;
      ui.body.querySelector('[data-confirm-opts]').textContent =
        `${v.announce ? 'Annoncé dans le fil.' : 'Hors du fil.'} ${v.discord ? 'Annonce Discord : oui (le bot poste dans le salon).' : 'Annonce Discord : non.'}`;
      ui.body.querySelector('[data-confirm-visual]').innerHTML = visuelHtml('carte', v.obj);
      showPane(ui, 'confirm', { submit: 'Lancer le drop', confirm: 'Lancer le drop' });
    },
    onConfirm: (btn) => { const v = lire(); if (v.error) { showErr(ui, v.error); return; } sendDrop(ui, v, btn); },
  });
  showPane(ui, 'form', { submit: 'Lancer le drop' });
}

/**
 * Lance le drop (hg_drop_create), puis l'annonce Discord si la case est cochée. L'annonce ne bloque jamais le lancement.
 * @param {object} ui fenêtre
 * @param {object} v valeurs lues (carte, quantité, durée, options)
 * @param {HTMLButtonElement} btn bouton de confirmation
 */
async function sendDrop(ui, v, btn) {
  busyOn(btn);
  try {
    const { data: dropId, error } = await sb.rpc('hg_drop_create', {
      p_card: v.card, p_shiny: v.shiny, p_quantity: v.qty, p_minutes: v.minutes, p_announce: v.announce,
    });
    if (error) throw error;
    toast('Drop lancé : la carte apparaît sur le site.', 'ok');
    if (v.discord && typeof dropId === 'string') notify('card_drop', { drop_id: dropId });
    ui.close();
  } catch (e) {
    showErr(ui, errMsg(e));
    busyOff(btn);
  }
}

/* =========================================================
   Écoute de l'événement du plateau
   ========================================================= */
/** Ouverture par action. */
const OPENERS = { give: openGive, enchere: openEnchere, drop: openDrop };

/**
 * Gestionnaire de « hg:quick ». Sans la permission, ou pour une action inconnue, rien n'est fait :
 * l'appelant (le plateau) suit son lien habituel.
 * @param {CustomEvent} e
 */
function onQuick(e) {
  const action = e?.detail?.action;
  const open = OPENERS[action];
  if (!open) return;
  if (!hasPerm(QUICK_PERM, getCachedPerms())) return; // pas de droit : repli (navigation)
  e.preventDefault();
  if (current?.dlg?.open) return; // une fenêtre est déjà ouverte
  open(document.activeElement);
}

/** Branche le module : feuille de style et écoute de « hg:quick ». À appeler une fois, dans admin.js. */
let inited = false;
export function initQuick() {
  if (inited) return;
  inited = true;
  if (!document.querySelector(`link[data-qk-css]`)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = CSS_HREF;
    link.dataset.qkCss = '';
    document.head.append(link);
  }
  document.addEventListener('hg:quick', onQuick);
}
