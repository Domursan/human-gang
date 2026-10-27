# Publication du site (GitHub Pages)

Seul le dossier `site/` est publié. Le workflow `.github/workflows/publier-site.yml` envoie son contenu à GitHub Pages
à chaque envoi sur `main` (et à la demande, `workflow_dispatch`). Le reste du dépôt (`supabase/`, `docs/`, `tests/`,
`.github/`…) n'est jamais servi : il est seulement lisible sur github.com, le dépôt étant public.

## Réglage à faire une fois dans GitHub

Settings › Pages › Source : **GitHub Actions** (et non « Deploy from a branch »).
`site/.nojekyll` désactive Jekyll ; `site/CNAME` garde le domaine humane-gang.com.

## Règles pour un fichier ajouté au site

- Il se range dans `site/` : les pages dans `site/pages/<catégorie>/`, les illustrations dans `site/assets/`.
- Un fichier de `site/` qui ne doit pas être servi (outil de développement, par exemple) se met hors de `site/`.
