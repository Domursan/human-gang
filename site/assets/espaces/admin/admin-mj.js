// ===== Humane Gang — administration : Jeux et cartes › Mes jeux (idée A3, permission Staff « Maître du jeu ») =====
// Rôle : un maître du jeu (Staff avec la permission « mj », attribué à un ou plusieurs jeux) annonce ses sessions dans le
// salon de son jeu, 3 annonces par semaine et par jeu, envoyées par le bot (hg-cron) à l'heure choisie. Il ne voit que ses
// jeux et rien d'autre du panel. L'admin voit tous les jeux : il les crée (nom, salon), et attribue ou retire les maîtres
// du jeu (parmi le Staff qui a la permission, donnée dans Pilotage › Staff).
// Les quêtes de campagne et la validation des preuves viendront avec les idées J11 et J12.
// Données : RPC hg_mj_overview, hg_mj_announce, hg_bot_schedule_cancel, hg_game_save, hg_game_master_set (migration 092) ;
// salons connus du bot : hg_settings.bot (lecture admin).
// Dépendances : core.js, admin-events.js (heure suisse), admin/ui/drawer.js, ui-confirm.js, admin/shell.js (setActions).
// Exporte : mjSub ({ main, open }), branché par admin.js sur « jeux/mes-jeux ».
import { sb, esc, toast, errMsg } from './core.js';
import { toZurichInput, fromZurichInput } from './admin-events.js';
import { openDrawer } from './admin/ui/drawer.js';
import { confirmBox } from './ui-confirm.js';
import { setActions } from './admin/shell.js';

const TZ = 'Europe/Zurich';
const when = new Intl.DateTimeFormat('fr-CH', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
// État : données de hg_mj_overview, salons connus (admin), conteneur.
const M = { root: null, data: null, salons: [] };

/** Statut d'une annonce : libellé et classe de pastille. */
function stateOf(a) {
  if (a.cancelled_at) return ['Annulée', 'mj-st-off'];
  if (a.sent_at && a.error) return ['Échec', 'mj-st-err'];
  if (a.sent_at) return ['Envoyée', 'mj-st-ok'];
  return ['Programmée', 'mj-st-wait'];
}

/** Monte la section et charge les jeux. */
async function main() {
  M.root = document.getElementById('mj-root');
  if (!M.root) return;
  M.root.addEventListener('click', onClick);
  M.root.addEventListener('change', onChange);
  await load();
}

/** Bouton « + Nouveau jeu » (admin seulement). */
function open() {
  if (!M.data?.is_admin) { setActions([]); return; }
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn btn-primary'; b.textContent = '+ Nouveau jeu';
  b.addEventListener('click', () => openGameForm(null));
  setActions([b]);
}

/** Lit hg_mj_overview (et les salons du bot pour l'admin), puis dessine. */
async function load() {
  try {
    const { data, error } = await sb.rpc('hg_mj_overview');
    if (error) throw error;
    M.data = data || { games: [] };
    if (M.data.is_admin && !M.salons.length) {
      const { data: s } = await sb.from('hg_settings').select('value').eq('key', 'bot').maybeSingle();
      const v = s?.value || {};
      M.salons = (Array.isArray(v.salons) ? v.salons : []).filter((x) => /^\d{17,20}$/.test(String(x?.id))).map((x) => ({ id: String(x.id), nom: String(x.nom || x.id) }));
      if (/^\d{17,20}$/.test(String(v.announce_channel_id || '')) && !M.salons.some((x) => x.id === v.announce_channel_id)) M.salons.unshift({ id: v.announce_channel_id, nom: 'annonces' });
    }
    render();
  } catch (e) {
    M.root.innerHTML = `<div class="empty">Impossible de charger tes jeux : ${esc(errMsg(e))}</div>`;
  }
}

const salonName = (id) => M.salons.find((s) => s.id === id)?.nom || null;

/** Dessine les cartes des jeux. */
function render() {
  const { games = [], is_admin: admin, candidates = [] } = M.data;
  const intro = admin
    ? 'Un maître du jeu anime son jeu : il annonce les sessions dans le salon du jeu (3 par semaine), sans accès au reste du panel. Donne-lui d’abord la permission « Maître du jeu » dans Pilotage › Staff, puis attribue-lui ses jeux ici.'
    : 'Annonce tes sessions dans le salon de ton jeu : le bot publie le message à l’heure choisie. 3 annonces par semaine et par jeu.';
  if (!games.length) {
    M.root.innerHTML = `<p class="small muted mj-intro">${esc(intro)}</p><div class="empty">${admin ? 'Aucun jeu pour l’instant. Crée le premier avec « + Nouveau jeu ».' : 'Aucun jeu ne t’est attribué pour l’instant : demande à l’admin.'}</div>`;
    return;
  }
  M.root.innerHTML = `<p class="small muted mj-intro">${esc(intro)}</p>
    <div class="mj-games">${games.map((g) => gameCard(g, admin, candidates)).join('')}</div>
    <p class="small muted mj-later">Quêtes de campagne et validation des preuves : elles arriveront ici avec les quêtes à validation.</p>`;
}

/** Carte d'un jeu : en-tête, maîtres du jeu (admin), annonce de session et annonces récentes. */
function gameCard(g, admin, candidates) {
  const used = g.quota?.used ?? 0, max = g.quota?.max ?? 3;
  const full = used >= max;
  const salon = g.channel_id ? (salonName(g.channel_id) ? `#${salonName(g.channel_id)}` : 'salon du jeu') : null;
  const id = esc(g.slug);
  const masters = admin ? `<div class="mj-masters">
      <p class="mj-label">Maîtres du jeu</p>
      ${(g.masters || []).length ? `<ul class="mj-chips">${g.masters.map((m) => `<li class="mj-chip">${esc(m.pseudo)}
        <button type="button" class="mj-x" data-mj="unset" data-game="${id}" data-user="${esc(m.user_id)}" aria-label="Retirer ${esc(m.pseudo)} de ${esc(g.name)}">×</button></li>`).join('')}</ul>` : '<p class="small muted">Personne pour l’instant.</p>'}
      ${(() => {
        const free = candidates.filter((c) => !(g.masters || []).some((m) => m.user_id === c.user_id));
        return free.length ? `<div class="mj-add"><label class="visually-hidden" for="mj-add-${id}">Ajouter un maître du jeu à ${esc(g.name)}</label>
          <select id="mj-add-${id}">${free.map((c) => `<option value="${esc(c.user_id)}">${esc(c.pseudo)}</option>`).join('')}</select>
          <button type="button" class="btn btn-ghost btn-sm" data-mj="set" data-game="${id}">Ajouter</button></div>`
          : '<p class="small muted">Aucun autre Staff « Maître du jeu » disponible.</p>';
      })()}
    </div>` : '';
  const upcoming = (g.upcoming || []).slice(0, 4);
  return `<article class="card mj-game${g.active ? '' : ' is-off'}" aria-labelledby="mj-h-${id}">
    <header class="mj-head">
      <div><h3 class="mj-title" id="mj-h-${id}">${esc(g.name)}</h3>
        <p class="small muted">${salon ? `Salon : ${esc(salon)}` : 'Aucun salon choisi'}${g.active ? '' : ' · inactif'}</p></div>
      ${admin ? `<button type="button" class="btn btn-ghost btn-sm" data-mj="edit" data-game="${id}">Modifier</button>` : ''}
    </header>
    ${masters}
    <div class="mj-announce">
      <p class="mj-label">Annoncer une session <span class="mj-quota${full ? ' is-full' : ''}">${used} sur ${max} cette semaine</span></p>
      <label class="visually-hidden" for="mj-msg-${id}">Message de l’annonce pour ${esc(g.name)}</label>
      <textarea id="mj-msg-${id}" rows="2" maxlength="1000"${full || !g.channel_id || !g.active ? ' disabled' : ''}>${esc(`Session ${g.name} ce samedi 21 h, shotgun en réponse !`)}</textarea>
      <div class="mj-when">
        <label class="mj-radio"><input type="radio" name="mj-when-${id}" value="now" checked> Tout de suite</label>
        <label class="mj-radio"><input type="radio" name="mj-when-${id}" value="later"> Plus tard</label>
        <label class="visually-hidden" for="mj-at-${id}">Heure d’envoi (heure suisse)</label>
        <input id="mj-at-${id}" type="datetime-local" value="${esc(toZurichInput(new Date(Date.now() + 3600e3).toISOString()))}" hidden>
        <button type="button" class="btn btn-primary btn-sm" data-mj="announce" data-game="${id}"${full || !g.channel_id || !g.active ? ' disabled' : ''}>Annoncer</button>
      </div>
      ${!g.channel_id ? '<p class="small muted">Pas de salon pour ce jeu : l’admin doit le choisir.</p>' : full ? '<p class="small muted">Quota atteint : la prochaine annonce sera possible dans quelques jours.</p>' : ''}
    </div>
    ${upcoming.length ? `<ul class="mj-list" aria-label="Annonces récentes de ${esc(g.name)}">${upcoming.map((a) => {
      const [label, cls] = stateOf(a);
      const pending = label === 'Programmée';
      return `<li class="mj-ann"><span class="mj-ann-when">${esc(when.format(new Date(a.send_at)))}</span>
        <span class="mj-ann-body">${esc(a.body)}</span><span class="mj-st ${cls}">${label}</span>
        ${pending ? `<button type="button" class="btn btn-ghost btn-sm" data-mj="cancel" data-id="${esc(a.id)}">Annuler</button>` : ''}</li>`;
    }).join('')}</ul>` : ''}
  </article>`;
}

/** Affiche l'heure d'envoi quand « Plus tard » est choisi. */
function onChange(e) {
  const r = e.target;
  if (r.type !== 'radio' || !r.name.startsWith('mj-when-')) return;
  const slug = r.name.slice(8);
  const at = M.root.querySelector(`#mj-at-${CSS.escape(slug)}`);
  if (at) at.hidden = r.value !== 'later';
}

/** Clics : annoncer, annuler, attribuer, retirer, modifier un jeu. */
async function onClick(e) {
  const b = e.target.closest('[data-mj]');
  if (!b || b.disabled) return;
  const act = b.dataset.mj, slug = b.dataset.game;
  const g = M.data?.games?.find((x) => x.slug === slug);
  /** Exécute une action en désactivant le bouton, puis recharge. */
  const run = async (fn, ok) => {
    b.disabled = true;
    try { await fn(); if (ok) toast(ok, 'ok'); await load(); }
    catch (ex) { toast(errMsg(ex), 'error'); b.disabled = false; }
  };
  if (act === 'announce' && g) {
    const body = M.root.querySelector(`#mj-msg-${CSS.escape(slug)}`).value.trim();
    const later = M.root.querySelector(`input[name="mj-when-${CSS.escape(slug)}"]:checked`)?.value === 'later';
    const at = later ? fromZurichInput(M.root.querySelector(`#mj-at-${CSS.escape(slug)}`).value) : null;
    if (body.length < 3) { toast('Écris le message de l’annonce.', 'error'); return; }
    if (later && (!at || new Date(at) < Date.now())) { toast('Choisis une heure à venir.', 'error'); return; }
    const ok = await confirmBox(`Annoncer dans le salon de ${g.name} ?`, later ? `Le bot publiera ton message le ${when.format(new Date(at))}.` : 'Le bot publiera ton message dans les 5 minutes.', { ok: 'Annoncer' });
    if (!ok) return;
    return run(async () => { const { error } = await sb.rpc('hg_mj_announce', { p_game: slug, p_body: body, p_send_at: at }); if (error) throw error; }, 'Annonce programmée.');
  }
  if (act === 'cancel') {
    const ok = await confirmBox('Annuler cette annonce ?', 'Elle ne partira pas (elle compte encore dans le quota de la semaine).', { ok: 'Annuler l’annonce', cancel: 'Garder', danger: true });
    if (!ok) return;
    return run(async () => { const { error } = await sb.rpc('hg_bot_schedule_cancel', { p_id: b.dataset.id }); if (error) throw error; }, 'Annonce annulée.');
  }
  if (act === 'set') {
    const user = M.root.querySelector(`#mj-add-${CSS.escape(slug)}`)?.value;
    if (!user) return;
    return run(async () => { const { error } = await sb.rpc('hg_game_master_set', { p_game: slug, p_user: user, p_on: true }); if (error) throw error; }, 'Maître du jeu ajouté.');
  }
  if (act === 'unset') {
    return run(async () => { const { error } = await sb.rpc('hg_game_master_set', { p_game: slug, p_user: b.dataset.user, p_on: false }); if (error) throw error; }, 'Maître du jeu retiré.');
  }
  if (act === 'edit' && g) openGameForm(g);
}

/** Tiroir de création ou de modification d'un jeu (admin). */
function openGameForm(g) {
  openDrawer({
    title: g ? `Modifier ${g.name}` : 'Nouveau jeu',
    subtitle: 'Le salon reçoit les annonces de session du maître du jeu. Il doit être dans les salons connus du bot.',
    submitLabel: g ? 'Enregistrer' : 'Créer le jeu',
    body: `<div class="mj-form">
      <div class="field"><label for="mj-f-name">Nom</label><input id="mj-f-name" type="text" maxlength="40" required value="${esc(g?.name || '')}" placeholder="Campagne Serge (CK3)"></div>
      <div class="field"><label for="mj-f-slug">Identifiant (lettres minuscules, chiffres, tirets)</label><input id="mj-f-slug" type="text" maxlength="30" required pattern="(?:[a-z0-9]|-){2,30}" value="${esc(g?.slug || '')}"${g ? ' readonly' : ''} placeholder="ck3"></div>
      <div class="field"><label for="mj-f-salon">Salon des annonces</label><select id="mj-f-salon"><option value="">Aucun</option>
        ${M.salons.map((s) => `<option value="${esc(s.id)}"${g?.channel_id === s.id ? ' selected' : ''}>#${esc(s.nom)}</option>`).join('')}</select></div>
      <label class="mj-radio"><input id="mj-f-active" type="checkbox"${g ? (g.active ? ' checked' : '') : ' checked'}> Actif (décoché : le maître du jeu ne peut plus annoncer)</label>
      <p class="form-error" id="mj-f-err" role="alert" hidden></p>
    </div>`,
    onSubmit: async (f) => {
      const err = f.querySelector('#mj-f-err');
      try {
        const { error } = await sb.rpc('hg_game_save', { p_slug: f.querySelector('#mj-f-slug').value.trim(), p_name: f.querySelector('#mj-f-name').value.trim(),
          p_channel: f.querySelector('#mj-f-salon').value || null, p_active: f.querySelector('#mj-f-active').checked });
        if (error) throw error;
      } catch (ex) { err.textContent = errMsg(ex); err.hidden = false; return false; }
      toast(g ? 'Jeu enregistré.' : 'Jeu créé.', 'ok');
      await load();
    },
  });
}

/** Fournisseur de la sous-section Jeux et cartes › Mes jeux (admin/shell.js). */
export const mjSub = { main, open };
