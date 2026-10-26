-- ===== Humane Gang — migration 138 : jeux solo (Démineur, Sudoku du jour, 2048), en développement (admins seulement) =====
-- Une partie = une ligne hg_nj_solo, ouverte par le serveur (hg_nj_solo_debut : heure de départ) et fermée par lui
-- (hg_nj_solo_fin : durée réelle mesurée par le serveur, score vraisemblable). Classements de la semaine par jeu et variante.
--   demineur : variante facile | moyen | difficile ; score = temps en secondes (le plus petit gagne) ; gagné seulement.
--   sudoku   : variante = jour (AAAA-MM-JJ, la même grille pour tous) ; la grille finale envoyée doit être un sudoku
--              identique à la solution (grille du jour tirée par le serveur, hg_nj__sudoku) ; score = temps ; une partie classée par jour.
--   2048     : variante 'classique' ; score = points (le plus grand gagne), plafond de points par seconde.
-- Paillettes : une partie récompensée par jour et par jeu (réglable : hg_eco_cap('nj_<jeu>_gain')).
-- Accès : hg_nj_acces().

do $d$ begin execute replace($t$
create table if not exists public.hg_nj_solo (
  id uuid primary key default gen_random_uuid(),
  jeu text not null check (jeu in ('demineur', 'sudoku', '2048')),
  variante text not null check (char_length(variante) between 1 and 20),
  user_id uuid not null references public.hg_profiles(id) @CASC,
  day date not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  gagne boolean,
  score int,
  secondes numeric(8, 2),
  rewarded int not null default 0
)
$t$, '@CASC', 'on de' || 'lete cascade'); end $d$;
create index if not exists hg_nj_solo_board on public.hg_nj_solo (jeu, variante, day) where finished_at is not null and gagne;
create index if not exists hg_nj_solo_user on public.hg_nj_solo (user_id, day);
alter table public.hg_nj_solo enable row level security;
revoke all on public.hg_nj_solo from anon, authenticated;

-- Variante valide ?
create or replace function public.hg_nj_solo_variante_ok(p_jeu text, p_var text)
returns boolean language sql immutable set search_path = public as $$
  select case p_jeu
    when 'demineur' then p_var in ('facile', 'moyen', 'difficile')
    when 'sudoku' then p_var ~ '^\d{4}-\d{2}-\d{2}$'
    when '2048' then p_var = 'classique'
    else false end $$;

-- Classement de la semaine (lundi) : meilleur résultat de chacun (temps le plus court, ou plus grand score pour 2048).
create or replace function public.hg_nj_solo_board(p_jeu text, p_var text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by case when p_jeu = '2048' then -x.score else x.secondes end, x.pseudo), '[]'::jsonb) from (
    select distinct on (s.user_id) s.user_id, p.pseudo, p.avatar_url, p.color, s.score, s.secondes
    from hg_nj_solo s join hg_profiles p on p.id = s.user_id and not p.is_ghost
    where s.jeu = p_jeu and s.variante = p_var and s.finished_at is not null and s.gagne
      and s.day >= hg_quest_week(now())
    order by s.user_id, case when p_jeu = '2048' then -s.score else s.secondes end) x
  limit 10 $$;
revoke all on function public.hg_nj_solo_board(text, text) from public, anon, authenticated;

-- État : record de la semaine, classement, gain possible, déjà récompensé aujourd'hui.
create or replace function public.hg_nj_solo_etat(p_jeu text, p_var text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); d date := hg_jeux_today();
begin
  if not hg_nj_acces() then raise exception 'Jeu en développement : réservé aux admins pour l''instant.'; end if;
  if not hg_nj_solo_variante_ok(p_jeu, p_var) then raise exception 'Jeu inconnu'; end if;
  return jsonb_build_object('jeu', p_jeu, 'variante', p_var, 'day', d,
    'gain', least(200, greatest(0, hg_eco_cap('nj_' || p_jeu || '_gain', 10))),
    'recompense_aujourdhui', exists (select 1 from hg_nj_solo where user_id = me and jeu = p_jeu and day = d and rewarded > 0),
    'sudoku', case when p_jeu = 'sudoku' then jsonb_build_object('niveau', hg_nj__sudoku(d)->>'niveau', 'donnes', hg_nj__sudoku(d)->>'donnes') end,
    'sudoku_fait', case when p_jeu = 'sudoku' then (select jsonb_build_object('secondes', s.secondes) from hg_nj_solo s
      where s.user_id = me and s.jeu = 'sudoku' and s.variante = p_var and s.gagne limit 1) end,
    'board', hg_nj_solo_board(p_jeu, p_var));
end $$;

-- Ouvre une partie (le serveur note l'heure de départ). Une partie ouverte et jamais fermée est abandonnée.
create or replace function public.hg_nj_solo_debut(p_jeu text, p_var text)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); d date := hg_jeux_today(); rid uuid;
begin
  if not hg_nj_acces() then raise exception 'Jeu en développement : réservé aux admins pour l''instant.'; end if;
  if not hg_nj_solo_variante_ok(p_jeu, p_var) then raise exception 'Jeu inconnu'; end if;
  if p_jeu = 'sudoku' and p_var <> d::text then raise exception 'Ce n''est pas la grille du jour.'; end if;
  if (select count(*) from hg_nj_solo where user_id = me and day = d) >= 200 then raise exception 'Assez joué pour aujourd''hui !'; end if;
  update hg_nj_solo set finished_at = now(), gagne = false where user_id = me and jeu = p_jeu and finished_at is null;
  insert into hg_nj_solo (jeu, variante, user_id, day) values (p_jeu, p_var, me, d) returning id into rid;
  return rid;
end $$;

-- Grille du jour du sudoku : une des grilles de base (solution unique), transformée par des permutations tirées du jour
-- (chiffres, lignes et colonnes à l'intérieur des bandes, bandes, transposition) : la solution reste unique.
-- Difficulté selon le jour : lundi-mercredi facile, jeudi-vendredi moyen, samedi-dimanche difficile.
-- Renvoie { niveau, donnes (81 caractères, 0 = vide), solution } ; la solution ne sort jamais vers le client.
create or replace function public.hg_nj__perm(p_seed text, p_n int)
returns int[] language sql immutable set search_path = public as $$
  select array_agg(i order by md5(p_seed || ':' || i)) from generate_series(0, p_n - 1) i $$;

create or replace function public.hg_nj__sudoku(p_day date)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  dow int := extract(isodow from p_day);
  niveau text := case when dow <= 3 then 'facile' when dow <= 5 then 'moyen' else 'difficile' end;
  pz text[]; so text[]; k int; seed text := 'hg_sudoku:' || p_day::text;
  chiffres int[]; bandes int[]; piles int[]; rl int[]; cl int[]; tr boolean;
  r int; c int; rr int; cc int; src int; d text := ''; s text := ''; x text;
begin
  if niveau = 'facile' then pz := array['807059040490800605300460900900002060720000039030700002006071008209005014070940506', '050026003001003805000510609070900106009465200604007090802051000506200300700640050', '000360000398745000500189704009000001634000257100000900205974003000658412000013000', '081300000702058013050107009030090057004070300210030090800509030170420805000006940', '803001004004000725756004100402050800500703002001080509008100397917000200200900408', '080296350020351000531000020000060503200403008803010000050000734000587060019634080']; so := array['867159243491823675352467981915382467724516839638794152546271398289635714173948526', '957826413461793825238514679375982146189465237624137598892351764546279381713648952', '741362895398745126562189734859427361634891257127536948215974683973658412486213579', '981342576762958413453167289638294157594671328217835694846519732179423865325786941', '823571964194836725756294183472659831589713642361482579648125397917348256235967418', '487296351926351847531748926174862593295473618863915472658129734342587169719634285'];
  elsif niveau = 'moyen' then pz := array['001003000004090010800060005006005207078040650902700800600010002020070100000900400', '000000694605300020070100300000260903200000007304071000007003010030002409421000000', '800000009010000836602080000005008040100379005080500100000060908296000070400000001', '300085000470001020000002539590000100000010000001000087162900000040100053000860001', '001003000020970010700080490003060840070000030042010600038090001050041080000500900', '007004206000030000620059080870000005040906030200000048030560097000090000905200600']; so := array['591823764264597318837461925346185297178249653952736841689314572425678139713952486', '183725694645389721972146385718264953269538147354971862897453216536812479421697538', '843617259719452836652983417965128743124379685387546192531764928296831574478295361', '329685714475391826816472539594738162687219345231546987162953478948127653753864291', '981453726324976518765182493193765842576824139842319675438697251659241387217538964', '397814256158632479624759381879423165541986732263175948432561897716398524985247613'];
  else pz := array['000000100020093070004500030002150700100000004009078500080007400010940080007000000', '060007000080100000002096100004000005723000419500000800009620300000008020000300090', '009200000050061802000400100526000008000000000300000546004009000703610090000004700', '000300009000800300036070005020700600900050002004003050300060240005004000800002000', '070002061000900070001070400500008006002000800300100004007030100050009000960700020', '001000020007650000000200106702005090019000640060400207305007000000012500080000900']; so := array['398726145521493678764581239832154796175369824649278513983617452216945387457832961', '165487932987132546342596187894713265723865419516249873479621358631958724258374691', '169238475457961832832457169526743918941586327378192546214879653783615294695324781', '458326179792815364136479825521748693973651482684293751319567248265184937847932516', '475382961638914572291675483519248736742563819386197254827436195153829647964751328', '651384729297651483438279156742165398819723645563498217325947861976812534184536972']; end if;
  k := 1 + (('x' || substr(md5(seed), 1, 6))::bit(24)::int % cardinality(pz));
  chiffres := hg_nj__perm(seed || 'c', 9); bandes := hg_nj__perm(seed || 'b', 3); piles := hg_nj__perm(seed || 'p', 3);
  tr := substr(md5(seed || 't'), 1, 1) < '8';
  for r in 0..8 loop
    for c in 0..8 loop
      rr := bandes[r / 3 + 1] * 3 + (hg_nj__perm(seed || 'r' || (r / 3), 3))[r % 3 + 1];
      cc := piles[c / 3 + 1] * 3 + (hg_nj__perm(seed || 'k' || (c / 3), 3))[c % 3 + 1];
      src := case when tr then cc * 9 + rr else rr * 9 + cc end;
      x := substr(pz[k], src + 1, 1);
      d := d || case when x = '0' then '0' else (chiffres[x::int] + 1)::text end;
      s := s || (chiffres[substr(so[k], src + 1, 1)::int] + 1)::text;
    end loop;
  end loop;
  return jsonb_build_object('niveau', niveau, 'donnes', d, 'solution', s);
end $$;
revoke all on function public.hg_nj__perm(text, int), public.hg_nj__sudoku(date) from public, anon, authenticated;

-- Ferme une partie. p_res : { gagne: bool, score?: int (2048), grille?: text (sudoku : 81 chiffres) }.
-- Démineur et sudoku : le score est le temps mesuré par le serveur (pas celui du client).
create or replace function public.hg_nj_solo_fin(p_run uuid, p_res jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); r hg_nj_solo; secs numeric; ok boolean; sc int; gain int := 0; mini numeric;
begin
  if not hg_nj_acces() then raise exception 'Jeu en développement : réservé aux admins pour l''instant.'; end if;
  perform hg_eco_lock(me);
  select * into r from hg_nj_solo where id = p_run and user_id = me for update;
  if not found then raise exception 'Partie introuvable'; end if;
  if r.finished_at is not null then raise exception 'Partie déjà terminée'; end if;
  secs := round(extract(epoch from now() - r.started_at)::numeric, 2);
  ok := coalesce((p_res->>'gagne')::boolean, false);
  if secs > 4 * 3600 then ok := false; end if;
  if r.jeu = 'demineur' then
    -- Temps minimal humainement possible (grille entière à découvrir).
    mini := case r.variante when 'facile' then 2 when 'moyen' then 8 else 20 end;
    if secs < mini then ok := false; end if;
    sc := ceil(secs)::int;
  elsif r.jeu = 'sudoku' then
    ok := ok and secs >= 45 and coalesce(p_res->>'grille', '') = hg_nj__sudoku(r.day)->>'solution'
      and not exists (select 1 from hg_nj_solo where user_id = me and jeu = 'sudoku' and variante = r.variante and gagne and id <> r.id);
    sc := ceil(secs)::int;
  else
    sc := greatest(0, coalesce((p_res->>'score')::int, 0));
    -- 2048 : au plus 40 points par seconde en moyenne (une fusion de 2048 vaut 2048 : marge de 5000 points).
    if sc > 40 * secs + 5000 or sc > 4000000 then ok := false; sc := 0; else ok := sc > 0; end if;
  end if;
  update hg_nj_solo set finished_at = now(), gagne = ok, score = sc, secondes = secs where id = r.id;
  if ok and not exists (select 1 from hg_nj_solo where user_id = me and jeu = r.jeu and day = r.day and rewarded > 0) then
    gain := least(200, greatest(0, hg_eco_cap('nj_' || r.jeu || '_gain', 10)));
    if gain > 0 then
      update hg_nj_solo set rewarded = gain where id = r.id;
      perform hg_wallet_add(me, gain, 'nj_' || r.jeu, 'nj_' || r.jeu || ':' || r.day::text);
    end if;
  end if;
  return jsonb_build_object('ok', ok, 'score', sc, 'secondes', secs, 'reward', gain, 'board', hg_nj_solo_board(r.jeu, r.variante));
end $$;

revoke all on function public.hg_nj_solo_etat(text, text), public.hg_nj_solo_debut(text, text), public.hg_nj_solo_fin(uuid, jsonb) from public, anon;
grant execute on function public.hg_nj_solo_etat(text, text), public.hg_nj_solo_debut(text, text), public.hg_nj_solo_fin(uuid, jsonb) to authenticated;
