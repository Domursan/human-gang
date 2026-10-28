#!/bin/bash
# Recrée la base de test « cartes » (port 54329, socket /tmp), puis la remplit avec le jeu de données du banc.
# 1. mock.sql : rôles, auth, storage, cron, vault, privilèges par défaut de Supabase (imitation locale).
# 2. Schéma reconstitué au 21/10 (supabase/schema/schema_reel_2026-10-21b.sql) : les migrations 001 à 021 ne se
#    rejouent pas depuis le dépôt (004, 007, 008, 010, 020 absents ; 006, 009, 011, 012, 015, 017 sont des résumés).
# 3. Toutes les migrations 022 à 166, dans l'ordre des noms. Les erreurs sont comptées et listées, pas bloquantes :
#    le résumé ci-dessous les donne (voir README.md, « erreurs connues »).
# 4. helpers.sql (outils) puis seed.sql (jeu de données).
D=$(cd "$(dirname "$0")" && pwd)
R=$D/../../..
P="psql -h /tmp -p 54329 -U postgres -q -X -v ON_ERROR_STOP=0"
bash "$D/../loup-garou/start.sh"
$P -c "drop database if exists cartes" -c "create database cartes" -c "alter database cartes set search_path = public, extensions" 2>&1 | grep -v NOTICE
$P -d cartes -f "$D/mock.sql" 2>&1 | grep "ERROR" | sed 's/^/mock : /'
sed 's/00000000-0000-0000-0000-000000000000/11111111-1111-1111-1111-111111111111/g' "$R/supabase/schema/schema_reel_2026-10-21b.sql" \
  | $P -d cartes 2>&1 | grep "ERROR" | grep -v "supabase_vault\|pg_net\|pg_cron" | sed 's/^/schema : /' | head -20
echo "schéma reconstitué chargé (les erreurs « extension non disponible » sont attendues)"
# Droits : le schéma de référence ne contient aucun GRANT/REVOKE, et les migrations 001 à 021 ne sont pas rejouées.
# On rejoue ici les GRANT et REVOKE de ces migrations (sans le reste), pour que les fonctions « joueur »/« admin »
# aient les mêmes droits qu'en production (sinon le mock accorde EXECUTE à authenticated par défaut).
acl=$(mktemp)
for f in "$R"/supabase/migrations/0[0-2]*.sql; do
  n=$(basename "$f" | cut -c1-3)
  [ "$n" -ge 1 ] 2>/dev/null && [ "$n" -le 21 ] 2>/dev/null || continue
  awk 'tolower($0) ~ /^(revoke|grant) /{on=1} on{print} on && /;[ \t]*$/{on=0}' "$f"
done > "$acl"
echo "droits : $(grep -c ';' "$acl") instruction(s) GRANT/REVOKE des migrations 001 à 021 rejouées"
$P -d cartes -f "$acl" 2>&1 | grep "ERROR" | sed 's/^/droits : /' | head -20
rm -f "$acl"
erreurs=$(mktemp)
for f in "$R"/supabase/migrations/*.sql; do
  n=$(basename "$f" | cut -c1-3)
  [ "$n" -ge 22 ] 2>/dev/null && [ "$n" -le 166 ] 2>/dev/null || continue
  $P -d cartes -f "$f" 2>&1 | grep "^psql:.*ERROR" | sed "s|^psql:[^ ]* |$(basename "$f") : |" >> "$erreurs"
done
echo "migrations 022 à 166 : $(wc -l < "$erreurs") erreur(s) non bloquante(s)"
sed 's/^/  /' "$erreurs" | cut -c1-200
rm -f "$erreurs"
$P -d cartes -f "$D/helpers.sql" 2>&1 | grep "ERROR"
$P -d cartes -f "$D/seed.sql" 2>&1 | grep "ERROR"
echo "base cartes prête"
