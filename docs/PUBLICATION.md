# Publication du site (GitHub Pages)

Le site est publié depuis la branche `main`. Depuis le 23/10/2026, GitHub Pages construit le site avec **Jekyll**
(le fichier `.nojekyll` a été retiré) uniquement pour **choisir les fichiers publiés** grâce à `_config.yml`.
Aucune page n'a d'en-tête `---` : Jekyll copie tout tel quel, sans modèle ni mise en page.

## Ce qui n'est plus publié

`docs/`, `tests/`, `qa/`, `supabase/migrations/`, `supabase/schema/`, `supabase/functions/hg-*` (code des fonctions edge),
et tous les fichiers `.md`, `.sql`, `.ts`, `.sh`, `.toml`, ainsi que `package.json`.
Ne sont pas servis non plus : `simulateur.html` et `assets/js/simulateur.js` (outil de développement, à ouvrir en local)
et `affiches/secrets-solutions-a3.html` (solutions des 12 secrets, à imprimer depuis une copie locale du dépôt).

Seul fichier publié sous `supabase/` : `supabase/functions/_shared/bot-templates.json` (textes par défaut du bot,
lus par l'admin, onglet Bot). Le guide du bot (`BOT.md`) est lié depuis l'admin vers le dépôt GitHub.

Le dépôt GitHub étant **public**, ces fichiers restent lisibles sur github.com : ils ne sont simplement plus servis
par le site lui-même.

## Règles à respecter en ajoutant un fichier au site

- Un fichier ou dossier dont le nom commence par `_` ou `.` n'est publié que s'il est listé dans `include:` de `_config.yml`.
- Aucun fichier publié ne doit commencer par `---` (il deviendrait un modèle Liquid).
- Un fichier `.md`, `.sql`, `.ts` n'est jamais publié.

`npm run check` (et donc la CI) lance `tests/check-publication.cjs`, qui vérifie ces règles, l'absence de `.nojekyll`,
et que tous les fichiers précachés par `sw.js` restent publiés.

## Retour en arrière (si le site ne s'affiche plus correctement)

Remettre un fichier `.nojekyll` vide à la racine (tout le dépôt est de nouveau publié tel quel, comme avant),
puis corriger `_config.yml` à tête reposée.

## Alternative plus stricte (réglage à faire par Ethan)

Publier par une GitHub Action au lieu de la branche : Settings → Pages → Source « GitHub Actions », et un workflow
`.github/workflows/pages.yml` qui copie uniquement les fichiers du site (pages `.html`, `assets/`, `affiches/`, `sw.js`,
`manifest.webmanifest`, `supabase/functions/_shared/bot-templates.json`) dans un dossier, puis utilise
`actions/upload-pages-artifact` et `actions/deploy-pages`. Avantage : liste blanche (rien n'est publié par défaut),
plus de dépendance à Jekyll. Inconvénient : demande ce changement de réglage du dépôt.
