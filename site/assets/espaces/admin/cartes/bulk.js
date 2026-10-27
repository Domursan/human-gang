// =====================================================================
// Cartes admin : don groupé (Paillettes, boosters offerts ou une carte) à plusieurs membres, ou à tout le gang.
// Tiroir ouvert depuis Économie. La RPC hg_cards_admin_bulk_give fait tout ou rien et écrit une seule ligne dans le fil.
// Carte et booster se choisissent sur leurs visuels (admin/visual-pick.js) ; p_booster = identifiant du booster offert.
// Les MP Discord ne sont pas envoyés par ce tiroir.
// Dépendances : core.js (sb, toast, errMsg, esc, $), ui-confirm.js (confirmBox),
// admin/ui/drawer.js (tiroir), admin/visual-pick.js (sélecteurs), state.js (C), data.js (refresh), helpers.js (check, nf, activeProfiles).
// Exporte : openBulkGift, donnerGroupe (confirmation + RPC, réutilisée par admin-gestion.js), recapText, invalide, argsDon, KIND, MAX_MEMBRES.
// =====================================================================
import { sb, toast, errMsg, esc, $ } from '../../../commun/core.js';
import { confirmBox } from '../../../commun/ui-confirm.js';
import { openDrawer } from '../ui/drawer.js';
import { cardPicker, boosterPicker, chargerBoosters, chargerRestants, visuelHtml, libelleEpuisee } from '../visual-pick.js';
import { C } from './state.js';
import { refresh } from './data.js';
import { check, nf, activeProfiles } from './helpers.js';

export const MAX_MEMBRES = 200; // doit correspondre à la migration 042
/* Les trois sortes de don : libellé, nom du champ de montant, valeur par défaut et bornes autorisées. */
export const KIND = {
  paillettes: { label: 'Paillettes', champ: 'Paillettes par membre', defaut: 100, min: 1, max: 10000 },
  boosters: { label: 'Boosters offerts', champ: 'Boosters par membre', defaut: 1, min: 1, max: 50 },
  carte: { label: 'Une carte', champ: 'Exemplaires par membre', defaut: 1, min: 1, max: 10 },
};
/* Sélecteurs visuels du tiroir, par formulaire : { carte, boost } (absents tant que les données ne sont pas lues). */
const PICK = new WeakMap();
/* Nombre suivi du mot au singulier ou au pluriel (« 1 booster », « 3 boosters »). */
const plur = (n, one, many) => `${nf(n)} ${n > 1 ? many : one}`;

/** HTML du tiroir : type de don, montant, carte ou booster (visuels), destinataires, notes. */
function bodyHtml() {
  const rows = activeProfiles().map((p) => `<label class="acd-bulk-row"><input type="checkbox" name="who" value="${esc(p.id)}">
    <span>${esc(p.pseudo)}</span></label>`).join('');
  return `<div class="stack acd-form" id="acd-bulk">
    <p class="form-error" role="alert" hidden></p>
    <div class="acd-grid-2">
      <div class="field"><label for="acd-bulk-kind">Ce qui est donné</label>
        <select id="acd-bulk-kind" name="kind">
          <option value="paillettes">Paillettes</option>
          <option value="boosters">Boosters offerts</option>
          <option value="carte">Une carte</option>
        </select></div>
      <div class="field"><label for="acd-bulk-amount" id="acd-bulk-amount-l">${esc(KIND.paillettes.champ)}</label>
        <input id="acd-bulk-amount" name="amount" type="number" inputmode="numeric" step="1" min="1" max="${KIND.paillettes.max}" value="${KIND.paillettes.defaut}"></div>
    </div>
    <div class="acd-bulk-card" id="acd-bulk-cardbox" hidden>
      <div id="acd-bulk-cardhost"><p class="small muted">Chargement des cartes…</p></div>
    </div>
    <div class="acd-bulk-card" id="acd-bulk-boxbox" hidden>
      <div id="acd-bulk-boxhost"><p class="small muted">Chargement des boosters…</p></div>
    </div>
    <fieldset class="acd-fs">
      <legend>Destinataires</legend>
      <label class="switch acd-switch"><input type="checkbox" id="acd-bulk-all" name="all"><span class="switch-ui" aria-hidden="true"></span><span>Tout le gang (tous les membres actifs)</span></label>
      <div class="field"><label for="acd-bulk-q">Rechercher un membre</label>
        <input id="acd-bulk-q" type="search" autocomplete="off" placeholder="Pseudo"></div>
      <div class="acd-bulk-list" id="acd-bulk-list">${rows || '<p class="small muted">Aucun membre actif.</p>'}</div>
      <p class="small muted" id="acd-bulk-count" aria-live="polite"></p>
    </fieldset>
    <label class="switch acd-switch"><input type="checkbox" name="announce" checked><span class="switch-ui" aria-hidden="true"></span><span>Afficher dans le fil d'actualité (une seule ligne groupée)</span></label>
    <div class="field"><label for="acd-bulk-note">Note <span class="muted small">(facultatif, réservée au journal admin)</span></label>
      <input id="acd-bulk-note" name="note" maxlength="200" autocomplete="off"></div>
    <p class="acd-sum" id="acd-bulk-recap" aria-live="polite"></p>
    <div class="vp-preview" id="acd-bulk-visual" hidden></div>
  </div>`;
}

/** Destinataires choisis : tout le gang (comptes actifs) ou les cases cochées. */
function destinataires(form) {
  if (form.elements.all.checked) return { all: true, ids: activeProfiles().map((p) => p.id) };
  const ids = [...form.querySelectorAll('input[name="who"]:checked')].map((i) => i.value);
  return { all: false, ids };
}

/** Lecture du formulaire : valeurs au format attendu par recapText et argsDon (carte et booster lus sur leurs sélecteurs). */
function lire(form) {
  const kind = form.elements.kind.value;
  const cfg = KIND[kind];
  const amount = Number(String(form.elements.amount.value).trim());
  const pk = PICK.get(form);
  const carte = pk?.carte?.value() ?? { card: '', name: '', obj: null, shiny: false };
  const boost = pk?.boost?.value() ?? { id: '', name: '', obj: null };
  const estCarte = kind === 'carte';
  const estBoost = kind === 'boosters';
  const { all, ids } = destinataires(form);
  const n = all ? activeProfiles().length : ids.length;
  return {
    kind, cfg, amount,
    card: estCarte ? carte.card : '', shiny: estCarte && carte.shiny, carteNom: carte.name,
    restant: estCarte ? pk?.restants?.get(carte.card) : undefined, // exemplaires encore disponibles (cartes limitées et uniques)
    booster: estBoost ? boost.id : '', boosterNom: estBoost ? boost.name : '',
    visuel: estCarte ? carte.obj : estBoost ? boost.obj : null,
    all, ids, n, announce: form.elements.announce.checked, note: String(form.elements.note.value).trim(),
  };
}

/** Valeurs invalides : même règle que la validation de la RPC côté formulaire (une phrase d'erreur remplace le récapitulatif). */
export function invalide(v) {
  return !v.n || v.n > MAX_MEMBRES || !Number.isInteger(v.amount) || v.amount < v.cfg.min || v.amount > v.cfg.max
    || (v.kind === 'carte' && !v.card) || (v.kind === 'boosters' && !v.booster)
    || (v.kind === 'carte' && v.restant != null && v.n * v.amount > v.restant);
}

/**
 * Phrase de récapitulatif (affichée en direct, puis reprise dans la confirmation).
 * v : { kind, cfg, amount, card, shiny, all, ids, n, announce, note, booster, boosterNom } ; v.carteNom (facultatif) évite de lire C.cardById.
 */
export function recapText(v) {
  if (!v.n) return 'Choisis au moins un membre, ou « Tout le gang ».';
  if (v.n > MAX_MEMBRES) return `Au plus ${MAX_MEMBRES} membres par don (${nf(v.n)} choisis).`;
  if (!Number.isInteger(v.amount) || v.amount < v.cfg.min || v.amount > v.cfg.max) return `Indique un nombre entre ${nf(v.cfg.min)} et ${nf(v.cfg.max)}.`;
  if (v.kind === 'carte' && !v.card) return 'Choisis une carte.';
  if (v.kind === 'boosters' && !v.booster) return 'Choisis un booster.';
  const carteNom = v.kind === 'carte' ? v.carteNom ?? C.cardById.get(v.card)?.name ?? '' : '';
  if (v.kind === 'carte' && v.restant != null && v.n * v.amount > v.restant) {
    return v.restant > 0
      ? `Il reste ${plur(v.restant, 'exemplaire', 'exemplaires')} de « ${carteNom} » : ${nf(v.n * v.amount)} demandés. Réduis le nombre d’exemplaires ou de membres.`
      : `Plus aucun exemplaire disponible pour « ${carteNom} ».`;
  }
  const obj = v.kind === 'paillettes' ? `${nf(v.amount)} Paillettes`
    : v.kind === 'boosters' ? `${plur(v.amount, 'booster', 'boosters')} ${v.boosterNom || 'offerts'}`
    : `${plur(v.amount, 'exemplaire', 'exemplaires')} de « ${carteNom} »${v.shiny ? ' (brillante)' : ''}`;
  const total = v.kind === 'paillettes' ? `${nf(v.n * v.amount)} Paillettes au total`
    : v.kind === 'boosters' ? `${plur(v.n * v.amount, 'booster', 'boosters')} au total`
    : `${plur(v.n * v.amount, 'exemplaire', 'exemplaires')} au total`;
  const qui = v.all ? `Tout le gang (${plur(v.n, 'membre', 'membres')}) recevra`
    : v.n === 1 ? '1 membre recevra' : `${nf(v.n)} membres recevront`;
  return v.n > 1 ? `${qui} ${obj} chacun. Soit ${total}.` : `${qui} ${obj}.`;
}

/**
 * Arguments de hg_cards_admin_bulk_give. Hors boosters, p_booster reste le type par défaut (« classique »), comme avant.
 * @param {object} v valeurs lues (voir lire)
 */
export function argsDon(v) {
  return {
    p_users: v.all ? null : v.ids,
    p_kind: v.kind,
    p_amount: v.amount,
    p_card: v.kind === 'carte' ? v.card : null,
    p_shiny: v.kind === 'carte' ? v.shiny : false,
    p_booster: v.kind === 'boosters' ? v.booster : 'classique',
    p_announce: v.announce,
    p_note: v.note || null,
  };
}

/** Met à jour le compteur de destinataires, la phrase de récapitulatif et l'aperçu du visuel. */
function majRecap(form) {
  const v = lire(form);
  const recap = $('#acd-bulk-recap', form);
  const count = $('#acd-bulk-count', form);
  const list = $('#acd-bulk-list', form);
  const vis = $('#acd-bulk-visual', form);
  if (count) count.textContent = v.all ? `${nf(v.n)} membre${v.n > 1 ? 's' : ''} actif${v.n > 1 ? 's' : ''}` : `${nf(v.ids.length)} choisi${v.ids.length > 1 ? 's' : ''}`;
  if (list) list.classList.toggle('is-off', v.all);
  if (recap) {
    recap.textContent = recapText(v);
    recap.classList.toggle('is-warn', v.n > MAX_MEMBRES || !v.n);
  }
  if (vis) {
    vis.innerHTML = visuelHtml(v.kind, v.visuel);
    vis.hidden = !v.visuel;
  }
}

/** Champs qui dépendent du type : libellé et bornes du montant, sélecteur de carte ou de booster. */
function majType(form) {
  const kind = form.elements.kind.value;
  const cfg = KIND[kind];
  const amount = form.elements.amount;
  const old = KIND[form.dataset.kind || 'paillettes'];
  // Quand on change de type, le montant revient à la valeur par défaut de ce type (sinon on garde la saisie).
  if (form.dataset.kind && form.dataset.kind !== kind && Number(amount.value) === old.defaut) amount.value = cfg.defaut;
  form.dataset.kind = kind;
  amount.min = cfg.min;
  amount.max = cfg.max;
  $('#acd-bulk-amount-l', form).textContent = cfg.champ;
  $('#acd-bulk-cardbox', form).hidden = kind !== 'carte';
  $('#acd-bulk-boxbox', form).hidden = kind !== 'boosters';
}

/** Réagit aux changements : type de don, « tout le gang », puis récapitulatif. */
function onChange(e) {
  const form = e.currentTarget;
  if (e.target.name === 'kind') majType(form);
  if (e.target.id === 'acd-bulk-all') {
    form.querySelectorAll('input[name="who"]').forEach((i) => { i.disabled = e.target.checked; });
  }
  majRecap(form);
}

/** Réagit à la saisie : filtre des membres, puis récapitulatif. */
function onInput(e) {
  const form = e.currentTarget;
  if (e.target.id === 'acd-bulk-q') {
    const needle = (e.target.value || '').trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    form.querySelectorAll('.acd-bulk-row').forEach((row) => {
      const txt = row.textContent.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      row.hidden = !!needle && !txt.includes(needle);
    });
  }
  majRecap(form);
}

/** Envoi : contrôle, confirmation avec récapitulatif, appel de la RPC, retour du résultat. Renvoie false si on reste dans le tiroir. */
async function envoyer(form) {
  const err = $('.form-error', form);
  /* Affiche le message d'erreur dans le formulaire, ou le masque si le message est vide. */
  const showErr = (m) => { err.textContent = m; err.hidden = !m; if (m) err.scrollIntoView({ block: 'nearest' }); };
  showErr('');
  const v = lire(form);
  const texte = recapText(v);
  if (invalide(v)) {
    showErr(texte);
    return false;
  }
  try {
    const res = await donnerGroupe(v);
    if (!res) return false; // annulé dans la confirmation
    const servis = Number(res?.membres) || v.n;
    toast(`Don envoyé à ${plur(servis, 'membre', 'membres')}`, 'ok');
    await refresh();
    return true;
  } catch (e) {
    showErr(errMsg(e));
    return false;
  }
}

/**
 * Confirmation puis appel de hg_cards_admin_bulk_give (tout ou rien, une ligne au journal et une ligne groupée au fil).
 * @param {object} v valeurs lues (voir recapText).
 * @returns {Promise<object|null>} réponse de la RPC ({ membres, … }), ou null si la personne annule. Une erreur est relancée.
 */
export async function donnerGroupe(v) {
  const ok = await confirmBox('Confirmer le don ?', `${recapText(v)} Le don est définitif.`, { ok: 'Donner' });
  if (!ok) return null;
  return check(await sb.rpc('hg_cards_admin_bulk_give', argsDon(v)));
}

/**
 * Lit les cartes (restants) et les boosters, puis monte les sélecteurs dans le tiroir. Un échec de lecture
 * des boosters est affiché à sa place ; le tiroir reste utilisable pour les autres dons.
 */
async function monterChoix(form) {
  const cards = C.cards.filter((k) => k.active);
  const [r, b] = await Promise.allSettled([chargerRestants(cards), chargerBoosters()]);
  if (!form.isConnected) return;
  const restants = r.status === 'fulfilled' ? r.value.restants : new Map();
  const carte = cardPicker($('#acd-bulk-cardhost', form), {
    cards, sets: C.sets, restants, idp: 'acd-bulk-cp', onChange: () => majRecap(form),
    bloque: (k) => (restants.has(k.id) && restants.get(k.id) <= 0 ? libelleEpuisee(k) : ''),
  });
  const boost = b.status === 'fulfilled'
    ? boosterPicker($('#acd-bulk-boxhost', form), { types: b.value, idp: 'acd-bulk-bp', value: 'classique', onChange: () => majRecap(form) })
    : null;
  if (!boost) $('#acd-bulk-boxhost', form).innerHTML = `<p class="form-error" role="alert">Impossible de charger les boosters : ${esc(errMsg(b.reason))}</p>`;
  PICK.set(form, { carte, boost, restants });
  majRecap(form);
}

/** Ouvre le tiroir « Don groupé ». */
export function openBulkGift() {
  const d = openDrawer({
    title: 'Don groupé',
    subtitle: 'Paillettes, boosters offerts ou une carte, à plusieurs membres à la fois',
    body: bodyHtml(),
    submitLabel: 'Donner',
    onSubmit: envoyer,
  });
  d.form.dataset.kind = 'paillettes';
  d.form.addEventListener('change', onChange);
  d.form.addEventListener('input', onInput);
  majType(d.form);
  majRecap(d.form);
  monterChoix(d.form);
}
