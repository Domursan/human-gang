// Tests de la fonction edge hg-discord (commandes slash, idée D3) sans Deno ni réseau : Node 22 lit les .ts (types effacés).
// Couvre : signature Ed25519 (vraie, fausse, corps modifié, horodatage trop vieux), PING, serveur étranger, membre sans
// identifiant Discord, interaction rejouée (une seule action), réponse différée puis complétion par le webhook,
// interrupteur coupé, boutons (sortie, quiz) et identifiants de boutons forgés, autocomplétion, rendus éphémères.
// Lancer : node tests/check-hg-discord.mjs
import { webcrypto as crypto } from 'node:crypto';
import { makeHandler } from '../supabase/functions/hg-discord/handler.ts';
import { verifyDiscordRequest, parseCustomId, paillettesMessage, carteMessage, sortieMessage, quizMessage, COMMANDS, EPHEMERAL } from '../supabase/functions/hg-discord/lib.ts';

let pass = 0, fail = 0;
const check = (c, m) => { if (c) pass++; else fail++; console.log((c ? 'OK     ' : 'ECHEC ') + m); };
const hex = (b) => Buffer.from(b).toString('hex');

// Paire de clés de test (jamais la vraie clé de l'application)
const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const PUB = hex(await crypto.subtle.exportKey('raw', kp.publicKey));
const sign = async (ts, body) => hex(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(ts + body)));
const now = () => String(Math.floor(Date.now() / 1000));

/* ---------- Signature ---------- */
{
  const ts = now(), body = '{"type":1}', sig = await sign(ts, body);
  check(await verifyDiscordRequest(PUB, sig, ts, body), 'signature valide acceptée');
  check(!(await verifyDiscordRequest(PUB, sig, ts, body + ' ')), 'corps modifié refusé');
  check(!(await verifyDiscordRequest(PUB, sig.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')), ts, body)), 'signature fausse refusée');
  check(!(await verifyDiscordRequest(PUB, sig, String(Number(ts) - 3600), body)), 'horodatage d’il y a une heure refusé');
  check(!(await verifyDiscordRequest('', sig, ts, body)), 'clé publique absente : tout est refusé');
  check(!(await verifyDiscordRequest(PUB, 'zz', ts, body)), 'signature non hexadécimale refusée');
}

/* ---------- Faux environnement ---------- */
const USER = { id: 'aaaaaaaa-0000-0000-0000-000000000001', pseudo: 'alice' };
const EV = 'eeeeeeee-0000-4000-8000-000000000001', Q = '0a0a0a0a-0000-4000-8000-000000000001';
function env(over = {}) {
  const calls = [], logs = [], patches = [], tasks = [];
  const claimed = new Set();
  const toggles = { paillettes: true, carte: true, sortie: true, quiz: true, ...(over.toggles || {}) };
  const rpc = async (fn, a = {}) => {
    calls.push([fn, a]);
    switch (fn) {
      case 'hg_bot_commands_get': return toggles;
      case 'hg_bot_user': return a.p_discord === '111111111111111111' ? USER : null;
      case 'hg_bot_claim': if (claimed.has(a.p_id)) return false; claimed.add(a.p_id); return true;
      case 'hg_bot_me': return { paillettes: 1284, daily_available: false, daily_streak: 3, free_booster_at: new Date(Date.now() + 3 * 36e5 + 12 * 6e4 + 3e4).toISOString(), boosters_stock: 2, quests_total: 6, quests_done: 4 };
      case 'hg_bot_card': return { name: 'La Domu-mobile', family: 'objet', rarity: 'rare', set: 'Les OG', mine: 0, doubles: ['Nagarythe', 'Wae'], craftable: true, tradeable: true };
      case 'hg_bot_card_search': return ['La Domu-mobile', 'Le Nexus'];
      case 'hg_bot_next_outing': return { id: EV, title: 'Raclette sans raclette', location: 'Lausanne', starts_at: '2026-11-14T11:00:00Z', oui: 6, peut_etre: 1, mine: null };
      case 'hg_bot_rsvp': return { id: EV, title: 'Raclette sans raclette', location: 'Lausanne', starts_at: '2026-11-14T11:00:00Z', oui: 7, peut_etre: 1, mine: a.p_status };
      case 'hg_bot_quiz_pick': return { id: Q, prompt: 'Capitale ?', qtype: 'choix_unique', reward: 50, options: [{ id: 'a', text: 'Zurich' }, { id: 'b', text: 'Berne' }] };
      case 'hg_bot_quiz_answer': if (over.quizError) throw { message: 'Tu as déjà répondu à cette question' }; return { correct: a.p_response === 'b', reward: a.p_response === 'b' ? 50 : 0, explanation: null };
      default: throw new Error('RPC inattendue ' + fn);
    }
  };
  const handler = makeHandler({
    rpc, log: async (r) => { logs.push(r); },
    fetch: async (url, init) => { patches.push([url, init.method, JSON.parse(init.body)]); return new Response('{}', { status: 200 }); },
    later: (p) => tasks.push(p), publicKey: PUB, guild: '999999999999999999', site: 'https://domursan.github.io/human-gang',
  });
  const send = async (obj, { badSig = false } = {}) => {
    const body = JSON.stringify(obj), ts = now();
    const sig = badSig ? '00'.repeat(64) : await sign(ts, body);
    const res = await handler(new Request('https://x.supabase.co/functions/v1/hg-discord', { method: 'POST', body, headers: { 'X-Signature-Ed25519': sig, 'X-Signature-Timestamp': ts } }));
    const txt = await res.text();
    await Promise.all(tasks.splice(0));
    return { status: res.status, json: (() => { try { return JSON.parse(txt); } catch { return null; } })() };
  };
  return { send, calls, logs, patches };
}
let n = 100000000000000000n;
const cmd = (name, options = [], extra = {}) => ({ id: String(n++), type: 2, application_id: '123456789012345678', token: 'tok', guild_id: '999999999999999999',
  member: { user: { id: '111111111111111111' } }, data: { name, options }, ...extra });

/* ---------- Gestionnaire ---------- */
{
  const e = env();
  const r = await e.send({ type: 1 }, { badSig: true });
  check(r.status === 401 && e.calls.length === 0, 'signature fausse : 401 et aucune lecture de la base');
  check((await e.send({ type: 1 })).json?.type === 1, 'PING : réponse PONG');
  const g = await e.send(cmd('paillettes', [], { guild_id: '888888888888888888' }));
  check(g.json?.type === 4 && g.json.data.flags === EPHEMERAL && /serveur du Humane Gang/.test(g.json.data.content), 'autre serveur : refus éphémère');
  const u = await e.send(cmd('paillettes', [], { member: { user: { id: '222222222222222222' } } }));
  check(/pas encore relié/.test(u.json?.data?.content) && !e.calls.some(([f]) => f === 'hg_bot_me'), 'membre sans ID enregistré : explication, aucune donnée');
}
{
  const e = env();
  const c = cmd('paillettes');
  const r1 = await e.send(c);
  check(r1.json?.type === 5 && r1.json.data.flags === EPHEMERAL, '/paillettes : réponse différée éphémère');
  const emb = e.patches[0]?.[2]?.embeds?.[0];
  check(e.patches[0]?.[0].endsWith('/webhooks/123456789012345678/tok/messages/@original') && e.patches[0][1] === 'PATCH', 'complétion par le webhook d’interaction');
  check(/1\s?284 Paillettes/.test(emb?.title || ''), '/paillettes : solde affiché');
  check(emb?.fields?.some((f) => f.name === 'Quêtes de la semaine' && f.value === '4 / 6'), '/paillettes : quêtes 4 / 6');
  check(emb?.fields?.some((f) => f.name === 'Prochain booster gratuit' && /dans 3 h 1[12]/.test(f.value)), '/paillettes : prochain booster dans 3 h 12');
  check(e.logs[0]?.kind === 'cmd:paillettes' && !/1284|1 284/.test(JSON.stringify(e.logs[0])), 'journal « cmd:paillettes » sans le contenu de la réponse');
  const r2 = await e.send(c);
  check(/déjà été traitée/.test(r2.json?.data?.content) && e.calls.filter(([f]) => f === 'hg_bot_me').length === 1, 'interaction rejouée : une seule action');
}
{
  const e = env({ toggles: { carte: false } });
  const r = await e.send(cmd('carte', [{ name: 'nom', value: 'domu' }]));
  check(/désactivée/.test(r.json?.data?.content) && !e.calls.some(([f]) => f === 'hg_bot_card'), 'interrupteur coupé : /carte refusée');
}
{
  const e = env();
  await e.send(cmd('carte', [{ name: 'nom', value: 'domu' }]));
  const emb = e.patches[0]?.[2]?.embeds?.[0];
  check(emb?.title === 'La Domu-mobile' && emb.author.name === 'Objet · Série Les OG · Rare', '/carte : fiche (famille, série, rareté)');
  check(emb?.fields?.some((f) => f.value === 'Nagarythe, Wae'), '/carte : qui l’a en double');
  const ac = await e.send({ ...cmd('carte'), type: 4, data: { name: 'carte', options: [{ name: 'nom', value: 'do', focused: true }] } });
  check(ac.json?.type === 8 && ac.json.data.choices.length === 2, 'autocomplétion : réponse directe (type 8)');
}
{
  const e = env();
  const pub = await e.send(cmd('sortie', [{ name: 'public', value: true }]));
  check(pub.json?.type === 5 && pub.json.data.flags === 0, '/sortie public:true : visible du salon');
  const comps = e.patches[0]?.[2]?.components?.[0]?.components || [];
  check(comps.map((b) => b.custom_id).join(',') === `rsvp:${EV}:oui,rsvp:${EV}:peut-etre,rsvp:${EV}:non`, '/sortie : boutons J’y vais / Peut-être / Non');
  const priv = await e.send(cmd('sortie'));
  check(priv.json?.data?.flags === EPHEMERAL, '/sortie par défaut : éphémère');
  const b = await e.send({ ...cmd('x'), type: 3, data: { custom_id: `rsvp:${EV}:oui` } });
  check(b.json?.type === 5 && e.calls.some(([f, a]) => f === 'hg_bot_rsvp' && a.p_user === USER.id && a.p_status === 'oui'), 'bouton « J’y vais » : réponse enregistrée pour celui qui clique');
  check(/tu viens/.test(e.patches.at(-1)[2].content), 'bouton : confirmation');
  const forged = await e.send({ ...cmd('x'), type: 3, data: { custom_id: `rsvp:${EV}:admin` } });
  check(/plus valable/.test(forged.json?.data?.content) && e.calls.filter(([f]) => f === 'hg_bot_rsvp').length === 1, 'bouton forgé (statut inconnu) : refusé sans action');
}
{
  const e = env();
  await e.send(cmd('quiz'));
  const comps = e.patches[0]?.[2]?.components?.[0]?.components || [];
  check(comps.length === 2 && comps[1].custom_id === `quiz:${Q}:b`, '/quiz : un bouton par choix');
  await e.send({ ...cmd('x'), type: 3, data: { custom_id: `quiz:${Q}:b` } });
  check(/Bonne réponse ! \+50 Paillettes/.test(e.patches.at(-1)[2].content), 'réponse juste : +50 Paillettes');
  const e2 = env({ quizError: true });
  await e2.send({ ...cmd('x'), type: 3, data: { custom_id: `quiz:${Q}:a` } });
  check(/Impossible : Tu as déjà répondu/.test(e2.patches.at(-1)[2].content) && e2.logs[0]?.body.includes('échec'), 'deuxième réponse : message de la RPC, journal en échec');
}

/* ---------- Rendus et identifiants ---------- */
check(parseCustomId('quiz:not-a-uuid-000000000000000000000000:a') === null, 'identifiant de bouton mal formé refusé');
check(parseCustomId(`quiz:${Q}:a;drop`) === null, 'valeur de bouton avec caractères interdits refusée');
check(carteMessage(null, 'xyz', '').flags === EPHEMERAL, 'carte introuvable : message éphémère');
check(sortieMessage(null, '').content.includes('Aucune sortie'), 'aucune sortie prévue : message');
check(sortieMessage({ forbidden: true }, '').content.includes('pas ouverte'), 'page IRL non accordée : message');
check(quizMessage({ id: Q, prompt: 'Combien ?', qtype: 'nombre', reward: 10, options: [] }, 'https://s').components[0].components[0].style === 5, 'question à saisir : lien vers le site');
check(paillettesMessage({ paillettes: 0, daily_available: true, daily_streak: 0, free_booster_at: null, boosters_stock: 0, quests_total: 0, quests_done: 0 }, '').components.length === 0, 'sans SITE_URL : pas de bouton lien');
check(COMMANDS.every((c) => c.name.length <= 32 && c.description.length <= 100 && /^[a-z]+$/.test(c.name)), 'commandes conformes aux limites Discord');

console.log(`\n${pass} OK, ${fail} ECHEC(S)`);
process.exitCode = fail ? 1 : 0;
