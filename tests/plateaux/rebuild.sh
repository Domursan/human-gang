#!/bin/bash
# Recrée la base de test « plat » (ou celle donnée en argument) : environnement simulé + socle 125 + moteurs des jeux de plateau + outils de test.
D=$(dirname "$0")
B=${1:-plat}
P="psql -h /tmp -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
bash $D/../loup-garou/start.sh >/dev/null
$P -c "drop database if exists $B" -c "create database $B" 2>&1 | grep -v NOTICE
$P -d $B -f $D/../loup-garou/mock.sql 2>&1 | grep -E "ERROR"
for f in $D/../../supabase/migrations/12[5-9]_*.sql $D/../../supabase/migrations/130_*.sql; do
  [ -f "$f" ] && $P -d $B -f "$f" 2>&1 | grep -E "ERROR|LINE|^\s+\^"
done
$P -d $B -f $D/helpers.sql 2>&1 | grep -E "ERROR"
echo "base $B prête"
