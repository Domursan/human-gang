# Déploiement des fonctions edge (Humane Gang)

Les fonctions importent le dossier partagé `_shared/` (modèles des messages du bot, annonces des événements).
Chaque déploiement doit donc envoyer `index.ts` **et** les fichiers partagés, en gardant les chemins relatifs
(`index.ts` importe `../_shared/templates.ts`, qui importe `./bot-templates.json` ; `hg-notify` et `hg-cron`
importent aussi `../_shared/dyn-announce.ts`).

| Fonction | Fichiers à envoyer | verify_jwt |
|---|---|---|
| `hg-notify` | `hg-notify/index.ts`, `_shared/discord.ts`, `_shared/templates.ts`, `_shared/bot-templates.json`, `_shared/dyn-announce.ts` | `true` |
| `hg-support` | `hg-support/index.ts`, `_shared/discord.ts`, `_shared/templates.ts`, `_shared/bot-templates.json` | `false` |
| `hg-birthdays` | `hg-birthdays/index.ts`, `_shared/discord.ts`, `_shared/cron-auth.ts`, `_shared/templates.ts`, `_shared/bot-templates.json` | `false` |
| `hg-cron` | `hg-cron/index.ts`, `_shared/discord.ts`, `_shared/cron-auth.ts`, `_shared/templates.ts`, `_shared/bot-templates.json`, `_shared/dyn-announce.ts` | `false` |
| `hg-album` | `hg-album/index.ts` (seul fichier ; dépendances `npm:fflate`, `npm:@supabase/supabase-js`) | `true` |
| `hg-push` | `hg-push/index.ts`, `_shared/cron-auth.ts` | `false` |

`_shared/discord.ts` (client Discord : MP, salon, 429) est commun aux quatre fonctions ; `_shared/cron-auth.ts` contrôle
l'en-tête `x-cron-secret` de `hg-cron` et `hg-birthdays`.

Point d'entrée : `index.ts` pour toutes.

## Avec l'outil MCP `deploy_edge_function`
`files` (noms relatifs au dossier de la fonction) :
```
[
  { "name": "index.ts",                    "content": "<supabase/functions/hg-notify/index.ts>" },
  { "name": "../_shared/templates.ts",     "content": "<supabase/functions/_shared/templates.ts>" },
  { "name": "../_shared/bot-templates.json","content": "<supabase/functions/_shared/bot-templates.json>" }
]
```
avec `entrypoint_path: "index.ts"` et `verify_jwt` selon le tableau. Même chose pour `hg-support` et `hg-birthdays`.
Pour `hg-notify` et `hg-cron`, ajouter aussi :
```
  { "name": "../_shared/dyn-announce.ts",  "content": "<supabase/functions/_shared/dyn-announce.ts>" }
```

## Avec la CLI
```
supabase functions deploy hg-notify
supabase functions deploy hg-support --no-verify-jwt
supabase functions deploy hg-birthdays --no-verify-jwt
supabase functions deploy hg-cron --no-verify-jwt
```
(la CLI embarque automatiquement `_shared/`).

## Notes
- Secrets inchangés : `DISCORD_BOT_TOKEN`, `SITE_URL` (facultatif), `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (fournis).
- Base : `hg_settings` clé `bot_templates` et table `hg_bot_log` (migration 011, déjà appliquée).
- `bot-templates.json` est aussi lu par la page d'administration (`fetch('supabase/functions/_shared/bot-templates.json')`).

### Attention : dossier `_shared` et GitHub Pages
GitHub Pages (Jekyll) **ignore les dossiers dont le nom commence par `_`**. Un fichier vide `.nojekyll` a donc été
ajouté à la racine du dépôt pour que `supabase/functions/_shared/bot-templates.json` soit publié. Effet de bord :
les `.md` (ex. `BOT.md`) sont servis tels quels (texte brut) au lieu d'être convertis par Jekyll.
Sans ce fichier, l'admin affiche un avertissement et ne peut pas éditer les modèles.

## Rappels, secret cron et anti-doublons : ordre à suivre

1. Appliquer la migration `supabase/migrations/020_bot_rappels.sql` (colonnes seulement, idempotente).
2. Secret des tâches planifiées : ligne `cron_secret` de la table privée `public.hg_private` (voir la fin de la migration 020 ;
   la variable d'environnement `CRON_SECRET`, si elle existe, est prioritaire). Sans secret, `hg-cron` et `hg-birthdays` refusent tout (401).
3. Déployer `hg-notify`, `hg-support`, `hg-birthdays` et `hg-cron` (tableau ci-dessus).
4. Mettre à jour les deux tâches pg_cron pour qu'elles envoient le secret (voir ci-dessous).

Tâches pg_cron (éditeur SQL). Remplacer `<CRON_SECRET>` par la valeur du secret, à l'identique :
```sql
select cron.unschedule('hg-cron-5min');
select cron.schedule(
  'hg-cron-5min',
  '*/5 * * * *',
  $$select net.http_post(
      url := 'https://zqbdzokyhgavgmqgiwuw.supabase.co/functions/v1/hg-cron',
      headers := '{"Content-Type":"application/json","x-cron-secret":"<CRON_SECRET>"}'::jsonb,
      body := '{}'::jsonb)$$
);
```
Pour `hg-birthdays-daily` : lire la planification actuelle avec `select jobname, schedule, command from cron.job;`,
puis garder la même planification et remplacer la commande par celle de `hg-cron-5min` (URL
`.../functions/v1/hg-birthdays`) en ajoutant le même en-tête `x-cron-secret`. Le secret est alors stocké dans la
commande de la tâche (visible des administrateurs du projet) ; pour éviter cela, on peut le lire depuis Vault.

Journal : chaque passage qui fait quelque chose (annonce, rappel, anniversaire, échec) laisse une ligne dans
`hg_bot_log` (kinds `auto:cron` et `auto:anniversaire`), visible dans l'historique du bot de l'administration.

## Cartes à collectionner : redéployer hg-notify
Les événements `card_pull` (belle carte obtenue) et `card_trade` (échange conclu) sont dans `hg-notify/index.ts`.
Les modèles `card_pull_announce` et `card_trade_announce` sont dans `_shared/bot-templates.json` et `_shared/templates.ts`.
**Redéployer `hg-notify`** (même fichiers que le tableau ci-dessus, aucun nouveau fichier partagé).
Aucun nouveau secret. Sans redéploiement, le site enverra `card_pull` et la fonction répondra « Événement inconnu ».
Aucune migration nouvelle pour cette fonction. Les règles d'accès (RLS) de la vitrine des cartes sont déjà en base et
figurent dans `supabase/schema/schema_reel_2026-10-21.sql` (section « Policies RLS »). Le fichier
`018_cartes_vitrine_rls.sql` mentionné auparavant n'a jamais existé dans le dépôt.

## hg-cron : tâches planifiées (toutes les 5 minutes)
Annonce automatiquement sur Discord le lancement et la fin des événements dynamiques (`hg_dyn_events` avec
`announce = true`). Idempotente : appelée deux fois, elle n'annonce rien de plus. Sans `DISCORD_BOT_TOKEN` ou sans
salon d'annonces, elle ne marque rien (les annonces partiront dès que le bot sera configuré), sauf la fin d'un
événement terminé depuis plus de 24 h, marquée sans envoi.

Tâche pg_cron à créer (éditeur SQL, une seule fois) :
```sql
select cron.schedule(
  'hg-cron-5min',
  '*/5 * * * *',
  $$select net.http_post(
      url := 'https://zqbdzokyhgavgmqgiwuw.supabase.co/functions/v1/hg-cron',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{}'::jsonb)$$
);
```
(même forme que `hg-birthdays-daily` ; pour l'arrêter : `select cron.unschedule('hg-cron-5min');`).

## Album téléchargeable (hg-album)
Fonction `hg-album` : assemble en ZIP, en flux, les photos d'une sortie (bucket privé `hg-photos`), pour le bouton
« Tout télécharger » de l'album (`assets/js/irl.js`, `downloadAlbum` dans `assets/js/photos.js`).
- Déployer `supabase/functions/hg-album/index.ts` seul, avec `verify_jwt` à `true` (tableau ci-dessus).
- Aucun secret à créer : la fonction agit avec le JWT de l'appelant et la clé publique envoyée par le site (`apikey`) ;
  elle ne reçoit jamais la clé de service. La RLS (membres) s'applique aux photos, aux sorties et au stockage.
- Plafonds : 400 photos et 300 Mo par ZIP (réponse 413 au-delà). Le ZIP n'est pas compressé (images déjà compressées).
- Si le stockage ne donne pas la taille d'une photo, le plafond est vérifié pendant l'envoi ; le téléchargement est alors
  interrompu côté navigateur (message d'erreur « Téléchargement impossible »).
- Vérification après déploiement : `POST /functions/v1/hg-album` avec `{"event_id": "<uuid>"}` et le JWT d'un membre
  renvoie un ZIP ; sans JWT, 401 ; avec un JWT de non-membre, 403.

## Réactions (migration 023)
Appliquer `supabase/migrations/023_reactions.sql` (idempotente) avant de publier le site : la table `hg_reactions`,
la RPC `hg_toggle_reaction` (bascule par la colonne `active`, sans suppression). Aucune fonction edge à redéployer pour les réactions.

## Notifications push et messagerie temps réel : hg-push (migration 025)

`hg-push` envoie une notification Web Push aux autres membres d'une conversation après chaque message (trigger
`hg_msg_push` de `025_push_realtime.sql`, appel asynchrone par pg_net). Elle ne contient que « Nouveau message » et
le nom de la conversation (« Secret Santa » pour un Secret Santa). Fichiers à envoyer : `hg-push/index.ts` et
`_shared/cron-auth.ts`. `verify_jwt` : `false`. Dépendance : `npm:web-push@3.6.7` (importée par Deno, rien à installer).

Ordre à suivre :
1. Appliquer `supabase/migrations/025_push_realtime.sql` (idempotente). Elle crée la table `hg_push_subscriptions`,
   la policy de messagerie temps réel et les deux triggers. Les triggers ne font rien tant que le secret `cron_secret`
   (table privée `hg_private`, migration 020) est absent.
2. Insérer les clés VAPID (une seule fois, éditeur SQL). Les commandes sont en commentaire en tête de la migration.
   La clé publique va dans `hg_settings` (clé `push_vapid_public`), la clé privée dans `hg_private`
   (clé `push_vapid_private`). Ne jamais les committer.
3. Déployer `hg-push` (tableau ci-dessus).
4. Secret facultatif : `VAPID_SUBJECT` (`mailto:` ou `https:`). Sans lui, `SITE_URL` est utilisé.

Tant que les clés VAPID ne sont pas insérées, la fonction répond `vapid_absent` et n'envoie rien. Le bouton
« Notifications sur cet appareil » de la page Mon compte reste alors indisponible.
