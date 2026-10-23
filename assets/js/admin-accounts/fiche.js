// =====================================================================
// Comptes admin : fiche d'un membre dans la zone principale (#membres/comptes/<id>/<onglet>), résumé à droite.
// Lectures à la demande : à l'ouverture, seuls le profil et le Staff sont lus ; chaque onglet ne lit que ses
// données, une fois. Le résumé (colonne droite, écran de 1440 px et plus) lit ses repères à part. Toute lecture
// est gardée pendant la visite de la page (CACHE, dans state.js) ; une modification la vide.
// Dépendances : core.js (sb, toast, errMsg, esc, $, $$, dates), admin-access.js (droits des pages),
// admin/ui/detail-header.js et admin/ui/info-panel.js (composants communs), state.js, admin/perms.js,
// admin-staff.js (libellés des permissions), inspect.js, profile.js, ss.js, activity.js, list.js, admin-ghosts.js.
// Tables lues : hg_profiles, hg_profile_info, hg_ss_editions / participants / assignments / wishes, hg_events,
// hg_event_rsvps, hg_photos (+ stockage hg-photos), hg_ideas, hg_support, hg_badges, hg_user_badges,
// hg_wallets, hg_card_copies ; RPC hg_staff_list.
// Exporte : openAccount, reloadDetail, showGhostFiche, emptyDetail, showAccount, openAccountFiche, renderDetail,
// paintSugg, selectTab, renderPanel, mountAccountsInfo, paintInfo, foldInfoGroups (groupes repliables de l'onglet Informations).
// =====================================================================
import { sb, toast, errMsg, esc, $, $$, fmtDate, fmtDateTime } from '../core.js';
import { ensureAccessData, memberAccessHtml } from '../admin-access.js';
import { renderDetailHeader } from '../admin/ui/detail-header.js';
import { renderInfoPanel } from '../admin/ui/info-panel.js';
import { A, H, TABS, root, CACHE, dropFicheCache } from './state.js';
import { isAdminView } from '../admin/perms.js';
import { permLabel } from '../admin-staff.js';
import { closeDetail } from './inspect.js';
import { profileHtml, infosHtml } from './profile.js';
import { ssHtml } from './ss.js';
import { irlHtml, photosHtml, contribHtml, badgesHtml } from './activity.js';
import { roleOf, selectInList } from './list.js';
import { ghostBannerHtml, renderGhostView } from '../admin-ghosts.js';

/* =========================================================
   Lectures
   ========================================================= */
/** Attend une requête Supabase et ne garde que { data, error }, la forme utilisée par le cache. */
async function q(p) { const r = await p; return { data: r.data, error: r.error }; }
/* Noms des lectures stockées dans A.d : on les efface pour relire la fiche après une modification. */
const DATA_FIELDS = ['info', 'editions', 'parts', 'assigns', 'wishes', 'events', 'rsvps', 'photos', 'ideas', 'support',
  'badges', 'ubadges', 'wallet', 'cards', 'ssCount'];
const WIDE = matchMedia('(min-width: 1440px)'); // résumé à droite : affiché (et donc lu) seulement sur grand écran

/** Renseigne A.d[name] une seule fois (depuis le cache si la lecture existe déjà). */
async function fill(name, key, read) {
  const d = A.d;
  if (!d || d[name] !== undefined) return;
  if (!CACHE.has(key)) CACHE.set(key, Promise.resolve(read()).then((r) => { if (r.error) CACHE.delete(key); return r; }));
  const r = await CACHE.get(key);
  if (A.d === d && d[name] === undefined) d[name] = r;
}

/* Lectures de la fiche. Chaque entrée renvoie une fonction : la requête ne part qu'au moment de la lecture. */
const SOURCE = {
  info: (uid) => () => q(sb.from('hg_profile_info').select('data, updated_at').eq('user_id', uid).maybeSingle()),
  editions: () => q(sb.from('hg_ss_editions').select('id, year, status, drawn_at').order('year', { ascending: false })),
  parts: (ed) => () => q(sb.from('hg_ss_participants').select('edition_id, user_id, sent_at, received_at, joined_at').eq('edition_id', ed)),
  assigns: (ed) => () => q(sb.from('hg_ss_assignments').select('edition_id, giver_id, receiver_id').eq('edition_id', ed)),
  wishes: (uid) => () => q(sb.from('hg_ss_wishes').select('id, edition_id, label, url, created_at').eq('user_id', uid).order('created_at')),
  events: () => q(sb.from('hg_events').select('id, title, starts_at, location').order('starts_at', { ascending: false, nullsFirst: false })),
  rsvps: (uid) => () => q(sb.from('hg_event_rsvps').select('event_id, status, updated_at').eq('user_id', uid)),
  photos: (uid) => async () => {
    const r = await q(sb.from('hg_photos').select('id, event_id, path, caption, created_at').eq('user_id', uid).order('created_at', { ascending: false }));
    const signed = new Map(); // miniatures signées (bucket privé)
    /* Chemins des photos de l'album, à signer pour les afficher. */
    const paths = (r.data ?? []).map((p) => p.path);
    if (paths.length) {
      const { data: urls, error } = await sb.storage.from('hg-photos').createSignedUrls(paths, 3600);
      if (error) console.warn('[photos]', error);
      for (const u of urls ?? []) if (u.signedUrl) signed.set(u.path, u.signedUrl);
    }
    return { ...r, signed };
  },
  ideas: (uid) => () => q(sb.from('hg_ideas').select('*').eq('user_id', uid).order('created_at', { ascending: false })),
  support: (uid) => () => q(sb.from('hg_support').select('*').eq('user_id', uid).order('created_at', { ascending: false })),
  badges: () => q(sb.from('hg_badges').select('code, name, description, image_url, sort').order('sort')),
  ubadges: (uid) => () => q(sb.from('hg_user_badges').select('badge_code, awarded_at').eq('user_id', uid)),
  // Résumé : Paillettes, Cartes, participations Secret Santa (toutes éditions)
  wallet: (uid) => () => q(sb.from('hg_wallets').select('paillettes').eq('user_id', uid).maybeSingle()),
  cards: (uid) => () => q(sb.from('hg_card_copies').select('id').eq('owner_id', uid)),
  ssCount: (uid) => () => q(sb.from('hg_ss_participants').select('edition_id').eq('user_id', uid)),
};

/** Lectures nécessaires à un onglet (le profil et le Staff sont toujours chargés). */
async function loadTab(k, uid) {
  const d = A.d;
  if (k === 'infos') return fill('info', `${uid}|info`, SOURCE.info(uid));
  if (k === 'ss') {
    await fill('editions', 'editions', SOURCE.editions);
    const eds = d.editions?.data ?? [];
    if (!eds.some((e) => e.id === A.ssEdition)) A.ssEdition = eds[0]?.id ?? null;
    const ed = A.ssEdition;
    if (!ed) return;
    if (d.edition !== ed) { d.edition = ed; d.parts = undefined; d.assigns = undefined; } // participants et tirage : de l'édition affichée
    await Promise.all([
      fill('parts', `ss|${ed}|parts`, SOURCE.parts(ed)),
      fill('assigns', `ss|${ed}|assigns`, SOURCE.assigns(ed)),
      fill('wishes', `${uid}|wishes`, SOURCE.wishes(uid)),
    ]);
    return;
  }
  if (k === 'irl') return Promise.all([fill('events', 'events', SOURCE.events), fill('rsvps', `${uid}|rsvps`, SOURCE.rsvps(uid))]);
  if (k === 'photos') return Promise.all([fill('events', 'events', SOURCE.events), fill('photos', `${uid}|photos`, SOURCE.photos(uid))]).then(() => {
    if (A.d === d && d.signed === undefined) d.signed = d.photos?.signed ?? new Map();
  });
  if (k === 'contrib') return Promise.all([fill('ideas', `${uid}|ideas`, SOURCE.ideas(uid)), fill('support', `${uid}|support`, SOURCE.support(uid))]);
  if (k === 'badges') return Promise.all([fill('badges', 'badges', SOURCE.badges), fill('ubadges', `${uid}|ubadges`, SOURCE.ubadges(uid))]);
  if (k === 'acces') { await ensureAccessData().catch(() => null); return; } // l'erreur s'affiche dans l'onglet
}

/** Charge l'onglet demandé (sans toucher aux autres). */
async function ensureTab(k) {
  await loadTab(k, A.uid);
}

/** Repères du résumé (lectures partagées avec les onglets : pas de relecture ensuite). */
async function loadSummary(uid) {
  await Promise.all([
    fill('wallet', `${uid}|wallet`, SOURCE.wallet(uid)),
    fill('cards', `${uid}|cards`, SOURCE.cards(uid)),
    fill('ssCount', `${uid}|ssCount`, SOURCE.ssCount(uid)),
    fill('rsvps', `${uid}|rsvps`, SOURCE.rsvps(uid)),
    fill('ubadges', `${uid}|ubadges`, SOURCE.ubadges(uid)),
    fill('support', `${uid}|support`, SOURCE.support(uid)),
  ]);
}

/** Lectures de base : profil (erreur bloquante) et Staff (administrateur). */
async function loadBase(uid) {
  const [profile, staffRes, notifRes] = await Promise.all([
    q(sb.from('hg_profiles').select('*').eq('id', uid).maybeSingle()),
    isAdminView() ? q(sb.rpc('hg_staff_list')) : Promise.resolve({ data: null, error: null }),
    // Notifications par catégorie (idée Q6, migration 095) : lecture seule ; sans la table, simplement absentes
    q(sb.from('hg_notif_prefs').select('prefs, quiet_start, quiet_end, updated_at').eq('user_id', uid).maybeSingle()),
  ]);
  if (profile.error) throw profile.error;
  if (!profile.data) throw new Error('Profil introuvable.');
  return {
    profile: profile.data,
    // Statut Staff du membre : visible de l'administrateur seulement (liste réservée à l'admin)
    staff: (staffRes.data ?? []).find((s) => s.user_id === uid) ?? null,
    notif: notifRes.error ? undefined : (notifRes.data ?? null),
  };
}

/** Vrai si les lectures de l'onglet sont déjà là. */
function tabReady(k) {
  const d = A.d;
  switch (k) {
    case 'profil': return true;
    case 'infos': return d.info !== undefined;
    case 'ss': return d.editions !== undefined && d.edition === A.ssEdition && d.parts !== undefined && d.assigns !== undefined && d.wishes !== undefined;
    case 'irl': return d.events !== undefined && d.rsvps !== undefined;
    case 'photos': return d.photos !== undefined && d.events !== undefined;
    case 'contrib': return d.ideas !== undefined && d.support !== undefined;
    case 'badges': return d.badges !== undefined && d.ubadges !== undefined;
    default: return false;
  }
}

/* =========================================================
   Ouverture, fermeture, sélection
   ========================================================= */
/** Ramène le nom d'onglet demandé à un onglet connu ; « profil » par défaut. */
const tabOf = (t) => (TABS.some(([k]) => k === t) ? t : 'profil');

/** Ouvre la fiche d'un membre dans la zone principale (l'URL est déjà à jour). */
export async function openAccount(uid, { tab } = {}) {
  A.uid = uid; A.tab = tabOf(tab); A.showPair = false; A.d = { signed: new Map() }; A.ghostView = false;
  root().innerHTML = '<div class="empty">Chargement de la fiche…</div>';
  selectInList(uid);
  paintInfo();
  try {
    const base = await loadBase(uid);
    if (A.uid !== uid) return;
    Object.assign(A.d, base);
    if (isGhostFiche() && A.tab === 'acces') A.tab = 'profil';
    await ensureTab(A.tab);
    if (A.uid !== uid) return;
    renderDetail();
    paintInfo();
  } catch (e) {
    if (A.uid !== uid) return;
    root().innerHTML = `<div class="empty">Impossible de charger la fiche : ${esc(errMsg(e))}</div>`;
    paintInfo();
  }
}

/** Relit la fiche après une modification : cache vidé, profil et onglet ouvert relus. */
export async function reloadDetail() {
  const uid = A.uid; if (!uid || !A.d) return;
  dropFicheCache();
  try {
    const base = await loadBase(uid);
    if (A.uid !== uid) return;
    const d = A.d;
    for (const f of DATA_FIELDS) delete d[f];
    d.signed = new Map(); d.edition = undefined;
    Object.assign(d, base);
    await ensureTab(A.tab);
    if (A.uid !== uid) return;
    renderDetail();
    paintInfo();
  } catch (e) { toast(errMsg(e), 'error'); }
}

/** Fiche d'un fantôme (adresse #membres/comptes/<id>) : code, note et liaison à un compte inscrit (admin-ghosts.js). */
export function showGhostFiche(uid) {
  A.uid = uid; A.d = null; A.ghostView = true; A.showPair = false;
  selectInList(uid);
  renderGhostView(root(), uid);
  paintInfo();
}

/** Écran sans élément choisi : la zone principale invite à choisir dans la liste. */
export function emptyDetail() {
  A.uid = null; A.d = null; A.showPair = false; A.ghostView = false;
  selectInList(null);
  root().innerHTML = `<div class="acc-empty">
      <p class="acc-empty-t">Choisis un membre dans la liste</p>
      <p class="small muted">Sa fiche s'ouvre ici : profil, Secret Santa, sorties, photos, badges et accès aux pages.</p>
    </div>`;
  paintInfo();
}

/** Fournisseur `open` de la sous-section : affiche la fiche de l'URL (#membres/comptes/<id>/<onglet>). */
export function showAccount(uid, tab) {
  if (!uid) { emptyDetail(); return; }
  const t = tabOf(tab);
  if (A.uid === uid && A.d) {
    selectInList(uid);
    if (t !== A.tab) selectTab(t);
    return;
  }
  return openAccount(uid, { tab: t });
}

/** Ouvre la fiche d'un membre depuis une autre section : change l'URL, la sous-section affiche la fiche. */
export function openAccountFiche(uid, tab) {
  const h = `#membres/comptes/${uid}${tab && tab !== 'profil' ? `/${tab}` : ''}`;
  if (location.hash === h) return openAccount(uid, { tab: tabOf(tab) });
  location.hash = h;
}

/** Vrai si la fiche ouverte est celle d'un fantôme (pas encore inscrit). */
const isGhostFiche = () => !!(A.d?.profile?.is_ghost ?? A.accounts.find((a) => a.id === A.uid)?.is_ghost);

/* =========================================================
   Fiche : en-tête, onglets, panneau
   ========================================================= */
/** Pastille « Staff » et permissions accordées (administrateur seulement). */
function staffLineHtml(st) {
  if (!st || !isAdminView()) return '';
  const perms = st.perms?.length ? st.perms.map((k) => `<span class="pill pill-muted">${esc(permLabel(k))}</span>`).join('') : '<span class="small muted">aucune permission</span>';
  return `<div class="acc-staff"><span class="pill pill-ok">Staff</span>${st.active ? '' : ' <span class="pill pill-muted">inactif</span>'} ${perms}</div>`;
}

/** En-tête de la fiche : composant commun (admin/ui/detail-header.js) + ligne Staff / admin. */
function paintHead() {
  const host = $('#acc-dh'); if (!host) return;
  const acc = A.accounts.find((a) => a.id === A.uid) || {};
  const p = A.d?.profile || { pseudo: acc.pseudo };
  const ghost = isGhostFiche();
  const subtitle = ghost
    ? 'Fantôme : pas encore inscrit. Tout ce que tu ajoutes ici suivra la personne à son inscription.'
    : [acc.email, acc.created_at ? `inscrit le ${fmtDate(acc.created_at)}` : '', acc.last_sign_in_at ? `vu le ${fmtDateTime(acc.last_sign_in_at)}` : '']
      .filter(Boolean).join(' · ');
  renderDetailHeader(host, {
    member: { pseudo: p.pseudo || acc.pseudo || '?', avatar_url: p.avatar_url, color: p.color },
    title: `${p.pseudo || acc.pseudo || 'Membre'}${ghost ? ' (fantôme)' : ''}`,
    subtitle,
    actions: [
      ...(ghost ? [{ label: 'Détail du fantôme', onClick: () => { location.hash = `#membres/comptes/${A.uid}`; } }] : []),
      { label: 'Fermer la fiche', onClick: closeDetail },
    ],
  });
  const meta = $('#acc-meta');
  if (meta) meta.innerHTML = `${p.is_admin ? '<span class="pill pill-ok">admin</span> ' : ''}${staffLineHtml(A.d?.staff)}`;
}

/** Compteur de l'onglet : seulement si ses données sont déjà lues (pas de requête pour le seul affichage). */
function tabCount(k) {
  const d = A.d; let n = 0;
  if (k === 'photos') n = d?.photos?.data?.length ?? 0;
  if (k === 'contrib') n = (d?.ideas?.data?.length ?? 0) + (d?.support?.data?.length ?? 0);
  if (k === 'badges') n = d?.ubadges?.data?.length ?? 0;
  return n ? ` <span class="acc-tab-n">${n}</span>` : '';
}

/** Dessine la fiche complète : en-tête, bannière, onglets et panneau de l'onglet courant. */
export function renderDetail() {
  root().innerHTML = `
    <div id="acc-dh"></div>
    <div id="acc-sugg"></div>
    <div class="acc-meta" id="acc-meta"></div>
    <div class="acc-tabs" role="tablist" aria-label="Données du membre">
      ${TABS.filter(([k]) => !(isGhostFiche() && k === 'acces')).map(([k, l]) => `<button class="acc-tab" type="button" role="tab" id="acc-tab-${k}" data-tab="${k}" aria-controls="acc-panel" aria-selected="${k === A.tab}" tabindex="${k === A.tab ? 0 : -1}">${esc(l)}${tabCount(k)}</button>`).join('')}
    </div>
    <div class="card acc-panel" id="acc-panel" role="tabpanel" aria-labelledby="acc-tab-${A.tab}" tabindex="0">${panelHtml()}</div>`;
  if (A.tab === 'infos') foldInfoGroups($('#acc-panel'));
  paintHead();
  paintSugg();
  paintInfo();
}

/** Bannière : fantômes qui ressemblent à ce compte actif (liaison en un clic). Vide pour un fantôme. */
export function paintSugg() {
  const host = $('#acc-sugg'); if (!host) return;
  host.innerHTML = A.uid && !isGhostFiche() ? ghostBannerHtml(A.uid) : '';
}

/** Met à jour les compteurs des onglets sans reconstruire la fiche (le focus reste sur l'onglet). */
function renderDetailCounts() {
  $$('#acc-root .acc-tab').forEach((b) => {
    const k = b.dataset.tab;
    const label = TABS.find(([x]) => x === k)?.[1] ?? '';
    b.innerHTML = `${esc(label)}${tabCount(k)}`;
  });
}

/** Redessine seulement le contenu de l'onglet courant, sans toucher aux onglets ni à l'en-tête. */
export function renderPanel() {
  const panel = $('#acc-panel'); if (!panel) return renderDetail();
  panel.innerHTML = panelHtml();
  if (A.tab === 'infos') foldInfoGroups(panel);
}

/** Texte du résumé d'un groupe : libellé et nombre de champs remplis. */
function foldSummary(fs, label) {
  const n = [...fs.querySelectorAll('input, textarea')].filter((el) => el.value.trim()).length;
  return `${label} · ${n === 0 ? 'aucun champ rempli' : `${n} champ${n > 1 ? 's' : ''} rempli${n > 1 ? 's' : ''}`}`;
}
/**
 * Onglet Informations : chaque groupe de champs (fieldset.acc-group) passe dans un <details> repliable,
 * le premier ouvert, avec un résumé « Libellé · n champs remplis ». Le formulaire reste unique (même enregistrement) :
 * les champs d'un groupe fermé sont toujours envoyés. Le résumé suit la saisie.
 * @param {HTMLElement} scope conteneur de l'onglet.
 */
export function foldInfoGroups(scope) {
  const form = scope?.querySelector('form[data-form="infos"]');
  if (!form) return;
  form.querySelectorAll('fieldset.acc-group').forEach((fs, i) => {
    const legend = fs.querySelector('legend');
    const label = legend?.textContent.trim() || `Groupe ${i + 1}`;
    const det = document.createElement('details');
    det.className = 'acc-fold';
    det.open = i === 0;
    const sum = document.createElement('summary');
    sum.className = 'acc-fold-sum';
    sum.textContent = foldSummary(fs, label);
    fs.before(det);
    det.append(sum, fs);
    legend?.classList.add('visually-hidden'); // le résumé sert de titre visible ; la légende reste pour les lecteurs d'écran
    fs.addEventListener('input', () => { sum.textContent = foldSummary(fs, label); });
  });
}

/** HTML du panneau correspondant à l'onglet courant. */
function panelHtml() {
  switch (A.tab) {
    case 'profil': return profileHtml();
    case 'infos': return infosHtml();
    case 'ss': return ssHtml();
    case 'irl': return irlHtml();
    case 'photos': return photosHtml();
    case 'contrib': return contribHtml();
    case 'badges': return badgesHtml();
    case 'acces': return memberAccessHtml({ id: A.d.profile.id, pseudo: A.d.profile.pseudo, is_admin: !!A.d.profile.is_admin });
    default: return '';
  }
}

/** Change d'onglet : lit ce que l'onglet demande (une fois), met à jour l'URL sans nouvelle entrée d'historique. */
export async function selectTab(k, focus = false) {
  A.tab = k;
  $$('#acc-root .acc-tab').forEach((b) => { const on = b.dataset.tab === k; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  const panel = $('#acc-panel');
  if (!panel) return renderDetail();
  panel.setAttribute('aria-labelledby', `acc-tab-${k}`);
  if (A.uid) history.replaceState(null, '', `#membres/comptes/${A.uid}${k === 'profil' && !isGhostFiche() ? '' : `/${k}`}`);
  if (!A.d || tabReady(k)) renderPanel();
  else {
    // Première ouverture de l'onglet : seules ses données sont lues
    const uid = A.uid;
    panel.innerHTML = '<div class="empty">Chargement…</div>';
    try { await ensureTab(k); } catch (e) { if (A.uid === uid) panel.innerHTML = `<div class="empty">Impossible de charger : ${esc(errMsg(e))}</div>`; return; }
    if (A.uid !== uid || A.tab !== k) return;
    renderPanel();
    renderDetailCounts();
  }
  if (focus) $(`#acc-tab-${k}`)?.focus();
}

/* =========================================================
   Panneau d'infos (colonne 4 : résumé du membre)
   ========================================================= */
/* Instance du panneau d'infos (colonne 4) ; détruite avant chaque nouveau dessin. */
let infoH = null;
/** Fournisseur `info` de la sous-section : le contenu est repeint à chaque changement de fiche. */
export function mountAccountsInfo(el) {
  el.innerHTML = '<div id="acc-info"></div>';
  paintInfo();
}

/** Dessine le résumé du membre dans la colonne 4 : repères, dernières demandes et actions rapides. */
export function paintInfo() {
  const host = $('#acc-info'); if (!host) return;
  infoH?.destroy(); infoH = null;
  if (A.ghostView && A.uid) { host.innerHTML = '<p class="ui-info-empty">Fantôme : pas encore inscrit. Son résumé apparaîtra à son inscription.</p>'; return; }
  if (!A.uid || !A.d) { host.innerHTML = '<p class="ui-info-empty">Sélectionne un membre pour voir son résumé.</p>'; return; }
  const d = A.d; const p = d.profile;
  if (!p) { host.innerHTML = '<p class="ui-info-empty">Chargement du résumé…</p>'; return; }
  const uid = A.uid;
  const acc = A.accounts.find((a) => a.id === uid) || {};
  const ghost = isGhostFiche();
  const role = roleOf({ ...acc, is_ghost: ghost, is_admin: !!p.is_admin });
  /* Nombre formaté à la mode suisse (espaces et séparateurs de la locale fr-CH). */
  const nf = (n) => Number(n || 0).toLocaleString('fr-CH');
  // Repères : « … » tant que leur lecture n'a pas eu lieu (grand écran seulement, voir loadSummary)
  const repere = (r, f) => (r === undefined ? '…' : nf(f(r)));
  /* Les cinq dernières demandes d'aide, au format attendu par le panneau d'infos. */
  const history = (d.support?.data ?? []).slice(0, 5).map((s) => ({
    id: s.id, title: s.subject || 'Demande',
    status: s.status === 'ouverte' ? { label: 'Ouverte', tone: 'open' } : { label: 'Traitée', tone: 'done' },
    at: s.created_at,
  }));
  const actions = [
    { label: 'Modifier le profil', onClick: () => selectTab('profil') },
    { label: 'Secret Santa', onClick: () => selectTab('ss') },
    { label: 'Badges', onClick: () => selectTab('badges') },
    ...(ghost ? [] : [{ label: 'Accès aux pages', onClick: () => selectTab('acces') }]),
  ];
  infoH = renderInfoPanel(host, {
    member: { pseudo: p.pseudo || acc.pseudo || '?', avatar_url: p.avatar_url, color: p.color, since: acc.created_at || null, lastSeen: acc.last_sign_in_at || null },
    statsTitle: 'Résumé',
    stats: [
      { value: repere(d.wallet, (r) => r.data?.paillettes), label: 'Paillettes' },
      { value: repere(d.cards, (r) => r.data?.length), label: 'Cartes' },
      { value: repere(d.rsvps, (r) => (r.data ?? []).filter((x) => x.status === 'oui').length), label: 'Sorties IRL' },
      { value: repere(d.ssCount, (r) => r.data?.length), label: 'Secret Santa' },
      { value: repere(d.ubadges, (r) => r.data?.length), label: 'Badges' },
      { value: role.label, label: 'Rôle' },
    ],
    historyTitle: "Demandes d'assistance",
    history,
    actions,
  });
  // Résumé affiché : ses repères se lisent une fois (grand écran seulement, pour ne pas alourdir la fiche sur petit écran)
  if (WIDE.matches && d.wallet === undefined && d.cards === undefined) {
    loadSummary(uid).then(() => { if (A.uid === uid) paintInfo(); });
  }
}

// Accès aux pages modifiés (ici ou dans la section « Accès aux pages ») : l'onglet « Accès » se met à jour
window.addEventListener('hg:access', () => {
  if (!A.uid || !A.d || A.tab !== 'acces') return;
  const f = document.activeElement?.dataset?.pageAccess;
  renderPanel();
  if (f) $(`[data-page-access="${CSS.escape(f)}"]`)?.focus();
});

H.renderPanel = renderPanel;
H.renderDetail = renderDetail;
