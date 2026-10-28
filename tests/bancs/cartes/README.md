# Banc « cartes » : économie des cartes (boosters, échanges, recyclage, droits)

Ce banc teste en SQL l'économie des cartes : achat et ouverture de boosters, échanges entre membres,
recyclage, et ce qu'un membre peut lire ou écrire directement (RLS et privilèges). Il tourne sur PostgreSQL 16 local,
pas sur la production.

## Lancer le banc

Depuis la racine du dépôt :

```sh
cd tests/bancs/cartes
./rebuild.sh                      # ~2 à 3 minutes : recrée la base « cartes » (lance le cluster si besoin)
./run.sh t1_boosters.sql t2_echanges.sql t3_recyclage.sql t4_rls.sql
```

- `rebuild.sh` démarre le cluster PostgreSQL par `tests/bancs/loup-garou/start.sh` (port 54329, socket `/tmp`),
  puis recrée la base `cartes` à partir de zéro. Il faut le relancer après toute modification de `seed.sql`,
  car chaque scénario modifie l'état (soldes, cartes, offres).
- `run.sh` exécute les scénarios dans l'ordre donné, arrêt à la première erreur SQL, et n'affiche que les lignes
  `ok`, `ÉCHEC`, `BILAN` et les erreurs.
- Chaque scénario se termine par `t_bilan_fin()` qui affiche le nombre d'assertions réussies et échouées.

## Ce qui est imité, et ce qui ne l'est pas

- `mock.sql` imite l'environnement Supabase : rôles `anon`, `authenticated`, `service_role`, schémas `auth`,
  `storage`, `vault`, `cron`, `net`, `realtime`, `extensions`, la fonction `auth.uid()`, les privilèges par défaut.
  `pgcrypto` est dans le schéma `extensions` (le `search_path` de la base l'inclut).
- Le schéma de départ est `supabase/schema/schema_reel_2026-10-21b.sql` (relevé au 21/10, après la migration 131).
  Il est rejoué avec les identifiants du propriétaire remplacés, puis les migrations **022 à 166** sont appliquées
  dans l'ordre des noms. Les migrations 001 à 021 ne se rejouent pas depuis le dépôt (004, 007, 008, 010, 020 absents ;
  006, 009, 011, 012, 015, 017 sont des résumés), d'où ce point de départ.
- Les extensions `supabase_vault`, `pg_net` et `pg_cron` ne sont pas disponibles en local : leurs erreurs sont attendues.
- Le schéma de référence ne contient ni GRANT ni REVOKE. `rebuild.sh` rejoue donc les GRANT et REVOKE des migrations
  001 à 021 (et seulement ceux-là) après le schéma, pour que les droits des fonctions soient ceux de la production.
  Sans cela, `mock.sql` accorderait EXECUTE à `authenticated` sur toutes les fonctions.

### Erreurs connues, non bloquantes

Les migrations et le schéma sont chargés sans arrêter le banc. `rebuild.sh` affiche le nombre d'erreurs et les liste.
Erreurs connues (état au 28/10) :

- 025 et 153 : objets du schéma `realtime` absents en local (2 erreurs).
- 029 (2 erreurs), 033 : politiques à modifier qui n'existent pas dans le schéma reconstitué.
- 093 (2 erreurs) : politiques `hg_moments_read` et `hg_photos_read` absentes du schéma reconstitué.
- 096, 102, 164 : contrainte `hg_themes_end_md_check` violée par la ligne insérée.
- 146 : texte à remplacer (`hg__patch`) introuvable dans la fonction créée par les migrations précédentes.

Soit 11 erreurs dans 9 fichiers (rebuild.sh les affiche à chaque reconstruction).

Défauts du schéma de référence lui-même (à corriger dans un relevé futur, voir `supabase/schema/README.md`) :
la politique `hg_dates_write` (ligne 3130) a des parenthèses déséquilibrées, `hg_rsvps_creator` (ligne 3132) n'est pas créée,
et la publication `supabase_realtime` est vide après rejeu.

## Fichiers

- `helpers.sql` : `t_ok`, `t_bilan_fin`, `t_uid`, `t_call` (appel de RPC en tant que membre, renvoie le jsonb),
  `t_do`, `t_err` (renvoie le message d'erreur ou null), `t_count` (lecture en tant que membre), `t_exec` (écriture
  directe : `n ligne(s)` ou `ERR : message`), `t_copie` (n-ième exemplaire vivant, échangeable et non verrouillé d'un membre).
- `seed.sql` : membres 2 à 5 (inscrits il y a 30 jours, pour passer le délai de 7 jours des cadeaux), 2 000 Paillettes
  chacun, une extension de jeu « banc » de cartes, une carte non échangeable, une carte « Identité » limitée à 2 exemplaires,
  et des exemplaires de départ donnés avec la source `admin`.
- `t1_boosters.sql` : achat, débit, ouverture depuis le stock, refus sans stock, requête rejouée, plafond hebdomadaire,
  Paillettes insuffisantes, plafond d'exemplaires.
- `t2_echanges.sql` : échange entre deux membres sans carte perdue ni dupliquée, refus si une carte n'est plus possédée,
  cadeau, annulation.
- `t3_recyclage.sql` : valeur versée (brillante ×3), cartes marquées et non supprimées, refus (déjà recyclée, carte d'un
  autre, carte bloquée sur une offre, Identité), liste vide.
- `t4_rls.sql` : ce qu'un membre voit et écrit directement, et les fonctions d'économie appelées hors RPC.

## Constats (comportements voulus, pas des bogues)

- Un membre peut lire la collection (exemplaires, cartes) d'un autre membre : c'est voulu, en lecture seule
  (`#collection/<id>`, PLAN-DU-SITE). Le test le vérifie comme constat.
- Les tables privées (journal des Paillettes, stock de boosters, garanties, journal des ouvertures) sont en lecture
  filtrée par RLS ou sans privilège pour `authenticated`. Le test accepte les deux formes de refus.

## Limites

- Le banc ne teste pas le remboursement du pool « manquantes » (aucun scénario).
- Le banc ne couvre pas la concurrence (deux requêtes simultanées) : il n'y a qu'une session.
- Le schéma reconstitué n'est pas la production : un succès ici ne prouve pas l'état réel de la base distante.
