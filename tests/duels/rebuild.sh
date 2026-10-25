#!/bin/bash
# Recrée la base de test « duels » : environnement simulé (mock du Loup-Garou) + migration 122 + outils de test.
D=$(dirname "$0")
P="psql -h /tmp -p 54329 -U postgres -v ON_ERROR_STOP=1 -q"
bash $D/../loup-garou/start.sh
$P -c "drop database if exists duels" -c "create database duels" 2>&1 | grep -v NOTICE
$P -d duels -f $D/../loup-garou/mock.sql 2>&1 | grep -E "ERROR"
# Tables du site absentes du mock et touchées par la migration 122
$P -d duels -c "create table if not exists public.hg_notif_prefs (user_id uuid primary key, prefs jsonb not null default '{}'::jsonb, quiet_start int, quiet_end int, updated_at timestamptz default now())" \
  -c "alter table public.hg_profiles add column if not exists remind_irl boolean default true, add column if not exists notify_card_wish boolean default true" 2>&1 | grep -E "ERROR"
$P -d duels -f $D/../../supabase/migrations/122_duels.sql 2>&1 | grep -E "ERROR|LINE|^\s+\^"
$P -d duels -f $D/helpers.sql 2>&1 | grep -E "ERROR"
echo "base duels prête"
