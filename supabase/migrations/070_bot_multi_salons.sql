-- ===== 070 : bot Discord — annonces dans plusieurs salons =====
-- Idempotent, rétrocompatible.
-- hg_bot_log.channels : détail par salon d'une annonce publiée dans un ou plusieurs salons
-- ([{ "id": "<salon>", "ok": true|false, "error": "…", "ref": "…" }], ref facultatif = annonce concernée).
-- Écrite par hg-notify (admin_dm ; annonces draw, dyn_announce, card_drop ; irl, card_pull, card_trade en cas d'échec),
-- hg-cron (auto:cron) et hg-birthdays (auto:anniversaire). Si la colonne manque (42703 / PGRST204), elles réécrivent
-- la ligne sans elle (aucune perte). À appliquer avant ou juste après le déploiement de ces trois fonctions (voir supabase/functions/DEPLOY.md).
-- Les réglages (hg_settings.bot : salons, channels[type] en liste) sont du JSON libre : aucune autre modification de schéma.
alter table public.hg_bot_log add column if not exists channels jsonb;
