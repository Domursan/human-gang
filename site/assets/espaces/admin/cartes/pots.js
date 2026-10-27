// =====================================================================
// Cartes admin : cagnotte collective (C13) et bulletin « Le Cours de la Paillette » (C15) — Jeux et cartes › Cagnotte et bulletin.
// Cagnotte : créer (titre, objectif, type et nombre de boosters par membre, fin, badge), suivre (total, donateurs sans nom,
// membres servis), annuler (chacun est remboursé). Bulletin : reconstruire une semaine (après une correction de données).
// RPC (migration 082) : hg_pot_admin, hg_pot_create(p jsonb), hg_pot_cancel(p_pot, p_reason), hg_eco_bulletin_rebuild(p_week).
// Droits : Staff « cartes » (contrôlé par chaque RPC) ; chaque action est notée au journal admin (hg_admin_audit).
// Dépendances : core.js (sb, toast, errMsg, esc, $), ui-confirm.js (confirmBox), helpers.js (act).
// Exporte : mountPotsSection.
// =====================================================================
import { sb, toast, errMsg, esc, $ } from '../../../commun/core.js';
import { confirmBox } from '../../../commun/ui-confirm.js';
import { act } from './helpers.js';

const nf = new Intl.NumberFormat('fr-CH');
const whenFmt = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', dateStyle: 'medium', timeStyle: 'short' });
const STATUS = { ouverte: 'Ouverte', atteinte: 'Atteinte', echouee: 'Pas atteinte (remboursée)', annulee: 'Annulée (remboursée)' };
/** État : racine, cagnottes, types de boosters, nombre de membres actifs. */
const P = { root: null, pots: [], types: [] };

/** Valeur par défaut du champ « fin » : dans 7 jours à 18 h (heure locale du navigateur). */
function defaultEnd() {
  const d = new Date(Date.now() + 7 * 864e5);
  d.setHours(18, 0, 0, 0);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T18:00`;
}
/** Les 12 derniers lundis (semaines terminées), du plus récent au plus ancien, AAAA-MM-JJ. */
function lastMondays() {
  const d = new Date(); d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7);
  return Array.from({ length: 12 }, (_, i) => { const x = new Date(d.getTime() - i * 7 * 864e5); return x.toISOString().slice(0, 10); });
}

/** Ligne d'une cagnotte. */
function potRow(p) {
  const pct = Math.min(100, Math.floor(p.total / p.goal * 100));
  return `<article class="card adc-row" aria-labelledby="pot-a-${p.id}">
    <div class="adc-row-head"><h4 class="adc-row-title" id="pot-a-${p.id}">${esc(p.title)}</h4><span class="pill ${p.status === 'ouverte' ? 'pill-current' : ''}">${esc(STATUS[p.status] || p.status)}</span></div>
    <p class="small muted">${nf.format(p.total)} / ${nf.format(p.goal)} ✦ (${pct} %) · ${nf.format(p.contributors)} donateur${p.contributors > 1 ? 's' : ''} · récompense : ${nf.format(p.reward_qty)} × « ${esc(p.reward_name)} »${p.rewarded ? ` · ${nf.format(p.rewarded)} membres servis` : ''}</p>
    <p class="small muted">Du ${esc(whenFmt.format(new Date(p.starts_at)))} au ${esc(whenFmt.format(new Date(p.ends_at)))}${p.badge_code ? ` · badge ${esc(p.badge_code)}` : ''}</p>
    <div class="progress" role="progressbar" aria-label="Avancement de ${esc(p.title)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
    ${p.status === 'ouverte' ? `<div class="btn-row"><button type="button" class="btn btn-danger" data-pot-act="cancel" data-id="${p.id}">Annuler et rembourser</button></div>` : ''}
  </article>`;
}

/** Dessine la section. */
function render() {
  const open = P.pots.some((p) => p.status === 'ouverte');
  P.root.innerHTML = `<div class="adc">
    <section class="card adc-form" aria-labelledby="pot-new-h">
      <h3 class="adc-h" id="pot-new-h">Nouvelle cagnotte</h3>
      <p class="small muted">Les membres versent des Paillettes (10 ✦ minimum, 25 % de l’objectif au plus chacun). Objectif atteint : chaque membre actif reçoit la récompense, même sans avoir versé. Pas atteint à la date de fin : tout le monde est remboursé. Une seule cagnotte à la fois.</p>
      ${open ? '<p class="small"><strong>Une cagnotte est déjà ouverte.</strong> Attends sa fin ou annule-la pour en créer une autre.</p>' : `
      <form id="pot-new" class="adc-form" novalidate>
        <div class="adc-grid">
          <div class="field adc-wide"><label for="pot-t">Titre</label><input id="pot-t" name="title" maxlength="80" required placeholder="Un booster Raclette pour tout le monde"></div>
          <div class="field"><label for="pot-g">Objectif (✦)</label><input id="pot-g" name="goal" type="number" min="500" max="1000000" step="50" value="20000" required></div>
          <div class="field"><label for="pot-ty">Booster offert</label><select id="pot-ty" name="reward_type">${P.types.map((t) => `<option value="${esc(t.id)}">${esc(t.name)} (${nf.format(t.price)} ✦)</option>`).join('')}</select></div>
          <div class="field"><label for="pot-q">Boosters par membre</label><select id="pot-q" name="reward_qty"><option>1</option><option>2</option><option>3</option></select></div>
          <div class="field"><label for="pot-e">Fin</label><input id="pot-e" name="ends_at" type="datetime-local" value="${defaultEnd()}" required></div>
          <div class="adc-check adc-wide"><label><input type="checkbox" name="badge" checked> Badge « Cagnotte » pour les donateurs (100 ✦ versés ou plus)</label></div>
        </div>
        <p class="small muted">Garde-fou : la récompense ne doit pas valoir plus que l’objectif (prix × boosters × membres actifs).</p>
        <div class="btn-row"><button type="submit" class="btn btn-primary">Ouvrir la cagnotte</button></div>
      </form>`}
    </section>
    <section aria-labelledby="pot-list-h"><h3 class="adc-h" id="pot-list-h">Cagnottes</h3>
      <div class="adc-list">${P.pots.length ? P.pots.map(potRow).join('') : '<div class="empty">Aucune cagnotte pour le moment.</div>'}</div></section>
    <section class="card adc-form" aria-labelledby="bul-a-h">
      <h3 class="adc-h" id="bul-a-h">Bulletin « Le Cours de la Paillette »</h3>
      <p class="small muted">Le bulletin de la semaine passée se construit tout seul à la première visite du lundi. Reconstruis une semaine après une correction (même numéro, chiffres recalculés).</p>
      <div class="adc-grid"><div class="field"><label for="bul-w">Semaine du lundi</label><select id="bul-w">${lastMondays().map((w) => `<option value="${w}">${esc(w.split('-').reverse().join('.'))}</option>`).join('')}</select></div></div>
      <div class="btn-row"><button type="button" class="btn btn-ghost" data-pot-act="rebuild">Reconstruire le bulletin</button></div>
    </section>
  </div>`;
}

/** Relit les cagnottes et les types de boosters. */
async function reload() {
  try {
    const [pots, types] = await Promise.all([sb.rpc('hg_pot_admin'), sb.from('hg_booster_types').select('id,name,price,sort,pool').order('sort')]);
    if (pots.error) throw pots.error;
    if (types.error) throw types.error;
    P.pots = Array.isArray(pots.data) ? pots.data : [];
    P.types = (types.data || []).filter((t) => t.pool !== 'manquantes');
    render();
  } catch (e) {
    P.root.innerHTML = `<div class="empty">Impossible de charger les cagnottes : ${esc(errMsg(e))}</div>`;
  }
}

/** Création (formulaire). */
async function create(form, btn) {
  const f = new FormData(form);
  const title = String(f.get('title') || '').trim();
  if (title.length < 3) { toast('Titre : 3 caractères au moins', 'error'); $('#pot-t', P.root)?.focus(); return; }
  const end = new Date(String(f.get('ends_at') || ''));
  if (Number.isNaN(end.getTime())) { toast('Date de fin invalide', 'error'); return; }
  await act(btn, async () => {
    const { error } = await sb.rpc('hg_pot_create', { p: { title, goal: Number(f.get('goal')), reward_type: f.get('reward_type'), reward_qty: Number(f.get('reward_qty')), ends_at: end.toISOString(), badge: f.get('badge') === 'on' } });
    if (error) throw error;
    toast('Cagnotte ouverte', 'ok');
    await reload();
  });
}

/** Clics de la section. */
async function onClick(e) {
  const t = e.target.closest('[data-pot-act]');
  if (!t || t.disabled) return;
  if (t.dataset.potAct === 'cancel') {
    const ok = await confirmBox('Annuler la cagnotte ?', 'Chaque donateur récupère ses Paillettes ; aucune récompense n’est distribuée.', { ok: 'Annuler la cagnotte', cancel: 'Garder', danger: true });
    if (!ok) return;
    await act(t, async () => {
      const { data, error } = await sb.rpc('hg_pot_cancel', { p_pot: Number(t.dataset.id), p_reason: null });
      if (error) throw error;
      toast(`Cagnotte annulée : ${nf.format(Number(data) || 0)} versement(s) remboursé(s)`, 'ok');
      await reload();
    });
  } else if (t.dataset.potAct === 'rebuild') {
    const week = $('#bul-w', P.root)?.value;
    await act(t, async () => {
      const { data, error } = await sb.rpc('hg_eco_bulletin_rebuild', { p_week: week });
      if (error) throw error;
      toast(`Bulletin n° ${nf.format(Number(data?.num) || 0)} reconstruit`, 'ok');
    });
  }
}

/** Monte la section dans container. */
export async function mountPotsSection(container) {
  if (!container) return;
  P.root = container;
  container.addEventListener('click', onClick);
  container.addEventListener('submit', (e) => { if (e.target.id === 'pot-new') { e.preventDefault(); create(e.target, e.submitter || e.target.querySelector('[type=submit]')); } });
  await reload();
}
