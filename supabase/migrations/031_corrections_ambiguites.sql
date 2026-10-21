-- 031 — Colonnes ambiguës dans deux fonctions admin (les noms des colonnes de sortie
-- entraient en conflit avec les colonnes des sous-requêtes non qualifiées).

create or replace function public.hg_admin_ghosts()
 returns table(id uuid, pseudo text, joined_on date, ghost_note text, avatar_url text, created_at timestamptz, invite_code text, invite_expires_at timestamptz)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé à l''admin'; end if;
  return query select p.id, p.pseudo, p.joined_on, p.ghost_note, p.avatar_url, p.created_at,
    i.code, i.expires_at
  from hg_profiles p
  left join lateral (select v.code, v.expires_at from hg_invites v where v.ghost_id = p.id and v.used_by is null and (v.expires_at is null or v.expires_at > now()) order by v.created_at desc limit 1) i on true
  where p.is_ghost order by p.pseudo;
end $function$;

create or replace function public.hg_admin_conversations()
 returns table(id uuid, kind text, edition_year integer, members text, santa text, target text, last_message_at timestamptz, messages integer)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.hg_has_perm('messages') then raise exception 'Réservé à l''admin'; end if;
  return query select c.id, c.kind, e.year,
    (select string_agg(p.pseudo, ' · ' order by p.pseudo) from hg_conversation_members m join hg_profiles p on p.id = m.user_id where m.conversation_id = c.id),
    (select ps.pseudo from hg_profiles ps where ps.id = c.santa_id), (select pt.pseudo from hg_profiles pt where pt.id = c.target_id),
    c.last_message_at, (select count(*)::int from hg_messages x where x.conversation_id = c.id)
  from hg_conversations c left join hg_ss_editions e on e.id = c.edition_id order by c.last_message_at desc;
end $function$;
