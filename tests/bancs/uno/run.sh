#!/bin/bash
# Connexion : voir tests/bancs/pg-env.sh (serveur local par défaut, ou PGHOST/PGPORT/PGPASSWORD).
. "$(dirname "$0")/../pg-env.sh"
# Lance un ou plusieurs scénarios ; affiche ok / ÉCHEC.
for t in "$@"; do
  echo "=== $t"
  psql -v ON_ERROR_STOP=1 -q -d uno -f "$t" 2>&1 | sed 's/psql:[^:]*:[0-9]*: //' | grep -E "NOTICE:  ok|ERROR|ÉCHEC|CONTEXT|simu" | sed 's/NOTICE:  //'
done
