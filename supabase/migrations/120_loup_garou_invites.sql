-- ===== Humane Gang — migration 120 : Loup-Garou, mode invité (amis de passage, sans compte) =====
-- Un invité n'a PAS de compte Supabase (pas de connexion anonyme : le reste du site reste fermé).
-- Il rejoint une partie qui accepte les invités avec un pseudo ; le serveur lui remet un jeton secret
-- (gardé dans son navigateur). Ensuite, chaque appel passe par hg_lg_invite(action, code, jeton, args) :
-- le jeton est vérifié, l'invité est identifié le temps de la requête, puis la fonction du jeu est appelée.
-- Seules les actions de jeu sont permises (pas de création de partie ni de réglages). Pas de Paillettes ni de badges.
-- Rétrocompatible : n'ajoute qu'une table et une fonction ; hg_lg_peut accepte en plus les invités.

create table if not exists public.hg_lg_invites (
  user_id uuid primary key,                                  -- identifiant de l'invité (aucun compte derrière)
  partie uuid not null references public.hg_lg_parties(id) on delete cascade,
  pseudo text not null,
  jeton_hash text not null unique,                           -- sha256 du jeton ; le jeton lui-même n'est jamais stocké
  created_at timestamptz not null default now()
);
alter table public.hg_lg_invites enable row level security;  -- aucune règle : lecture et écriture via les fonctions seulement
revoke all on public.hg_lg_invites from anon, authenticated;

-- Accès au jeu : page accessible, compte testeur, ou invité identifié par son jeton (dans hg_lg_invite seulement).
create or replace function public.hg_lg_peut()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (
    public.hg_page_ok(auth.uid(), 'loup-garou')
    or exists (select 1 from hg_settings s where s.key = 'loup_garou'
               and coalesce(s.value->'testeurs', '[]'::jsonb) ? auth.uid()::text)
    or exists (select 1 from hg_lg_invites i where i.user_id = auth.uid()))
$$;
revoke all on function public.hg_lg_peut() from public, anon;
grant execute on function public.hg_lg_peut() to authenticated;

-- Identifie l'invité pour le reste de la requête (auth.uid() renverra son identifiant).
create or replace function public.hg_lg__devenir(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;
revoke all on function public.hg_lg__devenir(uuid) from public, anon, authenticated;

-- Point d'entrée des invités.
--   apercu    (sans jeton)                → { nom, statut, invites, nb_joueurs, inscrits, mode, hote_pseudo } ou null
--   rejoindre (sans jeton, args.pseudo)   → { jeton, code }
--   etat | pret {pret} | vu | quitter | agir {type, cible, cible2, choix} | voter {cible} | message {canal, texte}
--   | avancer | messages {apres?}         (avec jeton)
create or replace function public.hg_lg_invite(p_action text, p_code text, p_jeton text default null, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p hg_lg_parties; inv hg_lg_invites; v_uid uuid; v_jeton text; v_pseudo text; v_out jsonb;
begin
  p_args := coalesce(p_args, '{}'::jsonb);
  select * into p from hg_lg_parties where code = upper(trim(coalesce(p_code, ''))) order by created_at desc limit 1;
  if not found then
    if p_action = 'apercu' then return null; end if;
    raise exception 'Partie introuvable.';
  end if;

  if p_action = 'apercu' then
    return jsonb_build_object('nom', p.nom, 'code', p.code, 'statut', p.statut, 'invites', p.invites, 'nb_joueurs', p.nb_joueurs,
      'inscrits', (select count(*) from hg_lg_joueurs where partie = p.id), 'mode', p.mode,
      'hote_pseudo', coalesce((select pseudo from hg_profiles where id = p.hote), '?'));
  end if;

  if p_action = 'rejoindre' then
    if not p.invites then raise exception 'Cette partie n''accepte pas les invités.'; end if;
    if p.statut <> 'attente' then raise exception 'La partie a déjà commencé.'; end if;
    v_pseudo := trim(coalesce(p_args->>'pseudo', ''));
    if char_length(v_pseudo) not between 2 and 24 then raise exception 'Choisis un pseudo de 2 à 24 caractères.'; end if;
    if (select count(*) from hg_lg_invites where partie = p.id) >= p.nb_joueurs then raise exception 'La partie est complète.'; end if;
    v_uid := gen_random_uuid();
    v_jeton := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    insert into hg_lg_invites(user_id, partie, pseudo, jeton_hash) values (v_uid, p.id, v_pseudo, encode(sha256(convert_to(v_jeton, 'UTF8')), 'hex'));
    perform hg_lg__devenir(v_uid);
    perform hg_lg_rejoindre(p.code, v_pseudo);       -- complet, pseudo pris… : l'erreur annule aussi l'invité
    return jsonb_build_object('jeton', v_jeton, 'code', p.code, 'user_id', v_uid);
  end if;

  -- Toutes les autres actions : jeton obligatoire et lié à CETTE partie
  select * into inv from hg_lg_invites where jeton_hash = encode(sha256(convert_to(coalesce(p_jeton, ''), 'UTF8')), 'hex');
  if not found or inv.partie <> p.id then raise exception 'Invitation expirée : rejoins à nouveau la partie.' using errcode = '42501'; end if;
  perform hg_lg__devenir(inv.user_id);

  case p_action
    when 'etat' then v_out := hg_lg_etat(p.code);
    when 'pret' then perform hg_lg_pret(p.code, coalesce((p_args->>'pret')::boolean, true));
    when 'vu' then perform hg_lg_vu(p.code);
    when 'quitter' then perform hg_lg_quitter(p.code);
    when 'agir' then perform hg_lg_agir(p.code, p_args->>'type', nullif(p_args->>'cible', '')::uuid, nullif(p_args->>'cible2', '')::uuid, p_args->>'choix');
    when 'voter' then perform hg_lg_voter(p.code, nullif(p_args->>'cible', '')::uuid);
    when 'message' then perform hg_lg_message(p.code, p_args->>'canal', p_args->>'texte');
    when 'avancer' then perform hg_lg_avancer(p.code, false);
    when 'messages' then
      select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'canal', m.canal, 'user_id', m.user_id, 'texte', m.texte, 'created_at', m.created_at)
                                order by m.created_at), '[]'::jsonb) into v_out
        from (select * from hg_lg_messages m
               where m.partie = p.id and hg_lg_lit_canal(p.id, m.canal)
                 and (p_args->>'apres' is null or m.created_at > (p_args->>'apres')::timestamptz)
               order by m.created_at desc limit 200) m;
    else raise exception 'Action inconnue.';
  end case;
  return v_out;
end $$;
revoke all on function public.hg_lg_invite(text, text, text, jsonb) from public;
grant execute on function public.hg_lg_invite(text, text, text, jsonb) to anon, authenticated;
