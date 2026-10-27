-- Outils de test du Nom de code (superutilisateur) : identités, assertions.
update hg_pages set mode = 'membres' where slug = 'nom-de-code';
create or replace function t_ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function t_uid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function t_asu(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false); end $$;
create or replace function t_pid(p_code text) returns uuid language sql as $$
  select id from hg_ndc_parties where code = p_code order by (statut in ('attente', 'en_cours')) desc, created_at desc limit 1 $$;
create or replace function t_callu(u uuid, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform t_asu(u); execute 'set local role authenticated';
  execute 'select to_jsonb((' || p_sql || '))' into r;
  execute 'reset role'; return r;
exception when others then execute 'reset role'; raise;
end $$;
create or replace function t_call(n int, p_sql text) returns jsonb language plpgsql as $$ begin return t_callu(t_uid(n), p_sql); end $$;
create or replace function t_err(n int, p_sql text) returns text language plpgsql as $$
begin perform t_call(n, p_sql); return null; exception when others then return sqlerrm; end $$;
create or replace function t_erru(u uuid, p_sql text) returns text language plpgsql as $$
begin perform t_callu(u, p_sql); return null; exception when others then return sqlerrm; end $$;
insert into hg_profiles(id, pseudo, color, is_admin) select t_uid(i), 'Joueur' || i, '#ABCDEF', i = 1 from generate_series(1, 24) i on conflict do nothing;
-- Code d'une nouvelle partie de n joueurs (1 = hôte) répartis 1,3,5… en jaune et 2,4,6… en rose, espions 1 et 2, lancée.
create or replace function t_partie(n int, p_opts jsonb default '{}'::jsonb) returns text language plpgsql as $$
declare v_code text; i int;
begin
  v_code := t_call(1, format('hg_ndc_creer(%L::jsonb)', (jsonb_build_object('nb_places', 20) || p_opts)::text)) #>> '{}';
  for i in 2 .. n loop perform t_call(i, format('hg_ndc_rejoindre(%L)', v_code)); perform t_call(i, format('hg_ndc_pret(%L, true)', v_code)); end loop;
  for i in 1 .. n loop perform t_call(1, format('hg_ndc_equipe(%L, %L, %L)', v_code, case when i % 2 = 1 then 'jaune' else 'rose' end, t_uid(i))); end loop;
  perform t_call(1, format('hg_ndc_espion(%L, %L)', v_code, t_uid(1)));
  perform t_call(1, format('hg_ndc_espion(%L, %L)', v_code, t_uid(2)));
  perform t_call(1, format('hg_ndc_lancer(%L)', v_code));
  return v_code;
end $$;
-- Numéro (1..n) de l'espion / d'un agent de l'équipe au tour.
create or replace function t_num(u uuid) returns int language sql as $$ select right(u::text, 2)::int $$;
