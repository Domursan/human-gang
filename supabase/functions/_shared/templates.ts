// ===== Humane Gang — modèles des messages du bot (partagé par hg-notify, hg-support, hg-birthdays, hg-cron) =====
// Rôle : fournir le texte (titre et corps) de chaque message envoyé par le bot Discord, et le rendre en embed.
// Textes par défaut : ./bot-templates.json (même fichier que l'éditeur de l'admin).
// Textes personnalisés : hg_settings.bot_templates = { [clé]: { title?, body? } } (un champ vide = texte par défaut).
// Rendu : {variable} remplacée par sa valeur ; une variable non prévue pour ce modèle (ou sans valeur) devient vide.
// Dépendances : ./bot-templates.json (import JSON).
// Exporte : TemplateKey, Template, Templates, Vars, DISCORD_TITLE_MAX, DISCORD_DESC_MAX, truncate, loadTemplates,
//   resolveTemplate, fill, renderTemplate, embedFrom.
import defaults from './bot-templates.json' with { type: 'json' };

/** Clés de tous les modèles du bot. Chaque clé doit exister dans bot-templates.json. */
export type TemplateKey =
  | 'ss_draw_announce' | 'ss_draw_dm' | 'ss_gift_sent' | 'ss_gift_received' | 'irl_new'
  | 'message_new' | 'message_new_santa' | 'birthday_dm' | 'birthday_announce' | 'support_new' | 'bot_test'
  | 'dyn_start' | 'dyn_end' | 'card_pull_announce' | 'card_trade_announce'
  | 'irl_reminder' | 'ss_send_reminder' | 'card_wish_dm' | 'trade_offer_dm' | 'card_gift_admin_dm';
/** Un modèle : titre et corps. */
export type Template = { title: string; body: string };
/** Modèles personnalisés, indexés par clé. Chaque champ est facultatif. */
export type Templates = Partial<Record<string, Partial<Template>>>;
/** Valeurs disponibles pour le remplacement des variables {nom}. */
export type Vars = Record<string, string | number | null | undefined>;

/** Forme du fichier bot-templates.json : les textes par défaut et les variables permises pour chaque modèle. */
type Defaults = {
  templates: Record<TemplateKey, Template>;
  meta: Record<TemplateKey, { vars: Record<string, unknown> }>;
};
const D = defaults as unknown as Defaults;

/** Limites Discord : un titre d'embed fait 256 caractères au plus, une description 4096. */
export const DISCORD_TITLE_MAX = 256;
export const DISCORD_DESC_MAX = 4096;

/**
 * Coupe un texte à `n` caractères, en ajoutant « … » si on a coupé.
 * @param {string} s Texte d'origine.
 * @param {number} n Longueur maximale, « … » compris.
 * @returns {string} Texte coupé ou inchangé.
 */
export const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Lit les modèles personnalisés (jamais d'erreur : en cas de problème, textes par défaut).
 * @param {any} db Client Supabase (clé service role).
 * @returns {Promise<Templates>} Modèles personnalisés, ou {} si rien n'est enregistré.
 */
// deno-lint-ignore no-explicit-any
export async function loadTemplates(db: any): Promise<Templates> {
  try {
    const { data } = await db.from('hg_settings').select('value').eq('key', 'bot_templates').maybeSingle();
    const v = data?.value;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Templates) : {};
  } catch (e) {
    console.error('[templates] lecture', e);
    return {};
  }
}

/**
 * Vrai si la valeur est une chaîne non vide (les espaces seuls ne comptent pas).
 * @param {unknown} v Valeur à tester.
 * @returns {boolean} Vrai si la valeur est un texte utilisable.
 */
const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * Modèle effectif : texte personnalisé s'il est renseigné, sinon texte par défaut (champ par champ).
 * @param {TemplateKey} key Clé du modèle.
 * @param {Templates} [custom] Modèles personnalisés.
 * @returns {Template} Titre et corps à utiliser.
 */
export function resolveTemplate(key: TemplateKey, custom: Templates = {}): Template {
  const def = D.templates[key];
  const c = custom[key] ?? {};
  return { title: filled(c.title) ? c.title : def.title, body: filled(c.body) ? c.body : def.body };
}

/**
 * Remplace {variable} ; seules les variables déclarées pour ce modèle sont acceptées.
 * Une variable inconnue ou sans valeur devient une chaîne vide. Seuls les noms en minuscules et « _ » sont reconnus.
 * @param {string} text Texte avec des {variables}.
 * @param {Vars} vars Valeurs à insérer.
 * @param {Set<string>} [allowed] Noms de variables autorisés pour ce modèle.
 * @returns {string} Texte rendu.
 */
export function fill(text: string, vars: Vars, allowed?: Set<string>): string {
  return text.replace(/\{([a-z_]+)\}/g, (_m, name: string) => {
    if (allowed && !allowed.has(name)) return '';
    const v = vars[name];
    return v === null || v === undefined ? '' : String(v);
  });
}

/**
 * Rend un modèle : { title ≤ 256, description ≤ 4096 } prêt pour un embed Discord.
 * Si un modèle personnalisé donne un résultat vide, on relance le rendu avec le texte par défaut.
 * @param {TemplateKey} key Clé du modèle.
 * @param {Vars} vars Valeurs des variables.
 * @param {Templates} [custom] Modèles personnalisés.
 * @returns {{title: string, description: string}} Titre et description, bornés aux limites Discord.
 */
export function renderTemplate(key: TemplateKey, vars: Vars, custom: Templates = {}): { title: string; description: string } {
  const t = resolveTemplate(key, custom);
  const allowed = new Set(Object.keys(D.meta[key]?.vars ?? {}));
  // Les retours à la ligne et espaces multiples du titre sont réduits : un titre tient sur une ligne.
  let title = fill(t.title, vars, allowed).replace(/\s+/g, ' ').trim();
  let description = fill(t.body, vars, allowed).trim();
  if (!title && !description && custom[key]) { // modèle personnalisé vide une fois rendu : on retombe sur le défaut
    return renderTemplate(key, vars, {});
  }
  if (!title && !description) { title = 'Humane Gang'; description = ''; }
  return { title: truncate(title, DISCORD_TITLE_MAX), description: truncate(description, DISCORD_DESC_MAX) };
}

/**
 * Embed Discord : n'ajoute titre/description que s'ils ne sont pas vides (Discord refuse les chaînes vides).
 * @param {{title: string, description: string}} r Titre et description rendus.
 * @param {Record<string, unknown>} [extra] Champs supplémentaires de l'embed (couleur, image...).
 * @returns {Record<string, unknown>} Objet embed.
 */
export function embedFrom(r: { title: string; description: string }, extra: Record<string, unknown> = {}) {
  return {
    ...(r.title ? { title: r.title } : {}),
    ...(r.description ? { description: r.description } : {}),
    ...extra,
  };
}
