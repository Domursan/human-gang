// =====================================================================
// Cartes admin : propositions de cartes des membres (idée C6, migration 080), sous la liste des séries.
// Liste les propositions en attente (hg_card_proposals, RLS Staff « cartes ») avec l'aperçu de la carte et du blason.
// Accepter : choisir la rareté (et activer ou non) ; le blason est rendu en PNG et envoyé dans hg-assets
// (uploadCardImage), puis hg_card_proposal_review crée la carte (inactive par défaut). Refuser : note facultative.
// La base refuse qu'un membre du Staff valide sa propre proposition.
// Exporte : mountProposalsAdmin(host).
// =====================================================================
import { sb, toast, errMsg, esc } from '../../../commun/core.js';
import { cardHtml, rarityLabel } from '../../cartes/cartes-ui.js';
import { blasonDataUrl, blasonPng } from '../../compte/blason.js';
import { C } from './state.js';
import { check, uploadCardImage } from './helpers.js';
import { refresh } from './data.js';

const RARS = ['commune', 'peu_commune', 'rare', 'epique', 'legendaire'];
const A = { host: null, rows: [], busy: false };

/**
 * Monte le bloc des propositions dans host (rien sans proposition en attente ni série ouverte).
 * @param {HTMLElement|null} host conteneur
 */
export async function mountProposalsAdmin(host) {
  if (!host) return;
  A.host = host;
  host.addEventListener('click', onClick);
  await load();
}

async function load() {
  const { data, error } = await sb.from('hg_card_proposals').select('id, set_id, proposed_by, payload, status, created_at').eq('status', 'en_attente').order('created_at');
  A.rows = error ? [] : (data || []);
  render();
}

function rowHtml(p) {
  const pl = p.payload || {};
  const set = C.setById.get(p.set_id);
  const who = C.byId.get(p.proposed_by)?.pseudo || 'Membre';
  const id = esc(p.id);
  const card = cardHtml({ name: pl.name, family: pl.family, rarity: 'commune', flavor: pl.flavor, caption: pl.caption, set_name: set?.name || '',
    image_url: pl.blason ? blasonDataUrl(pl.blason) : null }, { size: 'sm' });
  return `<li class="acd-prop" data-prop="${id}">
    <div class="acd-prop-card">${card}</div>
    <div class="acd-prop-body">
      <p><strong>${esc(pl.name || '')}</strong> <span class="muted small">· ${esc(set?.name || '')} · proposée par ${esc(who)}</span></p>
      ${pl.flavor ? `<p class="small">« ${esc(pl.flavor)} »</p>` : ''}
      <div class="acd-grid-2">
        <div class="field"><label for="acp-r-${id}">Rareté</label><select id="acp-r-${id}" data-prop-rar>${RARS.map((r) => `<option value="${r}"${r === 'rare' ? ' selected' : ''}>${esc(rarityLabel(r))}</option>`).join('')}</select></div>
        <div class="field"><label for="acp-n-${id}">Note pour le membre (facultative)</label><input id="acp-n-${id}" data-prop-note maxlength="200" autocomplete="off"></div>
      </div>
      <label class="switch"><input type="checkbox" data-prop-active><span class="switch-ui" aria-hidden="true"></span><span>Carte active tout de suite</span></label>
      <div class="btn-row">
        <button class="btn btn-primary btn-sm" type="button" data-prop-ok="${id}">Accepter</button>
        <button class="btn btn-ghost btn-sm" type="button" data-prop-no="${id}">Refuser</button>
      </div>
    </div>
  </li>`;
}

function render() {
  const open = C.sets.filter((s) => s.proposals_open);
  if (!A.rows.length && !open.length) { A.host.innerHTML = ''; return; }
  A.host.innerHTML = `<section class="acd-props" aria-labelledby="acd-props-h">
    <h3 id="acd-props-h">Propositions des membres</h3>
    <p class="small muted">${open.length ? `Ouvertes pour : ${open.map((s) => `« ${esc(s.name)} »`).join(', ')}.` : 'Aucune série n’accepte de propositions.'} La carte acceptée est créée inactive, sauf si tu coches « active ».</p>
    ${A.rows.length ? `<ul class="acd-prop-list">${A.rows.map(rowHtml).join('')}</ul>` : '<p class="empty">Aucune proposition en attente.</p>'}
  </section>`;
}

async function onClick(e) {
  const ok = e.target.closest('[data-prop-ok]');
  const no = e.target.closest('[data-prop-no]');
  const btn = ok || no;
  if (!btn || A.busy) return;
  const li = btn.closest('[data-prop]');
  const p = A.rows.find((r) => r.id === li.dataset.prop);
  if (!p) return;
  A.busy = true;
  li.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  try {
    const note = li.querySelector('[data-prop-note]').value.trim();
    if (ok) {
      let image = null;
      if (p.payload?.blason) {
        const blob = await blasonPng(p.payload.blason);
        image = await uploadCardImage(new File([blob], 'blason.png', { type: 'image/png' }));
      }
      check(await sb.rpc('hg_card_proposal_review', { p_id: p.id, p_accept: true,
        p: { rarity: li.querySelector('[data-prop-rar]').value, active: li.querySelector('[data-prop-active]').checked, image_url: image, note: note || null } }));
      toast(`Carte « ${p.payload?.name || ''} » créée`, 'ok');
      await refresh();
    } else {
      check(await sb.rpc('hg_card_proposal_review', { p_id: p.id, p_accept: false, p: { note: note || null } }));
      toast('Proposition refusée', 'ok');
    }
  } catch (err) {
    toast(errMsg(err), 'error');
  }
  A.busy = false;
  await load();
  A.host.querySelector('button')?.focus();
}
