#!/bin/bash
# Connexion : voir tests/bancs/pg-env.sh (serveur local par défaut, ou PGHOST/PGPORT/PGPASSWORD).
. "$(dirname "$0")/../pg-env.sh"
# Recrée la base de test « duels » : environnement simulé (mock du Loup-Garou) + migration 122 + outils de test.
D=$(dirname "$0")
P="psql -v ON_ERROR_STOP=1 -q"
bash $D/../loup-garou/start.sh
$P -c "drop database if exists duels" -c "create database duels" 2>&1 | grep -v NOTICE
$P -d duels -f $D/../loup-garou/mock.sql 2>&1 | grep -E "ERROR"
# Tables du site absentes du mock et touchées par la migration 122
$P -d duels -c "create table if not exists public.hg_notif_prefs (user_id uuid primary key, prefs jsonb not null default '{}'::jsonb, quiet_start int, quiet_end int, updated_at timestamptz default now())" \
  -c "alter table public.hg_profiles add column if not exists remind_irl boolean default true, add column if not exists notify_card_wish boolean default true" 2>&1 | grep -E "ERROR"
$P -d duels -f $D/../../../supabase/migrations/122_duels.sql 2>&1 | grep -E "ERROR|LINE|^\s+\^"
# Migrations suivantes qui touchent aux duels (quiestce, socle des nouveaux jeux, Dames/Échecs/Othello/Pierre-feuille-ciseaux).
# Sans ON_ERROR_STOP : les tables des autres jeux (arcade, daily) n'existent pas dans la base de test ; seules comptent les fonctions des duels.
for m in 123_nom_de_code 124_quiestce_quartier 125_plateaux 134_adrep_duels 136_nouveaux_jeux_socle 137_nj_devine 138_nj_solo 140_nj_grilles 141_duels_nouveaux 142_duels_correctif 150_nj_acces_pages; do
  psql -d duels -X -q -f $D/../../../supabase/migrations/$m.sql >/dev/null 2>&1
done
$P -d duels -f $D/helpers.sql 2>&1 | grep -E "ERROR"
echo "base duels prête"
