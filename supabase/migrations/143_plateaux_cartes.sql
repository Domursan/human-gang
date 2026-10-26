-- ===== Humane Gang — migration 143 : Blackjack et Poker (Texas Hold'em) sur le moteur des jeux de plateau, en développement =====
-- Branchés sur le socle de la migration 125 (hg_plat__<jeu>_options / _lancer / _agir / _auto / _vue) ; pages « blackjack »
-- et « poker » en mode admin (seuls les admins y accèdent pendant le développement). Robots possibles (migration 131).
-- Jetons propres à la partie (pas de Paillettes en jeu) ; les Paillettes de fin de partie suivent le barème habituel des plateaux.
-- Cartes : 2 caractères, valeur (A 2-9 T J Q K) puis couleur (S pique, H cœur, D carreau, C trèfle) ; ex. 'TH' = 10 de cœur.
--
-- Blackjack (1 à 7 joueurs contre la banque) : options { manches: 5 | 8 | 12, jetons: 1000 }.
--   Phases : mise (chacun à son tour, 10 à 500 jetons), jeu (tirer, rester, doubler, séparer une paire une fois), banque (tire
--   jusqu'à 17, reste sur 17 souple), règlement (blackjack payé 3 pour 2). Sabot de 4 jeux, rebattu sous 60 cartes.
--   Fin après les manches prévues ou quand plus personne n'a de jetons : classement aux jetons.
-- Poker Texas Hold'em (2 à 8 joueurs) : options { jetons: 1000, blinde: 10, montee: 8 (mains entre deux doublements des blindes) }.
--   Actions : se_coucher, suivre (ou parole), relancer { montant : mise totale visée }, tapis. Pots secondaires gérés.
--   Un joueur sans jetons est éliminé ; le dernier qui en a gagne (classement par ordre d'élimination).

-- ---------------------------------------------------------------------
-- 1. Raccordement au socle
-- ---------------------------------------------------------------------
alter table public.hg_plat_parties drop constraint if exists hg_plat_parties_jeu_check;
alter table public.hg_plat_parties add constraint hg_plat_parties_jeu_check
  check (jeu in ('cluedo', 'shadow', 'destins', 'monopoly', 'risk', 'blackjack', 'poker', 'catan', 'pictionary'));
alter table public.hg_plat_parties drop constraint if exists hg_plat_parties_code_check;
alter table public.hg_plat_parties add constraint hg_plat_parties_code_check check (code ~ '^HG(CLU|SHH|DES|MON|RSK|BJK|POK|CAT|PIC)-[0-9]{4}$');

insert into public.hg_pages(slug, label, mode, in_nav, sort) values
  ('blackjack', 'Blackjack', 'admin', false, 25), ('poker', 'Poker', 'admin', false, 26),
  ('catan', 'Catan du gang', 'admin', false, 27), ('pictionary', 'Pictionary', 'admin', false, 28)
on conflict (slug) do nothing;

update public.hg_settings set value = jsonb_set(value, '{paillettes}', coalesce(value->'paillettes', '{}'::jsonb)
  || jsonb_build_object('blackjack', jsonb_build_object('partie', 20, 'victoire', 60), 'poker', jsonb_build_object('partie', 30, 'victoire', 100),
     'catan', jsonb_build_object('partie', 40, 'victoire', 120), 'pictionary', jsonb_build_object('partie', 20, 'victoire', 60)))
  where key = 'plateaux' and not (value->'paillettes' ? 'poker');

select public.hg__patch('public.hg_plat__prefixe(text)'::regprocedure,
  $o$when 'monopoly' then 'HGMON-'$o$,
  $n$when 'monopoly' then 'HGMON-' when 'blackjack' then 'HGBJK-' when 'poker' then 'HGPOK-' when 'catan' then 'HGCAT-' when 'pictionary' then 'HGPIC-'$n$);
select public.hg__patch('public.hg_plat__jeu_nom(text)'::regprocedure,
  $o$when 'monopoly' then 'Monopoly'$o$,
  $n$when 'monopoly' then 'Monopoly' when 'blackjack' then 'Blackjack' when 'poker' then 'Poker' when 'catan' then 'Catan du gang' when 'pictionary' then 'Pictionary'$n$);
select public.hg__patch('public.hg_plat__limites(text)'::regprocedure,
  $o$select case p_jeu when 'cluedo' then 3 when 'shadow' then 4 else 2 end,$o$,
  $n$select case p_jeu when 'cluedo' then 3 when 'shadow' then 4 when 'blackjack' then 1 when 'catan' then 2 when 'pictionary' then 2 else 2 end,$n$);
select public.hg__patch('public.hg_plat__limites(text)'::regprocedure,
  $o$case p_jeu when 'cluedo' then 6 when 'shadow' then 8$o$,
  $n$case p_jeu when 'cluedo' then 6 when 'shadow' then 8 when 'blackjack' then 7 when 'poker' then 8 when 'catan' then 4 when 'pictionary' then 10$n$);
select public.hg__patch('public.hg_plat_creer(jsonb)'::regprocedure,
  $o$if v_jeu is null or v_jeu not in ('cluedo', 'shadow', 'destins', 'monopoly', 'risk') then raise exception 'Jeu inconnu.'; end if;$o$,
  $n$if v_jeu is null or v_jeu not in ('cluedo', 'shadow', 'destins', 'monopoly', 'risk', 'blackjack', 'poker', 'catan', 'pictionary') then raise exception 'Jeu inconnu.'; end if;
  if v_jeu in ('blackjack', 'poker', 'catan', 'pictionary') and not hg_nj_acces() then raise exception 'Jeu en développement : réservé aux admins pour l''instant.'; end if;$n$);

-- ---------------------------------------------------------------------
-- 2. Cartes
-- ---------------------------------------------------------------------
-- Paquet(s) mélangé(s) de n jeux de 52 cartes.
create or replace function public.hg_cartes__paquet(n int)
returns text[] language sql volatile set search_path = public as $$
  select array_agg(v || s order by random()) from generate_series(1, n) k,
    unnest(array['A','2','3','4','5','6','7','8','9','T','J','Q','K']) v, unnest(array['S','H','D','C']) s $$;

-- Rang d'une carte (2 à 14, as = 14).
create or replace function public.hg_cartes__rang(c text)
returns int language sql immutable as $$
  select case left(c, 1) when 'A' then 14 when 'K' then 13 when 'Q' then 12 when 'J' then 11 when 'T' then 10 else left(c, 1)::int end $$;

-- Nom d'une carte en français (journal).
create or replace function public.hg_cartes__nom(c text)
returns text language sql immutable as $$
  select (case left(c, 1) when 'A' then 'As' when 'K' then 'Roi' when 'Q' then 'Dame' when 'J' then 'Valet' when 'T' then '10' else left(c, 1) end)
    || (case right(c, 1) when 'S' then ' ♠' when 'H' then ' ♥' when 'D' then ' ♦' else ' ♣' end) $$;

-- ---------------------------------------------------------------------
-- 3. Blackjack
-- ---------------------------------------------------------------------
-- Total d'une main (as = 1 ou 11) et main « souple » (un as compté 11).
create or replace function public.hg_bj__total(cartes jsonb, out total int, out souple boolean)
language plpgsql immutable set search_path = public as $$
declare c text; as_ int := 0;
begin
  total := 0;
  for c in select jsonb_array_elements_text(coalesce(cartes, '[]'::jsonb)) loop
    if left(c, 1) = 'A' then as_ := as_ + 1; total := total + 11;
    elsif left(c, 1) in ('T', 'J', 'Q', 'K') then total := total + 10;
    else total := total + left(c, 1)::int; end if;
  end loop;
  while total > 21 and as_ > 0 loop total := total - 10; as_ := as_ - 1; end loop;
  souple := as_ > 0;
end $$;

create or replace function public.hg_plat__blackjack_options(p jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object('manches', case when (p->>'manches') in ('5', '8', '12') then (p->>'manches')::int else 8 end, 'jetons', 1000) $$;

-- Tire une carte du sabot (rebattu si besoin).
create or replace function public.hg_bj__tirer(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare e jsonb; s jsonb; c text;
begin
  select etat into e from hg_plat_parties where id = p_id for update;
  s := coalesce(e->'sabot', '[]'::jsonb);
  if jsonb_array_length(s) < 1 then s := to_jsonb(hg_cartes__paquet(4)); end if;
  c := s->>0;
  update hg_plat_parties set etat = jsonb_set(etat, '{sabot}', s - 0) where id = p_id;
  return c;
end $$;

-- Joueur suivant qui doit miser (après p_apres, dans l'ordre des places), ou null.
create or replace function public.hg_bj__prochain_miseur(p_id uuid, p_apres int)
returns uuid language sql stable security definer set search_path = public as $$
  select user_id from hg_plat_joueurs where partie = p_id and not elimine and place > p_apres
    and coalesce((etat->>'mise')::int, 0) = 0 order by place limit 1 $$;

-- Prochaine main à jouer : { joueur, main } ou null.
create or replace function public.hg_bj__prochaine_main(p_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('joueur', j.user_id, 'main', m.i - 1) from hg_plat_joueurs j,
    jsonb_array_elements(coalesce(j.etat->'mains', '[]'::jsonb)) with ordinality m(v, i)
  where j.partie = p_id and not j.elimine and m.v->>'statut' = 'joue' order by j.place, m.i limit 1 $$;

create or replace function public.hg_bj__nouvelle_manche(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; premier uuid; s jsonb;
begin
  select * into p from hg_plat_parties where id = p_id for update;
  s := coalesce(p.etat->'sabot', '[]'::jsonb);
  if jsonb_array_length(s) < 60 then
    s := to_jsonb(hg_cartes__paquet(4));
    perform hg_plat__log(p_id, null, 'info', 'Le croupier rebat le sabot.');
  end if;
  update hg_plat_joueurs set etat = etat || jsonb_build_object('mise', 0, 'mains', '[]'::jsonb, 'resultat', null),
    elimine = coalesce((etat->>'jetons')::int, 0) < 10 where partie = p_id;
  update hg_plat_parties set nb_tours = coalesce(nb_tours, 0) + 1,
    etat = etat || jsonb_build_object('phase', 'mise', 'banque', '[]'::jsonb, 'sabot', s, 'actif', null) where id = p_id;
  premier := hg_bj__prochain_miseur(p_id, 0);
  if premier is null then perform hg_bj__fin(p_id); return; end if;
  perform hg_plat__log(p_id, null, 'info', 'Manche ' || (p.nb_tours + 1) || ' : faites vos jeux !');
  update hg_plat_parties set etat = jsonb_set(etat, '{actif}', to_jsonb(premier)) where id = p_id;
  perform hg_plat__donner_tour(p_id, premier);
end $$;

create or replace function public.hg_plat__blackjack_lancer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_j int;
begin
  select coalesce((options->>'jetons')::int, 1000) into v_j from hg_plat_parties where id = p_id;
  update hg_plat_joueurs set etat = jsonb_build_object('jetons', v_j, 'mise', 0, 'mains', '[]'::jsonb) where partie = p_id;
  update hg_plat_parties set nb_tours = 0, etat = jsonb_build_object('phase', 'mise', 'sabot', to_jsonb(hg_cartes__paquet(4)), 'banque', '[]'::jsonb) where id = p_id;
  perform hg_plat__log(p_id, null, 'info', 'Chacun reçoit ' || v_j || ' jetons. La banque ouvre la table.');
  perform hg_bj__nouvelle_manche(p_id);
end $$;

-- Distribution : deux cartes à chacun, deux à la banque (une cachée) ; blackjack de la banque réglé tout de suite.
create or replace function public.hg_bj__distribuer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record; c1 text; c2 text; b1 text; b2 text; t record; nxt jsonb;
begin
  for r in select user_id, etat from hg_plat_joueurs where partie = p_id and not elimine and coalesce((etat->>'mise')::int, 0) > 0 order by place loop
    c1 := hg_bj__tirer(p_id); c2 := hg_bj__tirer(p_id);
    t := hg_bj__total(jsonb_build_array(c1, c2));
    update hg_plat_joueurs set etat = jsonb_set(etat, '{mains}', jsonb_build_array(jsonb_build_object('cartes', jsonb_build_array(c1, c2),
      'mise', (r.etat->>'mise')::int, 'statut', case when t.total = 21 then 'blackjack' else 'joue' end))) where partie = p_id and user_id = r.user_id;
  end loop;
  b1 := hg_bj__tirer(p_id); b2 := hg_bj__tirer(p_id);
  update hg_plat_parties set etat = etat || jsonb_build_object('banque', jsonb_build_array(b1, b2), 'phase', 'jeu') where id = p_id;
  perform hg_plat__log(p_id, null, 'info', 'La banque montre ' || hg_cartes__nom(b1) || '.');
  if (hg_bj__total(jsonb_build_array(b1, b2))).total = 21 then
    perform hg_plat__log(p_id, null, 'info', 'Blackjack de la banque !');
    update hg_plat_joueurs set etat = jsonb_set(etat, '{mains}', (select coalesce(jsonb_agg(case when m->>'statut' = 'joue' then m || '{"statut": "reste"}'::jsonb else m end), '[]'::jsonb)
      from jsonb_array_elements(etat->'mains') m)) where partie = p_id and jsonb_array_length(coalesce(etat->'mains', '[]'::jsonb)) > 0;
    perform hg_bj__regler(p_id); return;
  end if;
  nxt := hg_bj__prochaine_main(p_id);
  if nxt is null then perform hg_bj__banque(p_id); return; end if;
  update hg_plat_parties set etat = etat || jsonb_build_object('actif', nxt->'joueur', 'main', (nxt->>'main')::int) where id = p_id;
  perform hg_plat__donner_tour(p_id, (nxt->>'joueur')::uuid);
end $$;

-- La banque joue (tire jusqu'à 17, reste sur 17 souple), puis règlement.
create or replace function public.hg_bj__banque(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b jsonb; t record; c text; n int := 0;
begin
  select etat->'banque' into b from hg_plat_parties where id = p_id;
  -- Inutile de tirer si toutes les mains ont sauté.
  if exists (select 1 from hg_plat_joueurs j, jsonb_array_elements(coalesce(j.etat->'mains', '[]'::jsonb)) m
             where j.partie = p_id and m->>'statut' in ('reste', 'double')) then
    loop
      t := hg_bj__total(b);
      exit when t.total >= 17 or n > 10;
      c := hg_bj__tirer(p_id); b := b || to_jsonb(c); n := n + 1;
    end loop;
  end if;
  update hg_plat_parties set etat = etat || jsonb_build_object('banque', b, 'phase', 'banque') where id = p_id;
  t := hg_bj__total(b);
  perform hg_plat__log(p_id, null, 'info', 'La banque a ' || t.total || case when t.total > 21 then ' : elle saute !' else '.' end);
  perform hg_bj__regler(p_id);
end $$;

-- Règlement des mains, puis manche suivante (ou fin).
create or replace function public.hg_bj__regler(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare b jsonb; tb record; r record; m jsonb; tm record; gain int; total int; txt text; bjb boolean;
begin
  select etat->'banque' into b from hg_plat_parties where id = p_id;
  tb := hg_bj__total(b); bjb := tb.total = 21 and jsonb_array_length(b) = 2;
  for r in select user_id, etat from hg_plat_joueurs where partie = p_id and jsonb_array_length(coalesce(etat->'mains', '[]'::jsonb)) > 0 loop
    total := 0;
    for m in select * from jsonb_array_elements(r.etat->'mains') loop
      tm := hg_bj__total(m->'cartes');
      gain := case
        when m->>'statut' = 'saute' then -(m->>'mise')::int
        when m->>'statut' = 'blackjack' and not bjb then ((m->>'mise')::int * 3) / 2
        when m->>'statut' = 'blackjack' and bjb then 0
        when bjb then -(m->>'mise')::int
        when tb.total > 21 or tm.total > tb.total then (m->>'mise')::int
        when tm.total = tb.total then 0
        else -(m->>'mise')::int end;
      total := total + gain;
    end loop;
    update hg_plat_joueurs set etat = etat || jsonb_build_object('jetons', greatest(0, (etat->>'jetons')::int + total), 'resultat', total)
      where partie = p_id and user_id = r.user_id;
    txt := hg_plat__nom(p_id, r.user_id) || case when total > 0 then ' gagne ' || total when total < 0 then ' perd ' || (-total) else ' récupère sa mise' end
      || case when total <> 0 then ' jetons.' else '.' end;
    perform hg_plat__log(p_id, r.user_id, 'info', txt);
  end loop;
  update hg_plat_parties set etat = etat || jsonb_build_object('phase', 'reglement', 'actif', null) where id = p_id;
  if (select nb_tours >= coalesce((options->>'manches')::int, 8) from hg_plat_parties where id = p_id)
     or not exists (select 1 from hg_plat_joueurs where partie = p_id and coalesce((etat->>'jetons')::int, 0) >= 10) then
    perform hg_bj__fin(p_id);
  else
    perform hg_bj__nouvelle_manche(p_id);
  end if;
end $$;

create or replace function public.hg_bj__fin(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_max int; v_g uuid[];
begin
  select max((etat->>'jetons')::int) into v_max from hg_plat_joueurs where partie = p_id;
  select array_agg(user_id) into v_g from hg_plat_joueurs where partie = p_id and (etat->>'jetons')::int = v_max and v_max > 0;
  update hg_plat_joueurs j set etat = j.etat || jsonb_build_object('rang', (select count(*) + 1 from hg_plat_joueurs k
    where k.partie = p_id and (k.etat->>'jetons')::int > (j.etat->>'jetons')::int)) where j.partie = p_id;
  perform hg_plat__log(p_id, null, 'info', 'Fin de la partie : ' || coalesce((select string_agg(pseudo, ', ') from hg_plat_joueurs where partie = p_id and user_id = any (v_g)), 'personne')
    || ' termine avec le plus de jetons (' || coalesce(v_max, 0) || ').');
  perform hg_plat__terminer(p_id, v_g, 'jetons');
end $$;

create or replace function public.hg_plat__blackjack_agir(p_id uuid, p_u uuid, p_action text, a jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; j hg_plat_joueurs; v int; nxt uuid; k int; m jsonb; c text; t record; nm jsonb; mains jsonb;
begin
  select * into p from hg_plat_parties where id = p_id for update;
  select * into j from hg_plat_joueurs where partie = p_id and user_id = p_u for update;
  if p.tour is distinct from p_u then raise exception 'Ce n''est pas ton tour.'; end if;
  if p.etat->>'phase' = 'mise' then
    if p_action <> 'miser' then raise exception 'C''est le moment de miser.'; end if;
    v := coalesce((a->>'montant')::int, 0);
    if v < 10 or v > least(500, (j.etat->>'jetons')::int) then raise exception 'Mise entre 10 et % jetons.', least(500, (j.etat->>'jetons')::int); end if;
    update hg_plat_joueurs set etat = etat || jsonb_build_object('mise', v) where partie = p_id and user_id = p_u;
    perform hg_plat__log(p_id, p_u, 'coup', hg_plat__nom(p_id, p_u) || ' mise ' || v || ' jetons.');
    nxt := hg_bj__prochain_miseur(p_id, j.place);
    if nxt is null then perform hg_bj__distribuer(p_id);
    else
      update hg_plat_parties set etat = jsonb_set(etat, '{actif}', to_jsonb(nxt)) where id = p_id;
      perform hg_plat__donner_tour(p_id, nxt);
    end if;
    return '{}'::jsonb;
  end if;
  if p.etat->>'phase' <> 'jeu' then raise exception 'Attends la prochaine manche.'; end if;
  k := coalesce((p.etat->>'main')::int, 0);
  mains := j.etat->'mains'; m := mains->k;
  if m is null or m->>'statut' <> 'joue' then raise exception 'Cette main est terminée.'; end if;
  if p_action = 'tirer' then
    c := hg_bj__tirer(p_id); m := jsonb_set(m, '{cartes}', (m->'cartes') || to_jsonb(c));
    t := hg_bj__total(m->'cartes');
    if t.total > 21 then m := jsonb_set(m, '{statut}', '"saute"'); elsif t.total = 21 then m := jsonb_set(m, '{statut}', '"reste"'); end if;
    perform hg_plat__log(p_id, p_u, 'coup', hg_plat__nom(p_id, p_u) || ' tire ' || hg_cartes__nom(c) || ' (' || t.total || case when t.total > 21 then ', saute' else '' end || ').');
  elsif p_action = 'rester' then
    m := jsonb_set(m, '{statut}', '"reste"');
    perform hg_plat__log(p_id, p_u, 'coup', hg_plat__nom(p_id, p_u) || ' reste à ' || (hg_bj__total(m->'cartes')).total || '.');
  elsif p_action = 'doubler' then
    if jsonb_array_length(m->'cartes') <> 2 then raise exception 'On ne double qu''avec deux cartes.'; end if;
    if (j.etat->>'jetons')::int < (select sum((x->>'mise')::int) from jsonb_array_elements(mains) x) + (m->>'mise')::int then raise exception 'Pas assez de jetons pour doubler.'; end if;
    c := hg_bj__tirer(p_id);
    m := m || jsonb_build_object('cartes', (m->'cartes') || to_jsonb(c), 'mise', (m->>'mise')::int * 2);
    t := hg_bj__total(m->'cartes');
    m := jsonb_set(m, '{statut}', case when t.total > 21 then '"saute"'::jsonb else '"double"'::jsonb end);
    perform hg_plat__log(p_id, p_u, 'coup', hg_plat__nom(p_id, p_u) || ' double et tire ' || hg_cartes__nom(c) || ' (' || t.total || ').');
  elsif p_action = 'separer' then
    if jsonb_array_length(mains) > 1 or jsonb_array_length(m->'cartes') <> 2
       or least(hg_cartes__rang(m->'cartes'->>0), 10) <> least(hg_cartes__rang(m->'cartes'->>1), 10) then raise exception 'On ne sépare qu''une paire, une seule fois.'; end if;
    if (j.etat->>'jetons')::int < (m->>'mise')::int * 2 then raise exception 'Pas assez de jetons pour séparer.'; end if;
    nm := jsonb_build_object('cartes', jsonb_build_array(m->'cartes'->1, hg_bj__tirer(p_id)), 'mise', (m->>'mise')::int, 'statut', 'joue');
    m := m || jsonb_build_object('cartes', jsonb_build_array(m->'cartes'->0, hg_bj__tirer(p_id)));
    mains := jsonb_build_array(m, nm);
    update hg_plat_joueurs set etat = jsonb_set(etat, '{mains}', mains) where partie = p_id and user_id = p_u;
    perform hg_plat__log(p_id, p_u, 'coup', hg_plat__nom(p_id, p_u) || ' sépare sa paire.');
    perform hg_plat__donner_tour(p_id, p_u);
    return '{}'::jsonb;
  else
    raise exception 'Action inconnue.';
  end if;
  update hg_plat_joueurs set etat = jsonb_set(etat, array['mains', k::text], m) where partie = p_id and user_id = p_u;
  if m->>'statut' = 'joue' then perform hg_plat__donner_tour(p_id, p_u); return '{}'::jsonb; end if;
  nm := hg_bj__prochaine_main(p_id);
  if nm is null then perform hg_bj__banque(p_id);
  else
    update hg_plat_parties set etat = etat || jsonb_build_object('actif', nm->'joueur', 'main', (nm->>'main')::int) where id = p_id;
    perform hg_plat__donner_tour(p_id, (nm->>'joueur')::uuid);
  end if;
  return '{}'::jsonb;
end $$;

-- Absent ou robot : mise de 50 (ou 10), stratégie de base simplifiée.
create or replace function public.hg_plat__blackjack_auto(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; j hg_plat_joueurs; m jsonb; t record; b int; act text;
begin
  select * into p from hg_plat_parties where id = p_id;
  if p.tour is null then return false; end if;
  select * into j from hg_plat_joueurs where partie = p_id and user_id = p.tour;
  if p.etat->>'phase' = 'mise' then
    perform hg_plat__blackjack_agir(p_id, p.tour, 'miser', jsonb_build_object('montant', least(case when j.invite then 50 else 10 end, (j.etat->>'jetons')::int)));
    return true;
  end if;
  if p.etat->>'phase' <> 'jeu' then return false; end if;
  m := j.etat->'mains'->coalesce((p.etat->>'main')::int, 0);
  t := hg_bj__total(m->'cartes');
  b := least(hg_cartes__rang(p.etat->'banque'->>0), 10); if b = 14 then b := 11; end if;
  act := case
    when jsonb_array_length(m->'cartes') = 2 and t.total in (10, 11) and not t.souple and b < 10 and (j.etat->>'jetons')::int >= (m->>'mise')::int * 2 then 'doubler'
    when t.souple and t.total <= 17 then 'tirer'
    when t.total <= 11 then 'tirer'
    when t.total <= 16 and b >= 7 then 'tirer'
    when t.total = 12 and b <= 3 then 'tirer'
    else 'rester' end;
  perform hg_plat__blackjack_agir(p_id, p.tour, act, '{}');
  return true;
end $$;

create or replace function public.hg_plat__blackjack_vue(p_id uuid, p_moi uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e jsonb; cachee boolean;
begin
  select etat into e from hg_plat_parties where id = p_id;
  cachee := e->>'phase' in ('mise', 'jeu');
  return jsonb_build_object('phase', e->>'phase', 'actif', e->'actif', 'main', e->'main',
    'manche', (select nb_tours from hg_plat_parties where id = p_id), 'manches', (select coalesce((options->>'manches')::int, 8) from hg_plat_parties where id = p_id),
    'banque', case when cachee and jsonb_array_length(coalesce(e->'banque', '[]'::jsonb)) >= 2 then jsonb_build_array(e->'banque'->0, '??') else coalesce(e->'banque', '[]'::jsonb) end,
    'banque_total', case when cachee then null else (hg_bj__total(e->'banque')).total end,
    'sabot', jsonb_array_length(coalesce(e->'sabot', '[]'::jsonb)),
    'totaux', (select coalesce(jsonb_object_agg(j.user_id, (select coalesce(jsonb_agg((hg_bj__total(m->'cartes')).total), '[]'::jsonb)
        from jsonb_array_elements(coalesce(j.etat->'mains', '[]'::jsonb)) m)), '{}'::jsonb) from hg_plat_joueurs j where j.partie = p_id));
end $$;

-- ---------------------------------------------------------------------
-- 4. Poker Texas Hold'em
-- ---------------------------------------------------------------------
-- Valeur d'une main de 5 cartes : catégorie (0 hauteur … 8 quinte flush) puis départages, en un seul nombre comparable.
create or replace function public.hg_pk__eval5(c text[])
returns bigint language plpgsql immutable set search_path = public as $$
declare r int[]; f boolean; s boolean; haut int; grp int[]; cnt int[]; cat int; ordre int[]; v bigint := 0; i int;
begin
  select array_agg(hg_cartes__rang(x) order by hg_cartes__rang(x) desc) into r from unnest(c) x;
  f := (select count(distinct right(x, 1)) from unnest(c) x) = 1;
  s := (select count(distinct y) from unnest(r) y) = 5 and (r[1] - r[5] = 4 or r = array[14, 5, 4, 3, 2]);
  haut := case when r = array[14, 5, 4, 3, 2] then 5 else r[1] end;
  -- groupes : (nombre, rang) triés par nombre puis rang
  select array_agg(rg order by n desc, rg desc), array_agg(n order by n desc, rg desc) into grp, cnt
    from (select y as rg, count(*) n from unnest(r) y group by y) z;
  cat := case when s and f then 8 when cnt[1] = 4 then 7 when cnt[1] = 3 and cnt[2] = 2 then 6 when f then 5 when s then 4
              when cnt[1] = 3 then 3 when cnt[1] = 2 and cnt[2] = 2 then 2 when cnt[1] = 2 then 1 else 0 end;
  ordre := case when cat in (8, 4) then array[haut] when cat in (5, 0) then r else grp end;
  v := cat;
  for i in 1..5 loop v := v * 15 + coalesce(ordre[i], 0); end loop;
  return v;
end $$;

-- Meilleure main de 5 parmi 7 (ou moins) cartes.
create or replace function public.hg_pk__eval(c text[])
returns bigint language sql immutable set search_path = public as $$
  select max(public.hg_pk__eval5(array[c[a], c[b], c[d], c[e], c[f]]))
  from generate_series(1, cardinality(c)) a, generate_series(1, cardinality(c)) b, generate_series(1, cardinality(c)) d,
       generate_series(1, cardinality(c)) e, generate_series(1, cardinality(c)) f
  where a < b and b < d and d < e and e < f $$;

create or replace function public.hg_pk__categorie(v bigint)
returns text language sql immutable as $$
  select (array['Hauteur', 'Paire', 'Double paire', 'Brelan', 'Quinte', 'Couleur', 'Full', 'Carré', 'Quinte flush'])[(v / 759375)::int + 1] $$;

create or replace function public.hg_plat__poker_options(p jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object('jetons', case when (p->>'jetons') in ('500', '1000', '2000') then (p->>'jetons')::int else 1000 end,
    'blinde', 10, 'montee', case when (p->>'montee') in ('5', '8', '12') then (p->>'montee')::int else 8 end) $$;

-- Joueurs encore dans la main (pas couchés, pas éliminés), dans l'ordre des places à partir de la place p_apres.
create or replace function public.hg_pk__suivant(p_id uuid, p_apres int, p_capables boolean)
returns uuid language sql stable security definer set search_path = public as $$
  with j as (select user_id, place from hg_plat_joueurs where partie = p_id and not elimine and not coalesce((etat->>'couche')::boolean, false)
    and (not p_capables or not coalesce((etat->>'tapis')::boolean, false)))
  select coalesce((select user_id from j where place > p_apres order by place limit 1), (select user_id from j order by place limit 1)) $$;

create or replace function public.hg_pk__nouvelle_main(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; vivants int; deck text[]; r record; k int := 1; donneur int; pb uuid; gb uuid; b int; sb int; pl_d int;
begin
  select * into p from hg_plat_parties where id = p_id for update;
  update hg_plat_joueurs set elimine = true, etat = etat || jsonb_build_object('rang', (select count(*) from hg_plat_joueurs k2 where k2.partie = p_id and not k2.elimine))
    where partie = p_id and not elimine and coalesce((etat->>'jetons')::int, 0) <= 0;
  select count(*) into vivants from hg_plat_joueurs where partie = p_id and not elimine;
  if vivants <= 1 then perform hg_pk__fin(p_id); return; end if;
  b := coalesce((p.options->>'blinde')::int, 10) * power(2, coalesce(p.nb_tours, 0) / greatest(1, coalesce((p.options->>'montee')::int, 8)))::int;
  sb := b / 2;
  deck := hg_cartes__paquet(1);
  update hg_plat_joueurs set prive = jsonb_build_object('cartes', '[]'::jsonb),
    etat = etat || jsonb_build_object('mise', 0, 'engage', 0, 'couche', elimine, 'tapis', false, 'action', null, 'montre', null) where partie = p_id;
  for r in select user_id from hg_plat_joueurs where partie = p_id and not elimine order by place loop
    update hg_plat_joueurs set prive = jsonb_build_object('cartes', jsonb_build_array(deck[k], deck[k + 1])) where partie = p_id and user_id = r.user_id;
    k := k + 2;
  end loop;
  -- Donneur : avance d'une place à chaque main.
  pl_d := coalesce((select place from hg_plat_joueurs where partie = p_id and user_id = (p.etat->>'donneur')::uuid), 0);
  donneur := (select place from hg_plat_joueurs where partie = p_id and user_id = hg_pk__suivant(p_id, pl_d, false));
  if vivants = 2 then
    pb := (select user_id from hg_plat_joueurs where partie = p_id and place = donneur);  -- à deux : le donneur paie la petite blinde
  else
    pb := hg_pk__suivant(p_id, donneur, false);
  end if;
  gb := hg_pk__suivant(p_id, (select place from hg_plat_joueurs where partie = p_id and user_id = pb), false);
  update hg_plat_parties set nb_tours = coalesce(nb_tours, 0) + 1, etat = jsonb_build_object('phase', 'preflop',
    'precedente', case when p.etat ? 'board' then jsonb_build_object('board', p.etat->'board', 'abattage', p.etat->'abattage') end,
    'donneur', (select user_id from hg_plat_joueurs where partie = p_id and place = donneur), 'deck', to_jsonb(deck[k:]), 'board', '[]'::jsonb,
    'mise_max', 0, 'relance_min', b, 'blinde', b, 'a_parle', '[]'::jsonb, 'abattage', null, 'pots', null) where id = p_id;
  perform hg_plat__log(p_id, null, 'info', 'Main ' || (coalesce(p.nb_tours, 0) + 1) || ' · blindes ' || sb || ' / ' || b || '.');
  perform hg_pk__payer(p_id, pb, sb, 'petite blinde');
  perform hg_pk__payer(p_id, gb, b, 'grosse blinde');
  update hg_plat_parties set etat = etat || jsonb_build_object('mise_max', b, 'grosse', gb) where id = p_id;
  perform hg_pk__donner(p_id, hg_pk__suivant(p_id, (select place from hg_plat_joueurs where partie = p_id and user_id = gb), true));
end $$;

-- Met des jetons au pot (plafonné au tapis).
create or replace function public.hg_pk__payer(p_id uuid, p_u uuid, n int, p_quoi text)
returns int language plpgsql security definer set search_path = public as $$
declare j hg_plat_joueurs; v int;
begin
  select * into j from hg_plat_joueurs where partie = p_id and user_id = p_u for update;
  v := least(n, (j.etat->>'jetons')::int);
  update hg_plat_joueurs set etat = etat || jsonb_build_object('jetons', (etat->>'jetons')::int - v, 'mise', coalesce((etat->>'mise')::int, 0) + v,
    'engage', coalesce((etat->>'engage')::int, 0) + v, 'tapis', (etat->>'jetons')::int - v = 0) where partie = p_id and user_id = p_u;
  if p_quoi is not null then perform hg_plat__log(p_id, p_u, 'coup', hg_plat__nom(p_id, p_u) || ' paie la ' || p_quoi || ' (' || v || ').'); end if;
  return v;
end $$;

-- Donne la parole (ou passe à la suite si personne ne peut plus parler).
create or replace function public.hg_pk__donner(p_id uuid, p_u uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_u is null then perform hg_pk__fin_tour(p_id); return; end if;
  update hg_plat_parties set etat = jsonb_set(etat, '{actif}', to_jsonb(p_u)) where id = p_id;
  perform hg_plat__donner_tour(p_id, p_u);
end $$;

-- Le tour d'enchères est-il fini ? (tous ceux qui peuvent parler ont parlé depuis la dernière relance et ont égalisé)
create or replace function public.hg_pk__tour_fini(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from hg_plat_joueurs j, hg_plat_parties p where p.id = p_id and j.partie = p_id and not j.elimine
    and not coalesce((j.etat->>'couche')::boolean, false) and not coalesce((j.etat->>'tapis')::boolean, false)
    and (not (p.etat->'a_parle') ? j.user_id::text or coalesce((j.etat->>'mise')::int, 0) < coalesce((p.etat->>'mise_max')::int, 0))) $$;

-- Fin d'un tour d'enchères : carte(s) suivante(s) ou abattage.
create or replace function public.hg_pk__fin_tour(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; restants int; capables int; ph text; deck jsonb; board jsonb; n int; prem uuid;
begin
  select * into p from hg_plat_parties where id = p_id for update;
  select count(*) into restants from hg_plat_joueurs where partie = p_id and not elimine and not coalesce((etat->>'couche')::boolean, false);
  if restants <= 1 then perform hg_pk__abattage(p_id); return; end if;
  ph := p.etat->>'phase';
  if ph = 'river' then perform hg_pk__abattage(p_id); return; end if;
  n := case ph when 'preflop' then 3 else 1 end;
  deck := p.etat->'deck'; board := p.etat->'board';
  board := board || (select jsonb_agg(x) from (select x from jsonb_array_elements(deck) with ordinality d(x, i) where i <= n order by i) z);
  deck := (select coalesce(jsonb_agg(x order by i), '[]'::jsonb) from jsonb_array_elements(deck) with ordinality d(x, i) where i > n);
  ph := case ph when 'preflop' then 'flop' when 'flop' then 'turn' else 'river' end;
  update hg_plat_joueurs set etat = etat || '{"mise": 0, "action": null}'::jsonb where partie = p_id;
  update hg_plat_parties set etat = etat || jsonb_build_object('phase', ph, 'deck', deck, 'board', board, 'mise_max', 0,
    'relance_min', coalesce((etat->>'blinde')::int, 10), 'a_parle', '[]'::jsonb) where id = p_id;
  perform hg_plat__log(p_id, null, 'info', case ph when 'flop' then 'Flop' when 'turn' then 'Turn' else 'River' end || ' : '
    || (select string_agg(hg_cartes__nom(x), ' ') from jsonb_array_elements_text(board) x) || '.');
  select count(*) into capables from hg_plat_joueurs where partie = p_id and not elimine and not coalesce((etat->>'couche')::boolean, false)
    and not coalesce((etat->>'tapis')::boolean, false);
  if capables <= 1 then perform hg_pk__fin_tour(p_id); return; end if;
  prem := hg_pk__suivant(p_id, (select place from hg_plat_joueurs where partie = p_id and user_id = (p.etat->>'donneur')::uuid), true);
  perform hg_pk__donner(p_id, prem);
end $$;

-- Abattage : pots (principal et secondaires) attribués aux meilleures mains, cartes montrées.
create or replace function public.hg_pk__abattage(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; niveaux int[]; niv int; prec int := 0; idx int; plafond int; pot int; elig uuid[]; best bigint; gagn uuid[]; part int; reste int; u uuid;
  board text[]; abat jsonb := '[]'::jsonb; r record; vals jsonb := '{}'::jsonb; seul boolean; txt text;
begin
  select * into p from hg_plat_parties where id = p_id for update;
  board := array(select jsonb_array_elements_text(coalesce(p.etat->'board', '[]'::jsonb)));
  seul := (select count(*) from hg_plat_joueurs where partie = p_id and not elimine and not coalesce((etat->>'couche')::boolean, false)) = 1;
  for r in select user_id, prive from hg_plat_joueurs where partie = p_id and not elimine and not coalesce((etat->>'couche')::boolean, false) loop
    if not seul then
      vals := vals || jsonb_build_object(r.user_id::text, hg_pk__eval(array(select jsonb_array_elements_text(r.prive->'cartes')) || board));
      abat := abat || jsonb_build_object('user_id', r.user_id, 'cartes', r.prive->'cartes',
        'main', hg_pk__categorie((vals->>r.user_id::text)::bigint));
    end if;
  end loop;
  -- Niveaux des pots : mises engagées des joueurs encore en lice ; le dernier niveau ramasse aussi ce que les joueurs couchés ont mis au-delà.
  select array_agg(distinct (etat->>'engage')::int order by (etat->>'engage')::int) into niveaux
    from hg_plat_joueurs where partie = p_id and not elimine and not coalesce((etat->>'couche')::boolean, false) and coalesce((etat->>'engage')::int, 0) > 0;
  for idx in 1..coalesce(cardinality(niveaux), 0) loop
    niv := niveaux[idx];
    plafond := case when idx = cardinality(niveaux) then 1000000000 else niv end;
    select coalesce(sum(least(coalesce((etat->>'engage')::int, 0), plafond) - least(coalesce((etat->>'engage')::int, 0), prec)), 0) into pot
      from hg_plat_joueurs where partie = p_id;
    select array_agg(user_id) into elig from hg_plat_joueurs where partie = p_id and not elimine
      and not coalesce((etat->>'couche')::boolean, false) and coalesce((etat->>'engage')::int, 0) >= niv;
    if pot > 0 and elig is not null then
      if seul then gagn := elig;
      else
        select max((vals->>x::text)::bigint) into best from unnest(elig) x;
        select array_agg(x order by (select place from hg_plat_joueurs where partie = p_id and user_id = x)) into gagn
          from unnest(elig) x where (vals->>x::text)::bigint = best;
      end if;
      part := pot / cardinality(gagn); reste := pot - part * cardinality(gagn);
      foreach u in array gagn loop
        update hg_plat_joueurs set etat = etat || jsonb_build_object('jetons', (etat->>'jetons')::int + part + case when u = gagn[1] then reste else 0 end)
          where partie = p_id and user_id = u;
      end loop;
      txt := (select string_agg(pseudo, ' et ') from hg_plat_joueurs where partie = p_id and user_id = any (gagn)) || ' remporte'
        || case when cardinality(gagn) > 1 then 'nt' else '' end || ' ' || pot || ' jetons'
        || case when not seul then ' (' || hg_pk__categorie(best) || ')' else '' end || '.';
      perform hg_plat__log(p_id, gagn[1], 'info', txt);
    end if;
    prec := niv;
  end loop;
  update hg_plat_parties set etat = etat || jsonb_build_object('phase', 'abattage', 'abattage', abat, 'actif', null) where id = p_id;
  perform hg_pk__nouvelle_main(p_id);
end $$;

create or replace function public.hg_pk__fin(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  select user_id into g from hg_plat_joueurs where partie = p_id and not elimine order by (etat->>'jetons')::int desc limit 1;
  update hg_plat_joueurs set etat = etat || '{"rang": 1}'::jsonb where partie = p_id and user_id = g;
  perform hg_plat__log(p_id, g, 'info', hg_plat__nom(p_id, g) || ' rafle tous les jetons et gagne la partie !');
  perform hg_plat__terminer(p_id, array[g], 'jetons');
end $$;

create or replace function public.hg_plat__poker_lancer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_j int;
begin
  select coalesce((options->>'jetons')::int, 1000) into v_j from hg_plat_parties where id = p_id;
  update hg_plat_joueurs set etat = jsonb_build_object('jetons', v_j, 'mise', 0, 'engage', 0, 'couche', false, 'tapis', false) where partie = p_id;
  update hg_plat_parties set nb_tours = 0, etat = '{}'::jsonb where id = p_id;
  perform hg_plat__log(p_id, null, 'info', 'Chacun reçoit ' || v_j || ' jetons. Que le meilleur bluffeur gagne !');
  perform hg_pk__nouvelle_main(p_id);
end $$;

create or replace function public.hg_plat__poker_agir(p_id uuid, p_u uuid, p_action text, a jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; j hg_plat_joueurs; mm int; ma int; v int; cible int; nom text := hg_plat__nom(p_id, p_u); suiv uuid; restants int;
begin
  select * into p from hg_plat_parties where id = p_id for update;
  if p.tour is distinct from p_u or p.etat->>'actif' is distinct from p_u::text then raise exception 'Ce n''est pas à toi de parler.'; end if;
  select * into j from hg_plat_joueurs where partie = p_id and user_id = p_u for update;
  mm := coalesce((p.etat->>'mise_max')::int, 0); ma := coalesce((j.etat->>'mise')::int, 0);
  if p_action = 'se_coucher' then
    update hg_plat_joueurs set etat = etat || '{"couche": true, "action": "couché"}'::jsonb where partie = p_id and user_id = p_u;
    perform hg_plat__log(p_id, p_u, 'coup', nom || ' se couche.');
  elsif p_action = 'suivre' then
    v := hg_pk__payer(p_id, p_u, mm - ma, null);
    update hg_plat_joueurs set etat = etat || jsonb_build_object('action', case when v = 0 then 'parole' else 'suit' end) where partie = p_id and user_id = p_u;
    perform hg_plat__log(p_id, p_u, 'coup', nom || case when v = 0 then ' passe la parole.' else ' suit (' || v || ').' end);
  elsif p_action in ('relancer', 'tapis') then
    cible := case when p_action = 'tapis' then ma + (j.etat->>'jetons')::int else coalesce((a->>'montant')::int, 0) end;
    if p_action = 'relancer' and (cible < mm + coalesce((p.etat->>'relance_min')::int, 10) or cible > ma + (j.etat->>'jetons')::int) then
      raise exception 'Relance entre % et % jetons.', mm + coalesce((p.etat->>'relance_min')::int, 10), ma + (j.etat->>'jetons')::int;
    end if;
    v := hg_pk__payer(p_id, p_u, cible - ma, null);
    if ma + v > mm then
      update hg_plat_parties set etat = etat || jsonb_build_object('mise_max', ma + v, 'relance_min', greatest(coalesce((etat->>'relance_min')::int, 10), ma + v - mm),
        'a_parle', '[]'::jsonb) where id = p_id;
    end if;
    update hg_plat_joueurs set etat = etat || jsonb_build_object('action', case when p_action = 'tapis' then 'tapis' else 'relance' end) where partie = p_id and user_id = p_u;
    perform hg_plat__log(p_id, p_u, 'coup', nom || case when p_action = 'tapis' then ' fait tapis (' || (ma + v) || ') !' else ' relance à ' || (ma + v) || '.' end);
  else
    raise exception 'Action inconnue.';
  end if;
  update hg_plat_parties set etat = jsonb_set(etat, '{a_parle}', coalesce(etat->'a_parle', '[]'::jsonb) || to_jsonb(p_u::text)) where id = p_id;
  select count(*) into restants from hg_plat_joueurs where partie = p_id and not elimine and not coalesce((etat->>'couche')::boolean, false);
  if restants <= 1 or hg_pk__tour_fini(p_id) then perform hg_pk__fin_tour(p_id); return '{}'::jsonb; end if;
  suiv := hg_pk__suivant(p_id, j.place, true);
  perform hg_pk__donner(p_id, suiv);
  return '{}'::jsonb;
end $$;

-- Absent : parole si possible, sinon se couche. Robot : selon la force de sa main.
create or replace function public.hg_plat__poker_auto(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; j hg_plat_joueurs; mm int; ma int; force bigint; cat int; act text; a jsonb := '{}'; cartes text[]; hautes int;
begin
  select * into p from hg_plat_parties where id = p_id;
  if p.tour is null or p.etat->>'actif' is distinct from p.tour::text then return false; end if;
  select * into j from hg_plat_joueurs where partie = p_id and user_id = p.tour;
  mm := coalesce((p.etat->>'mise_max')::int, 0); ma := coalesce((j.etat->>'mise')::int, 0);
  if not j.invite then
    act := case when mm = ma then 'suivre' else 'se_coucher' end;
  else
    cartes := array(select jsonb_array_elements_text(j.prive->'cartes'));
    if jsonb_array_length(coalesce(p.etat->'board', '[]'::jsonb)) = 0 then
      hautes := hg_cartes__rang(cartes[1]) + hg_cartes__rang(cartes[2]);
      cat := case when left(cartes[1], 1) = left(cartes[2], 1) then 2 when hautes >= 22 then 1 else 0 end;
    else
      force := hg_pk__eval(cartes || array(select jsonb_array_elements_text(p.etat->'board')));
      cat := least(3, (force / 759375)::int);
    end if;
    act := case
      when cat >= 2 and random() < 0.5 and (j.etat->>'jetons')::int > mm - ma + coalesce((p.etat->>'blinde')::int, 10) * 2 then 'relancer'
      when cat >= 1 or mm - ma <= coalesce((p.etat->>'blinde')::int, 10) then 'suivre'
      when mm = ma then 'suivre'
      else 'se_coucher' end;
    if act = 'relancer' then a := jsonb_build_object('montant', mm + greatest(coalesce((p.etat->>'relance_min')::int, 10), coalesce((p.etat->>'blinde')::int, 10) * 2)); end if;
  end if;
  perform hg_plat__poker_agir(p_id, p.tour, act, a);
  return true;
end $$;

create or replace function public.hg_plat__poker_vue(p_id uuid, p_moi uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e jsonb;
begin
  select etat into e from hg_plat_parties where id = p_id;
  return jsonb_build_object('phase', e->>'phase', 'actif', e->'actif', 'donneur', e->'donneur', 'board', coalesce(e->'board', '[]'::jsonb),
    'mise_max', e->'mise_max', 'relance_min', e->'relance_min', 'blinde', e->'blinde', 'main', (select nb_tours from hg_plat_parties where id = p_id),
    'pot', (select coalesce(sum(coalesce((etat->>'engage')::int, 0)), 0) from hg_plat_joueurs where partie = p_id),
    'mes_cartes', (select prive->'cartes' from hg_plat_joueurs where partie = p_id and user_id = p_moi),
    'ma_force', (select hg_pk__categorie(hg_pk__eval(array(select jsonb_array_elements_text(prive->'cartes')) || array(select jsonb_array_elements_text(coalesce(e->'board', '[]'::jsonb)))))
      from hg_plat_joueurs where partie = p_id and user_id = p_moi and jsonb_array_length(coalesce(prive->'cartes', '[]'::jsonb)) = 2
        and jsonb_array_length(coalesce(e->'board', '[]'::jsonb)) >= 3),
    'abattage', e->'abattage', 'precedente', e->'precedente');
end $$;

revoke all on function public.hg_bj__tirer(uuid), public.hg_bj__distribuer(uuid), public.hg_bj__banque(uuid), public.hg_bj__regler(uuid),
  public.hg_bj__fin(uuid), public.hg_bj__nouvelle_manche(uuid), public.hg_pk__nouvelle_main(uuid), public.hg_pk__payer(uuid, uuid, int, text),
  public.hg_pk__donner(uuid, uuid), public.hg_pk__fin_tour(uuid), public.hg_pk__abattage(uuid), public.hg_pk__fin(uuid),
  public.hg_plat__blackjack_agir(uuid, uuid, text, jsonb), public.hg_plat__blackjack_auto(uuid), public.hg_plat__blackjack_lancer(uuid),
  public.hg_plat__poker_agir(uuid, uuid, text, jsonb), public.hg_plat__poker_auto(uuid), public.hg_plat__poker_lancer(uuid)
  from public, anon, authenticated;
