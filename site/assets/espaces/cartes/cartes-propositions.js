// ===== Cartes — propositions de cartes par les membres (idée C6, migration 080) =====
// Quand une série accepte des propositions (hg_card_sets.proposals_open, ex. « Campagne Serge »), l'onglet Collection
// montre un encart « Proposer une carte » : nom, famille, phrase d'ambiance, légende et blason (blason.js), avec aperçu.
// Envoi : hg_card_proposal_submit ; retrait : hg_card_proposal_cancel. Le Staff « cartes » valide dans l'admin
// (admin-cards/proposals.js). Lecture : hg_card_proposals (RLS : seulement les siennes).
// Exporte : mountProposals(app, me).
import { sb, toast, errMsg, esc } from '../../commun/core.js';
import { cardHtml } from './cartes-ui.js';
import { FIGURES, PARTITIONS, PALETTE, DEFAULT_BLASON, blasonDataUrl } from '../compte/blason.js';

const STATUS = { en_attente: ['En attente', 'is-wait'], acceptee: ['Acceptée', 'is-ok'], refusee: ['Refusée', 'is-no'], retiree: ['Retirée', 'is-off'] };
const FAMS = [['lieu', 'Lieu (un fief)'], ['moment', 'Moment'], ['objet', 'Objet']];
/** État : séries ouvertes, mes propositions, formulaire. */
const P = { sets: [], mine: [], host: null, dlg: null, busy: false, form: null };

/**
 * Monte l'encart des propositions juste après le panneau Collection (il n'est visible qu'avec lui).
 * Sans série ouverte aux propositions (ou sans la migration 080), rien n'est affiché.
 * @param {HTMLElement} app racine de la page Cartes
 * @param {{id: string}} me membre connecté
 */
export async function mountProposals(app, me) {
  try {
    const { data, error } = await sb.from('hg_card_sets').select('id, code, name, description, proposals_open').eq('proposals_open', true).order('sort');
    if (error) throw error;
    P.sets = (data || []).filter((s) => s.proposals_open);
  } catch { return; } // colonne absente (migration pas encore déployée) : pas d'encart
  if (!P.sets.length) return;
  P.me = me;
  const panel = app.querySelector('#cartes-p-collection');
  if (!panel) return;
  P.host = document.createElement('section');
  P.host.className = 'card cartes-block prop-box';
  P.host.id = 'cartes-propose';
  P.host.setAttribute('aria-labelledby', 'prop-h');
  panel.after(P.host);
  P.dlg = buildDialog();
  app.append(P.dlg);
  P.host.addEventListener('click', onHostClick);
  await loadMine();
  render();
}

/** Recharge mes propositions. */
async function loadMine() {
  const { data, error } = await sb.from('hg_card_proposals').select('id, set_id, payload, status, note, created_at').eq('proposed_by', P.me.id).order('created_at', { ascending: false });
  P.mine = error ? [] : (data || []);
}

/** Dessine l'encart : invitation, bouton et mes propositions. */
function render() {
  const names = P.sets.map((s) => `« ${s.name} »`).join(', ');
  const rows = P.mine.map((p) => {
    const [lab, cls] = STATUS[p.status] || [p.status, ''];
    const set = P.sets.find((s) => s.id === p.set_id)?.name || '';
    return `<li class="prop-row">
      <span class="prop-name"><strong>${esc(p.payload?.name || '')}</strong>${set ? `<span class="muted small"> · ${esc(set)}</span>` : ''}${p.note ? `<span class="muted small prop-note">${esc(p.note)}</span>` : ''}</span>
      <span class="prop-pill ${cls}">${esc(lab)}</span>
      ${p.status === 'en_attente' ? `<button type="button" class="btn btn-ghost btn-sm" data-prop-cancel="${esc(p.id)}" aria-label="Retirer la proposition ${esc(p.payload?.name || '')}">Retirer</button>` : ''}
    </li>`;
  }).join('');
  P.host.innerHTML = `
    <div class="prop-head">
      <div>
        <h2 id="prop-h" class="cart-h">Proposer une carte</h2>
        <p class="cartes-small">${P.sets.length > 1 ? 'Ces séries acceptent' : 'La série'} ${esc(names)} ${P.sets.length > 1 ? '' : 'accepte '}tes propositions : un nom, une phrase et un blason. Le Staff relit avant la sortie.</p>
      </div>
      <button type="button" class="btn btn-primary" data-prop-open>Proposer une carte</button>
    </div>
    ${rows ? `<h3 class="prop-sub">Mes propositions</h3><ul class="prop-list">${rows}</ul>` : ''}`;
}

/** Clics dans l'encart : ouvrir le formulaire, retirer une proposition. */
async function onHostClick(e) {
  const open = e.target.closest('[data-prop-open]');
  if (open) { openDialog(open); return; }
  const cancel = e.target.closest('[data-prop-cancel]');
  if (cancel && !P.busy) {
    P.busy = true; cancel.disabled = true;
    const { error } = await sb.rpc('hg_card_proposal_cancel', { p_id: cancel.dataset.propCancel });
    P.busy = false;
    if (error) { toast(errMsg(error), 'error'); cancel.disabled = false; return; }
    toast('Proposition retirée', 'ok');
    await loadMine(); render();
    P.host.querySelector('[data-prop-open]')?.focus();
  }
}

/** Options d'un sélecteur ([valeur, libellé]) avec la valeur choisie. */
const opts = (list, v) => list.map(([id, lab]) => `<option value="${esc(id)}"${id === v ? ' selected' : ''}>${esc(lab)}</option>`).join('');

/** Groupe de pastilles de couleur (boutons radio) : nom du champ, légende, valeur choisie. */
const swatches = (name, legend, v) => `<fieldset class="prop-sub-fs"><legend>${esc(legend)}</legend><div class="prop-sw">${PALETTE.map(([lab, hex]) =>
  `<label class="prop-swatch" style="--c:${hex}"><input type="radio" name="${name}" value="${hex}"${hex === v ? ' checked' : ''}><span class="visually-hidden">${esc(lab)}</span></label>`).join('')}</div></fieldset>`;

/** Crée la fenêtre du formulaire (une fois). */
function buildDialog() {
  const dlg = document.createElement('dialog');
  dlg.className = 'cartes-dialog prop-dlg';
  dlg.id = 'cartes-prop-dlg';
  dlg.setAttribute('aria-labelledby', 'prop-dlg-h');
  dlg.innerHTML = `<form class="prop-form" method="dialog" novalidate>
    <h2 id="prop-dlg-h" class="dialog-title">Proposer une carte</h2>
    <div class="prop-grid">
      <div class="prop-fields">
        <div class="field" id="prop-set-f"><label for="prop-set">Série</label><select id="prop-set" name="set"></select></div>
        <div class="field"><label for="prop-name">Nom de la carte</label><input id="prop-name" name="name" maxlength="60" required autocomplete="off" placeholder="Duché de Toscane"></div>
        <div class="field"><label for="prop-fam">Famille</label><select id="prop-fam" name="family">${opts(FAMS, 'lieu')}</select></div>
        <div class="field"><label for="prop-flavor">Phrase d’ambiance (facultative, 120 caractères)</label><input id="prop-flavor" name="flavor" maxlength="120" autocomplete="off"></div>
        <div class="field"><label for="prop-cap">Légende (facultative, ex. « Fief de Terrow »)</label><input id="prop-cap" name="caption" maxlength="80" autocomplete="off"></div>
        <fieldset class="prop-blason">
          <legend>Blason</legend>
          <label class="check"><input type="checkbox" name="with_blason" checked><span>Utiliser un blason comme image</span></label>
          ${swatches('c0', 'Couleur du champ', DEFAULT_BLASON.colors[0])}
          ${swatches('c2', 'Couleur de la figure', DEFAULT_BLASON.colors[2])}
          ${swatches('c1', 'Couleur de la bordure', DEFAULT_BLASON.colors[1])}
          <fieldset class="prop-sub-fs"><legend>Figure</legend><div class="prop-figs">${FIGURES.map(([id, lab]) => `<label class="prop-fig"><input type="radio" name="figure" value="${id}"${id === DEFAULT_BLASON.figure ? ' checked' : ''}><img src="${blasonDataUrl({ colors: ['#1F1F23', '#1F1F23', '#E2C77E'], figure: id, partition: 'plein' })}" alt=""><span>${esc(lab)}</span></label>`).join('')}</div></fieldset>
          <div class="field"><label for="prop-part">Partition (facultative)</label><select id="prop-part" name="partition">${opts(PARTITIONS, DEFAULT_BLASON.partition)}</select></div>
        </fieldset>
      </div>
      <div class="prop-preview"><p class="prop-prev-h">Aperçu</p><div id="prop-prev" aria-live="polite"></div>
        <p class="muted small">La rareté est choisie par le Staff à la validation.</p></div>
    </div>
    <p class="prop-err muted small" id="prop-err" role="alert"></p>
    <div class="btn-row">
      <button type="submit" class="btn btn-primary" value="send" id="prop-send">Envoyer la proposition</button>
      <button type="button" class="btn btn-ghost" data-prop-close>Annuler</button>
    </div>
  </form>`;
  const form = dlg.querySelector('form');
  form.addEventListener('input', preview);
  form.addEventListener('change', preview);
  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  dlg.querySelector('[data-prop-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => { P.opener?.isConnected && P.opener.focus({ preventScroll: true }); });
  P.form = form;
  return dlg;
}

/** Valeurs du formulaire (blason compris, ou null sans blason). */
function values() {
  const f = new FormData(P.form);
  const g = (k) => String(f.get(k) || '').trim();
  // Radios lus directement : un fieldset désactivé ne figure pas dans FormData.
  const r = (k) => P.form.querySelector(`input[name="${k}"]:checked`)?.value || '';
  const blason = f.get('with_blason') ? { colors: [r('c0'), r('c1'), r('c2')], figure: r('figure'), partition: P.form.elements.partition.value } : null;
  return { set: g('set'), name: g('name'), family: g('family'), flavor: g('flavor'), caption: g('caption'), blason };
}

/** Aperçu de la carte avec le blason dessiné. */
function preview() {
  const v = values();
  const set = P.sets.find((s) => s.id === v.set);
  P.dlg.querySelectorAll('.prop-blason .prop-sub-fs, .prop-blason .field select').forEach((el) => { el.disabled = !v.blason; });
  P.dlg.querySelector('#prop-prev').innerHTML = cardHtml({
    name: v.name || 'Ta carte', family: v.family, rarity: 'commune', flavor: v.flavor, caption: v.caption,
    set_name: set?.name || '', image_url: v.blason ? blasonDataUrl(v.blason) : null,
  }, { size: 'md' });
}

/** Ouvre le formulaire vide (série choisie : la première ouverte). */
function openDialog(from) {
  P.opener = from;
  P.form.reset();
  const sel = P.dlg.querySelector('#prop-set');
  sel.innerHTML = opts(P.sets.map((s) => [s.id, s.name]), P.sets[0].id);
  P.dlg.querySelector('#prop-set-f').hidden = P.sets.length < 2;
  P.dlg.querySelector('#prop-err').textContent = '';
  preview();
  P.dlg.showModal();
  P.dlg.querySelector('#prop-name').focus();
}

/** Envoie la proposition (hg_card_proposal_submit). */
async function send() {
  if (P.busy) return;
  const v = values();
  const err = P.dlg.querySelector('#prop-err');
  if (!v.name) { err.textContent = 'Donne un nom à ta carte.'; P.dlg.querySelector('#prop-name').focus(); return; }
  P.busy = true;
  const btn = P.dlg.querySelector('#prop-send');
  btn.disabled = true;
  const payload = { name: v.name, family: v.family, flavor: v.flavor || null, caption: v.caption || null, blason: v.blason };
  const { error } = await sb.rpc('hg_card_proposal_submit', { p_set: v.set, p: payload });
  P.busy = false; btn.disabled = false;
  if (error) { err.textContent = errMsg(error); return; }
  P.dlg.close();
  toast('Proposition envoyée au Staff', 'ok');
  await loadMine(); render();
  P.host.querySelector('[data-prop-open]')?.focus();
}
