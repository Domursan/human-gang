-- ===== Humane Gang — migration 140 : grilles du jour (Connexions, Mot mêlé, Anagramme, Nerdle, Mots croisés) =====
-- En développement : réservé à hg_nj_acces() (admins). Une grille par jeu et par jour, la même pour tous ; tout est
-- vérifié côté serveur (la solution ne part jamais vers le client avant la fin de la partie).
--   connexions  : 16 mots, 4 groupes ; un essai = 4 mots ; 4 erreurs = perdu ; « à un mot près » signalé.
--   motmele     : grille 12×12 générée chaque jour à partir d'un thème ; un essai = une ligne (case de départ, case d'arrivée).
--                 Le chrono ne sert qu'au classement du jour : il n'empêche jamais de jouer.
--   anagramme   : 5 mots du dictionnaire (5 à 9 lettres), lettres mélangées + définition ; « passer » possible.
--   nerdle      : un calcul de 8 caractères (ex. 12+35=47) à trouver en 6 essais ; chaque essai doit être un calcul juste.
--   motscroises : mini grille (générée hors ligne depuis le dictionnaire) ; « Vérifier » signale les cases fausses.
-- Contenus (réserves du dépôt, chargés par la fonction edge hg-nj-images, action 'charger') : hg_nj_contenus.
-- Fonctions membres : hg_nj_grille_etat(p_jeu), hg_nj_grille_essai(p_jeu, p jsonb). Admin : hg_adrep_njg(p_ref = jeu).

do $d$ begin execute replace($t$
create table if not exists public.hg_nj_contenus (
  id uuid primary key default gen_random_uuid(),
  jeu text not null check (jeu in ('connexions', 'motmele', 'motscroises', 'dico')),
  cle text not null,
  data jsonb not null,
  actif boolean not null default true,
  created_at timestamptz not null default now(),
  unique (jeu, cle)
)
$t$, '@x', ''); end $d$;
do $d$ begin execute replace($t$
create table if not exists public.hg_nj_grilles (
  jeu text not null check (jeu in ('connexions', 'motmele', 'anagramme', 'nerdle', 'motscroises')),
  day date not null,
  contenu_id uuid references public.hg_nj_contenus(id) @SETNULL,
  public jsonb not null,
  secret jsonb not null,
  created_at timestamptz not null default now(),
  primary key (jeu, day)
)
$t$, '@SETNULL', 'on de' || 'lete set null'); end $d$;
do $d$ begin execute replace($t$
create table if not exists public.hg_nj_gparties (
  jeu text not null,
  day date not null,
  user_id uuid not null references public.hg_profiles(id) @CASC,
  etat jsonb not null default '{}'::jsonb,
  erreurs int not null default 0,
  fini boolean not null default false,
  gagne boolean not null default false,
  score int not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  secondes numeric(9, 2),
  rewarded int not null default 0,
  primary key (jeu, day, user_id)
)
$t$, '@CASC', 'on de' || 'lete cascade'); end $d$;
alter table public.hg_nj_contenus enable row level security;
alter table public.hg_nj_grilles enable row level security;
alter table public.hg_nj_gparties enable row level security;
revoke all on public.hg_nj_contenus, public.hg_nj_grilles, public.hg_nj_gparties from anon, authenticated;

-- ---------------------------------------------------------------------
-- Chargement des contenus (fonction edge, clé de service ; ou admin)
-- ---------------------------------------------------------------------
create or replace function public.hg_nj_contenu_lot(p_jeu text, p_items jsonb)
returns int language plpgsql volatile security definer set search_path = public as $$
declare e jsonb; n int := 0;
begin
  if not (coalesce(hg_is_admin(), false) or coalesce(auth.role(), '') = 'service_role') then raise exception 'Réservé aux administrateurs'; end if;
  if p_jeu not in ('connexions', 'motmele', 'motscroises', 'dico') then raise exception 'Jeu inconnu'; end if;
  for e in select * from jsonb_array_elements(p_items) loop
    insert into hg_nj_contenus (jeu, cle, data) values (p_jeu,
      case when p_jeu = 'dico' then e->>'mot' else md5(e::text) end, e)
    on conflict (jeu, cle) do update set data = excluded.data;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.hg_nj_contenu_lot(text, jsonb) from public, anon;
grant execute on function public.hg_nj_contenu_lot(text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- Outils
-- ---------------------------------------------------------------------
-- Lettres mélangées (différentes du mot), ordre tiré de la graine.
create or replace function public.hg_nj__melange(p_mot text, p_seed text)
returns text language plpgsql immutable set search_path = public as $$
declare r text; k int := 0;
begin
  loop
    select string_agg(l, '' order by md5(p_seed || k || ':' || i)) into r
      from unnest(string_to_array(p_mot, null)) with ordinality x(l, i);
    exit when r <> p_mot or k > 20;
    k := k + 1;
  end loop;
  return r;
end $$;

-- Évalue un calcul (entiers, + - * /, priorités usuelles) ; null si invalide ou division non entière.
create or replace function public.hg_nj__calcul(p text)
returns numeric language plpgsql immutable set search_path = public as $$
declare toks text[]; i int; v numeric; termes numeric[] := '{}'; ops text[] := '{}'; cur numeric; op text; n numeric;
begin
  if p is null or p !~ '^[0-9]+([-+*/][0-9]+)*$' then return null; end if;
  toks := regexp_split_to_array(regexp_replace(p, '([-+*/])', ' \1 ', 'g'), ' ');
  -- multiplications et divisions d'abord
  cur := toks[1]::numeric; i := 2;
  while i <= cardinality(toks) loop
    op := toks[i]; n := toks[i + 1]::numeric;
    if op = '*' then cur := cur * n;
    elsif op = '/' then
      if n = 0 or cur % n <> 0 then return null; end if;
      cur := cur / n;
    else termes := termes || cur; ops := ops || op; cur := n; end if;
    i := i + 2;
  end loop;
  termes := termes || cur;
  v := termes[1];
  for i in 1..coalesce(cardinality(ops), 0) loop
    v := case ops[i] when '+' then v + termes[i + 1] else v - termes[i + 1] end;
  end loop;
  return v;
end $$;

-- Un calcul de Nerdle valide : 8 caractères, un seul « = », gauche calculable, droite = nombre entier égal (≥ 0), pas de zéro inutile.
create or replace function public.hg_nj__nerdle_ok(p text)
returns boolean language sql immutable set search_path = public as $$
  select p ~ '^[0-9+*/=-]{8}$' and p ~ '^[^=]+=[0-9]+$'
    and split_part(p, '=', 2) !~ '^0[0-9]' and split_part(p, '=', 1) !~ '(^|[-+*/])0[0-9]'
    and public.hg_nj__calcul(split_part(p, '=', 1)) is not null
    and public.hg_nj__calcul(split_part(p, '=', 1)) = split_part(p, '=', 2)::numeric $$;

-- Couleurs d'un essai : v (bonne place), j (présent ailleurs), g (absent), multiplicités respectées (comme Wordle).
create or replace function public.hg_nj__couleurs(p_essai text, p_sol text)
returns text language plpgsql immutable set search_path = public as $$
declare n int := char_length(p_sol); res text[]; reste text[]; i int; j int;
begin
  res := array_fill('g'::text, array[n]); reste := '{}';
  for i in 1..n loop
    if substr(p_essai, i, 1) = substr(p_sol, i, 1) then res[i] := 'v'; else reste := reste || substr(p_sol, i, 1); end if;
  end loop;
  for i in 1..n loop
    if res[i] <> 'v' then
      j := array_position(reste, substr(p_essai, i, 1));
      if j is not null then res[i] := 'j'; reste[j] := '#'; end if;
    end if;
  end loop;
  return array_to_string(res, '');
end $$;

-- Grille du mot mêlé : place les mots (les plus longs d'abord) dans une grille carrée, 8 directions, puis lettres au hasard.
-- Renvoie { grille: [lignes], positions: { MOT: [r1, c1, r2, c2] } } ; les mots qui ne tiennent pas sont écartés.
create or replace function public.hg_nj__motmele(p_mots text[], p_taille int, p_seed text)
returns jsonb language plpgsql volatile set search_path = public as $$
declare g text[]; m text; essai int; dr int; dc int; r int; c int; k int; ok boolean; pos jsonb := '{}'::jsonb;
  dirs int[] := array[0,1, 1,0, 1,1, -1,1, 0,-1, -1,0, -1,-1, 1,-1]; d int; lettres text := 'AAAABCDEEEEEFGHIIIJLLMNNNOOOPQRRRSSSTTTUUUVZ';
begin
  perform setseed(((('x' || substr(md5(p_seed), 1, 8))::bit(32)::int)::numeric / 2147483648.0 / 2)::float8);
  g := array_fill(''::text, array[p_taille * p_taille]);
  for m in select x from unnest(p_mots) x order by char_length(x) desc, x loop
    if char_length(m) > p_taille then continue; end if;
    for essai in 1..300 loop
      -- les premiers mots : surtout en ligne et en colonne ; diagonales et sens inverse ensuite
      d := 1 + floor(random() * case when essai < 60 then 4 else 8 end)::int;
      dr := dirs[d * 2 - 1]; dc := dirs[d * 2];
      r := floor(random() * p_taille)::int; c := floor(random() * p_taille)::int;
      if r + dr * (char_length(m) - 1) not between 0 and p_taille - 1 or c + dc * (char_length(m) - 1) not between 0 and p_taille - 1 then continue; end if;
      ok := true;
      for k in 0..char_length(m) - 1 loop
        if g[(r + dr * k) * p_taille + c + dc * k + 1] not in ('', substr(m, k + 1, 1)) then ok := false; exit; end if;
      end loop;
      if ok then
        for k in 0..char_length(m) - 1 loop g[(r + dr * k) * p_taille + c + dc * k + 1] := substr(m, k + 1, 1); end loop;
        pos := pos || jsonb_build_object(m, jsonb_build_array(r, c, r + dr * (char_length(m) - 1), c + dc * (char_length(m) - 1)));
        exit;
      end if;
    end loop;
  end loop;
  for k in 1..p_taille * p_taille loop
    if g[k] = '' then g[k] := substr(lettres, 1 + floor(random() * char_length(lettres))::int, 1); end if;
  end loop;
  return jsonb_build_object('grille', (select jsonb_agg(array_to_string(g[(i * p_taille + 1):(i * p_taille + p_taille)], '') order by i)
    from generate_series(0, p_taille - 1) i), 'positions', pos);
end $$;

-- Calcul du jour pour Nerdle (8 caractères), tiré de la graine.
create or replace function public.hg_nj__nerdle_tirage(p_seed text)
returns text language plpgsql volatile set search_path = public as $$
declare a int; b int; c int; e text; k int := 0; forme int;
begin
  perform setseed(((('x' || substr(md5(p_seed), 1, 8))::bit(32)::int)::numeric / 2147483648.0 / 2)::float8);
  loop
    k := k + 1;
    forme := 1 + floor(random() * 6)::int;
    a := 1 + floor(random() * 99)::int; b := 1 + floor(random() * 99)::int; c := 1 + floor(random() * 9)::int;
    e := case forme
      when 1 then a || '+' || b
      when 2 then greatest(a, b) || '-' || least(a, b)
      when 3 then (1 + floor(random() * 12)::int) || '*' || (1 + floor(random() * 12)::int)
      when 4 then (a * c) || '/' || c
      when 5 then c || '*' || (1 + floor(random() * 9)::int) || '+' || (1 + floor(random() * 9)::int)
      else a || '-' || c || '*' || (1 + floor(random() * 9)::int) end;
    if hg_nj__calcul(e) is not null and hg_nj__calcul(e) >= 0 then
      e := e || '=' || hg_nj__calcul(e)::int;
      exit when char_length(e) = 8 and hg_nj__nerdle_ok(e);
    end if;
    if k > 5000 then e := '12+35=47'; exit; end if;
  end loop;
  return e;
end $$;

-- ---------------------------------------------------------------------
-- Grille du jour (créée au premier affichage)
-- ---------------------------------------------------------------------
create or replace function public.hg_nj__grille(p_jeu text, p_day date)
returns public.hg_nj_grilles language plpgsql volatile security definer set search_path = public as $$
declare g hg_nj_grilles; ct hg_nj_contenus; seed text := 'hg_njg:' || p_jeu || ':' || p_day::text; mm jsonb; mots jsonb; eq text;
begin
  select * into g from hg_nj_grilles where jeu = p_jeu and day = p_day;
  if found then return g; end if;
  if p_jeu in ('connexions', 'motmele', 'motscroises') then
    select c.* into ct from hg_nj_contenus c where c.jeu = p_jeu and c.actif
      order by (select max(x.day) from hg_nj_grilles x where x.contenu_id = c.id) nulls first, md5(seed || c.id::text) limit 1;
    if ct.id is null then return null; end if;
  end if;
  if p_jeu = 'connexions' then
    insert into hg_nj_grilles (jeu, day, contenu_id, public, secret) values (p_jeu, p_day, ct.id,
      jsonb_build_object('mots', (select jsonb_agg(m order by md5(seed || m)) from jsonb_array_elements(ct.data->'groupes') gr, jsonb_array_elements_text(gr->'mots') m)),
      jsonb_build_object('groupes', ct.data->'groupes'))
    on conflict do nothing;
  elsif p_jeu = 'motmele' then
    mm := hg_nj__motmele(array(select upper(x) from jsonb_array_elements_text(ct.data->'mots') x), 12, seed);
    insert into hg_nj_grilles (jeu, day, contenu_id, public, secret) values (p_jeu, p_day, ct.id,
      jsonb_build_object('theme', ct.data->>'theme', 'taille', 12, 'grille', mm->'grille',
        'mots', (select jsonb_agg(k order by k) from jsonb_object_keys(mm->'positions') k)),
      jsonb_build_object('positions', mm->'positions'))
    on conflict do nothing;
  elsif p_jeu = 'motscroises' then
    insert into hg_nj_grilles (jeu, day, contenu_id, public, secret) values (p_jeu, p_day, ct.id,
      ct.data - 'solution', jsonb_build_object('solution', ct.data->'solution'))
    on conflict do nothing;
  elsif p_jeu = 'anagramme' then
    select jsonb_agg(jsonb_build_object('mot', w.data->>'mot', 'def', w.data->>'def') order by char_length(w.data->>'mot')) into mots
    from (select distinct on (char_length(c.data->>'mot')) c.data from hg_nj_contenus c
          where c.jeu = 'dico' and c.actif and char_length(c.data->>'mot') between 5 and 9
            and not exists (select 1 from hg_nj_grilles x, jsonb_array_elements(x.secret->'mots') y where x.jeu = 'anagramme' and y->>'mot' = c.data->>'mot')
          order by char_length(c.data->>'mot'), md5(seed || c.cle)) w;
    if mots is null or jsonb_array_length(mots) < 3 then return null; end if;
    insert into hg_nj_grilles (jeu, day, public, secret) values (p_jeu, p_day,
      jsonb_build_object('mots', (select jsonb_agg(jsonb_build_object('lettres', hg_nj__melange(m->>'mot', seed), 'def', m->>'def', 'n', char_length(m->>'mot')) order by i)
        from jsonb_array_elements(mots) with ordinality x(m, i))),
      jsonb_build_object('mots', mots))
    on conflict do nothing;
  elsif p_jeu = 'nerdle' then
    eq := hg_nj__nerdle_tirage(seed);
    insert into hg_nj_grilles (jeu, day, public, secret) values (p_jeu, p_day, jsonb_build_object('longueur', 8), jsonb_build_object('calcul', eq))
    on conflict do nothing;
  else
    return null;
  end if;
  select * into g from hg_nj_grilles where jeu = p_jeu and day = p_day;
  return g;
end $$;
revoke all on function public.hg_nj__grille(text, date), public.hg_nj__motmele(text[], int, text), public.hg_nj__nerdle_tirage(text)
  from public, anon, authenticated;

-- Classement de la semaine (somme des points) et du jour (temps des parties gagnées).
create or replace function public.hg_nj__gboard(p_jeu text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'semaine', coalesce((select jsonb_agg(x order by x.points desc, x.pseudo) from (
      select p.id as user_id, p.pseudo, p.color, sum(g.score)::int as points, count(*) filter (where g.gagne)::int as wins
      from hg_nj_gparties g join hg_profiles p on p.id = g.user_id and not p.is_ghost
      where g.jeu = p_jeu and g.fini and g.day >= hg_quest_week(now()) group by p.id, p.pseudo, p.color
      order by points desc limit 10) x), '[]'::jsonb),
    'jour', coalesce((select jsonb_agg(x order by x.secondes) from (
      select p.id as user_id, p.pseudo, p.color, g.secondes, g.score
      from hg_nj_gparties g join hg_profiles p on p.id = g.user_id and not p.is_ghost
      where g.jeu = p_jeu and g.day = hg_jeux_today() and g.gagne order by g.secondes limit 10) x), '[]'::jsonb)) $$;
revoke all on function public.hg_nj__gboard(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- État et essais
-- ---------------------------------------------------------------------
create or replace function public.hg_nj_grille_etat(p_jeu text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare d date := hg_jeux_today(); g hg_nj_grilles; p hg_nj_gparties; vue jsonb;
begin
  if not hg_nj_acces() then raise exception 'Jeu en développement : réservé aux admins pour l''instant.'; end if;
  if p_jeu not in ('connexions', 'motmele', 'anagramme', 'nerdle', 'motscroises') then raise exception 'Jeu inconnu'; end if;
  g := hg_nj__grille(p_jeu, d);
  if g.jeu is null then return jsonb_build_object('jeu', p_jeu, 'day', d, 'grille', null, 'board', hg_nj__gboard(p_jeu)); end if;
  select * into p from hg_nj_gparties where jeu = p_jeu and day = d and user_id = auth.uid();
  vue := g.public;
  -- Ce qui est déjà trouvé se montre ; la solution complète seulement en fin de partie.
  if p_jeu = 'connexions' then
    vue := vue || jsonb_build_object('trouves', coalesce((select jsonb_agg(g.secret->'groupes'->(i::int) order by o)
      from jsonb_array_elements_text(coalesce(p.etat->'trouves', '[]'::jsonb)) with ordinality t(i, o)), '[]'::jsonb));
  elsif p_jeu = 'motmele' then
    vue := vue || jsonb_build_object('trouves', coalesce((select jsonb_object_agg(m, g.secret->'positions'->m)
      from jsonb_array_elements_text(coalesce(p.etat->'trouves', '[]'::jsonb)) m), '{}'::jsonb));
  end if;
  return jsonb_build_object('jeu', p_jeu, 'day', d, 'numero', (select count(*) from hg_nj_grilles x where x.jeu = p_jeu and x.day <= d),
    'grille', vue, 'partie', case when p.user_id is null then null else jsonb_build_object('etat', p.etat, 'erreurs', p.erreurs,
      'fini', p.fini, 'gagne', p.gagne, 'score', p.score, 'secondes', p.secondes, 'debut', p.started_at, 'reward', p.rewarded) end,
    'solution', case when p.fini then g.secret end,
    'gain', least(200, greatest(0, hg_eco_cap('nj_' || p_jeu || '_gain', 10))),
    'board', hg_nj__gboard(p_jeu));
end $$;

-- Un essai. p selon le jeu :
--   connexions { mots: [4 mots] } ; motmele { r1, c1, r2, c2 } ; anagramme { i, mot } ou { i, passer: true } ;
--   nerdle { calcul: '12+35=47' } ; motscroises { lignes: [chaînes, '.' = case noire, ' ' = vide], verifier: true }.
-- Renvoie { resultat: {...}, etat: hg_nj_grille_etat(p_jeu) }.
create or replace function public.hg_nj_grille_essai(p_jeu text, p jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); d date := hg_jeux_today(); g hg_nj_grilles; pa hg_nj_gparties; res jsonb := '{}'::jsonb;
  sel text[]; gr jsonb; i int; best int := 0; n int; mot text; r1 int; c1 int; r2 int; c2 int; dr int; dc int; lu text := ''; k int;
  sol text; ess jsonb; faux jsonb; total int; gain int;
begin
  if not hg_nj_acces() then raise exception 'Jeu en développement : réservé aux admins pour l''instant.'; end if;
  if p_jeu not in ('connexions', 'motmele', 'anagramme', 'nerdle', 'motscroises') then raise exception 'Jeu inconnu'; end if;
  g := hg_nj__grille(p_jeu, d);
  if g.jeu is null then raise exception 'Pas de grille aujourd''hui.'; end if;
  insert into hg_nj_gparties (jeu, day, user_id) values (p_jeu, d, me) on conflict do nothing;
  select * into pa from hg_nj_gparties where jeu = p_jeu and day = d and user_id = me for update;
  if pa.fini then raise exception 'Tu as déjà terminé la grille du jour. Reviens demain !'; end if;

  if p_jeu = 'connexions' then
    sel := array(select upper(btrim(x)) from jsonb_array_elements_text(p->'mots') x);
    if cardinality(sel) <> 4 or (select count(distinct x) from unnest(sel) x) <> 4 then raise exception 'Choisis exactement 4 mots.'; end if;
    if exists (select 1 from unnest(sel) x where not (g.public->'mots') ? x) then raise exception 'Mot inconnu.'; end if;
    ess := coalesce(pa.etat->'essais', '[]'::jsonb);
    if exists (select 1 from jsonb_array_elements(ess) e where (select array_agg(v order by v) from jsonb_array_elements_text(e) v) = (select array_agg(x order by x) from unnest(sel) x)) then
      raise exception 'Tu as déjà essayé ces 4 mots.';
    end if;
    pa.etat := jsonb_set(pa.etat, '{essais}', ess || jsonb_build_array(to_jsonb(sel)));
    for i in 0..3 loop
      gr := g.secret->'groupes'->i;
      n := (select count(*) from unnest(sel) x where (gr->'mots') ? x);
      if n = 4 then
        pa.etat := jsonb_set(pa.etat, '{trouves}', coalesce(pa.etat->'trouves', '[]'::jsonb) || to_jsonb(i));
        res := jsonb_build_object('ok', true, 'groupe', gr); best := 4; exit;
      end if;
      best := greatest(best, n);
    end loop;
    if best < 4 then pa.erreurs := pa.erreurs + 1; res := jsonb_build_object('ok', false, 'presque', best = 3); end if;
    if jsonb_array_length(coalesce(pa.etat->'trouves', '[]'::jsonb)) = 4 then pa.fini := true; pa.gagne := true; pa.score := 5 - pa.erreurs;
    elsif pa.erreurs >= 4 then pa.fini := true; pa.score := 0; end if;

  elsif p_jeu = 'motmele' then
    r1 := (p->>'r1')::int; c1 := (p->>'c1')::int; r2 := (p->>'r2')::int; c2 := (p->>'c2')::int;
    if r1 is null or c1 is null or r2 is null or c2 is null or least(r1, c1, r2, c2) < 0 or greatest(r1, c1, r2, c2) > 11 then raise exception 'Sélection invalide.'; end if;
    dr := sign(r2 - r1); dc := sign(c2 - c1);
    if not (r1 = r2 or c1 = c2 or abs(r2 - r1) = abs(c2 - c1)) or (r1 = r2 and c1 = c2) then
      res := jsonb_build_object('ok', false);
    else
      n := greatest(abs(r2 - r1), abs(c2 - c1));
      for k in 0..n loop lu := lu || substr(g.public->'grille'->>(r1 + dr * k), c1 + dc * k + 1, 1); end loop;
      mot := case when (g.secret->'positions') ? lu then lu when (g.secret->'positions') ? reverse(lu) then reverse(lu) end;
      if mot is not null and not coalesce(pa.etat->'trouves', '[]'::jsonb) ? mot then
        pa.etat := jsonb_set(pa.etat, '{trouves}', coalesce(pa.etat->'trouves', '[]'::jsonb) || to_jsonb(mot));
        res := jsonb_build_object('ok', true, 'mot', mot);
      else
        res := jsonb_build_object('ok', false);
      end if;
    end if;
    if jsonb_array_length(coalesce(pa.etat->'trouves', '[]'::jsonb)) = jsonb_array_length(g.public->'mots') then
      pa.fini := true; pa.gagne := true; pa.score := 5;
    end if;

  elsif p_jeu = 'anagramme' then
    i := (p->>'i')::int;
    total := jsonb_array_length(g.secret->'mots');
    if i is null or i < 0 or i >= total then raise exception 'Mot inconnu.'; end if;
    if coalesce(pa.etat->'mots'->>(i::text), '') <> '' then raise exception 'Déjà joué.'; end if;
    if coalesce((p->>'passer')::boolean, false) then
      pa.etat := jsonb_set(pa.etat, array['mots', i::text], to_jsonb('passe'::text), true);
      res := jsonb_build_object('ok', false, 'passe', true, 'mot', g.secret->'mots'->i->>'mot');
    elsif upper(hg_nj_norm(p->>'mot')) = g.secret->'mots'->i->>'mot' then
      if pa.etat->'mots' is null then pa.etat := jsonb_set(pa.etat, '{mots}', '{}'::jsonb); end if;
      pa.etat := jsonb_set(pa.etat, array['mots', i::text], to_jsonb('trouve'::text), true);
      res := jsonb_build_object('ok', true, 'mot', g.secret->'mots'->i->>'mot');
    else
      pa.erreurs := pa.erreurs + 1;
      res := jsonb_build_object('ok', false);
    end if;
    if (select count(*) from jsonb_object_keys(coalesce(pa.etat->'mots', '{}'::jsonb))) = total then
      pa.fini := true;
      pa.score := (select count(*) from jsonb_each_text(pa.etat->'mots') e where e.value = 'trouve');
      pa.gagne := pa.score = total;
    end if;

  elsif p_jeu = 'nerdle' then
    sol := g.secret->>'calcul';
    mot := replace(replace(btrim(p->>'calcul'), '×', '*'), '÷', '/');
    if not hg_nj__nerdle_ok(mot) then raise exception 'Ce n''est pas un calcul juste de 8 caractères.'; end if;
    ess := coalesce(pa.etat->'essais', '[]'::jsonb);
    pa.etat := jsonb_set(pa.etat, '{essais}', ess || jsonb_build_array(jsonb_build_object('calcul', mot, 'couleurs', hg_nj__couleurs(mot, sol))));
    res := jsonb_build_object('ok', mot = sol, 'couleurs', hg_nj__couleurs(mot, sol));
    n := jsonb_array_length(pa.etat->'essais');
    if mot = sol then pa.fini := true; pa.gagne := true; pa.score := 7 - n;
    elsif n >= 6 then pa.fini := true; pa.score := 0; end if;

  else -- motscroises
    sol := (select string_agg(l, '' order by o) from jsonb_array_elements_text(g.secret->'solution') with ordinality x(l, o));
    lu := upper(coalesce((select string_agg(rpad(l, (g.public->>'w')::int), '' order by o) from jsonb_array_elements_text(p->'lignes') with ordinality x(l, o)), ''));
    if char_length(lu) <> char_length(sol) then raise exception 'Grille incomplète.'; end if;
    faux := coalesce((select jsonb_agg(q - 1) from generate_series(1, char_length(sol)) q
      where substr(sol, q, 1) <> '.' and substr(lu, q, 1) <> substr(sol, q, 1) and (coalesce((p->>'verifier')::boolean, false) or substr(lu, q, 1) <> ' ')), '[]'::jsonb);
    if jsonb_array_length(faux) = 0 and position(' ' in translate(lu, '.', '')) = 0 then
      pa.fini := true; pa.gagne := true; pa.score := greatest(1, 5 - pa.erreurs); res := jsonb_build_object('ok', true);
    else
      if coalesce((p->>'verifier')::boolean, false) then pa.erreurs := pa.erreurs + 1; end if;
      res := jsonb_build_object('ok', false, 'faux', faux);
    end if;
  end if;

  if pa.fini then
    pa.finished_at := now();
    pa.secondes := round(extract(epoch from now() - pa.started_at)::numeric, 2);
    if pa.score > 0 then
      gain := least(200, greatest(0, hg_eco_cap('nj_' || p_jeu || '_gain', 10)));
      if gain > 0 then
        pa.rewarded := gain;
        perform hg_wallet_add(me, gain, 'nj_' || p_jeu, 'nj_' || p_jeu || ':' || d::text);
      end if;
    end if;
  end if;
  update hg_nj_gparties set etat = pa.etat, erreurs = pa.erreurs, fini = pa.fini, gagne = pa.gagne, score = pa.score,
    finished_at = pa.finished_at, secondes = pa.secondes, rewarded = pa.rewarded
    where jeu = p_jeu and day = d and user_id = me;
  return jsonb_build_object('resultat', res, 'etat', hg_nj_grille_etat(p_jeu));
end $$;

-- Réponses pour le bouton admin (p_ref = jeu).
create or replace function public.hg_adrep_njg(p_ref text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare g hg_nj_grilles;
begin
  if p_ref not in ('connexions', 'motmele', 'anagramme', 'nerdle', 'motscroises') then
    return jsonb_build_object('titre', 'Réponses', 'note', 'Jeu inconnu.', 'sections', '[]'::jsonb);
  end if;
  g := hg_nj__grille(p_ref, hg_jeux_today());
  if g.jeu is null then return jsonb_build_object('titre', 'Réponses', 'note', 'Pas de grille aujourd’hui.', 'sections', '[]'::jsonb); end if;
  return jsonb_build_object('titre', 'Grille du jour : réponses', 'note', null, 'sections', case p_ref
    when 'connexions' then (select jsonb_agg(jsonb_build_object('titre', x->>'titre', 'liste', x->'mots')) from jsonb_array_elements(g.secret->'groupes') x)
    when 'motmele' then jsonb_build_array(jsonb_build_object('titre', 'Mots et positions (ligne, colonne, de 0 à 11)', 'lignes',
      (select jsonb_agg(jsonb_build_object('label', k, 'valeur', v::text)) from jsonb_each(g.secret->'positions') e(k, v))))
    when 'anagramme' then jsonb_build_array(jsonb_build_object('titre', 'Mots', 'liste', (select jsonb_agg(x->>'mot') from jsonb_array_elements(g.secret->'mots') x)))
    when 'nerdle' then jsonb_build_array(jsonb_build_object('titre', 'Calcul', 'lignes', jsonb_build_array(jsonb_build_object('label', 'Calcul', 'valeur', g.secret->>'calcul', 'ton', 'ok'))))
    else jsonb_build_array(jsonb_build_object('titre', 'Solution', 'grille',
      (select jsonb_agg((select jsonb_agg(substr(l, k, 1)) from generate_series(1, char_length(l)) k) order by o)
       from (select string_agg(x, '' order by i) as l, ((i - 1) / (g.public->>'w')::int) as o
             from jsonb_array_elements_text(g.secret->'solution') with ordinality s(x, i) group by ((i - 1) / (g.public->>'w')::int)) z)))
    end);
end $$;
revoke all on function public.hg_adrep_njg(text) from public, anon, authenticated;

revoke all on function public.hg_nj_grille_etat(text), public.hg_nj_grille_essai(text, jsonb) from public, anon;
grant execute on function public.hg_nj_grille_etat(text), public.hg_nj_grille_essai(text, jsonb) to authenticated;
