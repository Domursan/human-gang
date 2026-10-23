// ===== Humane Gang — commandes slash Discord : logique pure (sans accès réseau ni base) =====
// Rôle : vérifier la signature Ed25519 des interactions, décrire les commandes (enregistrées par register.ts),
// et fabriquer les réponses (embeds, boutons) à partir des données renvoyées par les RPC hg_bot_*.
// Testé par lib_test.mjs (Node 22, WebCrypto) : signature fausse refusée, horodatage trop vieux refusé, rendus.
// Dépendances : aucune (WebCrypto standard : Deno, Node 22, navigateurs récents).
// Exporte : COMMANDS, COMMAND_NAMES, EPHEMERAL, verifyDiscordRequest, hexToBytes, parseCustomId, customId,
//   paillettesMessage, carteMessage, sortieMessage, quizMessage, quizResultMessage, textMessage, fmtWhen, fmtUntil.

/** Drapeau « éphémère » : seul l'auteur voit la réponse. */
export const EPHEMERAL = 64;
/** Couleurs des embeds (mêmes teintes que le site). */
const COLOR = { sand: 0xe2c77e, slate: 0x7e93c9, sage: 0x6fa37f, plum: 0x9a88c4, accent: 0x9e3543 };
/** Fenêtre acceptée entre l'horodatage signé et maintenant (anti-rejeu d'une requête interceptée). */
const MAX_SKEW_S = 300;

/* ---------- Commandes (enregistrées sur le serveur du gang par register.ts) ---------- */

/** Définition des commandes au format de l'API Discord (type 1 = CHAT_INPUT). */
export const COMMANDS = [
  { name: 'paillettes', type: 1, description: 'Ton solde de Paillettes, ton passage du jour et tes quêtes de la semaine' },
  {
    name: 'carte', type: 1, description: 'La fiche d’une carte : rareté, série, tes exemplaires, qui l’a en double',
    options: [{ type: 3, name: 'nom', description: 'Nom de la carte', required: true, autocomplete: true, max_length: 100 }],
  },
  {
    name: 'sortie', type: 1, description: 'La prochaine sortie IRL, avec J’y vais / Peut-être / Non',
    options: [{ type: 5, name: 'public', description: 'Montrer la réponse à tout le salon (sinon toi seul·e)', required: false }],
  },
  { name: 'quiz', type: 1, description: 'Une question du gang à laquelle tu n’as pas encore répondu' },
];
/** Noms des commandes connues (les interrupteurs de l'admin portent les mêmes noms). */
export const COMMAND_NAMES = COMMANDS.map((c) => c.name);

/* ---------- Signature des interactions ---------- */

/**
 * Convertit une chaîne hexadécimale en octets. Lève une erreur si la chaîne n'est pas de l'hexadécimal pair.
 * @param {string} hex Chaîne hexadécimale.
 * @returns {Uint8Array}
 */
export function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw new Error('hexadécimal invalide');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Vérifie qu'une requête vient bien de Discord : signature Ed25519 de (horodatage + corps brut) avec la clé publique
 * de l'application. Refuse aussi un horodatage à plus de 5 minutes de maintenant. Sans cette vérification, n'importe qui
 * pourrait appeler la fonction.
 * @param {string} publicKeyHex Clé publique de l'application (portail développeur, 64 caractères hexadécimaux).
 * @param {string|null} signatureHex En-tête X-Signature-Ed25519.
 * @param {string|null} timestamp En-tête X-Signature-Timestamp (secondes Unix).
 * @param {string} body Corps brut, tel que reçu.
 * @param {number} [nowS] Maintenant en secondes (tests).
 * @returns {Promise<boolean>} true si la signature est valide.
 */
export async function verifyDiscordRequest(publicKeyHex: string, signatureHex: string | null, timestamp: string | null, body: string, nowS = Date.now() / 1000): Promise<boolean> {
  try {
    if (!publicKeyHex || !signatureHex || !timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
    if (Math.abs(nowS - Number(timestamp)) > MAX_SKEW_S) return false;
    const key = await crypto.subtle.importKey('raw', hexToBytes(publicKeyHex) as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    const data = new TextEncoder().encode(timestamp + body);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, hexToBytes(signatureHex) as BufferSource, data as BufferSource);
  } catch {
    return false;
  }
}

/* ---------- Boutons : identifiants personnalisés ---------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RSVP = ['oui', 'peut-etre', 'non'];

/** Identifiant d'un bouton : « rsvp:<sortie>:<statut> » ou « quiz:<question>:<choix> » (100 caractères au plus). */
export function customId(kind: 'rsvp' | 'quiz', id: string, value: string): string {
  return `${kind}:${id}:${value}`.slice(0, 100);
}

/**
 * Lit l'identifiant d'un bouton et le valide. Renvoie null s'il est inconnu ou mal formé (on ne fait jamais confiance
 * au contenu d'un bouton : la RPC revérifie tout).
 * @param {string} raw custom_id reçu.
 * @returns {{kind: 'rsvp'|'quiz', id: string, value: string} | null}
 */
export function parseCustomId(raw: unknown): { kind: 'rsvp' | 'quiz'; id: string; value: string } | null {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^(rsvp|quiz):([0-9a-f-]{36}):([a-z0-9_-]{1,40})$/);
  if (!m || !UUID.test(m[2])) return null;
  if (m[1] === 'rsvp' && !RSVP.includes(m[3])) return null;
  return { kind: m[1] as 'rsvp' | 'quiz', id: m[2], value: m[3] };
}

/* ---------- Formats ---------- */

/** Nombre en français (espace fine insécable pour les milliers). */
const nf = (n: unknown) => new Intl.NumberFormat('fr-CH').format(Number(n) || 0).replace(/[’']/g, ' ');
/** Pluriel simple. */
const pl = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Date et heure d'un rendez-vous en heure suisse : « samedi 14 novembre à 12:00 ». */
export function fmtWhen(iso: string): string {
  return new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    .format(new Date(iso)).replace(/ (\d{2}:\d{2})$/, ' à $1');
}

/** Délai avant une date : « dans 3 h 12 », « dans 12 min », ou « disponible » si la date est passée. */
export function fmtUntil(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'disponible';
  const ms = new Date(iso).getTime() - now;
  if (!(ms > 0)) return 'disponible';
  const h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return h ? `dans ${h} h ${String(m).padStart(2, '0')}` : `dans ${Math.max(1, m)} min`;
}

/** Bouton lien (style 5) vers une page du site, ou rien si l'adresse du site n'est pas configurée. */
const linkRow = (site: string, page: string, label: string) =>
  site ? [{ type: 1, components: [{ type: 2, style: 5, label, url: `${site}/${page}` }] }] : [];

/** Message texte simple (éphémère par défaut). */
export function textMessage(content: string, ephemeral = true) {
  return { content: content.slice(0, 2000), flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] } };
}

/* ---------- Rendus des commandes ---------- */

/** Données de hg_bot_me. */
export type Me = { paillettes: number; daily_available: boolean; daily_streak: number; free_booster_at: string | null; boosters_stock: number; quests_total: number; quests_done: number };

/** Réponse de /paillettes (éphémère). */
export function paillettesMessage(me: Me, site: string, now = Date.now()) {
  return {
    flags: EPHEMERAL, allowed_mentions: { parse: [] },
    embeds: [{
      color: COLOR.sand,
      title: `Ton solde : ${nf(me.paillettes)} Paillettes`,
      fields: [
        { name: 'Passage du jour', value: me.daily_available ? 'À faire sur le site' : `Fait${me.daily_streak > 1 ? ` · série de ${me.daily_streak} jours` : ''}`, inline: true },
        { name: 'Boosters en stock', value: pl(Number(me.boosters_stock) || 0, 'booster', 'boosters'), inline: true },
        { name: 'Quêtes de la semaine', value: `${me.quests_done} / ${me.quests_total}`, inline: true },
        { name: 'Prochain booster gratuit', value: fmtUntil(me.free_booster_at, now), inline: true },
      ],
    }],
    components: linkRow(site, 'cartes.html', 'Ouvrir mes cartes'),
  };
}

/** Données de hg_bot_card. */
export type Card = { name: string; family: string; rarity: string; set: string | null; mine: number; doubles: string[]; craftable: boolean; tradeable: boolean };
const FAMILY: Record<string, string> = { membre: 'Membre', lieu: 'Lieu', moment: 'Moment', objet: 'Objet' };
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Réponse de /carte (éphémère). null = carte introuvable. */
export function carteMessage(c: Card | null, query: string, site: string) {
  if (!c) return textMessage(`Aucune carte ne s’appelle « ${query.slice(0, 80)} ». Essaie l’autocomplétion de /carte.`);
  const meta = [FAMILY[c.family] || cap(c.family || ''), c.set ? `Série ${c.set}` : null, cap(c.rarity || '')].filter(Boolean).join(' · ');
  return {
    flags: EPHEMERAL, allowed_mentions: { parse: [] },
    embeds: [{
      color: COLOR.slate,
      author: { name: meta },
      title: c.name,
      fields: [
        { name: 'Tu en as', value: pl(Number(c.mine) || 0, 'exemplaire', 'exemplaires'), inline: true },
        { name: 'En double chez', value: c.doubles?.length ? c.doubles.join(', ') : 'Personne pour l’instant', inline: true },
      ],
      ...(c.craftable ? { footer: { text: 'Fabrication possible sur la page Cartes' } } : {}),
    }],
    components: c.tradeable && c.doubles?.length ? linkRow(site, 'cartes.html', 'Proposer un échange') : linkRow(site, 'cartes.html', 'Ouvrir mes cartes'),
  };
}

/** Données de hg_bot_next_outing. */
export type Outing = { id: string; title: string; location: string | null; starts_at: string; oui: number; peut_etre: number; mine: string | null } | { forbidden: true } | null;
const MINE: Record<string, string> = { oui: 'Tu viens', 'peut-etre': 'Tu hésites', non: 'Tu ne viens pas' };

/** Réponse de /sortie (éphémère sauf public:true), avec les trois boutons de réponse. */
export function sortieMessage(o: Outing, site: string, ephemeral = true) {
  if (!o) return textMessage('Aucune sortie IRL n’est prévue pour l’instant. Propose-en une sur le site !', ephemeral);
  if ('forbidden' in o) return textMessage('La page IRL ne t’est pas ouverte sur le site.', true);
  const btn = (status: string, label: string, style: number) =>
    ({ type: 2, style: o.mine === status ? 3 : style, label: o.mine === status ? `${label} ✓` : label, custom_id: customId('rsvp', o.id, status) });
  const rows: unknown[] = [{ type: 1, components: [btn('oui', 'J’y vais', 1), btn('peut-etre', 'Peut-être', 2), btn('non', 'Non', 2)] }];
  if (site) rows.push({ type: 1, components: [{ type: 2, style: 5, label: 'Voir la sortie', url: `${site}/irl.html#event-${o.id}` }] });
  return {
    flags: ephemeral ? EPHEMERAL : 0, allowed_mentions: { parse: [] },
    embeds: [{
      color: COLOR.sand,
      author: { name: 'Prochaine sortie IRL' },
      title: o.title.slice(0, 256),
      fields: [
        { name: 'Quand', value: fmtWhen(o.starts_at), inline: true },
        { name: 'Où', value: (o.location || 'À préciser').slice(0, 200), inline: true },
        { name: 'Réponses', value: `${pl(o.oui, 'vient', 'viennent')} · ${o.peut_etre} peut-être`, inline: false },
        ...(ephemeral && o.mine ? [{ name: 'Ta réponse', value: MINE[o.mine] || o.mine, inline: false }] : []),
      ],
    }],
    components: rows,
  };
}

/** Données de hg_bot_quiz_pick. */
export type Quiz = { id: string; prompt: string; qtype: string; reward: number; options: { id: string; text?: string }[] } | null;

/** Réponse de /quiz (éphémère) : boutons de réponse pour un choix unique ou un vrai/faux, sinon lien vers le site. */
export function quizMessage(q: Quiz, site: string) {
  if (!q) return textMessage('Tu as répondu à toutes les questions ouvertes. Bravo ! Reviens quand il y en aura de nouvelles.');
  const choice = (q.qtype === 'choix_unique' || q.qtype === 'vrai_faux') && Array.isArray(q.options) && q.options.length <= 5
    && q.options.every((o) => /^[a-z0-9_-]{1,40}$/.test(String(o.id)));
  const label = (o: { id: string; text?: string }) => (q.qtype === 'vrai_faux' ? (o.id === 'vrai' ? 'Vrai' : 'Faux') : String(o.text || o.id)).slice(0, 80);
  const components = choice
    ? [{ type: 1, components: q.options.map((o) => ({ type: 2, style: 2, label: label(o), custom_id: customId('quiz', q.id, String(o.id)) })) }]
    : linkRow(site, 'quiz.html', 'Répondre sur le site');
  return {
    flags: EPHEMERAL, allowed_mentions: { parse: [] },
    embeds: [{
      color: COLOR.plum,
      author: { name: 'Question du gang' },
      description: q.prompt.slice(0, 2000),
      footer: { text: `${q.reward > 0 ? `${nf(q.reward)} Paillettes à gagner · ` : ''}une seule tentative` },
    }],
    components,
  };
}

/** Résultat d'une réponse au quiz (réponse de hg_quiz_answer). */
export function quizResultMessage(r: { correct: boolean | null; reward: number; explanation?: string | null }) {
  const head = r.correct === true ? `Bonne réponse !${r.reward > 0 ? ` +${nf(r.reward)} Paillettes.` : ''}`
    : r.correct === false ? 'Raté ! La bonne réponse est sur la page Questions du gang.'
    : 'Réponse enregistrée : un membre du Staff la validera.';
  return textMessage([head, r.explanation ? String(r.explanation).slice(0, 1500) : ''].filter(Boolean).join('\n\n'));
}
