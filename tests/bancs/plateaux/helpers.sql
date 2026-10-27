-- Outils de test des jeux de plateau (superutilisateur) : identités, appels, assertions.
update hg_pages set mode = 'membres' where slug in ('cluedo', 'shadow-hunters', 'destins', 'monopoly', 'risk');
create or replace function t_ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function t_uid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function t_num(u uuid) returns int language sql as $$ select right(u::text, 2)::int $$;
create or replace function t_asu(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false); end $$;
create or replace function t_pid(p_code text) returns uuid language sql as $$
  select id from hg_plat_parties where code = p_code order by (statut in ('attente', 'en_cours')) desc, created_at desc limit 1 $$;
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
-- Action de jeu d'un utilisateur.
create or replace function t_agir(u uuid, p_code text, p_action text, p_args jsonb default '{}') returns jsonb language plpgsql as $$
begin return t_callu(u, format('hg_plat_agir(%L, %L, %L::jsonb)', p_code, p_action, p_args::text)); end $$;
create or replace function t_agir_err(u uuid, p_code text, p_action text, p_args jsonb default '{}') returns text language plpgsql as $$
begin perform t_agir(u, p_code, p_action, p_args); return null; exception when others then return sqlerrm; end $$;
-- Nouvelle partie lancée de n joueurs (1 = hôte).
create or replace function t_partie(p_jeu text, n int, p_opts jsonb default '{}'::jsonb) returns text language plpgsql as $$
declare v_code text; i int;
begin
  v_code := t_call(1, format('hg_plat_creer(%L::jsonb)', jsonb_build_object('jeu', p_jeu, 'nb_places', n, 'options', p_opts)::text)) #>> '{}';
  for i in 2 .. n loop perform t_call(i, format('hg_plat_rejoindre(%L)', v_code)); perform t_call(i, format('hg_plat_pret(%L, true)', v_code)); end loop;
  perform t_call(1, format('hg_plat_lancer(%L)', v_code));
  return v_code;
end $$;
create or replace function t_etat(u uuid, p_code text) returns jsonb language plpgsql as $$
begin return t_callu(u, format('hg_plat_etat(%L)', p_code)); end $$;
-- Expire le chrono et fait jouer le jeu (comme le tick).
create or replace function t_expirer(p_code text) returns void language plpgsql as $$
begin update hg_plat_parties set tour_fin = now() - interval '1 second' where id = t_pid(p_code); perform hg_plat__echeances(t_pid(p_code)); end $$;
