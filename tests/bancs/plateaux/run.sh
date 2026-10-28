#!/bin/bash
# Lance les scénarios SQL du banc plateaux sur la base construite par rebuild.sh (« plat », ou BANC_DB) ; affiche
# ok / ÉCHEC et sort en erreur au premier échec. Sans argument : tous les t_*.sql ; sinon, les fichiers donnés.
. "$(dirname "$0")/../pg-env.sh"
D="$(cd "$(dirname "$0")" && pwd)"
cd "$D"
B="${BANC_DB:-plat}"
fichiers=("$@")
[ ${#fichiers[@]} -eq 0 ] && fichiers=(t_*.sql)
echec=0
for t in "${fichiers[@]}"; do
  echo "=== $t"
  sortie=$(psql -v ON_ERROR_STOP=1 -q -d "$B" -f "$t" 2>&1)
  echo "$sortie" | sed 's/psql:[^:]*:[0-9]*: //' | grep -E "NOTICE:  ok|ERROR|ÉCHEC|CONTEXT" | sed 's/NOTICE:  //'
  if echo "$sortie" | grep -qE "ERROR|ÉCHEC"; then echo "ÉCHEC : $t" >&2; echec=1; break; fi
done
exit $echec
