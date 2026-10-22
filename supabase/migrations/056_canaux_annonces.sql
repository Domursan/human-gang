-- ===== Humane Gang — migration 056 : salons des annonces par type, anti-doublon des offres d'échange =====
-- Rôle : ajouter la colonne notified_at sur hg_card_trades. hg-notify (onTradeOffer) y marque l'offre dès que son MP
-- part, pour qu'un second appel dans la fenêtre de 15 min n'envoie pas un second MP. Colonne nullable : compatible avec
-- le site en ligne (les anciennes offres restent à null, sans effet).
-- Les salons par type (bot.channels) sont dans hg_settings.bot : aucune table ni colonne à ajouter.
-- Idempotente : peut être rejouée sans erreur. Ne supprime rien.
alter table public.hg_card_trades add column if not exists notified_at timestamptz;
