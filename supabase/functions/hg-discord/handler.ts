// ===== Humane Gang — fonction edge « hg-discord » : traitement des interactions (sans Deno ni réseau direct) =====
// Fichier découpé de index.ts pour être testé hors Deno (tests/check-hg-discord.mjs) : tout accès extérieur passe par Deps.
// Rôle : point d'entrée « Interactions Endpoint URL » de l'application Discord. Reçoit /paillettes, /carte, /sortie, /quiz,
// l'autocomplétion de /carte et les boutons (réponse à une sortie, réponse au quiz).
// Sécurité :
//   - chaque requête est vérifiée (signature Ed25519 de Discord, secret DISCORD_PUBLIC_KEY) : sinon 401, rien n'est lu ;
//   - le membre est reconnu par hg_profiles.discord_id (enregistré par le Staff seulement) via hg_bot_user ;
//   - toute action passe par les RPC hg_bot_* (clé service), qui appellent les RPC du site « au nom » du membre :
//     mêmes plafonds, mêmes quotas, mêmes récompenses que sur le site ;
//   - une interaction n'agit qu'une fois (hg_bot_claim, table hg_bot_interactions) ;
//   - réponses personnelles éphémères (seul l'auteur les voit) ; /sortie public:true seulement sur demande ;
//   - si DISCORD_GUILD_ID est défini, les commandes venant d'un autre serveur sont refusées.
// Réponse différée (type 5) puis complétion par le webhook d'interaction (EdgeRuntime.waitUntil) : le délai de 3 s de
// Discord est court au démarrage à froid. L'autocomplétion répond directement (elle ne peut pas être différée).
// Journal : une ligne hg_bot_log par commande (kind « cmd:<nom> »), sans le contenu de la réponse.
// Interrupteurs : hg_settings.bot_commandes (Admin › Communication › Commandes slash), lus par hg_bot_commands_get.
// Secrets : DISCORD_PUBLIC_KEY (obligatoire), DISCORD_GUILD_ID (recommandé), SITE_URL (facultatif : boutons liens),
//   SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (fournis). Aucun jeton de bot n'est nécessaire ici (webhook d'interaction).
// verify_jwt = false (Discord n'envoie pas de JWT Supabase).
// Exporte : Deps, makeHandler.
// Dépendances : ./lib.ts (signature, rendus) ; RPC hg_bot_user, hg_bot_claim, hg_bot_commands_get, hg_bot_me, hg_bot_card,
//   hg_bot_card_search, hg_bot_next_outing, hg_bot_rsvp, hg_bot_quiz_pick, hg_bot_quiz_answer (migration 087) ; table hg_bot_log.
import {
  COMMAND_NAMES, EPHEMERAL, carteMessage, paillettesMessage, parseCustomId, quizMessage, quizResultMessage, sortieMessage,
  textMessage, verifyDiscordRequest, type Card, type Me, type Outing, type Quiz,
} from './lib.ts';

const API = 'https://discord.com/api/v10';

/** Réponse JSON pour Discord. */
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
/** Réponse immédiate avec un message (type 4). */
const reply = (data: unknown) => json({ type: 4, data });

// deno-lint-ignore no-explicit-any
type Interaction = any;

/** Message lisible d'une erreur de RPC (les fonctions SQL lèvent des messages en français destinés au membre). */
const why = (e: unknown) => String((e as { message?: string })?.message || e || 'erreur').slice(0, 300);

/** Dépendances injectées (index.ts en production, tests/check-hg-discord.mjs en test). */
export type Deps = {
  /** Appelle une RPC (clé service) et renvoie ses données, ou lève l'erreur. */
  rpc: <T>(fn: string, args?: Record<string, unknown>) => Promise<T>;
  /** Écrit une ligne dans hg_bot_log. */
  log: (row: Record<string, unknown>) => Promise<void>;
  /** fetch (appel du webhook d'interaction). */
  fetch: typeof fetch;
  /** Lance une tâche après la réponse. */
  later: (p: Promise<unknown>) => void;
  /** Clé publique de l'application, serveur autorisé, adresse du site. */
  publicKey: string; guild: string; site: string;
};

/**
 * Fabrique le gestionnaire HTTP des interactions.
 * @param {Deps} d Dépendances.
 * @returns {(req: Request) => Promise<Response>}
 */
export function makeHandler(d: Deps) {
  const { rpc, site: SITE, guild: GUILD } = d;

  /** Ligne de journal de l'admin (sans contenu de réponse). Ne fait jamais échouer la commande. */
  async function logCmd(name: string, ok: boolean, userId: string | null) {
    try {
      await d.log({ kind: `cmd:${name}`, title: `/${name}`, body: ok ? `/${name}` : `/${name} (échec)`,
        recipients: userId ? [{ user_id: userId, ok }] : [], channel: false });
    } catch (e) { console.error('[hg-discord] journal', why(e)); }
  }

  /**
   * Complète une réponse différée : modifie le message « réfléchit… » par le webhook d'interaction.
   * @param {Interaction} it Interaction reçue (application_id, token).
   * @param {Record<string, unknown>} data Contenu final (content, embeds, components). Les drapeaux restent ceux du différé.
   */
  async function complete(it: Interaction, data: Record<string, unknown>) {
    const { flags: _f, ...rest } = data as { flags?: number };
    const res = await d.fetch(`${API}/webhooks/${it.application_id}/${it.token}/messages/@original`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rest),
    });
    if (!res.ok) console.error('[hg-discord] complétion', res.status, (await res.text()).slice(0, 200));
  }


  /** Option d'une commande par son nom. */
  const opt = (it: Interaction, name: string) => (it.data?.options ?? []).find((o: { name: string }) => o.name === name)?.value;

  /** Traite une commande (après réponse différée) et renvoie le message final. */
  async function runCommand(it: Interaction, name: string, user: { id: string }): Promise<Record<string, unknown>> {
    if (name === 'paillettes') {
      const me = await rpc<Me | null>('hg_bot_me', { p_user: user.id });
      return me ? paillettesMessage(me, SITE) : textMessage('Ton compte n’est pas actif sur le site.');
    }
    if (name === 'carte') {
      const q = String(opt(it, 'nom') ?? '').slice(0, 100);
      return carteMessage(await rpc<Card | null>('hg_bot_card', { p_user: user.id, p_query: q }), q, SITE);
    }
    if (name === 'sortie') {
      return sortieMessage(await rpc<Outing>('hg_bot_next_outing', { p_user: user.id }), SITE, opt(it, 'public') !== true);
    }
    if (name === 'quiz') return quizMessage(await rpc<Quiz>('hg_bot_quiz_pick', { p_user: user.id }), SITE);
    return textMessage('Commande inconnue.');
  }

  /** Traite un bouton (réponse à une sortie ou au quiz) pour la personne qui a cliqué. */
  async function runButton(btn: NonNullable<ReturnType<typeof parseCustomId>>, user: { id: string }): Promise<Record<string, unknown>> {
    if (btn.kind === 'rsvp') {
      const o = await rpc<Outing>('hg_bot_rsvp', { p_user: user.id, p_event: btn.id, p_status: btn.value });
      const label = btn.value === 'oui' ? 'C’est noté : tu viens !' : btn.value === 'non' ? 'C’est noté : tu ne viens pas.' : 'C’est noté : peut-être.';
      return { ...sortieMessage(o, SITE, true), content: label };
    }
    const r = await rpc<{ correct: boolean | null; reward: number; explanation?: string | null }>('hg_bot_quiz_answer',
      { p_user: user.id, p_question: btn.id, p_response: btn.value });
    return quizResultMessage(r);
  }

  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return new Response('Méthode non permise', { status: 405 });
    const publicKey = d.publicKey;
    const body = await req.text();
    if (body.length > 100_000) return new Response('Trop gros', { status: 413 });
    const ok = await verifyDiscordRequest(publicKey, req.headers.get('X-Signature-Ed25519'), req.headers.get('X-Signature-Timestamp'), body);
    if (!ok) return new Response('Signature invalide', { status: 401 });

    let it: Interaction;
    try { it = JSON.parse(body); } catch { return new Response('JSON invalide', { status: 400 }); }

    // PING de vérification (enregistrement de l'URL dans le portail développeur)
    if (it.type === 1) return json({ type: 1 });

    if (GUILD && it.guild_id !== GUILD) return reply(textMessage('Ces commandes ne fonctionnent que sur le serveur du Humane Gang.'));
    const discordId = String(it.member?.user?.id ?? it.user?.id ?? '');

    // Autocomplétion de /carte : réponse directe (25 choix au plus).
    if (it.type === 4) {
      if (it.data?.name !== 'carte') return json({ type: 8, data: { choices: [] } });
      const focused = (it.data?.options ?? []).find((o: { focused?: boolean }) => o.focused);
      let names: string[] = [];
      try { names = await rpc<string[]>('hg_bot_card_search', { p_query: String(focused?.value ?? '').slice(0, 100) }); } catch (e) { console.error('[hg-discord] autocomplétion', why(e)); }
      return json({ type: 8, data: { choices: (names ?? []).slice(0, 25).map((n) => ({ name: n.slice(0, 100), value: n.slice(0, 100) })) } });
    }

    if (it.type !== 2 && it.type !== 3) return reply(textMessage('Interaction non prise en charge.'));
    const name = it.type === 2 ? String(it.data?.name ?? '') : 'bouton';
    const btn = it.type === 3 ? parseCustomId(it.data?.custom_id) : null;
    if (it.type === 2 && !COMMAND_NAMES.includes(name)) return reply(textMessage('Commande inconnue.'));
    if (it.type === 3 && !btn) return reply(textMessage('Ce bouton n’est plus valable.'));

    // Interrupteur de l'admin (la commande d'origine d'un bouton : sortie ou quiz)
    const toggle = it.type === 2 ? name : btn!.kind === 'rsvp' ? 'sortie' : 'quiz';
    try {
      const on = await rpc<Record<string, boolean>>('hg_bot_commands_get');
      if (on && on[toggle] === false) return reply(textMessage(`La commande /${toggle} est désactivée pour le moment.`));
    } catch (e) { console.error('[hg-discord] interrupteurs', why(e)); }

    // Membre reconnu ?
    let user: { id: string; pseudo: string } | null = null;
    try { user = await rpc('hg_bot_user', { p_discord: discordId }); } catch (e) { console.error('[hg-discord] membre', why(e)); }
    if (!user) {
      return reply(textMessage('Ton compte Discord n’est pas encore relié au site. Demande au Staff via l’assistance du site'
        + (SITE ? ` (${SITE}/pages/infos/assistance.html)` : '') + ' : donne-lui ton identifiant Discord (Paramètres › Avancés › Mode développeur, puis clic droit sur ton profil › « Copier l’identifiant »).'));
    }

    // Idempotence : une interaction n'agit qu'une fois.
    let first = false;
    try { first = await rpc<boolean>('hg_bot_claim', { p_id: String(it.id), p_user: user.id, p_command: it.type === 2 ? name : `bouton:${btn!.kind}` }); }
    catch (e) { return reply(textMessage(`Erreur : ${why(e)}`)); }
    if (!first) return reply(textMessage('Cette commande a déjà été traitée.'));

    const ephemeral = !(it.type === 2 && name === 'sortie' && opt(it, 'public') === true);
    d.later((async () => {
      let msg: Record<string, unknown>; let success = true;
      try {
        msg = it.type === 2 ? await runCommand(it, name, user!) : await runButton(btn!, user!);
      } catch (e) {
        success = false;
        msg = textMessage(`Impossible : ${why(e)}`);
      }
      await complete(it, msg);
      await logCmd(it.type === 2 ? name : `bouton-${btn!.kind}`, success, user!.id);
    })());
    // Réponse différée : « Humane Gang réfléchit… », éphémère sauf /sortie public:true.
    return json({ type: 5, data: { flags: ephemeral ? EPHEMERAL : 0 } });
  };
}
