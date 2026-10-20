// ===== Rejoindre : un lien d'invitation (rejoindre.html?l=<token>) donne un code unique HG-XXXXXX valable 48 h =====
import { sb, initPage, esc, $, toast, errMsg, getUser, currentLogo } from './core.js';

const TOKEN = new URL(location.href).searchParams.get('l')?.trim() || '';
const CODE_KEY = 'hg_invite_code';      // lu par compte.js
const LINK_KEY = 'hg_invite_link';      // { token, code, at } : évite un nouveau code à chaque rechargement
const VALID_MS = 48 * 3600 * 1000;

const me = await initPage({ auth: 'optional' });
const box = $('#rj');
const logo = $('.rj-logo');
try { const src = currentLogo(); if (src) logo.src = src; } catch {}

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC = {
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
  err: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.01"/>'),
  home: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>'),
};

function store(v) { try { sessionStorage.setItem(LINK_KEY, JSON.stringify(v)); sessionStorage.setItem(CODE_KEY, v.code); } catch {} }
function stored() {
  try {
    const v = JSON.parse(sessionStorage.getItem(LINK_KEY) || 'null');
    if (v && v.token === TOKEN && /^HG-[A-Z0-9]{4,8}$/.test(v.code) && Date.now() - v.at < VALID_MS) return v;
  } catch {}
  return null;
}
const until = (at) => new Intl.DateTimeFormat('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(at + VALID_MS));

function head(eyebrow, title) {
  return `<img class="rj-logo" src="${esc(logo.getAttribute('src'))}" alt="" width="160" height="160">
    <p class="rj-eyebrow">${esc(eyebrow)}</p><h1 class="rj-title" id="rj-title">${esc(title)}</h1>`;
}
function done() { box.removeAttribute('aria-busy'); }

function renderMember() {
  box.innerHTML = `${head('Déjà dans la place', `Salut ${me.pseudo} !`)}
    <p class="rj-lead">Tu fais déjà partie du Humane Gang : pas besoin de code d'invitation. Si tu veux inviter quelqu'un, partage-lui simplement ce lien.</p>
    <div class="rj-actions"><a class="btn btn-primary" href="accueil.html">${IC.home} Aller à l'accueil</a></div>`;
  done();
}

function renderError(msg) {
  box.innerHTML = `${head('Invitation', 'Lien indisponible')}
    <span class="rj-icon is-error">${IC.err}</span>
    <p class="rj-lead">${esc(msg)}</p>
    <p class="rj-lead">Demande un nouveau lien à la personne qui t'a invité·e, ou écris-nous.</p>
    <div class="rj-actions">
      <a class="btn btn-primary" href="assistance.html">Contacter l'assistance</a>
      <a class="btn btn-ghost" href="compte.html">J'ai déjà un compte</a>
    </div>`;
  done();
}

function renderCode(v) {
  const signupHref = `compte.html?code=${encodeURIComponent(v.code)}#inscription`;
  box.innerHTML = `${head('Tu es invité·e', 'Bienvenue dans le Humane Gang')}
    <p class="rj-lead">${v.loggedIn ? 'Il ne te reste qu\'à choisir ton pseudo.' : 'Le QG du gang : Secret Santa, sorties IRL et souvenirs. Voici ton code personnel pour créer ton compte.'}</p>
    <div class="rj-code-box">
      <span class="rj-code-k" id="rj-code-k">Ton code d'invitation</span>
      <span class="rj-code" aria-labelledby="rj-code-k">${esc(v.code)}</span>
      <button class="btn btn-ghost btn-sm" type="button" id="rj-copy">${IC.copy} Copier le code</button>
      <p class="rj-code-note">Valable 48 h (jusqu'au ${esc(until(v.at))}), pour un seul compte.</p>
    </div>
    <div class="rj-actions">
      <a class="btn btn-primary" href="${esc(signupHref)}" id="rj-go">${v.loggedIn ? 'Continuer' : 'Créer mon compte'}</a>
    </div>
    <p class="rj-foot">Déjà membre ? <a href="compte.html">Se connecter</a> · Un souci ? <a href="assistance.html">Assistance</a></p>`;
  done();
  $('#rj-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(v.code); toast('Code copié', 'ok'); }
    catch { toast('Copie impossible : sélectionne le code à la main.', 'error'); }
  });
}

function friendly(e) {
  const m = errMsg(e);
  if (/invalide ou expir/i.test(m)) return 'Ce lien d\'invitation n\'est plus valable : il a expiré, a été désactivé ou a atteint sa limite.';
  if (/trop de demandes/i.test(m)) return 'Ce lien a été très demandé ces dernières minutes. Réessaie dans une heure.';
  if (/failed to fetch|network/i.test(m)) return 'Connexion au serveur impossible. Vérifie ta connexion internet puis recharge la page.';
  return `Impossible d'obtenir un code (${m}).`;
}

if (me) renderMember();
else if (!/^[A-Za-z0-9_-]{6,128}$/.test(TOKEN)) renderError('Ce lien d\'invitation est incomplet. Vérifie que tu as bien copié toute l\'adresse.');
else {
  const loggedIn = !!(await getUser());
  const prev = stored();
  if (prev) renderCode({ ...prev, loggedIn });
  else {
    try {
      const { data, error } = await sb.rpc('hg_claim_invite_link', { p_token: TOKEN });
      if (error) throw error;
      const code = String(data || '').trim().toUpperCase();
      if (!/^HG-[A-Z0-9]{4,8}$/.test(code)) throw new Error('réponse inattendue du serveur');
      const v = { token: TOKEN, code, at: Date.now() };
      store(v);
      renderCode({ ...v, loggedIn });
    } catch (e) {
      console.warn('[rejoindre]', e);
      renderError(friendly(e));
    }
  }
}
