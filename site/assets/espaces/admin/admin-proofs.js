// ===== Humane Gang — administration : preuves des quêtes (idée J11, maquette J11) =====
/*
 * Rôle : Jeux et cartes › Preuves de quêtes. File des preuves envoyées pour les quêtes à preuve : filtre par statut
 * (en attente, validées, refusées) et par quête, liste à gauche, preuve agrandie à droite (captures 1 à 3, mot du
 * membre), Valider (V) ou Refuser (R) avec un motif court. On ne valide jamais sa propre preuve (le serveur refuse aussi).
 * La validation verse la récompense de la quête (hg_proof_review). Nettoyage des captures de plus de 60 jours.
 * Droits : Staff « preuves » (ou la permission du modèle de quête), administrateur.
 * Route : #fete/preuves (branchée par admin.js). Section : <section id="preuves">, conteneur #proofs-root.
 * RPC : hg_proof_queue, hg_proof_review, hg_proofs_purge_due, hg_proofs_mark_purged. Stockage : hg-proofs (privé).
 * Exporte : mountProofsSection.
 */
import { sb, toast, errMsg, esc } from './core.js';
import { setCount } from './admin/shell.js';

const BUCKET = 'hg-proofs';
const STATUTS = [['en_attente', 'En attente'], ['validee', 'Validées'], ['refusee', 'Refusées']];
const MOTIFS = ['Capture coupée, résultat invisible', 'On ne voit pas que c’est toi', 'Ce n’est pas la bonne quête', 'Capture illisible ou trop petite', 'Infos privées visibles : recadre ta capture'];
const rel = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
const dfmt = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', timeZone: 'Europe/Zurich' });

let root = null;
const S = { status: 'en_attente', quest: '', data: null, sel: null, shot: 0, urls: {}, busy: false };

/** « il y a 2 h », « hier ». */
function ago(iso) {
  const s = (new Date(iso) - Date.now()) / 1000;
  if (s > -3600) return rel.format(Math.round(s / 60), 'minute');
  if (s > -86400) return rel.format(Math.round(s / 3600), 'hour');
  return rel.format(Math.round(s / 86400), 'day');
}
/** Initiales. */
const ini = (p) => String(p || '?').slice(0, 2).toUpperCase();

/**
 * Monte la section dans root.
 * @param {HTMLElement} el Conteneur #proofs-root.
 */
export async function mountProofsSection(el) {
  root = el;
  root.addEventListener('click', onClick);
  root.addEventListener('change', (e) => { if (e.target.id === 'pf-quest') { S.quest = e.target.value; S.sel = null; render(); } });
  document.addEventListener('keydown', onKey);
  await load();
}

/** Charge la file du statut choisi et signe les captures. */
async function load() {
  root.setAttribute('aria-busy', 'true');
  try {
    const { data, error } = await sb.rpc('hg_proof_queue', { p_status: S.status });
    if (error) throw error;
    S.data = data;
    setCount('preuves', data.counts?.en_attente || 0);
    const paths = data.items.flatMap((x) => x.paths || []).filter((p) => !S.urls[p]);
    if (paths.length) {
      const { data: signed } = await sb.storage.from(BUCKET).createSignedUrls(paths, 600);
      for (const r of signed || []) if (r.signedUrl) S.urls[r.path] = r.signedUrl;
    }
    if (!data.items.some((x) => x.id === S.sel)) S.sel = items()[0]?.id || null;
    S.shot = 0;
  } catch (e) { S.data = { error: errMsg(e) }; }
  root.removeAttribute('aria-busy');
  render();
}

/** Preuves affichées (filtre par quête). */
const items = () => (S.data?.items || []).filter((x) => !S.quest || x.quest_code === S.quest);

/** Dessine la section. */
function render() {
  if (S.data?.error) { root.innerHTML = `<div class="empty">Preuves indisponibles : ${esc(S.data.error)}</div>`; return; }
  const d = S.data, list = items();
  const quests = [...new Map(d.items.map((x) => [x.quest_code, x.label])).entries()];
  const cur = list.find((x) => x.id === S.sel);
  root.innerHTML = `<div class="pf">
    <div class="pf-top">
      <p class="small muted">${esc(d.counts?.en_attente || 0)} en attente · tu ne peux pas valider tes propres preuves</p>
      <div class="pf-chips" role="group" aria-label="Statut">${STATUTS.map(([k, l]) => `<button type="button" class="pf-chip" data-status="${k}" aria-pressed="${S.status === k}">${l}${d.counts?.[k] ? ` <span class="pf-n">${esc(d.counts[k])}</span>` : ''}</button>`).join('')}</div>
    </div>
    <div class="pf-tools">
      <label class="small" for="pf-quest">Quête</label>
      <select id="pf-quest" class="input"><option value="">Toutes les quêtes</option>${quests.map(([c, l]) => `<option value="${esc(c)}"${S.quest === c ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <button type="button" class="btn btn-ghost" data-act="purge">Nettoyer les captures de plus de 60 jours</button>
    </div>
    <div class="pf-body">
      <ul class="pf-list" aria-label="Preuves">${list.length ? list.map((x) => `<li><button type="button" class="pf-item" data-id="${esc(x.id)}" aria-current="${x.id === S.sel}">
          <span class="pf-av" style="background:${esc(x.color || '#9E3543')}" aria-hidden="true">${esc(ini(x.pseudo))}</span>
          <span class="pf-it"><strong>${esc(x.label)}</strong><span class="small muted">${esc(x.pseudo)}${x.game ? ` · ${esc(x.game)}` : ''}${x.own ? ' · ta preuve' : ''}</span></span>
          <span class="small muted pf-when">${esc(ago(x.updated_at))}</span></button></li>`).join('') : '<li class="empty">Aucune preuve ici.</li>'}</ul>
      <div class="pf-detail">${cur ? detailHtml(cur) : '<div class="empty">Choisis une preuve dans la liste.</div>'}</div>
    </div></div>`;
}

/** Détail d'une preuve. */
function detailHtml(x) {
  const shots = x.paths || [];
  const url = S.urls[shots[S.shot]];
  const pending = x.status === 'en_attente';
  return `<article class="pf-card" aria-labelledby="pf-t">
    <header class="pf-head"><span class="pf-av pf-av-lg" style="background:${esc(x.color || '#9E3543')}" aria-hidden="true">${esc(ini(x.pseudo))}</span>
      <div class="pf-ht"><h3 id="pf-t">${esc(x.label)}</h3><p class="small muted">${esc(x.pseudo)}${x.game ? ` · ${esc(x.game)}` : ''} · semaine du ${esc(dfmt.format(new Date(x.week + 'T12:00:00Z')))} · ${x.attempts > 1 ? '2e tentative' : '1re tentative'}</p></div>
      <span class="pf-reward">+${esc(x.reward)}</span></header>
    <div class="pf-shot">${x.purged ? '<p class="muted">Captures nettoyées (plus de 60 jours).</p>' : url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><img src="${esc(url)}" alt="Capture ${S.shot + 1} envoyée par ${esc(x.pseudo)}"></a>` : '<p class="muted">Capture en chargement…</p>'}</div>
    ${shots.length > 1 ? `<div class="pf-shots" role="group" aria-label="Captures"><span class="small muted">Captures :</span>${shots.map((_, i) => `<button type="button" class="pf-shotb" data-shot="${i}" aria-pressed="${i === S.shot}" aria-label="Capture ${i + 1}">${i + 1}</button>`).join('')}</div>` : ''}
    ${x.note ? `<p class="pf-note">« ${esc(x.note)} »</p>` : ''}
    ${x.status !== 'en_attente' ? `<p class="small">${x.status === 'validee' ? 'Validée' : 'Refusée'}${x.reviewer ? ` par ${esc(x.reviewer)}` : ''}${x.reason ? ` · motif : « ${esc(x.reason)} »` : ''}</p>` : ''}
    ${pending ? (x.own ? '<p class="pf-own">C’est ta preuve : un autre membre du Staff la validera.</p>' : `<div class="pf-actions">
      <button type="button" class="btn pf-ok" data-act="ok" ${S.busy ? 'disabled' : ''}>Valider <kbd>V</kbd></button>
      <label class="small" for="pf-motif">Motif</label>
      <select id="pf-motif" class="input">${MOTIFS.map((m) => `<option>${esc(m)}</option>`).join('')}<option value="">Autre motif…</option></select>
      <input id="pf-autre" class="input" maxlength="200" placeholder="Motif (200 caractères)" hidden aria-label="Autre motif">
      <button type="button" class="btn pf-ko" data-act="ko" ${S.busy ? 'disabled' : ''}>Refuser <kbd>R</kbd></button></div>`) : ''}
  </article>`;
}

/** Valide ou refuse la preuve affichée. */
async function review(ok) {
  const x = items().find((i) => i.id === S.sel);
  if (!x || x.own || x.status !== 'en_attente' || S.busy) return;
  let reason = null;
  if (!ok) {
    const sel = root.querySelector('#pf-motif');
    reason = sel.value || root.querySelector('#pf-autre').value.trim();
    if (!reason) { toast('Indique un motif.', 'error'); root.querySelector('#pf-autre').hidden = false; root.querySelector('#pf-autre').focus(); return; }
  }
  S.busy = true; render();
  const { data, error } = await sb.rpc('hg_proof_review', { p_id: x.id, p_ok: ok, p_reason: reason });
  S.busy = false;
  if (error) { toast(errMsg(error), 'error'); render(); return; }
  toast(ok ? `Preuve de ${x.pseudo} validée${data?.paid ? ` : +${x.reward} ✦ versés` : ''}.` : `Preuve de ${x.pseudo} refusée.`, 'ok');
  await load();
  root.querySelector('.pf-item[aria-current="true"]')?.focus();
}

/** Supprime les captures des preuves traitées depuis plus de 60 jours. */
async function purge() {
  const { data, error } = await sb.rpc('hg_proofs_purge_due');
  if (error) { toast(errMsg(error), 'error'); return; }
  if (!data.length) { toast('Rien à nettoyer.', 'ok'); return; }
  const paths = data.flatMap((x) => x.paths);
  const rm = await sb.storage.from(BUCKET).remove(paths);
  if (rm.error) { toast(errMsg(rm.error), 'error'); return; }
  const r = await sb.rpc('hg_proofs_mark_purged', { p_ids: data.map((x) => x.id) });
  if (r.error) { toast(errMsg(r.error), 'error'); return; }
  toast(`${r.data} preuve${r.data > 1 ? 's' : ''} nettoyée${r.data > 1 ? 's' : ''}.`, 'ok');
  await load();
}

/** Clics. */
function onClick(e) {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.status) { S.status = b.dataset.status; S.sel = null; load(); return; }
  if (b.dataset.id) { S.sel = b.dataset.id; S.shot = 0; render(); root.querySelector(`.pf-item[data-id="${S.sel}"]`)?.focus(); return; }
  if (b.dataset.shot) { S.shot = Number(b.dataset.shot); render(); return; }
  if (b.dataset.act === 'ok') review(true);
  if (b.dataset.act === 'ko') review(false);
  if (b.dataset.act === 'purge') purge();
}
// « Autre motif… » : champ libre.
document.addEventListener('change', (e) => {
  if (e.target.id !== 'pf-motif' || !root) return;
  const other = root.querySelector('#pf-autre');
  other.hidden = e.target.value !== '';
  if (!other.hidden) other.focus();
});

/** Raccourcis V (valider) et R (refuser), seulement section visible et hors champ de saisie. */
function onKey(e) {
  if (!root || !root.offsetParent || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest('input, textarea, select, [contenteditable]')) return;
  const k = e.key.toLowerCase();
  if (k === 'v') { e.preventDefault(); review(true); }
  if (k === 'r') { e.preventDefault(); review(false); }
}
