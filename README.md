# Humane Gang

Le site du Humane Gang : le QG du groupe pour le Secret Santa, les sorties IRL, les souvenirs, la messagerie et le jeu de cartes à collectionner.

- **En ligne** : https://humane-gang.com/
- **Auteur et administrateur** : Domursan
- **Plan complet du site** : [docs/PLAN-DU-SITE.md](docs/PLAN-DU-SITE.md)

---

## Ce que fait le site

| Espace | Pour qui | En bref |
| --- | --- | --- |
| Accueil | Membres | Fil d'activité, défis du gang, quêtes de la semaine, anniversaires |
| Secret Santa | Membres | Inscription, tirage, carte de la cible, liste de souhaits, messages secrets |
| Sorties IRL | Membres | Propositions de sorties, sondage de date, réponses, rappels |
| Historique | Membres | Frise des rencontres passées, albums photo, moments cultes |
| Messages | Membres | Messagerie privée entre membres (et avec son Santa, anonymement) |
| Cartes | Membres | Boosters, collection, échanges, fabrication, drops, classement |
| Événements | Membres | Images à attraper qui traversent le site pendant un événement |
| Compte | Membres | Profil, infos personnelles, notifications, badges |
| Aide et tutos | Tous | 61 tutos illustrés, accès à l'assistance |
| Administration | Admin et Staff | Gestion complète du site, sans toucher au code |

Un bot Discord prévient les membres (MP et annonces) : tirage, sorties, anniversaires, échanges, belles cartes, etc.

---

## Comment c'est construit

- **Front-end** : HTML, CSS et JavaScript « vanilla » (modules ES), **sans étape de build**. Chaque page HTML charge son script `assets/js/<page>.js`.
- **Hébergement** : GitHub Pages, branche `main`. Un `git push` sur `main` met le site en ligne en une à deux minutes.
- **Back-end** : Supabase (base Postgres, authentification, stockage de fichiers, temps réel).
  - Les règles d'accès sont dans la base (RLS) : le navigateur n'a que la clé publique.
  - Les règles métier sensibles (tirage, ouverture de boosters, échanges, badges…) sont des fonctions SQL `hg_*`.
- **Fonctions edge** (Deno, sur Supabase) : le bot Discord et les tâches programmées (`supabase/functions/`).
- **Tâches programmées** (pg_cron) : badges, récompenses de présence du jeu de cartes et défis du gang (toutes les heures), anniversaires (8 h, heure suisse), tâches de fond toutes les 5 minutes.
- **Application installable** : `manifest.webmanifest` et le service worker `sw.js` (cache hors ligne, notifications push).

---

## Arborescence

```
.
├── *.html                  Une page = un fichier (accueil.html, cartes.html, admin.html…)
├── assets/
│   ├── css/                base.css (styles communs) + un fichier par page ou composant
│   ├── js/
│   │   ├── core/           Socle commun : session, en-tête, pied de page, thème, utilitaires
│   │   ├── core.js         Point d'entrée du socle (ré-exporte core/)
│   │   ├── <page>.js       Script de chaque page
│   │   ├── admin/          Coquille du panel d'administration (navigation, permissions, temps réel)
│   │   ├── admin-*/        Sections du panel (comptes, cartes, réglages, sorties, souvenirs)
│   │   └── tutos/          Contenu des tutos de la page d'aide
│   └── img/                Logo, icônes
├── affiches/               Affiches A3 imprimables (badges, Paillettes, cartes, boosters)
├── supabase/
│   ├── migrations/         Historique du schéma de la base (numérotées, appliquées dans l'ordre)
│   ├── functions/          Fonctions edge (bot Discord, tâches programmées) + _shared/
│   └── ADMIN.md            Retrouver l'accès administrateur
├── docs/ADMIN-PANEL.md     Organisation du panel et des permissions Staff
├── tests/                  Tests automatiques (Playwright) et faux Supabase
├── sw.js                   Service worker (cache et notifications)
└── manifest.webmanifest    Application installable
```

---

## Travailler sur le site

### Voir le site en local
Le site est statique : n'importe quel petit serveur suffit, depuis la racine du dépôt.
```
npx serve .          # ou : python3 -m http.server 8000
```
Puis ouvrir http://localhost:3000 (ou :8000). Le site se connecte à la vraie base Supabase.

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

### Mettre en ligne une nouvelle version
1. Si des fichiers JS ou CSS ont changé, **augmenter `CACHE_VERSION`** dans `sw.js` (ex. `v36` → `v37`). Sans ça, les membres gardent l'ancienne version en cache.
2. Lancer les tests (voir plus bas).
3. Pousser sur `main`.

### Modifier la base de données
- Créer un nouveau fichier dans `supabase/migrations/` avec le numéro suivant (ex. `055_mon_changement.sql`).
- L'appliquer sur Supabase (éditeur SQL ou CLI), puis le committer.
- Ne jamais modifier une migration déjà appliquée : en écrire une nouvelle.

### Déployer une fonction edge (bot)
Voir `supabase/functions/DEPLOY.md` : chaque fonction doit être envoyée **avec** les fichiers de `_shared/` qu'elle importe.

---

## Tests

Les tests utilisent Playwright et un faux Supabase (aucune donnée réelle n'est touchée).
```
npm install
npm run check        # vérification syntaxique de tous les JS
npm run test:smoke   # toutes les pages s'ouvrent sans erreur
npm test             # suite complète des parcours
```
Le détail de chaque test est dans `tests/README.md`.

---

## Administration

Tout se règle depuis **Administration** (`admin.html`), sans toucher au code :
- **Pilotage** : vue d'ensemble, journal des actions, Staff et permissions.
- **Membres** : comptes (actifs, Staff, fantômes), invitations, accès aux pages.
- **Vie du gang** : sorties, souvenirs, Secret Santa, événements, badges.
- **Jeu de cartes** : séries, cartes, quêtes, économie, joueurs, échanges, drops, défis.
- **Communication** : assistance, boîte à idées, messagerie, bot Discord.
- **Site** : réglages (identité, textes, navigation, planning…) et thèmes.

L'administrateur peut déléguer des parties du panel à des membres Staff (12 permissions). Détails dans `docs/ADMIN-PANEL.md`.

---

## Sécurité et vie privée

- Aucune clé secrète dans le dépôt : seules l'URL et la clé publique Supabase sont dans `assets/js/config.js`.
- Les secrets (jeton du bot Discord, secret des tâches programmées) sont stockés côté Supabase uniquement.
- Les données personnelles sont protégées par les règles d'accès de la base ; chaque membre peut exporter ou supprimer ses données depuis son compte.
- Mentions légales, confidentialité et cookies : `legal.html`.

---

© Domursan — Humane Gang. Tous droits réservés.
