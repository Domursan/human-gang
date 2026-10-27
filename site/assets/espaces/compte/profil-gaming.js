// ===== Humane Gang — profil gaming (idée P1, migration 090) =====
/*
 * Rôle : la carte « Profil gaming » de la page compte (saisie), le bloc « En jeu » de la fiche d'un membre (pseudos
 * copiables, jeu du moment, favoris) et le filtre « Qui joue à… » de l'annuaire « Le gang ».
 * Règles : tout est facultatif, un champ vide n'apparaît nulle part ; 40 caractères par pseudo, 60 pour le jeu du moment,
 * 3 favoris ; masquage global possible. Le transfert depuis « Informations diverses » (privées) est strictement manuel :
 * le bouton remplit les champs vides, le membre vérifie puis enregistre lui-même.
 * Dépendances : core.js, social.js (réglages, copie), icons.js.
 * RPC : hg_gaming_get, hg_gaming_save, hg_gaming_list ; table hg_profile_info (ma ligne seulement, lecture).
 * Exporte : mountGamingEditor, mountGamingBlock, mountWhoPlays, gamingFromInfo.
 */
import { sb, esc, toast, errMsg, avatarHtml } from '../../commun/core.js';
import { socialSettings, copyText } from './social.js';
import { svg } from '../../commun/icons.js';

const I = {
  pad: svg('dice', { size: 18, stroke: 1.8 }),
  copy: svg('copy', { size: 16, stroke: 2 }),
  eye: svg('eye', { size: 14, stroke: 2 }),
  play: svg('play', { size: 14, stroke: 2 }),
};
/** Couleur de pastille : hexadécimale à six chiffres, sinon gris. */
const dot = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : '#ABA7A0');
/** Correspondance des champs privés « Informations diverses » vers les plateformes du profil gaming. */
const INFO_MAP = { riot: 'riot', steam: 'steam', epic: 'epic', psn: 'psn', xbox: 'xbox', battlenet: 'battlenet', nintendo: 'switch' };

/**
 * Pseudos repris des informations privées, seulement pour les plateformes connues et les champs encore vides.
 * @param {object} info données privées (hg_profile_info.data)
 * @param {object} current pseudos déjà saisis (clé → valeur)
 * @param {Array<{key: string}>} platforms plateformes en vigueur
 * @returns {object} clé de plateforme → pseudo (40 caractères au plus)
 */
export function gamingFromInfo(info, current, platforms) {
  const keys = new Set(platforms.map((p) => p.key));
  const out = {};
  for (const [src, dst] of Object.entries(INFO_MAP)) {
    const v = String(info?.[src] ?? '').trim();
    if (v && keys.has(dst) && !String(current?.[dst] ?? '').trim()) out[dst] = v.slice(0, 40);
  }
  return out;
}

/* =========================================================
   Page compte : carte « Profil gaming »
   ========================================================= */
/**
 * Monte la carte de saisie du profil gaming dans el (page compte).
 * @param {HTMLElement} el conteneur (section vide)
 * @param {{id: string}} me membre connecté
 */
export async function mountGamingEditor(el, me) {
  if (!el) return;
  el.innerHTML = '<p class="muted small">Chargement du profil gaming…</p>';
  const cfg = await socialSettings();
  let g = null;
  try {
    const { data, error } = await sb.rpc('hg_gaming_get', { p_user: me.id });
    if (error) throw error;
    g = data;
  } catch (e) { el.innerHTML = `<p class="muted small">Profil gaming indisponible (${esc(errMsg(e))}).</p>`; return; }
  const acc = g?.accounts || {}, fav = new Set(g?.favorites || []);
  const plats = cfg.gaming.plateformes, games = cfg.gaming.jeux;
  el.innerHTML = `<form class="stack gm-form" id="gm-form" novalidate>
    <div class="gm-head">
      <h2 class="card-title" id="gaming-title">${I.pad} Profil gaming</h2>
      <span class="vis-tag vis-public">${I.eye}Public · membres du gang</span>
    </div>
    <p class="small muted">Tes pseudos en jeu s’affichent sur ta fiche avec un bouton « Copier », et dans l’annuaire « Qui joue à… ». Tout est facultatif : un champ vide n’apparaît nulle part.</p>
    <div class="gm-grid">${plats.map((p) => `
      <div class="field"><label for="gm-${esc(p.key)}"><span class="gm-dot" style="background:${esc(dot(p.color))}" aria-hidden="true"></span>${esc(p.label)}</label>
        <input id="gm-${esc(p.key)}" data-gm="${esc(p.key)}" maxlength="40" autocomplete="off" value="${esc(acc[p.key] || '')}"${p.placeholder ? ` placeholder="${esc(p.placeholder)}"` : ''}></div>`).join('')}
    </div>
    <div class="field"><label for="gm-now">Jeu du moment</label>
      <input id="gm-now" maxlength="60" placeholder="Ex. CK3 – campagne Serge" value="${esc(g?.now_playing || '')}"></div>
    <fieldset class="gm-favs"><legend>Mes trois jeux favoris</legend>
      <div class="gm-fav-list">${games.map((j, i) => `<label class="gm-fav"><input type="checkbox" data-fav="${esc(j.nom)}" id="gm-fav-${i}"${fav.has(j.nom) ? ' checked' : ''}><span>${esc(j.nom)}</span></label>`).join('')}</div>
      <p class="small muted" id="gm-fav-hint" aria-live="polite"></p>
    </fieldset>
    <label class="check"><input type="checkbox" id="gm-hidden"${g?.hidden ? ' checked' : ''}> <span>Ne pas afficher mon profil gaming</span></label>
    <div class="btn-row">
      <button class="btn btn-primary" type="submit">Enregistrer mon profil gaming</button>
      <button class="btn btn-ghost" type="button" id="gm-import">Reprendre mes pseudos de « Mes informations »</button>
    </div>
    <p class="small muted gm-note">Un pseudo en jeu peut permettre de te retrouver ailleurs : ne mets que ce que tu veux partager avec le gang.</p>
  </form>`;
  const form = el.querySelector('#gm-form');
  const favs = [...form.querySelectorAll('[data-fav]')];
  /** Au plus trois favoris : les autres cases se désactivent. */
  const syncFavs = () => {
    const n = favs.filter((c) => c.checked).length;
    favs.forEach((c) => { c.disabled = !c.checked && n >= 3; });
    form.querySelector('#gm-fav-hint').textContent = `${n} sur 3`;
  };
  favs.forEach((c) => c.addEventListener('change', syncFavs));
  syncFavs();
  if (location.hash === '#gaming') el.scrollIntoView({ block: 'start' }); // lien « Remplir mon profil gaming » de la fiche
  form.querySelector('#gm-import').addEventListener('click', async () => {
    try {
      const { data, error } = await sb.from('hg_profile_info').select('data').eq('user_id', me.id).maybeSingle();
      if (error) throw error;
      const cur = Object.fromEntries([...form.querySelectorAll('[data-gm]')].map((i) => [i.dataset.gm, i.value]));
      const found = gamingFromInfo(data?.data || {}, cur, plats);
      const n = Object.keys(found).length;
      for (const [k, v] of Object.entries(found)) { const i = form.querySelector(`[data-gm="${CSS.escape(k)}"]`); if (i) i.value = v; }
      toast(n ? `${n} pseudo${n > 1 ? 's' : ''} repris : vérifie puis enregistre.` : 'Rien à reprendre (champs déjà remplis ou absents).', n ? 'ok' : undefined);
    } catch (e) { toast(`Lecture impossible : ${errMsg(e)}`, 'error'); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const accounts = Object.fromEntries([...form.querySelectorAll('[data-gm]')].map((i) => [i.dataset.gm, i.value.trim()]));
      const { error } = await sb.rpc('hg_gaming_save', {
        p_accounts: accounts, p_now_playing: form.querySelector('#gm-now').value.trim() || null,
        p_favorites: favs.filter((c) => c.checked).map((c) => c.dataset.fav), p_hidden: form.querySelector('#gm-hidden').checked,
      });
      if (error) throw error;
      toast('Profil gaming enregistré.', 'ok');
    } catch (err) { toast(`Enregistrement impossible : ${errMsg(err)}`, 'error'); }
    finally { btn.disabled = false; }
  });
}

/* =========================================================
   Fiche d'un membre : bloc « En jeu »
   ========================================================= */
/**
 * Monte le bloc « En jeu » d'un membre (rien si le profil est vide, masqué ou absent ; invitation pour soi-même).
 * @param {HTMLElement} el conteneur (caché tant qu'il n'y a rien à montrer)
 * @param {string} userId membre affiché
 * @param {boolean} isMe vrai sur sa propre fiche
 */
export async function mountGamingBlock(el, userId, isMe) {
  if (!el) return;
  let g = null;
  const cfg = await socialSettings();
  try {
    const { data, error } = await sb.rpc('hg_gaming_get', { p_user: userId });
    if (error) throw error;
    g = data;
  } catch (e) { console.warn('[gaming]', e?.message || e); return; }
  const plats = cfg.gaming.plateformes;
  const rows = plats.filter((p) => String(g?.accounts?.[p.key] || '').trim());
  const favs = (g?.favorites || []).filter(Boolean);
  if (!g || (!rows.length && !g.now_playing && !favs.length) || (g.hidden && !isMe)) {
    if (isMe) {
      el.hidden = false;
      el.innerHTML = `<div class="card gm-block gm-empty"><p class="small muted">Ajoute tes pseudos en jeu (Riot, Steam, Switch…) pour que le gang puisse t’inviter en un clic.</p>
        <div class="btn-row"><a class="btn btn-ghost" href="/pages/compte/compte.html#gaming">Remplir mon profil gaming</a></div></div>`;
    }
    return;
  }
  el.hidden = false;
  el.innerHTML = `<section class="card gm-block" aria-labelledby="gm-block-title">
    <div class="gm-head"><h2 class="mb-section-title" id="gm-block-title">${I.pad} En jeu</h2>
      <span class="pill gm-public">${g.hidden ? 'Masqué : visible par toi seul' : 'Public · membres du gang'}</span></div>
    ${g.now_playing ? `<p class="gm-now">${I.play}<span>En ce moment : ${esc(g.now_playing)}</span></p>` : ''}
    ${favs.length ? `<p class="gm-favs-line"><span class="small muted">Favoris :</span>${favs.map((f) => `<span class="pill pill-current">${esc(f)}</span>`).join('')}</p>` : ''}
    ${rows.length ? `<ul class="gm-list">${rows.map((p) => `<li class="gm-row">
        <span class="gm-dot" style="background:${esc(dot(p.color))}" aria-hidden="true"></span>
        <span class="gm-row-txt"><span class="small muted">${esc(p.label)}</span><strong class="gm-val">${esc(g.accounts[p.key])}</strong></span>
        <button type="button" class="btn btn-ghost gm-copy" data-copy="${esc(g.accounts[p.key])}" aria-label="Copier ${esc(p.label)} : ${esc(g.accounts[p.key])}">${I.copy}<span>Copier</span></button>
      </li>`).join('')}</ul>` : ''}
  </section>`;
  el.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy, 'Pseudo copié')));
}

/* =========================================================
   Annuaire : « Qui joue à… »
   ========================================================= */
/**
 * Monte le filtre « Qui joue à… » (onglets par jeu favori, avec le nombre de joueurs) et la liste copiable.
 * @param {HTMLElement} el conteneur (caché tant que personne n'a de favori)
 */
export async function mountWhoPlays(el) {
  if (!el) return;
  const cfg = await socialSettings();
  let all = [];
  try {
    const { data, error } = await sb.rpc('hg_gaming_list', { p_game: null });
    if (error) throw error;
    all = data || [];
  } catch (e) { console.warn('[gaming] annuaire', e?.message || e); return; }
  const games = cfg.gaming.jeux.map((j) => ({ ...j, players: all.filter((m) => (m.favorites || []).includes(j.nom)) }))
    .filter((j) => j.players.length);
  if (!games.length) return;
  const plat = new Map(cfg.gaming.plateformes.map((p) => [p.key, p]));
  let cur = 0;
  el.hidden = false;
  el.innerHTML = `<section class="card gm-who" aria-labelledby="gm-who-title">
    <h3 class="gm-who-title" id="gm-who-title">Qui joue à…</h3>
    <div class="gm-tabs" role="tablist" aria-label="Jeux">${games.map((j, i) => `<button type="button" role="tab" class="gm-tab" id="gm-tab-${i}"
      aria-selected="${i === 0}" aria-controls="gm-panel" tabindex="${i === 0 ? 0 : -1}" data-i="${i}">${esc(j.nom)} · ${j.players.length}</button>`).join('')}</div>
    <div id="gm-panel" role="tabpanel" aria-labelledby="gm-tab-0" tabindex="0"></div>
  </section>`;
  const tabs = [...el.querySelectorAll('[role=tab]')];
  /** Affiche les joueurs du jeu i et met à jour les onglets. */
  const show = (i, focus = false) => {
    cur = i;
    tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === i)); t.tabIndex = k === i ? 0 : -1; });
    if (focus) tabs[i].focus();
    const j = games[i], p = j.plateforme ? plat.get(j.plateforme) : null;
    const panel = el.querySelector('#gm-panel');
    panel.setAttribute('aria-labelledby', `gm-tab-${i}`);
    const line = (m) => (p && m.game_account ? `${m.pseudo} : ${m.game_account}` : m.pseudo);
    const accountOf = (m) => (p ? m.accounts?.[p.key] : '') || '';
    panel.innerHTML = `<ul class="gm-players">${j.players.map((m) => `<li class="gm-player">
        <a class="gm-player-link" href="/pages/compte/membre.html?id=${encodeURIComponent(m.user_id)}">${avatarHtml({ id: m.user_id, pseudo: m.pseudo, avatar_url: m.avatar_url, color: m.color }, 32)}<strong>${esc(m.pseudo)}</strong></a>
        ${accountOf(m) ? `<span class="gm-player-acc small"><span class="muted">${esc(p.label)}</span> ${esc(accountOf(m))}</span>
          <button type="button" class="btn btn-ghost gm-copy" data-copy="${esc(accountOf(m))}" aria-label="Copier ${esc(p.label)} de ${esc(m.pseudo)}">${I.copy}<span>Copier</span></button>` : ''}
      </li>`).join('')}</ul>
      <div class="btn-row"><button type="button" class="btn btn-sand" id="gm-copy-all">${I.copy}<span>Tout copier</span></button></div>`;
    panel.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy, 'Pseudo copié')));
    panel.querySelector('#gm-copy-all').addEventListener('click', () => {
      j.players.forEach((m) => { m.game_account = accountOf(m); });
      const n = j.players.length;
      copyText(j.players.map(line).join('\n'), `${n} joueur${n > 1 ? 's' : ''} copié${n > 1 ? 's' : ''}`);
    });
  };
  tabs.forEach((t) => {
    t.addEventListener('click', () => show(Number(t.dataset.i)));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (e.key === 'Home') { e.preventDefault(); show(0, true); }
      else if (e.key === 'End') { e.preventDefault(); show(tabs.length - 1, true); }
      else if (d) { e.preventDefault(); show((cur + d + tabs.length) % tabs.length, true); }
    });
  });
  show(0);
}
