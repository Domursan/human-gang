// =====================================================================
// Cartes admin : don groupé (Paillettes, boosters offerts ou une carte) à plusieurs membres, ou à tout le gang.
// Tiroir ouvert depuis Économie. La RPC hg_cards_admin_bulk_give fait tout ou rien et écrit une seule ligne dans le fil.
// Les MP Discord ne sont pas envoyés par ce tiroir.
// Dépendances : core.js (sb, toast, errMsg, esc, $), cartes-ui.js (rarityLabel), ui-confirm.js (confirmBox),
// admin/ui/drawer.js (tiroir), state.js (C), data.js (refresh), helpers.js (check, nf, activeProfiles).
// Exporte : openBulkGift.
// =====================================================================
import { sb, toast, errMsg, esc, $ } from '../core.js';
import { rarityLabel } from '../cartes-ui.js';
import { confirmBox } from '../ui-confirm.js';
import { openDrawer } from '../admin/ui/drawer.js';
import { C } from './state.js';
import { refresh } from './data.js';
import { check, nf, activeProfiles } from './helpers.js';

const MAX_MEMBRES = 200; // doit correspondre à la migration 042
/* Les trois sortes de don : libellé, nom du champ de montant, valeur par défaut et bornes autorisées. */
const KIND = {
  paillettes: { label: 'Paillettes', champ: 'Paillettes par membre', defaut: 100, min: 1, max: 10000 },
  boosters: { label: 'Boosters offerts', champ: 'Boosters par membre', defaut: 1, min: 1, max: 50 },
  carte: { label: 'Une carte', champ: 'Exemplaires par membre', defaut: 1, min: 1, max: 10 },
};
/* Texte normalisé pour la recherche : minuscules et sans accents. */
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/* Nombre suivi du mot au singulier ou au pluriel (« 1 booster », « 3 boosters »). */
const plur = (n, one, many) => `${nf(n)} ${n > 1 ? many : one}`;

/** Options des cartes actives, groupées par série, filtrées par le texte de recherche. */
function cardOptionsHtml(q = '') {
  const needle = norm(q.trim());
  return C.sets.map((s) => {
    const list = C.cards.filter((k) => k.set_id === s.id && k.active && (!needle || norm(k.name).includes(needle)))
      .sort((a, b) => a.number - b.number);
    return list.length ? `<optgroup label="${esc(s.name)}">${list.map((k) => `<option value="${esc(k.id)}">#${esc(k.number)} · ${esc(k.name)} (${esc(rarityLabel(k.rarity))})</option>`).join('')}</optgroup>` : '';
  }).join('');
}

/** HTML du tiroir : type de don, montant, carte, destinataires, notes. */
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
      <div class="field"><label for="acd-bulk-cardq">Rechercher une carte</label>
        <input id="acd-bulk-cardq" type="search" autocomplete="off" placeholder="Nom de la carte"></div>
      <div class="field"><label for="acd-bulk-card">Carte</label>
        <select id="acd-bulk-card" name="card">${cardOptionsHtml() || '<option value="">Aucune carte active</option>'}</select></div>
      <label class="switch acd-switch"><input type="checkbox" name="shiny"><span class="switch-ui" aria-hidden="true"></span><span>Brillante</span></label>
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
  </div>`;
}

/** Destinataires choisis : tout le gang (comptes actifs) ou les cases cochées. */
function destinataires(form) {
  if (form.elements.all.checked) return { all: true, ids: activeProfiles().map((p) => p.id) };
  const ids = [...form.querySelectorAll('input[name="who"]:checked')].map((i) => i.value);
  return { all: false, ids };
}

/** Lecture du formulaire : null si une valeur est invalide (message renvoyé dans errors). */
function lire(form) {
  const kind = form.elements.kind.value;
  const cfg = KIND[kind];
  const amount = Number(String(form.elements.amount.value).trim());
  const card = form.elements.card?.value || '';
  const shiny = !!form.elements.shiny?.checked;
  const { all, ids } = destinataires(form);
  const n = all ? activeProfiles().length : ids.length;
  return { kind, cfg, amount, card, shiny, all, ids, n, announce: form.elements.announce.checked, note: String(form.elements.note.value).trim() };
}

/** Phrase de récapitulatif (affichée en direct, puis reprise dans la confirmation). */
function recapText(v) {
  if (!v.n) return 'Choisis au moins un membre, ou « Tout le gang ».';
  if (v.n > MAX_MEMBRES) return `Au plus ${MAX_MEMBRES} membres par don (${nf(v.n)} choisis).`;
  if (!Number.isInteger(v.amount) || v.amount < v.cfg.min || v.amount > v.cfg.max) return `Indique un nombre entre ${nf(v.cfg.min)} et ${nf(v.cfg.max)}.`;
  if (v.kind === 'carte' && !v.card) return 'Choisis une carte.';
  const carteNom = v.kind === 'carte' ? C.cardById.get(v.card)?.name || '' : '';
  const obj = v.kind === 'paillettes' ? `${nf(v.amount)} Paillettes`
    : v.kind === 'boosters' ? plur(v.amount, 'booster offert', 'boosters offerts')
    : `${plur(v.amount, 'exemplaire', 'exemplaires')} de « ${carteNom} »${v.shiny ? ' (brillante)' : ''}`;
  const total = v.kind === 'paillettes' ? `${nf(v.n * v.amount)} Paillettes au total`
    : v.kind === 'boosters' ? `${plur(v.n * v.amount, 'booster', 'boosters')} au total`
    : `${plur(v.n * v.amount, 'exemplaire', 'exemplaires')} au total`;
  const qui = v.all ? `Tout le gang (${plur(v.n, 'membre', 'membres')}) recevra`
    : v.n === 1 ? '1 membre recevra' : `${nf(v.n)} membres recevront`;
  return v.n > 1 ? `${qui} ${obj} chacun. Soit ${total}.` : `${qui} ${obj}.`;
}

/** Met à jour le compteur de destinataires et la phrase de récapitulatif. */
function majRecap(form) {
  const v = lire(form);
  const recap = $('#acd-bulk-recap', form);
  const count = $('#acd-bulk-count', form);
  const list = $('#acd-bulk-list', form);
  if (count) count.textContent = v.all ? `${nf(v.n)} membre${v.n > 1 ? 's' : ''} actif${v.n > 1 ? 's' : ''}` : `${nf(v.ids.length)} choisi${v.ids.length > 1 ? 's' : ''}`;
  if (list) list.classList.toggle('is-off', v.all);
  if (recap) {
    recap.textContent = recapText(v);
    recap.classList.toggle('is-warn', v.n > MAX_MEMBRES || !v.n);
  }
}

/** Champs qui dépendent du type : libellé et bornes du montant, bloc carte. */
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

/** Réagit à la saisie : filtre des membres ou recherche de carte, puis récapitulatif. */
function onInput(e) {
  const form = e.currentTarget;
  if (e.target.id === 'acd-bulk-q') {
    const needle = norm(e.target.value.trim());
    form.querySelectorAll('.acd-bulk-row').forEach((row) => {
      row.hidden = !!needle && !norm(row.textContent).includes(needle);
    });
  } else if (e.target.id === 'acd-bulk-cardq') {
    const sel = form.elements.card;
    const keep = sel.value;
    sel.innerHTML = cardOptionsHtml(e.target.value) || '<option value="">Aucune carte trouvée</option>';
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
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
  if (!v.n || v.n > MAX_MEMBRES || !Number.isInteger(v.amount) || v.amount < v.cfg.min || v.amount > v.cfg.max || (v.kind === 'carte' && !v.card)) {
    showErr(texte);
    return false;
  }
  const ok = await confirmBox('Confirmer le don ?', `${texte} Le don est définitif.`, { ok: 'Donner' });
  if (!ok) return false;
  try {
    const res = check(await sb.rpc('hg_cards_admin_bulk_give', {
      p_users: v.all ? null : v.ids,
      p_kind: v.kind,
      p_amount: v.amount,
      p_card: v.kind === 'carte' ? v.card : null,
      p_shiny: v.kind === 'carte' ? v.shiny : false,
      p_announce: v.announce,
      p_note: v.note || null,
    }));
    const servis = Number(res?.membres) || v.n;
    toast(`Don envoyé à ${plur(servis, 'membre', 'membres')}`, 'ok');
    await refresh();
    return true;
  } catch (e) {
    showErr(errMsg(e));
    return false;
  }
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
}
