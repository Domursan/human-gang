#!/bin/bash
# Lance un ou plusieurs scénarios ; affiche ok / ÉCHEC.
for t in "$@"; do
  echo "=== $t"
  psql -h /tmp -p 54329 -U postgres -v ON_ERROR_STOP=1 -q -d lg -f "$t" 2>&1 | sed 's/psql:[^:]*:[0-9]*: //' | grep -E "NOTICE:  ok|ERROR|ÉCHEC|CONTEXT" | sed 's/NOTICE:  //'
done
