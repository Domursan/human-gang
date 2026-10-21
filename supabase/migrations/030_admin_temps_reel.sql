-- 030 — Temps réel du panel admin : tables suivies par la publication supabase_realtime.
-- Les abonnés ne reçoivent que les lignes que leurs règles RLS leur permettent de lire.
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['hg_support','hg_ideas','hg_profiles','hg_staff','hg_card_trades','hg_events',
                           'hg_event_rsvps','hg_moments','hg_photos','hg_admin_log','hg_ss_participants']
  loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
