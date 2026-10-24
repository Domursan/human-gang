# Panel d'administration (Humane Gang)

Ce document décrit l'organisation du panel `admin.html`, le système de permissions Staff, ce qui reste réservé
à l'administrateur, et la marche à suivre pour ajouter une permission ou une sous-section. Il ne contient aucune
donnée personnelle. Pour retrouver l'accès administrateur, voir `supabase/ADMIN.md`.

## 1. Organisation du panel

- **Rail** : six domaines, dans l'ordre Pilotage, Membres, IRL, Event, Le jeu de cartes, Autres jeux.
- **Colonne de navigation** : les sous-sections du domaine choisi, réparties en groupes (Comptes, Badges, Économie…).
  Une sous-section sans droit n'est ni affichée ni montée. Un domaine sans sous-section permise est masqué.
- **Zone principale** : liste et détail de la sous-section. Panneau d'infos à droite, à partir de 1440 px.
- **URL** : `admin.html#domaine/sous-section[/id[/onglet]]`, par exemple `#membres/comptes/<id>/<onglet>` ou `#cartes/quetes`.
  - Un domaine ou une sous-section sans droit renvoie vers la première sous-section permise. Sans aucun droit, rien ne s'ouvre.
- **Anciennes adresses** (`assets/js/admin/router.js`) :
  - une ancienne ancre de section (`#comptes`, `#cartes`, `#journal`…) est redirigée vers la sous-section de même nom,
    sinon vers la première qui monte cette section ; `#membres` seul ouvre Invitations ;
  - `#bataille` mène à `#cartes/arene` (Arène) ; `#fantomes` et `#membres/fantomes` mènent à `#membres/comptes` ;
  - `#reglages` mène à `#pilotage/identite` (formulaire « Identité et textes ») ;
  - les fiches membres `#comptes/<id>` sont redirigées vers `#membres/comptes/<id>`.
  - Un identifiant de sous-section déplacé est retrouvé dans n'importe quel domaine visible : l'adresse suit la sous-section.
- **Montage à la demande** : chaque sous-section est montée à sa première visite (`registerSub`).
- **Palette « Aller à… »** : Ctrl/Cmd+K ou bouton du rail. Elle filtre les sous-sections permises et les membres.
- **Temps réel** : un seul canal Supabase Realtime (`admin/live.js`), abonné aux tables publiées (migration 030) dont
  l'utilisateur a le droit (`TABLE_PERM`). Les changements sont regroupés (800 ms). Une section en cours de saisie affiche
  « Mises à jour disponibles — Actualiser » au lieu de se recharger. Le voyant « En direct » est dans le rail.
- **Mobile (375 px)** : domaine, puis liste des sous-sections, puis détail avec retour.

Sources : `assets/js/admin/perms.js` (sections, permissions, domaines) et `assets/js/admin/router.js` (URL).
Côté base : `hg_has_perm()` et le catalogue `hg_perm_catalog`.

### Domaines et sous-sections

Entre crochets : la permission requise (voir section 2). Les sous-sections sans crochet sont réservées à l'administrateur.

| Domaine | Sous-sections |
| --- | --- |
| **Pilotage** | Vue d'ensemble (visible si une des tuiles est permise : Comptes, Membres, Secret Santa, Boîte à idées, Assistance) · Planning (visible si l'une des permissions quiz, cartes, événements, sorties, Secret Santa ou bot est accordée) · Journal [journal] · Staff · **Bot** : Bot Discord [bot], Commandes slash [bot] · **Site** : Identité et mentions légales, Textes et intro, Menu et pied de page, État du site [reglages] ; Erreurs du site [reglages] ; Archives · Clés avancées [reglages] · **Apparence** : Thème [themes] · **Assistance** : Assistance [support], Boîte à idées [support], Messagerie [messages], Fil d'activité [reglages] |
| **Membres** | **Comptes** : Comptes [membres], Rôles [membres], À relancer [membres], Invitations [membres], Champs du profil [reglages], Vie sociale [reglages], Accueil des membres [reglages] · **Entraide** : Parrainage [membres], Compétences [membres] · **Accès aux pages** : Pages [membres], Matrice membres × pages [membres] · **Badges** : Catalogue, Attribution, Critères automatiques [badges] |
| **IRL** | Membres IRL [membres] · Sorties IRL [evenements] · Souvenirs et photos [souvenirs] · Secret Santa [secret_santa] |
| **Event** | Événements à thème [themes] · Calendrier et cinéma [evenements] · Calendrier de l'Avent, Saison des Worlds, Anniversaire du gang [themes] |
| **Le jeu de cartes** | Gestion globale [cartes] · **Catalogue** : Séries, Cartes, Boosters [cartes] · **Économie** : Paillettes et dons, Tirage, Recyclage et fabrication, Limites [cartes] · **Animation** : Quêtes, Défis du gang, Drops, Cagnotte et bulletin, Cartes Champions, Codes cadeaux, Atelier (recettes), Enchères [cartes] · **Suivi** : Joueurs, Échanges, Statistiques [cartes] · Arène [cartes] |
| **Autres jeux** | Questions du gang [quiz] · Sutom du gang [souvenirs] · GeoGuessr [souvenirs] · Citations « Qui a dit ça ? » [quiz] · Preuves de quêtes [preuves] · Framed et Heardle [souvenirs] · Arcade (pages 404) [reglages] · Secrets [reglages] · Mes jeux [mj] |

Les sous-sections d'un même groupe se suivent. Plusieurs sous-sections peuvent monter la même section (« parties » :
onglets des cartes, parties de l'Économie, des Réglages, des Badges, de l'Accès aux pages). Les identifiants de
sous-section sont uniques sur tout le panel.

## 2. Système Staff

L'administrateur (`hg_profiles.is_admin`) a tous les droits. Un membre Staff a une liste de permissions
(`hg_staff.perms`) et un drapeau actif. Dans les règles RLS et les fonctions d'administration, `hg_is_admin()` est
remplacé par `hg_has_perm('<clé>')` (migrations 026 et 027). `hg_is_staff()` (administrateur, ou Staff actif avec au moins
une permission) sert à la lecture des profils et de l'état du panel.

### Catalogue des 15 permissions

| Clé | Ce qu'elle ouvre dans le panel | Tables et stockage (`hg_perm_tables`) |
|---|---|---|
| `membres` | Membres › Comptes (comptes inscrits et fantômes ; liaison fantôme → compte), Rôles, À relancer, Invitations, Parrainage, Compétences, Accès aux pages, Membres IRL | `hg_profiles`, `hg_profile_info`, `hg_invites`, `hg_invite_links`, `hg_page_access` |
| `evenements` | IRL › Sorties IRL ; Event › Calendrier et cinéma | `hg_events`, `hg_event_dates`, `hg_event_rsvps`, `hg_event_date_votes` |
| `souvenirs` | IRL › Souvenirs et photos ; Autres jeux › Sutom, GeoGuessr, Framed et Heardle | `hg_moments`, `hg_photos`, `hg_reactions`, stockage `hg-photos` |
| `secret_santa` | IRL › Secret Santa (éditions, participants, exclusions, tirages, vœux) | `hg_ss_editions`, `hg_ss_participants`, `hg_ss_exclusions`, `hg_ss_wishes`, `hg_ss_assignments` |
| `cartes` | Le jeu de cartes (toutes les sous-sections, Gestion globale, Arène) | `hg_card_sets`, `hg_cards`, `hg_card_copies`, `hg_wallets`, `hg_wallet_log`, `hg_card_trades`, `hg_card_trade_items`, `hg_card_wishlist`, `hg_card_showcase`, `hg_challenges`, `hg_card_quests_templates` |
| `badges` | Membres › Badges | `hg_badges`, `hg_user_badges` |
| `themes` | Event (Événements à thème, Avent, Worlds, Anniversaire du gang), Pilotage › Thème | `hg_themes`, `hg_theme_seen`, `hg_dyn_events`, `hg_dyn_captures` |
| `messages` | Pilotage › Messagerie (lecture journalisée) | `hg_conversations`, `hg_conversation_members`, `hg_messages` |
| `support` | Pilotage › Assistance, Boîte à idées | `hg_support`, `hg_support_replies`, `hg_ideas` |
| `bot` | Pilotage › Bot Discord, Commandes slash | `hg_bot_log`, `hg_birthday_log` |
| `reglages` | Pilotage › Site (sauf Erreurs et Archives), Fil d'activité, Membres › Champs du profil, Vie sociale, Accueil des membres ; Autres jeux › Arcade et Secrets | `hg_settings` (clés générales), `hg_pages`, `hg_activity` |
| `journal` | Pilotage › Journal (actions admin) | `hg_admin_log` |
| `quiz` | Autres jeux › Questions du gang, Citations « Qui a dit ça ? » | — |
| `preuves` | Autres jeux › Preuves de quêtes | — |
| `mj` | Autres jeux › Mes jeux | — |

Pilotage › Staff et Pilotage › Archives (Site) ne sont pas des permissions : elles sont réservées à l'administrateur
(voir « Réservé à l'administrateur »).

### Réservé à l'administrateur

Ces droits ne se délèguent pas, même à un Staff qui a toutes les permissions :

- **Le drapeau `is_admin`** : promotion ou retrait. Le trigger `hg_profiles_guard` l'annule si l'auteur n'est pas administrateur.
  Procédure dans `supabase/ADMIN.md`.
- **Gestion du Staff** (Pilotage › Staff) : `hg_staff_list` et `hg_staff_set` exigent `is_admin` (écriture journalisée). La table `hg_staff`
  n'a pas de droit d'écriture direct.
- **Archives** (Pilotage › Site › Archives) : section réservée à l'administrateur.
- **Mode sans limite** : `hg_set_god_mode` et `hg_god_mode()` exigent `is_admin`.
- **Arène v2 ouverte aux membres** : l'option `arena.v2_public` ne se modifie que par l'administrateur (section 3, Arène).
- **Journal des lectures de messages** (`hg_admin_access_log`) : lecture réservée à l'administrateur. Une lecture de
  conversation (`hg_admin_read_conversation`, permission `messages`) y est toujours enregistrée.
- **E-mails des membres** : `hg_admin_accounts` ne renvoie l'adresse que si l'appelant est administrateur.
- **Clés de réglage sensibles** : les clés du propriétaire (suffixe `_owner`) et `admin_initial` n'ont aucune permission (`hg_settings_perm` renvoie `null`),
  seul l'administrateur peut les lire ou les écrire. `push_vapid_public` est public en lecture, en écriture réservée à l'administrateur.
- **Table `hg_private`** : RLS activée sans aucune règle. Elle n'est lisible que par les fonctions et triggers serveur.

## 3. Vue d'ensemble, rôles, vue membre, et sections particulières

### Vue d'ensemble (Pilotage › Vue d'ensemble, `#pilotage/apercu`)

En deux moitiés (migration 103) :

- **Gauche** : chiffres clés, **Mes raccourcis**, puis économie et activité récente.
- **Droite** : la file « À traiter » (demandes d'assistance, Secret Santa, économie, échanges, idées).

Chaque élément n'apparaît que si les droits de la personne le permettent ; chaque ligne mène à sa sous-section.
Source : `assets/js/admin/overview.js`.

**Mes raccourcis** : une grande tuile par sous-section choisie, avec le compteur « à traiter » s'il est supérieur à zéro.
Les raccourcis sont personnels : chaque membre du Staff ne voit que les siens (table `hg_admin_shortcuts`, politique de lecture sur `user_id = auth.uid()`).
- Lecture : RPC `hg_admin_shortcuts_get`. Si aucun choix n'a jamais été enregistré (`null`), les défauts s'appliquent
  (Assistance, Boîte à idées, Enchères, Secret Santa, Sorties IRL, Comptes), limités aux sous-sections permises.
- Écriture : RPC `hg_admin_shortcuts_set(p_items text[])`. Le dialogue « Modifier » ou « + Ajouter un raccourci »
  choisit les sous-sections, les range (monter, descendre) et enregistre. Maximum 24 raccourcis ; l'ordre est conservé.

### Rôles et accès par rôle (Membres › Comptes › Rôles, `#membres/roles`)

Source : `assets/js/admin-roles.js`, migration 103. Droit : `membres`.

- Un **rôle** (`hg_roles` : identifiant, libellé, description, couleur, pages « sur liste », ordre) pré-règle l'accès à des pages
  pour les membres qui le portent (`hg_member_roles`). Des rôles de départ sont créés par la migration (IRL, Secret Santa) ; ils se modifient dans le panel.
- Un rôle ne donne que des pages en mode « liste » (Membres › Accès aux pages).
- **Un réglage à la main** (`hg_page_access`) l'emporte toujours sur les rôles. Retirer un rôle retire seulement ce qu'il donnait.
- `hg_member_access` donne l'accès d'un membre à chaque page avec son origine : administrateur, réglage à la main, rôle,
  page ouverte à tous, ou aucun.
- Écritures par RPC qui vérifient les droits et journalisent dans `hg_admin_log` : `hg_role_save`, `hg_role_remove`, `hg_member_role_set`.
- Membres IRL (IRL › Membres IRL, droit `membres`) : liste des membres du rôle IRL.

### Voir le site comme un membre (`assets/js/core/view-as.js`)

- Depuis la fiche d'un membre (Membres › Comptes), le bouton « Voir le site comme… » ouvre le site dans l'onglet
  avec les menus et les pages de ce membre. La RPC `hg_admin_view_as` renvoie les pages que verrait ce membre (droit `membres`).
- La vue est gardée dans `sessionStorage` (clé `hg_view_as`, propre à l'onglet) et s'affiche avec un bandeau « Tu vois le site comme… ».
  Elle n'est gardée que si le profil connecté est administrateur. Sur le panel (`admin.html`), la clé est effacée.
- Dans cette vue, Admin, Staff et Sans limite sont masqués dans le menu en arc (`core/header.js`).
- Les données restent celles de l'administrateur : la base contrôle tout, ce module ne change que l'interface.

### Le jeu de cartes › Gestion globale (`#cartes/gestion`)

Source : `assets/js/admin-gestion.js`, section `cartes-gestion`, droit `cartes`. Trois blocs :
- **Give** : don groupé, avec la même confirmation et la même RPC que le tiroir d'Économie ;
- **Résumé de l'économie** : santé de l'économie (`hg_eco_health`), statistiques des types de boosters (`hg_booster_type_stats`), enchères (`hg_auctions_admin`), seulement ce que la base renvoie ;
- **Derniers gives**.

### Autres jeux › Arcade, pages 404 (`#jeux/arcade`)

Source : `assets/js/admin-arcade.js`, section `arcade`, droit `reglages`. Suit les trois mini-jeux des pages 404
(Paillettes, Raclette, Domu-mobile) semaine par semaine : parties jouées, Paillettes versées, règles anti-triche en lecture seule,
et classement des dix meilleurs scores. L'administrateur peut effacer le score d'un membre (migration 103, partie 4 ; droit `reglages`).

### Le jeu de cartes › Arène (`#cartes/arene`, ancien `#bataille`)

Source : `assets/js/admin-bataille.js`, section `bataille`, droit `cartes`. Deux blocs :
- **Arène actuelle** (membres) : activation, gains et plafonds de l'Arène de cartes (`hg_settings.cards`), inchangés.
- **Arène v2** (cotes, ligues, saisons) : ses chiffres se règlent ici (`hg_settings.arena`, bornés par le serveur).
  L'option « Ouvrir l'Arène v2 aux membres » (`arena.v2_public`) est réservée à l'administrateur.
  Tant qu'elle n'est pas ouverte, les membres voient l'Arène actuelle et seul l'administrateur voit l'aperçu v2 (bandeau « Aperçu admin »).
  Règles et chiffres détaillés : `docs/ARENE.md`. Page membre : `cartes.html#arene`.

### Anciennes adresses

Les adresses d'avant la réorganisation restent valables (voir section 1, « Anciennes adresses ») : elles sont redirigées
par `router.js` vers la nouvelle sous-section. Les liens partagés continuent donc de fonctionner.

## 4. Ajouter une permission

1. **Migration** (numéro libre suivant, idempotente, à ajouter au `README.md` des migrations) :
   - `insert into hg_perm_catalog (key, label, description, sort)` : clé en minuscules `^[a-z_]{2,32}$`.
   - `insert into hg_perm_tables (tbl, perm)` pour chaque table ou `storage:<bucket>` du domaine.
   - Remplacer `hg_is_admin()` par `hg_has_perm('<clé>')` dans les règles RLS et les fonctions d'administration concernées
     (même approche que la migration 027, qui ne touche pas aux règles déjà converties).
   - Si le domaine porte des clés de `hg_settings`, les ajouter à `hg_settings_perm` (migration 029).
   - Publier les tables temps réel utiles (`alter publication supabase_realtime add table …`).
2. **`assets/js/admin/perms.js`** : ajouter la section dans `SECTION_PERM` (section → clé), la sous-section dans `DOMAINS`
   (dans le domaine voulu, avec son groupe), et la section dans `TILE_SECTIONS` si elle doit figurer dans la vue d'ensemble.
3. **`assets/js/admin/live.js`** : ajouter la table dans `TABLE_PERM` si elle doit être rafraîchie en direct.
4. **`admin.html`** : ajouter `<section id="<section>" class="admin-section" aria-labelledby="h-<section>">` dans `#shell-parking`,
   avec son conteneur de racine (`<div id="…-root">`), sur le modèle des sections existantes.
5. **Module** : créer le fichier (`assets/js/admin-<nom>.js`, ou `assets/js/admin/<nom>.js`) et l'enregistrer dans
   `assets/js/admin.js` : `registerSub('<domaine>/<sous-section>', { main, open, list, info, group })`. Les données partagées
   passent par `once()` ou un `ensure…` de `admin/loaders.js`.
6. **Service worker** : les modules `assets/js/admin/*.js` et les fichiers `admin-*.js` sont listés dans `PRECACHE` de `sw.js`.
   Ajouter le nouveau fichier à cette liste, et incrémenter `CACHE_VERSION`.
7. **Tests** : vérifier les parcours de navigation (`parcours-admin-nav`, `parcours-admin-coquille`, `parcours-staff`), qui
   peuvent énumérer les sections, puis ajouter un parcours pour le nouveau domaine (voir section 6).

## 5. Ajouter une sous-section

- **Dans un domaine existant, avec une permission existante** : ajouter l'entrée dans `DOMAINS` (`perms.js`) et l'appel
  `registerSub` dans `admin.js`. Aucune migration si les tables sont déjà couvertes. Mettre à jour les parcours de navigation.
- **Avec une nouvelle section** : suivre les étapes 4 à 6 de la section 4, sans la migration si la permission existe déjà.
- **Déplacer ou renommer une sous-section** : garder l'ancienne adresse valable (`ALIAS_SUB` ou `MOVED` dans `admin/router.js`).

## 6. Tester

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
| `parcours-admin-roles.cjs` | Rôles et accès par rôle |
| `parcours-admin-arcade.cjs` | Arcade des pages 404 : classement, effacement d'un score |
| `parcours-admin-gestion.cjs` | Le jeu de cartes › Gestion globale |
| `parcours-connexion.cjs`, `parcours-session.cjs` | Connexion, session absente ou fermée |
| `parcours-sortie.cjs`, `parcours-booster.cjs` | Proposer une sortie ; ouvrir un booster |

Un test ne vérifie que ce que le faux client sait simuler (`tests/fixtures/`). Une RPC absente du faux renvoie `null` sans erreur.
