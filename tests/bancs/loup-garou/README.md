# Tests du Loup-Garou

Tests hors ligne : une base PostgreSQL 16 locale imite Supabase (`mock.sql` : rôles anon/authenticated, `auth.uid()`, tables HG utiles).

- `./rebuild.sh` : recrée la base `lg` (port 54329, socket /tmp) avec les migrations 118 et 119 et les outils de test.
- `./run.sh t1_classique.sql t2_loups.sql t3_meneur.sql t4_extensions.sql` : scénarios du moteur (affiche « ok » ou « ÉCHEC »).
- `./run.sh t5_tailles.sql` : 90 parties complètes jouées par un pilote automatique, de 6 à 50 joueurs (répartition du site
  et composition riche en rôles). Environ 6 minutes.
- `ui/` : parcours dans un vrai navigateur (Playwright). `ui/fake.js` intercepte les appels Supabase du site et les rejoue
  sur la base locale via psql. Servir le dépôt sur http://localhost:8080, lancer `psql … -f ui/setup.sql`, puis par exemple
  `node ui/s1_creer.js` (affiche le code), `node ui/s2_rejoindre.js HGLG-1234`, etc. Les captures vont dans `shots/`.

Joueurs de test : profils 1 à 13 (1 = admin, 2 à 12 = testeurs, 13 = membre extérieur).
