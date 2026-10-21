# Panel d'administration (Humane Gang)

Ce document décrit l'organisation du panel `admin.html`, le système de permissions Staff, ce qui reste réservé
à l'administrateur, et la marche à suivre pour ajouter une permission ou une sous-section. Il ne contient aucune
donnée personnelle. Pour retrouver l'accès administrateur, voir `supabase/ADMIN.md`.

## 1. Organisation du panel (option C)

- **Rail** : six domaines, dans l'ordre Pilotage, Membres, Vie du gang, Jeu de cartes, Communication, Site.
- **Colonne de navigation** : les sous-sections du domaine choisi. Une sous-section sans droit n'est ni affichée ni montée.
- **Zone principale** : liste et détail de la sous-section. Panneau d'infos à droite, à partir de 1440 px.
- **URL** : `admin.html#domaine/sous-section[/id[/onglet]]`, par exemple `#membres/comptes/<id>/<onglet>` ou `#cartes/quetes`.
  - Les anciennes ancres (`#comptes`, `#cartes`, `#journal`…) sont redirigées. `#membres` seul ouvre Invitations.
  - Un domaine ou une sous-section sans droit renvoie vers la première sous-section permise. Sans aucun droit, rien ne s'ouvre.
- **Montage à la demande** : chaque sous-section est montée à sa première visite (`registerSub`).
- **Palette « Aller à… »** : Ctrl/Cmd+K ou bouton du rail. Elle filtre les sous-sections permises et les membres.
- **Temps réel** : un seul canal Supabase Realtime (`admin/live.js`), abonné aux tables publiées (migration 030) dont
  l'utilisateur a le droit (`TABLE_PERM`). Les changements sont regroupés (800 ms). Une section en cours de saisie affiche
  « Mises à jour disponibles — Actualiser » au lieu de se recharger. Le voyant « En direct » est dans le rail.
- **Mobile (375 px)** : domaine, puis liste des sous-sections, puis détail avec retour.

Sources : `assets/js/admin/perms.js` (sections, permissions, domaines) et `assets/js/admin/router.js` (URL).
Côté base : `hg_has_perm()` et le catalogue `hg_perm_catalog`.

## 2. Système Staff

L'administrateur (`hg_profiles.is_admin`) a tous les droits. Un membre Staff a une liste de permissions
(`hg_staff.perms`) et un drapeau actif. Dans les règles RLS et les fonctions d'administration, `hg_is_admin()` est
remplacé par `hg_has_perm('<clé>')` (migrations 026 et 027). `hg_is_staff()` (administrateur, ou Staff actif avec au moins
une permission) sert à la lecture des profils et de l'état du panel.

### Catalogue des 12 permissions

| Clé | Ce qu'elle ouvre dans le panel | Tables et stockage (`hg_perm_tables`) |
|---|---|---|
| `membres` | Membres › Comptes, Comptes fantômes, Invitations, Accès aux pages | `hg_profiles`, `hg_profile_info`, `hg_invites`, `hg_invite_links`, `hg_page_access` |
| `evenements` | Vie du gang › Sorties IRL | `hg_events`, `hg_event_dates`, `hg_event_rsvps`, `hg_event_date_votes` |
| `souvenirs` | Vie du gang › Souvenirs et photos | `hg_moments`, `hg_photos`, `hg_reactions`, stockage `hg-photos` |
| `secret_santa` | Vie du gang › Secret Santa (éditions, participants, exclusions, tirages, vœux) | `hg_ss_editions`, `hg_ss_participants`, `hg_ss_exclusions`, `hg_ss_wishes`, `hg_ss_assignments` |
| `cartes` | Jeu de cartes (Séries, Cartes, Quêtes, Économie, Joueurs, Statistiques, Échanges) et Défis du gang | `hg_card_sets`, `hg_cards`, `hg_card_copies`, `hg_wallets`, `hg_wallet_log`, `hg_card_trades`, `hg_card_trade_items`, `hg_card_wishlist`, `hg_card_showcase`, `hg_challenges`, `hg_card_quests_templates` |
| `badges` | Vie du gang › Badges | `hg_badges`, `hg_user_badges` |
| `themes` | Vie du gang › Événements, Site › Thème | `hg_themes`, `hg_theme_seen`, `hg_dyn_events`, `hg_dyn_captures` |
| `messages` | Communication › Messagerie (lecture journalisée) | `hg_conversations`, `hg_conversation_members`, `hg_messages` |
| `support` | Communication › Assistance, Boîte à idées | `hg_support`, `hg_support_replies`, `hg_ideas` |
| `bot` | Communication › Bot Discord | `hg_bot_log`, `hg_birthday_log` |
| `reglages` | Site › Réglages (réglages généraux et pages) | `hg_settings` (clés générales), `hg_pages`, `hg_activity` |
| `journal` | Pilotage › Journal (actions admin) | `hg_admin_log` |

Pilotage › Vue d'ensemble est visible dès qu'une des tuiles est permise (Comptes, Membres, Secret Santa, Boîte à idées, Assistance).
Pilotage › Staff n'est pas une permission : elle est réservée à l'administrateur (voir « Réservé à l'administrateur »).

### Réservé à l'administrateur

Ces droits ne se délèguent pas, même à un Staff qui a toutes les permissions :

- **Le drapeau `is_admin`** : promotion ou retrait. Le trigger `hg_profiles_guard` l'annule si l'auteur n'est pas administrateur.
  Procédure dans `supabase/ADMIN.md`.
- **Gestion du Staff** : `hg_staff_list` et `hg_staff_set` exigent `is_admin` (écriture journalisée). La table `hg_staff`
  n'a pas de droit d'écriture direct.
- **Mode sans limite** : `hg_set_god_mode` et `hg_god_mode()` exigent `is_admin`.
- **Journal des lectures de messages** (`hg_admin_access_log`) : lecture réservée à l'administrateur. Une lecture de
  conversation (`hg_admin_read_conversation`, permission `messages`) y est toujours enregistrée.
- **E-mails des membres** : `hg_admin_accounts` ne renvoie l'adresse que si l'appelant est administrateur.
- **Clés de réglage sensibles** : `domursan_owner` et `admin_initial` n'ont aucune permission (`hg_settings_perm` renvoie `null`),
  seul l'administrateur peut les lire ou les écrire. `push_vapid_public` est public en lecture, en écriture réservée à l'administrateur.
- **Table `hg_private`** : RLS activée sans aucune règle. Elle n'est lisible que par les fonctions et triggers serveur.

## 3. Ajouter une permission

1. **Migration** (numéro libre suivant, idempotente, à ajouter au `README.md` des migrations) :
   - `insert into hg_perm_catalog (key, label, description, sort)` : clé en minuscules `^[a-z_]{2,32}$`.
   - `insert into hg_perm_tables (tbl, perm)` pour chaque table ou `storage:<bucket>` du domaine.
   - Remplacer `hg_is_admin()` par `hg_has_perm('<clé>')` dans les règles RLS et les fonctions d'administration concernées
     (même approche que la migration 027, qui ne touche pas aux règles déjà converties).
   - Si le domaine porte des clés de `hg_settings`, les ajouter à `hg_settings_perm` (migration 029).
   - Publier les tables temps réel utiles (`alter publication supabase_realtime add table …`).
2. **`assets/js/admin/perms.js`** : ajouter la section dans `SECTION_PERM` (section → clé), la sous-section dans `DOMAINS`,
   et la section dans `TILE_SECTIONS` si elle doit figurer dans la vue d'ensemble.
3. **`assets/js/admin/live.js`** : ajouter la table dans `TABLE_PERM` si elle doit être rafraîchie en direct.
4. **`admin.html`** : ajouter `<section id="<section>" class="admin-section" aria-labelledby="h-<section>">` dans `#shell-parking`,
   avec son conteneur de racine (`<div id="…-root">`), sur le modèle des sections existantes.
5. **Module** : créer le fichier (`assets/js/admin-<nom>.js`, ou `assets/js/admin/<nom>.js`) et l'enregistrer dans
   `assets/js/admin.js` : `registerSub('<domaine>/<sous-section>', { main, open, list, info, group })`. Les données partagées
   passent par `once()` ou un `ensure…` de `admin/loaders.js`.
6. **Service worker** : les modules `assets/js/admin/*.js` et les fichiers `admin-*.js` sont listés dans `PRECACHE` de `sw.js`.
   Ajouter le nouveau fichier à cette liste, et incrémenter `CACHE_VERSION`.
7. **Tests** : vérifier les parcours de navigation (`parcours-admin-nav`, `parcours-admin-coquille`, `parcours-staff`), qui
   peuvent énumérer les sections, puis ajouter un parcours pour le nouveau domaine (voir section 5).

## 4. Ajouter une sous-section

- **Dans un domaine existant, avec une permission existante** : ajouter l'entrée dans `DOMAINS` (`perms.js`) et l'appel
  `registerSub` dans `admin.js`. Aucune migration si les tables sont déjà couvertes. Mettre à jour les parcours de navigation.
- **Avec une nouvelle section** : suivre les étapes 4 à 6 de la section 3, sans la migration si la permission existe déjà.

## 5. Tester

Commandes, depuis la racine du dépôt (les tests servent le site statique et remplacent Supabase par un faux client) :

```sh
npm run check       # syntaxe de tous les fichiers JavaScript
npm run test:rpc    # chaque RPC et table appelée existe dans le schéma ou les migrations 020+
npm test            # tests de fumée puis parcours
```

Pour une sous-section, `adminSection(page, 'membres/comptes')` (`tests/lib/harness.cjs`) ouvre la route avant les interactions.
Les tests ne touchent jamais la vraie base : toute requête vers `*.supabase.co` est interceptée.

Parcours du panel (`tests/parcours-*.cjs`) :

| Fichier | Vérifie |
|---|---|
| `parcours-staff.cjs` | Section Staff (administrateur), Staff `cartes`+`journal`, membre simple redirigé |
| `parcours-admin-complements.cjs` | Quêtes, défis, réglages du site, pages, suppression d'une édition Secret Santa |
| `parcours-admin-sorties.cjs` | Sorties IRL : liste, création, modification, inscrits, suppression |
| `parcours-admin-souvenirs.cjs` | Souvenirs et photos : création, modification, suppression, réactions |
| `parcours-admin-nav.cjs` | Sous-sections montées à la demande, liens directs, palette Ctrl/Cmd+K, navigation mobile |
| `parcours-admin-direct.cjs` | Temps réel : abonnements selon les droits, bandeau de mise à jour pendant la saisie, reconnexion |
| `parcours-admin-recherche.cjs` | Recherche, « Afficher plus », fiche membre, état d'une action |
| `parcours-admin-coquille.cjs` | Rail et colonne de navigation, URL directe, redirection des anciennes ancres, Staff restreint, mobile |
| `parcours-admin-p2-pilotage.cjs` | Staff, Journal, Vue d'ensemble |
| `parcours-admin-p2-assistance.cjs` | Assistance et Boîte à idées : liste, détail, statut, recherche |
| `parcours-connexion.cjs`, `parcours-session.cjs` | Connexion, session absente ou fermée |
| `parcours-sortie.cjs`, `parcours-booster.cjs` | Proposer une sortie ; ouvrir un booster |

Un test ne vérifie que ce que le faux client sait simuler (`tests/fixtures/`). Une RPC absente du faux renvoie `null` sans erreur.
