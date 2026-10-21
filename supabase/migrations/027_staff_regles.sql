-- 027 — Règles d'accès par permission Staff.
-- Remplace hg_is_admin() par hg_has_perm('<clé>') dans les règles RLS des tables d'un domaine,
-- et dans les fonctions d'administration correspondantes. Rejouable : une règle déjà convertie
-- ne contient plus hg_is_admin() et n'est pas retouchée. Les droits (is_admin, Staff, mode dieu)
-- restent sur hg_is_admin().

create table if not exists public.hg_perm_tables (
  tbl text primary key,
  perm text not null references public.hg_perm_catalog(key)
);
alter table public.hg_perm_tables enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='hg_perm_tables' and policyname='hg_perm_tables_read') then
    create policy hg_perm_tables_read on public.hg_perm_tables for select to authenticated using (true);
  end if;
end $$;

insert into public.hg_perm_tables(tbl, perm) values
  ('hg_profiles','membres'), ('hg_profile_info','membres'), ('hg_invites','membres'), ('hg_invite_links','membres'),
  ('hg_page_access','membres'),
  ('hg_events','evenements'), ('hg_event_dates','evenements'), ('hg_event_rsvps','evenements'), ('hg_event_date_votes','evenements'),
  ('hg_moments','souvenirs'), ('hg_photos','souvenirs'), ('hg_reactions','souvenirs'), ('storage:hg-photos','souvenirs'),
  ('hg_ss_editions','secret_santa'), ('hg_ss_participants','secret_santa'), ('hg_ss_exclusions','secret_santa'),
  ('hg_ss_wishes','secret_santa'), ('hg_ss_assignments','secret_santa'),
  ('hg_card_sets','cartes'), ('hg_cards','cartes'), ('hg_card_copies','cartes'), ('hg_wallets','cartes'), ('hg_wallet_log','cartes'),
  ('hg_card_trades','cartes'), ('hg_card_trade_items','cartes'), ('hg_card_wishlist','cartes'), ('hg_card_showcase','cartes'),
  ('hg_challenges','cartes'), ('hg_card_quests_templates','cartes'),
  ('hg_badges','badges'), ('hg_user_badges','badges'),
  ('hg_themes','themes'), ('hg_theme_seen','themes'), ('hg_dyn_events','themes'), ('hg_dyn_captures','themes'),
  ('hg_conversations','messages'), ('hg_conversation_members','messages'), ('hg_messages','messages'),
  ('hg_support','support'), ('hg_ideas','support'),
  ('hg_bot_log','bot'), ('hg_birthday_log','bot'),
  ('hg_settings','reglages'), ('hg_pages','reglages'), ('hg_activity','reglages'),
  ('hg_admin_log','journal'), ('hg_admin_access_log','journal')
on conflict (tbl) do update set perm = excluded.perm;

-- Règles RLS : hg_is_admin() -> hg_has_perm('<clé>') (ou hg_is_staff() pour le stockage commun et l'état du panel).
do $$
declare
  r record; v_perm text; v_new text; v_using text; v_check text; v_sql text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where (coalesce(qual,'') ~ 'hg_is_admin\(\)' or coalesce(with_check,'') ~ 'hg_is_admin\(\)')
      and schemaname in ('public','storage')
  loop
    v_new := null;
    if r.schemaname = 'storage' then
      if coalesce(r.qual,'') || coalesce(r.with_check,'') ~ 'hg-photos' then
        v_new := 'public.hg_has_perm(''souvenirs'')';
      elsif coalesce(r.qual,'') || coalesce(r.with_check,'') ~ 'hg-assets' then
        v_new := 'public.hg_is_staff()';
      end if;
    elsif r.tablename = 'hg_admin_state' then
      v_new := 'public.hg_is_staff()';
    else
      select perm into v_perm from public.hg_perm_tables where tbl = r.tablename;
      if v_perm is not null then v_new := format('public.hg_has_perm(%L)', v_perm); end if;
    end if;
    if v_new is null then
      raise notice 'Règle laissée à l''admin : %.% %', r.schemaname, r.tablename, r.policyname;
      continue;
    end if;
    v_using := case when r.qual is null then null else regexp_replace(r.qual, '(public\.)?hg_is_admin\(\)', v_new, 'g') end;
    v_check := case when r.with_check is null then null else regexp_replace(r.with_check, '(public\.)?hg_is_admin\(\)', v_new, 'g') end;
    v_sql := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if v_using is not null then v_sql := v_sql || ' using (' || v_using || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;
  end loop;
end $$;

-- Fonctions d'administration : même remplacement, fonction par fonction.
do $$
declare
  r record; v_def text;
begin
  for r in
    select p.oid, p.proname, m.perm
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    join (values
      ('hg_admin_accounts','membres'), ('hg_admin_ghosts','membres'), ('hg_ghost_create','membres'),
      ('hg_ghost_invite','membres'), ('hg_ghost_merge','membres'), ('hg_ghost_suggestions','membres'),
      ('hg_admin_conversations','messages'), ('hg_admin_read_conversation','messages'),
      ('hg_cards_admin_give','cartes'), ('hg_cards_admin_take','cartes'), ('hg_cards_admin_paillettes','cartes'),
      ('hg_trade_cancel','cartes'),
      ('hg_ss_draw','secret_santa'), ('hg_ss_manual_draw','secret_santa')
    ) as m(fn, perm) on m.fn = p.proname
    where n.nspname = 'public'
  loop
    v_def := pg_get_functiondef(r.oid);
    if v_def !~ 'hg_is_admin\(\)' then continue; end if;
    v_def := regexp_replace(v_def, '(public\.)?hg_is_admin\(\)', format('public.hg_has_perm(%L)', r.perm), 'g');
    execute v_def;
  end loop;
end $$;
