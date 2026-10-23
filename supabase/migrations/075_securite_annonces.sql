-- ===== Humane Gang — 075 : sécurité des annonces Discord (audit I7) =====
-- Rôle : empêcher de rejouer les annonces et MP du bot (hg-notify) et limiter leur nombre par membre.
--   1. Colonnes de réservation, posées par hg-notify (clé service) avec « is null » comme card_pull :
--        hg_events.announced_at                 (irl_new : une seule annonce par sortie)
--        hg_ss_participants.gift_notified_at     (ss_gift_sent : un seul MP « ton Santa a envoyé » par édition)
--        hg_ss_participants.received_notified_at (ss_gift_received : un seul MP « ta cible a reçu » par édition)
--        hg_card_trades.announced_at             (card_trade : une seule annonce par échange)
--        hg_messages.dm_notified_at              (message_new : un seul lot de MP par message)
--   2. Trigger hg_freeze_service_cols : ces colonnes (et hg_card_trades.notified_at) ne peuvent être écrites
--      que par la clé service ou une fonction SECURITY DEFINER. Pour les rôles anon et authenticated (API REST),
--      la valeur est remise à l'ancienne (UPDATE) ou à null (INSERT), sans erreur : le front actuel n'est pas cassé.
--      Le trigger ne touche pas aux policies (hg_ss_part_update_own est gérée par la migration 072).
--   3. Table hg_bot_quota (service seulement) : une ligne par annonce ou MP déclenché par un membre ; hg-notify
--      refuse au-delà de bot.limites.annonces_par_heure (20 par défaut) sur une heure glissante. Table dédiée plutôt
--      que hg_bot_log pour ne pas remplir l'historique du bot de l'admin.
--   4. Rattrapage : les lignes existantes sont marquées comme déjà annoncées (elles l'ont été avant cette migration).
-- Idempotente, rétrocompatible (colonnes facultatives, aucun changement de policy).

-- 1. Colonnes de réservation
alter table public.hg_events          add column if not exists announced_at timestamptz;
alter table public.hg_ss_participants add column if not exists gift_notified_at timestamptz;
alter table public.hg_ss_participants add column if not exists received_notified_at timestamptz;
alter table public.hg_card_trades     add column if not exists announced_at timestamptz;
alter table public.hg_messages        add column if not exists dm_notified_at timestamptz;

comment on column public.hg_events.announced_at is 'Annonce Discord de la sortie faite (réservation hg-notify irl_new, migration 075). Écrite par la clé service seulement.';
comment on column public.hg_ss_participants.gift_notified_at is 'MP « ton Santa a envoyé ton cadeau » envoyé (réservation hg-notify, migration 075). Clé service seulement.';
comment on column public.hg_ss_participants.received_notified_at is 'MP « ta cible a reçu son cadeau » envoyé (réservation hg-notify, migration 075). Clé service seulement.';
comment on column public.hg_card_trades.announced_at is 'Annonce Discord de l''échange conclu faite (réservation hg-notify card_trade, migration 075). Clé service seulement.';
comment on column public.hg_messages.dm_notified_at is 'MP Discord du message envoyés (réservation hg-notify message_new, migration 075). Clé service seulement.';

-- 4. Rattrapage (avant le trigger ; aucune autre trigger ne réagit à ces colonnes)
update public.hg_events set announced_at = created_at where announced_at is null;
update public.hg_ss_participants set gift_notified_at = sent_at where gift_notified_at is null and sent_at is not null;
update public.hg_ss_participants set received_notified_at = received_at where received_notified_at is null and received_at is not null;
update public.hg_card_trades set announced_at = coalesce(resolved_at, created_at) where announced_at is null and status = 'acceptee';
-- Messages : seuls les récents (fenêtre de 2 min de message_new, avec marge) pourraient encore déclencher un MP.
update public.hg_messages set dm_notified_at = created_at where dm_notified_at is null and created_at > now() - interval '15 minutes';

-- 2. Colonnes réservées à la clé service
create or replace function public.hg_freeze_service_cols()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
-- Remet à leur valeur d'origine (UPDATE) ou à null (INSERT) les colonnes passées en arguments du trigger,
-- quand l'écriture vient de l'API REST (rôles anon ou authenticated). La clé service (service_role) et les
-- fonctions SECURITY DEFINER (propriétaire postgres) écrivent normalement.
declare
  v_cols text[] := tg_argv;
  v_patch jsonb := '{}'::jsonb;
  v_old jsonb;
  c text;
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
  end if;
  foreach c in array v_cols loop
    v_patch := v_patch || jsonb_build_object(c, case when tg_op = 'UPDATE' then v_old -> c else 'null'::jsonb end);
  end loop;
  new := jsonb_populate_record(new, v_patch);
  return new;
end;
$$;

comment on function public.hg_freeze_service_cols() is 'Trigger (migration 075) : les colonnes en argument ne sont modifiables que par la clé service ou une fonction SECURITY DEFINER.';

do $$
declare
  t record;
begin
  for t in select * from (values
    ('hg_events',          'hg_events_service_cols',          '''announced_at'''),
    ('hg_ss_participants', 'hg_ss_participants_service_cols', '''gift_notified_at'', ''received_notified_at'''),
    ('hg_card_trades',     'hg_card_trades_service_cols',     '''announced_at'', ''notified_at'''),
    ('hg_messages',        'hg_messages_service_cols',        '''dm_notified_at''')
  ) as v(tbl, trg, args)
  loop
    if not exists (select 1 from pg_trigger where tgname = t.trg and tgrelid = ('public.' || t.tbl)::regclass) then
      execute format('create trigger %I before insert or update on public.%I for each row execute function public.hg_freeze_service_cols(%s)',
                     t.trg, t.tbl, t.args);
    end if;
  end loop;
end $$;

-- 3. Quota des annonces et MP déclenchés par les membres (hg-notify)
create table if not exists public.hg_bot_quota (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  event text not null,
  created_at timestamptz not null default now()
);
create index if not exists hg_bot_quota_user_time on public.hg_bot_quota (user_id, created_at desc);
alter table public.hg_bot_quota enable row level security;
-- Aucune policy : seule la clé service (hg-notify) lit et écrit.
revoke all on public.hg_bot_quota from anon, authenticated;
comment on table public.hg_bot_quota is 'Annonces et MP du bot déclenchés par chaque membre (hg-notify, migration 075) : limite par heure (hg_settings.bot.limites.annonces_par_heure, 20 par défaut). Clé service seulement ; lignes de plus de 2 jours purgées par hg-notify.';
