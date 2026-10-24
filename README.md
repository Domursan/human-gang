# Humane Gang

Le site du Humane Gang : le QG du groupe pour le Secret Santa, les sorties IRL, les souvenirs, la messagerie, le jeu de cartes à collectionner (avec son Arène) et les jeux du gang.

- **En ligne** : https://humane-gang.com/
- **Auteur et administrateur** : Domursan
- **Plan du site** : [docs/PLAN-DU-SITE.md](docs/PLAN-DU-SITE.md)

---

## Ce que fait le site

| Espace | Pour qui | En bref |
| --- | --- | --- |
| Accueil | Membres | Fil d'activité, défis du gang, quêtes de la semaine, question du jour |
| Secret Santa | Membres | Inscription, tirage, carte de la cible, liste de souhaits, messages secrets |
| Sorties IRL | Membres | Propositions de sorties, sondages de date, réponses, carte des lieux |
| Historique | Membres | Frise des rencontres passées, éditions du Secret Santa, albums photo |
| Messages | Membres | Messagerie privée entre membres (et avec son Santa, anonymement) |
| Jeu de cartes | Membres | Boosters, collection, échanges, fabrication, drops, classement, Arène |
| Jeux | Membres | Missions du jour, GeoGuessr, « Qui a dit ça ? », question du jour, Sutom, Framed, Heardle, Arcade |
| Événements | Membres | Images à attraper qui traversent le site pendant un événement |
| Calendrier et ciné | Membres | Calendrier du gang, séances du ciné-club, playlist |
| Compte | Membres | Profil, infos personnelles, notifications, badges, export et suppression des données |
| Aide et tutos | Tous | Tutos illustrés, accès à l'assistance |
| Administration | Admin et Staff | Gestion complète du site, sans toucher au code |

Un bot Discord prévient les membres (MP et annonces) : tirage, sorties, anniversaires, échanges, belles cartes, etc.

---

## Comment c'est construit

- **Front-end** : HTML, CSS et JavaScript « vanilla » (modules ES), **sans étape de build**. Chaque page HTML charge son script `assets/js/<page>.js`.
- **Hébergement** : GitHub Pages, branche `main`.
- **Back-end** : Supabase (base Postgres, authentification, stockage de fichiers, temps réel).
  - Les règles d'accès sont dans la base (RLS) : le navigateur n'a que la clé publique.
  - Les règles métier sensibles (tirage, ouverture de boosters, échanges, badges, Arène…) sont des fonctions SQL `hg_*`.
- **Fonctions edge** (Deno, sur Supabase) : le bot Discord et les tâches programmées (`supabase/functions/`).
- **Tâches programmées** (pg_cron) : badges, récompenses de présence du jeu de cartes et défis du gang (toutes les heures), anniversaires (8 h, heure suisse), rappels et tâches de fond toutes les 5 minutes.
- **Application installable** : `manifest.webmanifest` et le service worker `sw.js` (cache hors ligne, notifications push).

---

## Menus et pages

### Barre de menus

| Menu | Contenu (fichier) |
| --- | --- |
| Le jeu de cartes | `cartes.html` : Ouverture, Inventaire, Boutique, Mes cartes, Classement, Échanges, Arène |
| IRL | `secret-santa.html`, `irl.html`, `historique.html` |
| Jeux | `jeux.html` : Les missions du jour, GeoGuessr, Qui a dit ça ?, Question du jour, Sutom HG, Framed, Heardle, puis Arcade (Paillettes, Raclette, Domu-mobile) |
| Calendrier | `calendrier.html` |
| Autres | Les pages du menu qui ne sont rangées nulle part ailleurs (liste venant de la base) |

Un lien n'apparaît que si le membre a accès à la page, et un menu vide disparaît. Les libellés se règlent dans Administration › Site › Menu et pied de page ; les pages accessibles dans Administration › Membres › Accès aux pages.

### Menu en arc (photo de profil)

Un clic sur la photo ouvre un quart de cercle d'icônes :
- rangée proche : Messages (`messages.html`), Recherche (Ctrl ou Cmd + K), Mon compte (`compte.html`) ;
- rangée extérieure : Aide et tutos (`aide.html`), Affichage (préférences), Sans limite (administrateur seul), Admin ou Staff (`admin.html`), Déconnexion.

### Pages principales

| Page | Rôle |
| --- | --- |
| `index.html` | Intro animée au défilement, une fois par jour, puis redirection vers l'accueil |
| `rejoindre.html` | Ouverture d'un lien d'invitation |
| `compte.html` | Connexion, inscription, profil, notifications, export et suppression des données |
| `accueil.html` | Accueil des membres |
| `secret-santa.html` | Secret Santa de l'édition en cours |
| `irl.html` | Sorties IRL : prochaine sortie, dates à caler, sorties passées, carte des lieux |
| `historique.html` | Frise des années, éditions passées du Secret Santa, albums photo |
| `recap.html` | Récap de l'année, du membre et du gang |
| `messages.html` | Conversations privées |
| `cartes.html` | Jeu de cartes : boosters, collection, classement, échanges, Arène, drops |
| `jeux.html` | Les jeux du gang, un onglet par jeu (`jeux.html#<jeu>`) |
| `calendrier.html` | Calendrier du gang |
| `cine.html` | Ciné-club : vote de la séance du dimanche |
| `citations.html` | Mur des citations |
| `playlist.html` | Playlist du gang |
| `quiz.html` | Questions du gang |
| `evenements.html` | Événements à thème (images à attraper) et classement des chasseurs |
| `membre.html` | Carte de membre d'un joueur |
| `collection-a4.html` | Planche imprimable d'une collection (paramètres dans l'adresse) |
| `secret.html` | Le carnet des secrets (page cachée, hors menu) |
| `aide.html` | Aide et tutos |
| `assistance.html` | Formulaire d'aide (bug, question, idée) et suivi des demandes |
| `legal.html` | Mentions légales, confidentialité, cookies |
| `admin.html` | Administration (voir plus bas) |
| `offline.html`, `404.html` | Page hors connexion, page introuvable |
| `simulateur.html` | Simulateur de téléphone, outil de développement (non publié) |
| `affiches/` | Affiches A3 imprimables : badges, Paillettes, cartes, boosters |

---

## Administration

Tout se règle depuis **Administration** (`admin.html`), sans toucher au code. L'adresse d'une section est `admin.html#domaine/sous-section`.

### Vue d'ensemble et « Mes raccourcis »

La vue d'ensemble (Pilotage › Vue d'ensemble) affiche les chiffres clés, les éléments à traiter, l'activité récente et, à gauche, **Mes raccourcis** : une grande tuile par sous-section. Les raccourcis sont propres à chaque personne ; « Modifier » ou « + Ajouter » permet de les choisir et de les ranger (24 au plus). Sans choix enregistré, des raccourcis par défaut sont proposés (six au plus). Chaque élément n'apparaît que si les droits de la personne le permettent.

### Les six domaines

| Domaine | Sous-sections principales |
| --- | --- |
| **Pilotage** | Vue d'ensemble, Planning, Journal, Staff (administrateur), Bot Discord et commandes slash, Site (identité, textes, menu, état du site, erreurs, archives, clés avancées), Thème, Assistance, Boîte à idées, Messagerie, Fil d'activité |
| **Membres** | Comptes (comptes, rôles, à relancer, invitations, champs du profil, vie sociale, accueil), Entraide (parrainage, compétences), Accès aux pages (pages, matrice membres × pages), Badges (catalogue, attribution, critères automatiques) |
| **IRL** | Membres IRL, Sorties IRL, Souvenirs et photos, Secret Santa |
| **Event** | Événements à thème, Calendrier et cinéma, Calendrier de l'Avent, Saison des Worlds, Anniversaire du gang |
| **Le jeu de cartes** | Gestion globale, Catalogue (séries, cartes, boosters), Économie (Paillettes et dons, tirage, recyclage et fabrication, limites), Animation (quêtes, défis du gang, drops, cagnotte, cartes Champions, codes cadeaux, atelier, enchères), Suivi (joueurs, échanges, statistiques), Arène |
| **Autres jeux** | Questions du gang, Sutom du gang, GeoGuessr, citations « Qui a dit ça ? », preuves de quêtes, Framed et Heardle, Arcade (pages 404), Secrets, Mes jeux |

Une sous-section sans droit n'est ni affichée ni ouverte. Une touche Ctrl/Cmd + K ouvre la palette « Aller à… ». Les données se mettent à jour en direct, sauf pendant une saisie (un bandeau « Actualiser » apparaît).

### Rôles et droits

- **Administrateur** : tous les droits. Réservé à l'administrateur, non délégable : promotion d'un administrateur, gestion du Staff, mode sans limite, journal des lectures de messages, adresses e-mail.
- **Staff** : une liste de permissions parmi les 12 du catalogue (`membres`, `evenements`, `souvenirs`, `secret_santa`, `cartes`, `badges`, `themes`, `messages`, `support`, `bot`, `reglages`, `journal`). Détail dans `docs/ADMIN-PANEL.md`.
- **Rôles** (Membres › Comptes › Rôles) : un rôle prérègle l'accès à des pages pour les membres qui le portent. Un réglage fait à la main sur une page l'emporte toujours sur le rôle.

### Voir le site comme un membre

Depuis la fiche d'un membre (Membres › Comptes), **Voir le site comme…** ouvre le site avec les menus et les pages de ce membre, sous un bandeau « Revenir au panel ». Admin, Staff et mode sans limite sont masqués dans cette vue. Les données affichées restent celles de l'administrateur.

### Arène v2 (aperçu admin)

Jeu de cartes › **Arène** (`cartes.html#arene` pour le site, `admin.html#cartes/arene` pour le panel) contient deux blocs :
- l'**Arène actuelle**, ouverte aux membres, avec ses gains et plafonds ;
- l'**Arène v2**, visible des seuls administrateurs : réglages, aperçu du classement, saisons passées, clôture de saison. Elle ne s'ouvre aux membres que si le réglage `arena.v2_public` est activé. Règles et chiffres : `docs/ARENE.md`.

---

## Arborescence

```
.
├── *.html                  Une page = un fichier (accueil.html, cartes.html, admin.html…)
├── 404.html, offline.html  Pages d'erreur et hors connexion
├── sw.js                   Service worker (cache hors ligne, notifications push)
├── manifest.webmanifest    Application installable
├── _config.yml             Choix des fichiers publiés par GitHub Pages (voir docs/PUBLICATION.md)
├── CNAME                   Nom de domaine (humane-gang.com)
├── package.json            Scripts de vérification et de test
├── affiches/               Affiches A3 imprimables (badges, Paillettes, cartes, boosters)
├── assets/
│   ├── css/                base.css (styles communs) + un fichier par page ou composant
│   ├── js/
│   │   ├── core/           Socle commun : session, en-tête, pied de page, thème, utilitaires
│   │   ├── core.js         Point d'entrée du socle (ré-exporte core/)
│   │   ├── <page>.js       Script de chaque page
│   │   ├── admin/          Coquille du panel (navigation, permissions, temps réel)
│   │   ├── admin-*.js, admin-*/   Sections du panel (comptes, cartes, réglages, sorties, souvenirs…)
│   │   ├── eggs/, tutos/   Easter eggs et contenu des tutos de la page d'aide
│   │   └── config.js       URL et clé publique Supabase
│   ├── cards/              Images des cartes, par série (chemins relatifs « assets/cards/… » enregistrés en base)
│   └── img/                Logo, icônes
├── supabase/
│   ├── migrations/         Historique du schéma (numérotées, appliquées dans l'ordre)
│   ├── schema/             Schéma reconstitué de la base (source de vérité)
│   ├── seed/               Données initiales (dictionnaire du Sutom)
│   ├── functions/          Fonctions edge (bot Discord, tâches programmées) + _shared/
│   └── ADMIN.md            Administrateur de secours
├── docs/                   Documentation (voir la liste plus bas) et captures de recette (docs/captures/qa)
├── tests/                  Tests automatiques (Playwright) et faux Supabase
└── .github/workflows/      Intégration continue (vérifications et tests)
```

Les pages HTML restent à la racine parce que les images des cartes sont enregistrées en base avec des chemins relatifs (`assets/cards/…`), et que les adresses publiques des pages (`humane-gang.com/cartes.html`, etc.) ne doivent pas changer.

---

## Travailler sur le site

### Voir le site en local
Le site est statique : n'importe quel petit serveur suffit, depuis la racine du dépôt.
```
npx serve .          # ou : python3 -m http.server 8000
```
Puis ouvrir l'adresse indiquée (par exemple http://localhost:3000 ou :8000). Le site se connecte à la vraie base Supabase.

### Ajouter ou modifier une page
1. Copier une page existante (par exemple `historique.html`) et changer le titre et le script chargé.
2. Le script commence toujours par :
   ```js
   import { sb, initPage } from './core.js';
   const me = await initPage({ auth: 'member' }); // 'member', 'admin' ou 'optional'
   ```
   L'en-tête, le pied de page, le thème et la vérification de connexion sont alors automatiques.
3. Toujours passer les textes venant de la base par `esc()` avant de les insérer dans le HTML.
4. Ajouter les nouveaux fichiers JS et CSS à la liste `PRECACHE` de `sw.js`.
5. Un menu ou un lien de page se règle ensuite dans le panel (Menu et pied de page, Accès aux pages).

### Mettre en ligne une nouvelle version
1. Si un fichier précaché (JS ou CSS) a changé, ou si la liste `PRECACHE` ou la logique de `sw.js` a changé, **augmenter `CACHE_VERSION`** dans `sw.js` (ex. `v62` → `v63`). Sans ça, les membres gardent l'ancienne version en cache.
2. Lancer les vérifications et les tests (voir plus bas).
3. Pousser sur `main`. GitHub Pages publie le site en une à deux minutes. Ce qui est publié et ce qui ne l'est pas : [docs/PUBLICATION.md](docs/PUBLICATION.md).

### Modifier la base de données
- Le **numéro le plus haut** actuellement présent est `105_securite.sql`. Une nouvelle migration prend le numéro suivant (ex. `106_mon_changement.sql`), dans `supabase/migrations/`.
- Quelles migrations sont appliquées en production, et les trous de numérotation : [supabase/migrations/README.md](supabase/migrations/README.md). Le schéma réel de référence : `supabase/schema/`.
- L'appliquer sur Supabase (éditeur SQL ou CLI), puis le committer.
- Ne jamais modifier une migration déjà appliquée : en écrire une nouvelle.

### Fonctions edge et bot Discord
- Déployer une fonction edge : [supabase/functions/DEPLOY.md](supabase/functions/DEPLOY.md). Chaque fonction doit être envoyée **avec** les fichiers de `_shared/` qu'elle importe.
- Créer ou régler le bot : [docs/BOT.md](docs/BOT.md).

---

## Tests

Les tests utilisent Playwright et un faux Supabase : aucune donnée réelle n'est touchée.
```
npm install
npm run check        # vérification syntaxique des JS et des règles de publication
npm run test:rpc     # chaque fonction et table appelée existe dans le schéma ou les migrations
npm run test:smoke   # toutes les pages s'ouvrent sans erreur
npm test             # suite complète des parcours
```
Un seul parcours se lance avec `node tests/<nom-du-fichier>` (par exemple `node tests/parcours-admin-nav.cjs`). Le détail de chaque test est dans [tests/README.md](tests/README.md). La première fois, Chromium s'installe avec `npx playwright install chromium`.

---

## Documentation

| Document | Contenu |
| --- | --- |
| [docs/PLAN-DU-SITE.md](docs/PLAN-DU-SITE.md) | Plan du site : pages, accès, tâches de fond |
| [docs/ADMIN-PANEL.md](docs/ADMIN-PANEL.md) | Organisation du panel, permissions Staff, ajouter une permission ou une sous-section |
| [docs/ARENE.md](docs/ARENE.md) | Règles et chiffres de l'Arène v2 |
| [docs/SECURITE.md](docs/SECURITE.md) | Audit de sécurité (constats, migration 105, décisions à prendre) |
| [docs/PUBLICATION.md](docs/PUBLICATION.md) | Publication GitHub Pages et fichiers non publiés |
| [docs/BOT.md](docs/BOT.md) | Installation et fonctionnement du bot Discord |
| [docs/SPEC.md](docs/SPEC.md) | Spécification de construction des pages (pour les agents) |
| [supabase/ADMIN.md](supabase/ADMIN.md) | Retrouver l'accès administrateur |
| [supabase/migrations/README.md](supabase/migrations/README.md) | Historique des migrations et leur état |
| [supabase/functions/DEPLOY.md](supabase/functions/DEPLOY.md) | Déploiement des fonctions edge |
| [tests/README.md](tests/README.md) | Tests et leur lancement |

---

## Sécurité et vie privée

- Aucune clé secrète dans le dépôt : seules l'URL et la clé publique Supabase sont dans `assets/js/config.js`.
- Les secrets (jeton du bot Discord, secret des tâches programmées) sont stockés côté Supabase uniquement.
- Les données personnelles sont protégées par les règles d'accès de la base ; chaque membre peut exporter ou supprimer ses données depuis son compte.
- Mentions légales, confidentialité et cookies : `legal.html`. Audit de sécurité : `docs/SECURITE.md`.

---

© Domursan — Humane Gang. Tous droits réservés.
