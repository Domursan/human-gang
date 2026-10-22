# Migrations Supabase (Humane Gang)

Ce dossier contient l'historique des modifications de la base, dans l'ordre. Les fichiers
ont été appliqués à la main (SQL Editor) ou via l'outil de migration ; les noms ne sont pas
renommés, car ils sont déjà référencés en production.

**Source de vérité** : `supabase/schema/schema_reel_2026-10-21b.sql`. Il reconstitue l'état réel
du schéma `public` tel qu'il est en base le 21/10/2026. L'ancien `schema_reel_2026-10-21.sql` est périmé
(il ne couvre pas les migrations 020 à 032). Les migrations 006, 009, 011, 012, 015 et 017
sont des résumés (le SQL exact a été exécuté pendant une session et n'a pas été conservé) : en cas
de différence, c'est le schéma reconstitué qui fait foi.

## Numérotation

| Fichier | Rôle | Statut |
|---|---|---|
| `001_hg_core_schema.sql` | Tables, fonctions et triggers de base. Contient une ancienne version de `hg_delete_my_account` (remplacée par 021) | appliqué |
| `002_hg_rls_storage.sql` | Policies RLS, buckets de stockage, compte admin initial | appliqué ; l'adresse admin n'est plus en dur (voir ci-dessous) |
| `003_a_coller_dans_supabase.sql` | Règles « supprimer », suppression de compte, verrou des tables `d_*` | appliqué à la main ; rejouable depuis la version corrigée |
| `005_admin_assets_select.sql` | Lecture admin des assets | appliqué |
| `006_themes_infos_admin.sql` | Thèmes, infos de profil (résumé) | appliqué, SQL exact absent |
| `009_messagerie_badges_recap.sql` | Messagerie, badges, récap (résumé) | appliqué, SQL exact absent |
| `011_admin_v4.sql` | Administration v4 (résumé) | appliqué, SQL exact absent |
| `012_niveaux_events_irl.sql` | Niveaux de badges, sorties IRL (résumé) | appliqué, SQL exact absent |
| `013_members_joined_on.sql` | Date d'arrivée des membres | appliqué |
| `014_badge_progress.sql` | Progression des badges | appliqué |
| `015_mode_sans_limite.sql` | Mode « sans limite » (résumé) | appliqué, SQL exact absent |
| `016_inscription_egale_arrivee.sql` | Inscription et arrivée | appliqué |
| `017_acces_pages.sql` | Accès aux pages (résumé) | appliqué, SQL exact absent |
| `018_cartes_tables.sql` | Tables du jeu de cartes (les policies sont dans le schéma reconstitué) | appliqué |
| `018_cartes_fonctions.sql` | Fonctions du jeu de cartes | appliqué |
| `019_comptes_fantomes.sql` | Comptes fantômes | appliqué |
| `021_securite_cartes.sql` | Sécurité, contraintes, journaux admin, corrections du jeu de cartes | **à appliquer** |
| `042_dons_groupes.sql` | Boosters offerts (`hg_wallets.gift_boosters`, `hg_open_booster_req` avec `p_offert`), don groupé (`hg_cards_admin_bulk_give`) | **à appliquer** (après 021 et 015) |
| `026_staff.sql` | Catalogue des 12 permissions (`hg_perm_catalog`), table `hg_staff`, fonction `hg_has_perm()` | appliqué |
| `027_staff_regles.sql` | Table `hg_perm_tables` (table ou stockage vers permission) ; `hg_is_admin()` remplacé par `hg_has_perm()` dans les règles RLS et les fonctions du panel | appliqué |
| `028_staff_ajustements.sql` | Journal des lectures de messages et e-mails réservés à l'administrateur ; modération des réactions (permission `souvenirs`) | appliqué |
| `029_staff_lectures.sql` | Lecture des profils par tout Staff ; permission de chaque clé de `hg_settings` (`hg_settings_perm`) ; `hg_admin_accounts` | appliqué |
| `030_admin_temps_reel.sql` | Publication `supabase_realtime` du panel (assistance, idées, profils, Staff, journal, cartes, sorties, souvenirs, Secret Santa) | appliqué |
| `031_corrections_ambiguites.sql` | Colonnes ambiguës corrigées dans `hg_admin_ghosts` et `hg_admin_conversations` | appliqué |
| `032_assistance_fil.sql` | Prise en charge et fil de réponses de l'assistance | **absent de cette branche** : ajouté par une autre branche |
| `068_quiz_vrai_faux_et.sql` | Questions vrai/faux (choix « Vrai » et « Faux » manquants), « & » lu comme « et » | appliqué en production |
| `069_types_boosters.sql` | Types de boosters (9 types, stock par type, garantie et limites par type), achat, ouverture, dons de boosters par type ; remplace le 067 (brouillon jamais appliqué) ; `hg_wallets.gift_boosters` versé dans le stock « classique » | **à appliquer** (après 042) |
| `070_bot_multi_salons.sql` | Bot Discord : détail par salon des envois (`hg_bot_log.channels`), annonces dans plusieurs salons | **à appliquer** (après 069 ; facultatif : les fonctions savent s'en passer) |
| `071_boosters_admin.sql` | Boosters paramétrables par l'admin et le Staff « cartes » : raretés et séries exclues par type (`excluded_rarities`, `excluded_sets`), RPC `hg_booster_type_save` et `hg_booster_type_stats`, journal des ouvertures `hg_booster_opens` ; Collectionneur sans identité ni série « Les OG » (`gang-membres`) | **à appliquer** (après 069) |

## Les trous et les doublons

- **067** : brouillon (stock et dons de boosters) jamais appliqué, remplacé par 069 ; le numéro reste vide.
- **004, 007, 008, 010, 020** : absents du dépôt. Rien ne prouve qu'il s'agissait de migrations
  appliquées ; si c'était le cas, leur effet est dans le schéma reconstitué. Ne pas créer de fichier
  à ces numéros pour les « combler ».
- **018** existe en deux fichiers : `018_cartes_tables.sql` (tables) et `018_cartes_fonctions.sql`
  (fonctions). Les deux ont été appliqués dans cet ordre (tables d'abord, car les fonctions les utilisent).
  L'ordre alphabétique convient ici.
- Les nouvelles migrations reprennent le numéro suivant libre (ici 021, après 019 et le 020 non utilisé).

## Rejouabilité

- **003** : chaque policy est précédée de `drop policy if exists`. Il exige désormais la clé
  `hg_settings.domursan_owner` (UUID du propriétaire Domursan, hors dépôt) pour la section 3 ;
  sans cette clé, la migration s'arrête à la section 3 avec un message explicite.
- **002** : le compte admin initial n'est plus écrit dans le dépôt. Il se lit dans
  `hg_settings.admin_initial` (`{"email": ..., "pseudo": ...}`), à insérer hors dépôt sur une base vierge.
- **021** : idempotente (`if not exists`, `create or replace`, `drop policy if exists`, `drop trigger if exists`,
  blocs `do` pour les contraintes). Testée deux fois de suite sans erreur sur une base de test.
- **001, 002, 006 à 019** : non modifiés, sauf 002 (ci-dessus). Certains ne sont pas rejouables tels quels
  (`create table` sans `if not exists`) : pour reconstruire une base vierge, utiliser le schéma reconstitué,
  pas un rejeu de l'historique.

## Pour appliquer 021

1. Relire `021_securite_cartes.sql`.
2. L'appliquer sur la base (une fois). Les contraintes `hg_profiles_color_format`, `hg_profiles_discord_format` et
   `hg_profiles_avatar_bucket` ont été vérifiées sur les données actuelles : aucune ligne en violation.
3. Déployer le front (`cartes.js`, `core.js`) en même temps : `cartes.js` envoie maintenant `p_request`
   à `hg_open_booster`, qui n'existe plus sous l'ancienne signature.
4. Pas de fonction edge à redéployer pour 021, ni de secret à créer.

## Pour appliquer 069

Migration `069_types_boosters.sql` : types de boosters, stock par type, achat, ouverture et dons de boosters (remplace le 067, jamais appliqué).

**Ce qu'elle ajoute**
- Tables `hg_booster_types` (les 9 types : prix, taille, taux, pool, limite par semaine, gratuit), `hg_booster_stock` (stock par membre et type), `hg_booster_pity` (garantie épique par type), `hg_booster_purchases` (achats, base des limites), `hg_booster_gifts` (dons, avec le type). RLS : lecture de ses lignes ; les types sont lisibles par les membres et modifiables par l'admin.
- RPC membres : `hg_booster_types_me()`, `hg_booster_buy(p_type, p_qty, p_request)`, `hg_booster_open(p_type, p_mode, p_request, p_set)`, `hg_booster_gift(p_to, p_type, p_qty, p_message, p_request)`, `hg_booster_gifts_me()`.
- Les types retirés de la vente (`active = false`) restent ouvrables et donnables depuis le stock ; `hg_booster_types_me` les renvoie avec `active: false` tant que le membre en a. Achat et ouverture payée refusés pour eux.
- Les boosters Collectionneur ne s'offrent pas. Le remboursement des cartes non données est calculé sur le prix payé par booster (dernier achat du membre pour ce type), jamais sur le prix actuel.
- Les taux des types sont validés par contrainte (`hg_booster_types_rates_check` : 7 raretés exactement, valeurs >= 0, somme entre 99,99 et 100,01). Les types ne sont modifiables que par les membres ayant la permission « cartes ».
- `hg_cards_me` renvoie en plus `boosters_stock`. `hg_cards_admin_bulk_give` verse les boosters offerts dans le stock « classique ».
- Le stock offert (`hg_wallets.gift_boosters`, migration 042) est versé dans le stock « classique » puis remis à 0.

**Idempotence et rétrocompatibilité**
- Rejouable : `create table if not exists`, `insert … on conflict do nothing` (relancer ne touche pas aux types : une modification faite par un admin est conservée), `create or replace`, policies, contraintes et clés étrangères dans des blocs `do` (`duplicate_object`). Testée sur une base PostgreSQL 16 locale neuve : migration appliquée deux fois, puis une troisième fois dans les contrôles (123 contrôles, 0 échec).
- `hg_open_booster_req` (042) garde sa signature, son chemin gratuit et son chemin offert, mais son chemin payant (`p_free => false`, `p_offert => false`) est refusé : « Les boosters s'achètent maintenant dans la Boutique ». Après la migration, son booster offert (`p_offert => true`) ne voit plus rien : le front doit ouvrir par `hg_booster_open(…, 'stock')`.
- Changement de signature : `hg_booster_gift` passe de 4 à 5 arguments (ajout de `p_request`). L'ancienne version est retirée par la migration. Un appel à 4 arguments reste valide (le dernier a une valeur par défaut).
- Erreurs à connaître pour le front : `don_deja_fait` (même requête de don rejouée par le même membre), « Les boosters Collectionneur ne s'offrent pas », « Ce booster n'est plus en vente » (ouverture payée ou gratuite d'un type retiré), « Les boosters s'achètent maintenant dans la Boutique » (ancien chemin payant).

**Pour appliquer 069**

1. Relire `069_types_boosters.sql`.
2. L'appliquer sur la base (une fois ; rejouable sans risque).
3. **Ordre : 069 d'abord, puis le front** (`cartes.js`, `cartes.css`, `cartes-boosters.css`, `sw.js`). Le front appelle les nouvelles RPC (dont `hg_booster_gift` à 5 arguments) : déployé avant la migration, il passerait en mode de repli (boutique et dons affichés « bientôt »).
4. Pas de fonction edge à redéployer pour 069, ni de secret à créer.

## Pour appliquer 071

Migration `071_boosters_admin.sql` : types de boosters modifiables depuis le panel (onglet « Boosters » des cartes), exclusions de raretés et de séries, Collectionneur sans identité ni « Les OG ».

**Ce qu'elle ajoute**
- `hg_booster_types` : colonnes `excluded_rarities text[]`, `excluded_sets text[]` (codes de `hg_card_sets`), `updated_by uuid` ; contraintes `hg_booster_types_excluded_rarities_check` (sous-ensemble des 7 raretés, pas toutes) et `hg_booster_types_id_format` (`^[a-z0-9_]{2,30}$`) ; index unique partiel `hg_booster_types_one_free` (un seul type `free_daily`).
- Table `hg_booster_opens` (une ligne par ouverture : type, mode, cartes données, remboursement), RLS sans policy : lue seulement par `hg_booster_type_stats`. Les statistiques d'ouverture commencent à l'application de 071.
- Tirage : `hg_booster_pick_one` passe à 6 arguments (séries exclues ; l'ancienne version à 5 arguments est retirée), `hg_booster_draw` et `hg_booster_open` gardent leur signature. Une rareté ou une série exclue n'est jamais tirée, ni par la garantie Épique, ni par le repli « sans restriction » du Collectionneur. Rareté tirée exclue : rareté autorisée inférieure, sinon supérieure. Pool « serie » : une série exclue est refusée à l'ouverture (« Cette série n'est pas disponible pour ce booster »). Remboursement inchangé (prix payé / taille, par carte non donnée).
- `hg_booster_types_me` renvoie en plus `excluded_rarities` et `excluded_sets` pour chaque type.
- RPC admin (`hg_has_perm('cartes')`) : `hg_booster_type_save(p jsonb)` (création avec `create: true`, sinon modification partielle ; id immuable ; un seul type gratuit du jour ; journal `hg_admin_log` action `booster_type` avec avant/après) et `hg_booster_type_stats()` (ventes 7 j / 30 j / total, ouvertures, stock détenu, dons, par type).
- Collectionneur : `excluded_rarities = {identite}`, `excluded_sets = {gang-membres}`, taux identité 0,1 -> 0 et commune 60 -> 60,1 (somme 100). Seulement si l'admin n'a rien modifié : exclusions écrites si elles sont vides et `updated_by` vide ; taux écrits seulement s'ils valent encore exactement ceux de 069.

**Idempotence et rétrocompatibilité**
- Rejouable : `add column if not exists`, `create table if not exists`, contraintes et index dans des blocs `do`, `create or replace`. Relancer 071 n'écrase jamais une modification faite par `hg_booster_type_save` (`updated_by` renseigné). Testée sur PostgreSQL 16 local : 069 puis 071 deux fois, suite 069 adaptée (123 contrôles) et suite 071 (86 contrôles), 0 échec.
- Changements de comportement voulus : le Collectionneur ne donne plus d'identité ni de carte « Les OG » (cartes non données remboursées ; s'il ne manque au membre que des cartes exclues, l'ouverture est refusée sans rien consommer, comme en 069).

**Pour appliquer 071**

1. Relire `071_boosters_admin.sql`.
2. L'appliquer sur la base (après 069 ; rejouable sans risque).
3. Puis le front (onglet admin « Boosters »). Le front membre existant continue de fonctionner sans changement.
4. L'affiche A3 des boosters est statique : la régénérer si les types changent.
5. Pas de fonction edge à redéployer, ni de secret à créer.
