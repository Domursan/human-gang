// =====================================================================
// Cartes admin : propositions de cartes « Champions du gang » (C17) — Jeux et cartes › Champions.
// Le Staff « cartes » relit chaque proposition (aperçu de la carte telle qu'elle sortira, phrase comprise) puis la valide
// ou demande une modification (note facultative, montrée au membre). Validée : la carte entre dans la série
// « Champions du gang <année> » (rare, tirable dans les boosters) et le membre reçoit un exemplaire brillant offert.
// RPC (migration 082) : hg_champion_pending(), hg_champion_review(p_id, p_accept, p_note) — journal admin côté serveur.
// Dépendances : core.js (sb, toast, errMsg, esc, avatarHtml), cartes-ui.js (cardHtml), cartes-champion.js (aperçu),
// ui-confirm.js (confirmBox avec saisie), helpers.js (act). Styles des cartes : cartes-card.css (déjà chargée par admin.html).
// Exporte : mountChampionsSection.
// =====================================================================
import { sb, toast, errMsg, esc, avatarHtml } from '../core.js';
import { cardHtml } from '../cartes-ui.js';
import { championCardPreview } from '../cartes-champion.js';
import { confirmBox } from '../ui-confirm.js';
import { act } from './helpers.js';

const R = { root: null, list: [] };
const whenFmt = new Intl.DateTimeFormat('fr-CH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Zurich' });

/** Une proposition : aperçu, auteur, boutons. */
function rowHtml(x) {
  return `<article class="card adc-row champ-adm" aria-labelledby="champ-a-${x.id}">
    <div class="adc-row-head"><div class="drop-head">${avatarHtml(x, 36)}<h4 class="adc-row-title" id="champ-a-${x.id}">${esc(x.pseudo)} · main ${esc(x.main)}</h4></div>
      <span class="small muted">${esc(whenFmt.format(new Date(x.created_at)))}</span></div>
    <div class="champ-adm-body">${cardHtml(championCardPreview(x), { size: 'sm' })}
      <p class="small">Phrase : ${x.flavor ? `« ${esc(x.flavor)} »` : '<span class="muted">aucune</span>'}</p></div>
    <div class="btn-row"><button type="button" class="btn btn-primary" data-champ-act="ok" data-id="${x.id}">Valider la carte</button>
      <button type="button" class="btn btn-ghost" data-champ-act="ko" data-id="${x.id}">Demander une modification</button></div>
  </article>`;
}

/** Dessine la liste. */
function render() {
  R.root.innerHTML = `<div class="adc">
    <p class="small muted">Chaque membre peut proposer sa carte « main » (une par an). Relis le texte : le nom du champion est du texte, l’image est un emblème du gang. Validée, la carte est rare, tirable dans les boosters, et le membre en reçoit un exemplaire brillant.</p>
    <div class="adc-list">${R.list.length ? R.list.map(rowHtml).join('') : '<div class="empty">Aucune proposition en attente.</div>'}</div>
  </div>`;
}

/** Relit les propositions en attente. */
async function reload() {
  try {
    const { data, error } = await sb.rpc('hg_champion_pending');
    if (error) throw error;
    R.list = Array.isArray(data) ? data : [];
    render();
  } catch (e) {
    R.root.innerHTML = `<div class="empty">Impossible de charger les propositions : ${esc(errMsg(e))}</div>`;
  }
}

/** Valider ou refuser. */
async function onClick(e) {
  const t = e.target.closest('[data-champ-act]');
  if (!t || t.disabled) return;
  const id = Number(t.dataset.id);
  const accept = t.dataset.champAct === 'ok';
  let note = null;
  if (!accept) {
    const r = await confirmBox('Demander une modification', 'Le membre verra ta note et pourra proposer une nouvelle version.', { ok: 'Envoyer', input: { label: 'Note (facultative, 200 caractères)', required: false } });
    if (r === false || r == null) return;
    note = r ? r.slice(0, 200) : null;
  }
  await act(t, async () => {
    const { error } = await sb.rpc('hg_champion_review', { p_id: id, p_accept: accept, p_note: note });
    if (error) throw error;
    toast(accept ? 'Carte Champion validée : exemplaire brillant offert' : 'Modification demandée', 'ok');
    await reload();
  });
}

/** Monte la section dans container. */
export async function mountChampionsSection(container) {
  if (!container) return;
  R.root = container;
  container.addEventListener('click', onClick);
  await reload();
}
