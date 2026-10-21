-- 032 — Assistance : prise en charge (« en cours »), lecture par le Staff, et fil de réponses.
-- « En cours » = statut 'ouverte' avec taken_by renseigné (le statut reste ouverte / traitee).
-- hg_support_replies : réponses visibles par le membre auteur de la demande, notes internes réservées au Staff « support ».

alter table public.hg_support add column if not exists taken_by uuid references public.hg_profiles(id) on delete set null;
alter table public.hg_support add column if not exists taken_at timestamptz;
alter table public.hg_support add column if not exists read_at timestamptz;
alter table public.hg_support add column if not exists updated_at timestamptz not null default now();

create table if not exists public.hg_support_replies (
  id uuid primary key default gen_random_uuid(),
  support_id uuid not null references public.hg_support(id) on delete cascade,
  author_id uuid references public.hg_profiles(id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists hg_support_replies_support_idx on public.hg_support_replies(support_id, created_at);
alter table public.hg_support_replies enable row level security;
revoke all on public.hg_support_replies from anon;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='hg_support_replies' and policyname='hg_support_replies_staff') then
    create policy hg_support_replies_staff on public.hg_support_replies for all to authenticated
      using (public.hg_has_perm('support'))
      with check (public.hg_has_perm('support') and author_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='hg_support_replies' and policyname='hg_support_replies_member_read') then
    create policy hg_support_replies_member_read on public.hg_support_replies for select to authenticated
      using (not internal and exists (select 1 from public.hg_support s where s.id = support_id and s.user_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='hg_support' and policyname='hg_support_member_read') then
    create policy hg_support_member_read on public.hg_support for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end $$;

-- Une réponse publique remet updated_at à jour ; la première réponse d'un Staff prend la demande en charge.
create or replace function public.hg_support_reply_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.hg_support
     set updated_at = now(),
         taken_by = coalesce(taken_by, new.author_id),
         taken_at = coalesce(taken_at, now())
   where id = new.support_id;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_support_reply_touch_trg') then
    create trigger hg_support_reply_touch_trg after insert on public.hg_support_replies
      for each row execute function public.hg_support_reply_touch();
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='hg_support_replies') then
    alter publication supabase_realtime add table public.hg_support_replies;
  end if;
end $$;

insert into public.hg_perm_tables(tbl, perm) values ('hg_support_replies', 'support') on conflict (tbl) do update set perm = excluded.perm;
