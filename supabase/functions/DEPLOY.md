# Déploiement des fonctions edge (Humane Gang)

Les fonctions importent le dossier partagé `_shared/` (modèles des messages du bot, annonces des événements).
Chaque déploiement doit donc envoyer `index.ts` **et** les fichiers partagés, en gardant les chemins relatifs
(`index.ts` importe `../_shared/templates.ts`, qui importe `./bot-templates.json` ; `hg-notify` et `hg-cron`
importent aussi `../_shared/dyn-announce.ts`).

| Fonction | Fichiers à envoyer | verify_jwt |
|---|---|---|
| `hg-notify` | `hg-notify/index.ts`, `_shared/templates.ts`, `_shared/bot-templates.json`, `_shared/dyn-announce.ts` | `true` |
| `hg-support` | `hg-support/index.ts`, `_shared/templates.ts`, `_shared/bot-templates.json` | `false` |
| `hg-birthdays` | `hg-birthdays/index.ts`, `_shared/templates.ts`, `_shared/bot-templates.json` | `false` |
| `hg-cron` | `hg-cron/index.ts`, `_shared/templates.ts`, `_shared/bot-templates.json`, `_shared/dyn-announce.ts` | `false` |

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
