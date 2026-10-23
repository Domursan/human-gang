// ===== Humane Gang — merci public (idée P4, migration 090) =====
/*
 * Rôle : sur la fiche d'un membre, le compteur « Remercié N fois », les 5 derniers mercis, le bouton « Dire merci »
 * (message facultatif de 140 caractères, sortie partagée facultative) et, sur sa propre fiche, le masquage d'un merci.
 * Règles (serveur) : pas à soi-même ni à un fantôme, 3 mercis par jour, un par semaine et par personne (ou un par sortie).
 * Aucune Paillette : seulement les badges « Le gang te dit merci » et « Reconnaissant ».
 * Lien direct : membre.html?id=<membre>&merci=<sortie> ouvre la boîte avec la sortie choisie (suggestion de la page IRL).
 * Dépendances : core.js, social.js (boîte de dialogue), icons.js. RPC : hg_thanks_for, hg_thank, hg_thank_hide.
 * Exporte : mountThanks.
 */
import { sb, esc, toast, errMsg, fmtDate } from './core.js';
import { openDialog } from './social.js';
import { svg } from './icons.js';

const HEART = svg('star', { size: 18, stroke: 1.8 });
const MAX = 140;
/** Message lisible quand on ne peut pas (ou plus) dire merci. */
const REASONS = {
  plafond: 'Tu as déjà dit merci {cap} fois aujourd’hui. Reviens demain !',
  semaine: 'Tu lui as déjà dit merci cette semaine.',
  membre: 'Réservé aux membres du gang.',
};

/**
 * Monte le bloc des mercis dans el.
 * @param {HTMLElement} el conteneur
 * @param {{id: string, pseudo: string}} card membre affiché
 * @param {boolean} isMe vrai sur sa propre fiche
 * @param {{eventId?: string|null, mePseudo?: string}} [opts] sortie à relier d'office (lien « Dire merci à l’organisateur »), mon pseudo (aperçu)
 */
export async function mountThanks(el, card, isMe, { eventId = null, mePseudo = '' } = {}) {
  if (!el) return;
  let d;
  try {
    const { data, error } = await sb.rpc('hg_thanks_for', { p_user: card.id });
    if (error) throw error;
    d = data;
  } catch (e) { console.warn('[mercis]', e?.message || e); return; }
  if (!d) return;
  d.me_pseudo = mePseudo;
  render(el, card, isMe, d);
  if (!isMe && eventId && (d.events || []).some((x) => x.id === eventId)) openThank(el, card, isMe, d, eventId);
}

/** Dessine le bloc (compteur, bouton, derniers mercis). */
function render(el, card, isMe, d) {
  el.hidden = false;
  const n = Number(d.count) || 0;
  const events = d.events || [];
  const blocked = d.reason === 'plafond' || d.reason === 'membre' || (d.reason === 'semaine' && !events.length);
  const why = blocked ? REASONS[d.reason]?.replace('{cap}', d.cap) : '';
  const recent = d.recent || [];
  el.innerHTML = `<section class="card thx-block" aria-labelledby="thx-title">
    <div class="thx-head">
      <h2 class="mb-section-title" id="thx-title">${HEART} Mercis</h2>
      <span class="pill thx-count">${HEART}${n ? `Remercié ${n} fois` : 'Pas encore remercié'}</span>
    </div>
    ${isMe ? '' : `<div class="btn-row"><button type="button" class="btn btn-sand" id="thx-open"${blocked ? ' disabled aria-describedby="thx-why"' : ''}>${HEART}<span>Dire merci</span></button></div>
      ${why ? `<p class="small muted" id="thx-why">${esc(why)}</p>` : ''}`}
    ${recent.length ? `<h3 class="thx-sub">Derniers mercis reçus</h3><ul class="thx-list">${recent.map((t) => `<li class="thx-item${t.hidden ? ' is-hidden' : ''}">
        <p><strong>${esc(t.from_pseudo || 'Ancien membre')}</strong>${t.body ? ` <span class="muted">· « ${esc(t.body)} »</span>` : ''}</p>
        <p class="small muted">${esc(fmtDate(t.created_at))}${t.event_title ? ` · ${esc(t.event_title)}` : ''}${t.hidden ? ' · masqué de ta fiche' : ''}</p>
        ${isMe ? `<button type="button" class="btn btn-ghost thx-hide" data-thx="${esc(t.id)}" data-hidden="${t.hidden ? '0' : '1'}">${t.hidden ? 'Réafficher' : 'Masquer'}</button>` : ''}
      </li>`).join('')}</ul>` : `<p class="small muted">${isMe ? 'Les mercis du gang apparaîtront ici.' : `Sois le premier à remercier ${esc(card.pseudo)}.`}</p>`}
  </section>`;
  el.querySelector('#thx-open')?.addEventListener('click', () => openThank(el, card, isMe, d));
  el.querySelectorAll('[data-thx]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const { error } = await sb.rpc('hg_thank_hide', { p_id: b.dataset.thx, p_hidden: b.dataset.hidden === '1' });
      if (error) throw error;
      toast(b.dataset.hidden === '1' ? 'Merci masqué de ta fiche.' : 'Merci réaffiché.', 'ok');
      await mountThanks(el, card, isMe, { mePseudo: d.me_pseudo });
    } catch (e) { toast(errMsg(e), 'error'); b.disabled = false; }
  }));
}

/** Ouvre la boîte « Dire merci » (maquette P4) ; à l'envoi, recharge le bloc. */
function openThank(el, card, isMe, d, eventId = null) {
  const events = d.events || [];
  const onlyEvent = d.reason === 'semaine';
  const sel = eventId || (onlyEvent ? events[0]?.id : '') || '';
  const left = Math.max(0, (Number(d.cap) || 3) - (Number(d.today) || 0));
  const opts = [...events.map((e) => ({ id: e.id, title: e.title, sub: `${fmtDate(e.starts_at)} · tu y étais` })),
    ...(onlyEvent ? [] : [{ id: '', title: 'Sans sortie', sub: '' }])];
  const dlg = openDialog({
    id: 'thx-dlg',
    title: `Dire merci à ${card.pseudo}`,
    body: `<form class="stack" id="thx-form" novalidate>
      <div class="field"><label for="thx-body">Un petit mot (facultatif)</label>
        <textarea id="thx-body" maxlength="${MAX}" rows="3" placeholder="Pour le week-end, la raclette était parfaite" aria-describedby="thx-cnt"></textarea>
        <span class="small muted thx-cnt" id="thx-cnt" aria-live="polite">0 / ${MAX}</span></div>
      ${events.length ? `<fieldset class="thx-events"><legend>Relier à une sortie${onlyEvent ? '' : ' (facultatif)'}</legend>
        ${opts.map((o, i) => `<label class="thx-opt"><input type="radio" name="thx-ev" value="${esc(o.id)}"${o.id === sel ? ' checked' : ''} id="thx-ev-${i}">
          <span><strong>${esc(o.title)}</strong>${o.sub ? `<br><span class="small muted">${esc(o.sub)}</span>` : ''}</span></label>`).join('')}
      </fieldset>` : ''}
      <div class="thx-prev"><span class="small muted">Dans le fil d’activité (visible par tout le gang)</span>
        <p class="small" id="thx-prev"></p></div>
      <p class="form-error" id="thx-err" role="alert" hidden></p>
      <div class="btn-row"><button class="btn btn-sand" type="submit">${HEART}<span>Envoyer le merci</span></button></div>
      <p class="small muted">Il te reste ${left} merci${left > 1 ? 's' : ''} aujourd’hui · un seul par semaine pour ${esc(card.pseudo)}. Pas de Paillettes : juste de la reconnaissance. Évite les détails privés.</p>
    </form>`,
  });
  const ta = dlg.querySelector('#thx-body');
  /** Compteur et aperçu de la ligne du fil. */
  const sync = () => {
    dlg.querySelector('#thx-cnt').textContent = `${ta.value.length} / ${MAX}`;
    const body = ta.value.trim();
    dlg.querySelector('#thx-prev').innerHTML = `<strong>${esc(d.me_pseudo || 'Toi')}</strong> remercie <strong>${esc(card.pseudo)}</strong>${body ? ` : « ${esc(body)} »` : ''}`;
  };
  ta.addEventListener('input', sync);
  sync();
  ta.focus();
  dlg.querySelector('#thx-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]'), err = dlg.querySelector('#thx-err');
    btn.disabled = true; err.hidden = true;
    try {
      const ev = dlg.querySelector('input[name="thx-ev"]:checked')?.value || null;
      const { error } = await sb.rpc('hg_thank', { p_to: card.id, p_body: ta.value.trim() || null, p_event: ev });
      if (error) throw error;
      dlg.close();
      toast(`Merci envoyé à ${card.pseudo} !`, 'ok');
      import('./sound.js').then((m) => m.playSound?.('success')).catch(() => {});
      await mountThanks(el, card, isMe, { mePseudo: d.me_pseudo });
      el.querySelector('#thx-open')?.focus();
    } catch (ex) { err.textContent = errMsg(ex); err.hidden = false; btn.disabled = false; }
  });
}
