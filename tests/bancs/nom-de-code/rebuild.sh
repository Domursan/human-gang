#!/bin/bash
# Recrée la base de test « ndc » : environnement simulé (mock du Loup-Garou) + migration 123 + outils de test.
D=$(dirname "$0")
P="psql -h /tmp -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
bash $D/../loup-garou/start.sh
$P -c "drop database if exists ndc" -c "create database ndc" 2>&1 | grep -v NOTICE
$P -d ndc -f $D/../loup-garou/mock.sql 2>&1 | grep -E "ERROR"
$P -d ndc -f $D/../../supabase/migrations/123_nom_de_code.sql 2>&1 | grep -E "ERROR|LINE|^\s+\^"
$P -d ndc -f $D/helpers.sql 2>&1 | grep -E "ERROR"
echo "base ndc prête"
