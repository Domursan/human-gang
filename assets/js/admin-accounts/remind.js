// ===== Humane Gang — administration : Membres › À relancer (idée A4) =====
// Rôle : liste des membres (hors fantômes) sans visite depuis 21, 30 ou 60 jours, avec ce qui les attend sur le site, et un
// message amical préparé (trois modèles modifiables). Rien ne part tout seul : « Copier » (pour l'écrire soi-même sur
// Discord) ou « Envoyer en MP par le bot » (après confirmation, seulement si le membre a accepté les MP du bot ; hg-notify
// vérifie l'opt-in). Un membre relancé ne revient pas avant 30 jours ; « Ne plus proposer » le retire durablement.
// Vie privée : la date de visite n'est donnée qu'à la semaine près, et seulement à l'admin et au Staff « Membres ».
// Données : RPC hg_admin_to_remind, hg_relance_mark, hg_relance_pause, hg_relance_settings, hg_relance_settings_save
// (migration 092) ; MP : fonction hg-notify, événement admin_dm (permission bot).
// Dépendances : core.js, admin/common.js (copyText), admin/ui/drawer.js, ui-confirm.js, admin/shell.js.
// Exporte : remindSub ({ main, open }), branché par admin.js sur « membres/relance ».
import { sb, esc, toast, errMsg, hasPerm, callFn, initials } from '../core.js';
import { copyText } from '../admin/common.js';
import { openDrawer } from '../admin/ui/drawer.js';
import { confirmBox } from '../ui-confirm.js';
import { setActions, setCount } from '../admin/shell.js';

// Modèles par défaut (hg_settings.relance absent). {pseudo} est remplacé par le pseudo du membre.
const DEFAUTS = [
  { titre: 'Secret Santa', texte: 'Coucou {pseudo} ! Le Secret Santa ferme bientôt ses inscriptions et ta liste de souhaits t’attend sur le site. Tu nous mets deux ou trois idées ?' },
  { titre: 'Photos', texte: 'Coucou {pseudo} ! On a ajouté les photos des dernières sorties sur le site, viens jeter un œil, tu nous manques !' },
  { titre: 'Simple coucou', texte: 'Coucou {pseudo} ! Ça fait un moment, tu nous manques sur le site du gang. Passe faire un tour quand tu veux !' },
];
const DUREES = [21, 30, 60];
const dateFmt = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'short' });
// État : réponse de hg_admin_to_remind, durée, membre choisi, modèles, modèle choisi, message en cours.
const R = { root: null, data: null, days: 30, sel: null, modeles: DEFAUTS, tpl: 0, msg: '' };

/** « il y a 5 semaines » (ou « pas encore de visite notée »). */
const vu = (m) => (m.never ? 'pas de visite notée' : `vu il y a ${m.weeks} semaine${m.weeks > 1 ? 's' : ''}`);
/** Ce qui attend le membre, en phrases courtes. */
function attentes(p = {}) {
  const out = [];
  if (p.trades) out.push(`${p.trades} échange${p.trades > 1 ? 's' : ''} de cartes en attente`);
  if (p.ss_souhaits_vides) out.push('Secret Santa : souhaits vides');
  else if (p.ss_inscrit) out.push('inscrit au Secret Santa');
  if (p.prochaine_sortie) out.push(`inscrit à « ${p.prochaine_sortie} »`);
  return out;
}
/** Pastille d'avatar (initiales sur la couleur du membre). */
const avatar = (m, big = false) => `<span class="rl-av${big ? ' is-big' : ''}" style="--c:${/^#[0-9a-f]{3,8}$/i.test(m.color || '') ? m.color : 'var(--slate)'}" aria-hidden="true">${esc(initials(m.pseudo))}</span>`;

/** Monte la section et charge la liste. */
async function main() {
  R.root = document.getElementById('relance-root');
  if (!R.root) return;
  R.root.addEventListener('click', onClick);
  R.root.addEventListener('input', (e) => { if (e.target.id === 'rl-msg') R.msg = e.target.value; });
  await Promise.all([loadModeles(), load()]);
}

/** En-tête de zone : « Sans visite depuis 21 j / 30 j / 60 j ». */
function open() {
  const g = document.createElement('div');
  g.className = 'rl-seg';
  g.setAttribute('role', 'group');
  g.setAttribute('aria-label', 'Sans visite depuis');
  g.innerHTML = `<span class="rl-seg-l small muted" aria-hidden="true">Sans visite depuis</span>${DUREES.map((d) => `<button type="button" class="rl-segb" data-days="${d}" aria-pressed="${d === R.days}">${d} j</button>`).join('')}`;
  g.addEventListener('click', (e) => {
    const b = e.target.closest('[data-days]');
    if (!b || Number(b.dataset.days) === R.days) return;
    R.days = Number(b.dataset.days);
    g.querySelectorAll('[data-days]').forEach((x) => x.setAttribute('aria-pressed', String(Number(x.dataset.days) === R.days)));
    load();
  });
  setActions([g]);
}

/** Modèles enregistrés (sinon les modèles par défaut). */
async function loadModeles() {
  try {
    const { data, error } = await sb.rpc('hg_relance_settings');
    if (error) throw error;
    const m = Array.isArray(data?.modeles) ? data.modeles.filter((x) => x?.titre && x?.texte) : [];
    if (m.length) R.modeles = m;
  } catch { /* modèles par défaut */ }
}

/** Lit la liste et redessine. */
async function load() {
  try {
    const { data, error } = await sb.rpc('hg_admin_to_remind', { p_days: R.days });
    if (error) throw error;
    R.data = { todo: [], done: [], paused: [], ...(data || {}) };
    setCount('relance', R.data.todo.length);
    if (!R.sel || !all().some((m) => m.id === R.sel)) pick(R.data.todo[0]?.id || null, false);
    render();
  } catch (e) {
    R.root.innerHTML = `<div class="empty">Impossible de charger la liste : ${esc(errMsg(e))}</div>`;
  }
}
const all = () => [...(R.data?.todo || []), ...(R.data?.done || [])];

/** Choisit un membre et prépare son message (modèle Secret Santa si sa liste de souhaits est vide). */
function pick(id, draw = true) {
  R.sel = id;
  const m = all().find((x) => x.id === id);
  if (m) {
    const ss = R.modeles.findIndex((x) => /santa/i.test(x.titre));
    R.tpl = m.pending?.ss_souhaits_vides && ss >= 0 ? ss : R.modeles.length - 1;
    R.msg = fill(R.modeles[R.tpl]?.texte || '', m);
  }
  if (draw) render();
}
const fill = (t, m) => String(t).replaceAll('{pseudo}', m.pseudo);

/** Liste (à relancer, déjà relancés, en pause) et fiche du membre choisi. */
function render() {
  const { todo, done, paused } = R.data;
  const row = (m, sub, tag, cls = '') => `<li><button type="button" class="rl-row${R.sel === m.id ? ' is-sel' : ''}" data-rl="pick" data-id="${esc(m.id)}" aria-pressed="${R.sel === m.id}">
    ${avatar(m)}<span class="rl-who"><b>${esc(m.pseudo)}</b><span class="small muted">${esc(sub)}</span></span>${tag ? `<span class="rl-tag ${cls}">${esc(tag)}</span>` : ''}</button></li>`;
  R.root.innerHTML = `<div class="rl">
    <div class="rl-col">
      <p class="small muted rl-sum">${todo.length ? `${todo.length} membre${todo.length > 1 ? 's' : ''} sans visite depuis ${R.days} jours (comptes fantômes exclus)` : `Personne à relancer : tout le monde est passé depuis moins de ${R.days} jours.`}</p>
      ${todo.length ? `<ul class="rl-list" aria-label="Membres à relancer">${todo.map((m) => row(m, [vu(m), ...attentes(m.pending)].join(' · '), m.never ? '—' : `${m.weeks} sem.`)).join('')}</ul>` : ''}
      ${done.length ? `<h3 class="rl-h">Déjà relancés</h3><ul class="rl-list" aria-label="Déjà relancés">${done.map((m) => row(m,
        `relancé le ${dateFmt.format(new Date(m.at))}${m.by ? ` par ${m.by}` : ''}${m.canal === 'mp' ? ' (MP)' : ''}`, m.back ? 'Revenu' : '', m.back ? 'is-back' : '')).join('')}</ul>` : ''}
      ${paused.length ? `<h3 class="rl-h">Ne plus proposer</h3><ul class="rl-list rl-paused">${paused.map((m) => `<li class="rl-prow">${avatar(m)}<b>${esc(m.pseudo)}</b>
        <button type="button" class="btn btn-ghost btn-sm" data-rl="resume" data-id="${esc(m.id)}">Reprendre</button></li>`).join('')}</ul>` : ''}
      <button type="button" class="btn btn-ghost btn-sm rl-models" data-rl="models">Modifier les modèles de message</button>
    </div>
    <section class="rl-fiche" aria-label="Relance">${fiche()}</section>
  </div>`;
}

/** Fiche du membre choisi : repères, message préparé et actions. */
function fiche() {
  const m = all().find((x) => x.id === R.sel);
  if (!m) return '<div class="empty">Choisis un membre dans la liste.</div>';
  const canMp = hasPerm('bot') && m.bot_ok;
  const wait = attentes(m.pending);
  return `<header class="rl-fhead">${avatar(m, true)}
      <div class="rl-fwho"><h3>${esc(m.pseudo)}</h3><p class="small muted">${m.since_year ? `Membre depuis ${m.since_year} · ` : ''}${m.bot_ok ? 'accepte les MP du bot' : 'n’a pas activé les MP du bot'}</p></div>
      <a class="btn btn-ghost btn-sm" href="#membres/comptes/${esc(m.id)}">Voir la fiche</a></header>
    <div class="rl-tiles">
      <p class="rl-tile"><span>Dernière visite</span><b>${m.never ? 'pas notée' : m.weeks != null ? `il y a ${m.weeks} sem.` : '—'}</b></p>
      <p class="rl-tile"><span>Dernière sortie</span><b>${esc(m.last_irl || '—')}</b></p>
      <p class="rl-tile"><span>En attente</span><b>${wait.length ? esc(wait.join(' · ')) : 'rien'}</b></p>
    </div>
    <div class="rl-tpl"><p class="rl-label" id="rl-tpl-l">Message préparé</p>
      <div class="rl-chips" role="group" aria-labelledby="rl-tpl-l">${R.modeles.map((t, i) => `<button type="button" class="rl-chip" data-rl="tpl" data-i="${i}" aria-pressed="${i === R.tpl}">${esc(t.titre)}</button>`).join('')}</div></div>
    <label class="visually-hidden" for="rl-msg">Message pour ${esc(m.pseudo)}</label>
    <textarea id="rl-msg" class="rl-msg" rows="5" maxlength="2000">${esc(R.msg)}</textarea>
    <p class="small muted">Rien ne part sans ton clic. Après la relance, ${esc(m.pseudo)} ne reviendra pas dans cette liste avant 30 jours.</p>
    <div class="rl-actions">
      <button type="button" class="btn btn-ghost btn-sm" data-rl="pause">Ne plus proposer</button>
      <button type="button" class="btn btn-ghost btn-sm" data-rl="copy">Copier</button>
      <button type="button" class="btn btn-primary btn-sm" data-rl="mp"${canMp ? '' : ' disabled'}>Envoyer en MP par le bot</button>
    </div>
    ${canMp ? '' : `<p class="small muted">${hasPerm('bot') ? 'MP impossible : ce membre n’a pas accepté les MP du bot.' : 'MP réservé au Staff « Bot Discord » : copie le message pour l’envoyer toi-même.'}</p>`}`;
}

/** Note la relance puis recharge. */
async function mark(id, canal) {
  const { error } = await sb.rpc('hg_relance_mark', { p_user: id, p_canal: canal });
  if (error) throw error;
}

/** Clics de la section. */
async function onClick(e) {
  const b = e.target.closest('[data-rl]');
  if (!b || b.disabled) return;
  const act = b.dataset.rl;
  const m = all().find((x) => x.id === R.sel);
  if (act === 'pick') return pick(b.dataset.id);
  if (act === 'tpl' && m) { R.tpl = Number(b.dataset.i); R.msg = fill(R.modeles[R.tpl].texte, m); return render(); }
  if (act === 'models') return openModels();
  if (act === 'resume') {
    try { const { error } = await sb.rpc('hg_relance_pause', { p_user: b.dataset.id, p_pause: false }); if (error) throw error; toast('Membre remis dans la liste.', 'ok'); await load(); }
    catch (ex) { toast(errMsg(ex), 'error'); }
    return;
  }
  if (!m) return;
  const msg = R.msg.trim();
  b.disabled = true;
  try {
    if (act === 'copy') {
      if (!msg) throw new Error('Le message est vide.');
      await copyText(msg);
      await mark(m.id, 'copie');
      toast(`Message copié : ${m.pseudo} est noté comme relancé.`, 'ok');
    } else if (act === 'mp') {
      if (!msg) throw new Error('Le message est vide.');
      const ok = await confirmBox(`Envoyer ce MP à ${m.pseudo} ?`, 'Le bot l’envoie tout de suite, en ton nom.', { ok: 'Envoyer le MP' });
      if (!ok) { b.disabled = false; return; }
      const res = await callFn('hg-notify', { event: 'admin_dm', user_ids: [m.id], body: msg });
      if (!(res?.sent > 0)) throw new Error(res?.recipients?.[0]?.reason || 'Le MP n’est pas parti.');
      await mark(m.id, 'mp');
      toast(`MP envoyé à ${m.pseudo}.`, 'ok');
    } else if (act === 'pause') {
      const ok = await confirmBox(`Ne plus proposer ${m.pseudo} ?`, 'Pour une pause annoncée ou un départ. Tu pourras le remettre avec « Reprendre ».', { ok: 'Ne plus proposer' });
      if (!ok) { b.disabled = false; return; }
      const { error } = await sb.rpc('hg_relance_pause', { p_user: m.id, p_pause: true });
      if (error) throw error;
      toast(`${m.pseudo} ne sera plus proposé.`, 'ok');
    }
    R.sel = null;
    await load();
  } catch (ex) {
    toast(errMsg(ex), 'error');
    b.disabled = false;
  }
}

/** Tiroir des modèles de message (1 à 3). */
function openModels() {
  const list = [...R.modeles, ...DEFAUTS].slice(0, 3);
  openDrawer({
    title: 'Modèles de message',
    subtitle: 'Trois modèles au plus ; {pseudo} est remplacé par le pseudo du membre. Ton amical : « tu nous manques » plutôt que « tu ne viens plus ».',
    submitLabel: 'Enregistrer',
    body: `<div class="rl-form">${list.map((t, i) => `<fieldset class="rl-mf"><legend>Modèle ${i + 1}</legend>
      <div class="field"><label for="rl-mt-${i}">Titre</label><input id="rl-mt-${i}" type="text" maxlength="30" value="${esc(t.titre)}"></div>
      <div class="field"><label for="rl-mx-${i}">Texte</label><textarea id="rl-mx-${i}" rows="3" maxlength="600">${esc(t.texte)}</textarea></div></fieldset>`).join('')}
      <p class="form-error" id="rl-m-err" role="alert" hidden></p></div>`,
    onSubmit: async (f) => {
      const modeles = [0, 1, 2].map((i) => ({ titre: f.querySelector(`#rl-mt-${i}`).value.trim(), texte: f.querySelector(`#rl-mx-${i}`).value.trim() }))
        .filter((x) => x.titre || x.texte);
      try {
        const { error } = await sb.rpc('hg_relance_settings_save', { p_modeles: modeles });
        if (error) throw error;
      } catch (ex) { const err = f.querySelector('#rl-m-err'); err.textContent = errMsg(ex); err.hidden = false; return false; }
      R.modeles = modeles;
      toast('Modèles enregistrés.', 'ok');
      pick(R.sel);
    },
  });
}

/** Fournisseur de la sous-section Membres › À relancer (admin/shell.js). */
export const remindSub = { main, open };
