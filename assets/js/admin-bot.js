// ===== Humane Gang — administration : bot Discord =====
// Page « Bot Discord » (sept sous-onglets, dans l'ordre) :
//   Connexion (ID du salon d'annonces, ID admin, rôle, notifications, test), Salons (salons connus, puis salons par type
//   d'annonce), Mentions (mention par type), Annonces (annonce libre dans les salons cochés), Messages privés (MP manuels
//   avec pièces jointes et historique), Messages types (modèles, défauts partagés avec les fonctions edge dans
//   supabase/functions/_shared/bot-templates.json), Règles (trois parties : Rappels et envois, Assistance, Planning).
// Réglages stockés dans hg_settings.bot : salons = liste d'objets { id, nom } ; channels[type] = tableau d'IDs de salons
// (5 au plus par type). Ancienne forme (une chaîne, ou birthday_channel_id) lue en repli.
// Rôle : page « Bot Discord » de l'admin. Réglages du bot (salons, mentions, notifications, rappels, assistance, planning),
// édition des messages types avec aperçu façon Discord, envoi d'un message manuel à des membres (avec pièces jointes),
// et historique des envois.
// Dépendances : core.js (Supabase, toast, appel des fonctions edge, avatar, logo), icons.js, utils.js (pluriels),
// admin/list-tools.js (recherche, pagination), admin/ui/drawer.js (tiroir).
// Tables, RPC et stockage : hg_settings (bot, bot_templates, support, planning), hg_bot_log (historique), hg_profiles
// (destinataires), bucket hg-bot-media (pièces jointes), fonctions edge hg-notify et hg-bot-templates.
// Exporte : mountBotSection (montage de la page).
import { sb, toast, errMsg, esc, $, $$, callFn, avatarHtml, currentLogo } from './core.js';
import { svg } from './icons.js';
import { pluralCount } from './utils.js';
import { matches, searchHtml, bindSearch, setCount, emptyHtml, PAGE_SIZE, SEARCH_DELAY } from './admin/list-tools.js';
import { openDrawer } from './admin/ui/drawer.js';

// Adresse du fichier de modèles partagé avec les fonctions edge (textes par défaut des messages types).
const TEMPLATES_URL = new URL('../../supabase/functions/_shared/bot-templates.json', import.meta.url).href;
// Types de notifications du bot : [clé, libellé, ce qui part et où]. Chaque type peut être activé ou coupé.
const NOTIFY = [
  ['draw', 'Tirage du Secret Santa', 'annonce + MP aux participants'],
  ['gift', 'Cadeaux', 'MP « envoyé » / « reçu »'],
  ['irl', 'Nouvelles sorties IRL', 'annonce dans le salon'],
  ['birthday', 'Anniversaires', 'chaque matin : MP + annonce si partagé'],
  ['support', 'Demandes d\'assistance', 'MP à toi'],
  ['messages', 'Nouveaux messages', 'MP au destinataire (pas à chaque message d\'une discussion en cours)'],
  ['card_pull', 'Belle carte obtenue', 'annonce dans le salon : carte légendaire, mythique, identité ou unique, obtenue ou fabriquée'],
  ['card_wish', 'MP : carte de ta liste de souhaits obtenue', 'MP aux membres qui ont la carte dans leur liste de souhaits et ont activé l\'alerte'],
  ['card_trade', 'Échange conclu', 'annonce dans le salon (désactivée par défaut)'],
  ['trade_offer', 'MP : nouvelle offre d\'échange', 'MP au destinataire d\'une offre ou contre-proposition'],
  ['card_gift_admin', 'MP : carte offerte par l\'admin', 'MP au membre qui reçoit une carte de l\'admin ou du Staff (Cartes)'],
  ['card_drop', 'Drop lancé', 'annonce dans le salon quand un drop est lancé avec « Annoncer sur Discord »'],
  ['lg_party', 'Partie de Loup-Garou', 'annonce dans le salon quand un membre crée une partie avec « Annoncer sur le Discord du gang »'],
  ['uno_party', 'Partie de Uno', 'annonce dans le salon quand un membre crée une partie de Uno avec « Annoncer sur le Discord du gang »'],
  ['ndc_party', 'Partie de Nom de code', 'annonce dans le salon quand un membre crée une partie de Nom de code avec « Annoncer sur le Discord du gang »'],
  ['duel_defi', 'MP : défi de duel', 'MP au membre défié à un duel (Puissance 4, Morpion, Mastermind, Bataille navale, Qui est-ce ?) s\'il accepte la catégorie « Jeux »'],
  ['quiz_daily', 'Publier la question du jour', 'chaque matin dans le salon « Question du jour » (à couper pendant les vacances)'],
  ['unwrap', 'Tour de passage au déballage', 'annonce « C’est au tour de … » pendant la soirée déballage du Secret Santa (désactivé par défaut)'],
];
// Seules les clés de NOTIFY, pour parcourir les cases à cocher.
const NOTIFY_KEYS = NOTIFY.map(([k]) => k);
// Annonces publiées dans le salon d'annonces, avec leur mention (bot.mentions[type], défaut « none »)
const MENTION_TYPES = [
  ['draw', 'Tirage du Secret Santa'], ['irl', 'Nouvelles sorties IRL'], ['birthday', 'Anniversaires'],
  ['dyn', 'Événements dynamiques'], ['card_pull', 'Belle carte obtenue'], ['card_trade', 'Échange conclu'],
  ['card_drop', 'Drop lancé'], ['quiz', 'Question du jour'], ['cine', 'Ciné-club'], ['loup_garou', 'Partie de Loup-Garou'], ['uno', 'Partie de Uno'], ['nom_de_code', 'Partie de Nom de code'],
];
// Modes de mention possibles pour une annonce : aucune, le rôle, ou @everyone.
const MENTION_MODES = [['none', 'Aucune'], ['role', 'Le rôle'], ['everyone', '@everyone']];
// Pièces jointes du message manuel : même liste blanche et même limite que hg-bot-media et _shared/bot-media.ts
const MEDIA_BUCKET = 'hg-bot-media', MEDIA_MAX_FILES = 4, MEDIA_MAX_BYTES = 10 * 1024 * 1024;
const MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'application/pdf']);
// Valeur de l'attribut accept du champ de fichiers : les types de la liste blanche.
const MEDIA_ACCEPT = [...MEDIA_TYPES].join(',');
// Un identifiant Discord (salon, rôle, membre) est un nombre de 17 à 20 chiffres.
const DISCORD_ID = /^\d{17,20}$/;
// Longueurs maximales : titre et corps d'un message type (TITLE_MAX, BODY_MAX), titre et corps du message manuel.
// CONFIRM_ABOVE : à partir de ce nombre de destinataires, l'envoi demande confirmation.
const TITLE_MAX = 256, BODY_MAX = 4096, MANUAL_TITLE_MAX = 200, MANUAL_BODY_MAX = 2000, CONFIRM_ABOVE = 5;
// Nombre maximum de destinataires d'un message manuel.
const MAX_RECIPIENTS = 100;
// Salons connus (réglages « salons ») : 25 au plus, nom de 1 à 50 caractères ; par type d'annonce : 5 salons au plus ; annonce libre : 10.
const SALONS_MAX = 25, SALON_NAME_MAX = 50, CHAN_MAX = 5, ANN_MAX = 10;
// Sous-onglets de la page : [identifiant, libellé]. L'ordre est celui de l'affichage et des flèches clavier.
const BOT_TABS = [['connexion', 'Connexion'], ['salons', 'Salons'], ['mentions', 'Mentions'], ['annonces', 'Annonces'], ['mp', 'Messages privés'], ['modeles', 'Messages types'], ['regles', 'Règles']];
// Parties de l'onglet Règles (un seul bloc affiché à la fois) : [identifiant, libellé]. Choix mémorisé sous RSUB_KEY.
const RULE_SUBS = [['rappels', 'Rappels et envois'], ['assistance', 'Assistance'], ['planning', 'Planning']];
const RSUB_KEY = 'hg-admin-bot-regles';
// Sous-onglets dont les réglages sont dans le formulaire #bot-form (enregistrés ensemble).
const SETTINGS_TABS = ['connexion', 'salons', 'mentions'];
// Clé du dernier sous-onglet ouvert, dans le stockage du navigateur (la page fonctionne sans).
const TAB_KEY = 'hg-admin-bot-tab';

// Icônes SVG : recherche, envoi, annuler, ajouter.
const ICON = {
  search: svg('search2', { stroke: 2 }),
  send: svg('send', { stroke: 2 }),
  undo: svg('undo', { stroke: 2 }),
  plus: svg('plus', { stroke: 2 }),
};
// État d'un destinataire possible : libellé et classe CSS (ID Discord manquant, refus des MP, compte sans profil).
const STATUS = {
  ok: ['Discord OK', 'pill-ok'],
  nodiscord: ['Pas d\'ID Discord', 'pill-warn'],
  optout: ['A refusé les MP du bot', 'pill-warn'],
  noprofile: ['Compte sans profil', 'pill-todo'],
};
// Résultat d'un envoi (envoyé, échec, ignoré) : libellé et classe CSS.
// Types d'envoi automatiques (hg_bot_log.kind) : libellés en français pour l'historique.
const KIND_LABEL = { 'auto:cron': 'Annonce auto · Planning', 'auto:anniversaire': 'Annonce auto · Anniversaires', 'auto:tirage': 'Annonce auto · Tirage',
  'auto:evenement': 'Annonce auto · Événement', 'auto:drop': 'Annonce auto · Drop', 'auto:sortie': 'Annonce auto · Sortie',
  'auto:carte': 'Annonce auto · Belle carte', 'auto:echange': 'Annonce auto · Échange' };
/** Libellé d'un type d'envoi (repli sur le code brut si inconnu). */
const kindLabel = (k) => KIND_LABEL[k] ?? k;
const RESULT = { sent: ['Envoyé', 'pill-ok'], failed: ['Échec', 'bm-pill-fail'], skipped: ['Ignoré', 'pill-todo'] };

/** Renvoie les données d'une réponse Supabase, ou lève l'erreur si la requête a échoué. */
function check(res) { if (res.error) throw res.error; return res.data; }
/** Comparaison sans accents ni casse. */
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Heure seule (HH:MM), pour l'aperçu Discord.
const timeFmt = new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit' });
// Date et heure complètes, pour l'historique.
const logFmt = new Intl.DateTimeFormat('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
/** Vrai si la valeur est une chaîne non vide (les espaces seuls ne comptent pas). */
const filled = (v) => typeof v === 'string' && v.trim() !== '';
/**
 * Réglages du bot normalisés. Salons connus : liste sans doublon (nom par défaut « Salon <id> »). Salons par type :
 * tableau d'IDs valides, 5 au plus. L'ancienne forme (une chaîne par type) devient un tableau d'un élément ; un salon
 * référencé mais absent de la liste y est ajouté, pour ne rien perdre. Liste vide des anniversaires : birthday_channel_id.
 * @param {object} raw Valeur stockée de hg_settings.bot.
 * @returns {object} Copie de raw avec salons et channels normalisés.
 */
function normalizeBot(raw) {
  const bot = { ...raw };
  const salons = [], seen = new Set();
  const addSalon = (id, nom) => {
    if (typeof id !== 'string' || !DISCORD_ID.test(id) || seen.has(id)) return;
    seen.add(id);
    salons.push({ id, nom: filled(nom) ? nom.trim().slice(0, SALON_NAME_MAX) : `Salon ${id}` });
  };
  for (const s of Array.isArray(bot.salons) ? bot.salons : []) addSalon(s?.id, s?.nom);
  const stored = bot.channels && typeof bot.channels === 'object' && !Array.isArray(bot.channels) ? bot.channels : {};
  /** Liste d'IDs valides, sans doublon, 5 au plus (une chaîne seule devient une liste). */
  const ids = (v) => [...new Set((Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string' && DISCORD_ID.test(x)))].slice(0, CHAN_MAX);
  const channels = {};
  for (const [k] of MENTION_TYPES) {
    let list = ids(stored[k]);
    if (!list.length && k === 'birthday') list = ids(bot.birthday_channel_id);
    if (list.length) { channels[k] = list; list.forEach((id) => addSalon(id, null)); }
  }
  return { ...bot, salons, channels };
}

/** Texte d'aide sous le choix de mention : ce qui se passe selon que le salon est choisi et qu'un rôle est configuré. */
function mentionHint(on, hasRole) {
  return !on ? 'Active la publication dans le salon pour choisir une mention.'
    : hasRole ? 'Le rôle notifie ses membres ; @everyone notifie tout le serveur.'
      : 'Aucun rôle configuré : renseigne son ID dans les réglages du bot pour le mentionner.';
}
/**
 * Choix de mention d'un formulaire : « Le rôle » n'est proposé que si un rôle est configuré, le choix est grisé si on est faux.
 * @param {HTMLSelectElement} sel Liste des mentions.
 * @param {HTMLElement} hint Texte d'aide sous la liste.
 * @param {boolean} on Vrai si une publication dans un salon est prévue.
 * @param {string|null} roleId Rôle configuré (mention_role_id).
 */
function syncMentionSelect(sel, hint, on, roleId) {
  const hasRole = !!roleId;
  sel.querySelector('option[value="role"]').disabled = !hasRole;
  if (!hasRole && sel.value === 'role') sel.value = 'none';
  sel.disabled = !on;
  hint.textContent = mentionHint(on, hasRole);
}

/**
 * HTML du champ « Pièces jointes » d'un formulaire. p : préfixe des identifiants (bm- ou ann-). Le comportement est dans attachmentUI.
 * @param {string} p
 * @returns {string}
 */
function attachFieldHtml(p) {
  return `<div class="field bm-files" id="${p}files">
    <span class="label" id="${p}files-l">Pièces jointes <span class="muted small">(facultatif · ${MEDIA_MAX_FILES} fichiers maximum · 10 Mo chacun)</span></span>
    <div class="bm-drop" id="${p}drop" role="button" tabindex="0" aria-describedby="${p}files-l ${p}file-err">
      <span class="bm-drop-main">Glisse des fichiers ici ou <span class="bm-drop-link">choisis-les</span></span>
      <span class="muted small">Images, GIF, vidéos, sons, PDF</span>
    </div>
    <input type="file" id="${p}file-input" multiple accept="${MEDIA_ACCEPT}" hidden>
    <p class="bm-file-err" id="${p}file-err" role="alert" hidden></p>
    <ul class="bm-file-list" id="${p}file-list" aria-labelledby="${p}files-l"></ul>
  </div>`;
}

/**
 * Pièces jointes d'un formulaire (champ construit par attachFieldHtml) : ajout par clic, Entrée ou glisser-déposer,
 * retrait, aperçu d'image, téléversement dans hg-bot-media. onChange est appelé après chaque ajout, retrait ou vidage.
 * @param {HTMLElement} root Conteneur du formulaire.
 * @param {string} p Préfixe des identifiants (ex. « bm- »).
 * @param {() => void} onChange Rappel après un changement de la liste.
 * @returns {{files: () => {file: File, url: string|null}[], clear: () => void, upload: (done: string[]) => Promise<string[]>}}
 */
function attachmentUI(root, p, onChange) {
  const list = []; // { file, url } : url = aperçu d'une image (libéré au retrait)
  const q = (s) => $(`#${p}${s}`, root);
  /** Affiche le message d'erreur des pièces jointes, ou l'efface si msg est vide. */
  const showErr = (msg) => { const box = q('file-err'); box.textContent = msg; box.hidden = !msg; };
  /** Dessine la liste (aperçu ou extension, taille, retirer) et l'état de la zone de dépôt, puis prévient l'appelant. */
  const render = () => {
    q('file-list').innerHTML = list.map((f, i) => {
      const ext = (f.file.name.split('.').pop() || '').slice(0, 4).toUpperCase();
      return `<li class="bm-file">
        <span class="bm-file-thumb">${f.url ? `<img src="${esc(f.url)}" alt="">` : `<span class="bm-file-ext">${esc(ext)}</span>`}</span>
        <span class="bm-file-meta"><span class="bm-file-name">${esc(f.file.name)}</span><span class="small muted">${esc(fmtSize(f.file.size))}</span></span>
        <button type="button" class="btn btn-ghost btn-sm" data-file-remove="${i}" aria-label="Retirer ${esc(f.file.name)}">Retirer</button>
      </li>`;
    }).join('');
    q('drop').setAttribute('aria-disabled', String(list.length >= MEDIA_MAX_FILES));
    onChange();
  };
  /** Ouvre le sélecteur si la limite n'est pas atteinte, sinon affiche l'erreur. */
  const openPicker = () => { if (list.length < MEDIA_MAX_FILES) q('file-input').click(); else showErr(`${MEDIA_MAX_FILES} fichiers maximum par envoi.`); };
  /** Ajoute des fichiers choisis ou glissés, en refusant clairement ceux qui ne passent pas. */
  const add = (picked) => {
    const errors = [];
    for (const file of [...picked]) {
      if (list.length >= MEDIA_MAX_FILES) { errors.push(`${MEDIA_MAX_FILES} fichiers maximum par envoi.`); break; }
      if (!MEDIA_TYPES.has(file.type)) { errors.push(`« ${file.name} » : type de fichier non autorisé (images, GIF, vidéos, sons ou PDF).`); continue; }
      if (file.size > MEDIA_MAX_BYTES) { errors.push(`« ${file.name} » fait ${fmtSize(file.size)} : 10 Mo maximum par fichier.`); continue; }
      if (list.some((f) => f.file.name === file.name && f.file.size === file.size)) continue; // doublon
      list.push({ file, url: file.type.startsWith('image/') ? URL.createObjectURL(file) : null });
    }
    showErr(errors.join(' '));
    render();
  };
  /** Retire une pièce jointe et libère son aperçu. */
  const remove = (i) => {
    const [f] = list.splice(i, 1);
    if (f?.url) URL.revokeObjectURL(f.url);
    showErr('');
    render();
  };
  /** Vide la liste et libère les aperçus. */
  const clear = () => {
    for (const f of list) if (f.url) URL.revokeObjectURL(f.url);
    list.length = 0;
    q('file-input').value = '';
    render();
  };
  // Téléversement dans hg-bot-media (manuel/<date>/<uuid>-<nom>). Les chemins réussis vont dans done.
  const upload = async (done) => {
    const day = dayStamp();
    for (const f of list) {
      const path = `manuel/${day}/${uuid()}-${storageName(f.file.name)}`;
      check(await sb.storage.from(MEDIA_BUCKET).upload(path, f.file, { contentType: f.file.type, upsert: false, cacheControl: '3600' }));
      done.push(path);
    }
    return done;
  };
  // Liaisons : clic ou Entrée/Espace, glisser-déposer, choix du fichier, retrait par ligne.
  const drop = q('drop'), input = q('file-input');
  drop.addEventListener('click', openPicker);
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); add(e.dataTransfer?.files ?? []); });
  input.addEventListener('change', () => { add(input.files ?? []); input.value = ''; });
  q('file-list').addEventListener('click', (e) => { const b = e.target.closest('[data-file-remove]'); if (b) remove(Number(b.dataset.fileRemove)); });
  return { files: () => list.slice(), clear, upload };
}


/** Ajoute la feuille de style de la page du bot, une seule fois. */
function loadStyles() {
  if (document.querySelector('link[data-admin-bot]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('../css/admin-bot.css', import.meta.url).href; l.dataset.adminBot = '';
  document.head.append(l);
}

/** Message d'erreur lisible, y compris le JSON { error } renvoyé par une fonction edge. */
async function fnError(e) {
  try {
    const ctx = e?.context;
    if (ctx && typeof ctx.json === 'function') {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
    }
  } catch { /* corps illisible */ }
  return errMsg(e);
}

/* ---------- Rendu des modèles (même logique que supabase/functions/_shared/templates.ts) ---------- */
/**
 * Remplace les variables {nom} d'un modèle par leurs valeurs. Une variable non autorisée devient vide.
 * Même règle que les fonctions edge (templates.ts).
 * @param {string} text Modèle.
 * @param {object} vars Valeurs par nom de variable.
 * @param {Set<string>} [allowed] Variables autorisées (toutes si absent).
 * @returns {string}
 */
function fillVars(text, vars, allowed) {
  return String(text ?? '').replace(/\{([a-z_]+)\}/g, (_m, name) => (allowed && !allowed.has(name) ? '' : String(vars[name] ?? '')));
}
/** Coupe un texte à n caractères ; « … » remplace la fin si nécessaire. */
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
/** Liste des variables {nom} d'un texte qui ne sont pas autorisées pour ce modèle (à signaler à l'admin). */
const unknownVars = (text, allowed) => [...new Set([...String(text ?? '').matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((v) => !allowed.has(v)))];

/** Mini-markdown Discord pour l'aperçu (gras, italique, souligné, barré, code, liens). Le texte est échappé d'abord. */
function discordMd(text) {
  let h = esc(text);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<]+)/g, (_m, label, url, bare) => `<span class="dc-link">${label ?? bare}</span>`);
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/__([^_\n]+)__/g, '<u>$1</u>');
  h = h.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  h = h.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return h;
}

/**
 * Aperçu façon Discord. `embed` : { color, title, description, fields: [[nom, valeur]], footer, image }, `content` facultatif.
 * `mention` : « @everyone » ou « @rôle » affiché en tête du message (une mention notifie, elle n'est jamais dans l'embed).
 * `files` : [{ name, size, url, image }] : pièces jointes ; une image jointe est affichée dans l'embed (embed.image).
 */
function discordPreview({ content = '', mention = '', embed, where = '', files = [] }) {
  const now = timeFmt.format(new Date());
  const fields = (embed.fields ?? []).filter(([, v]) => filled(v));
  const others = files.filter((f) => !f.inEmbed);
  return `
    <div class="dc" role="img" aria-label="Aperçu du message Discord">
      ${where ? `<div class="dc-where">${esc(where)}</div>` : ''}
      <div class="dc-msg">
        <img class="dc-avatar" src="${esc(currentLogo())}" alt="">
        <div class="dc-main">
          <div class="dc-head"><span class="dc-name">Humane Gang</span><span class="dc-app">APP</span><span class="dc-time">Aujourd'hui à ${now}</span></div>
          ${mention ? `<div class="dc-content"><span class="dc-mention">${esc(mention)}</span></div>` : ''}
          ${content ? `<div class="dc-content">${discordMd(content)}</div>` : ''}
          <div class="dc-embed" style="--dc-bar:${esc(embed.color || '#9E3543')}">
            ${embed.title ? `<div class="dc-title${embed.url ? ' dc-title-link' : ''}">${discordMd(embed.title)}</div>` : ''}
            ${embed.description ? `<div class="dc-desc">${discordMd(embed.description)}</div>` : ''}
            ${!embed.title && !embed.description && !embed.image ? '<div class="dc-desc dc-empty">(message vide)</div>' : ''}
            ${embed.image ? `<img class="dc-img" src="${esc(embed.image)}" alt="">` : ''}
            ${fields.length ? `<div class="dc-fields">${fields.map(([n, v]) => `<div class="dc-field"><div class="dc-fname">${esc(n)}</div><div class="dc-fval">${discordMd(v)}</div></div>`).join('')}</div>` : ''}
            <div class="dc-footer">${esc(embed.footer || 'Humane Gang')} • Aujourd'hui à ${now}</div>
          </div>
          ${others.length ? `<div class="dc-files">${others.map((f) => `<div class="dc-file"><span class="dc-file-name">${esc(f.name)}</span><span class="dc-file-size">${esc(fmtSize(f.size))}</span></div>`).join('')}</div>` : ''}
        </div>
      </div>
    </div>`;
}

/** Taille lisible d'un fichier, en Ko ou en Mo (virgule décimale). */
const fmtSize = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} Ko` : `${(n / 1048576).toFixed(1).replace('.', ',')} Mo`);
/** Nom de fichier envoyé au stockage : sans séparateur de chemin, sans « .. » (refusés par la fonction). */
const storageName = (name) => String(name).normalize('NFC').replace(/[\\/\u0000]/g, '_').replace(/\.{2,}/g, '.').trim().slice(0, 120) || 'fichier';
/** Identifiant aléatoire (crypto.randomUUID n'existe que sur https : le site peut aussi être servi en http local). */
const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID()
  : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
/** Date du jour au format AAAA-MM-JJ, heure locale. */
const dayStamp = () => new Date().toLocaleDateString('sv-SE'); // AAAA-MM-JJ, heure locale

/* ---------- Réglages lot 5 : rappels, envois, assistance, planning ---------- */
// Défauts = comportement d'avant les réglages (supabase/functions/_shared/reglages.ts). Bornes = celles que le serveur accepte.
const RULE_DEF = { irl_long: 24, irl_short: 2, ss_jours: 3, dyn_retard: 24, top_n: 3, pieces_max: 4, piece_max_mo: 10, destinataires_max: 100, corps_max: 2000, annonces_heure: 20 };
const RULE_MIN_MAX = { irl_long: [1, 168], irl_short: [1, 167], ss_jours: [1, 30], dyn_retard: [1, 168], top_n: [1, 10], pieces_max: [1, 10], piece_max_mo: [1, 25], destinataires_max: [1, 100], corps_max: [1, 4000], annonces_heure: [1, 500] };
const RULE_GROUPS = {
  rappels: { title: 'Rappels', keys: ['irl_long', 'irl_short', 'ss_jours'] },
  dyn: { title: 'Événements dynamiques', keys: ['dyn_retard', 'top_n'] },
  envoi: { title: 'Message manuel (MP et pièces jointes)', keys: ['pieces_max', 'piece_max_mo', 'destinataires_max', 'corps_max'] },
  limites: { title: 'Anti-abus des membres', keys: ['annonces_heure'] },
};
const RULE_TXT = {
  irl_long: ['Rappel de sortie : délai (heures avant)', 'MP aux membres « oui » ou « peut-être » quand la sortie est dans moins de ce délai. Défaut : 24.'],
  irl_short: ['Second rappel de sortie (heures avant)', 'Doit être plus court que le premier. Défaut : 2.'],
  ss_jours: ['Rappel de cadeau Secret Santa (jours avant la date limite)', 'MP au Santa qui n\'a pas encore marqué son envoi. Défaut : 3.'],
  dyn_retard: ['Délai de grâce après la fin d\'un événement (heures)', 'Au-delà, la fin n\'est plus annoncée dans le salon. Défaut : 24.'],
  top_n: ['Nombre de chasseurs au classement de fin', 'Taille du classement annoncé à la fin d\'un événement. Défaut : 3.'],
  pieces_max: ['Pièces jointes par envoi', 'Maximum 10. Défaut : 4.'],
  piece_max_mo: ['Taille maximale d\'une pièce (Mo)', 'Maximum 25 Mo (limite de Discord pour un bot). Défaut : 10.'],
  destinataires_max: ['Destinataires par envoi', 'Maximum 100. Défaut : 100.'],
  corps_max: ['Longueur du message manuel (caractères)', 'Maximum 4000 (limite d\'un message Discord). Défaut : 2000.'],
  annonces_heure: ['Annonces et MP déclenchés par un membre, par heure', 'Nouvelle sortie, message, carte, échange, etc. : au-delà de ce nombre sur une heure glissante, les envois de ce membre sont refusés jusqu’à la fin de l’heure (les administrateurs ne sont pas limités). Défaut : 20.'],
};
const BUG_SUBJECT = 'Bug sur le site'; // le badge « Chasseur de bugs » s'appuie sur ce sujet (migration 041)
const SUPPORT_DEF = {
  sujets: ['Problème de compte / connexion', 'Secret Santa', 'Sortie IRL', BUG_SUBJECT, 'Mes données personnelles', 'Autre'],
  max_par_heure: 5, visiteur_max_par_heure: 5, visiteurs_total_par_heure: 200, message_min: 10, message_max: 4000, mp_max: 1500, delai_reponse_jours: 30,
};
const SUPPORT_MIN_MAX = {
  max_par_heure: [1, 100], visiteur_max_par_heure: [1, 100], visiteurs_total_par_heure: [1, 10000], message_min: [1, 1000],
  message_max: [1, 4000], mp_max: [100, 4000], delai_reponse_jours: [1, 365],
};
// Signalements de contenus (support.signalements, lus par hg_report_rules) : clés imbriquées, bornes comme la base.
const SIG_DEF = { seuil_masquage: 3, plafond_jour: 10 };
const SIG_MIN_MAX = { seuil_masquage: [2, 10], plafond_jour: [1, 50] };
const SIG_KEYS = Object.keys(SIG_MIN_MAX);
const SUPPORT_GROUPS = {
  sujets: { title: 'Sujets proposés', keys: ['sujets'] },
  limites: { title: 'Limites anti-abus (par heure)', keys: ['max_par_heure', 'visiteur_max_par_heure', 'visiteurs_total_par_heure'] },
  messages: { title: 'Longueur des messages', keys: ['message_min', 'message_max', 'mp_max'] },
  reponse: { title: 'Délai de réponse', keys: ['delai_reponse_jours'] },
  signalements: { title: 'Signalements de contenus', keys: SIG_KEYS },
};
const SUPPORT_TXT = {
  max_par_heure: ['Par compte connecté', 'Demandes maximum par heure pour un membre connecté. Défaut : 5.'],
  visiteur_max_par_heure: ['Par visiteur (même contact ou même connexion)', 'Défaut : 5.'],
  visiteurs_total_par_heure: ['Total des visiteurs', 'Garde-fou global contre une attaque répartie : au-delà, les demandes des visiteurs sont enregistrées sans MP à l’admin ; refus seulement au-delà de 5 fois ce nombre. Défaut : 200.'],
  message_min: ['Message : minimum (caractères)', 'Défaut : 10.'],
  message_max: ['Message : maximum (caractères)', 'Défaut : 4000.'],
  mp_max: ['Longueur du message dans le MP à l\'admin', 'Au-delà, le MP est tronqué ; la demande reste complète dans la liste. Défaut : 1500.'],
  delai_reponse_jours: ['Délai de réponse annoncé (jours)', 'Affiché au visiteur après l\'envoi. Défaut : 30.'],
};
const SIG_TXT = {
  seuil_masquage: ['Masquage automatique (nombre de membres)', 'Un contenu signalé par ce nombre de membres différents est masqué tout de suite ; le Staff le voit dans la file. Entre 2 et 10. Défaut : 3.'],
  plafond_jour: ['Signalements par membre (sur 24 h)', 'Au-delà, le membre ne peut plus signaler pendant 24 h. Entre 1 et 50. Défaut : 10.'],
};
// Libellés et bornes de tous les réglages numériques de l'assistance (plats et signalements).
const NUM_TXT = { ...SUPPORT_TXT, ...SIG_TXT }, NUM_MIN_MAX = { ...SUPPORT_MIN_MAX, ...SIG_MIN_MAX };
// Valeur par défaut du planning : envoi des anniversaires à 8 h (heure suisse).
const PLANNING_DEF = { anniversaires_heure_locale: 8, quiz_jour_heure_locale: 9 };

/**
 * HTML d'un champ numérique de réglage : libellé, aide, et bornes min et max acceptées.
 * @param {string} form Préfixe de l'identifiant (rules, support, planning).
 * @param {string} k Nom du réglage.
 * @param {string[]} libelleAide Libellé puis aide du réglage.
 * @param {number[]} bornes Minimum puis maximum acceptés.
 * @returns {string}
 */
const numField = (form, k, [label, help], [min, max]) => `<div class="field">
  <label for="${form}-${k}">${esc(label)}</label>
  <input id="${form}-${k}" name="${k}" type="number" min="${min}" max="${max}" step="1" inputmode="numeric" aria-describedby="${form}-${k}-h">
  <p class="small muted" id="${form}-${k}-h">${esc(help)}</p></div>`;
/** Bouton « Rétablir les valeurs par défaut » d'un groupe de réglages. */
const resetBtn = (form, group) => `<button class="btn btn-ghost btn-sm" type="button" data-form="${form}" data-reset-group="${group}">Rétablir les valeurs par défaut</button>`;
/**
 * En-tête d'un groupe de réglages : titre à gauche, bouton « Rétablir » aligné à droite sur la même ligne.
 * @param {string} form Préfixe du formulaire (rules, support, planning).
 * @param {string} g Nom du groupe.
 * @param {string} title Titre affiché.
 * @returns {string}
 */
const grpHead = (form, g, title) => `<div class="bot-grp-head">
        <h4 class="bot-grp-title" id="${form}-grp-${g}">${esc(title)}</h4>
        ${resetBtn(form, g)}
      </div>`;
/** Ouverture d'un groupe de réglages (libellé relié à son titre). */
const grpOpen = (form, g) =>`<div class="bot-grp bot-grp-${g}" role="group" aria-labelledby="${form}-grp-${g}">`;

/**
 * HTML de la carte « Rappels, annonces et envois » : trois groupes de champs numériques, chacun avec son bouton de retour aux défauts.
 * @returns {string}
 */
function rulesCardHtml() {
  const groups = `<div class="bot-groups is-pair">${Object.entries(RULE_GROUPS).map(([g, def]) => `
    ${grpOpen('rules', g)}
      ${grpHead('rules', g, def.title)}
      <div class="bot-grp-grid is-${def.keys.length}">${def.keys.map((k) => numField('rules', k, RULE_TXT[k], RULE_MIN_MAX[k])).join('')}</div>
    </div>`).join('')}</div>`;
  return `<form class="card stack" id="rules-form" novalidate>
      <div>
        <h3 class="card-title">Rappels, annonces et envois</h3>
        <p class="muted small">Délais et limites du bot. « Enregistrer » sauve tous les champs ; « Rétablir » remet un groupe à ses valeurs d'origine.</p>
      </div>
      ${groups}
      <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer les rappels et limites</button></div>
    </form>`;
}

/**
 * HTML de la carte « Assistance » : sujets proposés (une ligne par sujet), puis les limites anti-abus et les longueurs.
 * @returns {string}
 */
function supportCardHtml() {
  const sujets = `<div class="field">
      <label for="support-sujets">Sujets proposés dans le formulaire</label>
      <textarea id="support-sujets" name="sujets" rows="5" aria-describedby="support-sujets-h"></textarea>
      <p class="small muted" id="support-sujets-h">Un sujet par ligne (20 maximum, 80 caractères chacun). « ${esc(BUG_SUBJECT)} » doit rester : le badge Chasseur de bugs s'appuie dessus.</p></div>`;
  const groups = `<div class="bot-groups is-pair">${Object.entries(SUPPORT_GROUPS).map(([g, def]) => `
    ${grpOpen('support', g)}
      ${grpHead('support', g, def.title)}
      ${g === 'sujets' ? sujets : `<div class="bot-grp-grid is-${def.keys.length}">${def.keys.map((k) => numField('support', k, NUM_TXT[k], NUM_MIN_MAX[k])).join('')}</div>`}
    </div>`).join('')}</div>`;
  return `<form class="card stack" id="support-cfg-form" novalidate>
      <div>
        <h3 class="card-title">Assistance</h3>
        <p class="muted small">Ce que voient les visiteurs et les membres sur le formulaire d'assistance, et les limites appliquées côté serveur.</p>
      </div>
      ${groups}
      <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer l'assistance</button></div>
    </form>`;
}

/**
 * HTML de la carte « Planning » : heure d'envoi des anniversaires (0 à 23 h, heure suisse).
 * @returns {string}
 */
function planningCardHtml() {
  const opts = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${String(h).padStart(2, '0')} h</option>`).join('');
  return `<form class="card stack" id="planning-form" novalidate>
      <div>
        <h3 class="card-title">Planning des tâches automatiques</h3>
        <p class="muted small">Les tâches automatiques tournent à fréquence fixe ; ce réglage décide quand elles agissent.</p>
      </div>
      ${grpOpen('planning', 'anniversaires')}
        ${grpHead('planning', 'anniversaires', 'Anniversaires')}
        <div class="bot-grp-grid is-1">
          <div class="field">
            <label for="planning-birthday">Heure d'envoi (heure suisse)</label>
            <select id="planning-birthday" name="anniversaires_heure_locale" aria-describedby="planning-birthday-h">${opts}</select>
            <p class="small muted" id="planning-birthday-h">Fixe toute l'année : les anniversaires partent à cette heure (HH h 05), heure suisse, en été comme en hiver. Défaut : 8 h.</p>
          </div>
        </div>
      </div>
      ${grpOpen('planning', 'quiz')}
        ${grpHead('planning', 'quiz', 'Question du jour')}
        <div class="bot-grp-grid is-1">
          <div class="field">
            <label for="planning-quiz">Heure de publication (heure suisse)</label>
            <select id="planning-quiz" name="quiz_jour_heure_locale" aria-describedby="planning-quiz-h">${opts}</select>
            <p class="small muted" id="planning-quiz-h">La question du jour change à 6 h ; le bot la publie à cette heure, une fois par jour. Défaut : 9 h.</p>
          </div>
        </div>
      </div>
      <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer le planning</button></div>
    </form>`;
}

/* ========================================================================== */
/**
 * Affiche la page du bot dans le conteneur et branche ses sections (réglages, modèles, envoi manuel, historique).
 * Les réglages et les modèles sont chargés depuis la base au montage.
 * @param {HTMLElement} container Élément qui recevra la page.
 */
export function mountBotSection(container) {
  if (!container) return;
  loadStyles();
  // État de la page : réglages du bot, assistance et planning, filtres de l'historique, modèles (défauts, personnalisés, brouillons),
  // destinataires choisis et pièces jointes du message manuel.
  let settingsLoaded = false; // vrai une fois hg_settings lu : sans lecture, aucune écriture (sinon les réglages seraient écrasés)
  const S = {
    bot: { announce_channel_id: null, birthday_channel_id: null, channels: {}, salons: [], admin_discord_id: null, mention_role_id: null, mentions: {}, notify: {} },
    salonDraft: { salons: [], channels: {} }, // salons connus et salons par type en cours d'édition (enregistrés avec « Enregistrer »)
    salonAsk: null, // identifiant du salon dont le retrait attend une confirmation
    tab: 'connexion', // sous-onglet affiché
    annSel: new Set(), annInit: false, annSending: false, // annonce libre : salons cochés, premier passage, envoi en cours
    support: {}, planning: {},
    histFilter: 'all', histQ: '', histLimit: PAGE_SIZE, histMore: false,
    defs: null, custom: {}, drafts: new Map(), current: null, lastField: 'body',
    people: [], pseudo: new Map(), selected: new Set(), q: '', history: null, sending: false,
  };

  // Squelette HTML de la page : sous-onglets, puis un panneau par onglet. Les formulaires et champs gardent leurs identifiants.
  container.innerHTML = `
    <div class="bot-admin">
      <div class="bot-tabs" id="bot-tablist" role="tablist" aria-label="Sections du bot Discord">
        ${BOT_TABS.map(([id, label]) => `<button type="button" role="tab" class="bot-tab" id="bot-tab-${id}" data-tab="${id}" aria-controls="bot-p-${id}" aria-selected="false" tabindex="-1">${esc(label)}</button>`).join('')}
      </div>

      <form class="bot-settings" id="bot-form" novalidate>
        <section class="card stack bot-panel" role="tabpanel" id="bot-p-connexion" aria-labelledby="bot-tab-connexion">
          <div>
            <h3 class="card-title">Connexion</h3>
            <p class="muted small">Le jeton du bot n'est jamais stocké ici : il se règle dans les secrets Supabase. Toute la marche à suivre est dans le <a href="https://github.com/domursan/human-gang/blob/main/docs/BOT.md" target="_blank" rel="noopener">guide du bot</a>.</p>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="bot-channel">ID du salon d'annonces</label>
              <input id="bot-channel" name="announce_channel_id" inputmode="numeric" autocomplete="off" placeholder="ex. 112233445566778899">
            </div>
            <div class="field">
              <label for="bot-admin">Ton ID Discord (MP assistance)</label>
              <input id="bot-admin" name="admin_discord_id" inputmode="numeric" autocomplete="off" placeholder="ex. 998877665544332211">
            </div>
          </div>
          <div class="field">
            <label for="bot-role">ID du rôle à mentionner <span class="muted small">(facultatif)</span></label>
            <input id="bot-role" name="mention_role_id" inputmode="numeric" autocomplete="off" placeholder="ex. 445566778899001122" aria-describedby="bot-role-hint">
            <p class="small muted" id="bot-role-hint">Dans Discord, active le <em>mode développeur</em> (Paramètres › Avancés), puis fais un clic droit sur le rôle › <em>Copier l'identifiant</em>.</p>
          </div>
          <fieldset class="toggles">
            <legend class="label">Notifications envoyées</legend>
            <div class="notif-grid">
              ${NOTIFY.map(([k, label, hint]) => `<label class="switch"><input type="checkbox" role="switch" name="${k}"><span class="switch-ui" aria-hidden="true"></span><span>${esc(label)} <span class="muted small">${esc(hint)}</span></span></label>`).join('')}
            </div>
          </fieldset>
          <div class="btn-row">
            <button class="btn btn-primary" type="submit">Enregistrer</button>
            <label class="small muted" for="bot-test-type">Tester le salon</label>
            <select id="bot-test-type" name="test_type">
              <option value="">Salon d'annonces</option>
              ${MENTION_TYPES.map(([k, label]) => `<option value="${k}">${esc(label)}</option>`).join('')}
            </select>
            <button class="btn btn-ghost" type="button" id="bot-test">Envoyer un message de test</button>
          </div>
        </section>

        <section class="card stack bot-panel" role="tabpanel" id="bot-p-salons" aria-labelledby="bot-tab-salons" hidden>
          <div>
            <h3 class="card-title">Salons</h3>
            <p class="muted small">Les salons où le bot publie. Ajoute-les ici (${SALONS_MAX} au plus), puis coche, pour chaque type d'annonce, les salons où elle part. Chaque changement est enregistré tout de suite.</p>
          </div>
          <div class="salon-block">
            <h4 class="label" id="bot-salons-h">Salons connus</h4>
            <ul class="salon-list" id="bot-salon-list" aria-labelledby="bot-salons-h"></ul>
            <p class="small muted" id="bot-salon-none" hidden>Aucun salon pour l'instant.</p>
            <div class="salon-add">
              <div class="field">
                <label for="bot-salon-name">Nom du salon</label>
                <input id="bot-salon-name" maxlength="${SALON_NAME_MAX}" autocomplete="off" placeholder="ex. annonces">
              </div>
              <div class="field">
                <label for="bot-salon-id">ID du salon</label>
                <input id="bot-salon-id" inputmode="numeric" autocomplete="off" placeholder="ex. 112233445566778899" aria-describedby="bot-salon-hint">
              </div>
              <p class="small muted salon-add-help" id="bot-salon-hint">Dans Discord, active le <em>mode développeur</em>, puis fais un clic droit sur le salon › <em>Copier l'identifiant</em>.</p>
              <button type="button" class="btn btn-ghost" id="bot-salon-add">${ICON.plus}Ajouter un salon</button>
            </div>
            <p class="bot-salon-err" id="bot-salon-err" role="alert" hidden></p>
          </div>
          <fieldset class="channels" id="bot-channels">
            <legend class="label">Où part chaque type d'annonce</legend>
            <p class="small muted">Coche les salons où part chaque annonce (<strong>5 au plus par type</strong>). <strong>Aucune case cochée = salon d'annonces par défaut.</strong> Les messages privés ne sont pas concernés.</p>
            <div id="bot-chan-list"></div>
          </fieldset>
          <p class="small muted" id="bot-salons-dirty" role="status" hidden>Modifications non enregistrées : pense à enregistrer.</p>
          <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer</button></div>
        </section>

        <section class="card stack bot-panel" role="tabpanel" id="bot-p-mentions" aria-labelledby="bot-tab-mentions" hidden>
          <fieldset class="mentions" id="bot-mentions">
            <legend class="label">Mention dans le salon de l'annonce</legend>
            <p class="small muted">« Le rôle » notifie les membres de ce rôle. <strong>« @everyone » notifie tout le serveur</strong> : à réserver aux annonces vraiment importantes. Par défaut, aucune mention.</p>
            <p class="small muted" id="bot-mentions-off" hidden>Renseigne d'abord un salon (d'annonces ou par type) pour choisir une mention.</p>
            <div class="mention-list">
              ${MENTION_TYPES.map(([k, label]) => `<div class="mention-row">
                <label for="bot-mention-${k}">${esc(label)}</label>
                <select id="bot-mention-${k}" name="mention_${k}">${MENTION_MODES.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>
              </div>`).join('')}
            </div>
          </fieldset>
          <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer</button></div>
        </section>
      </form>

      <section class="bot-panel" role="tabpanel" id="bot-p-annonces" aria-labelledby="bot-tab-annonces" hidden>
        <div class="card stack ann-card" id="ann-card">
          <div>
            <h3 class="card-title">Annonce libre</h3>
            <p class="muted small">Un message publié dans les salons choisis, sans MP. Les salons se règlent dans l'onglet Salons. Pour écrire à des membres, voir Messages privés.</p>
          </div>
          <div class="bm-layout">
            <fieldset class="bm-recipients" id="ann-channels">
              <legend class="label">Salons</legend>
              <p class="small muted bm-count" id="ann-chan-count" aria-live="polite"></p>
              <div class="bm-list" id="ann-chan-list"></div>
              <p class="small muted" id="ann-chan-none" hidden>Aucun salon disponible. Ajoute-en dans l'onglet Salons, ou renseigne le salon d'annonces par défaut dans Connexion.</p>
            </fieldset>
            <form class="bm-compose stack" id="ann-form" novalidate>
              <div class="field bm-mention-field">
                <label for="ann-mention">Mention dans le salon</label>
                <select id="ann-mention" name="ann_mention" aria-describedby="ann-mention-hint">
                  ${MENTION_MODES.map(([v, t]) => `<option value="${v}">${esc(v === 'everyone' ? '@everyone (tout le serveur)' : t)}</option>`).join('')}
                </select>
                <p class="small muted" id="ann-mention-hint"></p>
              </div>
              <div class="field">
                <div class="bt-label-row"><label for="ann-title">Titre <span class="muted small">(facultatif)</span></label><span class="muted small bt-count" id="ann-title-count"></span></div>
                <input id="ann-title" maxlength="${MANUAL_TITLE_MAX}" autocomplete="off" placeholder="ex. Info importante">
              </div>
              <div class="field">
                <div class="bt-label-row"><label for="ann-text">Message</label><span class="muted small bt-count" id="ann-text-count"></span></div>
                <textarea id="ann-text" rows="6" maxlength="${MANUAL_BODY_MAX}" aria-describedby="ann-text-hint" placeholder="Bonjour à tous !"></textarea>
                <p class="small muted" id="ann-text-hint">Dans le salon, <code>{pseudo}</code> devient « tout le monde ». Mise en forme Discord possible : <code>**gras**</code>.</p>
              </div>
              ${attachFieldHtml('ann-')}
              <div class="bt-preview">
                <div class="bt-preview-head"><span class="label">Aperçu</span><span class="muted small" id="ann-preview-for"></span></div>
                <div id="ann-preview" aria-live="polite"></div>
              </div>
              <div class="btn-row">
                <button type="submit" class="btn btn-primary" id="ann-send">${ICON.send}Publier</button>
              </div>
              <div id="ann-result" class="bm-result" aria-live="polite"></div>
            </form>
          </div>
        </div>
      </section>

      <section class="bot-panel" role="tabpanel" id="bot-p-mp" aria-labelledby="bot-tab-mp" hidden>
        <div class="card stack bm-card" id="bm-card">
          <div>
            <h3 class="card-title">Envoyer un message</h3>
            <p class="muted small">Message privé du bot aux comptes choisis. Les membres qui ont refusé les MP du bot ou sans ID Discord ne peuvent pas être sélectionnés.</p>
          </div>
          <div id="bm-body"><div class="empty">Chargement des comptes…</div></div>
          <details class="bm-history" id="bm-history">
            <summary>Historique des envois</summary>
            <div class="filters bm-hist-filters" role="group" aria-label="Filtrer l'historique" id="bm-hist-filters">
              <button class="chip" type="button" data-hf="all" aria-pressed="true">Toutes</button>
              <button class="chip" type="button" data-hf="failed" aria-pressed="false">Échecs</button>
            </div>
            <div id="bm-history-list" class="bm-history-list"><div class="empty">Chargement…</div></div>
            <p class="small muted">Chaque publication dans un salon est enregistrée avec son résultat (✓ ou ✗, et l'erreur). Les envois anciens n'ont que la mention « Salon ».</p>
          </details>
        </div>
      </section>

      <section class="bot-panel" role="tabpanel" id="bot-p-modeles" aria-labelledby="bot-tab-modeles" hidden>
        <div class="card stack bt-card" id="bt-card">
          <div>
            <h3 class="card-title">Messages types</h3>
            <p class="muted small bt-intro">Personnalise le texte de chaque message automatique. Les <strong>variables</strong> entre accolades (ex. <code>{pseudo}</code>) sont remplacées à l'envoi ; une variable non prévue pour ce message reste vide. Les champs fixes (budget, lieu…) ne sont pas modifiables.</p>
          </div>
          <div id="bt-body"><div class="empty">Chargement des modèles…</div></div>
        </div>
      </section>

      <section class="bot-panel" role="tabpanel" id="bot-p-regles" aria-labelledby="bot-tab-regles" hidden>
        <div class="bot-seg" role="group" aria-label="Partie des règles" id="bot-rsub">
          ${RULE_SUBS.map(([id, label]) => `<button type="button" class="chip" data-rsub="${id}" aria-pressed="false">${esc(label)}</button>`).join('')}
        </div>
        <div id="bot-r-rappels">${rulesCardHtml()}</div>
        <div id="bot-r-assistance" hidden>${supportCardHtml()}</div>
        <div id="bot-r-planning" hidden>${planningCardHtml()}</div>
      </section>
    </div>
    <dialog class="hg-dialog" id="bm-dlg" aria-labelledby="bm-dlg-t">
      <form method="dialog" class="stack">
        <h2 id="bm-dlg-t" class="dialog-title">Envoyer ce message ?</h2>
        <p id="bm-dlg-p" class="muted"></p>
        <div class="btn-row dialog-actions">
          <button class="btn btn-ghost" value="cancel" type="submit">Annuler</button>
          <button class="btn btn-primary" value="ok" type="submit">Envoyer</button>
        </div>
      </form>
    </dialog>`;

  // Formulaire des réglages généraux, et fenêtre de confirmation d'envoi (#bm-dlg).
  const form = $('#bot-form', container);
  const dlg = $('#bm-dlg', container);

  /** Réglages non chargés (lecture échouée) : aucune écriture, pour ne pas effacer les valeurs enregistrées. */
  function assertLoaded() { if (!settingsLoaded) throw new Error('Réglages non chargés : recharge la page avant de modifier.'); }
  /**
   * Action en cours : bouton désactivé avec indicateur, pas de second envoi. Reçoit un bouton, ou un formulaire
   * (soumission sans bouton connu) ; les boutons d'envoi du formulaire sont alors désactivés pendant l'action.
   */
  async function busy(btn, fn) {
    const isForm = btn instanceof HTMLFormElement;
    const el = isForm ? null : btn;
    const host = isForm ? btn : (el?.form ?? null);
    if (el?.dataset.busy || host?.dataset.busy) return undefined;
    const subs = host ? [...host.querySelectorAll('button:not([type]), button[type="submit"]')] : [];
    if (host) { host.dataset.busy = '1'; for (const b of subs) b.disabled = true; }
    if (el) { el.disabled = true; el.dataset.busy = '1'; el.classList.add('is-busy'); el.setAttribute('aria-busy', 'true'); }
    try { return await fn(); } catch (e) { toast(await fnError(e), 'error'); return undefined; } finally {
      if (el) { delete el.dataset.busy; el.classList.remove('is-busy'); el.removeAttribute('aria-busy'); if (el.isConnected) el.disabled = false; }
      if (host) { delete host.dataset.busy; for (const b of subs) if (b.isConnected) b.disabled = false; }
    }
  }
  /**
   * Ouvre la fenêtre de confirmation avec le texte donné.
   * @param {string} text Phrase qui résume l'envoi.
   * @returns {Promise<boolean>} true si l'admin clique « Envoyer ».
   */
  function confirmSend(text) {
    $('#bm-dlg-p', container).textContent = text;
    dlg.returnValue = '';
    dlg.showModal();
    return new Promise((resolve) => dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }));
  }

  /* ======================= Sous-onglets ======================= */
  const tablist = $('#bot-tablist', container), botForm = form;
  /**
   * Affiche un sous-onglet : son panneau, l'état ARIA (aria-selected, tabindex) et le choix mémorisé dans ce navigateur.
   * @param {string} id Identifiant du sous-onglet (voir BOT_TABS).
   * @param {boolean} [focus] Vrai pour placer le focus sur l'onglet (navigation au clavier).
   */
  function showTab(id, focus = false) {
    S.tab = BOT_TABS.some(([t]) => t === id) ? id : 'connexion';
    for (const [t] of BOT_TABS) {
      const on = t === S.tab, btn = $(`#bot-tab-${t}`, container);
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      $(`#bot-p-${t}`, container).hidden = !on;
    }
    botForm.hidden = !SETTINGS_TABS.includes(S.tab); // le formulaire des réglages n'enveloppe que ses trois panneaux
    try { localStorage.setItem(TAB_KEY, S.tab); } catch { /* stockage bloqué : le choix n'est pas gardé */ }
    if (focus) $(`#bot-tab-${S.tab}`, container).focus();
  }
  tablist.addEventListener('click', (ev) => { const b = ev.target.closest('[role="tab"]'); if (b) showTab(b.dataset.tab); });
  // Flèches gauche et droite (en boucle), Début et Fin : même comportement que les onglets de la page Cartes.
  tablist.addEventListener('keydown', (ev) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
    const ids = BOT_TABS.map(([t]) => t), i = ids.indexOf(S.tab);
    const n = ev.key === 'ArrowRight' ? (i + 1) % ids.length
      : ev.key === 'ArrowLeft' ? (i - 1 + ids.length) % ids.length
        : ev.key === 'Home' ? 0 : ids.length - 1;
    ev.preventDefault();
    showTab(ids[n], true);
  });
  // Dernier sous-onglet ouvert, mémorisé dans ce navigateur (sans effet si le stockage est bloqué).
  let remembered = null;
  try { remembered = localStorage.getItem(TAB_KEY); } catch { /* stockage bloqué */ }
  showTab(remembered || 'connexion');

  /* ======================= Règles : rappels, assistance ou planning (un bloc à la fois) ======================= */
  /**
   * Affiche un bloc de l'onglet Règles et marque le bouton choisi (aria-pressed). Le choix est mémorisé dans ce navigateur.
   * @param {string} id Identifiant du bloc (voir RULE_SUBS).
   */
  function showRsub(id) {
    const r = RULE_SUBS.some(([t]) => t === id) ? id : 'rappels';
    for (const [t] of RULE_SUBS) {
      $(`[data-rsub="${t}"]`, container).setAttribute('aria-pressed', String(t === r));
      $(`#bot-r-${t}`, container).hidden = t !== r;
    }
    try { localStorage.setItem(RSUB_KEY, r); } catch { /* stockage bloqué : le choix n'est pas gardé */ }
  }
  $('#bot-rsub', container).addEventListener('click', (ev) => { const b = ev.target.closest('[data-rsub]'); if (b) showRsub(b.dataset.rsub); });
  let rememberedRsub = null;
  try { rememberedRsub = localStorage.getItem(RSUB_KEY); } catch { /* stockage bloqué */ }
  showRsub(rememberedRsub || 'rappels');

  /* ======================= Réglages ======================= */
  /** Salons enregistrés pour un type, en cours d'édition (liste vide si aucun). */
  const chanOf = (k) => S.salonDraft.channels[k] ?? [];
  /** Mention d'un type (réglage) : « none » par défaut. */
  const mentionOf = (k) => (MENTION_MODES.some(([v]) => v === S.bot.mentions?.[k]) ? S.bot.mentions[k] : 'none');
  /** Remplit le formulaire des réglages généraux avec les valeurs enregistrées, puis recale les salons et les mentions. */
  function renderSettings() {
    form.announce_channel_id.value = S.bot.announce_channel_id ?? '';
    form.admin_discord_id.value = S.bot.admin_discord_id ?? '';
    form.mention_role_id.value = S.bot.mention_role_id ?? '';
    for (const [k] of MENTION_TYPES) form.elements[`mention_${k}`].value = mentionOf(k);
    for (const k of NOTIFY_KEYS) form.elements[k].checked = S.bot.notify[k] !== false;
    resetDraft();
  }
  /** Brouillon des salons : copie des salons connus et des salons par type enregistrés, puis redessin de l'onglet Salons. */
  function resetDraft() {
    S.salonDraft = {
      salons: S.bot.salons.map((s) => ({ ...s })),
      channels: Object.fromEntries(Object.entries(S.bot.channels ?? {}).map(([k, v]) => [k, [...v]])),
    };
    S.salonAsk = null;
    renderSalons(); renderChannelsUI(); syncMentionControls();
  }
  /** Les choix de mention ne servent qu'avec un salon : sans salon d'annonces ni salon par type, le bloc est grisé. */
  function syncMentionControls() {
    const on = !!form.announce_channel_id.value.trim() || MENTION_TYPES.some(([k]) => chanOf(k).length > 0);
    $('#bot-mentions', container).disabled = !on;
    $('#bot-mentions-off', container).hidden = on;
  }
  form.announce_channel_id.addEventListener('input', syncMentionControls);

  /* ---------- Salons connus : liste, ajout, retrait ---------- */
  /** Forme canonique des salons par type (ordre des types fixe), pour comparer le brouillon à l'enregistré. */
  const canonChan = (c) => JSON.stringify(MENTION_TYPES.map(([k]) => c?.[k] ?? []));
  /** Vrai si le brouillon des salons diffère de ce qui est enregistré. */
  const draftDirty = () => JSON.stringify(S.salonDraft.salons) !== JSON.stringify(S.bot.salons) || canonChan(S.salonDraft.channels) !== canonChan(S.bot.channels);
  /** Affiche ou masque la mention « modifications non enregistrées » de l'onglet Salons. */
  function syncDirty() { $('#bot-salons-dirty', container).hidden = !draftDirty(); }
  /** Dessine la liste des salons connus : nom, ID et bouton Retirer. Le retrait demande confirmation sur place. */
  function renderSalons() {
    const list = $('#bot-salon-list', container), salons = S.salonDraft.salons;
    $('#bot-salon-none', container).hidden = salons.length > 0;
    list.innerHTML = salons.map((s) => {
      const ask = S.salonAsk === s.id, nom = esc(s.nom), id = esc(s.id);
      return `<li class="salon-row${ask ? ' is-ask' : ''}">
        ${ask ? `<div class="salon-ask" role="group" aria-label="Confirmer le retrait de ${nom}">
            <span>Retirer <strong>${nom}</strong> ? Il sera décoché partout.</span>
            <span class="btn-row"><button type="button" class="btn btn-ghost btn-sm" data-salon-no="${id}">Annuler</button><button type="button" class="btn btn-sm bot-danger" data-salon-yes="${id}">Retirer le salon</button></span>
          </div>`
    : `<span class="salon-main"><span class="salon-name">${nom}</span><code class="salon-id">${id}</code></span>
            <button type="button" class="btn btn-ghost btn-sm" data-salon-ask="${id}" aria-label="Retirer le salon ${nom}">Retirer</button>`}
      </li>`;
    }).join('');
    if (S.salonAsk) list.querySelector(`[data-salon-no="${S.salonAsk}"]`)?.focus();
    syncDirty();
  }
  // Retrait : premier clic = confirmation en ligne ; « Annuler » rend le focus au bouton Retirer.
  $('#bot-salon-list', container).addEventListener('click', (ev) => {
    const ask = ev.target.closest('[data-salon-ask]'), yes = ev.target.closest('[data-salon-yes]'), no = ev.target.closest('[data-salon-no]');
    if (ask) { S.salonAsk = ask.dataset.salonAsk; renderSalons(); }
    else if (no) { S.salonAsk = null; renderSalons(); $(`[data-salon-ask="${no.dataset.salonNo}"]`, container)?.focus(); }
    else if (yes) removeSalon(yes.dataset.salonYes);
  });
  /**
   * Enregistre tout de suite les salons connus et les salons par type (brouillon de l'onglet Salons) dans hg_settings.bot,
   * sans toucher aux autres réglages. Appelé à chaque ajout, retrait ou case cochée : rien ne se perd en changeant de page.
   * @param {string} okMsg message affiché après l'enregistrement
   * @returns {Promise<boolean>} vrai si l'enregistrement a réussi
   */
  async function persistSalons(okMsg) {
    try {
      assertLoaded();
      const d = S.salonDraft;
      const salons = d.salons.map((x) => ({ id: x.id, nom: x.nom }));
      const channels = {};
      for (const [k] of MENTION_TYPES) {
        const list = (d.channels[k] ?? []).filter((id) => salons.some((x) => x.id === id)).slice(0, CHAN_MAX);
        if (list.length) channels[k] = list;
      }
      const value = { ...S.bot, salons, channels, birthday_channel_id: channels.birthday?.[0] ?? null };
      check(await sb.from('hg_settings').upsert({ key: 'bot', value, updated_at: new Date().toISOString() }));
      S.bot = value;
      syncDirty();
      syncChannelOption();
      renderAnnChannels();
      if (okMsg) toast(okMsg, 'ok');
      return true;
    } catch (e) {
      toast(`Salons non enregistrés : ${e?.message || e}`, 'error');
      syncDirty();
      return false;
    }
  }
  /** Retire un salon du brouillon et le décoche partout (salons par type). Le retrait part avec « Enregistrer ». */
  function removeSalon(id) {
    const d = S.salonDraft;
    const idx = d.salons.findIndex((s) => s.id === id);
    d.salons = d.salons.filter((s) => s.id !== id);
    for (const k of Object.keys(d.channels)) {
      d.channels[k] = d.channels[k].filter((x) => x !== id);
      if (!d.channels[k].length) delete d.channels[k];
    }
    S.salonAsk = null;
    // Focus : le bouton « Retirer » de la ligne suivante (ou de la précédente), sinon le champ d'ajout de salon.
    const next = d.salons[idx] ?? d.salons[idx - 1];
    renderSalons(); renderChannelsUI(); syncMentionControls();
    (next ? $(`[data-salon-ask="${next.id}"]`, container) : $('#bot-salon-name', container))?.focus();
    persistSalons('Salon retiré et enregistré');
  }
  /**
   * Ajoute un salon au brouillon après contrôle : nom de 1 à 50 caractères, ID de 17 à 20 chiffres,
   * sans doublon d'ID ni de nom, 25 salons au plus. L'erreur s'affiche sous le formulaire.
   */
  function addSalon() {
    const nameEl = $('#bot-salon-name', container), idEl = $('#bot-salon-id', container), box = $('#bot-salon-err', container);
    const nom = nameEl.value.trim(), id = idEl.value.trim(), d = S.salonDraft;
    const [err, field] = !nom ? ['Donne un nom au salon.', nameEl]
      : nom.length > SALON_NAME_MAX ? [`Le nom fait au plus ${SALON_NAME_MAX} caractères.`, nameEl]
        : !DISCORD_ID.test(id) ? ['L\'ID du salon doit être un nombre de 17 à 20 chiffres.', idEl]
          : d.salons.some((s) => s.id === id) ? ['Ce salon est déjà dans la liste (même ID).', idEl]
            : d.salons.some((s) => norm(s.nom) === norm(nom)) ? ['Un salon porte déjà ce nom dans la liste.', nameEl]
              : d.salons.length >= SALONS_MAX ? [`${SALONS_MAX} salons maximum : retire-en un avant d'en ajouter.`, nameEl]
                : ['', null];
    nameEl.setAttribute('aria-invalid', String(field === nameEl));
    idEl.setAttribute('aria-invalid', String(field === idEl));
    box.textContent = err;
    box.hidden = !err;
    if (err) { field.focus(); return; }
    d.salons.push({ id, nom });
    nameEl.value = ''; idEl.value = '';
    renderSalons(); renderChannelsUI(); syncMentionControls();
    persistSalons('Salon ajouté et enregistré');
    nameEl.focus();
  }
  $('#bot-salon-add', container).addEventListener('click', addSalon);
  // Entrée dans un champ valide le salon sans envoyer le formulaire des réglages.
  for (const sel of ['#bot-salon-name', '#bot-salon-id']) {
    $(sel, container).addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addSalon(); } });
  }

  /* ---------- Salon par type d'annonce : matrice (une ligne par type, une colonne par salon connu) ---------- */
  /** Dessine la matrice : une ligne par type d'annonce, une case par salon connu (5 au plus par type), et la colonne « Par défaut ». */
  function renderChannelsUI() {
    const box = $('#bot-chan-list', container), salons = S.salonDraft.salons;
    if (!salons.length) {
      box.innerHTML = '<p class="small muted">Ajoute d\'abord un salon ci-dessus. Sans salon, les annonces partent dans le salon d\'annonces par défaut.</p>';
      return;
    }
    box.innerHTML = `<div class="chan-wrap"><table class="chan-table">
        <thead><tr><th scope="col">Type d'annonce</th>${salons.map((s) => `<th scope="col"><span title="${esc(s.nom)}">${esc(s.nom)}</span></th>`).join('')}<th scope="col" class="chan-def">Par défaut</th></tr></thead>
        <tbody>${MENTION_TYPES.map(([k, label]) => `<tr id="bot-chan-${k}">
          <th scope="row"><span class="chan-type-name">${esc(label)}</span> <span class="muted small chan-count" id="bot-chan-n-${k}"></span></th>
          ${salons.map((s) => `<td><input type="checkbox" name="chan_${k}" value="${esc(s.id)}" aria-label="${esc(label)} dans ${esc(s.nom)}"${chanOf(k).includes(s.id) ? ' checked' : ''}></td>`).join('')}
          <td class="chan-def"><span class="small muted chan-hint" id="bot-chan-h-${k}"></span></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
    for (const [k] of MENTION_TYPES) chanCount(k);
  }
  /** Compteur « n / 5 » d'un type, et rappel du salon d'annonces quand aucune case n'est cochée. */
  function chanCount(k) {
    const n = chanOf(k).length;
    $(`#bot-chan-n-${k}`, container).textContent = `${n} / ${CHAN_MAX}`;
    $(`#bot-chan-h-${k}`, container).textContent = n ? '' : 'Aucun salon coché : salon d\'annonces par défaut.';
  }
  // Case cochée : 5 salons au plus par type ; décocher retire le salon de ce type.
  $('#bot-chan-list', container).addEventListener('change', (ev) => {
    const cb = ev.target;
    if (!(cb instanceof HTMLInputElement) || cb.type !== 'checkbox' || !cb.name.startsWith('chan_')) return;
    const k = cb.name.slice(5), d = S.salonDraft.channels, list = d[k] ?? [];
    if (cb.checked) {
      if (list.length >= CHAN_MAX) { cb.checked = false; toast(`${CHAN_MAX} salons maximum par type d'annonce`, 'error'); return; }
      d[k] = [...list, cb.value];
    } else {
      d[k] = list.filter((x) => x !== cb.value);
      if (!d[k].length) delete d[k];
    }
    chanCount(k); syncMentionControls(); syncDirty();
    persistSalons('');
  });
  // Enregistrement des réglages généraux, des salons et des mentions : contrôle des identifiants Discord et du rôle exigé
  // par une mention, puis écriture de hg_settings.bot. Salons connus et salons par type viennent du brouillon.
  // Les autres réglages du bot sont conservés (...S.bot).
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(ev.submitter ?? ev.currentTarget, async () => {
      assertLoaded();
      const channel = form.announce_channel_id.value.trim(), admin = form.admin_discord_id.value.trim();
      const role = form.mention_role_id.value.trim();
      if (channel && !DISCORD_ID.test(channel)) throw new Error('L\'ID du salon doit être un nombre de 17 à 20 chiffres.');
      if (admin && !DISCORD_ID.test(admin)) throw new Error('Ton ID Discord doit être un nombre de 17 à 20 chiffres.');
      if (role && !DISCORD_ID.test(role)) throw new Error('L\'ID du rôle doit être un nombre de 17 à 20 chiffres.');
      const mentions = Object.fromEntries(MENTION_TYPES.map(([k]) => [k, form.elements[`mention_${k}`].value]));
      if (Object.values(mentions).includes('role') && !role) throw new Error('Pour mentionner un rôle, renseigne son ID.');
      const salons = S.salonDraft.salons.map((s) => ({ id: s.id, nom: s.nom }));
      // Salons par type : 5 au plus, seulement des salons connus. Vide = rien n'est stocké (repli sur le salon d'annonces).
      const channels = {};
      for (const [k] of MENTION_TYPES) {
        const list = chanOf(k).filter((id) => salons.some((s) => s.id === id)).slice(0, CHAN_MAX);
        if (list.length) channels[k] = list;
      }
      const value = {
        ...S.bot, announce_channel_id: channel || null, birthday_channel_id: channels.birthday?.[0] ?? null, channels, salons,
        admin_discord_id: admin || null, mention_role_id: role || null, mentions: { ...(S.bot.mentions || {}), ...mentions },
        notify: { ...(S.bot.notify || {}), ...Object.fromEntries(NOTIFY_KEYS.map((k) => [k, form.elements[k].checked])) },
      };
      check(await sb.from('hg_settings').upsert({ key: 'bot', value, updated_at: new Date().toISOString() }));
      S.bot = value;
      resetDraft();
      syncChannelOption();
      renderAnnChannels();
      toast('Réglages du bot enregistrés', 'ok');
    });
  });
  // Test : le bot envoie un message de test au salon et en MP ; le résultat de chaque voie est affiché.
  $('#bot-test', container).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    const type = $('#bot-test-type', container).value;
    const res = await callFn('hg-notify', type ? { event: 'bot_test', type } : { event: 'bot_test' });
    const parts = [];
    let bad = false;
    if (Array.isArray(res?.channels) && res.channels.length) {
      const fails = res.channels.filter((c) => !c.ok);
      bad = bad || fails.length > 0;
      parts.push(`${pluralCount(res.channels.length - fails.length, 'salon OK', 'salons OK')}${fails.length ? `, ${pluralCount(fails.length, 'en échec', 'en échec')} : ${fails[0].error ?? 'erreur inconnue'}` : ''}`);
    } else if (res?.channel !== undefined) {
      bad = bad || res.channel === false;
      parts.push(`salon : ${res.channel ? 'OK' : 'échec'}`);
    }
    if (res?.dm !== undefined) { bad = bad || res.dm === false; parts.push(`MP : ${res.dm ? 'OK' : 'échec'}`); }
    if (res?.error) throw new Error(res.error);
    toast(parts.length ? `Test envoyé (${parts.join(', ')})` : 'Test envoyé', bad ? 'error' : 'ok');
  }));

  /* ======================= Rappels, envois, assistance, planning ======================= */
  // Formulaires des rappels et limites, de l'assistance et du planning.
  const rulesForm = $('#rules-form', container), supportForm = $('#support-cfg-form', container), planForm = $('#planning-form', container);
  // Clés des réglages de rappels et limites, et clés numériques de l'assistance.
  const RULE_ALL = Object.keys(RULE_DEF), SUPPORT_NUM = Object.keys(SUPPORT_MIN_MAX);
  /** Entier lu dans un champ, borné ; lève une erreur lisible. */
  const readInts = (form, keys, limits, labelOf) => {
    const out = {};
    for (const k of keys) {
      const [min, max] = limits[k];
      const s = String(form[k].value ?? '').trim(), n = Number(s);
      if (s === '' || !Number.isInteger(n) || n < min || n > max) throw new Error(`${labelOf(k)} : un nombre entier de ${min} à ${max}.`);
      out[k] = n;
    }
    return out;
  };
  // Libellés des réglages, utilisés dans les messages d'erreur.
  const labelRule = (k) => RULE_TXT[k][0], labelSupport = (k) => NUM_TXT[k][0];
  /** Valeur stockée d'un réglage bot (repli sur le défaut si absente ou hors bornes, comme le serveur). */
  const storedRule = (k) => {
    const r = S.bot.rappels || {}, d = S.bot.dyn || {}, e = S.bot.envoi || {}, l = S.bot.limites || {};
    const heures = Array.isArray(r.irl_heures) ? r.irl_heures : [];
    const raw = { irl_long: heures[0], irl_short: heures[1], ss_jours: r.ss_jours_avant, dyn_retard: d.delai_retard_heures, top_n: d.top_n,
      pieces_max: e.pieces_max, piece_max_mo: e.piece_max_mo, destinataires_max: e.destinataires_max, corps_max: e.corps_max, annonces_heure: l.annonces_par_heure }[k];
    const [min, max] = RULE_MIN_MAX[k];
    return Number.isInteger(raw) && raw >= min && raw <= max ? raw : RULE_DEF[k];
  };
  /** Tous les réglages de rappels et limites, tels qu'ils sont en vigueur. */
  const currentRules = () => Object.fromEntries(RULE_ALL.map((k) => [k, storedRule(k)]));
  /** Objet hg_settings.bot avec les réglages de ce bloc (le reste est conservé, y compris les autres sous-clés de limites). */
  // Forme de hg_settings.bot pour les rappels, les événements dynamiques, les envois et les limites (sous des clés imbriquées).
  const botWith = (v) => ({
    ...S.bot,
    rappels: { irl_heures: [v.irl_long, v.irl_short], ss_jours_avant: v.ss_jours },
    dyn: { delai_retard_heures: v.dyn_retard, top_n: v.top_n },
    envoi: { pieces_max: v.pieces_max, piece_max_mo: v.piece_max_mo, destinataires_max: v.destinataires_max, corps_max: v.corps_max },
    limites: { ...(S.bot.limites || {}), annonces_par_heure: v.annonces_heure },
  });
  /** Remplit le formulaire des rappels et limites avec les valeurs en vigueur. */
  const fillRules = () => { for (const k of RULE_ALL) rulesForm[k].value = storedRule(k); };
  /**
   * Enregistre hg_settings.bot avec les nouvelles valeurs, puis recale le formulaire.
   * @param {object} next Réglages complets du bot.
   */
  async function saveBot(next) {
    assertLoaded();
    check(await sb.from('hg_settings').upsert({ key: 'bot', value: next, updated_at: new Date().toISOString() }));
    S.bot = next;
    fillRules();
  }
  // Enregistrement des rappels et limites : chaque nombre doit être dans ses bornes, et le second rappel doit être plus court que le premier.
  rulesForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(ev.submitter ?? ev.currentTarget, async () => {
      const v = readInts(rulesForm, RULE_ALL, RULE_MIN_MAX, labelRule);
      if (v.irl_short >= v.irl_long) throw new Error('Le second rappel de sortie doit être plus court que le premier.');
      await saveBot(botWith(v));
      toast('Rappels et limites enregistrés', 'ok');
    });
  });

  // Sujet « Bug sur le site » : il doit toujours rester dans la liste (le badge Chasseur de bugs s'appuie dessus).
  const BUG = BUG_SUBJECT;
  /** Liste de sujets valide (même règle que le serveur), sinon null. */
  const cleanSujets = (list) => {
    const clean = [...new Set(list.map((x) => String(x).trim()).filter(Boolean))];
    return clean.length && clean.length <= 20 && clean.every((x) => x.length <= 80) && clean.includes(BUG) ? clean : null;
  };
  /** Valeur stockée d'un réglage d'assistance, ou le défaut si elle est absente ou hors bornes. */
  const storedSupport = (k) => {
    const v = S.support?.[k], [min, max] = SUPPORT_MIN_MAX[k];
    return Number.isInteger(v) && v >= min && v <= max ? v : SUPPORT_DEF[k];
  };
  // Sujets en vigueur : la liste enregistrée si elle est valide, sinon la liste par défaut.
  const storedSujets = () => (Array.isArray(S.support?.sujets) && cleanSujets(S.support.sujets.filter((x) => typeof x === 'string')) ) || SUPPORT_DEF.sujets;
  /** Seuil ou plafond des signalements en vigueur (défaut si absent ou hors bornes). */
  const storedSig = (k) => {
    const v = S.support?.signalements?.[k], [min, max] = SIG_MIN_MAX[k];
    return Number.isInteger(v) && v >= min && v <= max ? v : SIG_DEF[k];
  };
  /** Tous les réglages d'assistance, tels qu'ils sont en vigueur (sujets et signalements compris). Les autres clés de support sont conservées. */
  const currentSupport = () => ({
    ...S.support,
    sujets: storedSujets(),
    ...Object.fromEntries(SUPPORT_NUM.map((k) => [k, storedSupport(k)])),
    signalements: { ...(S.support?.signalements || {}), ...Object.fromEntries(SIG_KEYS.map((k) => [k, storedSig(k)])) },
  });
  /** Remplit le formulaire de l'assistance (sujets, limites et signalements) avec les valeurs en vigueur. */
  const fillSupport = () => {
    supportForm.sujets.value = storedSujets().join('\n');
    for (const k of SUPPORT_NUM) supportForm[k].value = storedSupport(k);
    for (const k of SIG_KEYS) supportForm[k].value = storedSig(k);
  };
  /**
   * Enregistre hg_settings.support avec les nouvelles valeurs, puis recale le formulaire.
   * @param {object} next Réglages complets de l'assistance (sujets et limites).
   */
  async function saveSupport(next) {
    assertLoaded();
    check(await sb.from('hg_settings').upsert({ key: 'support', value: next, updated_at: new Date().toISOString() }));
    S.support = next;
    fillSupport();
  }
  // Enregistrement de l'assistance : mêmes règles que le serveur (1 à 20 sujets de 80 caractères au plus, sujet « Bug » obligatoire,
  // maximum du message supérieur au minimum).
  supportForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(ev.submitter ?? ev.currentTarget, async () => {
      const list = supportForm.sujets.value.split('\n').map((x) => x.trim()).filter(Boolean);
      if (!list.length) throw new Error('Ajoute au moins un sujet.');
      if (list.length > 20) throw new Error('20 sujets maximum.');
      if (list.some((x) => x.length > 80)) throw new Error('Un sujet dépasse 80 caractères.');
      const sujets = [...new Set(list)];
      if (!sujets.includes(BUG)) throw new Error(`Le sujet « ${BUG} » doit rester dans la liste : le badge Chasseur de bugs s'appuie dessus.`);
      const v = readInts(supportForm, SUPPORT_NUM, SUPPORT_MIN_MAX, labelSupport);
      if (v.message_max <= v.message_min) throw new Error('Le maximum du message doit être plus grand que le minimum.');
      const sig = readInts(supportForm, SIG_KEYS, SIG_MIN_MAX, labelSupport);
      await saveSupport({ ...S.support, sujets, ...v, signalements: { ...(S.support?.signalements || {}), ...sig } });
      toast('Assistance enregistrée', 'ok');
    });
  });

  /** Heure en vigueur d'une tâche (0 à 23), ou le défaut si la valeur enregistrée est invalide. */
  const storedHeure = (k = 'anniversaires_heure_locale') => {
    const h = S.planning?.[k];
    return Number.isInteger(h) && h >= 0 && h <= 23 ? h : PLANNING_DEF[k];
  };
  /** Remplit le formulaire du planning avec les heures en vigueur. */
  const fillPlanning = () => {
    planForm.anniversaires_heure_locale.value = String(storedHeure());
    planForm.quiz_jour_heure_locale.value = String(storedHeure('quiz_jour_heure_locale'));
  };
  /**
   * Enregistre hg_settings.planning (heures des anniversaires et de la question du jour), puis recale le formulaire.
   * Les autres clés du planning sont conservées.
   * @param {number} h Heure des anniversaires, de 0 à 23.
   * @param {number} [q] Heure de la question du jour, de 0 à 23 (défaut : valeur en vigueur).
   */
  async function savePlanning(h, q = storedHeure('quiz_jour_heure_locale')) {
    assertLoaded();
    const next = { ...(S.planning || {}), anniversaires_heure_locale: h, quiz_jour_heure_locale: q };
    check(await sb.from('hg_settings').upsert({ key: 'planning', value: next, updated_at: new Date().toISOString() }));
    S.planning = next;
    fillPlanning();
  }
  // Enregistrement du planning.
  planForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(ev.submitter ?? ev.currentTarget, async () => {
      await savePlanning(Number(planForm.anniversaires_heure_locale.value), Number(planForm.quiz_jour_heure_locale.value));
      toast('Planning enregistré', 'ok');
    });
  });

  /** Rétablir un groupe : ses valeurs reviennent aux défauts et sont enregistrées tout de suite. */
  container.addEventListener('click', (ev) => {
    const b = ev.target.closest?.('[data-reset-group]');
    if (!b) return;
    busy(b, async () => {
      const g = b.dataset.resetGroup;
      if (b.dataset.form === 'rules') {
        const v = currentRules();
        for (const k of RULE_GROUPS[g].keys) v[k] = RULE_DEF[k];
        await saveBot(botWith(v));
      } else if (b.dataset.form === 'support') {
        const v = currentSupport();
        for (const k of SUPPORT_GROUPS[g].keys) {
          if (SIG_KEYS.includes(k)) v.signalements = { ...v.signalements, [k]: SIG_DEF[k] };
          else v[k] = SUPPORT_DEF[k];
        }
        await saveSupport(v);
      } else {
        if (g === 'quiz') await savePlanning(storedHeure(), PLANNING_DEF.quiz_jour_heure_locale);
        else await savePlanning(PLANNING_DEF.anniversaires_heure_locale);
      }
      toast('Valeurs par défaut rétablies', 'ok');
    });
  });

  /* ======================= Messages types ======================= */
  // Zone de la liste des messages types.
  const tplBody = $('#bt-body', container);
  let edRoot = null; // corps du tiroir d'édition (ouvert à la demande)
  // Accès aux définitions des modèles : clés, méta-données (libellé, variables, groupe) et texte par défaut.
  const keys = () => Object.keys(S.defs.templates);
  /** Méta-données d'un modèle (libellé, cible, variables). Objet vide si le modèle n'en a pas. */
  const meta = (k) => S.defs.meta[k] ?? { vars: {} };
  /** Texte par défaut d'un modèle, tel que fourni par bot-templates.json. */
  const def = (k) => S.defs.templates[k];
  /** Modèle enregistré (personnalisé champ par champ, sinon défaut). */
  const saved = (k) => {
    const c = S.custom[k] ?? {};
    return { title: filled(c.title) ? c.title : def(k).title, body: filled(c.body) ? c.body : def(k).body };
  };
  // Texte en cours d'un modèle : le brouillon s'il existe, sinon le texte enregistré.
  const current = (k) => S.drafts.get(k) ?? saved(k);
  // Vrai si les deux textes (titre et corps) sont identiques.
  const same = (a, b) => a.title === b.title && a.body === b.body;
  // Vrai si le modèle enregistré diffère du texte par défaut (personnalisé).
  const isCustom = (k) => !same(saved(k), def(k));
  // Vrai si un brouillon existe et diffère de ce qui est enregistré (modification non enregistrée).
  const isDirty = (k) => S.drafts.has(k) && !same(S.drafts.get(k), saved(k));
  // Clés des modèles ayant une modification non enregistrée.
  const dirtyKeys = () => keys().filter(isDirty);
  // Variables autorisées pour un modèle.
  const allowedOf = (k) => new Set(Object.keys(meta(k).vars ?? {}));
  // Valeurs d'exemple des variables, pour l'aperçu.
  const examplesOf = (k) => Object.fromEntries(Object.entries(meta(k).vars ?? {}).map(([n, v]) => [n, v.example ?? '']));

  // Groupes de modèles repliés par défaut (la liste reste courte) ; le premier groupe reste ouvert.
  const TPL_REPLIES = new Set(['cards', 'jeux', 'test']);

  /** Dessine la liste des messages types, groupée par destination, avec son bouton « Enregistrer ». */
  function renderTemplatesShell() {
    const groups = S.defs.groups ?? [];
    tplBody.innerHTML = `
      <div class="bt-listbar">
        <span class="muted small bt-status" id="bt-status" aria-live="polite"></span>
        <button type="button" class="btn btn-primary btn-sm" id="bt-save" disabled>Enregistrer</button>
      </div>
      <div class="bt-list" role="list" aria-label="Modèles de messages">
        ${groups.map((g) => {
          const items = keys().filter((k) => meta(k).group === g.id);
          if (!items.length) return '';
          return `<div class="bt-group" role="group" aria-labelledby="bt-g-${esc(g.id)}">
            ${TPL_REPLIES.has(g.id) ? `<details class="bt-fold"><summary class="bt-group-label" id="bt-g-${esc(g.id)}">${esc(g.label)} (${items.length})</summary>` : `<div class="bt-group-label" id="bt-g-${esc(g.id)}">${esc(g.label)}</div>`}
            ${items.map((k) => `<div role="listitem"><button type="button" class="bt-item" data-key="${esc(k)}" aria-label="Modifier « ${esc(meta(k).label ?? k)} »">
                <span class="bt-item-main"><span class="bt-item-label">${esc(meta(k).label ?? k)}</span>
                <span class="bt-item-sub">${esc(meta(k).target ?? '')}</span></span>
                <span class="bt-item-state" data-state="${esc(k)}"></span>
                <span class="bt-item-go" aria-hidden="true">Modifier</span>
              </button></div>`).join('')}
            ${TPL_REPLIES.has(g.id) ? '</details>' : ''}
          </div>`;
        }).join('')}
      </div>`;
    $$('.bt-item', tplBody).forEach((b) => b.addEventListener('click', () => selectTemplate(b.dataset.key)));
    $('#bt-save', tplBody).addEventListener('click', (e) => saveTemplates(e.currentTarget));
    refreshListStates();
  }

  /** Met à jour l'état de chaque modèle dans la liste (non enregistré, personnalisé), le bouton Enregistrer et le compteur. */
  function refreshListStates() {
    for (const k of keys()) {
      const el = $(`[data-state="${k}"]`, tplBody);
      if (!el) continue;
      const dirty = isDirty(k), custom = isCustom(k);
      el.textContent = dirty ? 'Non enregistré' : custom ? 'Personnalisé' : '';
      el.className = `bt-item-state${dirty ? ' is-dirty' : custom ? ' is-custom' : ''}`;
    }
    $$('.bt-item', tplBody).forEach((b) => {
      if (b.dataset.key === S.current) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    const n = dirtyKeys().length;
    const save = $('#bt-save', tplBody);
    if (save) {
      save.disabled = n === 0;
      save.textContent = n > 1 ? `Enregistrer (${n} modèles)` : 'Enregistrer';
    }
    const st = $('#bt-status', tplBody);
    if (st) st.textContent = n ? `${pluralCount(n, 'modification non enregistrée', 'modifications non enregistrées')}` : '';
  }

  /** Ouvre le modèle k dans le tiroir large (édition, aperçu, rétablir). L'enregistrement passe par le pied du tiroir. */
  function selectTemplate(k) {
    S.current = k;
    S.lastField = 'body';
    const m = meta(k), t = current(k), d = def(k);
    const vars = Object.entries(m.vars ?? {});
    const body = document.createElement('div');
    body.className = 'bt-editor stack';
    body.innerHTML = `
      <div class="bt-ed-head">
        <div>
          <h4 class="bt-ed-title">${esc(m.label ?? k)}</h4>
          <p class="muted small bt-ed-desc">${esc(m.description ?? '')}</p>
        </div>
        <span class="pill pill-todo bt-target">${esc(m.target ?? '')}</span>
      </div>
      <div class="field">
        <div class="bt-label-row"><label for="bt-title">Titre</label><span class="muted small bt-count" id="bt-title-count"></span></div>
        <input id="bt-title" maxlength="${TITLE_MAX}" autocomplete="off" placeholder="${esc(d.title)}">
      </div>
      <div class="field">
        <div class="bt-label-row"><label for="bt-text">Texte</label><span class="muted small bt-count" id="bt-text-count"></span></div>
        <textarea id="bt-text" rows="6" maxlength="${BODY_MAX}" placeholder="${esc(d.body)}"></textarea>
        <p class="small muted bt-hint">Vide = texte par défaut. Mise en forme Discord possible : <code>**gras**</code>, <code>*italique*</code>, <code>[lien](https://…)</code>.</p>
      </div>
      <div class="bt-vars" role="group" aria-labelledby="bt-vars-l">
        <div class="label" id="bt-vars-l">Variables disponibles <span class="small">(clic = insérer à l'endroit du curseur)</span></div>
        <div class="bt-chips">
          ${vars.map(([n, v]) => `<button type="button" class="chip bt-var" data-var="${esc(n)}" title="${esc(v.label)} — ex. ${esc(v.example)}" aria-label="Insérer {${esc(n)}} : ${esc(v.label)}">${ICON.plus}<code>{${esc(n)}}</code><span class="bt-var-label">${esc(v.label)}</span></button>`).join('')}
        </div>
      </div>
      <p class="bt-warn small" id="bt-warn" role="status" hidden></p>
      ${k === 'message_new_santa' ? '<p class="small bt-note">Par sécurité, aucune variable ne permet d\'afficher le Santa dans ce message.</p>' : ''}
      <div class="btn-row bt-actions">
        <button type="button" class="btn btn-ghost" id="bt-reset">${ICON.undo}Rétablir le texte par défaut</button>
      </div>
      <div class="bt-preview">
        <div class="bt-preview-head"><span class="label">Aperçu</span><span class="muted small">avec des valeurs d'exemple</span></div>
        <div id="bt-preview" aria-live="polite"></div>
      </div>`;
    edRoot = body;
    openDrawer({
      title: m.label ?? k, subtitle: m.target ? `Destination : ${m.target}` : '', body, wide: true,
      submitLabel: 'Enregistrer', onSubmit: () => saveTemplates(null, [k]),
    });
    const title = $('#bt-title', edRoot), text = $('#bt-text', edRoot);
    title.value = t.title; text.value = t.body;
    /** Enregistre le brouillon à chaque frappe, puis met à jour les compteurs, l'aperçu et les états de la liste. */
    const onInput = () => {
      S.drafts.set(k, { title: title.value, body: text.value });
      updateEditorMeta(); renderTplPreview(); refreshListStates();
    };
    title.addEventListener('input', onInput);
    text.addEventListener('input', onInput);
    title.addEventListener('focus', () => { S.lastField = 'title'; });
    text.addEventListener('focus', () => { S.lastField = 'body'; });
    $$('.bt-var', edRoot).forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault())); // garde le curseur
    $$('.bt-var', edRoot).forEach((b) => b.addEventListener('click', () => {
      const el = S.lastField === 'title' ? title : text;
      const token = `{${b.dataset.var}}`;
      if (el.value.length + token.length > el.maxLength) { toast('Texte trop long', 'error'); return; }
      const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
      el.setRangeText(token, start, end, 'end');
      el.focus();
      onInput();
    }));
    $('#bt-reset', edRoot).addEventListener('click', () => {
      title.value = d.title; text.value = d.body;
      onInput();
      toast(isDirty(k) ? 'Texte par défaut rétabli : pense à enregistrer' : 'C\'est déjà le texte par défaut', 'ok');
    });
    updateEditorMeta(); renderTplPreview(); refreshListStates();
  }

  /** Met à jour le compteur de caractères, l'avertissement des variables inconnues et l'état du bouton « Rétablir ». */
  function updateEditorMeta() {
    const k = S.current; if (!k) return;
    const t = current(k), allowed = allowedOf(k);
    $('#bt-title-count', edRoot).textContent = `${t.title.length} / ${TITLE_MAX}`;
    $('#bt-text-count', edRoot).textContent = `${t.body.length} / ${BODY_MAX}`;
    const unknown = unknownVars(`${t.title} ${t.body}`, allowed);
    const warn = $('#bt-warn', edRoot);
    warn.hidden = !unknown.length;
    warn.textContent = unknown.length ? `${unknown.length > 1 ? 'Variables inconnues' : 'Variable inconnue'} pour ce message : ${unknown.map((v) => `{${v}}`).join(', ')} (${unknown.length > 1 ? 'seront laissées' : 'sera laissée'} vide${unknown.length > 1 ? 's' : ''}).` : '';
    $('#bt-reset', edRoot).disabled = same(t, def(k));
  }

  /** Met à jour l'aperçu Discord du modèle en cours, rempli avec des valeurs d'exemple. */
  function renderTplPreview() {
    const k = S.current; if (!k) return;
    const m = meta(k), t = current(k), allowed = allowedOf(k), ex = examplesOf(k);
    const eff = { title: filled(t.title) ? t.title : def(k).title, body: filled(t.body) ? t.body : def(k).body };
    const title = truncate(fillVars(eff.title, ex, allowed).replace(/\s+/g, ' ').trim(), TITLE_MAX);
    const description = truncate(fillVars(eff.body, ex, allowed).trim(), BODY_MAX);
    $('#bt-preview', edRoot).innerHTML = discordPreview({
      where: m.target,
      content: m.content ? fillVars(m.content, ex, allowed) : '',
      embed: {
        color: m.color, title, description, url: ex.lien,
        fields: (m.fields ?? []).map(([n, v]) => [n, fillVars(v, ex, allowed)]),
        footer: m.footer,
      },
    });
  }

  /** Enregistre les modèles modifiés (tous, ou la liste `only`). Renvoie false en cas d'échec : le tiroir reste ouvert. */
  async function saveTemplates(btn, only = null) {
    const pending = only ?? dirtyKeys();
    if (!pending.length) return true;
    if (btn) btn.disabled = true;
    try {
      // Relit la valeur en base pour ne pas écraser une modification faite ailleurs entre-temps.
      const row = check(await sb.from('hg_settings').select('value').eq('key', 'bot_templates').maybeSingle());
      const base = row?.value && typeof row.value === 'object' && !Array.isArray(row.value) ? { ...row.value } : {};
      for (const k of pending) {
        const t = S.drafts.get(k) ?? saved(k), d = def(k);
        const title = t.title.trim() === d.title ? '' : t.title.trim();
        const body = t.body.trim() === d.body ? '' : t.body.replace(/\s+$/, '');
        if (!title && !body) delete base[k]; else base[k] = { title, body };
      }
      check(await sb.from('hg_settings').upsert({ key: 'bot_templates', value: base, updated_at: new Date().toISOString() }));
      S.custom = base;
      for (const k of pending) S.drafts.delete(k);
      refreshListStates(); if (edRoot?.isConnected) updateEditorMeta();
      toast(pending.length > 1 ? `${pending.length} modèles enregistrés` : 'Modèle enregistré', 'ok');
      return true;
    } catch (e) {
      toast(errMsg(e), 'error');
      return false;
    } finally {
      if (btn?.isConnected) btn.disabled = false;
    }
  }

  // Avertit avant de quitter la page s'il reste des modèles non enregistrés.
  window.addEventListener('beforeunload', (e) => {
    if (S.defs && dirtyKeys().length) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ======================= Message manuel ======================= */
  // Zone de l'envoi manuel : destinataires, rédaction, pièces jointes, aperçu et résultat.
  const bmBody = $('#bm-body', container);
  let mAtt = null; // pièces jointes du message manuel (attachmentUI, créées avec la liste des comptes)
  /** Vrai si le compte peut recevoir un MP du bot (ID Discord présent et MP non refusés). */
  const reachable = (p) => p.status === 'ok';
  /** Comptes affichés dans la liste, filtrés par la recherche (nom ou courriel, sans accents ni casse). */
  const visible = () => {
    const q = norm(S.q);
    return S.people.filter((p) => !q || norm(p.name).includes(q) || norm(p.email).includes(q));
  };

  /** Dessine le formulaire d'envoi manuel et branche ses contrôles : recherche, sélection, salon, pièces jointes, envoi. */
  function renderManualShell() {
    bmBody.innerHTML = `
      <div class="bm-layout">
        <fieldset class="bm-recipients">
          <legend class="label">Destinataires</legend>
          <div class="bm-tools">
            <div class="field bm-search">
              <label for="bm-q" class="visually-hidden">Rechercher un compte</label>
              <span class="bm-search-icon">${ICON.search}</span>
              <input id="bm-q" type="search" placeholder="Rechercher…" autocomplete="off">
            </div>
            <button type="button" class="btn btn-ghost btn-sm" id="bm-all">Tous</button>
            <button type="button" class="btn btn-ghost btn-sm" id="bm-none">Aucun</button>
          </div>
          <p class="small muted bm-count" id="bm-count" aria-live="polite"></p>
          <div class="bm-list" id="bm-list"></div>
        </fieldset>
        <form class="bm-compose stack" id="bm-form" novalidate>
          <label class="switch" id="bm-channel-wrap"><input type="checkbox" role="switch" id="bm-channel"><span class="switch-ui" aria-hidden="true"></span><span>Publier aussi dans le salon d'annonces <span class="muted small" id="bm-channel-hint"></span></span></label>
          <div class="field bm-mention-field" id="bm-mention-wrap">
            <label for="bm-mention">Mention dans le salon</label>
            <select id="bm-mention" name="mention" disabled aria-describedby="bm-mention-hint">
              ${MENTION_MODES.map(([v, t]) => `<option value="${v}">${esc(v === 'everyone' ? '@everyone (tout le serveur)' : t)}</option>`).join('')}
            </select>
            <p class="small muted" id="bm-mention-hint"></p>
          </div>
          <div class="field">
            <div class="bt-label-row"><label for="bm-title">Titre <span class="muted small">(facultatif)</span></label><span class="muted small bt-count" id="bm-title-count"></span></div>
            <input id="bm-title" maxlength="${MANUAL_TITLE_MAX}" autocomplete="off" placeholder="ex. Info importante">
          </div>
          <div class="field">
            <div class="bt-label-row"><label for="bm-text">Message</label><span class="muted small bt-count" id="bm-text-count"></span></div>
            <textarea id="bm-text" rows="6" maxlength="${MANUAL_BODY_MAX}" required aria-describedby="bm-text-hint" placeholder="Salut {pseudo} !"></textarea>
            <div class="bm-hint-row">
              <button type="button" class="chip bt-var" id="bm-var" aria-label="Insérer {pseudo} : pseudo du destinataire">${ICON.plus}<code>{pseudo}</code><span class="bt-var-label">Pseudo du destinataire</span></button>
              <p class="small muted" id="bm-text-hint">Dans le salon, <code>{pseudo}</code> devient « tout le monde ».</p>
            </div>
          </div>
          ${attachFieldHtml('bm-')}
          <div class="bt-preview">
            <div class="bt-preview-head"><span class="label">Aperçu</span><span class="muted small" id="bm-preview-for"></span></div>
            <div id="bm-preview" aria-live="polite"></div>
          </div>
          <div class="btn-row">
            <button type="submit" class="btn btn-primary" id="bm-send">${ICON.send}Envoyer</button>
          </div>
          <div id="bm-result" class="bm-result" aria-live="polite"></div>
        </form>
      </div>`;

    $('#bm-q', bmBody).addEventListener('input', (e) => { S.q = e.target.value; renderRecipients(); });
    // « Tous » ajoute les comptes visibles et joignables, dans la limite de MAX_RECIPIENTS.
    $('#bm-all', bmBody).addEventListener('click', () => {
      for (const p of visible().filter(reachable)) if (S.selected.size < MAX_RECIPIENTS) S.selected.add(p.id);
      if (visible().filter(reachable).some((p) => !S.selected.has(p.id))) toast(`${MAX_RECIPIENTS} destinataires maximum par envoi`, 'error');
      renderRecipients(); renderManualPreview();
    });
    $('#bm-none', bmBody).addEventListener('click', () => {
      for (const p of visible()) S.selected.delete(p.id);
      renderRecipients(); renderManualPreview();
    });
    $('#bm-list', bmBody).addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"]'); if (!cb) return;
      if (cb.checked) {
        if (S.selected.size >= MAX_RECIPIENTS) { cb.checked = false; toast(`${MAX_RECIPIENTS} destinataires maximum par envoi`, 'error'); return; }
        S.selected.add(cb.value);
      } else S.selected.delete(cb.value);
      renderCount(); renderManualPreview();
    });
    const title = $('#bm-title', bmBody), text = $('#bm-text', bmBody);
    let last = text;
    title.addEventListener('focus', () => { last = title; });
    text.addEventListener('focus', () => { last = text; });
    /** Met à jour les compteurs et l'aperçu à chaque frappe dans le message manuel. */
    const onInput = () => { renderManualCounts(); renderManualPreview(); };
    title.addEventListener('input', onInput);
    text.addEventListener('input', onInput);
    $('#bm-channel', bmBody).addEventListener('change', () => { syncManualMention(); renderManualPreview(); });
    $('#bm-mention', bmBody).addEventListener('change', renderManualPreview);
    // Pièces jointes du message manuel : liste, aperçu et téléversement (attachmentUI)
    mAtt = attachmentUI(bmBody, 'bm-', renderManualPreview);
    const varBtn = $('#bm-var', bmBody);
    varBtn.addEventListener('mousedown', (e) => e.preventDefault());
    // Insère {pseudo} à la position du curseur, dans le champ utilisé en dernier.
    varBtn.addEventListener('click', () => {
      if (last.value.length + 8 > last.maxLength) { toast('Texte trop long', 'error'); return; }
      last.setRangeText('{pseudo}', last.selectionStart ?? last.value.length, last.selectionEnd ?? last.value.length, 'end');
      last.focus(); onInput();
    });
    // Envoi : passe par sendManual (confirmation, téléversement des pièces jointes, résultat).
    $('#bm-form', bmBody).addEventListener('submit', (e) => { e.preventDefault(); sendManual(e.submitter); });
    syncChannelOption();
    renderRecipients(); renderManualCounts(); renderManualPreview();
  }

  /** Active la case « Publier aussi dans le salon » seulement si un salon d'annonces est configuré. */
  function syncChannelOption() {
    const cb = $('#bm-channel', bmBody); if (!cb) return;
    const has = !!S.bot.announce_channel_id;
    cb.disabled = !has;
    if (!has) cb.checked = false;
    $('#bm-channel-wrap', bmBody).classList.toggle('is-disabled', !has);
    $('#bm-channel-hint', bmBody).textContent = has ? '' : '(renseigne d\'abord l\'ID du salon dans les réglages)';
    syncManualMention();
  }

  /** Mention du message manuel : active seulement si on publie dans le salon. Le rôle n'est proposé que s'il est configuré. */
  function syncManualMention() {
    const sel = $('#bm-mention', bmBody); if (!sel) return;
    syncMentionSelect(sel, $('#bm-mention-hint', bmBody), !!$('#bm-channel', bmBody)?.checked, S.bot.mention_role_id);
  }


  /** Dessine la liste des comptes avec leur case, leur pastille d'état et leur mention « admin ». */
  function renderRecipients() {
    const list = $('#bm-list', bmBody);
    const rows = visible();
    list.innerHTML = rows.length ? rows.map((p) => {
      const [label, cls] = STATUS[p.status];
      const ok = reachable(p);
      return `<label class="bm-row${ok ? '' : ' is-off'}">
        <input type="checkbox" value="${esc(p.id)}" ${S.selected.has(p.id) ? 'checked' : ''} ${ok ? '' : 'disabled'} aria-describedby="bm-st-${esc(p.id)}">
        ${avatarHtml({ pseudo: p.name, avatar_url: p.avatar_url, color: p.color }, 32)}
        <span class="bm-name">${esc(p.name)}${p.is_admin ? ' <span class="muted small">(admin)</span>' : ''}</span>
        <span class="pill ${cls} bm-st" id="bm-st-${esc(p.id)}">${esc(label)}</span>
      </label>`;
    }).join('') : '<div class="empty">Aucun compte trouvé.</div>';
    renderCount();
  }
  /** Affiche le nombre de destinataires choisis, par rapport aux comptes joignables et non joignables. */
  function renderCount() {
    const n = S.selected.size, total = S.people.filter(reachable).length, off = S.people.length - total;
    $('#bm-count', bmBody).textContent = `${pluralCount(n, 'sélectionné', 'sélectionnés')} sur ${pluralCount(total, 'compte joignable', 'comptes joignables')}${off ? ` · ${pluralCount(off, 'compte non joignable', 'comptes non joignables')}` : ''}`;
  }
  /** Met à jour les compteurs de caractères du titre et du message manuel. */
  function renderManualCounts() {
    $('#bm-title-count', bmBody).textContent = `${$('#bm-title', bmBody).value.length} / ${MANUAL_TITLE_MAX}`;
    $('#bm-text-count', bmBody).textContent = `${$('#bm-text', bmBody).value.length} / ${MANUAL_BODY_MAX}`;
  }
  /**
   * Met à jour l'aperçu du message manuel. Le premier destinataire choisi sert d'exemple pour {pseudo} ;
   * sans destinataire, l'aperçu est celui du salon (« tout le monde »).
   */
  function renderManualPreview() {
    const firstId = [...S.selected][0];
    const who = firstId ? S.pseudo.get(firstId) ?? 'Alex' : null;
    const channel = $('#bm-channel', bmBody).checked;
    const pseudo = who ?? (channel ? 'tout le monde' : 'Alex');
    /** Remplace {pseudo} par le pseudo d'exemple de l'aperçu. */
    const sub = (s) => s.replace(/\{pseudo\}/g, pseudo);
    const title = truncate(sub($('#bm-title', bmBody).value).replace(/\s+/g, ' ').trim(), TITLE_MAX);
    const description = truncate(sub($('#bm-text', bmBody).value).trim(), BODY_MAX);
    // Mention : elle ne concerne que la publication dans le salon. L'aperçu d'un MP ne l'affiche pas (une note le précise).
    const mode = channel ? $('#bm-mention', bmBody).value : 'none';
    const salonMention = mode === 'everyone' ? '@everyone' : mode === 'role' ? '@rôle' : '';
    const mention = !who ? salonMention : '';
    const attached = mAtt?.files() ?? [], firstImage = attached.find((f) => f.url);
    const files = attached.map((f) => ({ name: f.file.name, size: f.file.size, inEmbed: f === firstImage }));
    $('#bm-preview-for', bmBody).textContent = who
      ? `pour ${who}${salonMention ? ` · dans le salon : ${salonMention} en tête du message` : ''}`
      : channel && !S.selected.size ? 'dans le salon' : 'avec un pseudo d\'exemple';
    $('#bm-preview', bmBody).innerHTML = discordPreview({
      where: who ? 'Message privé' : channel ? 'Salon d\'annonces' : 'Message privé', mention,
      embed: { color: '#9E3543', title, description, image: firstImage?.url ?? null }, files,
    });
  }

  /**
   * Envoie le message manuel : contrôles, confirmation si l'envoi est large ou mentionne @everyone, téléversement des
   * pièces jointes, appel de hg-notify (admin_dm), puis résultat et rafraîchissement de l'historique.
   * En cas d'échec, les fichiers déjà téléversés sont retirés du stockage.
   * @param {HTMLButtonElement|null} btn Bouton « Envoyer ».
   */
  async function sendManual(btn) {
    if (S.sending) return;
    const title = $('#bm-title', bmBody).value.trim(), body = $('#bm-text', bmBody).value.trim();
    const channel = $('#bm-channel', bmBody).checked;
    const mode = channel ? $('#bm-mention', bmBody).value : 'none';
    const ids = [...S.selected];
    if (!body) { toast('Écris un message', 'error'); $('#bm-text', bmBody).focus(); return; }
    if (body.length > MANUAL_BODY_MAX) { toast(`Message trop long (${MANUAL_BODY_MAX} caractères maximum)`, 'error'); return; }
    if (!ids.length && !channel) { toast('Choisis au moins un destinataire', 'error'); return; }
    if (mode === 'role' && !S.bot.mention_role_id) { toast('Aucun rôle configuré pour la mention', 'error'); return; }
    const files = mAtt.files();
    const fileTxt = files.length ? ` avec ${pluralCount(files.length, 'pièce jointe', 'pièces jointes')}` : '';
    const mentionTxt = mode === 'everyone' ? ' Mention @everyone : tout le serveur sera notifié.'
      : mode === 'role' ? ' Le rôle mentionné sera notifié.' : '';
    // Confirmation : grand envoi, pièces jointes ou mention @everyone (notifie tout le serveur)
    if (mode === 'everyone' || ids.length > CONFIRM_ABOVE || files.length) {
      const parts = [];
      if (ids.length) parts.push(`en privé à ${pluralCount(ids.length, 'personne', 'personnes')}`);
      if (channel) parts.push('publier dans le salon d\'annonces');
      const txt = `Le bot va ${parts.join(' et ')}${fileTxt}.${mentionTxt}${ids.length > CONFIRM_ABOVE ? ' L\'envoi prend quelques secondes par destinataire.' : ''}`;
      if (!(await confirmSend(txt))) return;
    }
    S.sending = true;
    const resBox = $('#bm-result', bmBody);
    const uploaded = [];
    resBox.innerHTML = `<div class="bm-sending" role="status">${files.length ? 'Téléversement des pièces jointes…' : `Envoi en cours (${pluralCount(ids.length, 'destinataire', 'destinataires')})…`}</div>`;
    await busy(btn, async () => {
      try {
        await mAtt.upload(uploaded);
        resBox.innerHTML = `<div class="bm-sending" role="status">Envoi en cours (${pluralCount(ids.length, 'destinataire', 'destinataires')})…</div>`;
        const res = await callFn('hg-notify', { event: 'admin_dm', user_ids: ids, title, body, channel, mention: mode, attachments: uploaded });
        if (res?.error) throw new Error(res.error);
        renderResult(res);
        const failed = (res?.failed ?? 0) + (res?.channel === false ? 1 : 0);
        toast(failed ? 'Envoi terminé avec des échecs' : 'Message envoyé', failed ? 'error' : 'ok');
        mAtt.clear();
        S.history = null;
        if ($('#bm-history', container).open) loadHistory();
      } catch (e) {
        // Échec : les fichiers déjà téléversés sont retirés du stockage (rien ne reste sans message)
        if (uploaded.length) sb.storage.from(MEDIA_BUCKET).remove(uploaded).catch(() => {});
        // Un seul signal d'erreur : le message reste affiché dans la zone de résultat (pas de toast en plus).
        resBox.innerHTML = `<div class="bm-error" role="alert">Échec de l'envoi : ${esc(await fnError(e))}</div>`;
      } finally { S.sending = false; }
    });
  }

  /**
   * Liste des résultats par destinataire : nom, état (envoyé, échec, ignoré) et raison éventuelle.
   * @param {object[]} list Résultats renvoyés par hg-notify ou stockés dans l'historique.
   * @returns {string}
   */
  function recipientsHtml(list) {
    return `<ul class="bm-res-list">${(list ?? []).map((r) => {
      const st = r.status ?? (r.ok ? 'sent' : 'failed');
      const [label, cls] = RESULT[st] ?? RESULT.failed;
      const name = r.pseudo ?? S.pseudo.get(r.user_id) ?? 'Compte inconnu';
      return `<li class="bm-res-row"><span class="bm-name">${esc(name)}</span><span class="pill ${cls}">${esc(label)}</span>${r.reason ? `<span class="small muted bm-reason">${esc(r.reason)}</span>` : ''}</li>`;
    }).join('')}</ul>`;
  }

  /**
   * Affiche le résultat d'un envoi : totaux, état de la publication dans le salon et détail par destinataire.
   * @param {object} res Réponse de hg-notify (sent, failed, skipped, channel, recipients).
   */
  function renderResult(res) {
    const parts = [];
    if (res.sent) parts.push(pluralCount(res.sent, 'envoyé', 'envoyés'));
    if (res.failed) parts.push(pluralCount(res.failed, 'échec', 'échecs'));
    if (res.skipped) parts.push(pluralCount(res.skipped, 'ignoré', 'ignorés'));
    const ch = res.channel === true ? '<span class="pill pill-ok">Publié dans le salon</span>'
      : res.channel === false ? `<span class="pill bm-pill-fail">Salon : échec</span>${res.channel_error ? ` <span class="small muted">${esc(res.channel_error)}</span>` : ''}` : '';
    $('#bm-result', bmBody).innerHTML = `
      <div class="bm-result-box">
        <div class="bm-result-head"><strong>Résultat</strong><span class="muted small">${esc(parts.join(' · ') || 'aucun MP')}</span>${ch}</div>
        ${(res.recipients ?? []).length ? recipientsHtml(res.recipients) : ''}
        ${res.log_error ? '<p class="small muted bm-log-warn">Envoyé, mais l\'historique n\'a pas pu être enregistré.</p>' : ''}
      </div>`;
  }

  /* ---------- Historique ---------- */
  // Panneau « Historique des envois » (repliable) : l'historique est chargé à la première ouverture.
  const histDetails = $('#bm-history', container);
  histDetails.addEventListener('toggle', () => { if (histDetails.open && !S.history) loadHistory(); });
  $('#bm-hist-filters', container).addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-hf]');
    if (!b) return;
    S.histFilter = b.dataset.hf;
    S.histLimit = PAGE_SIZE;
    $$('#bm-hist-filters .chip', container).forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
    loadHistory();
  });
  // Recherche dans les envois chargés (texte, titre, auteur, type) ; « Afficher plus » charge le lot suivant
  $('#bm-history-list', container).insertAdjacentHTML('beforebegin', searchHtml({ id: 'bm-hist-search', label: 'Rechercher dans l\'historique', placeholder: 'Titre, texte, auteur…' }));
  bindSearch(container.querySelector('#bm-hist-search'), (q) => { S.histQ = q; renderHistory(); }, SEARCH_DELAY);
  $('#bm-history-list', container).addEventListener('click', (ev) => {
    if (!ev.target.closest('#bm-hist-more')) return;
    S.histLimit += PAGE_SIZE;
    loadHistory();
  });
  // Lignes d'échec : un envoi a un destinataire « failed » (ou ok:false, ancien format) dans recipients,
  // ou le passage automatique a signalé des échecs dans son texte. hg_bot_log n'a pas de colonne de statut.
  /**
   * Charge les envois de l'historique, les plus récents d'abord. Pour « échecs seulement », on interroge trois formes de lignes
   * (nouveau format, ancien format, passage automatique) puis on fusionne sans doublon.
   * @param {boolean} failedOnly Vrai pour ne garder que les envois avec un échec.
   * @returns {Promise<object[]>}
   */
  async function fetchHistory(failedOnly) {
    const n = S.histLimit;
    /** Requêtes de l'historique (colonnes données). Le filtre « salon en échec » n'existe que si la colonne channels est là. */
    const queries = (cols) => (failedOnly ? [
      sb.from('hg_bot_log').select(cols).contains('recipients', [{ status: 'failed' }]).order('created_at', { ascending: false }).limit(n),
      sb.from('hg_bot_log').select(cols).contains('recipients', [{ ok: false }]).order('created_at', { ascending: false }).limit(n),
      sb.from('hg_bot_log').select(cols).neq('kind', 'manual').ilike('body', '%échec%').order('created_at', { ascending: false }).limit(n),
      cols.includes('channels') ? sb.from('hg_bot_log').select(cols).contains('channels', [{ ok: false }]).order('created_at', { ascending: false }).limit(n) : null,
    ] : [sb.from('hg_bot_log').select(cols).order('created_at', { ascending: false }).limit(n)]).filter(Boolean);
    /** Exécute les requêtes ; une erreur fait remonter la première. */
    const runAll = async (cols) => (await Promise.all(queries(cols))).map((r) => { if (r.error) throw r.error; return r.data ?? []; });
    let lists;
    try {
      lists = await runAll('id, sent_by, kind, title, body, recipients, channel, channels, created_at');
    } catch (e) {
      // Colonne « channels » absente (migration 070 non appliquée en base) : on relance sans elle.
      if (!(e?.code === '42703' || e?.code === 'PGRST204' || /channels/i.test(e?.message ?? ''))) throw e;
      lists = await runAll('id, sent_by, kind, title, body, recipients, channel, created_at');
    }
    if (!failedOnly) return lists[0];
    const seen = new Map();
    for (const r of lists.flat()) seen.set(r.id, r);
    return [...seen.values()].sort((x, y) => String(y.created_at).localeCompare(String(x.created_at))).slice(0, n);
  }
  /** Charge l'historique selon le filtre et la limite en cours, puis l'affiche. En cas d'erreur, affiche le message. */
  async function loadHistory() {
    const box = $('#bm-history-list', container);
    box.setAttribute('aria-busy', 'true');
    try {
      const failedOnly = S.histFilter === 'failed';
      const rows = await fetchHistory(failedOnly);
      S.history = rows;
      S.histMore = rows.length >= S.histLimit; // le lot demandé est plein : il en reste peut-être
      box.setAttribute('aria-busy', 'false');
      renderHistory();
    } catch (e) {
      box.innerHTML = `<div class="empty">Impossible de charger l'historique : ${esc(errMsg(e))}</div>`;
    }
  }
  /**
   * Dessine l'historique filtré par la recherche : une ligne repliable par envoi, avec ses compteurs et ses destinataires.
   * Le bouton « Afficher plus » apparaît s'il reste des envois à charger.
   */
  function renderHistory() {
    const box = $('#bm-history-list', container);
    const failedOnly = S.histFilter === 'failed';
    const all = S.history ?? [];
    const rows = all.filter((r) => matches(S.histQ, r.title, r.body, S.pseudo.get(r.sent_by), r.kind));
    setCount($('#bm-hist-search-count', container), rows.length, all.length, S.histQ, ['envoi', 'envois']);
    const more = S.histMore ? '<div class="lt-more"><button class="btn btn-ghost btn-sm" type="button" id="bm-hist-more">Afficher plus</button></div>' : '';
    box.innerHTML = rows.length ? rows.map((r) => {
        const rec = Array.isArray(r.recipients) ? r.recipients : [];
        const sent = rec.filter((x) => (x.status ?? (x.ok ? 'sent' : 'failed')) === 'sent').length;
        const failed = rec.filter((x) => (x.status ?? (x.ok ? 'sent' : 'failed')) === 'failed').length;
        const skipped = rec.length - sent - failed;
        const head = r.title || String(r.body ?? '').replace(/\s+/g, ' ').slice(0, 80);
        // Résultat par salon (colonne channels) ; les anciens envois n'ont que le drapeau « channel ».
        const chans = Array.isArray(r.channels) && r.channels.length ? r.channels : null;
        const chBad = chans ? chans.filter((c) => !c.ok).length : 0;
        return `<details class="bm-log">
          <summary>
            <span class="bm-log-date">${esc(logFmt.format(new Date(r.created_at)))}</span>
            <span class="bm-log-title">${esc(head)}</span>
            <span class="bm-log-stats">
              <span class="pill pill-ok">${sent} envoyé${sent > 1 ? 's' : ''}</span>
              ${failed ? `<span class="pill bm-pill-fail">${failed} échec${failed > 1 ? 's' : ''}</span>` : ''}
              ${skipped ? `<span class="pill pill-todo">${skipped} ignoré${skipped > 1 ? 's' : ''}</span>` : ''}
              ${chans ? (chBad ? `<span class="pill bm-pill-fail">${pluralCount(chBad, 'salon en échec', 'salons en échec')}</span>` : `<span class="pill pill-current">${pluralCount(chans.length, 'salon', 'salons')}</span>`) : (r.channel ? '<span class="pill pill-current">Salon</span>' : '')}
            </span>
          </summary>
          <div class="bm-log-body stack">
            <p class="small muted">Par ${esc(S.pseudo.get(r.sent_by) ?? 'un admin')}${r.kind && r.kind !== 'manual' ? ` · ${esc(kindLabel(r.kind))}` : ''}${r.channel ? ' · publié dans le salon d\'annonces' : ''}</p>
            ${r.title ? `<p class="bm-log-t">${esc(r.title)}</p>` : ''}
            <p class="bm-log-text">${esc(r.body ?? '')}</p>
            ${chans ? `<ul class="bm-res-list">${chans.map((c) => `<li class="bm-res-row"><span class="bm-name">${esc(salonName(c.id))}${c.ref ? ` <span class="small muted">· ${esc(c.ref)}</span>` : ''}</span>${c.ok
    ? '<span class="pill pill-ok">✓ Publiée</span>'
    : `<span class="pill bm-pill-fail">✗ Échec</span>${c.error ? `<span class="small muted bm-reason">${esc(c.error)}</span>` : ''}`}</li>`).join('')}</ul>` : ''}
            ${rec.length ? recipientsHtml(rec) : (chans ? '' : '<p class="small muted">Aucun MP (salon uniquement).</p>')}
          </div>
        </details>`;
      }).join('') + more : emptyHtml(S.histQ, failedOnly ? 'Aucun échec enregistré.' : 'Aucun message envoyé pour l\'instant.');
  }

  /* ======================= Annonce libre dans les salons ======================= */
  // Salons choisis (salon d'annonces par défaut et salons connus enregistrés), titre, message, mention, pièces jointes,
  // aperçu Discord. Publication par hg-notify (admin_dm avec la liste channels), après confirmation.
  const annForm = $('#ann-form', container);
  const annAtt = attachmentUI(container, 'ann-', renderAnnPreview);
  /** Salons proposés : le salon d'annonces par défaut d'abord, puis les salons connus (enregistrés). */
  function annOptions() {
    const def = S.bot.announce_channel_id, salons = S.bot.salons ?? [];
    const opts = [];
    if (def) opts.push({ id: def, label: salons.find((s) => s.id === def)?.nom ?? 'Salon d\'annonces', isDefault: true });
    for (const s of salons) if (s.id !== def) opts.push({ id: s.id, label: s.nom, isDefault: false });
    return opts;
  }
  /** Nom d'un salon pour l'affichage : nom enregistré, ou « Salon d'annonces » / « Salon <id> ». */
  const salonName = (id) => S.bot.salons?.find((s) => s.id === id)?.nom ?? (id === S.bot.announce_channel_id ? 'Salon d\'annonces' : `Salon ${id}`);
  /** Dessine la liste des salons de l'annonce libre. La sélection est gardée ; au premier passage, le salon par défaut est coché. */
  function renderAnnChannels() {
    const opts = annOptions();
    if (!S.annInit) { S.annInit = true; if (S.bot.announce_channel_id) S.annSel.add(S.bot.announce_channel_id); }
    for (const id of [...S.annSel]) if (!opts.some((o) => o.id === id)) S.annSel.delete(id);
    $('#ann-chan-list', container).innerHTML = opts.map((o) => `<label class="bm-row">
        <input type="checkbox" name="ann_chan" value="${esc(o.id)}"${S.annSel.has(o.id) ? ' checked' : ''}>
        <span class="bm-name">${esc(o.label)} <span class="muted small">${esc(o.id)}</span></span>
        ${o.isDefault ? '<span class="pill pill-current">Par défaut</span>' : ''}
      </label>`).join('');
    $('#ann-chan-none', container).hidden = opts.length > 0;
    syncMentionSelect($('#ann-mention', container), $('#ann-mention-hint', container), true, S.bot.mention_role_id);
    renderAnnPreview();
  }
  /** Compteurs, nombre de salons choisis et aperçu Discord de l'annonce libre. {pseudo} devient « tout le monde » (salon). */
  function renderAnnPreview() {
    const title = $('#ann-title', container).value, body = $('#ann-text', container).value;
    const picked = annOptions().filter((o) => S.annSel.has(o.id));
    $('#ann-title-count', container).textContent = `${title.length} / ${MANUAL_TITLE_MAX}`;
    $('#ann-text-count', container).textContent = `${body.length} / ${MANUAL_BODY_MAX}`;
    $('#ann-chan-count', container).textContent = `${pluralCount(S.annSel.size, 'salon choisi', 'salons choisis')} · ${ANN_MAX} au plus`;
    const mode = $('#ann-mention', container).value;
    const mention = mode === 'everyone' ? '@everyone' : mode === 'role' ? '@rôle' : '';
    const sub = (s) => s.replace(/\{pseudo\}/g, 'tout le monde');
    const attached = annAtt.files(), firstImage = attached.find((f) => f.url);
    const files = attached.map((f) => ({ name: f.file.name, size: f.file.size, inEmbed: f === firstImage }));
    $('#ann-preview-for', container).textContent = picked.length ? `dans ${pluralCount(picked.length, 'salon', 'salons')}` : 'choisis au moins un salon';
    $('#ann-preview', container).innerHTML = discordPreview({
      where: picked.map((o) => o.label).join(' · ') || 'Salon d\'annonces',
      mention,
      embed: { color: '#9E3543', title: truncate(sub(title).replace(/\s+/g, ' ').trim(), TITLE_MAX), description: truncate(sub(body).trim(), BODY_MAX), image: firstImage?.url ?? null },
      files,
    });
  }
  // Résultat par salon : { id, ok, error }. Sans détail (réponse sans « channels »), le résultat global vaut pour chaque salon.
  const annRows = (res, ids) => (Array.isArray(res?.channels) ? res.channels : ids.map((id) => ({ id, ok: res?.channel !== false })));
  /** Affiche le résultat d'une publication : nombre de salons, puis un ✓ ou un ✗ (avec l'erreur) pour chaque salon. */
  function renderAnnResult(res, ids) {
    const rows = annRows(res, ids), bad = rows.filter((r) => !r.ok).length;
    $('#ann-result', container).innerHTML = `<div class="bm-result-box">
        <div class="bm-result-head"><strong>Résultat</strong><span class="muted small">${esc(pluralCount(rows.length - bad, 'publiée', 'publiées'))}${bad ? ` · ${esc(pluralCount(bad, 'échec', 'échecs'))}` : ''}</span></div>
        <ul class="bm-res-list">${rows.map((r) => `<li class="bm-res-row"><span class="bm-name">${esc(salonName(r.id))}</span>${r.ok
    ? '<span class="pill pill-ok">✓ Publiée</span>'
    : `<span class="pill bm-pill-fail">✗ Échec</span>${r.error ? `<span class="small muted bm-reason">${esc(r.error)}</span>` : ''}`}</li>`).join('')}</ul>
        ${res?.log_error ? '<p class="small muted bm-log-warn">Envoyé, mais l\'historique n\'a pas pu être enregistré.</p>' : ''}
      </div>`;
  }
  /**
   * Publie l'annonce libre dans les salons choisis : contrôles, confirmation, téléversement des pièces jointes,
   * appel de hg-notify (admin_dm avec channels), puis résultat par salon. En cas d'échec, les fichiers déjà
   * téléversés sont retirés du stockage.
   * @param {HTMLButtonElement|null} btn Bouton « Publier ».
   */
  async function sendAnnonce(btn) {
    if (S.annSending) return;
    const title = $('#ann-title', container).value.trim(), body = $('#ann-text', container).value.trim();
    const mode = $('#ann-mention', container).value;
    const ids = annOptions().map((o) => o.id).filter((id) => S.annSel.has(id));
    if (!ids.length) { toast('Choisis au moins un salon', 'error'); return; }
    if (!body) { toast('Écris un message', 'error'); $('#ann-text', container).focus(); return; }
    if (body.length > MANUAL_BODY_MAX) { toast(`Message trop long (${MANUAL_BODY_MAX} caractères maximum)`, 'error'); return; }
    if (mode === 'role' && !S.bot.mention_role_id) { toast('Aucun rôle configuré pour la mention', 'error'); return; }
    const files = annAtt.files();
    const fileTxt = files.length ? ` Avec ${pluralCount(files.length, 'pièce jointe', 'pièces jointes')}.` : '';
    const mentionTxt = mode === 'everyone' ? ' Mention @everyone : tout le serveur sera notifié.' : mode === 'role' ? ' Le rôle mentionné sera notifié.' : '';
    if (!(await confirmSend(`Publier cette annonce dans ${pluralCount(ids.length, 'salon', 'salons')} ?${fileTxt}${mentionTxt}`))) return;
    S.annSending = true;
    const resBox = $('#ann-result', container);
    const uploaded = [];
    resBox.innerHTML = `<div class="bm-sending" role="status">${files.length ? 'Téléversement des pièces jointes…' : 'Publication en cours…'}</div>`;
    await busy(btn, async () => {
      try {
        await annAtt.upload(uploaded);
        const res = await callFn('hg-notify', { event: 'admin_dm', user_ids: [], channels: ids, title, body, mention: mode, attachments: uploaded });
        if (res?.error) throw new Error(res.error);
        renderAnnResult(res, ids);
        const bad = annRows(res, ids).filter((r) => !r.ok).length;
        toast(bad ? 'Publication terminée avec des échecs' : 'Annonce publiée', bad ? 'error' : 'ok');
        annAtt.clear();
        S.history = null;
        if ($('#bm-history', container).open) loadHistory();
      } catch (e) {
        // Échec : les fichiers déjà téléversés sont retirés du stockage ; le message d'erreur reste dans la zone de résultat.
        if (uploaded.length) sb.storage.from(MEDIA_BUCKET).remove(uploaded).catch(() => {});
        resBox.innerHTML = `<div class="bm-error" role="alert">Échec de la publication : ${esc(await fnError(e))}</div>`;
      } finally { S.annSending = false; }
    });
  }
  $('#ann-chan-list', container).addEventListener('change', (ev) => {
    const cb = ev.target;
    if (!(cb instanceof HTMLInputElement) || cb.name !== 'ann_chan') return;
    if (cb.checked) {
      if (S.annSel.size >= ANN_MAX) { cb.checked = false; toast(`${ANN_MAX} salons maximum par annonce`, 'error'); return; }
      S.annSel.add(cb.value);
    } else S.annSel.delete(cb.value);
    renderAnnPreview();
  });
  for (const sel of ['#ann-title', '#ann-text']) $(sel, container).addEventListener('input', renderAnnPreview);
  $('#ann-mention', container).addEventListener('change', renderAnnPreview);
  annForm.addEventListener('submit', (ev) => { ev.preventDefault(); sendAnnonce(ev.submitter ?? annForm); });

  /* ======================= Chargement ======================= */
  /** Lecture des réglages échouée : bandeau « recharge la page » et boutons d'enregistrement désactivés. */
  function lockUnloadedSettings(why) {
    container.querySelector('.bot-admin').insertAdjacentHTML('afterbegin', `<div class="bot-unloaded" role="alert">
        <span>Réglages non chargés : recharge la page avant de modifier.${why ? ` <span class="muted small">(${esc(why)})</span>` : ''}</span>
        <button type="button" class="btn btn-ghost btn-sm" id="bot-reload">Recharger</button></div>`);
    $('#bot-reload', container).addEventListener('click', () => location.reload());
    container.querySelectorAll('#bot-form button[type="submit"], #rules-form button[type="submit"], #support-cfg-form button[type="submit"], #planning-form button[type="submit"], [data-reset-group], #bot-salon-add')
      .forEach((b) => { b.disabled = true; });
  }
  (async () => {
    // Chargement : réglages, modèles, comptes et profils en parallèle. Chaque lot peut échouer sans bloquer les autres.
    const [settings, defs, accounts, profiles] = await Promise.allSettled([
      sb.from('hg_settings').select('key, value').in('key', ['bot', 'bot_templates', 'support', 'planning']).then(check),
      fetch(TEMPLATES_URL, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }),
      sb.rpc('hg_admin_accounts').then(check),
      sb.from('hg_profiles').select('id, pseudo, discord_id, bot_optin, avatar_url, color, is_admin, is_ghost').then(check),
    ]);

    // Réglages
    if (settings.status === 'fulfilled') {
      /** Valeur d'un réglage parmi les lignes chargées (undefined si absent). */
      const get = (k) => (settings.value ?? []).find((r) => r.key === k)?.value;
      S.bot = normalizeBot(get('bot') ?? S.bot);
      // Notifications activées par défaut ; l'échange conclu reste coupé par défaut. Les choix enregistrés priment.
      S.bot.notify = { draw: true, gift: true, irl: true, birthday: true, support: true, messages: true, card_pull: true, card_wish: true, card_trade: false, trade_offer: true, card_gift_admin: true, card_drop: true, quiz_daily: true, unwrap: false, ...(S.bot.notify || {}) };
      S.support = get('support') ?? {};
      S.planning = get('planning') ?? {};
      const c = get('bot_templates');
      S.custom = c && typeof c === 'object' && !Array.isArray(c) ? c : {};
      settingsLoaded = true;
    } else {
      toast(`Réglages du bot : ${errMsg(settings.reason)}`, 'error');
      lockUnloadedSettings(errMsg(settings.reason));
    }
    renderSettings();
    renderAnnChannels();
    fillRules(); fillSupport(); fillPlanning();

    // Modèles
    if (defs.status === 'fulfilled' && defs.value?.templates) {
      S.defs = defs.value;
      renderTemplatesShell();
    } else {
      tplBody.innerHTML = `<div class="empty">Impossible de charger les textes par défaut (<code>supabase/functions/_shared/bot-templates.json</code>)${defs.status === 'rejected' ? ` : ${esc(errMsg(defs.reason))}` : ''}. Sur GitHub Pages, vérifie que <code>_config.yml</code> publie toujours ce fichier (<code>include: _shared</code>).</div>`;
    }

    // Comptes
    const profs = profiles.status === 'fulfilled' ? profiles.value ?? [] : [];
    const byId = new Map(profs.map((p) => [p.id, p]));
    // Repli sans hg_admin_accounts : comptes actifs seulement (pas les fantômes).
    const accs = accounts.status === 'fulfilled' && Array.isArray(accounts.value) ? accounts.value : profs.filter((p) => !p.is_ghost).map((p) => ({ id: p.id, pseudo: p.pseudo }));
    if (accounts.status === 'rejected' && profiles.status === 'rejected') {
      bmBody.innerHTML = `<div class="empty">Impossible de charger les comptes : ${esc(errMsg(accounts.reason))}</div>`;
      return;
    }
    S.people = accs.map((a) => {
      const p = byId.get(a.id);
      // Pastille d'état du compte : sans profil, sans ID Discord, MP refusés, ou joignable (ok).
      const status = !p ? 'noprofile' : !DISCORD_ID.test(String(p.discord_id ?? '')) ? 'nodiscord' : !p.bot_optin ? 'optout' : 'ok';
      return {
        id: a.id, name: p?.pseudo ?? a.pseudo ?? a.email ?? 'Compte sans pseudo', email: a.email ?? '',
        avatar_url: p?.avatar_url ?? null, color: p?.color ?? null, is_admin: !!(p?.is_admin ?? a.is_admin), status,
      };
    }).sort((a, b) => (a.status !== 'ok') - (b.status !== 'ok') || a.name.localeCompare(b.name, 'fr'));
    for (const p of profs) S.pseudo.set(p.id, p.pseudo);
    for (const p of S.people) if (!S.pseudo.has(p.id)) S.pseudo.set(p.id, p.name);
    renderManualShell();
  })();
}
