// ===== Mon compte : connexion, inscription, profil, informations diverses, badges, données =====
import { sb, initPage, getProfile, esc, $, $$, toast, errMsg, fmtDate, fmtDateTime, avatarHtml, updateHeaderProfile } from './core.js';
import { INFO_GROUPS, INFO_FIELDS } from './profile-fields.js';
import { mountPushBlock } from './push.js';
import { hasLevels, sortedLevels, levelDef, nextLevelDef, levelImage, levelLabel, levelPipsHtml, metricCount, roman, METRIC_LABEL } from './badge-levels.js';

/* ---------- Indices lus AVANT que le client Supabase ne nettoie l'URL ---------- */
const url = new URL(location.href);
const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
const isRecoveryLink = hashParams.get('type') === 'recovery' || url.searchParams.get('recovery') === '1';
const linkError = hashParams.get('error_description') || url.searchParams.get('error_description');
const rawNext = url.searchParams.get('next') || '';
const NEXT = /^[\w-]+\.html(#[\w-]*)?$/.test(rawNext) ? rawNext : '';
const PENDING_KEY = 'hg_pending_join';
const PAGE_URL = new URL('compte.html', location.href).href;
// Code d'invitation reçu via un lien (rejoindre.html) : ?code=HG-XXXXXX ou sessionStorage
const INVITE_KEY = 'hg_invite_code';
const INVITE = (() => {
  const ok = (c) => (/^HG-[A-Z0-9]{4,8}$/.test(c) ? c : '');
  const fromUrl = ok(String(url.searchParams.get('code') || '').trim().toUpperCase());
  if (fromUrl) { try { sessionStorage.setItem(INVITE_KEY, fromUrl); } catch {} return fromUrl; }
  try { return ok(String(sessionStorage.getItem(INVITE_KEY) || '').toUpperCase()); } catch { return ''; }
})();
function clearInvite() { try { sessionStorage.removeItem(INVITE_KEY); sessionStorage.removeItem('hg_invite_link'); } catch {} }

let recoveryShown = false;
sb.auth.onAuthStateChange((event) => {
  if (event === 'PASSWORD_RECOVERY' && !recoveryShown) setTimeout(renderRecovery, 0);
});

const app = $('#app');
let me = await initPage({ auth: 'optional' });

/* ---------- Petites aides ---------- */
const svg = (d, s = 20) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', 18),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', 18),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>', 28),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>', 18),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', 18),
  out: svg('<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>', 18),
  info: svg('<path d="M4 7h16M4 12h16M4 17h10"/><circle cx="19" cy="17" r="2"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 16),
  badge: svg('<circle cx="12" cy="9" r="6"/><path d="M8.5 14 7 22l5-3 5 3-1.5-8"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  data: svg('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>'),
};
const tagPublic = '<span class="vis-tag vis-public">' + ICON.eye + 'Visible par le gang</span>';
const tagPrivate = '<span class="vis-tag vis-private">' + ICON.lock + 'Toi et l\'admin</span>';

function authMsg(e) {
  const m = errMsg(e);
  const map = [
    [/invalid login credentials/i, 'E-mail ou mot de passe incorrect.'],
    [/email not confirmed/i, 'Confirme d\'abord ton adresse e-mail grâce au lien reçu par e-mail.'],
    [/user already registered|already been registered/i, 'Un compte existe déjà avec cet e-mail. Connecte-toi.'],
    [/password should be at least|weak password|password is too weak/i, 'Mot de passe trop faible : au moins 8 caractères.'],
    [/same.*password|different from the old/i, 'Le nouveau mot de passe doit être différent de l\'ancien.'],
    [/rate limit|security purposes|too many/i, 'Trop de tentatives. Réessaie dans quelques minutes.'],
    [/unable to validate email|invalid.*email/i, 'Adresse e-mail invalide.'],
    [/hg_profiles_pseudo_key|duplicate key.*pseudo/i, 'Ce pseudo est déjà pris.'],
    [/char_length\(pseudo\)|hg_profiles_pseudo_check/i, 'Le pseudo doit faire entre 2 et 32 caractères.'],
    [/failed to fetch|network/i, 'Connexion au serveur impossible. Vérifie ta connexion internet.'],
    [/auth session missing/i, 'Session expirée. Recommence depuis le lien reçu par e-mail.'],
  ];
  for (const [re, txt] of map) if (re.test(m)) return txt;
  return m;
}
function busy(btn, on, label) {
  if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = label || 'Un instant…'; }
  else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; }
}
function formError(form, msg) {
  let box = form.querySelector('.form-error');
  if (!box) { box = document.createElement('p'); box.className = 'form-error'; box.setAttribute('role', 'alert'); form.prepend(box); }
  box.textContent = msg; box.hidden = !msg;
}
function pendingGet() { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; } }
function pendingSet(v) { try { v ? localStorage.setItem(PENDING_KEY, JSON.stringify(v)) : localStorage.removeItem(PENDING_KEY); } catch {} }
function goAfterAuth() { location.replace(NEXT || 'accueil.html'); }
function done() { app.removeAttribute('aria-busy'); }

/* ======================================================================
   Lien d'e-mail invalide / expiré
   ====================================================================== */
function renderLinkError() {
  app.innerHTML = `
    <section class="acc-narrow">
      <div class="page-head"><div><p class="eyebrow">Mon compte</p><h1 class="page-title">Lien expiré</h1></div></div>
      <div class="card stack">
        <p>Ce lien n'est plus valable (${esc(linkError)}). Les liens envoyés par e-mail ne fonctionnent qu'une fois et pendant une durée limitée.</p>
        <div class="btn-row"><a class="btn btn-primary" href="compte.html">Revenir à la connexion</a></div>
      </div>
    </section>`;
  history.replaceState(null, '', 'compte.html');
  done();
}

/* ======================================================================
   Nouveau mot de passe (lien « mot de passe oublié »)
   ====================================================================== */
function renderRecovery() {
  recoveryShown = true;
  app.innerHTML = `
    <section class="acc-narrow">
      <div class="page-head"><div><p class="eyebrow">Mon compte</p><h1 class="page-title">Nouveau mot de passe</h1></div></div>
      <form class="card stack" id="recovery-form" novalidate>
        <p class="muted">Choisis un nouveau mot de passe pour ton compte.</p>
        <div class="field"><label for="rp1">Nouveau mot de passe</label><input id="rp1" type="password" autocomplete="new-password" minlength="8" required></div>
        <div class="field"><label for="rp2">Confirme le mot de passe</label><input id="rp2" type="password" autocomplete="new-password" minlength="8" required></div>
        <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer</button></div>
      </form>
    </section>`;
  done();
  const form = $('#recovery-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1 = $('#rp1').value, p2 = $('#rp2').value;
    if (p1.length < 8) return formError(form, 'Au moins 8 caractères.');
    if (p1 !== p2) return formError(form, 'Les deux mots de passe ne correspondent pas.');
    const btn = form.querySelector('button[type=submit]');
    busy(btn, true); formError(form, '');
    const { error } = await sb.auth.updateUser({ password: p1 });
    busy(btn, false);
    if (error) return formError(form, authMsg(error));
    toast('Mot de passe modifié.', 'ok');
    setTimeout(() => location.replace('compte.html'), 900);
  });
  $('#rp1').focus();
}

/* ======================================================================
   Visiteur : connexion / inscription / mot de passe oublié
   ====================================================================== */
function renderGuest(initialTab = 'login') {
  app.innerHTML = `
    <section class="acc-narrow">
      <div class="page-head"><div><p class="eyebrow">Humane Gang</p><h1 class="page-title">Mon compte</h1></div></div>
      <div class="card acc-auth">
        <div class="tabs" role="tablist" aria-label="Connexion ou inscription">
          <button class="tab" role="tab" id="tab-login" aria-controls="pane-login" type="button">Se connecter</button>
          <button class="tab" role="tab" id="tab-signup" aria-controls="pane-signup" type="button">Rejoindre le gang</button>
        </div>

        <form class="stack tab-pane" id="pane-login" role="tabpanel" aria-labelledby="tab-login" novalidate>
          <div class="field"><label for="li-email">E-mail</label><input id="li-email" type="email" autocomplete="email" required inputmode="email"></div>
          <div class="field"><label for="li-pass">Mot de passe</label><input id="li-pass" type="password" autocomplete="current-password" required></div>
          <div class="btn-row acc-actions">
            <button class="btn btn-primary" type="submit">Se connecter</button>
            <button class="btn btn-ghost" type="button" id="to-forgot">Mot de passe oublié ?</button>
          </div>
        </form>

        <form class="stack tab-pane" id="pane-signup" role="tabpanel" aria-labelledby="tab-signup" novalidate hidden>
          <p class="small muted">Il te faut un code d'invitation (format HG-XXXX) donné par un membre du gang.</p>
          <div class="field"><label for="su-code">Code d'invitation</label><input id="su-code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="HG-XXXX" required></div>
          <div class="field"><label for="su-pseudo">Pseudo <span class="small">(2 à 32 caractères, visible par le gang)</span></label><input id="su-pseudo" autocomplete="nickname" minlength="2" maxlength="32" required></div>
          <div class="field"><label for="su-email">E-mail <span class="small">(privé)</span></label><input id="su-email" type="email" autocomplete="email" inputmode="email" required></div>
          <div class="field"><label for="su-pass">Mot de passe <span class="small">(au moins 8 caractères)</span></label><input id="su-pass" type="password" autocomplete="new-password" minlength="8" required></div>
          <label class="check"><input type="checkbox" id="su-privacy" required> <span>J'ai lu et j'accepte la <a href="legal.html#confidentialite" target="_blank" rel="noopener">politique de confidentialité</a>.</span></label>
          <div class="btn-row acc-actions"><button class="btn btn-primary" type="submit">Créer mon compte</button></div>
        </form>

        <form class="stack tab-pane" id="pane-forgot" novalidate hidden>
          <h2>Mot de passe oublié</h2>
          <p class="small muted">Indique ton e-mail : tu recevras un lien pour choisir un nouveau mot de passe.</p>
          <div class="field"><label for="fg-email">E-mail</label><input id="fg-email" type="email" autocomplete="email" inputmode="email" required></div>
          <div class="btn-row acc-actions">
            <button class="btn btn-primary" type="submit">Envoyer le lien</button>
            <button class="btn btn-ghost" type="button" id="back-login">Retour</button>
          </div>
        </form>
      </div>
      <p class="small muted acc-foot">Un souci pour te connecter ? <a href="assistance.html">Contacte l'assistance</a>.</p>
    </section>`;
  done();

  const panes = { login: $('#pane-login'), signup: $('#pane-signup'), forgot: $('#pane-forgot') };
  const tabs = { login: $('#tab-login'), signup: $('#tab-signup') };
  function show(name, focus = true) {
    for (const [k, p] of Object.entries(panes)) p.hidden = k !== name;
    for (const [k, t] of Object.entries(tabs)) { const on = k === name || (name === 'forgot' && k === 'login'); t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; }
    if (focus) panes[name].querySelector('input')?.focus();
  }
  tabs.login.addEventListener('click', () => show('login'));
  tabs.signup.addEventListener('click', () => show('signup'));
  $('.tabs').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const next = tabs.login.getAttribute('aria-selected') === 'true' ? 'signup' : 'login'; show(next, false); tabs[next].focus(); }
  });
  $('#to-forgot').addEventListener('click', () => { $('#fg-email').value = $('#li-email').value; show('forgot'); });
  $('#back-login').addEventListener('click', () => show('login'));
  show(initialTab, false);
  if (INVITE) {
    $('#su-code').value = INVITE;
    const hint = document.createElement('p');
    hint.className = 'small muted'; hint.id = 'su-code-hint';
    hint.textContent = 'Code reçu grâce à ton lien d\'invitation : valable 48 h, pour un seul compte.';
    $('#su-code').closest('.field').append(hint);
    $('#su-code').setAttribute('aria-describedby', 'su-code-hint');
    if (initialTab === 'signup') $('#su-pseudo')?.focus();
  }

  // Connexion
  panes.login.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = panes.login, email = $('#li-email').value.trim(), password = $('#li-pass').value;
    if (!email || !password) return formError(form, 'Renseigne ton e-mail et ton mot de passe.');
    const btn = form.querySelector('button[type=submit]');
    busy(btn, true, 'Connexion…'); formError(form, '');
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) { busy(btn, false); return formError(form, authMsg(error)); }
    await afterLogin();
  });

  // Inscription
  panes.signup.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = panes.signup;
    const code = $('#su-code').value.trim().toUpperCase(), pseudo = $('#su-pseudo').value.trim();
    const email = $('#su-email').value.trim(), password = $('#su-pass').value;
    if (!code) return formError(form, 'Le code d\'invitation est obligatoire.');
    if (pseudo.length < 2 || pseudo.length > 32) return formError(form, 'Le pseudo doit faire entre 2 et 32 caractères.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return formError(form, 'Adresse e-mail invalide.');
    if (password.length < 8) return formError(form, 'Mot de passe : au moins 8 caractères.');
    if (!$('#su-privacy').checked) return formError(form, 'Tu dois accepter la politique de confidentialité.');
    const btn = form.querySelector('button[type=submit]');
    busy(btn, true, 'Création…'); formError(form, '');
    pendingSet({ code, pseudo, at: Date.now() });
    const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: PAGE_URL + (NEXT ? `?next=${encodeURIComponent(NEXT)}` : '') } });
    if (error) { busy(btn, false); pendingSet(null); return formError(form, authMsg(error)); }
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      busy(btn, false); pendingSet(null);
      return formError(form, 'Un compte existe déjà avec cet e-mail. Connecte-toi (ou utilise « Mot de passe oublié »).');
    }
    if (data.session) { await afterLogin(); return; }
    renderCheckMail(email);
  });

  // Mot de passe oublié
  panes.forgot.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = panes.forgot, email = $('#fg-email').value.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) return formError(form, 'Adresse e-mail invalide.');
    const btn = form.querySelector('button[type=submit]');
    busy(btn, true, 'Envoi…'); formError(form, '');
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${PAGE_URL}?recovery=1` });
    busy(btn, false);
    if (error) return formError(form, authMsg(error));
    form.innerHTML = `<h2>Vérifie ta boîte mail</h2><p>Si un compte existe pour <strong>${esc(email)}</strong>, un lien pour choisir un nouveau mot de passe vient d'être envoyé. Pense à regarder dans les indésirables.</p>
      <div class="btn-row"><a class="btn btn-ghost" href="compte.html">Retour à la connexion</a></div>`;
  });
}

function renderCheckMail(email) {
  app.innerHTML = `
    <section class="acc-narrow">
      <div class="page-head"><div><p class="eyebrow">Presque fini</p><h1 class="page-title">Vérifie tes e-mails</h1></div></div>
      <div class="card stack acc-mail">
        <span class="acc-mail-icon">${ICON.mail}</span>
        <p>Un lien de confirmation a été envoyé à <strong>${esc(email)}</strong>. Clique dessus pour activer ton compte : ton code d'invitation et ton pseudo seront appliqués automatiquement à ta première connexion sur cet appareil.</p>
        <p class="small muted">Rien reçu ? Regarde dans les indésirables, ou <a href="assistance.html">contacte l'assistance</a>.</p>
      </div>
    </section>`;
}

/** Après une connexion réussie : appliquer un code en attente, puis rediriger. */
async function afterLogin() {
  try { me = await getProfile(true); }
  catch { // réseau : la session est ouverte, on recharge la page (elle proposera de réessayer)
    location.replace(`compte.html${NEXT ? `?next=${encodeURIComponent(NEXT)}` : ''}`);
    return;
  }
  if (!me) {
    const pend = pendingGet();
    if (pend?.code && pend?.pseudo) {
      const { error } = await sb.rpc('hg_join', { p_code: pend.code, p_pseudo: pend.pseudo });
      if (!error) { pendingSet(null); clearInvite(); toast('Bienvenue dans le gang !', 'ok'); setTimeout(goAfterAuth, 500); return; }
      location.replace(`compte.html?joinerr=${encodeURIComponent(authMsg(error))}${NEXT ? `&next=${encodeURIComponent(NEXT)}` : ''}`);
      return;
    }
    location.replace(`compte.html${NEXT ? `?next=${encodeURIComponent(NEXT)}` : ''}`);
    return;
  }
  goAfterAuth();
}

/* ======================================================================
   Connecté sans profil : saisir le code d'invitation
   ====================================================================== */
function renderJoin(prefill = {}, error = '') {
  app.innerHTML = `
    <section class="acc-narrow">
      <div class="page-head"><div><p class="eyebrow">Dernière étape</p><h1 class="page-title">Rejoindre le gang</h1></div></div>
      <form class="card stack" id="join-form" novalidate>
        <p>Ton compte est créé. Entre le code d'invitation reçu d'un membre et choisis ton pseudo.</p>
        <div class="field"><label for="jn-code">Code d'invitation</label><input id="jn-code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="HG-XXXX" required value="${esc(prefill.code || '')}"></div>
        <div class="field"><label for="jn-pseudo">Pseudo <span class="small">(2 à 32 caractères, visible par le gang)</span></label><input id="jn-pseudo" autocomplete="nickname" minlength="2" maxlength="32" required value="${esc(prefill.pseudo || '')}"></div>
        <label class="check"><input type="checkbox" id="jn-privacy" required> <span>J'ai lu et j'accepte la <a href="legal.html#confidentialite" target="_blank" rel="noopener">politique de confidentialité</a>.</span></label>
        <div class="btn-row">
          <button class="btn btn-primary" type="submit">Rejoindre</button>
          <button class="btn btn-ghost" type="button" id="jn-logout">Se déconnecter</button>
        </div>
      </form>
    </section>`;
  done();
  const form = $('#join-form');
  if (error) formError(form, error);
  $('#jn-logout').addEventListener('click', logout);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('#jn-code').value.trim().toUpperCase(), pseudo = $('#jn-pseudo').value.trim();
    if (!code) return formError(form, 'Le code d\'invitation est obligatoire.');
    if (pseudo.length < 2 || pseudo.length > 32) return formError(form, 'Le pseudo doit faire entre 2 et 32 caractères.');
    if (!$('#jn-privacy').checked) return formError(form, 'Tu dois accepter la politique de confidentialité.');
    const btn = form.querySelector('button[type=submit]');
    busy(btn, true); formError(form, '');
    const { error: err } = await sb.rpc('hg_join', { p_code: code, p_pseudo: pseudo });
    busy(btn, false);
    if (err) return formError(form, authMsg(err));
    pendingSet(null);
    clearInvite(); toast('Bienvenue dans le gang !', 'ok');
    setTimeout(goAfterAuth, 500);
  });
}

async function logout() {
  await sb.auth.signOut().catch(() => {});
  location.replace('accueil.html');
}

/* ======================================================================
   Membre : tableau de bord du compte
   ====================================================================== */
async function renderMember(user) {
  const p = me;
  app.innerHTML = `
    <section class="page-head acc-head">
      <div class="acc-id">
        <span id="head-avatar">${avatarHtml(p, 72)}</span>
        <div><p class="eyebrow">Mon compte</p><h1 class="page-title" id="head-pseudo">${esc(p.pseudo)}</h1></div>
      </div>
      <div class="btn-row acc-head-actions">
        <a class="btn btn-sand" href="membre.html">${ICON.badge} Voir ma carte d'identité</a>
        <button class="btn btn-ghost" type="button" id="logout">${ICON.out} Se déconnecter</button>
      </div>
    </section>

    <div class="privacy-note" role="note">
      ${ICON.lock}
      <p><strong>Tes infos sont visibles par toi et l'admin</strong> (qui peut aussi les consulter et les corriger pour la gestion du site). Les autres membres ne voient que celles marquées « Visible par le gang » : pseudo, avatar, couleur et, si tu choisis de le partager, le jour et le mois de ton anniversaire (jamais l'année). Ta liste de souhaits Secret Santa est visible par ton Santa et l'admin.</p>
    </div>

    <section class="row acc-row">
      <form class="card stack" id="profile-form" novalidate>
        <h2 class="card-title">${ICON.user} Profil</h2>
        <div class="field">
          <label for="pf-pseudo">Pseudo ${tagPublic}</label>
          <input id="pf-pseudo" minlength="2" maxlength="32" required value="${esc(p.pseudo)}">
        </div>
        <div class="field">
          <label for="pf-color">Couleur ${tagPublic}</label>
          <div class="color-row">
            <input id="pf-color" type="color" value="${esc(/^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#9E3543')}">
            <div class="swatches" role="group" aria-label="Couleurs suggérées">
              ${['#9E3543', '#CF7055', '#D8A75E', '#6FA37F', '#7E93C9', '#9A88C4', '#E0909A', '#5B5B63'].map((c) => `<button type="button" class="swatch" data-c="${c}" style="background:${c}" aria-label="Couleur ${c}"></button>`).join('')}
            </div>
          </div>
        </div>
        <div class="field">
          <label for="pf-birthday">Date d'anniversaire ${tagPrivate}</label>
          <input id="pf-birthday" type="date" value="${esc(p.birthday || '')}" max="${new Date().toISOString().slice(0, 10)}">
        </div>
        <label class="check"><input type="checkbox" id="pf-share" ${p.share_birthday ? 'checked' : ''}> <span>Partager le jour et le mois de mon anniversaire avec le gang (accueil, bot) ${tagPublic}</span></label>
        <div class="field">
          <label for="pf-discord">ID Discord ${tagPrivate}</label>
          <input id="pf-discord" inputmode="numeric" pattern="\\d{15,21}" maxlength="21" value="${esc(p.discord_id || '')}" placeholder="ex. 123456789012345678">
          <p class="small muted hint">Sert uniquement au bot pour t'envoyer des messages privés. Discord : Paramètres &gt; Avancés &gt; Mode développeur, puis clic droit sur ton profil &gt; « Copier l'identifiant ».</p>
        </div>
        <label class="check"><input type="checkbox" id="pf-bot" ${p.bot_optin ? 'checked' : ''}> <span>Recevoir les messages du bot Discord (tirage, cadeaux, sorties, rappels)</span></label>
        <label class="check"><input type="checkbox" id="pf-remind-irl" ${p.remind_irl ? 'checked' : ''}> <span>Me rappeler mes sorties IRL par message Discord, 24 h et 2 h avant</span></label>
        <label class="check"><input type="checkbox" id="pf-notify-wish" ${p.notify_card_wish ? 'checked' : ''}> <span>M'avertir sur Discord quand une carte de ma liste de souhaits est obtenue par un membre</span></label>
        <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer</button></div>
      </form>

      <div class="stack acc-side">
        <div class="card stack">
          <h2 class="card-title">Avatar ${tagPublic}</h2>
          <div class="avatar-edit">
            <span id="av-preview">${avatarHtml(p, 96)}</span>
            <div class="stack">
              <label class="btn btn-ghost file-btn">
                <input type="file" id="av-file" accept="image/jpeg,image/png,image/webp" class="visually-hidden">
                Changer l'avatar
              </label>
              <button class="btn btn-ghost" type="button" id="av-remove" ${p.avatar_url ? '' : 'hidden'}>Retirer</button>
            </div>
          </div>
          <p class="small muted">JPG, PNG ou WebP. L'image est recadrée en carré et réduite automatiquement.</p>
        </div>

        <form class="card stack" id="pw-form" novalidate>
          <h2 class="card-title">${ICON.lock} Connexion</h2>
          <p class="small muted">E-mail du compte ${tagPrivate}<br><strong class="acc-email">${esc(user?.email || '')}</strong></p>
          <div class="field"><label for="pw-new">Nouveau mot de passe</label><input id="pw-new" type="password" autocomplete="new-password" minlength="8"></div>
          <div class="btn-row"><button class="btn btn-ghost" type="submit">Changer le mot de passe</button></div>
        </form>
      </div>
    </section>

    <section class="card acc-infos" id="infos" aria-labelledby="infos-title">
      <form id="info-form" novalidate>
        <div class="acc-infos-head">
          <h2 class="card-title" id="infos-title">${ICON.info} Informations diverses ${tagPrivate}</h2>
          <p class="small muted">Adresse, tailles, goûts… pour aider ton Santa à viser juste. Tout est facultatif.</p>
        </div>
        <div class="privacy-note info-note" role="note">
          ${ICON.lock}
          <p>Ces informations sont visibles uniquement par toi et l'admin. Pour chaque Secret Santa, l'admin choisit lesquelles sont transmises à ton Santa.</p>
        </div>
        <div class="info-groups" id="info-groups" aria-busy="true">${INFO_GROUPS.map((g, i) => `
          <details class="info-group" data-group="${esc(g.id)}"${i === 0 ? ' open' : ''}>
            <summary><span class="info-group-name">${esc(g.label)}</span><span class="info-group-count small muted" data-count="${esc(g.id)}"></span></summary>
            <div class="info-fields">${g.fields.map((f) => {
              const id = `inf-${f.id}`, ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
              const input = f.type === 'textarea'
                ? `<textarea id="${id}" data-key="${esc(f.id)}" rows="3" maxlength="1000"${ph}></textarea>`
                : `<input id="${id}" data-key="${esc(f.id)}" maxlength="300"${ph}>`;
              return `<div class="field${f.type === 'textarea' ? ' field-wide' : ''}"><label for="${id}">${esc(f.label)}</label>${input}</div>`;
            }).join('')}</div>
          </details>`).join('')}
        </div>
        <div class="info-actions">
          <button class="btn btn-primary" type="submit">Enregistrer mes informations</button>
          <span class="info-status small" id="info-status" role="status" aria-live="polite"></span>
        </div>
      </form>
    </section>

    <section class="card acc-badges">
      <div class="acc-badges-head">
        <h2 class="card-title">${ICON.badge} Badges</h2>
        <span class="pill" id="badge-count">…</span>
      </div>
      <ul class="badge-grid" id="badge-grid" aria-live="polite"></ul>
    </section>

    <section class="acc-row">
      <div class="card stack" id="data-card">
        <h2 class="card-title">${ICON.data} Mes données</h2>
        <p class="small muted">Tu peux récupérer à tout moment une copie de toutes les données liées à ton compte (format JSON), ou supprimer ton compte. Une idée pour le gang ? La <a href="accueil.html#idees">boîte à idées</a> est sur l'accueil. <a href="legal.html#droits">Tes droits</a></p>
        <div class="btn-row">
          <button class="btn btn-ghost" type="button" id="export">${ICON.download} Exporter mes données</button>
          <button class="btn btn-danger" type="button" id="delete">${ICON.trash} Supprimer mon compte</button>
        </div>
      </div>
    </section>
    <section class="acc-row">
      <div id="push-slot" hidden></div>
    </section>`;
  done();

  $('#logout').addEventListener('click', logout);
  mountPushBlock($('#push-slot'), me);
  bindProfile();
  bindAvatar();
  bindPassword();
  bindData();
  bindInfos();
  loadBadges();
}

function refreshIdentity() {
  $('#head-avatar').innerHTML = avatarHtml(me, 72);
  $('#av-preview').innerHTML = avatarHtml(me, 96);
  $('#head-pseudo').textContent = me.pseudo;
  updateHeaderProfile(me);
  $('#av-remove').hidden = !me.avatar_url;
}

/* ---------- Profil ---------- */
function bindProfile() {
  const form = $('#profile-form');
  $$('.swatch', form).forEach((b) => b.addEventListener('click', () => { $('#pf-color').value = b.dataset.c; }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pseudo = $('#pf-pseudo').value.trim();
    const discord = $('#pf-discord').value.replace(/\s/g, '');
    if (pseudo.length < 2 || pseudo.length > 32) return formError(form, 'Le pseudo doit faire entre 2 et 32 caractères.');
    if (discord && !/^\d{15,21}$/.test(discord)) return formError(form, 'L\'ID Discord est un nombre de 15 à 21 chiffres (pas ton nom d\'utilisateur).');
    const patch = {
      pseudo,
      color: $('#pf-color').value,
      birthday: $('#pf-birthday').value || null,
      share_birthday: $('#pf-share').checked,
      discord_id: discord || null,
      bot_optin: $('#pf-bot').checked,
      remind_irl: $('#pf-remind-irl').checked,
      notify_card_wish: $('#pf-notify-wish').checked,
    };
    const btn = form.querySelector('button[type=submit]');
    busy(btn, true, 'Enregistrement…'); formError(form, '');
    const { data, error } = await sb.from('hg_profiles').update(patch).eq('id', me.id).select().single();
    busy(btn, false);
    if (error) return formError(form, authMsg(error));
    me = data;
    refreshIdentity();
    toast('Profil enregistré.', 'ok');
  });
}

/* ---------- Avatar ---------- */
function squareResize(file, size = 384) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const src = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement('canvas'); c.width = c.height = Math.min(size, s);
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, c.width, c.height);
      URL.revokeObjectURL(src);
      c.toBlob((b) => {
        if (b && b.type === 'image/webp') return resolve(b);
        c.toBlob((j) => (j ? resolve(j) : reject(new Error('Image illisible'))), 'image/jpeg', 0.88);
      }, 'image/webp', 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('Image illisible')); };
    img.src = src;
  });
}
const AVATAR_EXTS = ['webp', 'jpg', 'png'];
function bindAvatar() {
  const input = $('#av-file'), label = input.closest('label');
  input.addEventListener('change', async () => {
    const file = input.files?.[0]; input.value = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast('Format non pris en charge (JPG, PNG ou WebP).', 'error');
    if (file.size > 15 * 1024 * 1024) return toast('Image trop lourde (15 Mo max avant réduction).', 'error');
    label.classList.add('is-busy');
    try {
      const blob = await squareResize(file);
      const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
      const path = `${me.id}/avatar.${ext}`;
      const { error: upErr } = await sb.storage.from('hg-avatars').upload(path, blob, { upsert: true, contentType: blob.type, cacheControl: '3600' });
      if (upErr) throw upErr;
      // Nettoyer les anciennes extensions éventuelles (sans bloquer)
      sb.storage.from('hg-avatars').remove(AVATAR_EXTS.filter((x) => x !== ext).map((x) => `${me.id}/avatar.${x}`)).catch(() => {});
      const { data: pub } = sb.storage.from('hg-avatars').getPublicUrl(path);
      const avatar_url = `${pub.publicUrl}?v=${Date.now()}`;
      const { data, error } = await sb.from('hg_profiles').update({ avatar_url }).eq('id', me.id).select().single();
      if (error) throw error;
      me = data; refreshIdentity();
      toast('Avatar mis à jour.', 'ok');
    } catch (e) { toast(`Envoi impossible : ${authMsg(e)}`, 'error'); }
    label.classList.remove('is-busy');
  });
  $('#av-remove').addEventListener('click', async () => {
    try {
      await sb.storage.from('hg-avatars').remove(AVATAR_EXTS.map((x) => `${me.id}/avatar.${x}`));
      const { data, error } = await sb.from('hg_profiles').update({ avatar_url: null }).eq('id', me.id).select().single();
      if (error) throw error;
      me = data; refreshIdentity();
      toast('Avatar retiré.', 'ok');
    } catch (e) { toast(authMsg(e), 'error'); }
  });
}

/* ---------- Mot de passe ---------- */
function bindPassword() {
  const form = $('#pw-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#pw-new').value;
    if (pw.length < 8) return formError(form, 'Au moins 8 caractères.');
    const btn = form.querySelector('button[type=submit]');
    busy(btn, true); formError(form, '');
    const { error } = await sb.auth.updateUser({ password: pw });
    busy(btn, false);
    if (error) return formError(form, authMsg(error));
    $('#pw-new').value = '';
    toast('Mot de passe modifié.', 'ok');
  });
}

/* ---------- Badges ---------- */
const BADGE_TINTS = ['var(--ss-fg)', 'var(--irl-fg)', 'var(--hist-fg)', 'var(--sage-text)', 'var(--plum)', 'var(--rust)'];
function badgeInitials(name) {
  const w = String(name).replace(/[^\p{L}\s-]/gu, '').split(/[\s-]+/).filter((x) => x.length > 2 || /^\p{Lu}/u.test(x));
  return ((w[0]?.[0] || '') + (w[1]?.[0] || w[0]?.[1] || '')).toUpperCase();
}
/** Valeur de mes compteurs pour les badges à niveaux : Map code → valeur (rpc 014, sinon calcul partiel côté client). */
async function loadBadgeProgress(badges) {
  const out = new Map();
  const lv = badges.filter(hasLevels);
  if (!lv.length) return out;
  try {
    const { data, error } = await sb.rpc('hg_my_badge_progress');
    if (error) throw error;
    for (const r of data || []) out.set(r.badge_code, Number(r.value) || 0);
    return out;
  } catch { /* migration 014 pas encore appliquée : calcul partiel */ }
  try {
    const since = new Date(me.joined_on || me.created_at || Date.now());
    const years = Math.floor((Date.now() - since.getTime()) / 31557600000);
    let caps = null;
    if (lv.some((b) => b.metric === 'event_captures' || b.metric === 'events_dynamiques')) {
      const { data, error } = await sb.from('hg_dyn_captures').select('event_id').eq('user_id', me.id);
      if (!error) caps = data || [];
    }
    for (const b of lv) {
      if (b.metric === 'anciennete_annees') out.set(b.code, years);
      else if (b.metric === 'event_captures' && caps) out.set(b.code, caps.filter((c) => !b.event_id || c.event_id === b.event_id).length);
      else if (b.metric === 'events_dynamiques' && caps) out.set(b.code, new Set(caps.map((c) => c.event_id)).size);
    }
  } catch {}
  return out;
}
function levelBlock(b, has, level, value) {
  const lv = sortedLevels(b);
  const cur = has ? level : 0;
  const next = nextLevelDef(b, cur);
  const curDef = levelDef(b, cur);
  let prog = '';
  if (value != null && next) {
    const from = curDef ? curDef.threshold : 0;
    const ratio = Math.max(0, Math.min(1, (value - from) / Math.max(1, next.threshold - from)));
    prog = value >= next.threshold
      ? `<span class="lvl-prog-txt">Niveau ${roman(next.level)} atteint : mise à jour sous peu</span>`
      : `<span class="progress lvl-progress" role="progressbar" aria-valuemin="${from}" aria-valuemax="${next.threshold}" aria-valuenow="${value}" aria-label="Progression vers le niveau ${next.level}"><span style="width:${(ratio * 100).toFixed(0)}%"></span></span>
         <span class="lvl-prog-txt">${esc(metricCount(b.metric, value))} / ${esc(next.threshold)} → niveau ${roman(next.level)}${next.name ? ` (${esc(next.name)})` : ''}</span>`;
  } else if (next) {
    prog = `<span class="lvl-prog-txt">Niveau ${roman(next.level)} à ${esc(metricCount(b.metric, next.threshold))}</span>`;
  } else if (has) {
    prog = '<span class="lvl-prog-txt">Niveau maximum atteint</span>';
  }
  return `${levelPipsHtml(b, cur)}
    ${has ? `<span class="lvl-name">${esc(levelLabel(b, cur))}</span>` : `<span class="lvl-prog-txt muted">${lv.length} niveaux · ${esc(METRIC_LABEL[b.metric] || '')}</span>`}
    ${prog}`;
}
async function loadBadges() {
  const ul = $('#badge-grid');
  try {
    const [{ data: all, error }, { data: mine, error: e2 }] = await Promise.all([
      sb.from('hg_badges').select('*').order('sort'),
      sb.from('hg_user_badges').select('badge_code,awarded_at,level').eq('user_id', me.id),
    ]);
    if (error) throw error; if (e2) throw e2;
    const got = new Map((mine || []).map((b) => [b.badge_code, b]));
    const progress = await loadBadgeProgress(all || []);
    $('#badge-count').textContent = `${got.size} / ${all.length} obtenu${got.size > 1 ? 's' : ''}`;
    ul.innerHTML = all.map((b, i) => {
      const has = got.has(b.code);
      const level = Number(got.get(b.code)?.level) || 1;
      const tint = BADGE_TINTS[i % BADGE_TINTS.length];
      const img = hasLevels(b) ? levelImage(b, has ? level : 1) : b.image_url;
      const medal = img
        ? `<img src="${esc(img)}" alt="" loading="lazy">`
        : `<span class="badge-initials display">${esc(badgeInitials(b.name))}</span>`;
      return `<li class="badge ${has ? 'is-got' : 'is-locked'}${hasLevels(b) ? ' has-levels' : ''}" style="--tint:${tint}">
        <span class="badge-medal">${medal}${has && hasLevels(b) ? `<span class="medal-lvl" aria-hidden="true">${roman(level)}</span>` : ''}</span>
        <span class="badge-name">${esc(b.name)}</span>
        <span class="badge-desc">${esc(b.description)}</span>
        ${hasLevels(b) ? `<span class="badge-levels">${levelBlock(b, has, level, progress.has(b.code) ? progress.get(b.code) : null)}</span>` : ''}
        <span class="badge-state">${has ? `Obtenu le ${esc(fmtDate(got.get(b.code).awarded_at))}` : `${ICON.lock} À débloquer`}</span>
      </li>`;
    }).join('');
  } catch (e) { ul.innerHTML = `<li class="empty">Impossible de charger les badges (${esc(errMsg(e))}).</li>`; }
}

/* ---------- Informations diverses (hg_profile_info) ---------- */
let infoData = {};       // dernier état enregistré (on conserve aussi les clés inconnues de cette page)
function infoInputs() { return $$('#info-groups [data-key]'); }
function infoFromForm() {
  const out = { ...infoData };
  for (const el of infoInputs()) out[el.dataset.key] = el.value.trim();
  return out;
}
function infoCounts() {
  for (const g of INFO_GROUPS) {
    const n = g.fields.filter((f) => String($(`#inf-${f.id}`)?.value || '').trim()).length;
    const el = $(`[data-count="${g.id}"]`);
    if (el) el.textContent = n ? `${n} / ${g.fields.length} renseigné${n > 1 ? 's' : ''}` : 'Rien de renseigné';
  }
}
function infoStatus(state, when) {
  const el = $('#info-status');
  if (!el) return;
  el.className = `info-status small is-${state}`;
  el.innerHTML = state === 'saved' ? `${ICON.check} Enregistré${when ? ` · ${esc(fmtDateTime(when))}` : ''}`
    : state === 'dirty' ? 'Modifications non enregistrées'
    : state === 'saving' ? 'Enregistrement…'
    : state === 'error' ? 'Échec de l\'enregistrement'
    : '';
}
async function bindInfos() {
  const form = $('#info-form'), box = $('#info-groups');
  let dirty = false;
  const setDirty = (v) => { dirty = v; if (v) infoStatus('dirty'); };
  try {
    const { data, error } = await sb.from('hg_profile_info').select('data,updated_at').eq('user_id', me.id).maybeSingle();
    if (error) throw error;
    infoData = (data?.data && typeof data.data === 'object') ? data.data : {};
    for (const el of infoInputs()) el.value = infoData[el.dataset.key] ?? '';
    infoStatus(data ? 'saved' : '', data?.updated_at);
  } catch (e) {
    infoStatus('error');
    $('#info-status').textContent = `Impossible de charger tes informations (${errMsg(e)}).`;
  }
  box.removeAttribute('aria-busy');
  infoCounts();
  // Ouvrir d'office les groupes déjà remplis (sinon seul le premier reste ouvert)
  const filled = INFO_GROUPS.filter((g) => g.fields.some((f) => String(infoData[f.id] || '').trim()));
  if (filled.length) $$('.info-group', box).forEach((d) => { d.open = filled.some((g) => g.id === d.dataset.group); });
  form.addEventListener('input', () => { setDirty(true); infoCounts(); });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const data = infoFromForm();
    // Objet complet : toutes les clés de la liste (valeurs vides comprises) + celles déjà présentes
    for (const f of INFO_FIELDS) if (!(f.id in data)) data[f.id] = '';
    busy(btn, true, 'Enregistrement…'); infoStatus('saving');
    const updated_at = new Date().toISOString();
    const { error } = await sb.from('hg_profile_info').upsert({ user_id: me.id, data, updated_at }, { onConflict: 'user_id' });
    busy(btn, false);
    if (error) { infoStatus('error'); return toast(`Enregistrement impossible : ${authMsg(error)}`, 'error'); }
    infoData = data; dirty = false;
    infoStatus('saved', updated_at);
    toast('Informations enregistrées.', 'ok');
  });
}

/* ---------- Export / suppression ---------- */
function bindData() {
  $('#export').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    busy(btn, true, 'Préparation…');
    try {
      const { data, error } = await sb.rpc('hg_export_my_data');
      if (error) throw error;
      const { data: { user } } = await sb.auth.getUser();
      const { data: info } = await sb.from('hg_profile_info').select('data,updated_at').eq('user_id', me.id).maybeSingle();
      const payload = { exporte_le: new Date().toISOString(), compte: { id: user?.id, email: user?.email, cree_le: user?.created_at }, ...data, informations_diverses: info || null };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `humane-gang-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Export téléchargé.', 'ok');
    } catch (err) { toast(`Export impossible : ${authMsg(err)}`, 'error'); }
    busy(btn, false);
  });

  const dlg = $('#delete-dialog'), confirmIn = $('#delete-confirm'), go = $('#delete-go');
  $('#delete').addEventListener('click', () => { confirmIn.value = ''; go.disabled = true; dlg.showModal(); confirmIn.focus(); });
  confirmIn.addEventListener('input', () => { go.disabled = confirmIn.value.trim().toUpperCase() !== 'SUPPRIMER'; });
  // Entrée dans le champ ne doit ni fermer la boîte ni supprimer : seul le bouton dédié agit
  $('#delete-form').addEventListener('submit', (e) => e.preventDefault());
  $('#delete-cancel').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => formError($('#delete-form'), ''));
  go.addEventListener('click', async () => {
    busy(go, true, 'Suppression…');
    try {
      await cleanupStorage($('#delete-photos').checked);
      const { error } = await sb.rpc('hg_delete_my_account');
      if (error) throw error;
      await sb.auth.signOut().catch(() => {});
      try { ['hg_pending_join', 'hg_intro_seen'].forEach((k) => localStorage.removeItem(k)); } catch {}
      dlg.close();
      updateHeaderProfile(null);
      app.innerHTML = `<section class="acc-narrow"><div class="page-head"><div><p class="eyebrow">Mon compte</p><h1 class="page-title">Compte supprimé</h1></div></div>
        <div class="card stack"><p>Ton compte et tes données ont été supprimés. Merci d'avoir fait partie du gang.</p>
        <div class="btn-row"><a class="btn btn-ghost" href="accueil.html">Retour à l'accueil</a></div></div></section>`;
    } catch (err) {
      busy(go, false);
      formError($('#delete-form'), `Suppression impossible : ${authMsg(err)}`);
    }
  });
}

/** Supprime (au mieux) les fichiers stockés de l'utilisateur avant la suppression du profil. */
async function cleanupStorage(withPhotos) {
  try { await sb.storage.from('hg-avatars').remove(AVATAR_EXTS.map((x) => `${me.id}/avatar.${x}`)); } catch {}
  if (!withPhotos) return;
  try {
    const [{ data: photos }, { data: moments }] = await Promise.all([
      sb.from('hg_photos').select('id,path').eq('user_id', me.id),
      sb.from('hg_moments').select('id,image_path').eq('created_by', me.id).not('image_path', 'is', null),
    ]);
    const paths = [...(photos || []).map((p) => p.path), ...(moments || []).map((m) => m.image_path)].filter((x) => x && x.startsWith(`${me.id}/`));
    for (let i = 0; i < paths.length; i += 100) await sb.storage.from('hg-photos').remove(paths.slice(i, i + 100));
    if (photos?.length) await sb.from('hg_photos').delete().eq('user_id', me.id);
    if (moments?.length) await sb.from('hg_moments').update({ image_path: null }).eq('created_by', me.id);
  } catch (e) { console.warn('[compte] nettoyage des photos', e); }
}

/* ======================================================================
   Aiguillage
   ====================================================================== */
const joinErr = url.searchParams.get('joinerr');
if (joinErr) { url.searchParams.delete('joinerr'); history.replaceState(null, '', url.pathname + url.search); }

if (!recoveryShown) {
  const user = (await sb.auth.getSession()).data.session?.user ?? null;
  if (linkError && !user) renderLinkError();
  else if (isRecoveryLink && user) renderRecovery();
  else if (!user) renderGuest(url.searchParams.get('tab') === 'signup' || location.hash === '#inscription' || INVITE ? 'signup' : 'login');
  else if (!me) {
    const pend = pendingGet();
    if (pend?.code && pend?.pseudo && !joinErr) {
      const { error } = await sb.rpc('hg_join', { p_code: pend.code, p_pseudo: pend.pseudo });
      if (!error) { pendingSet(null); clearInvite(); toast('Bienvenue dans le gang !', 'ok'); setTimeout(goAfterAuth, 500); }
      else renderJoin(pend, authMsg(error));
    } else renderJoin(pend || (INVITE ? { code: INVITE } : {}), joinErr || '');
  } else if (NEXT) goAfterAuth();
  else await renderMember(user);
}
