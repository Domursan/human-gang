-- 166 : suite de la 165. Les jeux de cartes et Catan (migrations 143 à 145) ont aussi des fonctions internes hors du préfixe
-- hg_plat__ : hg_bj__ (blackjack), hg_pk__ (poker), hg_ct__ (catan), hg_pi__ (pictionary). Certaines (hg_ct__res : ressources
-- d'un joueur) restaient exécutables par anon et authenticated. hg_plat__droits() les referme désormais aussi : toute fonction
-- interne d'un jeu de plateau (préfixe hg_<jeu>__) n'est appelable que depuis les fonctions publiques hg_plat_*.
create or replace function public.hg_plat__droits()
returns void language plpgsql security definer set search_path = public as $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'hg\_plat%' or p.proname ~ '^hg_(bj|pk|ct|pi)__') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    if f.proname like 'hg\_plat%' and f.proname not like 'hg\_plat\_\_%' and f.proname <> 'hg_plat_tick' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
  execute 'grant execute on function public.hg_plat_invite(text, text, text, jsonb) to anon, authenticated';
  execute 'grant execute on function public.hg_plat_contenus(text) to anon, authenticated';
end $$;
select public.hg_plat__droits();
