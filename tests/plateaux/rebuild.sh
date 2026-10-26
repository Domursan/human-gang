#!/bin/bash
# Recrée la base de test « plat » : environnement simulé + socle 125 + moteurs des jeux de plateau + outils de test.
D=$(dirname "$0")
P="psql -h /tmp -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
bash $D/../loup-garou/start.sh >/dev/null
$P -c "drop database if exists plat" -c "create database plat" 2>&1 | grep -v NOTICE
$P -d plat -f $D/../loup-garou/mock.sql 2>&1 | grep -E "ERROR"
for f in $D/../../supabase/migrations/12[5-9]_*.sql $D/../../supabase/migrations/130_*.sql; do
  [ -f "$f" ] && $P -d plat -f "$f" 2>&1 | grep -E "ERROR|LINE|^\s+\^"
done
$P -d plat -f $D/helpers.sql 2>&1 | grep -E "ERROR"
echo "base plat prête"
