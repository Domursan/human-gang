# Tests du site Humane Gang

Le site est statique : les tests le servent directement depuis le dépôt (pas de serveur à lancer) et
remplacent le client Supabase par un faux (`fixtures/`). Rien n'atteint la vraie base : toute requête vers
`*.supabase.co` est interceptée, et le test échoue si elle a été tentée.

## Lancer en local

```sh
npm install                  # une fois (Playwright 1.56.0)
npx playwright install chromium
npm run check                # syntaxe de tous les fichiers JavaScript
npm run test:rpc             # chaque RPC et table appelée existe dans le schéma ou les migrations 020+
npm test                     # tests de fumée puis tests de parcours
```

Les sous-sections du panel admin se montent à leur première visite : un test qui interagit avec une sous-section l'ouvre d'abord
par sa route `domaine/sous-section` (`adminSection(page, 'membres/comptes')` de `lib/harness.cjs`), comme un clic dans la colonne de navigation.

Pour tester un autre dossier que celui-ci : `HG_ROOT=/chemin/du/checkout npm test`.

Pour servir le site comme en ligne, sous `/human-gang/` (tout chemin absolu cassé répond alors 404) : `HG_PREFIX=/human-gang npm test`.

## Ce que contiennent les tests

| Fichier | Contenu |
|---|---|
| `check-js.cjs` | `node --check` sur chaque `.js`, `.mjs`, `.cjs` (les modules ES sont vérifiés comme tels) |
| `check-rpc.mjs` | Liste les `.rpc('…')` et `.from('…')` du JS, des pages HTML et des fonctions edge, puis vérifie qu'ils existent dans `supabase/schema/schema_reel_2026-10-21.sql` ou dans les migrations 020+. Les exceptions, commentées, sont dans `EXCEPTIONS` |
| `smoke.cjs` | Chaque page publique à 1280 px et 375 px : pas d'erreur JS, pas de 404, pas de défilement horizontal |
| `smoke-admin.cjs` | Même contrôle pour `admin.html` |
| `parcours-connexion.cjs` | Connexion depuis `compte.html` : identifiants faux, bons identifiants, page compte connectée |
| `parcours-sortie.cjs` | Proposer une sortie dans `irl.html` : données envoyées à `hg_events`, annonce `irl_new` |
| `parcours-session.cjs` | Session absente ou fermée : visiteur sur l'accueil, compte et membre ; rafraîchissements après déconnexion ; déconnexion depuis l'en-tête. Aucune RPC réservée aux membres ne doit partir sans session (le faux répond 401 et le journalise) |
| `parcours-staff.cjs` | Panel admin et Staff : administrateur (section Staff, ajout avec permissions, désactivation avec confirmation) ; Staff `cartes`+`journal` (sections visibles, aucune requête hors droits) ; membre simple redirigé |
| `parcours-admin-sorties.cjs` | Administration, section « Sorties IRL » : liste et filtres, création, modification, ajout et retrait d'un inscrit, date retenue, suppression avec confirmation (données envoyées au faux client) |
| `parcours-admin-p2-sorties.cjs` | Administration, Vie du gang › Sorties IRL en liste + détail : puces À venir / Passées / Toutes, recherche, adresse #vie/sorties/<id> suivie et Précédent, panneau d'infos (≥ 1440 px), mobile : liste plein écran puis détail avec retour. |
| `parcours-cartes-zoom.cjs` | Collection des cartes : « Toutes les séries » (intertitres, compteurs, filtres), loupe sur chaque carte, carte agrandie (précédent / suivant, flèches, Échap, fond), loupe ×2,5 à la souris et appui long tactile, défilement conservé après une action (filtre, fiche, souhait, classement pendant le chargement), 390 px sans défilement horizontal |
| `parcours-booster.cjs` | Ouvrir le booster gratuit dans `cartes.html`, animation normale et « réduire les animations » |
| `parcours-admin-complements.cjs` | Panel admin : quêtes de la semaine (créer, modifier, activer), défis (modifier, supprimer), réglages du site (ajouter, modifier, JSON refusé, clé sensible avec confirmation), pages (créer, modifier, supprimer), suppression d'une édition Secret Santa |
| `parcours-admin-nav.cjs` | Panel admin : sous-sections montées à la première visite (rien de Cartes, Bot ou Messagerie au chargement), liens directs `#membres/comptes/<id>/<onglet>` (et l'ancienne `#comptes/<id>/<onglet>`) et `#cartes/quetes`, adresse mise à jour par les clics et Précédent, palette « Aller à… » (Ctrl/Cmd+K, sous-sections et fiches, focus piégé), palette limitée aux droits Staff, navigation par domaines à 375 px |
| `parcours-admin-recherche.cjs` | Panel admin : recherche (Boîte à idées, Journal, Cartes et séries, insensible aux accents et à la casse), « Afficher plus » (Journal, Cartes par lots de 50), fiche membre (au plus 4 requêtes pour l'onglet initial, onglets chargés à la demande, cache de la visite), état d'une action en cours |
| `parcours-admin-coquille.cjs` | Coquille du panel : rail et colonne de navigation, navigation par domaine et sous-section, URL directe `#membres/comptes`, ancienne ancre `#cartes` redirigée, précédent/suivant, Staff `cartes`+`journal` (Pilotage et Jeu de cartes seulement), mobile 375 px avec barre d’onglets et sans défilement horizontal |
| `parcours-admin-p2-pilotage.cjs` | Pilotage du panel : Staff (ajout, permissions, barre d’enregistrement, désactivation / réactivation, infos), Journal (puces, recherche, détail avant / après, consultations), Vue d’ensemble (tuiles, « À traiter », activité), Staff `journal` seul, mobile 390 px liste puis détail |
| `parcours-admin-p2-assistance.cjs` | Communication › Assistance et Boîte à idées : liste en colonne 2 avec filtres et compteurs, sélection par URL, en-tête (statut, « Résoudre »), fil en lecture seule, panneau d’infos (fiche rapide, historique, fiche membre), statut écrit en base, recherche, mobile 390 px (liste puis détail avec retour) |
| `parcours-admin-polish-vie.cjs` | Panel admin, Vie du gang : Secret Santa (éditions en colonne 2, détail par adresse, tiroirs de création, modification, exclusion, tirage annulé puis confirmé, suppression), Événements (liste et filtres, tiroir avec validation du nom, modification, suppression), Badges (grille avec détenteurs, tiroirs de création et de modification, attribution), mobile 390 px sans défilement horizontal |
| `parcours-admin-polish-cartes.cjs` | Jeu de cartes et Défis du gang : séries en grille (interrupteur Active / Masquée, Modifier, création et annulation dans le tiroir), éditeur de carte en tiroir large, quêtes et défis en tiroir, joueurs en liste + détail (adresse `#cartes/joueurs/<id>`, Paillettes et cartes données ou retirées), aucune erreur console, mobile 390 px (tiroir pleine largeur, sans défilement horizontal) |
| `parcours-admin-actifs.cjs` | Panel admin hors gestion des comptes : un fantôme (faux Supabase) n'apparaît ni dans Jeu de cartes › Joueurs, ni dans les choix (palette Ctrl/Cmd+K, membre lié d'une carte, ajout de présence aux sorties, auteur et filtre des souvenirs, exclusions Secret Santa) ; l'historique garde le fantôme (présence déjà enregistrée, carte déjà liée), aucune erreur console |

## Fixtures

- `fixtures/fake-sb.mjs` : faux client Supabase avec état (lecture, écriture, RPC simulées, connexion simulée).
- `fixtures/fake-sb-cartes.mjs` : même chose, avec les données de la collection de cartes.
- `lib/harness.cjs` : ouverture des pages, interception du réseau, compteurs de résultats.

Un test ne peut vérifier que ce que le faux sait simuler. Une RPC absente du faux renvoie `null` sans erreur :
le site doit gérer ce cas, ce qui est testé pour `hg_open_booster_req`.

## Captures

Les captures sont écrites dans `tests/shots/` (ignoré par git). La CI les joint à l'exécution en cas d'échec.

## Ajouter un test de parcours

1. Copier un fichier `parcours-*.cjs` existant.
2. Ouvrir la page avec `openPage(browser, { page, fixture, scenario, width })`.
3. Vérifier avec `check(condition, message)` puis terminer par `finish()`.
