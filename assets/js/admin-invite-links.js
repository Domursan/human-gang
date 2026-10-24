// ===== Humane Gang — administration : liens d'invitation (hg_invite_links) =====
// Un lien public (rejoindre.html?l=<token>) donne à chaque visiteur un code unique HG-XXXXXX valable 48 h.
// Rôle : créer, activer / désactiver, copier, afficher en QR code et supprimer les liens d'invitation, et voir les codes
// qu'ils ont générés. Règle aussi les codes (durée, limite par heure, préfixe) dans hg_settings.invites.
// Importé par admin.js (section Invitations) et par admin/invites.js (bouton « + Nouveau lien »).
// Dépendances : core.js, ui-confirm.js, icons.js, invite-config.js (règles des codes), admin/ui/drawer.js.
// Tables et RPC : hg_invite_links (liens), hg_invites (codes, lien d'origine = link_id), hg_settings (clé 'invites').
// Exporte : inviteLinkUrl (URL publique d'un lien), openLinkDrawer (tiroir « Nouveau lien »),
// mountInviteLinks (montage), refreshInviteLinks (re-rendu).
import { sb, toast, errMsg, esc, $, fmtDate, fmtDateTime, godLimitAttr, godTag, isGodMode } from './core.js';
import { confirmBox } from './ui-confirm.js';
import { svg } from './icons.js';
import { openDrawer } from './admin/ui/drawer.js';
import { INVITE_DEFAULTS, INVITE_LIMITS, normalizeInviteConfig, inviteConfig, loadInviteConfig, resetInviteConfig } from './invite-config.js';

/* ---------- Constantes et état ---------- */
// Icônes SVG des boutons Copier, QR code et Supprimer.
const IC = {
  copy: svg('copy', { stroke: 2 }),
  trash: svg('trash', { stroke: 2 }),
  qr: svg('qr', { stroke: 2 }),
};
// Bibliothèque QR code (version figée), chargée seulement au premier clic sur « QR code ».
const QR_LIB = '../vendor/qrcode-generator-1.4.4.mjs';

// État de la section : racine, admin connecté, fonctions de pseudo et de rappel, liens et codes chargés,
// sections « Codes » ouvertes, erreurs de chargement, règles lues (rulesRaw : undefined = pas encore lues, null = valeurs par défaut).
const L = { root: null, me: null, pseudoOf: (id) => id, onChange: async () => {}, links: [], codes: [], open: new Set(), error: null, rulesRaw: undefined, rulesError: null };

/** Renvoie les données d'une réponse Supabase, ou lève l'erreur si la requête a échoué. */
function check(res) { if (res.error) throw res.error; return res.data; }
/**
 * Désactive le bouton pendant l'exécution de fn, puis le réactive. Une erreur est affichée en toast.
 * @param {HTMLButtonElement|null} btn Bouton à désactiver (peut être null).
 * @param {Function} fn Action asynchrone à exécuter.
 * @returns {Promise<*>} Le résultat de fn, ou undefined en cas d'erreur.
 */
async function busy(btn, fn) {
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { toast(errMsg(e), 'error'); return undefined; } finally { if (btn?.isConnected) btn.disabled = false; }
}
/**
 * Copie un texte dans le presse-papiers. Si l'API moderne échoue (navigateur ancien, contexte non sécurisé),
 * on passe par un champ caché et execCommand('copy').
 * @param {string} text Texte à copier.
 */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
  }
  toast('Copié dans le presse-papiers', 'ok');
}

/** URL publique du lien, calculée depuis l'adresse de la page (fonctionne aussi sous /human-gang/ sur GitHub Pages). */
export function inviteLinkUrl(token) {
  const u = new URL('rejoindre.html', `${location.origin}${location.pathname}`);
  u.searchParams.set('l', token);
  return u.href;
}

/* ---------- Données ---------- */
async function loadRules() {
  try {
    const { data, error } = await sb.from('hg_settings').select('value').eq('key', 'invites').maybeSingle();
    if (error) throw error;
    L.rulesRaw = data ? data.value : null;
    L.rulesError = null;
  } catch (e) { L.rulesError = e; }
}

/* ---------- Règles des codes (hg_settings.invites) ---------- */
/* ---------- Règles des codes (hg_settings.invites) ---------- */
// Réglages des codes : name = clé dans hg_settings.invites, label et unit affichés, help = aide sous le champ.
const RULES = [
  { name: 'validite_heures', label: 'Durée d\'un code (heures)', unit: 'h', help: 'Un code donné par un lien est valable pendant ce délai, pour un seul compte.' },
  { name: 'max_codes_heure_lien', label: 'Codes par heure et par lien', unit: '', help: 'Garde-fou anti-abus : au-delà, le lien répond « Trop de demandes » pendant une heure.' },
  { name: 'fantome_jours', label: 'Durée d\'un code de compte fantôme (jours)', unit: 'jours', help: 'Code donné à un compte fantôme (profil créé par l\'admin, à réclamer plus tard).' },
  { name: 'prefixe', label: 'Préfixe des codes', unit: '', help: 'Lettres ou chiffres puis un tiret (ex. HG-). Les codes déjà donnés restent valables.' },
];

/**
 * HTML du bloc « Règles des codes » : valeurs en vigueur (défauts ou valeurs enregistrées) et boutons.
 * @returns {string}
 */
function rulesHtml() {
  const cur = L.rulesRaw && typeof L.rulesRaw === 'object' ? L.rulesRaw : {};
  const custom = !!L.rulesRaw;
  const eff = { ...INVITE_DEFAULTS, ...Object.fromEntries(RULES.map((r) => [r.name, cur[r.name] ?? INVITE_DEFAULTS[r.name]])) };
  /** Valeur en vigueur d'une règle, suivie de son unité si elle en a une. */
  const shown = (r) => `${esc(eff[r.name])}${r.unit ? ` ${esc(r.unit)}` : ''}`;
  return `<section class="il-rules" aria-labelledby="il-rules-title">
    <div class="il-rules-head">
      <h4 class="card-title" id="il-rules-title">Règles des codes</h4>
      <div class="btn-row">
        <button class="btn btn-ghost btn-sm" type="button" data-il-rules-edit>Modifier les règles</button>
        <button class="btn btn-ghost btn-sm" type="button" data-il-rules-reset${custom ? '' : ' disabled'}>Rétablir les valeurs par défaut</button>
      </div>
    </div>
    <p class="small muted">${custom ? 'Des valeurs personnalisées sont enregistrées.' : 'Valeurs par défaut en vigueur.'} Une modification s'applique aux prochains codes.</p>
    ${L.rulesError ? `<div class="empty">Impossible de lire les règles : ${esc(errMsg(L.rulesError))}</div>` : `
    <dl class="il-rules-list">
      ${RULES.map((r) => `<div><dt class="small muted">${esc(r.label)}</dt><dd><strong class="text">${shown(r)}</strong></dd></div>`).join('')}
    </dl>`}
  </section>`;
}

/** Tiroir « Modifier les règles » (même principe que « Nouveau lien ») : champs typés, validés à l'enregistrement. */
function openRulesDrawer() {
  const cur = L.rulesRaw && typeof L.rulesRaw === 'object' ? L.rulesRaw : {};
  const body = document.createElement('div');
  body.className = 'il-form';
  body.innerHTML = RULES.map((r) => {
    const val = cur[r.name] ?? INVITE_DEFAULTS[r.name];
    const id = `il-rule-${r.name}`;
    const lim = INVITE_LIMITS[r.name];
    const help = `${r.help} Par défaut : ${INVITE_DEFAULTS[r.name]}${r.unit ? ` ${r.unit}` : ''}.`;
    return `<div class="field"><label for="${id}">${esc(r.label)}</label>
      ${r.name === 'prefixe'
        ? `<input id="${id}" name="${r.name}" maxlength="9" autocomplete="off" value="${esc(val)}" aria-describedby="${id}-h">`
        : `<input id="${id}" name="${r.name}" type="number" inputmode="numeric" step="1" min="${lim[0]}" max="${lim[1]}" value="${esc(val)}" aria-describedby="${id}-h">`}
      <span class="small muted" id="${id}-h">${esc(help)}</span></div>`;
  }).join('');
  openDrawer({
    title: 'Règles des codes',
    subtitle: 'Valables pour les prochains codes ; les codes déjà donnés ne changent pas.',
    body, submitLabel: 'Enregistrer les règles',
    onSubmit: async (form) => {
      const raw = {};
      for (const r of RULES) raw[r.name] = form.elements[r.name].value.trim();
      const res = normalizeInviteConfig(raw);
      if (res.error) throw new Error(res.error);
      check(await sb.from('hg_settings').upsert({ key: 'invites', value: res.value, updated_at: new Date().toISOString() }, { onConflict: 'key' }));
      L.rulesRaw = res.value;
      resetInviteConfig(); await loadInviteConfig();
      toast('Règles des codes enregistrées', 'ok');
      render();
    },
  });
}

/**
 * Supprime les règles personnalisées après confirmation : les valeurs par défaut reprennent effet.
 * @param {HTMLButtonElement} btn Bouton « Rétablir les valeurs par défaut ».
 */
async function resetRules(btn) {
  const ok = await confirmBox('Rétablir les valeurs par défaut ?',
    'La durée, la limite par heure, la durée des comptes fantômes et le préfixe reprennent leurs valeurs d\'origine. Les codes déjà donnés ne changent pas.',
    { ok: 'Rétablir', danger: false });
  if (!ok) return;
  await busy(btn, async () => {
    check(await sb.from('hg_settings').delete().eq('key', 'invites'));
    L.rulesRaw = null;
    resetInviteConfig(); await loadInviteConfig();
    toast('Valeurs par défaut rétablies', 'ok');
    render();
  });
}

/**
 * Charge les règles, les liens et les codes générés par les liens. Les erreurs remontent à refresh().
 */
async function load() {
  await loadRules();
  const [l, c] = await Promise.all([
    sb.from('hg_invite_links').select('*').order('created_at', { ascending: false }),
    sb.from('hg_invites').select('code, used_by, used_at, created_at, expires_at, link_id').not('link_id', 'is', null).order('created_at', { ascending: false }),
  ]);
  L.links = check(l) ?? [];
  L.codes = check(c) ?? [];
}

/**
 * État d'un lien : Désactivé, Expiré, Limite atteinte ou Actif.
 * @param {object} l Ligne hg_invite_links.
 * @returns {[string, string]} Libellé et classe CSS de la pastille.
 */
function linkState(l) {
  if (!l.active) return ['Désactivé', 'pill-todo'];
  if (l.expires_at && new Date(l.expires_at) < new Date()) return ['Expiré', 'pill-warn'];
  if (l.max_codes != null && l.codes_generated >= l.max_codes) return ['Limite atteinte', 'pill-warn'];
  return ['Actif', 'pill-ok'];
}
/**
 * Texte d'état d'un code : utilisé par qui et quand, expiré, ou encore disponible.
 * @param {object} c Ligne hg_invites.
 * @returns {string} HTML sûr (pseudo échappé).
 */
function codeState(c) {
  if (c.used_by) return `Utilisé par <strong class="text">${esc(L.pseudoOf(c.used_by))}</strong> le ${esc(fmtDateTime(c.used_at))}`;
  if (c.expires_at && new Date(c.expires_at) < new Date()) return `<span class="muted">Expiré le ${esc(fmtDateTime(c.expires_at))}</span>`;
  return c.expires_at ? `Valable jusqu'au ${esc(fmtDateTime(c.expires_at))}` : 'Disponible';
}

/* ---------- Rendu ---------- */
/* ---------- Rendu ---------- */
/**
 * HTML des champs du tiroir « Nouveau lien » : libellé, limite de codes, date d'expiration.
 * La date minimale est aujourd'hui, sauf en mode sans limite.
 * @returns {string}
 */
function fieldsHtml() {
  const today = new Date().toISOString().slice(0, 10);
  return `
    <div class="field il-label"><label for="il-label">Libellé</label>
      <input id="il-label" name="label" maxlength="80" autocomplete="off" placeholder="ex. Soirée du 12 décembre"></div>
    <div class="field"><label for="il-max">Limite de codes</label>
      <input id="il-max" name="max_codes" type="number" min="1" max="500" step="1" inputmode="numeric" placeholder="20 par défaut"></div>
    <div class="field"><label for="il-exp">Expire le <span class="muted small">(30 jours par défaut)</span>${godTag()}</label>
      <input id="il-exp" name="expires_at" type="date" ${godLimitAttr('min', today)}></div>`;
}

/** Tiroir « Nouveau lien » : libellé, limite de codes, date d'expiration. */
export function openLinkDrawer() {
  const body = document.createElement('div');
  body.className = 'il-form';
  body.innerHTML = fieldsHtml();
  openDrawer({
    title: 'Nouveau lien d’invitation',
    subtitle: `Chaque personne qui ouvre le lien reçoit son propre code, valable ${inviteConfig().validite_heures} h.`,
    body, submitLabel: 'Créer le lien',
    onSubmit: async (form) => {
      const label = form.label.value.trim() || `Lien du ${fmtDate(new Date())}`;
      const maxRaw = form.max_codes.value.trim();
      const max = maxRaw ? Number(maxRaw) : null;
      if (max !== null && (!Number.isInteger(max) || max < 1)) throw new Error('La limite doit être un nombre entier supérieur ou égal à 1.');
      // Date d'expiration : fin de journée locale
      const exp = form.expires_at.value ? new Date(`${form.expires_at.value}T23:59:59`) : null;
      if (exp && exp < new Date() && !isGodMode()) throw new Error('La date d\'expiration est déjà passée.');
      const row = check(await sb.from('hg_invite_links').insert({
        label, max_codes: max, expires_at: exp ? exp.toISOString() : null, created_by: L.me.id,
      }).select().single());
      await refresh();
      toast('Lien d\'invitation créé : copie-le ci-dessous', 'ok');
      if (row?.id) $(`[data-link="${CSS.escape(row.id)}"] .il-url-input`, L.root)?.select();
    },
  });
}

/**
 * HTML d'une carte de lien : titre, interrupteur, adresse copiable, compteurs et liste des codes repliable.
 * @param {object} l Ligne hg_invite_links.
 * @returns {string}
 */
function linkHtml(l) {
  const url = inviteLinkUrl(l.token);
  const [stateLabel, statePill] = linkState(l);
  const codes = L.codes.filter((c) => c.link_id === l.id);
  const used = codes.filter((c) => c.used_by).length;
  const open = L.open.has(l.id);
  const limit = l.max_codes != null ? ` · limite ${esc(l.max_codes)}` : '';
  return `
    <li class="il-item${l.active ? '' : ' is-off'}" data-link="${esc(l.id)}">
      <div class="il-top">
        <div class="il-title">
          <strong>${esc(l.label || 'Lien sans libellé')}</strong>
          <span class="pill ${statePill}">${stateLabel}</span>
        </div>
        <label class="switch il-switch"><input type="checkbox" role="switch" data-il-toggle${l.active ? ' checked' : ''} aria-label="Lien « ${esc(l.label || 'sans libellé')} » actif"><span class="switch-ui" aria-hidden="true"></span><span class="small">${l.active ? 'Actif' : 'Inactif'}</span></label>
      </div>
      <div class="il-url">
        <label class="visually-hidden" for="il-url-${esc(l.id)}">Adresse du lien</label>
        <input id="il-url-${esc(l.id)}" class="input il-url-input" readonly value="${esc(url)}">
        <button class="btn btn-ghost btn-sm" type="button" data-il-copy>${IC.copy} Copier</button>
        <button class="btn btn-ghost btn-sm" type="button" data-il-qr>${IC.qr} QR code</button>
        <button class="btn btn-danger btn-sm btn-icon" type="button" data-il-del aria-label="Supprimer le lien « ${esc(l.label || 'sans libellé')} »" title="Supprimer">${IC.trash}</button>
      </div>
      <p class="small muted il-meta">
        <span><strong class="text">${esc(l.codes_generated ?? codes.length)}</strong> code${(l.codes_generated ?? 0) > 1 ? 's' : ''} généré${(l.codes_generated ?? 0) > 1 ? 's' : ''}${limit}</span>
        <span><strong class="text">${used}</strong> utilisé${used > 1 ? 's' : ''}</span>
        <span>${l.expires_at ? `${new Date(l.expires_at) < new Date() ? 'Expiré le' : 'Expire le'} ${esc(fmtDate(l.expires_at))}` : 'Sans date d\'expiration'}</span>
        <span>Créé le ${esc(fmtDate(l.created_at))}</span>
      </p>
      <details class="il-codes"${open ? ' open' : ''} data-il-details>
        <summary>Codes générés par ce lien (${codes.length})</summary>
        ${codes.length ? `<ul class="il-code-list">${codes.map((c) => `
          <li><span class="code${c.used_by ? ' muted' : ''}">${esc(c.code)}</span>
            <span class="small">${codeState(c)}</span>
            <span class="small muted">demandé le ${esc(fmtDateTime(c.created_at))}</span></li>`).join('')}</ul>`
          : '<p class="small muted">Personne n\'a encore ouvert ce lien.</p>'}
      </details>
    </li>`;
}

/**
 * Redessine toute la section : titre, règles, puis la liste des liens (ou un message d'erreur ou vide).
 */
function render() {
  const r = L.root; if (!r) return;
  r.innerHTML = `
    <h3 class="card-title">Liens d'invitation</h3>
    ${rulesHtml()}
    <p class="muted small">Un lien à partager (Discord, QR code…). Chaque personne qui l'ouvre reçoit son propre code d'invitation, valable ${esc(inviteConfig().validite_heures)} h et utilisable une seule fois. Désactive ou supprime le lien quand tu n'en as plus besoin.</p>
    ${L.error ? `<div class="empty">Impossible de charger les liens : ${esc(errMsg(L.error))}</div>`
      : L.links.length ? `<ul class="il-list">${L.links.map(linkHtml).join('')}</ul>`
      : '<div class="empty">Aucun lien pour l\'instant.</div>'}`;
}

/**
 * Recharge les données puis redessine. Une erreur de chargement est gardée et affichée dans la section.
 */
async function refresh() {
  try { await load(); L.error = null; } catch (e) { L.error = e; }
  render();
}

/* ---------- QR code (bibliothèque légère chargée à la demande) ---------- */
// Module QR mis en cache : chargé une seule fois.
let qrLib = null;
/**
 * Affiche le QR code du lien dans une fenêtre, avec un bouton pour télécharger l'image (GIF).
 * @param {object} l Ligne hg_invite_links (token, label).
 */
async function showQr(l) {
  const url = inviteLinkUrl(l.token);
  if (!qrLib) qrLib = (await import(QR_LIB)).default;
  const qr = qrLib(0, 'M');
  qr.addData(url);
  qr.make();
  const src = qr.createDataURL(8, 16);
  let dlg = $('#il-qr-dlg');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'il-qr-dlg'; dlg.className = 'hg-dialog il-qr-dlg';
    dlg.setAttribute('aria-labelledby', 'il-qr-title');
    document.body.append(dlg);
  }
  // Nom de fichier sûr pour le téléchargement : sans accents, sans espaces ni caractères spéciaux.
  const name = (l.label || 'lien').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'lien';
  dlg.innerHTML = `
    <form method="dialog" class="stack">
      <h2 id="il-qr-title" class="dialog-title">QR code · ${esc(l.label || 'Lien sans libellé')}</h2>
      <img class="il-qr-img" src="${esc(src)}" alt="QR code menant à ${esc(url)}" width="${qr.getModuleCount() * 8 + 32}" height="${qr.getModuleCount() * 8 + 32}">
      <p class="small muted il-qr-url">${esc(url)}</p>
      <div class="btn-row dialog-actions">
        <a class="btn btn-ghost" href="${esc(src)}" download="invitation-${esc(name)}.gif">Télécharger l'image</a>
        <button class="btn btn-primary" value="close" type="submit">Fermer</button>
      </div>
    </form>`;
  dlg.showModal();
}

/* ---------- Événements ---------- */
/* ---------- Événements ---------- */
/**
 * Branche les clics (règles, copier, QR, supprimer), les interrupteurs d'activation et le repli des codes.
 * Appelé une fois au montage : les écouteurs restent attachés à la racine.
 */
let boundRoot = null; // racine déjà câblée : un nouveau montage ne doit pas doubler les écouteurs
function bind() {
  const r = L.root;
  if (!r || boundRoot === r) return;
  boundRoot = r;
  r.addEventListener('click', (ev) => {
    const edit = ev.target.closest?.('[data-il-rules-edit]');
    if (edit) return openRulesDrawer();
    const t = ev.target.closest?.('[data-il-rules-reset]');
    if (t) resetRules(t);
  });
  r.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button');
    if (!t) return;
    const li = t.closest('[data-link]');
    const l = li && L.links.find((x) => x.id === li.dataset.link);
    if (!l) return;
    if (t.hasAttribute('data-il-copy')) return copyText(inviteLinkUrl(l.token));
    if (t.hasAttribute('data-il-qr')) return busy(t, () => showQr(l).catch((e) => { throw new Error(`QR code indisponible (${errMsg(e)}). Copie le lien à la place.`); }));
    if (t.hasAttribute('data-il-del')) {
      const pending = L.codes.filter((c) => c.link_id === l.id && !c.used_by).length;
      const ok = await confirmBox(`Supprimer le lien « ${l.label || 'sans libellé'} » ?`,
        `Le lien ne fonctionnera plus.${pending ? ` ${pending} code${pending > 1 ? 's' : ''} non utilisé${pending > 1 ? 's' : ''} généré${pending > 1 ? 's' : ''} par ce lien ${pending > 1 ? 'seront aussi supprimés' : 'sera aussi supprimé'}.` : ''} Les comptes déjà créés ne sont pas touchés.`,
        { ok: 'Supprimer', danger: true });
      if (!ok) return;
      await busy(t, async () => {
        check(await sb.from('hg_invites').delete().eq('link_id', l.id).is('used_by', null));
        check(await sb.from('hg_invite_links').delete().eq('id', l.id));
        L.open.delete(l.id);
        await refresh(); await L.onChange();
        toast('Lien supprimé', 'ok');
      });
    }
  });
  r.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (!el.matches('[data-il-toggle]')) return;
    const li = el.closest('[data-link]');
    const l = L.links.find((x) => x.id === li?.dataset.link);
    if (!l) return;
    el.disabled = true;
    try {
      check(await sb.from('hg_invite_links').update({ active: el.checked }).eq('id', l.id));
      toast(el.checked ? 'Lien activé' : 'Lien désactivé : il ne donne plus de code', 'ok');
      await refresh();
      $(`[data-link="${CSS.escape(l.id)}"] [data-il-toggle]`, r)?.focus();
    // En cas d'échec, on remet l'interrupteur dans son état précédent pour qu'il reflète la base.
    } catch (e) { el.checked = !el.checked; el.disabled = false; toast(errMsg(e), 'error'); }
  });
  r.addEventListener('toggle', (ev) => {
    const d = ev.target;
    if (!d.matches?.('[data-il-details]')) return;
    const id = d.closest('[data-link]')?.dataset.link;
    if (id) { if (d.open) L.open.add(id); else L.open.delete(id); }
  }, true);
}

/** Point d'entrée (admin.js). pseudoOf(uid) -> pseudo ; onChange() après une suppression de codes. */
export async function mountInviteLinks(root, { me, pseudoOf, onChange } = {}) {
  if (!root) return;
  Object.assign(L, { root, me, pseudoOf: pseudoOf || L.pseudoOf, onChange: onChange || L.onChange });
  bind();
  root.innerHTML = '<div class="empty">Chargement des liens…</div>';
  await loadInviteConfig();
  await refresh();
}
/** Re-rendu (ex. après rechargement des membres, pour les pseudos). */
export function refreshInviteLinks() { return refresh(); }
