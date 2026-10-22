-- ===== Humane Gang — migration 064 : annonce Discord des drops =====
-- Quand l'admin (ou le Staff « cartes ») lance un drop, le site appelle hg-notify (événement card_drop) pour poster
-- une annonce dans le salon Discord. Cette colonne garantit qu'un même drop n'est annoncé qu'une seule fois.
-- Rétrocompatible : colonne facultative, null = pas encore annoncé sur Discord.
alter table public.hg_card_drops add column if not exists discord_announced_at timestamptz;
