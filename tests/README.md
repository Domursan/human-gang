# Tests du site Humane Gang

Le site est statique : les tests le servent directement depuis le dépôt (pas de serveur à lancer) et
remplacent le client Supabase par un faux (`fixtures/`). Rien n'atteint la vraie base : toute requête vers
`*.supabase.co` est interceptée, et le test échoue si elle a été tentée.

## Installation

Sur une machine standard (une fois) :

```sh
npm install                       # installe Playwright 1.56.0 dans node_modules/
npx playwright install chromium   # télécharge le navigateur utilisé par les tests
```

Sur le poste de build, Playwright et Chromium sont installés hors du dépôt. Il faut alors indiquer leurs dossiers
avant de lancer un test :

```sh
export NODE_PATH=/home/claude/.npm-global/lib/node_modules   # où Node trouve le paquet « playwright »
export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers              # où sont les navigateurs Chromium de Playwright
```

- `NODE_PATH` : liste de dossiers où `require('playwright')` est cherché quand le dépôt n'a pas de `node_modules/`.
- `PLAYWRIGHT_BROWSERS_PATH` : dossier des navigateurs téléchargés par Playwright. Sans lui, Playwright cherche
  dans son dossier par défaut et ne trouve pas Chromium.

## Lancer les tests

Chaque test se lance seul, depuis la racine du dépôt. La commande est la même pour tous :

```sh
node tests/<nom-du-fichier>
```

Les raccourcis `npm` :

```sh
npm run check        # node tests/check-js.cjs
npm run test:rpc     # node tests/check-rpc.mjs
npm run test:smoke   # smoke.cjs puis smoke-admin.cjs
npm test             # toute la suite (tests/run-all.cjs) : vérifications, fumée, puis chaque parcours
```

Un test affiche une ligne `OK` ou `ECHEC` par contrôle, puis un bilan `N OK, M ECHEC(S)`. Il sort avec un code
non nul si un contrôle a échoué.

Variables utiles :

- `HG_ROOT=/chemin/du/checkout` : teste un autre dossier que celui du dépôt courant.
- `HG_PREFIX=/human-gang` : sert le site comme GitHub Pages (sous `/human-gang/`). Tout chemin absolu cassé répond 404.

Les sous-sections du panel admin se montent à leur première visite : un test qui interagit avec une sous-section
l'ouvre d'abord par sa route `domaine/sous-section` (`adminSection(page, 'membres/comptes')` dans `lib/harness.cjs`),
comme un clic dans la colonne de navigation.

## Tests et fonctions communes

| Fichier | Rôle |
|---|---|
| `lib/harness.cjs` | Outils communs : ouverture d'une page avec le faux client, interception du réseau, compteurs `check` / `finish`, ouverture d'une sous-section admin |
| `fixtures/fake-sb.mjs` | Faux client Supabase avec état (lecture, écriture, RPC simulées, connexion simulée) |
| `fixtures/fake-sb-cartes.mjs` | Même faux client, avec les données de la collection de cartes et des drops |
| `fixtures/fake-sb-reglages.mjs` | Même faux client, qui garde les réglages écrits entre deux pages (localStorage) |
| `fixtures/admin-ui-demo.html` | Page de démonstration des composants du panel admin (liste, fil, panneau d'infos) |

Un test ne peut vérifier que ce que le faux sait simuler. Une RPC absente du faux renvoie `null` sans erreur :
le site doit gérer ce cas, ce qui est testé pour `hg_open_booster_req`.

## Liste des tests

Colonne « npm » : où le test est lancé par `package.json`. « à la main » signifie qu'il n'est dans aucun script
et doit être lancé avec `node tests/<fichier>`.

| Test | Commande | npm | Ce qu'il vérifie |
|---|---|---|---|
| `check-js.cjs` | `node tests/check-js.cjs` | `npm run check` | Syntaxe de chaque fichier `.js`, `.mjs` et `.cjs` du dépôt (modules ES compris) |
| `check-rpc.mjs` | `node tests/check-rpc.mjs` | `npm run test:rpc` | Chaque table et fonction RPC appelée par le site existe dans le schéma ou les migrations 020+ |
| `smoke.cjs` | `node tests/smoke.cjs` | `test:smoke`, `test` | Chaque page publique à 1280 et 375 px : pas d'erreur JS, pas de 404, pas de défilement horizontal |
| `smoke-admin.cjs` | `node tests/smoke-admin.cjs` | `test:smoke`, `test` | Même contrôle pour `admin.html` |
| `composants-admin-ui.cjs` | `node tests/composants-admin-ui.cjs` | à la main | Composants du panel (liste, fil, panneau d'infos, en-tête de détail) sur la page de démonstration |
| `parcours-connexion.cjs` | `node tests/parcours-connexion.cjs` | `test` | Connexion depuis `compte.html` : mauvais identifiants, bons identifiants, page compte connectée |
| `parcours-sortie.cjs` | `node tests/parcours-sortie.cjs` | `test` | Proposer une sortie dans `irl.html` : données envoyées à `hg_events`, annonce `irl_new` |
| `parcours-session.cjs` | `node tests/parcours-session.cjs` | `test` | Session absente ou fermée : écrans visiteur, rafraîchissements, déconnexion, aucune RPC membre sans session |
| `parcours-staff.cjs` | `node tests/parcours-staff.cjs` | `test` | Staff : section Staff pour l'admin (ajout, permissions, désactivation), droits limités `cartes` + `journal` |
| `parcours-admin-sorties.cjs` | `node tests/parcours-admin-sorties.cjs` | `test` | Sorties IRL dans l'admin : liste, filtres, création, modification, inscrits, date, suppression avec confirmation |
| `parcours-admin-p2-sorties.cjs` | `node tests/parcours-admin-p2-sorties.cjs` | `test` | Vie du gang › Sorties IRL en liste + détail : puces, recherche, adresse `#vie/sorties/<id>`, panneau d'infos, mobile |
| `parcours-admin-souvenirs.cjs` | `node tests/parcours-admin-souvenirs.cjs` | `test` | Souvenirs et photos : créer, modifier, supprimer un souvenir, une photo, masquer une réaction |
| `parcours-admin-complements.cjs` | `node tests/parcours-admin-complements.cjs` | `test` | Quêtes, défis, réglages du site (JSON refusé, clé sensible), pages, suppression d'une édition Secret Santa |
| `parcours-admin-nav.cjs` | `node tests/parcours-admin-nav.cjs` | `test` | Sous-sections montées à la première visite, liens directs, palette Ctrl/Cmd+K, filtrage Staff, navigation mobile |
| `parcours-admin-direct.cjs` | `node tests/parcours-admin-direct.cjs` | `test` | Temps réel du panel : indicateur « En direct », compteurs et liste mis à jour, bandeau pendant la saisie |
| `parcours-admin-recherche.cjs` | `node tests/parcours-admin-recherche.cjs` | `test` | Recherche sans accents ni casse, « Afficher plus » par lots de 50, fiche membre (requêtes limitées), action en cours |
| `parcours-admin-coquille.cjs` | `node tests/parcours-admin-coquille.cjs` | `test` | Rail et colonne de navigation, routage et adresses directes, Staff limité, mobile 375 px |
| `parcours-admin-p2-pilotage.cjs` | `node tests/parcours-admin-p2-pilotage.cjs` | `test` | Pilotage : Staff (ajout, permissions, désactivation), Journal (filtres, détail avant / après), Vue d'ensemble, mobile |
| `parcours-admin-p2-assistance.cjs` | `node tests/parcours-admin-p2-assistance.cjs` | `test` | Communication › Assistance et Boîte à idées : liste, sélection par URL, statut écrit en base, recherche, mobile |
| `parcours-admin-p2-comptes.cjs` | `node tests/parcours-admin-p2-comptes.cjs` | `test` | Membres › Comptes en liste + détail : filtres, URL, résumé, Échap, Précédent |
| `parcours-admin-comptes-fantomes.cjs` | `node tests/parcours-admin-comptes-fantomes.cjs` | à la main | Comptes fantômes dans Membres › Comptes : fiche, liaison à un compte, fusion, codes d'invitation, création |
| `parcours-admin-assist-fil.cjs` | `node tests/parcours-admin-assist-fil.cjs` | `test` | Assistance en fil : prise en charge, réponse publique, note interne, résolution ; « Mes demandes » côté membre |
| `parcours-admin-polish-vie.cjs` | `node tests/parcours-admin-polish-vie.cjs` | `test` | Vie du gang : Secret Santa (éditions, tirage annulé puis confirmé), Événements, Badges, mobile |
| `parcours-admin-polish-cartes.cjs` | `node tests/parcours-admin-polish-cartes.cjs` | `test` | Jeu de cartes et Défis : séries, éditeur de carte, quêtes, joueurs (Paillettes, cartes), mobile |
| `parcours-admin-polish-site.cjs` | `node tests/parcours-admin-polish-site.cjs` | `test` | Invitations, Accès aux pages, Messagerie (lecture journalisée), Bot Discord, Réglages et Thème : tiroirs et écritures |
| `parcours-defi-modele.cjs` | `node tests/parcours-defi-modele.cjs` | `test` | Défis du gang : modèles prêts à l'emploi (pré-remplissage, rien créé avant « Créer », fin dans 7 ou 30 jours), refus d'une fin avant le début ; widget « Défi du gang » de l'accueil (jauge, masqué sans défi) |
| `parcours-admin-bot-mentions.cjs` | `node tests/parcours-admin-bot-mentions.cjs` | `test` | Bot Discord : mentions des annonces, ID de rôle, pièces jointes du message manuel (taille, doublon, retrait) |
| `parcours-admin-actifs.cjs` | `node tests/parcours-admin-actifs.cjs` | `test` | Un fantôme n'apparaît dans aucun choix hors gestion des comptes ; l'historique le garde |
| `parcours-admin-don-carte.cjs` | `node tests/parcours-admin-don-carte.cjs` | `test` | Donner une carte à un membre : notification `card_gift_admin`, échec de la RPC sans notification |
| `parcours-admin-don-groupe.cjs` | `node tests/parcours-admin-don-groupe.cjs` | à la main | Don groupé (destinataires, récapitulatif, RPC refusée, mobile) et bouton « booster offert » dans `cartes.html` |
| `parcours-cartes-zoom.cjs` | `node tests/parcours-cartes-zoom.cjs` | `test` | Collection : séries, loupe (souris, tactile), carte agrandie, défilement conservé, 390 px |
| `parcours-booster.cjs` | `node tests/parcours-booster.cjs` | `test` | Booster gratuit dans `cartes.html`, animation normale et « réduire les animations » |
| `parcours-booster-x5.cjs` | `node tests/parcours-booster-x5.cjs` | à la main | Ouvrir 5 boosters payants d'un coup : bouton désactivé sans solde, 5 appels à identifiants distincts |
| `parcours-cartes-offre.cjs` | `node tests/parcours-cartes-offre.cjs` | à la main | Proposer un échange : notification `trade_offer` avec l'identifiant de l'offre, pas de notification si la RPC échoue |
| `parcours-echanges-filtres.cjs` | `node tests/parcours-echanges-filtres.cjs` | à la main | Filtres indépendants et aperçu dans l'éditeur d'offre d'échange |
| `parcours-collection-autre.cjs` | `node tests/parcours-collection-autre.cjs` | à la main | Collection d'un autre membre, en lecture seule : filtres, repères « Tu ne l'as pas », compteur |
| `parcours-drops.cjs` | `node tests/parcours-drops.cjs` | `test` | Drops : lancer (admin), attraper la carte en vol (membre), stock limité, fin du drop |
| `parcours-aide.cjs` | `node tests/parcours-aide.cjs` | à la main | Aide et tutos : boutons « ? », recherche, adresse `aide.html#<slug>`, tutos réservés aux visiteurs |
| `parcours-eggs-404-lettres.cjs` | `node tests/parcours-eggs-404-lettres.cjs` | `test` | Secrets cachés : page 404 (adresse inconnue, jeu des paillettes à horloge factice, score envoyé, visiteur), les 7 lettres du pied de page (clic, clavier, survol) |
| `parcours-affiches.cjs` | `node tests/parcours-affiches.cjs` | `test` | Affiches A3 et tutos : prix, lot, critères des badges et quêtes lus sur les réglages ; repli si la lecture échoue |
| `parcours-intro-quotidienne.cjs` | `node tests/parcours-intro-quotidienne.cjs` | à la main | L'intro se rejoue une fois par jour |
| `parcours-ss-paires.cjs` | `node tests/parcours-ss-paires.cjs` | `test` | Secret Santa « qui a offert à qui » : affichage des paires selon l'état de l'édition |
| `parcours-ss-attributions.cjs` | `node tests/parcours-ss-attributions.cjs` | à la main | « Afficher les attributions » du Secret Santa, accessible sans passer par Comptes |
| `parcours-reglages-lot1.cjs` | `node tests/parcours-reglages-lot1.cjs` | à la main | Réglages : identité, textes, pages légales, menu, pied de page, intro ; effet visible sur le site |
| `parcours-reglages-lot2.cjs` | `node tests/parcours-reglages-lot2.cjs` | à la main | Réglages « Comptes et invitations » : règles, préfixe refusé, enregistrement, rétablissement |
| `parcours-reglages-lot3.cjs` | `node tests/parcours-reglages-lot3.cjs` | à la main | Réglages Secret Santa, sorties IRL et souvenirs : validation, enregistrement, rétablissement par champ |
| `parcours-reglages-lot4.cjs` | `node tests/parcours-reglages-lot4.cjs` | à la main | Réglages des cartes : économie, drops, quêtes, bornes lues par la page |
| `parcours-reglages-lot5.cjs` | `node tests/parcours-reglages-lot5.cjs` | à la main | Réglages Bot Discord, rappels, limites, planning d'anniversaires, assistance |

## Captures

Les captures sont écrites dans `tests/shots/` (ignoré par git). La CI les joint à l'exécution en cas d'échec.

## Ajouter un test de parcours

1. Copier un fichier `parcours-*.cjs` existant.
2. Ouvrir la page avec `openPage(browser, { page, fixture, scenario, width })`.
3. Vérifier avec `check(condition, message)` puis terminer par `finish()`.
4. Ajouter une ligne dans le tableau ci-dessus (`npm test` le lance automatiquement : tout fichier `tests/parcours-*.cjs` fait partie de la suite).
