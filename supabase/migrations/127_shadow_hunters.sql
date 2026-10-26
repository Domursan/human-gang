-- ===== Humane Gang — migration 127 : Shadow Hunters (moteur du jeu, sur le socle 125) =====
-- Règles officielles (jeu de base, 4 à 8 joueurs) : Hunters, Shadows et Neutres, personnages cachés.
-- Tour : (révéler, pouvoir) → lancer les dés (d6 + d4 ; 7 = au choix ; même lieu = relance) → action du lieu (facultative)
--        → attaque d'un joueur du même groupe de lieux (|d6 - d4| blessures, 0 = raté) → fin.
-- Lieux : 6 cartes en 3 groupes de 2 tirés au hasard. Cartes Vision (données en secret), Lumière, Ténèbres (équipements ou effets).
-- Identifiants fixes (personnages, lieux, cartes) ; noms et textes dans hg_plat_contenus. Camps et points de vie : ci-dessous, fixes.
-- Cartes : 'V:v1'…'V:v16', 'L:<id>', 'T:<id>'. Phases (etat.phase) :
--   debut → (choisir_zone) → zone → (vision_donner → vision [tour = destinataire]) / (carte : effet à cibler) → attaque → joueur suivant.

/* ---------- Contenus paramétrables ---------- */
insert into public.hg_plat_contenus(jeu, cle, libelle, valeur, defaut, sort)
select 'shadow', c.cle, c.libelle, c.v, c.v, c.sort from (values
  ('nom', 'Nom du jeu', to_jsonb('Shadow Hunters'::text), 1),
  ('camps', 'Camps', '[
    {"id":"hunter","nom":"Hunters","couleur":"#3F7FD0"},
    {"id":"shadow","nom":"Shadows","couleur":"#C0392B"},
    {"id":"neutre","nom":"Neutres","couleur":"#C9A43A"}]'::jsonb, 2),
  ('lieux', 'Lieux', '[
    {"id":"ermite","nom":"Antre de l''Ermite","texte":"Pioche une carte Vision et donne-la en secret à un autre joueur."},
    {"id":"porte","nom":"Porte de l''Outremonde","texte":"Pioche une carte dans la pioche de ton choix."},
    {"id":"monastere","nom":"Monastère","texte":"Pioche une carte Lumière."},
    {"id":"cimetiere","nom":"Cimetière","texte":"Pioche une carte Ténèbres."},
    {"id":"foret","nom":"Forêt hantée","texte":"Inflige 2 Blessures à un joueur, ou soigne 1 Blessure d''un joueur."},
    {"id":"sanctuaire","nom":"Sanctuaire ancien","texte":"Vole un équipement à un joueur."}]'::jsonb, 3),
  ('personnages', 'Personnages', '[
    {"id":"emi","nom":"Emi","victoire":"Tous les Shadows sont morts.","pouvoir":"Téléportation : au lieu de lancer les dés, tu peux aller sur un lieu voisin."},
    {"id":"franklin","nom":"Franklin","victoire":"Tous les Shadows sont morts.","pouvoir":"Foudre : une fois par partie, au début de ton tour, inflige 1 à 6 Blessures (dé à 6 faces) à un joueur."},
    {"id":"georges","nom":"Georges","victoire":"Tous les Shadows sont morts.","pouvoir":"Démolition : une fois par partie, au début de ton tour, inflige 1 à 4 Blessures (dé à 4 faces) à un joueur."},
    {"id":"inconnu","nom":"Inconnu","victoire":"Tous les Hunters sont morts, ou 3 Neutres sont morts.","pouvoir":"Imposture : tu peux mentir quand on te donne une carte Vision."},
    {"id":"vampire","nom":"Vampire","victoire":"Tous les Hunters sont morts, ou 3 Neutres sont morts.","pouvoir":"Morsure : quand ton attaque blesse un joueur, tu soignes 2 Blessures."},
    {"id":"loupgarou","nom":"Loup-garou","victoire":"Tous les Hunters sont morts, ou 3 Neutres sont morts.","pouvoir":"Contre-attaque : quand on t''attaque, tu ripostes aussitôt."},
    {"id":"allie","nom":"Allie","victoire":"Être en vie à la fin de la partie.","pouvoir":"Amour maternel : une fois par partie, soigne toutes tes Blessures."},
    {"id":"bob","nom":"Bob","victoire":"Avoir 5 équipements ou plus.","pouvoir":"Braquage : quand ton attaque inflige 2 Blessures ou plus, tu voles un équipement à la place."},
    {"id":"charles","nom":"Charles","victoire":"Tuer un personnage alors qu''au moins 3 personnages sont morts.","pouvoir":"Festin sanglant : après ton attaque, tu peux subir 2 Blessures pour attaquer encore."},
    {"id":"daniel","nom":"Daniel","victoire":"Être le premier à mourir, ou être en vie quand les Hunters gagnent.","pouvoir":"Cri : quand un autre personnage meurt, tu dois te révéler."}]'::jsonb, 4),
  ('vision', 'Cartes Vision', '[
    {"id":"v1","nom":"Vision cupide","texte":"Je parie que tu es un Neutre ou un Shadow. Si c''est le cas, subis 1 Blessure."},
    {"id":"v2","nom":"Vision cupide","texte":"Je parie que tu es un Neutre ou un Shadow. Si c''est le cas, subis 1 Blessure."},
    {"id":"v3","nom":"Vision enivrante","texte":"Je parie que tu es un Neutre ou un Hunter. Si c''est le cas, subis 1 Blessure."},
    {"id":"v4","nom":"Vision enivrante","texte":"Je parie que tu es un Neutre ou un Hunter. Si c''est le cas, subis 1 Blessure."},
    {"id":"v5","nom":"Vision furtive","texte":"Je parie que tu es un Hunter ou un Shadow. Si c''est le cas, subis 1 Blessure."},
    {"id":"v6","nom":"Vision mortifère","texte":"Je parie que tu es un Hunter. Si c''est le cas, subis 1 Blessure."},
    {"id":"v7","nom":"Vision destructrice","texte":"Je parie que tu as 12 points de vie ou plus. Si c''est le cas, subis 2 Blessures."},
    {"id":"v8","nom":"Vision clairvoyante","texte":"Je parie que tu as 11 points de vie ou moins. Si c''est le cas, subis 1 Blessure."},
    {"id":"v9","nom":"Vision divine","texte":"Je parie que tu es un Hunter. Si c''est le cas, soigne 1 Blessure (ou subis 1 Blessure si tu n''en as aucune)."},
    {"id":"v10","nom":"Vision réconfortante","texte":"Je parie que tu es un Neutre. Si c''est le cas, soigne 1 Blessure (ou subis 1 Blessure si tu n''en as aucune)."},
    {"id":"v11","nom":"Vision lugubre","texte":"Je parie que tu es un Shadow. Si c''est le cas, soigne 1 Blessure (ou subis 1 Blessure si tu n''en as aucune)."},
    {"id":"v12","nom":"Vision foudroyante","texte":"Je parie que tu es un Shadow. Si c''est le cas, subis 1 Blessure."},
    {"id":"v13","nom":"Vision purificatrice","texte":"Je parie que tu es un Shadow. Si c''est le cas, subis 2 Blessures."},
    {"id":"v14","nom":"Vision mortifère","texte":"Je parie que tu es un Hunter. Si c''est le cas, subis 1 Blessure."},
    {"id":"v15","nom":"Vision réconfortante","texte":"Je parie que tu es un Neutre. Si c''est le cas, soigne 1 Blessure (ou subis 1 Blessure si tu n''en as aucune)."},
    {"id":"v16","nom":"Vision suprême","texte":"Montre-moi en secret ta carte personnage."}]'::jsonb, 5),
  ('lumiere', 'Cartes Lumière', '[
    {"id":"toge","nom":"Toge sainte","texte":"Équipement. Les attaques que tu fais et que tu subis infligent 1 Blessure de moins."},
    {"id":"chapelet","nom":"Chapelet","texte":"Équipement. Quand tu tues un personnage, tu prends tous ses équipements."},
    {"id":"lance","nom":"Lance de Longinus","texte":"Équipement. Si tu es un Hunter révélé, tes attaques réussies infligent 2 Blessures de plus."},
    {"id":"talisman","nom":"Talisman","texte":"Équipement. Tu ne subis aucune Blessure de la Chauve-souris vampire, de l''Araignée sanguinaire ni de la Dynamite."},
    {"id":"broche","nom":"Broche de chance","texte":"Équipement. Tu ne subis aucune Blessure de la Forêt hantée."},
    {"id":"boussole","nom":"Boussole mystique","texte":"Équipement. Quand tu te déplaces, tu lances les dés deux fois et choisis le résultat."},
    {"id":"eau1","nom":"Eau bénite","texte":"Soigne 2 de tes Blessures."},
    {"id":"eau2","nom":"Eau bénite","texte":"Soigne 2 de tes Blessures."},
    {"id":"avenement","nom":"Avènement","texte":"Si tu es un Hunter, tu peux te révéler et soigner toutes tes Blessures."},
    {"id":"benediction","nom":"Bénédiction","texte":"Choisis un autre joueur : il soigne 1 à 6 Blessures (dé à 6 faces)."},
    {"id":"chocolat","nom":"Barre de chocolat","texte":"Si tu es Allie, Emi ou Inconnu, tu peux te révéler et soigner toutes tes Blessures."},
    {"id":"miroir","nom":"Miroir divin","texte":"Si tu es un Shadow (sauf Inconnu), tu dois te révéler."},
    {"id":"savoir","nom":"Savoir ancestral","texte":"Tu joues un autre tour après celui-ci."},
    {"id":"ange","nom":"Ange gardien","texte":"Les attaques ne te blessent pas jusqu''à ton prochain tour."},
    {"id":"secours","nom":"Premiers secours","texte":"Choisis un joueur (toi compris) : ses Blessures passent à 7."},
    {"id":"jugement","nom":"Éclair purificateur","texte":"Tous les autres joueurs subissent 2 Blessures."}]'::jsonb, 6),
  ('tenebres', 'Cartes Ténèbres', '[
    {"id":"tronconneuse","nom":"Tronçonneuse","texte":"Équipement. Tes attaques réussies infligent 1 Blessure de plus."},
    {"id":"hachoir","nom":"Hachoir","texte":"Équipement. Tes attaques réussies infligent 1 Blessure de plus."},
    {"id":"hache","nom":"Hache rouillée","texte":"Équipement. Tes attaques réussies infligent 1 Blessure de plus."},
    {"id":"masamune","nom":"Sabre hanté Masamune","texte":"Équipement. Tu dois attaquer si tu le peux ; tu lances seulement le dé à 4 faces et ne rates jamais."},
    {"id":"mitrailleuse","nom":"Mitrailleuse","texte":"Équipement. Ton attaque touche tous les joueurs à ta portée."},
    {"id":"revolver","nom":"Revolver des ténèbres","texte":"Équipement. Tu peux attaquer tous les joueurs qui ne sont PAS dans ton groupe de lieux, et plus ceux de ton groupe."},
    {"id":"chauve1","nom":"Chauve-souris vampire","texte":"Inflige 2 Blessures à un joueur et soigne 1 de tes Blessures."},
    {"id":"chauve2","nom":"Chauve-souris vampire","texte":"Inflige 2 Blessures à un joueur et soigne 1 de tes Blessures."},
    {"id":"chauve3","nom":"Chauve-souris vampire","texte":"Inflige 2 Blessures à un joueur et soigne 1 de tes Blessures."},
    {"id":"araignee","nom":"Araignée sanguinaire","texte":"Inflige 2 Blessures à un joueur, puis subis 2 Blessures."},
    {"id":"gobelin","nom":"Gobelin facétieux","texte":"Vole un équipement à un joueur."},
    {"id":"poupee","nom":"Poupée démoniaque","texte":"Choisis un joueur et lance le dé à 6 faces : de 1 à 4 il subit 3 Blessures, sur 5 ou 6 c''est toi."},
    {"id":"dynamite","nom":"Dynamite","texte":"Lance les deux dés : tous les joueurs du lieu obtenu subissent 3 Blessures (rien sur un 7)."},
    {"id":"rituel","nom":"Rituel diabolique","texte":"Si tu es un Shadow, tu peux te révéler et soigner toutes tes Blessures."},
    {"id":"banane","nom":"Peau de banane","texte":"Donne un de tes équipements à un autre joueur. Si tu n''en as pas, subis 1 Blessure."},
    {"id":"gobelin2","nom":"Gobelin facétieux","texte":"Vole un équipement à un joueur."}]'::jsonb, 7)
) c(cle, libelle, v, sort)
on conflict (jeu, cle) do nothing;

insert into public.hg_badges(code, name, description, sort) values
  ('plat_shadow_victoire', 'Chasseur de l''ombre', 'Gagner une partie de Shadow Hunters.', 1010),
  ('plat_shadow_hunter', 'Lumière éternelle', 'Gagner une partie de Shadow Hunters en Hunter.', 1011),
  ('plat_shadow_shadow', 'Ténèbres éternelles', 'Gagner une partie de Shadow Hunters en Shadow.', 1012),
  ('plat_shadow_neutre', 'Électron libre', 'Gagner une partie de Shadow Hunters en Neutre.', 1013),
  ('plat_shadow_cache', 'Insaisissable', 'Gagner une partie de Shadow Hunters sans jamais avoir été révélé.', 1014)
on conflict (code) do nothing;

/* ---------- Données fixes des règles ---------- */

create or replace function public.hg_plat__sh_camp(p text)
returns text language sql immutable as $$
  select case when p in ('emi', 'franklin', 'georges') then 'hunter' when p in ('inconnu', 'vampire', 'loupgarou') then 'shadow' else 'neutre' end
$$;
create or replace function public.hg_plat__sh_pv(p text)
returns int language sql immutable as $$
  select case p when 'emi' then 10 when 'franklin' then 12 when 'georges' then 14 when 'inconnu' then 11 when 'vampire' then 13
    when 'loupgarou' then 14 when 'allie' then 8 when 'bob' then 10 when 'charles' then 11 when 'daniel' then 13 else 10 end
$$;
-- Lieu correspondant à un total de dés (7 : au choix → null).
create or replace function public.hg_plat__sh_lieu_de(n int)
returns text language sql immutable as $$
  select case when n in (2, 3) then 'ermite' when n in (4, 5) then 'porte' when n = 6 then 'monastere'
    when n = 8 then 'cimetiere' when n = 9 then 'foret' when n = 10 then 'sanctuaire' else null end
$$;
create or replace function public.hg_plat__sh_equipement(c text)
returns boolean language sql immutable as $$
  select c in ('L:toge', 'L:chapelet', 'L:lance', 'L:talisman', 'L:broche', 'L:boussole',
               'T:tronconneuse', 'T:hachoir', 'T:hache', 'T:masamune', 'T:mitrailleuse', 'T:revolver')
$$;
create or replace function public.hg_plat__sh_d(n int)
returns int language sql volatile as $$ select 1 + floor(random() * n)::int $$;

/* ---------- Outils ---------- */

create or replace function public.hg_plat__sh_nom_carte(c text)
returns text language sql stable security definer set search_path = public as $$
  select hg_plat__n('shadow', case left(c, 1) when 'V' then 'vision' when 'L' then 'lumiere' else 'tenebres' end, substr(c, 3))
$$;
create or replace function public.hg_plat__sh_perso(p_id uuid, p_u uuid)
returns text language sql stable security definer set search_path = public as $$
  select prive->>'perso' from hg_plat_joueurs where partie = p_id and user_id = p_u
$$;
create or replace function public.hg_plat__sh_j(p_id uuid, p_u uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select etat from hg_plat_joueurs where partie = p_id and user_id = p_u
$$;
create or replace function public.hg_plat__sh_set(p_id uuid, p_u uuid, p_cle text, p_val jsonb)
returns void language sql security definer set search_path = public as $$
  update hg_plat_joueurs set etat = jsonb_set(etat, array[p_cle], p_val) where partie = p_id and user_id = p_u
$$;
create or replace function public.hg_plat__sh_a(p_id uuid, p_u uuid, p_carte text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select etat->'equip' ? p_carte from hg_plat_joueurs where partie = p_id and user_id = p_u), false)
$$;
create or replace function public.hg_plat__sh_vivant(p_id uuid, p_u uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select not elimine from hg_plat_joueurs where partie = p_id and user_id = p_u), false)
$$;
create or replace function public.hg_plat__sh_revele(p_id uuid, p_u uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (etat->>'revele')::boolean from hg_plat_joueurs where partie = p_id and user_id = p_u), false)
$$;
-- Groupe de lieux (0, 1, 2) d'un lieu.
create or replace function public.hg_plat__sh_groupe(p_id uuid, p_lieu text)
returns int language sql stable security definer set search_path = public as $$
  select (g - 1)::int from hg_plat_parties p, jsonb_array_elements(p.etat->'zones') with ordinality t(z, g) where p.id = p_id and z ? p_lieu
$$;
-- Joueurs vivants à portée d'attaque.
create or replace function public.hg_plat__sh_portee(p_id uuid, p_u uuid)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v_lieu text; v_g int; v_rev boolean;
begin
  v_lieu := hg_plat__sh_j(p_id, p_u)->>'lieu';
  if v_lieu is null then return '{}'; end if;
  v_g := hg_plat__sh_groupe(p_id, v_lieu);
  v_rev := hg_plat__sh_a(p_id, p_u, 'T:revolver');
  return coalesce(array(select user_id from hg_plat_joueurs where partie = p_id and user_id <> p_u and not elimine and etat->>'lieu' is not null
    and ((hg_plat__sh_groupe(p_id, etat->>'lieu') = v_g) <> v_rev) order by place), '{}');
end $$;

-- Pioche une carte (remélange la défausse si besoin).
create or replace function public.hg_plat__sh_piocher(p_id uuid, p_pioche text)
returns text language plpgsql security definer set search_path = public as $$
declare s jsonb; v text;
begin
  select secret into s from hg_plat_parties where id = p_id for update;
  if jsonb_array_length(coalesce(s->'pioches'->p_pioche, '[]')) = 0 then
    s := jsonb_set(s, array['pioches', p_pioche], coalesce((select jsonb_agg(x order by random()) from jsonb_array_elements(s->'defausses'->p_pioche) x), '[]'));
    s := jsonb_set(s, array['defausses', p_pioche], '[]');
    if jsonb_array_length(s->'pioches'->p_pioche) = 0 then return null; end if;
  end if;
  v := s->'pioches'->p_pioche->>0;
  s := jsonb_set(s, array['pioches', p_pioche], (s->'pioches'->p_pioche) - 0);
  update hg_plat_parties set secret = s where id = p_id;
  return v;
end $$;
create or replace function public.hg_plat__sh_defausser(p_id uuid, p_carte text)
returns void language sql security definer set search_path = public as $$
  update hg_plat_parties set secret = jsonb_set(secret, array['defausses', case left(p_carte, 1) when 'V' then 'vision' when 'L' then 'lumiere' else 'tenebres' end],
    coalesce(secret->'defausses'->(case left(p_carte, 1) when 'V' then 'vision' when 'L' then 'lumiere' else 'tenebres' end), '[]') || to_jsonb(p_carte))
  where id = p_id
$$;

create or replace function public.hg_plat__sh_phase(p_id uuid, p_phase text, p_extra jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  update hg_plat_parties set etat = etat || jsonb_build_object('phase', p_phase) || p_extra where id = p_id
$$;

create or replace function public.hg_plat__sh_reveler(p_id uuid, p_u uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_p text;
begin
  if hg_plat__sh_revele(p_id, p_u) then return; end if;
  v_p := hg_plat__sh_perso(p_id, p_u);
  update hg_plat_joueurs set etat = etat || jsonb_build_object('revele', true, 'perso', v_p, 'camp', hg_plat__sh_camp(v_p))
    where partie = p_id and user_id = p_u;
  perform hg_plat__log(p_id, p_u, 'revele', hg_plat__nom(p_id, p_u) || ' se révèle : ' || hg_plat__n('shadow', 'personnages', v_p)
    || ' (' || hg_plat__n('shadow', 'camps', hg_plat__sh_camp(v_p)) || ').');
end $$;

create or replace function public.hg_plat__sh_soigner(p_id uuid, p_u uuid, n int)
returns void language plpgsql security definer set search_path = public as $$
declare v_d int;
begin
  if not hg_plat__sh_vivant(p_id, p_u) or n <= 0 then return; end if;
  v_d := (hg_plat__sh_j(p_id, p_u)->>'degats')::int;
  perform hg_plat__sh_set(p_id, p_u, 'degats', to_jsonb(greatest(0, v_d - n)));
  if v_d > 0 then perform hg_plat__log(p_id, p_u, 'soin', hg_plat__nom(p_id, p_u) || ' soigne ' || least(n, v_d) || ' Blessure' || case when least(n, v_d) > 1 then 's' else '' end || '.'); end if;
end $$;

-- Mort d'un personnage : révélé, ses équipements vont au tueur (tous avec le Chapelet, sinon un seul).
create or replace function public.hg_plat__sh_mort(p_id uuid, p_u uuid, p_tueur uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_eq jsonb; v_morts int; v_prend jsonb; r record;
begin
  perform hg_plat__sh_reveler(p_id, p_u);
  update hg_plat_joueurs set elimine = true where partie = p_id and user_id = p_u;
  update hg_plat_parties set etat = jsonb_set(etat, '{morts}', coalesce(etat->'morts', '[]') || to_jsonb(p_u)) where id = p_id;
  perform hg_plat__log(p_id, p_u, 'mort', hg_plat__nom(p_id, p_u) || ' meurt.');
  v_eq := coalesce(hg_plat__sh_j(p_id, p_u)->'equip', '[]');
  if p_tueur is not null and p_tueur <> p_u and hg_plat__sh_vivant(p_id, p_tueur) and jsonb_array_length(v_eq) > 0 then
    v_prend := case when hg_plat__sh_a(p_id, p_tueur, 'L:chapelet') then v_eq else jsonb_build_array(v_eq->(floor(random() * jsonb_array_length(v_eq)))::int) end;
    perform hg_plat__sh_set(p_id, p_tueur, 'equip', coalesce(hg_plat__sh_j(p_id, p_tueur)->'equip', '[]') || v_prend);
    perform hg_plat__log(p_id, p_tueur, 'equipement', hg_plat__nom(p_id, p_tueur) || ' récupère : '
      || (select string_agg(hg_plat__sh_nom_carte(x), ', ') from jsonb_array_elements_text(v_prend) x) || '.');
    v_eq := (select coalesce(jsonb_agg(x), '[]') from jsonb_array_elements_text(v_eq) x where not v_prend ? x);
  end if;
  for r in select x from jsonb_array_elements_text(v_eq) x loop perform hg_plat__sh_defausser(p_id, r.x); end loop;
  perform hg_plat__sh_set(p_id, p_u, 'equip', '[]');
  -- Charles : tuer alors qu'au moins 3 personnages sont morts.
  select jsonb_array_length(etat->'morts') into v_morts from hg_plat_parties where id = p_id;
  if p_tueur is not null and p_tueur <> p_u and hg_plat__sh_perso(p_id, p_tueur) = 'charles' and v_morts >= 3 then
    update hg_plat_parties set etat = jsonb_set(etat, '{charles}', 'true') where id = p_id;
  end if;
  -- Daniel se révèle quand un autre meurt.
  for r in select user_id from hg_plat_joueurs where partie = p_id and not elimine and prive->>'perso' = 'daniel' loop
    perform hg_plat__sh_reveler(p_id, r.user_id);
  end loop;
end $$;

-- Inflige des Blessures. p_attaque : vient d'une attaque (pour l'Ange gardien).
create or replace function public.hg_plat__sh_blesser(p_id uuid, p_u uuid, n int, p_source uuid, p_attaque boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare e jsonb; v_pv int; v_d int;
begin
  if not hg_plat__sh_vivant(p_id, p_u) or n <= 0 then return 0; end if;
  e := hg_plat__sh_j(p_id, p_u);
  if p_attaque and coalesce((e->>'ange')::boolean, false) then
    perform hg_plat__log(p_id, p_u, 'info', 'L''Ange gardien protège ' || hg_plat__nom(p_id, p_u) || '.');
    return 0;
  end if;
  v_pv := hg_plat__sh_pv(hg_plat__sh_perso(p_id, p_u));
  v_d := least(v_pv, (e->>'degats')::int + n);
  perform hg_plat__sh_set(p_id, p_u, 'degats', to_jsonb(v_d));
  perform hg_plat__log(p_id, p_u, 'blessure', hg_plat__nom(p_id, p_u) || ' subit ' || n || ' Blessure' || case when n > 1 then 's' else '' end || '.');
  if v_d >= v_pv then perform hg_plat__sh_mort(p_id, p_u, p_source); end if;
  return n;
end $$;

-- Conditions de victoire : termine la partie si l'une d'elles est remplie. Renvoie vrai si fini.
create or replace function public.hg_plat__sh_verifier(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare e jsonb; v_h_vivants int; v_s_vivants int; v_n_morts int; v_hunters boolean; v_shadows boolean; v_fin boolean;
  v_gagnants uuid[] := '{}'; r record; v_premier uuid; v_bob boolean := false;
begin
  if (select statut from hg_plat_parties where id = p_id) <> 'en_cours' then return true; end if;
  select etat into e from hg_plat_parties where id = p_id;
  select count(*) filter (where hg_plat__sh_camp(prive->>'perso') = 'hunter' and not elimine),
         count(*) filter (where hg_plat__sh_camp(prive->>'perso') = 'shadow' and not elimine),
         count(*) filter (where hg_plat__sh_camp(prive->>'perso') = 'neutre' and elimine)
    into v_h_vivants, v_s_vivants, v_n_morts from hg_plat_joueurs where partie = p_id;
  v_hunters := v_s_vivants = 0;
  v_shadows := v_h_vivants = 0 or v_n_morts >= 3;
  v_premier := (e->'morts'->>0)::uuid;
  select exists (select 1 from hg_plat_joueurs where partie = p_id and not elimine and prive->>'perso' = 'bob' and jsonb_array_length(coalesce(etat->'equip', '[]')) >= 5) into v_bob;
  v_fin := v_hunters or v_shadows or v_bob or coalesce((e->>'charles')::boolean, false)
    or (v_premier is not null and hg_plat__sh_perso(p_id, v_premier) = 'daniel');
  if not v_fin then return false; end if;
  for r in select user_id, prive->>'perso' perso, elimine, etat from hg_plat_joueurs where partie = p_id loop
    if (hg_plat__sh_camp(r.perso) = 'hunter' and v_hunters) or (hg_plat__sh_camp(r.perso) = 'shadow' and v_shadows)
       or (r.perso = 'allie' and not r.elimine)
       or (r.perso = 'bob' and not r.elimine and jsonb_array_length(coalesce(r.etat->'equip', '[]')) >= 5)
       or (r.perso = 'charles' and coalesce((e->>'charles')::boolean, false))
       or (r.perso = 'daniel' and (v_premier = r.user_id or (not r.elimine and v_hunters))) then
      v_gagnants := v_gagnants || r.user_id;
    end if;
  end loop;
  -- Tout le monde se révèle à la fin.
  for r in select user_id from hg_plat_joueurs where partie = p_id and not coalesce((etat->>'revele')::boolean, false) loop
    update hg_plat_joueurs set etat = etat || jsonb_build_object('revele', true, 'perso', prive->>'perso', 'camp', hg_plat__sh_camp(prive->>'perso'))
      where partie = p_id and user_id = r.user_id;
  end loop;
  perform hg_plat__terminer(p_id, v_gagnants, case when v_hunters then 'hunters' when v_shadows then 'shadows' else 'neutre' end);
  return true;
end $$;

-- Tour suivant (ou tour supplémentaire du Savoir ancestral).
create or replace function public.hg_plat__sh_suivant(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; v_actif uuid; v_suiv uuid;
begin
  if hg_plat__sh_verifier(p_id) then return; end if;
  select etat into e from hg_plat_parties where id = p_id;
  v_actif := (e->>'actif')::uuid;
  if coalesce((e->>'encore')::boolean, false) and hg_plat__sh_vivant(p_id, v_actif) then
    v_suiv := v_actif;
    perform hg_plat__log(p_id, v_actif, 'info', hg_plat__nom(p_id, v_actif) || ' joue un autre tour.');
  else
    v_suiv := hg_plat__suivant(p_id, v_actif);
  end if;
  perform hg_plat__sh_set(p_id, v_suiv, 'ange', 'false');
  update hg_plat_parties set nb_tours = nb_tours + 1,
    etat = etat || jsonb_build_object('actif', v_suiv, 'phase', 'debut', 'encore', false, 'carte', null, 'vision', null, 'des', null, 'options', null, 'attaques', 0)
  where id = p_id;
  perform hg_plat__donner_tour(p_id, v_suiv);
end $$;

-- Attaque (avec ses effets) ; p_contre : contre-attaque du Loup-garou (pas de riposte en retour).
create or replace function public.hg_plat__sh_attaquer(p_id uuid, p_u uuid, p_cibles uuid[], p_contre boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare d6 int; d4 int; v_base int; v_n int; c uuid; v_mod int; v_inflige int; v_eq jsonb; v_vole text; v_txt text;
begin
  if hg_plat__sh_a(p_id, p_u, 'T:masamune') then d6 := 0; d4 := hg_plat__sh_d(4); v_base := d4;
  else d6 := hg_plat__sh_d(6); d4 := hg_plat__sh_d(4); v_base := abs(d6 - d4); end if;
  v_txt := case when d6 = 0 then 'dé à 4 faces : ' || d4 else 'dés : ' || d6 || ' et ' || d4 end;
  update hg_plat_parties set etat = etat || jsonb_build_object('des', jsonb_build_object('type', 'attaque', 'd6', d6, 'd4', d4)) where id = p_id;
  perform hg_plat__log(p_id, p_u, 'attaque', hg_plat__nom(p_id, p_u) || case when p_contre then ' contre-attaque ' else ' attaque ' end
    || (select string_agg(hg_plat__nom(p_id, x), ', ') from unnest(p_cibles) x) || ' (' || v_txt || ').');
  if v_base = 0 then perform hg_plat__log(p_id, p_u, 'attaque', 'Raté !'); return; end if;
  foreach c in array p_cibles loop
    continue when not hg_plat__sh_vivant(p_id, c);
    v_mod := (case when hg_plat__sh_a(p_id, p_u, 'T:tronconneuse') then 1 else 0 end) + (case when hg_plat__sh_a(p_id, p_u, 'T:hachoir') then 1 else 0 end)
      + (case when hg_plat__sh_a(p_id, p_u, 'T:hache') then 1 else 0 end)
      + (case when hg_plat__sh_a(p_id, p_u, 'L:lance') and hg_plat__sh_revele(p_id, p_u) and hg_plat__sh_camp(hg_plat__sh_perso(p_id, p_u)) = 'hunter' then 2 else 0 end)
      - (case when hg_plat__sh_a(p_id, p_u, 'L:toge') then 1 else 0 end) - (case when hg_plat__sh_a(p_id, c, 'L:toge') then 1 else 0 end);
    v_n := greatest(0, v_base + v_mod);
    -- Bob révélé : vole un équipement au lieu de blesser (2 Blessures ou plus).
    v_eq := coalesce(hg_plat__sh_j(p_id, c)->'equip', '[]');
    if v_n >= 2 and hg_plat__sh_perso(p_id, p_u) = 'bob' and hg_plat__sh_revele(p_id, p_u) and jsonb_array_length(v_eq) > 0 then
      v_vole := v_eq->>(floor(random() * jsonb_array_length(v_eq)))::int;
      perform hg_plat__sh_set(p_id, c, 'equip', v_eq - v_vole);
      perform hg_plat__sh_set(p_id, p_u, 'equip', coalesce(hg_plat__sh_j(p_id, p_u)->'equip', '[]') || to_jsonb(v_vole));
      perform hg_plat__log(p_id, p_u, 'equipement', hg_plat__nom(p_id, p_u) || ' vole ' || hg_plat__sh_nom_carte(v_vole) || ' à ' || hg_plat__nom(p_id, c) || '.');
      continue;
    end if;
    v_inflige := hg_plat__sh_blesser(p_id, c, v_n, p_u, true);
    if v_inflige > 0 and hg_plat__sh_perso(p_id, p_u) = 'vampire' and hg_plat__sh_revele(p_id, p_u) then perform hg_plat__sh_soigner(p_id, p_u, 2); end if;
    -- Loup-garou révélé et vivant : riposte.
    if not p_contre and hg_plat__sh_vivant(p_id, c) and hg_plat__sh_vivant(p_id, p_u) and hg_plat__sh_perso(p_id, c) = 'loupgarou' and hg_plat__sh_revele(p_id, c) then
      perform hg_plat__sh_attaquer(p_id, c, array[p_u], true);
    end if;
  end loop;
end $$;

-- Arrivée sur un lieu.
create or replace function public.hg_plat__sh_aller(p_id uuid, p_u uuid, p_lieu text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform hg_plat__sh_set(p_id, p_u, 'lieu', to_jsonb(p_lieu));
  perform hg_plat__log(p_id, p_u, 'deplacer', hg_plat__nom(p_id, p_u) || ' va à : ' || hg_plat__n('shadow', 'lieux', p_lieu) || '.');
  perform hg_plat__sh_phase(p_id, 'zone', '{"options": null}');
end $$;

-- Lance les dés de déplacement ; renvoie un lieu ou null (7 : choix libre).
create or replace function public.hg_plat__sh_jet(p_id uuid, p_u uuid)
returns text language plpgsql security definer set search_path = public as $$
declare d6 int; d4 int; v_l text; v_ici text; n int := 0;
begin
  v_ici := hg_plat__sh_j(p_id, p_u)->>'lieu';
  loop
    d6 := hg_plat__sh_d(6); d4 := hg_plat__sh_d(4); v_l := hg_plat__sh_lieu_de(d6 + d4); n := n + 1;
    exit when v_l is null or v_l is distinct from v_ici or n > 20;
  end loop;
  update hg_plat_parties set etat = etat || jsonb_build_object('des', jsonb_build_object('type', 'deplacement', 'd6', d6, 'd4', d4)) where id = p_id;
  return coalesce(v_l, '*');
end $$;

/* ---------- Interface du socle ---------- */

create or replace function public.hg_plat__shadow_options(p jsonb)
returns jsonb language sql immutable as $$ select '{}'::jsonb $$;

create or replace function public.hg_plat__shadow_lancer(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_n int; v_h int; v_s int; v_ne int; v_persos text[]; v_joueurs uuid[]; i int; v_lieux text[]; v_premier uuid;
begin
  select array_agg(user_id order by place) into v_joueurs from hg_plat_joueurs where partie = p_id;
  v_n := cardinality(v_joueurs);
  v_h := case when v_n = 8 then 3 else 2 end; v_s := v_h; v_ne := v_n - v_h - v_s;
  v_persos := array(select x from (select x from unnest(array['emi', 'franklin', 'georges']) x order by random() limit v_h) a)
    || array(select x from (select x from unnest(array['inconnu', 'vampire', 'loupgarou']) x order by random() limit v_s) b)
    || array(select x from (select x from unnest(array['allie', 'bob', 'charles', 'daniel']) x order by random() limit v_ne) c);
  select array_agg(x order by random()) into v_persos from unnest(v_persos) x;
  for i in 1 .. v_n loop
    update hg_plat_joueurs set prive = jsonb_build_object('perso', v_persos[i], 'connus', '{}'::jsonb),
      etat = jsonb_build_object('revele', false, 'perso', null, 'camp', null, 'degats', 0, 'lieu', null, 'equip', '[]'::jsonb, 'pouvoir', false, 'ange', false)
    where partie = p_id and user_id = v_joueurs[i];
  end loop;
  select array_agg(x order by random()) into v_lieux from unnest(array['ermite', 'porte', 'monastere', 'cimetiere', 'foret', 'sanctuaire']) x;
  v_premier := v_joueurs[1];
  update hg_plat_parties set nb_tours = 1,
    secret = jsonb_build_object(
      'pioches', jsonb_build_object(
        'vision', (select jsonb_agg('V:v' || k order by random()) from generate_series(1, 16) k),
        'lumiere', (select jsonb_agg('L:' || (x->>'id') order by random()) from jsonb_array_elements(hg_plat__c('shadow', 'lumiere')) x),
        'tenebres', (select jsonb_agg('T:' || (x->>'id') order by random()) from jsonb_array_elements(hg_plat__c('shadow', 'tenebres')) x)),
      'defausses', '{"vision": [], "lumiere": [], "tenebres": []}'::jsonb),
    etat = jsonb_build_object('zones', jsonb_build_array(jsonb_build_array(v_lieux[1], v_lieux[2]), jsonb_build_array(v_lieux[3], v_lieux[4]), jsonb_build_array(v_lieux[5], v_lieux[6])),
      'actif', v_premier, 'phase', 'debut', 'morts', '[]'::jsonb, 'carte', null, 'vision', null, 'des', null, 'options', null, 'encore', false, 'attaques', 0,
      'composition', jsonb_build_object('hunter', v_h, 'shadow', v_s, 'neutre', v_ne))
  where id = p_id;
  perform hg_plat__log(p_id, null, 'info', v_h || ' Hunters, ' || v_s || ' Shadows et ' || v_ne || ' Neutre' || case when v_ne > 1 then 's' else '' end || ' sont parmi vous.');
  perform hg_plat__donner_tour(p_id, v_premier);
end $$;

-- Effet d'une carte Vision appliquée par son destinataire (p_mentir : seulement l'Inconnu).
create or replace function public.hg_plat__sh_vision(p_id uuid, p_u uuid, p_mentir boolean)
returns void language plpgsql security definer set search_path = public as $$
declare e jsonb; v jsonb; v_carte text; v_perso text; v_camp text; v_pv int; v_de uuid; v_vise boolean; v_soin boolean := false; v_n int := 1; v_d int;
begin
  select etat into e from hg_plat_parties where id = p_id;
  v := e->'vision'; v_carte := v->>'carte'; v_de := (v->>'de')::uuid;
  v_perso := hg_plat__sh_perso(p_id, p_u); v_camp := hg_plat__sh_camp(v_perso); v_pv := hg_plat__sh_pv(v_perso);
  if p_mentir and v_perso <> 'inconnu' then raise exception 'Seul l''Inconnu peut mentir.'; end if;
  if v_carte = 'V:v16' then
    if p_mentir then raise exception 'Impossible de mentir sur la Vision suprême.'; end if;
    update hg_plat_joueurs set prive = jsonb_set(prive, array['connus', p_u::text], to_jsonb(v_perso)) where partie = p_id and user_id = v_de;
    perform hg_plat__log(p_id, p_u, 'vision', hg_plat__nom(p_id, p_u) || ' montre en secret son personnage à ' || hg_plat__nom(p_id, v_de) || '.');
    perform hg_plat__log(p_id, p_u, 'secret', hg_plat__nom(p_id, p_u) || ' est : ' || hg_plat__n('shadow', 'personnages', v_perso) || ' (' || hg_plat__n('shadow', 'camps', v_camp) || ').', v_de);
  else
    v_vise := case substr(v_carte, 3)
      when 'v1' then v_camp in ('neutre', 'shadow') when 'v2' then v_camp in ('neutre', 'shadow')
      when 'v3' then v_camp in ('neutre', 'hunter') when 'v4' then v_camp in ('neutre', 'hunter')
      when 'v5' then v_camp in ('hunter', 'shadow') when 'v6' then v_camp = 'hunter' when 'v14' then v_camp = 'hunter'
      when 'v7' then v_pv >= 12 when 'v8' then v_pv <= 11
      when 'v9' then v_camp = 'hunter' when 'v10' then v_camp = 'neutre' when 'v15' then v_camp = 'neutre' when 'v11' then v_camp = 'shadow'
      when 'v12' then v_camp = 'shadow' when 'v13' then v_camp = 'shadow' else false end;
    v_soin := substr(v_carte, 3) in ('v9', 'v10', 'v11', 'v15');
    v_n := case substr(v_carte, 3) when 'v7' then 2 when 'v13' then 2 else 1 end;
    if p_mentir then v_vise := not v_vise; end if;
    if not v_vise then
      perform hg_plat__log(p_id, p_u, 'vision', hg_plat__nom(p_id, p_u) || ' n''est pas concerné par la carte Vision.');
    elsif v_soin then
      v_d := (hg_plat__sh_j(p_id, p_u)->>'degats')::int;
      perform hg_plat__log(p_id, p_u, 'vision', hg_plat__nom(p_id, p_u) || ' est concerné par la carte Vision.');
      if p_mentir then null;
      elsif v_d > 0 then perform hg_plat__sh_soigner(p_id, p_u, 1);
      else perform hg_plat__sh_blesser(p_id, p_u, 1, v_de); end if;
    else
      perform hg_plat__log(p_id, p_u, 'vision', hg_plat__nom(p_id, p_u) || ' est concerné par la carte Vision.');
      if not p_mentir then perform hg_plat__sh_blesser(p_id, p_u, v_n, v_de); end if;
    end if;
  end if;
  perform hg_plat__log(p_id, p_u, 'secret', 'Carte Vision pour ' || hg_plat__nom(p_id, p_u) || ' : « ' || (select x->>'texte' from jsonb_array_elements(hg_plat__c('shadow', 'vision')) x where x->>'id' = substr(v_carte, 3)) || ' »', v_de);
  perform hg_plat__sh_defausser(p_id, v_carte);
  perform hg_plat__sh_phase(p_id, 'attaque', '{"vision": null}');
  update hg_plat_parties set tour = null where id = p_id;
  if not hg_plat__sh_verifier(p_id) then perform hg_plat__donner_tour(p_id, (e->>'actif')::uuid); end if;
end $$;

-- Applique une carte piochée (Lumière ou Ténèbres) ; renvoie vrai si elle attend une cible (phase carte).
create or replace function public.hg_plat__sh_tirer(p_id uuid, p_u uuid, p_carte text)
returns void language plpgsql security definer set search_path = public as $$
declare v_id text := substr(p_carte, 3); v_perso text; v_camp text; d6 int; d4 int; v_l text; r record; v_pv int;
begin
  perform hg_plat__log(p_id, p_u, 'carte', hg_plat__nom(p_id, p_u) || ' pioche : ' || hg_plat__sh_nom_carte(p_carte) || '.');
  v_perso := hg_plat__sh_perso(p_id, p_u); v_camp := hg_plat__sh_camp(v_perso);
  if hg_plat__sh_equipement(p_carte) then
    perform hg_plat__sh_set(p_id, p_u, 'equip', coalesce(hg_plat__sh_j(p_id, p_u)->'equip', '[]') || to_jsonb(p_carte));
    perform hg_plat__sh_phase(p_id, 'attaque');
    return;
  end if;
  if v_id in ('benediction', 'secours', 'chauve1', 'chauve2', 'chauve3', 'araignee', 'gobelin', 'gobelin2', 'poupee', 'banane', 'avenement', 'chocolat', 'rituel') then
    if v_id = 'banane' and jsonb_array_length(coalesce(hg_plat__sh_j(p_id, p_u)->'equip', '[]')) = 0 then
      perform hg_plat__sh_blesser(p_id, p_u, 1, null);
    elsif v_id like 'gobelin%' and not exists (select 1 from hg_plat_joueurs where partie = p_id and user_id <> p_u and not elimine and jsonb_array_length(coalesce(etat->'equip', '[]')) > 0) then
      perform hg_plat__log(p_id, p_u, 'info', 'Personne n''a d''équipement à voler.');
    else
      perform hg_plat__sh_phase(p_id, 'carte', jsonb_build_object('carte', p_carte));
      return;
    end if;
  elsif v_id in ('eau1', 'eau2') then perform hg_plat__sh_soigner(p_id, p_u, 2);
  elsif v_id = 'miroir' then
    if v_camp = 'shadow' and v_perso <> 'inconnu' then perform hg_plat__sh_reveler(p_id, p_u);
    else perform hg_plat__log(p_id, p_u, 'info', 'Il ne se passe rien.'); end if;
  elsif v_id = 'savoir' then update hg_plat_parties set etat = jsonb_set(etat, '{encore}', 'true') where id = p_id;
  elsif v_id = 'ange' then perform hg_plat__sh_set(p_id, p_u, 'ange', 'true');
  elsif v_id = 'jugement' then
    for r in select user_id from hg_plat_joueurs where partie = p_id and user_id <> p_u and not elimine order by place loop
      perform hg_plat__sh_blesser(p_id, r.user_id, 2, p_u);
    end loop;
  elsif v_id = 'dynamite' then
    d6 := hg_plat__sh_d(6); d4 := hg_plat__sh_d(4); v_l := hg_plat__sh_lieu_de(d6 + d4);
    if v_l is null then perform hg_plat__log(p_id, p_u, 'info', 'Dynamite : ' || (d6 + d4) || ', rien n''explose.');
    else
      perform hg_plat__log(p_id, p_u, 'info', 'Dynamite : ' || (d6 + d4) || ', explosion à : ' || hg_plat__n('shadow', 'lieux', v_l) || ' !');
      for r in select user_id from hg_plat_joueurs where partie = p_id and not elimine and etat->>'lieu' = v_l order by place loop
        if not hg_plat__sh_a(p_id, r.user_id, 'L:talisman') then perform hg_plat__sh_blesser(p_id, r.user_id, 3, p_u); end if;
      end loop;
    end if;
  end if;
  perform hg_plat__sh_defausser(p_id, p_carte);
  if not hg_plat__sh_verifier(p_id) then
    if hg_plat__sh_vivant(p_id, p_u) then perform hg_plat__sh_phase(p_id, 'attaque'); else perform hg_plat__sh_suivant(p_id); end if;
  end if;
end $$;

-- Effet d'une carte qui attend un choix (cible, ou utiliser / ne pas utiliser).
create or replace function public.hg_plat__sh_jouer_carte(p_id uuid, p_u uuid, a jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_carte text; v_id text; c uuid; v_perso text; v_camp text; v_eq jsonb; v_x text; d int; v_util boolean;
begin
  v_carte := (select etat->>'carte' from hg_plat_parties where id = p_id); v_id := substr(v_carte, 3);
  v_perso := hg_plat__sh_perso(p_id, p_u); v_camp := hg_plat__sh_camp(v_perso);
  if v_id in ('avenement', 'chocolat', 'rituel') then
    v_util := coalesce((a->>'utiliser')::boolean, false);
    if v_util then
      if not ((v_id = 'avenement' and v_camp = 'hunter') or (v_id = 'chocolat' and v_perso in ('allie', 'emi', 'inconnu')) or (v_id = 'rituel' and v_camp = 'shadow')) then
        raise exception 'Tu ne remplis pas la condition de cette carte.';
      end if;
      perform hg_plat__sh_reveler(p_id, p_u);
      perform hg_plat__sh_set(p_id, p_u, 'degats', '0');
      perform hg_plat__log(p_id, p_u, 'soin', hg_plat__nom(p_id, p_u) || ' soigne toutes ses Blessures.');
    else
      perform hg_plat__log(p_id, p_u, 'info', hg_plat__nom(p_id, p_u) || ' n''utilise pas la carte.');
    end if;
  else
    c := (a->>'cible')::uuid;
    if c is null or not hg_plat__sh_vivant(p_id, c) then raise exception 'Choisis un joueur en vie.'; end if;
    if c = p_u and v_id not in ('secours', 'poupee') then raise exception 'Choisis un autre joueur.'; end if;
    if v_id = 'benediction' then
      d := hg_plat__sh_d(6); perform hg_plat__log(p_id, p_u, 'info', 'Dé : ' || d || '.'); perform hg_plat__sh_soigner(p_id, c, d);
    elsif v_id = 'secours' then
      perform hg_plat__sh_set(p_id, c, 'degats', '0');
      perform hg_plat__log(p_id, c, 'info', 'Les Blessures de ' || hg_plat__nom(p_id, c) || ' passent à 7.');
      perform hg_plat__sh_blesser(p_id, c, 7, p_u);
    elsif v_id in ('chauve1', 'chauve2', 'chauve3') then
      if hg_plat__sh_a(p_id, c, 'L:talisman') then perform hg_plat__log(p_id, c, 'info', 'Le Talisman protège ' || hg_plat__nom(p_id, c) || '.');
      else perform hg_plat__sh_blesser(p_id, c, 2, p_u); end if;
      perform hg_plat__sh_soigner(p_id, p_u, 1);
    elsif v_id = 'araignee' then
      if hg_plat__sh_a(p_id, c, 'L:talisman') then perform hg_plat__log(p_id, c, 'info', 'Le Talisman protège ' || hg_plat__nom(p_id, c) || '.');
      else perform hg_plat__sh_blesser(p_id, c, 2, p_u); end if;
      if not hg_plat__sh_a(p_id, p_u, 'L:talisman') then perform hg_plat__sh_blesser(p_id, p_u, 2, null); end if;
    elsif v_id = 'poupee' then
      d := hg_plat__sh_d(6); perform hg_plat__log(p_id, p_u, 'info', 'Dé : ' || d || '.');
      if d <= 4 then perform hg_plat__sh_blesser(p_id, c, 3, p_u); else perform hg_plat__sh_blesser(p_id, p_u, 3, null); end if;
    elsif v_id like 'gobelin%' then
      v_eq := coalesce(hg_plat__sh_j(p_id, c)->'equip', '[]');
      if jsonb_array_length(v_eq) = 0 then raise exception 'Ce joueur n''a pas d''équipement.'; end if;
      v_x := coalesce(nullif(a->>'equipement', ''), v_eq->>0);
      if not v_eq ? v_x then raise exception 'Équipement introuvable.'; end if;
      perform hg_plat__sh_set(p_id, c, 'equip', v_eq - v_x);
      perform hg_plat__sh_set(p_id, p_u, 'equip', coalesce(hg_plat__sh_j(p_id, p_u)->'equip', '[]') || to_jsonb(v_x));
      perform hg_plat__log(p_id, p_u, 'equipement', hg_plat__nom(p_id, p_u) || ' vole ' || hg_plat__sh_nom_carte(v_x) || ' à ' || hg_plat__nom(p_id, c) || '.');
    elsif v_id = 'banane' then
      v_eq := coalesce(hg_plat__sh_j(p_id, p_u)->'equip', '[]');
      v_x := coalesce(nullif(a->>'equipement', ''), v_eq->>0);
      if not v_eq ? v_x then raise exception 'Équipement introuvable.'; end if;
      perform hg_plat__sh_set(p_id, p_u, 'equip', v_eq - v_x);
      perform hg_plat__sh_set(p_id, c, 'equip', coalesce(hg_plat__sh_j(p_id, c)->'equip', '[]') || to_jsonb(v_x));
      perform hg_plat__log(p_id, p_u, 'equipement', hg_plat__nom(p_id, p_u) || ' donne ' || hg_plat__sh_nom_carte(v_x) || ' à ' || hg_plat__nom(p_id, c) || '.');
    end if;
  end if;
  perform hg_plat__sh_defausser(p_id, v_carte);
  update hg_plat_parties set etat = jsonb_set(etat, '{carte}', 'null') where id = p_id;
  if not hg_plat__sh_verifier(p_id) then
    if hg_plat__sh_vivant(p_id, p_u) then perform hg_plat__sh_phase(p_id, 'attaque'); else perform hg_plat__sh_suivant(p_id); end if;
  end if;
end $$;

create or replace function public.hg_plat__shadow_agir(p_id uuid, p_u uuid, p_action text, a jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; v_actif uuid; ph text; j jsonb; v_perso text; v_l text; v_l2 text; c uuid; v_eq jsonb; v_x text;
  v_ordre text[]; i int; v_cibles uuid[]; d int; v_pioche text; v_carte text;
begin
  select * into p from hg_plat_parties where id = p_id;
  e := p.etat; v_actif := (e->>'actif')::uuid; ph := e->>'phase';
  if p_action = 'repondre' then
    if ph <> 'vision' or p.tour is distinct from p_u then raise exception 'Aucune carte Vision ne t''attend.'; end if;
    perform hg_plat__sh_vision(p_id, p_u, coalesce((a->>'mentir')::boolean, false));
    return null;
  end if;
  if v_actif is distinct from p_u then raise exception 'Ce n''est pas ton tour.'; end if;
  if ph = 'vision' then raise exception 'Attends que la carte Vision soit appliquée.'; end if;
  j := hg_plat__sh_j(p_id, p_u); v_perso := hg_plat__sh_perso(p_id, p_u);

  if p_action = 'reveler' then
    perform hg_plat__sh_reveler(p_id, p_u);
    return null;
  elsif p_action = 'pouvoir' then
    if not coalesce((j->>'revele')::boolean, false) then raise exception 'Révèle-toi d''abord.'; end if;
    if coalesce((j->>'pouvoir')::boolean, false) then raise exception 'Tu as déjà utilisé ton pouvoir.'; end if;
    if v_perso in ('franklin', 'georges') then
      if ph <> 'debut' then raise exception 'Ce pouvoir s''utilise au début de ton tour.'; end if;
      c := (a->>'cible')::uuid;
      if c is null or c = p_u or not hg_plat__sh_vivant(p_id, c) then raise exception 'Choisis un autre joueur en vie.'; end if;
      d := hg_plat__sh_d(case when v_perso = 'franklin' then 6 else 4 end);
      perform hg_plat__sh_set(p_id, p_u, 'pouvoir', 'true');
      perform hg_plat__log(p_id, p_u, 'pouvoir', hg_plat__nom(p_id, p_u) || ' utilise son pouvoir sur ' || hg_plat__nom(p_id, c) || ' (dé : ' || d || ').');
      perform hg_plat__sh_blesser(p_id, c, d, p_u);
      perform hg_plat__sh_verifier(p_id);
    elsif v_perso = 'allie' then
      perform hg_plat__sh_set(p_id, p_u, 'pouvoir', 'true');
      perform hg_plat__sh_set(p_id, p_u, 'degats', '0');
      perform hg_plat__log(p_id, p_u, 'pouvoir', hg_plat__nom(p_id, p_u) || ' soigne toutes ses Blessures.');
    else
      raise exception 'Ton personnage n''a pas de pouvoir à activer.';
    end if;
    return null;
  elsif p_action = 'lancer' then
    if ph <> 'debut' then raise exception 'Tu as déjà lancé les dés.'; end if;
    v_l := hg_plat__sh_jet(p_id, p_u);
    if hg_plat__sh_a(p_id, p_u, 'L:boussole') then
      v_l2 := hg_plat__sh_jet(p_id, p_u);
      if v_l = '*' or v_l2 = '*' then v_l := '*';
      elsif v_l <> v_l2 then
        perform hg_plat__log(p_id, p_u, 'deplacer', hg_plat__nom(p_id, p_u) || ' lance deux fois les dés (Boussole mystique).');
        perform hg_plat__sh_phase(p_id, 'choisir_zone', jsonb_build_object('options', jsonb_build_array(v_l, v_l2)));
        return null;
      end if;
    end if;
    if v_l = '*' then
      perform hg_plat__log(p_id, p_u, 'deplacer', hg_plat__nom(p_id, p_u) || ' fait 7 : il choisit son lieu.');
      perform hg_plat__sh_phase(p_id, 'choisir_zone', jsonb_build_object('options',
        (select jsonb_agg(x) from unnest(array['ermite', 'porte', 'monastere', 'cimetiere', 'foret', 'sanctuaire']) x where x is distinct from j->>'lieu')));
    else
      perform hg_plat__sh_aller(p_id, p_u, v_l);
    end if;
    return null;
  elsif p_action = 'teleporter' then
    if ph <> 'debut' then raise exception 'Tu as déjà bougé.'; end if;
    if v_perso <> 'emi' or not coalesce((j->>'revele')::boolean, false) then raise exception 'Seule Emi révélée peut se téléporter.'; end if;
    if j->>'lieu' is null then raise exception 'Lance d''abord les dés pour entrer en jeu.'; end if;
    select array_agg(x order by o) into v_ordre from (select z.x, (g * 10 + k) o from jsonb_array_elements(e->'zones') with ordinality t(zz, g),
      jsonb_array_elements_text(zz) with ordinality z(x, k)) s;
    i := array_position(v_ordre, j->>'lieu');
    if a->>'lieu' not in (v_ordre[1 + (i % 6)], v_ordre[1 + ((i + 4) % 6)]) then raise exception 'Choisis un lieu voisin.'; end if;
    perform hg_plat__sh_aller(p_id, p_u, a->>'lieu');
    return null;
  elsif p_action = 'aller' then
    if ph <> 'choisir_zone' then raise exception 'Lance d''abord les dés.'; end if;
    if not (e->'options' ? (a->>'lieu')) then raise exception 'Choisis un des lieux proposés.'; end if;
    perform hg_plat__sh_aller(p_id, p_u, a->>'lieu');
    return null;
  elsif p_action = 'passer' then
    if ph <> 'zone' then raise exception 'Rien à passer.'; end if;
    perform hg_plat__sh_phase(p_id, 'attaque');
    return null;
  elsif p_action = 'lieu' then
    if ph <> 'zone' then raise exception 'Tu ne peux pas utiliser ton lieu maintenant.'; end if;
    v_l := j->>'lieu';
    if v_l = 'ermite' or (v_l = 'porte' and a->>'pioche' = 'vision') then
      v_carte := hg_plat__sh_piocher(p_id, 'vision');
      update hg_plat_joueurs set prive = prive || jsonb_build_object('vision_main', v_carte) where partie = p_id and user_id = p_u;
      perform hg_plat__log(p_id, p_u, 'carte', hg_plat__nom(p_id, p_u) || ' pioche une carte Vision.');
      perform hg_plat__sh_phase(p_id, 'vision_donner');
    elsif v_l = 'monastere' or v_l = 'cimetiere' or (v_l = 'porte' and a->>'pioche' in ('lumiere', 'tenebres')) then
      v_pioche := case when v_l = 'monastere' then 'lumiere' when v_l = 'cimetiere' then 'tenebres' else a->>'pioche' end;
      v_carte := hg_plat__sh_piocher(p_id, v_pioche);
      if v_carte is null then perform hg_plat__log(p_id, p_u, 'info', 'La pioche est vide.'); perform hg_plat__sh_phase(p_id, 'attaque');
      else perform hg_plat__sh_tirer(p_id, p_u, v_carte); end if;
    elsif v_l = 'porte' then raise exception 'Choisis une pioche : Vision, Lumière ou Ténèbres.';
    elsif v_l = 'foret' then
      c := (a->>'cible')::uuid;
      if c is null or not hg_plat__sh_vivant(p_id, c) then raise exception 'Choisis un joueur en vie.'; end if;
      if a->>'mode' = 'soigner' then perform hg_plat__sh_soigner(p_id, c, 1);
        perform hg_plat__log(p_id, p_u, 'info', hg_plat__nom(p_id, p_u) || ' utilise la Forêt hantée pour soigner ' || hg_plat__nom(p_id, c) || '.');
      elsif a->>'mode' = 'blesser' then
        perform hg_plat__log(p_id, p_u, 'info', hg_plat__nom(p_id, p_u) || ' utilise la Forêt hantée contre ' || hg_plat__nom(p_id, c) || '.');
        if hg_plat__sh_a(p_id, c, 'L:broche') then perform hg_plat__log(p_id, c, 'info', 'La Broche de chance protège ' || hg_plat__nom(p_id, c) || '.');
        else perform hg_plat__sh_blesser(p_id, c, 2, p_u); end if;
      else raise exception 'Choisis : blesser ou soigner.'; end if;
      if not hg_plat__sh_verifier(p_id) then
        if hg_plat__sh_vivant(p_id, p_u) then perform hg_plat__sh_phase(p_id, 'attaque'); else perform hg_plat__sh_suivant(p_id); end if;
      end if;
    elsif v_l = 'sanctuaire' then
      c := (a->>'cible')::uuid;
      if c is null or c = p_u or not hg_plat__sh_vivant(p_id, c) then raise exception 'Choisis un autre joueur en vie.'; end if;
      v_eq := coalesce(hg_plat__sh_j(p_id, c)->'equip', '[]');
      if jsonb_array_length(v_eq) = 0 then raise exception 'Ce joueur n''a pas d''équipement.'; end if;
      v_x := coalesce(nullif(a->>'equipement', ''), v_eq->>0);
      if not v_eq ? v_x then raise exception 'Équipement introuvable.'; end if;
      perform hg_plat__sh_set(p_id, c, 'equip', v_eq - v_x);
      perform hg_plat__sh_set(p_id, p_u, 'equip', coalesce(j->'equip', '[]') || to_jsonb(v_x));
      perform hg_plat__log(p_id, p_u, 'equipement', hg_plat__nom(p_id, p_u) || ' vole ' || hg_plat__sh_nom_carte(v_x) || ' à ' || hg_plat__nom(p_id, c) || '.');
      if not hg_plat__sh_verifier(p_id) then perform hg_plat__sh_phase(p_id, 'attaque'); end if;
    end if;
    return null;
  elsif p_action = 'donner_vision' then
    if ph <> 'vision_donner' then raise exception 'Tu n''as pas de carte Vision à donner.'; end if;
    c := (a->>'cible')::uuid;
    if c is null or c = p_u or not hg_plat__sh_vivant(p_id, c) then raise exception 'Choisis un autre joueur en vie.'; end if;
    v_carte := (select prive->>'vision_main' from hg_plat_joueurs where partie = p_id and user_id = p_u);
    update hg_plat_joueurs set prive = prive - 'vision_main' where partie = p_id and user_id = p_u;
    perform hg_plat__log(p_id, p_u, 'vision', hg_plat__nom(p_id, p_u) || ' donne une carte Vision à ' || hg_plat__nom(p_id, c) || '.');
    perform hg_plat__sh_phase(p_id, 'vision', jsonb_build_object('vision', jsonb_build_object('carte', v_carte, 'de', p_u, 'pour', c)));
    perform hg_plat__donner_tour(p_id, c);
    return null;
  elsif p_action = 'jouer_carte' then
    if ph <> 'carte' then raise exception 'Aucune carte à jouer.'; end if;
    perform hg_plat__sh_jouer_carte(p_id, p_u, a);
    return null;
  elsif p_action = 'attaquer' then
    if ph <> 'attaque' then raise exception 'Tu ne peux pas attaquer maintenant.'; end if;
    if coalesce((e->>'attaques')::int, 0) > 0 and not (v_perso = 'charles' and coalesce((j->>'revele')::boolean, false)) then
      raise exception 'Tu as déjà attaqué ce tour-ci.';
    end if;
    v_cibles := hg_plat__sh_portee(p_id, p_u);
    if hg_plat__sh_a(p_id, p_u, 'T:mitrailleuse') then
      if cardinality(v_cibles) = 0 then raise exception 'Personne n''est à ta portée.'; end if;
    else
      c := (a->>'cible')::uuid;
      if c is null or not (c = any(v_cibles)) then raise exception 'Ce joueur n''est pas à ta portée.'; end if;
      v_cibles := array[c];
    end if;
    if coalesce((e->>'attaques')::int, 0) > 0 then
      perform hg_plat__log(p_id, p_u, 'pouvoir', hg_plat__nom(p_id, p_u) || ' subit 2 Blessures pour attaquer encore.');
      perform hg_plat__sh_blesser(p_id, p_u, 2, null);
      if not hg_plat__sh_vivant(p_id, p_u) then
        if not hg_plat__sh_verifier(p_id) then perform hg_plat__sh_suivant(p_id); end if;
        return null;
      end if;
    end if;
    update hg_plat_parties set etat = jsonb_set(etat, '{attaques}', to_jsonb(coalesce((etat->>'attaques')::int, 0) + 1)) where id = p_id;
    perform hg_plat__sh_attaquer(p_id, p_u, v_cibles);
    if hg_plat__sh_verifier(p_id) then return null; end if;
    if not hg_plat__sh_vivant(p_id, p_u) then perform hg_plat__sh_suivant(p_id);
    elsif not (v_perso = 'charles' and hg_plat__sh_revele(p_id, p_u)) then perform hg_plat__sh_suivant(p_id); end if;
    return null;
  elsif p_action = 'finir' then
    if ph not in ('attaque', 'zone') then raise exception 'Termine d''abord ton action en cours.'; end if;
    if hg_plat__sh_a(p_id, p_u, 'T:masamune') and coalesce((e->>'attaques')::int, 0) = 0 and cardinality(hg_plat__sh_portee(p_id, p_u)) > 0 then
      raise exception 'Le sabre Masamune t''oblige à attaquer.';
    end if;
    perform hg_plat__sh_suivant(p_id);
    return null;
  end if;
  raise exception 'Action inconnue.';
end $$;

-- Chrono écoulé : joue simplement pour le joueur attendu (n'attaque que si le Masamune l'y oblige).
create or replace function public.hg_plat__shadow_auto(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; ph text; u uuid; v_c text; v_autres uuid[];
begin
  select * into p from hg_plat_parties where id = p_id;
  e := p.etat; ph := e->>'phase';
  if ph = 'vision' then perform hg_plat__sh_vision(p_id, p.tour, false); return true; end if;
  u := (e->>'actif')::uuid;
  v_autres := array(select user_id from hg_plat_joueurs where partie = p_id and user_id <> u and not elimine order by random());
  if ph = 'debut' then perform hg_plat__shadow_agir(p_id, u, 'lancer', '{}');
  elsif ph = 'choisir_zone' then perform hg_plat__shadow_agir(p_id, u, 'aller', jsonb_build_object('lieu', e->'options'->>0));
  elsif ph = 'zone' then perform hg_plat__shadow_agir(p_id, u, 'passer', '{}');
  elsif ph = 'vision_donner' then perform hg_plat__shadow_agir(p_id, u, 'donner_vision', jsonb_build_object('cible', v_autres[1]));
  elsif ph = 'carte' then
    v_c := substr(e->>'carte', 3);
    if v_c in ('avenement', 'chocolat', 'rituel') then perform hg_plat__sh_jouer_carte(p_id, u, '{"utiliser": false}');
    elsif v_c in ('benediction', 'secours') then perform hg_plat__sh_jouer_carte(p_id, u, jsonb_build_object('cible', case when v_c = 'secours' then u else v_autres[1] end));
    elsif v_c like 'gobelin%' then perform hg_plat__sh_jouer_carte(p_id, u, jsonb_build_object('cible',
      (select user_id from hg_plat_joueurs where partie = p_id and user_id <> u and not elimine and jsonb_array_length(coalesce(etat->'equip', '[]')) > 0 limit 1)));
    else perform hg_plat__sh_jouer_carte(p_id, u, jsonb_build_object('cible', v_autres[1])); end if;
  elsif ph = 'attaque' then
    if hg_plat__sh_a(p_id, u, 'T:masamune') and coalesce((e->>'attaques')::int, 0) = 0 and cardinality(hg_plat__sh_portee(p_id, u)) > 0 then
      perform hg_plat__shadow_agir(p_id, u, 'attaquer', jsonb_build_object('cible', (hg_plat__sh_portee(p_id, u))[1]));
    else perform hg_plat__sh_suivant(p_id); end if;
  else return false;
  end if;
  return true;
end $$;

create or replace function public.hg_plat__shadow_vue(p_id uuid, p_moi uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p hg_plat_parties; e jsonb; j hg_plat_joueurs; v jsonb;
begin
  select * into p from hg_plat_parties where id = p_id;
  select * into j from hg_plat_joueurs where partie = p_id and user_id = p_moi;
  e := p.etat; v := e->'vision';
  return jsonb_build_object(
    'phase', e->>'phase', 'actif', e->'actif', 'zones', e->'zones', 'morts', e->'morts', 'des', e->'des', 'options', e->'options',
    'carte', e->'carte', 'attaques', e->'attaques', 'composition', e->'composition',
    'pioches', jsonb_build_object('vision', jsonb_array_length(p.secret->'pioches'->'vision'), 'lumiere', jsonb_array_length(p.secret->'pioches'->'lumiere'),
      'tenebres', jsonb_array_length(p.secret->'pioches'->'tenebres')),
    'vision', case when v is null or jsonb_typeof(v) = 'null' then null
      else jsonb_build_object('de', v->'de', 'pour', v->'pour') || case when (v->>'pour')::uuid = p_moi or (v->>'de')::uuid = p_moi then jsonb_build_object('carte', v->'carte') else '{}' end end,
    'moi', case when j.user_id is null then null else jsonb_build_object('perso', j.prive->'perso', 'camp', hg_plat__sh_camp(j.prive->>'perso'),
      'pv', hg_plat__sh_pv(j.prive->>'perso'), 'connus', coalesce(j.prive->'connus', '{}'), 'vision_main', j.prive->'vision_main',
      'portee', to_jsonb(hg_plat__sh_portee(p_id, p_moi))) end,
    'pv', (select jsonb_object_agg(user_id, case when coalesce((etat->>'revele')::boolean, false) then hg_plat__sh_pv(prive->>'perso') else null end) from hg_plat_joueurs where partie = p_id)
  );
end $$;

create or replace function public.hg_plat__shadow_badges(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record; v_camp text; v_jamais boolean;
begin
  for r in select user_id, gagne, prive->>'perso' perso from hg_plat_joueurs where partie = p_id and not invite and gagne loop
    v_camp := hg_plat__sh_camp(r.perso);
    perform hg_plat__badge(r.user_id, 'plat_shadow_victoire');
    perform hg_plat__badge(r.user_id, 'plat_shadow_' || v_camp);
    v_jamais := not exists (select 1 from hg_plat_coups where partie = p_id and user_id = r.user_id and type = 'revele');
    if v_jamais then perform hg_plat__badge(r.user_id, 'plat_shadow_cache'); end if;
  end loop;
end $$;

select public.hg_plat__droits();
