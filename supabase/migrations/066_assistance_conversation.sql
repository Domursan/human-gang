-- ===== Humane Gang — migration 066 : la prise en charge d'une demande d'assistance ouvre une conversation privée =====
-- Quand un admin ou un Staff « support » prend en charge la demande d'un membre inscrit, une conversation privée
-- (hg_conversations.kind = 'support') est créée entre lui et le membre. Son nom est le sujet de la demande ;
-- la page Messages affiche en haut un résumé de la demande (hg_support_summary). Un premier message du Staff
-- prévient le membre (et déclenche les notifications habituelles : push, bot Discord).
-- Les demandes de visiteurs (sans compte) gardent l'ancien fonctionnement : pas de conversation possible.
-- Rétrocompatible : colonnes facultatives, nouveau type de conversation, fonctions ajoutées.

-- 1. Conversations d'assistance
alter table public.hg_conversations drop constraint if exists hg_conversations_kind_check;
alter table public.hg_conversations add constraint hg_conversations_kind_check check (kind in ('direct', 'santa', 'support'));
alter table public.hg_conversations add column if not exists title text check (title is null or char_length(title) <= 160);
alter table public.hg_conversations add column if not exists support_id uuid unique references public.hg_support(id) on delete set null;
alter table public.hg_support add column if not exists conversation_id uuid references public.hg_conversations(id) on delete set null;

-- 2. Titre d'une conversation : le sujet de la demande pour une conversation d'assistance
create or replace function public.hg_conv_title(c hg_conversations, me uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when c.kind = 'support' then coalesce(nullif(c.title, ''), 'Assistance')
    when c.kind = 'santa' and me = c.target_id then 'Ton Santa ' || coalesce((select year::text from hg_ss_editions where id = c.edition_id), '')
    when c.kind = 'santa' and me = c.santa_id then 'Ta cible : ' || coalesce((select pseudo from hg_profiles where id = c.target_id), '?')
    else coalesce((select p.pseudo from hg_conversation_members m join hg_profiles p on p.id = m.user_id
                   where m.conversation_id = c.id and m.user_id <> me limit 1), 'Conversation')
  end $$;

-- 3. Prise en charge : marque la demande « en cours » et ouvre (ou rejoint) la conversation privée.
--    Renvoie l'identifiant de la conversation, ou null pour la demande d'un visiteur (pas de compte).
create or replace function public.hg_support_take(p_support uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s hg_support;
  conv uuid;
  who text;
begin
  if not public.hg_has_perm('support') then raise exception 'Réservé à l''admin ou au Staff avec la permission Assistance'; end if;
  select * into s from hg_support where id = p_support for update;
  if not found then raise exception 'Demande introuvable'; end if;

  -- La demande passe « en cours » (si personne ne l'avait encore prise). Une demande traitée garde son statut.
  update hg_support set taken_by = coalesce(taken_by, me), taken_at = coalesce(taken_at, now()), updated_at = now()
   where id = s.id and status <> 'traitee';

  -- Visiteur, ou compte supprimé : pas de conversation possible.
  if s.user_id is null or not exists (select 1 from hg_profiles where id = s.user_id) then return null; end if;

  conv := s.conversation_id;
  if conv is not null and exists (select 1 from hg_conversations where id = conv) then
    -- Conversation déjà ouverte : le Staff qui la reprend la rejoint.
    insert into hg_conversation_members(conversation_id, user_id) values (conv, me) on conflict do nothing;
    return conv;
  end if;

  insert into hg_conversations(kind, title, support_id) values ('support', left(s.subject, 160), s.id) returning id into conv;
  insert into hg_conversation_members(conversation_id, user_id) values (conv, me), (conv, s.user_id) on conflict do nothing;
  update hg_support set conversation_id = conv where id = s.id;

  select pseudo into who from hg_profiles where id = s.user_id;
  if me <> s.user_id then
    insert into hg_messages(conversation_id, sender_id, body)
      values (conv, me, 'Salut ' || coalesce(who, '') || ' ! Je prends en charge ta demande « ' || s.subject
        || ' ». On peut en discuter ici : réponds directement dans cette conversation.');
    update hg_conversations set last_message_at = now() where id = conv;
    update hg_conversation_members set last_read_at = now() where conversation_id = conv and user_id = me;
  end if;
  return conv;
end $$;

-- 4. Résumé de la demande, affiché en haut de la conversation (membres de la conversation, ou Staff « support »).
create or replace function public.hg_support_summary(p_conv uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c hg_conversations; s hg_support;
begin
  select * into c from hg_conversations where id = p_conv;
  if not found or c.kind <> 'support' then return null; end if;
  if not (exists (select 1 from hg_conversation_members where conversation_id = p_conv and user_id = auth.uid())
          or public.hg_has_perm('support')) then
    raise exception 'Conversation introuvable';
  end if;
  select * into s from hg_support where id = c.support_id;
  if not found then return jsonb_build_object('subject', c.title, 'missing', true); end if;
  return jsonb_build_object(
    'support_id', s.id, 'subject', s.subject, 'message', s.message, 'created_at', s.created_at,
    'author', coalesce((select pseudo from hg_profiles where id = s.user_id), s.pseudo),
    'status', case when s.status = 'traitee' then 'traitee' when s.taken_by is not null then 'encours' else 'ouverte' end,
    'taken_by', (select pseudo from hg_profiles where id = s.taken_by),
    'taken_at', s.taken_at);
end $$;

revoke all on function public.hg_support_take(uuid) from public, anon;
revoke all on function public.hg_support_summary(uuid) from public, anon;
grant execute on function public.hg_support_take(uuid) to authenticated;
grant execute on function public.hg_support_summary(uuid) to authenticated;
