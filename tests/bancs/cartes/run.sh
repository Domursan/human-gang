#!/bin/bash
# Lance un ou plusieurs scénarios sur la base « cartes » (après rebuild.sh) ; affiche ok / ÉCHEC et le bilan.
for t in "$@"; do
  echo "=== $t"
  psql -h /tmp -p 54329 -U postgres -v ON_ERROR_STOP=1 -q -X -d cartes -f "$t" 2>&1 \
    | sed 's/psql:[^:]*:[0-9]*: //' | grep -E "NOTICE:  (ok|ÉCHEC|BILAN)|ERROR|CONTEXT" | sed 's/NOTICE:  //'
done
