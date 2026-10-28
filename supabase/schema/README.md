# Schéma de référence (`schema_reel_2026-10-21b.sql`)

## Date et couverture

- **Fichier de référence : `schema_reel_2026-10-21b.sql`**, relevé le **21/10/2026**, après la migration **131**.
  Il ne reflète donc **pas** les migrations 132 à 166 (dernière : `166_plateaux_droits_internes.sql`), ni les
  éventuelles modifications faites directement dans la base après le relevé. Ne pas le considérer comme l'état actuel.
- `schema_reel_2026-10-21.sql` (relevé plus ancien, sans les migrations 020 à 032) est **périmé** : gardé pour mémoire, à ne plus utiliser.
- Le fichier ne contient ni données, ni secrets, ni adresses e-mail. Le seul marqueur est l'UUID du propriétaire
  de l'application Domursan (tables `d_*`), écrit `00000000-0000-0000-0000-000000000000`.

## Connu : il ne se rejoue pas sans erreur

Testé sur PostgreSQL 16 (bancs de `tests/bancs/cartes/`) : les extensions propres à Supabase (`supabase_vault`, `pg_net`,
`pg_cron`) sont absentes en local, ce qui est attendu (et `pgcrypto` doit être dans le `search_path`). Restent des défauts du fichier lui-même :

- la politique `hg_dates_write` (ligne 3130) a des parenthèses déséquilibrées : elle n'est pas créée, ce qui fait
  remonter une erreur de syntaxe vers la ligne 3209 ; la politique `hg_rsvps_creator` (ligne 3132) n'est pas créée non plus ;
- la publication `supabase_realtime` (ligne 3199) reste vide après le rejeu du fichier seul : à vérifier avant tout usage ;

## Comment le régénérer (lecture seule)

Le relevé doit être refait sur la base de production, **en lecture seule**. Deux possibilités :

1. **Éditeur SQL de Supabase** : exécuter des `select` sur les catalogues (`pg_class`, `pg_attribute`, `pg_constraint`,
   `pg_policies`, `pg_proc` avec `pg_get_functiondef`, `pg_trigger` avec `pg_get_triggerdef`, `storage.buckets`, `cron.job`),
   puis assembler le DDL. C'est ainsi que le fichier actuel a été produit.
2. **En ligne de commande**, avec l'adresse de connexion directe de la base (Project Settings › Database) :
   ```sh
   pg_dump --schema-only --schema=public --no-owner --no-privileges \
     "postgresql://postgres:MOT_DE_PASSE@HOTE:5432/postgres" > supabase/schema/schema_reel_AAAA-MM-JJ.sql
   ```
   Ne pas inclure le schéma `auth`, `storage` ni les extensions (les `--schema` le font). Relire le résultat et
   remplacer l'UUID du propriétaire Domursan par le marqueur, comme ci-dessus, avant de le commiter.

Ensuite : nommer le fichier avec la date du relevé, indiquer dans cet README la dernière migration couverte, et
vérifier qu'il se rejoue sur une base locale (voir `tests/bancs/cartes/rebuild.sh` pour l'imitation de Supabase).

Ne jamais exécuter ce fichier sur la production sans relecture.
