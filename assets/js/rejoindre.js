// ===== Rejoindre (rejoindre.html) : un lien d'invitation (rejoindre.html?l=<token>) donne un code unique HG-XXXXXX valable 48 h (réglable) =====
// Module de la page d'invitation. Le lien contient un jeton (paramètre « l »). Le serveur (RPC hg_claim_invite_link)
// transforme ce jeton en un code personnel, que la personne utilise ensuite sur compte.html pour créer son compte.
// Dépendances : core.js, icons.js, invite-config.js. Le code est mémorisé en sessionStorage pour survivre à un rechargement.
// N'exporte rien.
import { sb, initPage, esc, $, toast, errMsg, getUser, currentLogo } from './core.js';
import { svg } from './icons.js';
import { loadInviteConfig, inviteConfig, inviteCodeRe } from './invite-config.js';

/* ---------- Constantes et clés de stockage ---------- */
const TOKEN = new URL(location.href).searchParams.get('l')?.trim() || '';
const CODE_KEY = 'hg_invite_code';      // lu par compte.js
const LINK_KEY = 'hg_invite_link';      // { token, code, at } : évite un nouveau code à chaque rechargement
/** Durée de validité du code, en millisecondes (réglage admin, 48 h par défaut). */
const validMs = () => inviteConfig().validite_heures * 3600 * 1000; // hg_settings.invites (48 h par défaut)

/* ---------- Initialisation : session, configuration des invitations, logo ---------- */
// me = personne connectée (ou null). Si connectée, la page n'a pas besoin de code.
const me = await initPage({ auth: 'optional' });
await loadInviteConfig();
const box = $('#rj');
const logo = $('.rj-logo');
try { const src = currentLogo(); if (src) logo.src = src; } catch {}

/* ---------- Icônes ---------- */
const IC = {
  copy: svg('copy', { stroke: 1.8 }),
  err: svg('err', { stroke: 1.8 }),
  home: svg('home', { stroke: 1.8 }),
};

/* ---------- Mémorisation du code (sessionStorage) ---------- */
/**
 * Garde le code obtenu pour ce lien, pour ne pas en demander un nouveau à chaque rechargement.
 * Écrit aussi le code à part (CODE_KEY) : compte.js le lit pour pré-remplir l'inscription.
 * @param {{token: string, code: string, at: number}} v
 */
function store(v) { try { sessionStorage.setItem(LINK_KEY, JSON.stringify(v)); sessionStorage.setItem(CODE_KEY, v.code); } catch {} }
/**
 * Relit le code mémorisé, seulement s'il correspond à ce même lien et qu'il n'a pas expiré.
 * @returns {{token: string, code: string, at: number} | null} le code valable, ou null.
 */
function stored() {
  try {
    const v = JSON.parse(sessionStorage.getItem(LINK_KEY) || 'null');
    if (v && v.token === TOKEN && inviteCodeRe().test(v.code) && Date.now() - v.at < validMs()) return v;
  } catch {}
  return null;
}
/** Date et heure de fin de validité du code, lisibles (ex. « mardi 3 juin à 14:00 »). */
const until = (at) => new Intl.DateTimeFormat('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(at + validMs()));

/* ---------- Rendu : chaque fonction remplace le contenu de la boîte #rj ---------- */
/**
 * En-tête commun aux trois écrans (logo, sur-titre, titre).
 * @param {string} eyebrow petit texte au-dessus du titre
 * @param {string} title titre principal
 * @returns {string} HTML
 */
function head(eyebrow, title) {
  return `<img class="rj-logo" src="${esc(logo.getAttribute('src'))}" alt="" width="160" height="160">
    <p class="rj-eyebrow">${esc(eyebrow)}</p><h1 class="rj-title" id="rj-title">${esc(title)}</h1>`;
}
/** Retire le marqueur « occupé » de la boîte : le contenu est prêt, les lecteurs d'écran peuvent le lire. */
function done() { box.removeAttribute('aria-busy'); }

/** Écran pour une personne déjà membre : pas de code, simple bouton vers l'accueil. */
function renderMember() {
  box.innerHTML = `${head('Déjà dans la place', `Salut ${me.pseudo} !`)}
    <p class="rj-lead">Tu fais déjà partie du Humane Gang : pas besoin de code d'invitation. Si tu veux inviter quelqu'un, partage-lui simplement ce lien.</p>
    <div class="rj-actions"><a class="btn btn-primary" href="accueil.html">${IC.home} Aller à l'accueil</a></div>`;
  done();
}

/**
 * Écran d'erreur (lien incomplet, expiré, serveur injoignable…).
 * @param {string} msg explication lisible pour la personne
 */
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

/**
 * Écran du code : affiche le code, le bouton « Copier » et le lien vers l'inscription (compte.html).
 * @param {{token: string, code: string, at: number, loggedIn: boolean}} v code obtenu et état de connexion
 */
function renderCode(v) {
  const signupHref = `compte.html?code=${encodeURIComponent(v.code)}#inscription`;
  box.innerHTML = `${head('Tu es invité·e', 'Bienvenue dans le Humane Gang')}
    <p class="rj-lead">${v.loggedIn ? 'Il ne te reste qu\'à choisir ton pseudo.' : 'Le QG du gang : Secret Santa, sorties IRL et souvenirs. Voici ton code personnel pour créer ton compte.'}</p>
    <div class="rj-code-box">
      <span class="rj-code-k" id="rj-code-k">Ton code d'invitation</span>
      <span class="rj-code" aria-labelledby="rj-code-k">${esc(v.code)}</span>
      <button class="btn btn-ghost btn-sm" type="button" id="rj-copy">${IC.copy} Copier le code</button>
      <p class="rj-code-note">Valable ${inviteConfig().validite_heures} h (jusqu'au ${esc(until(v.at))}), pour un seul compte.</p>
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

/**
 * Traduit une erreur technique en phrase compréhensible pour la personne.
 * Les messages de la base (« invalide ou expiré », « trop de demandes ») sont reconnus par leur texte.
 * @param {unknown} e l'erreur levée par la RPC ou le réseau
 * @returns {string} message à afficher
 */
function friendly(e) {
  const m = errMsg(e);
  if (/invalide ou expir/i.test(m)) return 'Ce lien d\'invitation n\'est plus valable : il a expiré, a été désactivé ou a atteint sa limite.';
  if (/trop de demandes/i.test(m)) return 'Ce lien a été très demandé ces dernières minutes. Réessaie dans une heure.';
  if (/failed to fetch|network/i.test(m)) return 'Connexion au serveur impossible. Vérifie ta connexion internet puis recharge la page.';
  return `Impossible d'obtenir un code (${m}).`;
}

/* ---------- Point d'entrée : choix de l'écran ---------- */
// 1) déjà connecté : écran « déjà membre » ; 2) jeton absent ou mal formé : erreur ;
// 3) code déjà obtenu pour ce lien (sessionStorage) : on le réaffiche ; 4) sinon on le demande au serveur.
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
      if (!inviteCodeRe().test(code)) throw new Error('réponse inattendue du serveur');
      const v = { token: TOKEN, code, at: Date.now() };
      store(v);
      renderCode({ ...v, loggedIn });
    } catch (e) {
      console.warn('[rejoindre]', e);
      renderError(friendly(e));
    }
  }
}
