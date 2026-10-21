# Schéma reconstitué (`schema_reel_2026-10-21.sql`)

## Ce que c'est

`schema_reel_2026-10-21.sql` décrit l'état réel du schéma `public` du projet Supabase
`zqbdzokyhgavgmqgiwuw` le 21/10/2026 : tables et colonnes, défauts, identités, contraintes,
index, RLS, policies, fonctions, triggers, séquences, extensions, politiques du stockage
(`storage.objects`), buckets (noms et visibilité) et tâches pg_cron.

Il fait foi pour les résumés de migrations `006`, `009`, `011`, `012`, `015` et `017`, dont le SQL
exact n'a jamais été conservé dans le dépôt. Il fait aussi foi, pour les policies et les fonctions
qu'il recense, sur `018_cartes_tables.sql`, `018_cartes_fonctions.sql` et `003`.

## Comment il a été produit

- Lecture seule uniquement : des `select` sur `pg_catalog`, `information_schema`, `pg_policies`,
  `pg_trigger`, `pg_indexes`, `pg_get_functiondef`, `pg_get_triggerdef`, `storage.buckets` et `cron.job`.
  Aucune écriture, aucun `apply_migration`, aucun DDL sur la base de production.
- Les résultats ont été assemblés par un script (non versionné) qui écrit le DDL à partir de ces catalogues :
  `information_schema.columns` pour les tables, `pg_constraint` pour les contraintes, `pg_get_functiondef`
  pour les fonctions, etc.
- Ordre du fichier : extensions, séquences hors identité, tables, contraintes (PK, UNIQUE, CHECK puis FK),
  index, fonctions (avec `check_function_bodies` désactivé, car les fonctions SQL peuvent se référencer),
  triggers, RLS, policies, policies de stockage, buckets, puis pg_cron en commentaire.

## Ce qu'il ne contient pas, volontairement

- **Aucune donnée de lignes**, aucun secret, aucun e-mail. Une recherche sur le fichier ne trouve aucune adresse
  e-mail ni aucun UUID réel.
- **Un seul marqueur** : l'UUID du propriétaire de l'application Domursan (tables `d_*`), qui apparaît dans
  des policies « owner_lock ». Il est écrit `00000000-0000-0000-0000-000000000000`. Pour rejouer le fichier,
  remplacer ce marqueur par la vraie valeur, hors du dépôt (ou utiliser la clé `hg_settings.domursan_owner`
  décrite dans `supabase/migrations/README.md`).
- Les URL des fonctions edge dans pg_cron sont ramenées à `<PROJECT_REF>`.

## Ce qu'il ne couvre pas

- Les privilèges (`GRANT` / `REVOKE`) : non recensés dans ce fichier. Les privilèges par défaut de Supabase
  s'appliquent à la reconstitution ; les `grant` écrits dans les migrations restent la référence.
- Les réglages du projet (auth, SMTP, buckets au-delà de leur nom et visibilité), les secrets (vault), les
  fonctions edge (dans `supabase/functions/`), le contenu des buckets (fichiers).
- Les tables des autres schémas (`auth`, `storage` hors `objects` et `buckets`).

## Contrôle effectué

- Le fichier a été rejoué sur une base PostgreSQL 16 locale de test (pas la production), après des stubs
  minimaux pour `auth` (`auth.uid()`, `auth.users`) et `storage` (`buckets`, `objects`, `foldername`), et
  sans les extensions Supabase absentes localement (`supabase_vault`, `pg_net`, `pg_cron`).
  Résultat : 0 erreur au premier passage ; 0 erreur au second passage (idempotent) ; 55 tables,
  115 policies, 36 triggers, 94 index.
- Le fichier a été généré à partir de la base du 21/10/2026. Il doit être regénéré (et relu) à chaque changement
  de schéma significatif ; la migration `021_securite_cartes.sql` a été écrite après ce relevé et doit être appliquée
  par-dessus.

## Pour le régénérer

Relancer les mêmes `select` en lecture seule sur les catalogues (voir la section « Comment il a été produit »),
puis comparer avec le fichier existant. Ne jamais exécuter ce fichier sur la production sans relecture.
