# Déploiement des fonctions edge (Humane Gang)

Les trois fonctions importent le dossier partagé `_shared/` (modèles des messages du bot).
Chaque déploiement doit donc envoyer `index.ts` **et** les deux fichiers partagés, en gardant les chemins relatifs
(`index.ts` importe `../_shared/templates.ts`, qui importe `./bot-templates.json`).

| Fonction | Fichiers à envoyer | verify_jwt |
|---|---|---|
| `hg-notify` | `hg-notify/index.ts`, `_shared/templates.ts`, `_shared/bot-templates.json` | `true` |
| `hg-support` | `hg-support/index.ts`, `_shared/templates.ts`, `_shared/bot-templates.json` | `false` |
| `hg-birthdays` | `hg-birthdays/index.ts`, `_shared/templates.ts`, `_shared/bot-templates.json` | `false` |

Point d'entrée : `index.ts` pour les trois.

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

## Avec la CLI
```
supabase functions deploy hg-notify
supabase functions deploy hg-support --no-verify-jwt
supabase functions deploy hg-birthdays --no-verify-jwt
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
