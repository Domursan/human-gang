-- ===== Humane Gang — migration 176 : correctifs de l'audit du 29/10/2026 =====
-- 1. Loup-Garou : la colonne etat de hg_lg_parties (victime des loups pendant le réveil, file des réactions…)
--    n'est plus lisible par les joueurs ni diffusée en temps réel ; le site passe par hg_lg_etat (SECURITY DEFINER).
-- 2. Loup-Garou : deux appels simultanés (joueurs et tick) ne font plus sauter une étape : hg_lg__essayer revérifie
--    l'échéance sous verrou avant d'avancer.
-- 3. Loup-Garou : un joueur mort ne lit plus le canal des loups, sauf s'il était loup.
-- 4. Loup-Garou : « Passer » annule le choix déjà fait à l'étape (Grand méchant loup, Corbeau, Loup blanc…) ;
--    le Salvateur ne peut plus protéger deux nuits de suite la même personne en modifiant son choix.
-- 5. Loup-Garou : une pause du meneur est levée seule au bout de 30 minutes ; une partie automatique sans
--    élimination depuis trois manches, où plus personne n'agit ni ne vote, est arrêtée ; une partie en erreur
--    ne bloque plus le tick des autres.
-- 6. Uno : les colonnes defi (dont « legal ») et pioche_carte ne sont plus lisibles ni diffusées en temps réel.
-- 7. Photos (bucket hg-photos) : une photo ou un moment masqué par la modération n'est plus lisible des membres
--    (seuls l'auteur et le Staff « souvenirs » ou « support » le voient, comme dans les tables).
-- 8. Invitations (Loup-Garou, Uno, Nom de code, duels, plateaux) : les codes ont 4 chiffres ; un appareil qui essaie
--    plus de 15 codes inconnus en 10 minutes est freiné. Un code inconnu à « rejoindre » renvoie null (le site affiche
--    déjà « Impossible de rejoindre ») au lieu d'une erreur, pour que l'essai soit compté.
-- 9. Privilèges : INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES et TRIGGER retirés à anon et authenticated sur les
--    quatre tables créées après la migration 105 (aucune politique ne les accorde, le site passe par des RPC).
-- Rejouable : chaque remplacement n'est fait que si la fonction ne le contient pas encore.

-- ---------------------------------------------------------------------
-- 1 et 6. Colonnes secrètes : droit de lecture par colonne
-- ---------------------------------------------------------------------
-- Une nouvelle colonne de ces tables n'est pas lisible par défaut : l'ajouter ici si le site doit la lire.
do $m$
declare r record; v_cols text;
begin
  for r in select * from (values ('hg_lg_parties', array['etat']), ('hg_uno_parties', array['defi', 'pioche_carte'])) as t(tbl, secret) loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
      from information_schema.columns where table_schema = 'public' and table_name = r.tbl and column_name <> all (r.secret);
    execute format('revoke select on public.%I from anon, authenticated', r.tbl);
    execute format('grant select (%s) on public.%I to authenticated', v_cols, r.tbl);
  end loop;
end $m$;

-- ---------------------------------------------------------------------
-- 2. Étape qui saute : revérification sous verrou
-- ---------------------------------------------------------------------
do $m$
begin
  if pg_get_functiondef('public.hg_lg__essayer(uuid)'::regprocedure) !~ 'for update' then
    perform public.hg__patch('public.hg_lg__essayer(uuid)'::regprocedure,
      $o$    exit when not (now() >= p.phase_fin or (p.phase <> 'debat' and hg_lg__complet(p_id)));
    perform hg_lg__avancer(p_id);$o$,
      $n$    exit when not (now() >= p.phase_fin or (p.phase <> 'debat' and hg_lg__complet(p_id)));
    -- Joueurs et tick appellent ensemble à l'échéance : on revérifie sous verrou, sinon le second appel
    -- ferait avancer l'étape suivante, qui vient tout juste de s'ouvrir.
    select * into p from hg_lg_parties where id = p_id for update;
    exit when p.statut not in ('revelation', 'en_cours') or p.phase_fin is null;
    exit when not (now() >= p.phase_fin or (p.phase <> 'debat' and hg_lg__complet(p_id)));
    perform hg_lg__avancer(p_id);$n$);
  end if;
end $m$;

-- ---------------------------------------------------------------------
-- 3. Canal des loups : plus de lecture par les morts du village
-- ---------------------------------------------------------------------
do $m$
begin
  if pg_get_functiondef('public.hg_lg_lit_canal(uuid, text)'::regprocedure) ~ 'or not j\.vivant' then
    perform public.hg__patch('public.hg_lg_lit_canal(uuid, text)'::regprocedure,
      $o$when 'loups' then (j.vivant and c.camp = 'loups') or (j.vivant and c.role = 'petite-fille') or not j.vivant$o$,
      $n$when 'loups' then c.camp = 'loups' or (j.vivant and c.role = 'petite-fille')   -- un loup mort garde le canal, pas les autres morts$n$);
  end if;
end $m$;

-- ---------------------------------------------------------------------
-- 4. « Passer » et Salvateur
-- ---------------------------------------------------------------------
do $m$
declare f regprocedure := 'public.hg_lg_agir(text, text, uuid, uuid, text)'::regprocedure;
begin
  if pg_get_functiondef(f) !~ 'protege_manche' then
    perform public.hg__patch(f,
      $o$  if p_type = 'proteger' then
    v_last := (c.etat->>'dernier_protege')::uuid;
    if p_cible = v_last then raise exception 'Tu ne peux pas protéger deux nuits de suite la même personne.'; end if;
    update hg_lg_cartes set etat = etat || jsonb_build_object('dernier_protege', p_cible) where partie = p.id and user_id = auth.uid();
  end if;$o$,
      $n$  if p_type = 'proteger' then
    -- Le protégé interdit est celui de la nuit d'avant : changer d'avis pendant la nuit ne le remplace pas.
    v_last := case when (c.etat->>'protege_manche')::int = p.manche then (c.etat->>'protege_avant')::uuid
                   else (c.etat->>'dernier_protege')::uuid end;
    if p_cible = v_last then raise exception 'Tu ne peux pas protéger deux nuits de suite la même personne.'; end if;
    update hg_lg_cartes set etat = etat || jsonb_build_object('dernier_protege', p_cible, 'protege_avant', v_last, 'protege_manche', p.manche)
      where partie = p.id and user_id = auth.uid();
  end if;$n$);
  end if;
  if pg_get_functiondef(f) !~ 'remplace un choix' then
    perform public.hg__patch(f,
      $o$  if not v_ok then raise exception 'Tu n''as pas d''action à faire maintenant.'; end if;$o$,
      $n$  if not v_ok then raise exception 'Tu n''as pas d''action à faire maintenant.'; end if;
  if p_type = 'passer' then
    -- « Passer » remplace un choix déjà fait à cette étape (sinon la cible choisie avant serait encore comptée).
    -- Les pouvoirs à effet immédiat (Voyante, Renard, Voleur, Cupidon, Chien-loup, Enfant sauvage) restent acquis.
    delete from hg_lg_actions where partie = p.id and manche = p.manche and etape = p.phase and user_id = auth.uid()
      and type in ('devorer', 'grand_mechant', 'corbeau', 'loup_blanc', 'proteger', 'sorciere', 'infecter', 'envouter', 'chasseur', 'succession');
    if (c.etat->>'protege_manche')::int = p.manche then
      update hg_lg_cartes set etat = (etat || jsonb_build_object('dernier_protege', etat->'protege_avant')) - 'protege_avant' - 'protege_manche'
        where partie = p.id and user_id = auth.uid();
    end if;
  end if;$n$);
  end if;
end $m$;

-- ---------------------------------------------------------------------
-- 5. Tick : pause oubliée, partie abandonnée, partie en erreur
-- ---------------------------------------------------------------------
create or replace function public.hg_lg_tick()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  -- Pause du meneur : notée au premier passage, levée seule au bout de 30 minutes (sinon un meneur parti fige la partie).
  update hg_lg_parties set etat = etat - 'pause_depuis' where pause_reste is null and etat ? 'pause_depuis';
  update hg_lg_parties set etat = etat || jsonb_build_object('pause_depuis', now())
    where statut = 'en_cours' and phase_fin is null and pause_reste is not null and not etat ? 'pause_depuis';
  for r in select id from hg_lg_parties where statut = 'en_cours' and pause_reste is not null
             and (etat->>'pause_depuis')::timestamptz < now() - interval '30 minutes' loop
    update hg_lg_parties set phase_fin = now() + make_interval(secs => pause_reste), pause_reste = null, etat = etat - 'pause_depuis'
      where id = r.id;
    perform hg_lg__log(r.id, 'info', 'La pause dure depuis 30 minutes : la partie reprend.');
    perform hg_lg__bump(r.id);
  end loop;
  -- Partie automatique abandonnée : trois manches sans élimination, et personne n'a agi ni voté depuis deux manches.
  for r in select p.id from hg_lg_parties p where p.statut = 'en_cours' and p.mode = 'auto'
             and p.manche >= coalesce((select max(j.mort_manche) from hg_lg_joueurs j where j.partie = p.id), 0) + 4
             and not exists (select 1 from hg_lg_actions a where a.partie = p.id and a.manche >= p.manche - 1)
             and not exists (select 1 from hg_lg_votes v where v.partie = p.id and v.manche >= p.manche - 1) loop
    perform hg_lg__log(r.id, 'info', 'Partie arrêtée : trois manches sans élimination et plus personne ne joue.');
    perform hg_lg__terminer(r.id, 'annulee');
  end loop;
  for r in select id from hg_lg_parties where statut in ('revelation', 'en_cours') and phase_fin is not null and phase_fin < now() loop
    begin
      if hg_lg__essayer(r.id) then n := n + 1; end if;
    exception when others then
      raise warning 'hg_lg_tick : partie % : %', r.id, sqlerrm;   -- une partie en erreur ne bloque plus les autres
    end;
  end loop;
  -- Salles d'attente abandonnées depuis 6 heures : annulées.
  update hg_lg_parties set statut = 'annulee', version = version + 1 where statut = 'attente' and created_at < now() - interval '6 hours';
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 7. Photos et moments masqués
-- ---------------------------------------------------------------------
create index if not exists hg_photos_masquees on public.hg_photos (path) where hidden_at is not null;
create index if not exists hg_moments_masques on public.hg_moments (image_path) where hidden_at is not null;

drop policy if exists hg_photos_obj_read on storage.objects;
create policy hg_photos_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'hg-photos' and public.hg_is_member() and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or public.hg_has_perm('souvenirs') or public.hg_has_perm('support')
    or (not exists (select 1 from public.hg_photos ph where ph.hidden_at is not null
                     and objects.name in (ph.path, ph.thumb_path, ph.path || '.thumb.webp'))
        and not exists (select 1 from public.hg_moments m where m.hidden_at is not null and m.image_path = objects.name))));

-- ---------------------------------------------------------------------
-- 8. Invitations : essais de code limités par appareil
-- ---------------------------------------------------------------------
-- Une ligne par code inconnu essayé ; l'adresse n'est gardée que sous forme d'empreinte, une heure au plus.
create table if not exists public.hg_invite_essais (
  cle text not null,
  at timestamptz not null default now()
);
create index if not exists hg_invite_essais_cle on public.hg_invite_essais (cle, at);
alter table public.hg_invite_essais enable row level security;
revoke all on public.hg_invite_essais from public, anon, authenticated;

-- Empreinte de l'appareil appelant (adresse IP transmise par PostgREST).
create or replace function public.hg_invite__cle()
returns text language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to(coalesce(nullif(h->>'cf-connecting-ip', ''),
    nullif(btrim(split_part(coalesce(h->>'x-forwarded-for', ''), ',', 1)), ''), 'inconnu'), 'UTF8')), 'hex')
  from (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb as h) s
$$;

create or replace function public.hg_invite__frein()
returns void language plpgsql security definer set search_path = public as $$
begin
  if random() < 0.05 then delete from hg_invite_essais where at < now() - interval '1 hour'; end if;
  if (select count(*) from hg_invite_essais where cle = hg_invite__cle() and at > now() - interval '10 minutes') >= 15 then
    raise exception 'Trop de codes de partie essayés : réessaie dans quelques minutes.';
  end if;
end $$;

create or replace function public.hg_invite__rate()
returns void language sql security definer set search_path = public as $$
  insert into hg_invite_essais(cle) values (hg_invite__cle())
$$;

revoke all on function public.hg_invite__cle() from public, anon, authenticated;
revoke all on function public.hg_invite__frein() from public, anon, authenticated;
revoke all on function public.hg_invite__rate() from public, anon, authenticated;

do $m$
declare f regprocedure;
begin
  foreach f in array array[
    'public.hg_lg_invite(text, text, text, jsonb)'::regprocedure,
    'public.hg_uno_invite(text, text, text, jsonb)'::regprocedure,
    'public.hg_ndc_invite(text, text, text, jsonb)'::regprocedure,
    'public.hg_duel_invite(text, text, text, jsonb)'::regprocedure,
    'public.hg_plat_invite(text, text, text, jsonb)'::regprocedure] loop
    if pg_get_functiondef(f) !~ 'hg_invite__frein' then
      perform public.hg__patch(f,
        $o$p_args := coalesce(p_args, '{}'::jsonb);$o$,
        $n$p_args := coalesce(p_args, '{}'::jsonb);
  if p_action in ('apercu', 'rejoindre') then perform public.hg_invite__frein(); end if;   -- codes à 4 chiffres : essais limités$n$);
      perform public.hg__patch(f,
        $o$if not found then
    if p_action = 'apercu' then return null; end if;
    raise exception 'Partie introuvable.';$o$,
        $n$if not found then
    -- Code inconnu : l'essai est compté (sans exception, sinon il serait annulé avec la transaction).
    if p_action in ('apercu', 'rejoindre') then perform public.hg_invite__rate(); return null; end if;
    raise exception 'Partie introuvable.';$n$);
    end if;
  end loop;
end $m$;

-- ---------------------------------------------------------------------
-- 9. Privilèges d'écriture inutiles (même logique que 105 et 106)
-- ---------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger
  on public.hg_jeux_bonus, public.hg_jeux_resultats, public.hg_presence, public.hg_site_notifs
  from anon, authenticated;
