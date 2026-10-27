-- Scénario 6 : mode invité (jeton), sans compte. Partie : hôte 1 + membres 2..4 + 2 invités.
\set ON_ERROR_STOP 1
create or replace function t_anon(p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  execute 'set local role anon';
  execute 'select to_jsonb((' || p_sql || '))' into r;
  execute 'reset role';
  return r;
exception when others then execute 'reset role'; raise;
end $$;
create or replace function t_anon_err(p_sql text) returns text language plpgsql as $$
begin perform t_anon(p_sql); return null; exception when others then return sqlerrm; end $$;

select t_call(1, $$hg_lg_creer('{"nom":"Avec invités","nb_joueurs":6,"invites":true,"composition":{"loup-garou":1,"voyante":1,"villageois":4}}'::jsonb)$$) #>> '{}' as code \gset
select t_ok((t_anon(format('hg_lg_invite(%L, %L)', 'apercu', :'code'))->>'invites')::boolean, 'aperçu visible sans compte');
select t_ok(t_anon_err(format('hg_lg_invite(%L, %L, null, %L::jsonb)', 'rejoindre', :'code', '{"pseudo":"x"}')) like '%pseudo%', 'pseudo trop court refusé');
select t_anon(format('hg_lg_invite(%L, %L, null, %L::jsonb)', 'rejoindre', :'code', '{"pseudo":"Zoé"}'))->>'jeton' as j1 \gset
select t_anon(format('hg_lg_invite(%L, %L, null, %L::jsonb)', 'rejoindre', :'code', '{"pseudo":"Yann"}'))->>'jeton' as j2 \gset
select t_ok(t_anon_err(format('hg_lg_invite(%L, %L, null, %L::jsonb)', 'rejoindre', :'code', '{"pseudo":"zoé"}')) like '%déjà pris%', 'pseudo déjà pris refusé');
select t_ok((select count(*) from hg_lg_joueurs where partie = t_pid(:'code') and invite) = 2, '2 invités inscrits');
select t_ok(t_anon_err(format('hg_lg_invite(%L, %L, %L)', 'etat', :'code', 'faux')) like '%Invitation%', 'jeton faux refusé');
select t_ok(t_anon(format('hg_lg_invite(%L, %L, %L)', 'etat', :'code', :'j1'))->'moi'->>'joueur' = 'true', 'l''invité lit son état');
select t_anon(format('hg_lg_invite(%L, %L, %L, %L::jsonb)', 'pret', :'code', j, '{"pret":true}')) from (values (:'j1'), (:'j2')) v(j);
select t_call(i, format('hg_lg_rejoindre(%L)', :'code')) from generate_series(2, 4) i;
select t_call(i, format('hg_lg_pret(%L, true)', :'code')) from generate_series(2, 4) i;
select t_call(1, format('hg_lg_lancer(%L)', :'code'));
select t_ok(t_phase(:'code') like '%revelation%', 'partie lancée avec des invités');
select t_anon(format('hg_lg_invite(%L, %L, %L)', 'vu', :'code', j)) from (values (:'j1'), (:'j2')) v(j);
select t_call(i, format('hg_lg_vu(%L)', :'code')) from generate_series(1, 4) i;
select t_ok(t_phase(:'code') like '%nuit%', 'nuit après révélation');
-- l'invité ne peut pas créer de partie ni appeler une autre action
select t_ok(t_anon_err(format('hg_lg_invite(%L, %L, %L)', 'creer', :'code', :'j1')) like '%inconnue%', 'action hors liste refusée');
select t_ok(t_anon_err($$hg_lg_creer('{}'::jsonb)$$) is not null, 'un anonyme ne peut pas appeler le moteur directement');
select t_ok(t_anon_err(format('(select count(*) from hg_lg_invites)')) is not null, 'table des jetons illisible');
-- un invité loup ? action via jeton
do $$ declare code text := (select code from hg_lg_parties order by created_at desc limit 1); r record; j text; begin
  for r in select c.user_id, c.role from hg_lg_cartes c where c.partie = t_pid(code) loop null; end loop; end $$;
select t_ok(jsonb_typeof(t_anon(format('hg_lg_invite(%L, %L, %L)', 'messages', :'code', :'j1'))) = 'array', 'messages lisibles par l''invité');
-- fin de partie forcée : pas de Paillettes pour les invités
update hg_lg_parties set statut = 'en_cours' where id = t_pid(:'code');
select hg_lg__terminer(t_pid(:'code'), 'village');
select t_ok(coalesce((select sum(paillettes) from hg_lg_joueurs where partie = t_pid(:'code') and invite), 0) = 0, 'pas de Paillettes pour les invités');
