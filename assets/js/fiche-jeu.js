// ===== Humane Gang — fiche d'un jeu du gang (fiche-jeu.html?slug=…) =====
/*
 * Rôle : fiche d'un jeu, en onglets (Fiche, Règles maison, Liens).
 *   Fiche : prochaine session (Je viens / Peut-être, export .ics, annulation), proposer une session, sessions suivantes
 *   et passées ; « Qui y joue » (chacun se déclare : régulier, de temps en temps, veut apprendre, avec un petit rôle).
 *   Règles maison : markdown simple (gras, italique, listes, liens https) écrit par les référents, avec l'historique.
 *   Liens : liens publics (liste blanche côté serveur) et zone privée réservée aux joueurs déclarés.
 * Page : fiche-jeu.html (session membre requise ; page « ludothèque » requise).
 * Dépendances : core.js, ludotheque-icons.js, ics.js (agenda), ui-confirm.js.
 * Données : hg_ludo_games, hg_ludo_referents, hg_ludo_players, hg_ludo_sessions, hg_ludo_session_rsvps, hg_ludo_private,
 *   hg_ludo_rules_history ; RPC hg_members, hg_ludo_session_create, hg_ludo_session_cancel, hg_ludo_rules_save,
 *   hg_ludo_links_save (migration 088).
 * Exporte : mdLite (rendu markdown limité, testé à part).
 */
import { sb, initPage, esc, $, errMsg, toast, avatarHtml, canAccess, hasPerm, loadMyPerms } from './core.js';
import { gameIcon, gameColor } from './ludotheque-icons.js';
import { addToCalendar } from './ics.js';
import { confirmBox } from './ui-confirm.js';

/**
 * Markdown limité et sûr : le texte est échappé d'abord, puis **gras**, *italique*, listes « - » et liens
 * [texte](https://…) seulement. Aucun HTML venant de la base n'est interprété.
 * @param {string} src texte des règles
 * @returns {string} HTML
 */
export function mdLite(src) {
  const inline = (t) => esc(t)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>');
  const out = []; let list = null;
  for (const raw of String(src ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    const m = line.match(/^[-*]\s+(.*)$/);
    if (m) { (list ||= []).push(`<li>${inline(m[1])}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    if (line) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('');
}

const slug = new URLSearchParams(location.search).get('slug') || '';
const root = $('#jeu-root');
const me = await initPage();
await loadMyPerms().catch(() => null);
if (!canAccess('ludotheque')) location.replace('accueil.html?refus=ludotheque');

const LEVEL = { regulier: ['Régulier', 'lvl-reg'], parfois: ['De temps en temps', 'lvl-par'], apprendre: ['Veut apprendre', 'lvl-app'] };
const TABS = [['fiche', 'Fiche'], ['regles', 'Règles maison'], ['liens', 'Liens']];
const sessFmt = new Intl.DateTimeFormat('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
const shortFmt = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Zurich' });
/** « Samedi 25 octobre · 20:30 » (Zurich). */
const sessLabel = (iso) => { const t = sessFmt.format(new Date(iso)).replace(/ à /, ' · '); return t.charAt(0).toUpperCase() + t.slice(1); };
const S = { game: null, refs: [], players: [], sessions: [], rsvps: [], priv: null, history: [], people: new Map(), tab: 'fiche' };

/* ---------- Données ---------- */
async function load() {
  const [g, r, p, s, m] = await Promise.all([
    sb.from('hg_ludo_games').select('*').eq('slug', slug).maybeSingle(),
    sb.from('hg_ludo_referents').select('user_id').eq('game_slug', slug),
    sb.from('hg_ludo_players').select('user_id,level,role_label').eq('game_slug', slug),
    sb.from('hg_ludo_sessions').select('id,starts_at,note,created_by,cancelled_at').eq('game_slug', slug).order('starts_at'),
    sb.rpc('hg_members'),
  ]);
  if (g.error) throw g.error;
  S.game = g.data;
  if (!S.game) return;
  S.refs = (r.data || []).map((x) => x.user_id);
  S.players = p.data || [];
  S.sessions = (s.data || []).filter((x) => !x.cancelled_at);
  S.people = new Map((m.data || []).map((x) => [x.id, x]));
  const ids = S.sessions.map((x) => x.id);
  const [rv, pv, h] = await Promise.all([
    ids.length ? sb.from('hg_ludo_session_rsvps').select('session_id,user_id,status').in('session_id', ids) : { data: [] },
    sb.from('hg_ludo_private').select('links').eq('game_slug', slug).maybeSingle(),
    sb.from('hg_ludo_rules_history').select('id,edited_by,edited_at').eq('game_slug', slug).order('edited_at', { ascending: false }).limit(20),
  ]);
  S.rsvps = rv.data || [];
  S.priv = pv.data || null;
  S.history = h.data || [];
}

const canEdit = () => hasPerm('ludotheque') || S.refs.includes(me.id);
const pseudo = (id) => S.people.get(id)?.pseudo || 'Ancien membre';
const isPlayer = () => S.players.some((p) => p.user_id === me.id);

/* ---------- Rendu ---------- */
function sessionCard(x, big) {
  const rs = S.rsvps.filter((r) => r.session_id === x.id);
  const yes = rs.filter((r) => r.status === 'oui'), maybe = rs.filter((r) => r.status === 'peut-etre');
  const mine = rs.find((r) => r.user_id === me.id)?.status;
  const canCancel = x.created_by === me.id || canEdit();
  return `<div class="${big ? 'jeu-sess' : 'jeu-sess jeu-sess-sm'}" data-sess="${esc(x.id)}">
    <div class="jeu-between">${big ? '<p class="jeu-kicker">Prochaine session</p>' : ''}
      <button type="button" class="pill jeu-ics" data-ics="${esc(x.id)}" aria-label="Ajouter la session à mon agenda (.ics)">.ics</button></div>
    <p class="jeu-sess-date">${esc(sessLabel(x.starts_at))}</p>
    ${x.note ? `<p class="small muted">${esc(x.note)}</p>` : ''}
    <div class="jeu-avs-row"><span class="jeu-avs">${yes.slice(0, 6).map((r) => avatarHtml(S.people.get(r.user_id) || { pseudo: '?' }, 26)).join('')}</span>
      <span class="small muted">${yes.length} oui · ${maybe.length} peut-être</span></div>
    <div class="jeu-rsvp" role="group" aria-label="Ta réponse">
      <button type="button" class="btn ${mine === 'oui' ? 'btn-sand' : 'btn-ghost'}" data-rsvp="oui" aria-pressed="${mine === 'oui'}">Je viens</button>
      <button type="button" class="btn ${mine === 'peut-etre' ? 'btn-sand' : 'btn-ghost'}" data-rsvp="peut-etre" aria-pressed="${mine === 'peut-etre'}">Peut-être</button>
      ${mine ? '<button type="button" class="btn btn-ghost" data-rsvp="">Je ne viens pas</button>' : ''}
    </div>
    ${canCancel ? '<p class="small"><button type="button" class="jeu-link-btn" data-cancel>Annuler cette session</button></p>' : ''}
  </div>`;
}

function ficheHtml() {
  const now = Date.now() - 3 * 3600e3;
  const next = S.sessions.filter((x) => new Date(x.starts_at).getTime() >= now);
  const past = S.sessions.filter((x) => new Date(x.starts_at).getTime() < now).reverse();
  const players = [...S.players].sort((a, b) => (S.refs.includes(b.user_id) - S.refs.includes(a.user_id)) || pseudo(a.user_id).localeCompare(pseudo(b.user_id), 'fr'));
  const refsOnly = S.refs.filter((id) => !S.players.some((p) => p.user_id === id));
  const row = (id, p) => {
    const [lbl, cls] = p ? LEVEL[p.level] || LEVEL.parfois : [null];
    return `<li class="jeu-prow">${avatarHtml(S.people.get(id) || { pseudo: pseudo(id) }, 28)}
      <div class="jeu-pbody"><p class="jeu-pname">${esc(pseudo(id))}</p>${p?.role_label ? `<p class="small muted">${esc(p.role_label)}</p>` : ''}</div>
      ${S.refs.includes(id) ? '<span class="jeu-lvl lvl-ref">Référent</span>' : `<span class="jeu-lvl ${cls}">${esc(lbl)}</span>`}</li>`;
  };
  return `${next.length ? sessionCard(next[0], true) : '<div class="jeu-sess"><p class="jeu-kicker">Prochaine session</p><p class="small muted">Pas de session prévue pour l’instant.</p></div>'}
    <p class="jeu-propose-row"><button type="button" class="btn btn-ghost" data-new-session>Proposer une session</button></p>
    ${next.length > 1 ? `<section aria-labelledby="jeu-h-later"><h2 class="jeu-h" id="jeu-h-later">Ensuite</h2>${next.slice(1).map((x) => sessionCard(x, false)).join('')}</section>` : ''}
    <section class="card jeu-players" aria-labelledby="jeu-h-players">
      <div class="jeu-between"><h2 class="jeu-h" id="jeu-h-players">Qui y joue</h2>
        <button type="button" class="btn btn-ghost btn-sm" data-player>${isPlayer() ? 'Modifier' : 'Je joue aussi'}</button></div>
      ${players.length || refsOnly.length ? `<ul class="jeu-plist">${players.map((p) => row(p.user_id, p)).join('')}${refsOnly.map((id) => row(id, null)).join('')}</ul>` : '<p class="small muted">Personne ne s’est encore déclaré. Lance-toi !</p>'}
    </section>
    ${past.length ? `<details class="jeu-past"><summary>Sessions passées (${past.length})</summary><ul>${past.map((x) => `<li>${esc(sessLabel(x.starts_at))}${x.note ? ` · <span class="muted">${esc(x.note)}</span>` : ''}</li>`).join('')}</ul></details>` : ''}`;
}

function reglesHtml() {
  const g = S.game;
  return `<section class="card jeu-rules" aria-labelledby="jeu-h-rules">
    <div class="jeu-between"><h2 class="jeu-h" id="jeu-h-rules">Règles maison</h2>
      ${g.rules_updated_at ? `<p class="small muted">par ${esc(pseudo(g.rules_updated_by))} · ${esc(shortFmt.format(new Date(g.rules_updated_at)))}</p>` : ''}</div>
    <div class="jeu-md">${g.rules_md ? mdLite(g.rules_md) : '<p class="small muted">Pas encore de règles maison.</p>'}</div>
    ${canEdit() ? '<p><button type="button" class="btn btn-ghost btn-sm" data-edit-rules>Modifier les règles</button></p>' : ''}
    ${S.history.length > 1 ? `<details class="jeu-hist"><summary>Versions précédentes (${S.history.length})</summary><ul>${S.history.map((h) => `<li>${esc(shortFmt.format(new Date(h.edited_at)))} · ${esc(pseudo(h.edited_by))}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}

function liensHtml() {
  const links = Array.isArray(S.game.links) ? S.game.links : [];
  const safe = (u) => (/^https:\/\/[^\s"'<>]+$/.test(u || '') ? u : null);
  return `<section class="card jeu-links" aria-labelledby="jeu-h-links">
    <h2 class="jeu-h" id="jeu-h-links">Liens utiles</h2>
    ${links.length ? `<ul class="jeu-linklist">${links.filter((l) => safe(l.url)).map((l) => `<li><a href="${esc(l.url)}" rel="noopener noreferrer" target="_blank">${esc(l.label)}</a></li>`).join('')}</ul>` : '<p class="small muted">Pas encore de lien.</p>'}
    <h3 class="jeu-h3">Zone des joueurs</h3>
    ${S.priv ? ((S.priv.links || []).length ? `<ul class="jeu-linklist">${S.priv.links.map((l) => `<li><span class="jeu-priv-l">${esc(l.label)} :</span> <code>${esc(l.value)}</code></li>`).join('')}</ul>` : '<p class="small muted">Rien pour l’instant.</p>')
      : '<p class="small muted">Les infos privées (adresse du serveur, mot de passe) sont visibles des joueurs déclarés. Déclare-toi dans l’onglet Fiche.</p>'}
    ${canEdit() ? '<p><button type="button" class="btn btn-ghost btn-sm" data-edit-links>Modifier les liens</button></p>' : ''}
  </section>`;
}

function paint() {
  const g = S.game;
  document.title = `${g.name} · Humane Gang`;
  root.innerHTML = `<div class="jeu-top" style="--g:${gameColor(g.color)}">
      <span class="ludo-ico jeu-ico">${gameIcon(g.icon)}</span>
      <div><p class="eyebrow">Jeux du gang</p><h1 class="page-title jeu-title">${esc(g.name)}</h1></div>
    </div>
    <div class="jeu-tabs" role="tablist" aria-label="Sections du jeu">
      ${TABS.map(([k, l]) => `<button type="button" role="tab" class="jeu-tab" id="jeu-tab-${k}" aria-controls="jeu-pan" aria-selected="${k === S.tab}" tabindex="${k === S.tab ? 0 : -1}" data-tab="${k}">${l}</button>`).join('')}
      ${g.slug === 'gartic-phone' && canAccess('gartic') ? '<a class="jeu-tab jeu-tab-link" href="gartic.html">Galerie</a>' : ''}
    </div>
    <div class="jeu-pan" id="jeu-pan" role="tabpanel" aria-labelledby="jeu-tab-${S.tab}" tabindex="0">
      ${S.tab === 'regles' ? reglesHtml() : S.tab === 'liens' ? liensHtml() : ficheHtml()}
    </div>`;
}

/* ---------- Fenêtres ---------- */
/** Petite fenêtre de formulaire ; onSubmit(FormData) renvoie un message d'erreur ou rien. */
function dialog(title, bodyHtml, submitLabel, onSubmit, extra = '') {
  const d = document.createElement('dialog');
  d.className = 'hg-dialog jeu-dialog';
  d.setAttribute('aria-labelledby', 'jeu-dlg-t');
  d.innerHTML = `<form class="stack" novalidate>
    <div class="dlg-head"><h2 class="dlg-title" id="jeu-dlg-t">${esc(title)}</h2><button class="btn btn-ghost dlg-x" type="button" data-close aria-label="Fermer">✕</button></div>
    ${bodyHtml}
    <p class="form-error" role="alert" hidden></p>
    <div class="btn-row dlg-foot">${extra}<button type="button" class="btn btn-ghost" data-close>Annuler</button><button type="submit" class="btn btn-sand">${esc(submitLabel)}</button></div>
  </form>`;
  document.body.append(d);
  const opener = document.activeElement;
  const f = d.querySelector('form'), err = d.querySelector('.form-error');
  d.addEventListener('close', () => { d.remove(); opener?.focus?.(); }, { once: true });
  for (const b of d.querySelectorAll('[data-close]')) b.addEventListener('click', () => d.close());
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    const m = await onSubmit(new FormData(f), e.submitter);
    btn.disabled = false;
    if (m) { err.textContent = m; err.hidden = false; return; }
    d.close();
  });
  d.showModal();
  f.querySelector('input,textarea,select')?.focus();
  return d;
}

async function refresh() { await load(); paint(); }

function openSession() {
  const d = new Date(Date.now() + 864e5); d.setHours(20, 30, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const val = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  dialog('Proposer une session', `<div class="field"><label for="jeu-s-d">Date et heure</label><input id="jeu-s-d" name="d" type="datetime-local" required value="${val}"></div>
    <div class="field"><label for="jeu-s-n">Petit mot (facultatif)</label><textarea id="jeu-s-n" name="n" maxlength="280" rows="2" placeholder="On reprend en 1131…"></textarea></div>`, 'Proposer', async (fd) => {
    const when = new Date(String(fd.get('d')));
    if (Number.isNaN(when.getTime())) return 'Choisis une date.';
    const { error } = await sb.rpc('hg_ludo_session_create', { p_slug: slug, p_starts: when.toISOString(), p_note: String(fd.get('n') || '').trim() || null });
    if (error) return errMsg(error);
    toast('Session proposée. Tu es inscrit·e d’office.', 'ok');
    await refresh();
    return null;
  });
}

function openPlayer() {
  const mine = S.players.find((p) => p.user_id === me.id);
  dialog(mine ? 'Ma participation' : 'Je joue aussi', `<div class="field"><label for="jeu-p-l">Niveau</label><select id="jeu-p-l" name="level">
      ${Object.entries(LEVEL).map(([k, [l]]) => `<option value="${k}" ${(mine?.level || 'parfois') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="field"><label for="jeu-p-r">Ton rôle (facultatif)</label><input id="jeu-p-r" name="role" maxlength="40" value="${esc(mine?.role_label || '')}" placeholder="jungle, duché de Bourgogne, ingénieur trains…"></div>`,
  'Enregistrer', async (fd, sub) => {
    if (sub?.dataset.quit != null) {
      const { error } = await sb.from('hg_ludo_players').delete().eq('game_slug', slug).eq('user_id', me.id);
      if (error) return errMsg(error);
      toast('Tu n’es plus dans la liste des joueurs.', 'ok');
    } else {
      const row = { game_slug: slug, user_id: me.id, level: String(fd.get('level')), role_label: String(fd.get('role') || '').trim() || null };
      const { error } = await sb.from('hg_ludo_players').upsert(row, { onConflict: 'game_slug,user_id' });
      if (error) return errMsg(error);
      toast('C’est noté.', 'ok');
    }
    await refresh();
    return null;
  }, mine ? '<button type="submit" class="btn btn-ghost" data-quit formnovalidate>Je ne joue plus</button>' : '');
}

function openRules() {
  dialog('Règles maison', `<p class="small muted">Markdown simple : **gras**, *italique*, lignes « - » pour une liste, [texte](https://…) pour un lien. Chaque version est gardée.</p>
    <div class="field"><label for="jeu-r">Règles</label><textarea id="jeu-r" name="r" rows="10" maxlength="8000">${esc(S.game.rules_md || '')}</textarea></div>`, 'Enregistrer', async (fd) => {
    const { error } = await sb.rpc('hg_ludo_rules_save', { p_slug: slug, p_rules: String(fd.get('r') || '') });
    if (error) return errMsg(error);
    toast('Règles enregistrées.', 'ok');
    await refresh();
    return null;
  });
}

/** Une ligne « Nom | valeur » par lien. */
const toLines = (arr, k) => (arr || []).map((l) => `${l.label} | ${l[k]}`).join('\n');
const fromLines = (txt, k) => String(txt || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
  const i = l.indexOf('|');
  return i < 0 ? { label: l, [k]: '' } : { label: l.slice(0, i).trim(), [k]: l.slice(i + 1).trim() };
});
function openLinks() {
  dialog('Liens du jeu', `<p class="small muted">Un lien par ligne : « Nom | https://… ». Seuls les sites connus sont acceptés (Discord, Steam, wikis, Codenames…).</p>
    <div class="field"><label for="jeu-l">Liens publics</label><textarea id="jeu-l" name="l" rows="4">${esc(toLines(S.game.links, 'url'))}</textarea></div>
    <div class="field"><label for="jeu-lp">Zone des joueurs (privé : « Nom | valeur »)</label><textarea id="jeu-lp" name="p" rows="3" placeholder="Serveur | mc.exemple.ch:25565">${esc(toLines(S.priv?.links, 'value'))}</textarea></div>`, 'Enregistrer', async (fd) => {
    const { error } = await sb.rpc('hg_ludo_links_save', { p_slug: slug, p_links: fromLines(fd.get('l'), 'url'), p_private: fromLines(fd.get('p'), 'value') });
    if (error) return errMsg(error);
    toast('Liens enregistrés.', 'ok');
    await refresh();
    return null;
  });
}

/* ---------- Événements ---------- */
root.addEventListener('click', async (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { S.tab = tab.dataset.tab; paint(); $(`#jeu-tab-${S.tab}`)?.focus(); return; }
  if (e.target.closest('[data-new-session]')) return openSession();
  if (e.target.closest('[data-player]')) return openPlayer();
  if (e.target.closest('[data-edit-rules]')) return openRules();
  if (e.target.closest('[data-edit-links]')) return openLinks();
  const card = e.target.closest('[data-sess]');
  if (!card) return;
  const sess = S.sessions.find((x) => x.id === card.dataset.sess);
  if (e.target.closest('[data-ics]')) {
    addToCalendar({ id: `jeu-${sess.id}`, title: `${S.game.name} · session du gang`, start: sess.starts_at, description: sess.note || null }, location.href);
    return;
  }
  if (e.target.closest('[data-cancel]')) {
    if (!(await confirmBox('Annuler cette session ?', 'Les inscrits ne la verront plus.', { ok: 'Annuler la session', danger: true }))) return;
    const { error } = await sb.rpc('hg_ludo_session_cancel', { p_id: sess.id });
    if (error) { toast(errMsg(error), 'error'); return; }
    toast('Session annulée.', 'ok'); await refresh(); return;
  }
  const rb = e.target.closest('[data-rsvp]');
  if (rb) {
    rb.disabled = true;
    const st = rb.dataset.rsvp;
    const q = st ? sb.from('hg_ludo_session_rsvps').upsert({ session_id: sess.id, user_id: me.id, status: st }, { onConflict: 'session_id,user_id' })
      : sb.from('hg_ludo_session_rsvps').delete().eq('session_id', sess.id).eq('user_id', me.id);
    const { error } = await q;
    if (error) { rb.disabled = false; toast(`Réponse non enregistrée : ${errMsg(error)}`, 'error'); return; }
    await refresh();
    root.querySelector(`[data-sess="${CSS.escape(sess.id)}"] [data-rsvp="${CSS.escape(st)}"]`)?.focus();
  }
});
// Onglets au clavier : flèches gauche / droite, Début, Fin
root.addEventListener('keydown', (e) => {
  if (!e.target.matches('[role="tab"]')) return;
  const keys = TABS.map(([k]) => k); let i = keys.indexOf(S.tab);
  if (e.key === 'ArrowRight') i = (i + 1) % keys.length; else if (e.key === 'ArrowLeft') i = (i - 1 + keys.length) % keys.length;
  else if (e.key === 'Home') i = 0; else if (e.key === 'End') i = keys.length - 1; else return;
  e.preventDefault(); S.tab = keys[i]; paint(); $(`#jeu-tab-${S.tab}`)?.focus();
});

/* ---------- Lancement ---------- */
try {
  await load();
  if (!S.game) root.innerHTML = '<p class="card ludo-empty">Ce jeu n’existe pas (ou plus). <a href="ludotheque.html">Voir tous les jeux</a></p>';
  else paint();
} catch (e) {
  root.innerHTML = `<p class="card ludo-empty">Impossible de charger le jeu (${esc(errMsg(e))}).</p>`;
}
$('#app').removeAttribute('aria-busy');
