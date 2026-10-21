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
| `parcours-booster.cjs` | Ouvrir le booster gratuit dans `cartes.html`, animation normale et « réduire les animations » |
| `parcours-admin-complements.cjs` | Panel admin : quêtes de la semaine (créer, modifier, activer), défis (modifier, supprimer), réglages du site (ajouter, modifier, JSON refusé, clé sensible avec confirmation), pages (créer, modifier, supprimer), suppression d'une édition Secret Santa |

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
