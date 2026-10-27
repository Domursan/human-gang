#!/bin/bash
# Recrée la base de test « uno » : environnement simulé (mock du Loup-Garou) + migration 121 + outils de test.
D=$(dirname "$0")
P="psql -h /tmp -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
bash $D/../loup-garou/start.sh
$P -c "drop database if exists uno" -c "create database uno" 2>&1 | grep -v NOTICE
$P -d uno -f $D/../loup-garou/mock.sql 2>&1 | grep -E "ERROR"
$P -d uno -f $D/../../../supabase/migrations/121_uno.sql 2>&1 | grep -E "ERROR"
$P -d uno -f $D/helpers.sql 2>&1 | grep -E "ERROR"
echo "base uno prête"
