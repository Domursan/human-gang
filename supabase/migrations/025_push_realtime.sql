-- =====================================================================
-- 025 : messagerie temps réel pour les membres (Realtime Broadcast privé) et notifications push
-- Idempotente : rejouable sans erreur. Aucun « drop policy », « drop trigger » ni « delete from ».
--
-- Contenu :
--   P4  canal privé « conv:<conversation_id> » : un trigger publie, après chaque message, un payload MINIMAL
--       (conversation_id, id, created_at). Aucun sender_id. Une policy sur realtime.messages n'autorise la
--       réception qu'aux membres de la conversation (fonction hg_conv_member, security definer).
--   F9  table hg_push_subscriptions (un abonnement par navigateur, RLS : chacun gère les siens), policy de
--       lecture publique de la seule clé VAPID publique, trigger qui appelle la fonction edge hg-push.
--
-- ----- Clés VAPID (à insérer À LA MAIN, une fois ; elles ne sont PAS dans ce fichier) -----
-- Les deux valeurs générées figurent dans un fichier hors dépôt (scratchpad qa/vapid.json).
--   insert into public.hg_settings (key, value)
--     values ('push_vapid_public', to_jsonb('<CLÉ_PUBLIQUE>'::text))
--     on conflict (key) do update set value = excluded.value, updated_at = now();
--   insert into public.hg_private (key, value)
--     values ('push_vapid_private', '<CLÉ_PRIVÉE>')
--     on conflict (key) do update set value = excluded.value, updated_at = now();
-- Le trigger push ne fait rien tant que la ligne « cron_secret » de hg_private n'existe pas (voir migration 020).
-- Facultatif : secret VAPID_SUBJECT pour la fonction hg-push (sinon SITE_URL est utilisé).

-- ---------- Fonctions d'aide ----------

-- Vrai si l'utilisateur courant est membre de la conversation. Security definer : hg_conversation_members
-- n'est lisible que par l'admin, la policy de realtime.messages doit pouvoir consulter l'appartenance.
create or replace function public.hg_conv_member(p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.hg_conversation_members m
    where m.conversation_id = p_conv and m.user_id = auth.uid()
  )
$$;
revoke execute on function public.hg_conv_member(uuid) from public, anon;
grant execute on function public.hg_conv_member(uuid) to authenticated;

-- Vrai si le topic Realtime est « conv:<uuid> » et que l'utilisateur courant est membre de cette conversation.
-- Un topic mal formé renvoie faux (pas d'erreur côté Realtime).
create or replace function public.hg_conv_topic_member(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_topic is null or p_topic !~ '^conv:[0-9a-fA-F-]{36}$' then return false; end if;
  return public.hg_conv_member(substr(p_topic, 6)::uuid);
exception when others then
  return false;
end
$$;
revoke execute on function public.hg_conv_topic_member(text) from public, anon;
grant execute on function public.hg_conv_topic_member(text) to authenticated;

-- ---------- P4 : messagerie temps réel (Broadcast privé) ----------

-- Trigger : publie le minimum après chaque message. Ne lève jamais d'erreur (l'envoi du message ne doit pas échouer).
create or replace function public.hg_msg_realtime_trg()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
begin
  perform realtime.send(
    jsonb_build_object('conversation_id', new.conversation_id, 'id', new.id, 'created_at', new.created_at),
    'new_message',
    'conv:' || new.conversation_id::text,
    true
  );
  return null;
exception when others then
  raise warning 'hg_msg_realtime_trg : %', sqlerrm;
  return null;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'realtime' and tablename = 'messages' and policyname = 'hg_conv_broadcast_read'
  ) then
    create policy hg_conv_broadcast_read on realtime.messages
      for select to authenticated
      using (extension = 'broadcast' and public.hg_conv_topic_member(realtime.topic()));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'hg_msg_realtime' and tgrelid = 'public.hg_messages'::regclass
  ) then
    create trigger hg_msg_realtime
      after insert on public.hg_messages
      for each row execute function public.hg_msg_realtime_trg();
  end if;
end $$;

-- ---------- F9 : notifications push ----------

create table if not exists public.hg_push_subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.hg_profiles(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  constraint hg_push_subscriptions_endpoint_key unique (endpoint)
);
create index if not exists hg_push_subscriptions_user_idx on public.hg_push_subscriptions (user_id);
alter table public.hg_push_subscriptions enable row level security;
revoke all on public.hg_push_subscriptions from anon;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'hg_push_subscriptions' and policyname = 'hg_push_own'
  ) then
    create policy hg_push_own on public.hg_push_subscriptions
      for all to authenticated
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;

-- Seule la clé publique VAPID est lisible par les visiteurs et les membres (elle sert à l'abonnement du navigateur).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'hg_settings' and policyname = 'hg_settings_push_public'
  ) then
    create policy hg_settings_push_public on public.hg_settings
      for select to anon, authenticated
      using (key = 'push_vapid_public');
  end if;
end $$;

-- Trigger : appelle la fonction edge hg-push (pg_net, asynchrone) avec le secret d'appel de hg_private.
-- Le destinataire ne reçoit que « Nouveau message » et le nom de la conversation (fait côté fonction edge).
create or replace function public.hg_msg_push_trg()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
begin
  select value into v_secret from public.hg_private where key = 'cron_secret';
  if v_secret is null or v_secret = '' then return null; end if;
  perform net.http_post(
    url := 'https://zqbdzokyhgavgmqgiwuw.supabase.co/functions/v1/hg-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('conversation_id', new.conversation_id, 'message_id', new.id, 'sender_id', new.sender_id)
  );
  return null;
exception when others then
  raise warning 'hg_msg_push_trg : %', sqlerrm;
  return null;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'hg_msg_push' and tgrelid = 'public.hg_messages'::regclass
  ) then
    create trigger hg_msg_push
      after insert on public.hg_messages
      for each row execute function public.hg_msg_push_trg();
  end if;
end $$;
