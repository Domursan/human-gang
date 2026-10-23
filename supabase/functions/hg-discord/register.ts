// ===== Humane Gang — enregistrement des commandes slash sur le serveur du gang =====
// Script à lancer à la main (une fois, puis à chaque changement de COMMANDS dans lib.ts), depuis son ordinateur :
//   DISCORD_APP_ID=… DISCORD_GUILD_ID=… DISCORD_BOT_TOKEN=… deno run --allow-net --allow-env supabase/functions/hg-discord/register.ts
// Les valeurs se trouvent dans le portail développeur Discord (Application ID, jeton du bot) et dans Discord
// (clic droit sur le serveur › « Copier l’identifiant du serveur »). Elles ne sont jamais écrites dans le dépôt.
// Commandes de serveur (« guild ») : visibles tout de suite, seulement sur ce serveur. PUT remplace la liste entière :
// une commande retirée de COMMANDS disparaît de Discord.
// Option --dry : affiche ce qui serait envoyé, sans appeler Discord.
// Dépendances : ./lib.ts (COMMANDS).
import { COMMANDS } from './lib.ts';

const app = Deno.env.get('DISCORD_APP_ID') ?? '';
const guild = Deno.env.get('DISCORD_GUILD_ID') ?? '';
const token = Deno.env.get('DISCORD_BOT_TOKEN') ?? '';
const dry = Deno.args.includes('--dry');

// Commandes de serveur uniquement (pas en MP), utilisables par tous les membres du serveur.
const body = COMMANDS.map((c) => ({ ...c, contexts: [0], dm_permission: false }));

if (dry) {
  console.log(JSON.stringify(body, null, 2));
  Deno.exit(0);
}
if (!/^\d{17,20}$/.test(app) || !/^\d{17,20}$/.test(guild) || !token) {
  console.error('Il manque DISCORD_APP_ID, DISCORD_GUILD_ID (identifiants numériques) ou DISCORD_BOT_TOKEN.');
  Deno.exit(1);
}
const res = await fetch(`https://discord.com/api/v10/applications/${app}/guilds/${guild}/commands`, {
  method: 'PUT',
  headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
if (!res.ok) {
  console.error(`Échec ${res.status} : ${(await res.text()).slice(0, 500)}`);
  Deno.exit(1);
}
const done = await res.json() as { name: string }[];
console.log(`${done.length} commandes enregistrées : ${done.map((c) => '/' + c.name).join(', ')}`);
