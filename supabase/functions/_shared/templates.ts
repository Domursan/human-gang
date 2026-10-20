// ===== Humane Gang — modèles des messages du bot (partagé par hg-notify, hg-support, hg-birthdays) =====
// Textes par défaut : ./bot-templates.json (même fichier que l'éditeur de l'admin).
// Textes personnalisés : hg_settings.bot_templates = { [clé]: { title?, body? } } (un champ vide = texte par défaut).
// Rendu : {variable} remplacée par sa valeur ; une variable non prévue pour ce modèle (ou sans valeur) devient vide.
import defaults from './bot-templates.json' with { type: 'json' };

export type TemplateKey =
  | 'ss_draw_announce' | 'ss_draw_dm' | 'ss_gift_sent' | 'ss_gift_received' | 'irl_new'
  | 'message_new' | 'message_new_santa' | 'birthday_dm' | 'birthday_announce' | 'support_new' | 'bot_test';
export type Template = { title: string; body: string };
export type Templates = Partial<Record<string, Partial<Template>>>;
export type Vars = Record<string, string | number | null | undefined>;

type Defaults = {
  templates: Record<TemplateKey, Template>;
  meta: Record<TemplateKey, { vars: Record<string, unknown> }>;
};
const D = defaults as unknown as Defaults;

export const DISCORD_TITLE_MAX = 256;
export const DISCORD_DESC_MAX = 4096;

export const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Lit les modèles personnalisés (jamais d'erreur : en cas de problème, textes par défaut). */
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

const filled = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** Modèle effectif : texte personnalisé s'il est renseigné, sinon texte par défaut (champ par champ). */
export function resolveTemplate(key: TemplateKey, custom: Templates = {}): Template {
  const def = D.templates[key];
  const c = custom[key] ?? {};
  return { title: filled(c.title) ? c.title : def.title, body: filled(c.body) ? c.body : def.body };
}

/** Remplace {variable} ; seules les variables déclarées pour ce modèle sont acceptées. */
export function fill(text: string, vars: Vars, allowed?: Set<string>): string {
  return text.replace(/\{([a-z_]+)\}/g, (_m, name: string) => {
    if (allowed && !allowed.has(name)) return '';
    const v = vars[name];
    return v === null || v === undefined ? '' : String(v);
  });
}

/** Rend un modèle : { title ≤ 256, description ≤ 4096 } prêt pour un embed Discord. */
export function renderTemplate(key: TemplateKey, vars: Vars, custom: Templates = {}): { title: string; description: string } {
  const t = resolveTemplate(key, custom);
  const allowed = new Set(Object.keys(D.meta[key]?.vars ?? {}));
  let title = fill(t.title, vars, allowed).replace(/\s+/g, ' ').trim();
  let description = fill(t.body, vars, allowed).trim();
  if (!title && !description && custom[key]) { // modèle personnalisé vide une fois rendu : on retombe sur le défaut
    return renderTemplate(key, vars, {});
  }
  if (!title && !description) { title = 'Humane Gang'; description = ''; }
  return { title: truncate(title, DISCORD_TITLE_MAX), description: truncate(description, DISCORD_DESC_MAX) };
}

/** Embed Discord : n'ajoute titre/description que s'ils ne sont pas vides (Discord refuse les chaînes vides). */
export function embedFrom(r: { title: string; description: string }, extra: Record<string, unknown> = {}) {
  return {
    ...(r.title ? { title: r.title } : {}),
    ...(r.description ? { description: r.description } : {}),
    ...extra,
  };
}
