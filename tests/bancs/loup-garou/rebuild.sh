#!/bin/bash
# Recrée la base de test : environnement simulé + migrations + outils de test.
P="psql -h /tmp -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
$P -c "drop database if exists lg" -c "create database lg" 2>&1 | grep -v NOTICE
$P -d lg -f mock.sql 2>&1 | grep -E "ERROR" 
for f in $(dirname "$0")/../../../supabase/migrations/11[89]_loup_garou*.sql /home/claude/human-gang/supabase/migrations/12[0-9]_loup_garou*.sql; do
  [ -f "$f" ] && $P -d lg -f "$f" 2>&1 | grep -E "ERROR"
done
$P -d lg -f helpers.sql 2>&1 | grep -E "ERROR"
echo "base prête"
