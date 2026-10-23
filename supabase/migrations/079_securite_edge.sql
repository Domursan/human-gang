-- ===== Humane Gang — 079 : sécurité des fonctions edge (ré-audit E2, E5) =====
-- Rôle :
--   1. hg_card_copies.gift_dm_at : réservation du MP « l'admin t'a offert » (hg-notify card_gift_admin). hg-notify
--      (clé service) passe la colonne de null à « maintenant » sur les exemplaires du don avant d'envoyer le MP :
--      un même don ne peut plus être annoncé en boucle. Colonne protégée par le trigger hg_freeze_service_cols
--      (migration 075) : un compte Staff « cartes » ne peut pas la remettre à null par l'API REST.
--   2. Table hg_album_quota (clé service seulement) : une ligne par ZIP d'album préparé par hg-album ; la fonction
--      refuse au-delà de 3 ZIP par heure et par membre (heure glissante). Lignes de plus de 2 jours purgées par hg-album.
-- Prérequis : migration 075 (fonction hg_freeze_service_cols).
-- Idempotente, rétrocompatible (colonne facultative, nouvelle table, aucun changement de policy).

-- 1. Réservation du MP de don de carte
alter table public.hg_card_copies add column if not exists gift_dm_at timestamptz;
comment on column public.hg_card_copies.gift_dm_at is 'MP Discord « l''admin t''a offert » envoyé pour cet exemplaire (réservation hg-notify card_gift_admin, migration 079). Clé service seulement.';

-- Rattrapage : les dons récents (fenêtre de 15 min de card_gift_admin, avec marge) sont considérés comme déjà annoncés.
update public.hg_card_copies set gift_dm_at = obtained_at
 where gift_dm_at is null and source = 'admin' and obtained_at > now() - interval '20 minutes';

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_card_copies_service_cols' and tgrelid = 'public.hg_card_copies'::regclass) then
    create trigger hg_card_copies_service_cols before insert or update on public.hg_card_copies
      for each row execute function public.hg_freeze_service_cols('gift_dm_at');
  end if;
end $$;

-- 2. Quota des ZIP d'album (hg-album)
create table if not exists public.hg_album_quota (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists hg_album_quota_user_time on public.hg_album_quota (user_id, created_at desc);
alter table public.hg_album_quota enable row level security;
-- Aucune policy : seule la clé service (hg-album) lit et écrit.
revoke all on public.hg_album_quota from anon, authenticated;
comment on table public.hg_album_quota is 'ZIP d''albums préparés par chaque membre (hg-album, migration 079) : 3 par heure au plus. Clé service seulement ; lignes de plus de 2 jours purgées par hg-album.';
