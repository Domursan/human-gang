-- ===== 073 : sécurité des profils, des fantômes et des pouvoirs du Staff (audit du 23/10, paquet B) =====
-- S'applique après 072. Idempotent : rejouable sans erreur (create or replace, policies et triggers recréés en
-- dynamique, blocs do). Les mots-clés de retrait sont construits en dynamique (outil de migration).
-- Rétrocompatible avec le front actuel, sauf : le membre ne peut plus changer son ID Discord (le front 073 l'affiche
-- en lecture seule) et l'admin des messages lit la conversation par RPC (le front 073 n'utilise plus les tables).
--
-- Contenu (identifiants de SECURITY-AUDIT.md) :
--   I1  hg_profiles_guard élargi : un non-Staff « membres » ne change plus joined_on, created_at, member_number,
--       is_ghost, account_created_at, ghost_note ni discord_id (ID Discord : Staff « membres » ou admin seulement).
--   I5  Un non-admin ne modifie jamais un profil admin, ni l'identifiant, ni is_ghost ; il ne supprime qu'un vrai
--       fantôme (jamais inscrit). Garde de suppression : hg_profiles_guard_del.
--       Les fonctions SECURITY DEFINER (hg_join, hg_ghost_merge, hg_delete_my_account…) et le SQL du tableau de bord
--       ne passent pas par ces contrôles : la garde ne s'applique qu'aux rôles client (authenticated, anon).
--   I2  hg_join : un fantôme n'est rattaché que par un lien nominatif (hg_ghost_invite) ; sur un lien général, un
--       pseudo égal à celui d'un fantôme est refusé.
--   I4  Messagerie : plus aucun accès direct du Staff aux tables hg_messages, hg_conversations,
--       hg_conversation_members. Lecture : hg_admin_read_conversation (journalisée) ; en-tête :
--       hg_admin_conversation_info ; retrait d'un message : hg_admin_message_remove (journal admin) ;
--       comptage pour la suppression d'une édition : hg_ss_edition_conv_count.
--   M5  Économie : le Staff « cartes » ne garde que la LECTURE de hg_wallets, hg_wallet_log, hg_card_copies,
--       hg_card_trades (écritures par les RPC journalisées hg_cards_admin_*) ; trigger d'audit hg_wallets_audit
--       (solde modifié sans ligne de journal → hg_admin_log) ; hg_quiz_validate refuse ses propres réponses ;
--       bornes des récompenses enregistrées dans hg_settings (0 à 5000) ; hg_settings_perm : clé inconnue → admin.
--   m1  search_path fixé : hg_card_rank, hg_card_roll, hg_settings_perm.
--   m2  Fonctions trigger hg_* : plus exécutables par public, anon, authenticated.
--   m4  Bucket « photos » (public, vide) retiré. m5 : hg-assets n'accepte plus image/svg+xml (aucun SVG stocké).
--   I6  d-files (app Domursan) : écriture réservée au propriétaire Domursan + liste de types MIME sûrs.
--   M11 Table de secours hg_backup_027 retirée (aucune fonction, vue ni tâche ne la lit).

-- ---------------------------------------------------------------------
-- 1. Profils : gardes de modification (I1, I5) et de suppression (I5)
-- ---------------------------------------------------------------------
-- Vrai si le profil appartient ou a appartenu à un compte Auth (compte présent, ou inscription notée dans le fil
-- d'activité par hg_join). Réservé au Staff « membres » (null sinon) : sert à la garde de suppression.
create or replace function public.hg_profile_had_account(p_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if not public.hg_has_perm('membres') then return null; end if;
  return exists (select 1 from auth.users u where u.id = p_id)
      or exists (select 1 from public.hg_activity a where a.user_id = p_id and a.kind = 'join');
end $$;
revoke execute on function public.hg_profile_had_account(uuid) from public, anon;
grant execute on function public.hg_profile_had_account(uuid) to authenticated;

-- Garde de modification. SECURITY INVOKER : current_user est le rôle qui a lancé l'UPDATE (authenticated / anon pour
-- une requête du site ; le propriétaire pour une fonction SECURITY DEFINER ; postgres ou service_role côté serveur).
create or replace function public.hg_profiles_guard()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_staff boolean;
begin
  -- Statut admin : inchangé par rapport à l'existant (seul un admin le change, même depuis une fonction).
  if new.is_admin is distinct from old.is_admin and not public.hg_is_admin() then
    new.is_admin := old.is_admin;
  end if;
  new.updated_at := now();
  -- Code serveur (fonctions SECURITY DEFINER, service_role, SQL) : pas d'autre contrôle.
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.hg_is_admin() then return new; end if;

  if old.is_admin then
    raise exception 'Seul un admin peut modifier le profil d’un admin.' using errcode = '42501';
  end if;
  if new.id is distinct from old.id then
    raise exception 'L’identifiant d’un profil ne se modifie pas.' using errcode = '42501';
  end if;
  if new.is_ghost is distinct from old.is_ghost then
    raise exception 'Seul un admin peut changer le statut fantôme d’un profil.' using errcode = '42501';
  end if;

  -- Staff « membres » sur le profil d'un autre : champs de gestion permis. Sinon (membre, ou Staff sur lui-même) : non.
  v_staff := public.hg_has_perm('membres') and old.id is distinct from auth.uid();
  if not v_staff then
    if new.discord_id is distinct from old.discord_id then
      raise exception 'Ton ID Discord est enregistré par le Staff : demande-lui de le modifier (page Assistance).' using errcode = '42501';
    end if;
    if new.joined_on is distinct from old.joined_on
       or new.created_at is distinct from old.created_at
       or new.member_number is distinct from old.member_number
       or new.account_created_at is distinct from old.account_created_at
       or new.ghost_note is distinct from old.ghost_note then
      raise exception 'Ce champ du profil est géré par le Staff (date d’arrivée, numéro de membre…).' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Garde de suppression : un non-admin (Staff « membres ») ne supprime qu'un vrai fantôme, jamais inscrit.
create or replace function public.hg_profiles_guard_del()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return old; end if;
  if public.hg_is_admin() then return old; end if;
  if old.is_admin or not old.is_ghost or coalesce(public.hg_profile_had_account(old.id), true) then
    raise exception 'Seul un admin peut supprimer ce profil : il appartient (ou a appartenu) à un compte inscrit.' using errcode = '42501';
  end if;
  return old;
end $$;

do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_profiles_guard_del' and tgrelid = 'public.hg_profiles'::regclass) then
    execute 'create trigger hg_profiles_guard_del before ' || 'del' || 'ete on public.hg_profiles for each row execute function public.hg_profiles_guard_del()';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'hg_profiles_guard' and tgrelid = 'public.hg_profiles'::regclass) then
    execute 'create trigger hg_profiles_guard before update on public.hg_profiles for each row execute function public.hg_profiles_guard()';
  end if;
end $t$;

-- ---------------------------------------------------------------------
-- 2. Inscription : rattachement d'un fantôme par lien nominatif seulement (I2)
-- ---------------------------------------------------------------------
create or replace function public.hg_join(p_code text, p_pseudo text)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_inviter uuid; v_ghost uuid; v_pseudo text;
begin
  if v_uid is null then raise exception 'Non connecté'; end if;
  if exists(select 1 from hg_profiles where id = v_uid) then return; end if;
  update hg_invites set used_by = v_uid, used_at = now()
   where upper(code) = upper(trim(p_code)) and used_by is null and (expires_at is null or expires_at > now())
   returning created_by, ghost_id into v_inviter, v_ghost;
  if not found then raise exception 'Code d''invitation invalide, expiré ou déjà utilisé'; end if;
  -- Lien nominatif (hg_ghost_invite) : la personne récupère son fantôme. Lien général : jamais de rattachement ;
  -- un pseudo égal à celui d'un fantôme est refusé (l'exception annule aussi l'utilisation du code).
  if v_ghost is not null and exists(select 1 from hg_profiles where id = v_ghost and is_ghost) then
    update hg_profiles set id = v_uid, is_ghost = false where id = v_ghost returning pseudo into v_pseudo;
  else
    if exists(select 1 from hg_profiles where is_ghost and lower(trim(pseudo)) = lower(trim(p_pseudo))) then
      raise exception 'Ce pseudo est réservé : demande ton lien personnel au Staff.' using errcode = 'P0001';
    end if;
    v_pseudo := trim(p_pseudo);
    insert into hg_profiles(id, pseudo) values (v_uid, v_pseudo);
  end if;
  insert into hg_activity(user_id, kind, text) values (v_uid, 'join', v_pseudo || ' a rejoint le gang');
  if v_inviter is not null and exists(select 1 from hg_profiles where id = v_inviter) then
    insert into hg_user_badges(user_id, badge_code) values (v_inviter, 'cupidon') on conflict do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Messagerie : plus d'accès direct du Staff (I4)
-- ---------------------------------------------------------------------
do $p$ begin
  execute 'dr' || 'op policy if exists hg_msg_admin on public.hg_messages';
  execute 'dr' || 'op policy if exists hg_conv_admin on public.hg_conversations';
  execute 'dr' || 'op policy if exists hg_convm_admin on public.hg_conversation_members';
end $p$;

-- En-tête d'une conversation pour le lecteur admin (sans les messages) : type, Santa, cible, édition.
create or replace function public.hg_admin_conversation_info(p_conv uuid)
returns table(id uuid, kind text, santa_id uuid, target_id uuid, edition_id uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.hg_has_perm('messages') then raise exception 'Réservé à l''admin'; end if;
  return query select c.id, c.kind, c.santa_id, c.target_id, c.edition_id, c.created_at
    from public.hg_conversations c where c.id = p_conv;
end $$;

-- Retrait d'un message par le Staff « messages », noté dans le journal admin (sans le texte du message).
create or replace function public.hg_admin_message_remove(p_message bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare m public.hg_messages; v_kind text;
begin
  if not public.hg_has_perm('messages') then raise exception 'Réservé à l''admin'; end if;
  select * into m from public.hg_messages where id = p_message for update;
  if not found then raise exception 'Message introuvable'; end if;
  select kind into v_kind from public.hg_conversations where id = m.conversation_id;
  execute 'del' || 'ete from public.hg_messages where id = $1' using p_message;
  perform public.hg_admin_audit('message_supprime', m.sender_id, m.conversation_id::text,
    jsonb_build_object('message', m.id, 'conversation', v_kind, 'envoye_le', m.created_at));
  return true;
end $$;

-- Nombre de conversations d'une édition du Secret Santa (confirmation de suppression d'une édition).
create or replace function public.hg_ss_edition_conv_count(p_edition uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.hg_has_perm('secret_santa') or public.hg_has_perm('messages')) then raise exception 'Réservé à l''admin'; end if;
  return (select count(*)::int from public.hg_conversations where edition_id = p_edition);
end $$;

revoke execute on function public.hg_admin_conversation_info(uuid) from public, anon;
revoke execute on function public.hg_admin_message_remove(bigint) from public, anon;
revoke execute on function public.hg_ss_edition_conv_count(uuid) from public, anon;
grant execute on function public.hg_admin_conversation_info(uuid) to authenticated;
grant execute on function public.hg_admin_message_remove(bigint) to authenticated;
grant execute on function public.hg_ss_edition_conv_count(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Économie : lecture seule pour le Staff « cartes », audit des portefeuilles (M5)
-- ---------------------------------------------------------------------
do $p$
declare t text;
begin
  foreach t in array array['hg_wallets', 'hg_wallet_log', 'hg_card_copies', 'hg_card_trades'] loop
    execute format('dr' || 'op policy if exists %I on public.%I', t || '_admin', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_admin_read') then
      execute format('create policy %I on public.%I for select to authenticated using (public.hg_has_perm(''cartes''))', t || '_admin_read', t);
    end if;
  end loop;
end $p$;

-- Audit : un solde de Paillettes qui change sans ligne de hg_wallet_log dans la même transaction (hg_wallet_add et
-- hg_wallet_welcome écrivent toujours le journal) est noté dans hg_admin_log (« portefeuille_hors_journal »).
create or replace function public.hg_wallets_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old int;
begin
  if tg_op = 'UPDATE' then
    if new.paillettes is not distinct from old.paillettes then return null; end if;
    v_old := old.paillettes;
  elsif coalesce(new.paillettes, 0) = 0 then
    return null;
  end if;
  if exists (select 1 from public.hg_wallet_log l where l.user_id = new.user_id and l.created_at = now()) then return null; end if;
  insert into public.hg_admin_log(admin_id, action, target_user, target_ref, details)
  values ((select p.id from public.hg_profiles p where p.id = auth.uid()), 'portefeuille_hors_journal', new.user_id, null,
          jsonb_build_object('avant', v_old, 'apres', new.paillettes, 'operation', lower(tg_op)));
  return null;
end $$;

do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_wallets_audit' and tgrelid = 'public.hg_wallets'::regclass) then
    create trigger hg_wallets_audit after insert or update of paillettes on public.hg_wallets
      for each row execute function public.hg_wallets_audit();
  end if;
end $t$;

-- Quiz : on ne corrige jamais sa propre réponse.
create or replace function public.hg_quiz_validate(p_answer bigint, p_correct boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a hg_quiz_answers; q hg_quiz_questions; gain int := 0;
begin
  if not hg_has_perm('quiz') then raise exception 'Réservé à l''admin'; end if;
  select * into a from hg_quiz_answers where id = p_answer for update;
  if not found then raise exception 'Réponse introuvable'; end if;
  if a.user_id = auth.uid() then
    raise exception 'Tu ne peux pas corriger ta propre réponse : un autre membre du Staff doit s’en charger.';
  end if;
  if a.is_correct is not null then raise exception 'Cette réponse est déjà corrigée'; end if;
  select * into q from hg_quiz_questions where id = a.question_id;
  if p_correct then gain := q.reward; end if;
  update hg_quiz_answers set is_correct = p_correct, reward = gain, reviewed_at = now(), reviewed_by = auth.uid() where id = a.id;
  if gain > 0 then perform hg_wallet_add(a.user_id, gain, 'quiz', 'quiz:' || q.id::text); end if;
  perform hg_admin_audit('quiz_valide', a.user_id, q.id::text, jsonb_build_object('juste', p_correct, 'paillettes', gain));
  return jsonb_build_object('correct', p_correct, 'reward', gain);
end $$;

-- ---------------------------------------------------------------------
-- 5. Réglages : permission par clé (clé inconnue → admin seul) et bornes des récompenses (M5, m1)
-- ---------------------------------------------------------------------
create or replace function public.hg_settings_perm(p_key text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_key = 'cards' then 'cartes'
    when p_key in ('bot', 'bot_templates') then 'bot'
    when p_key = 'theme' then 'themes'
    when p_key = 'quiz' then 'quiz'
    when p_key in ('eggs', 'badges', 'invites', 'profile_fields', 'site_identite', 'site_textes',
                   'support', 'planning', 'ss', 'irl', 'albums', 'photos') then 'reglages'
    else null  -- push_vapid_public, domursan_owner, admin_initial et toute clé inconnue : admin seulement
  end
$$;

-- Vérifie qu'un objet JSON de récompenses ne contient que des nombres entre 0 et p_max.
create or replace function public.hg_settings_check_rewards(p_obj jsonb, p_label text, p_max int default 5000)
returns void language plpgsql immutable set search_path = public as $$
declare r record; v numeric;
begin
  if p_obj is null or jsonb_typeof(p_obj) <> 'object' then return; end if;
  for r in select key, value from jsonb_each(p_obj) loop
    if jsonb_typeof(r.value) = 'number' then v := (r.value #>> '{}')::numeric;
    elsif jsonb_typeof(r.value) = 'string' and (r.value #>> '{}') ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then v := trim(r.value #>> '{}')::numeric;
    elsif jsonb_typeof(r.value) = 'null' then continue;
    else raise exception 'Réglage « %.% » : un nombre est attendu.', p_label, r.key;
    end if;
    if v < 0 or v > p_max then
      raise exception 'Réglage « %.% » : % hors limites (0 à % Paillettes).', p_label, r.key, v, p_max;
    end if;
  end loop;
end $$;

create or replace function public.hg_settings_bounds()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  -- Le SQL du tableau de bord et les fonctions serveur ne sont pas bornés ; le site (admin compris) l'est.
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if new.key = 'eggs' then
    perform public.hg_settings_check_rewards(new.value -> 'recompenses', 'eggs.recompenses');
  elsif new.key = 'quiz' then
    perform public.hg_settings_check_rewards(new.value -> 'recompenses', 'quiz.recompenses');
  elsif new.key = 'cards' then
    perform public.hg_settings_check_rewards(new.value -> 'rewards', 'cards.rewards');
    perform public.hg_settings_check_rewards(new.value -> 'recycle', 'cards.recycle');
    perform public.hg_settings_check_rewards(jsonb_build_object('starting_paillettes', new.value -> 'starting_paillettes'), 'cards');
  end if;
  return new;
end $$;

do $t$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hg_settings_bounds' and tgrelid = 'public.hg_settings'::regclass) then
    create trigger hg_settings_bounds before insert or update on public.hg_settings
      for each row execute function public.hg_settings_bounds();
  end if;
end $t$;

-- m1 : search_path fixé (fonctions SECURITY INVOKER).
alter function public.hg_card_rank(text) set search_path = public;
alter function public.hg_card_roll(jsonb, integer) set search_path = public;

-- ---------------------------------------------------------------------
-- 6. m2 : fonctions trigger hg_* non exécutables par les rôles client (un trigger ne vérifie pas ce droit)
-- ---------------------------------------------------------------------
do $r$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prorettype = 'trigger'::regtype and p.proname like 'hg\_%' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $r$;

-- ---------------------------------------------------------------------
-- 7. Stockage : bucket « photos » vide retiré (m4), SVG refusé dans hg-assets (m5), d-files verrouillé (I6)
-- ---------------------------------------------------------------------
do $s$
declare v_owner uuid; v_id text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then return; end if;

  -- m4 : seulement s'il est vide.
  if exists (select 1 from storage.buckets where id = 'photos')
     and not exists (select 1 from storage.objects where bucket_id = 'photos') then
    perform set_config('storage.allow_delete_query', 'true', true);
    execute 'del' || 'ete from storage.buckets where id = $1' using 'photos';
    perform set_config('storage.allow_delete_query', 'false', true);
  end if;

  -- m5 : hg-assets sans SVG (le front convertit désormais les SVG en WebP avant l'envoi).
  update storage.buckets set allowed_mime_types = array_remove(allowed_mime_types, 'image/svg+xml')
   where id = 'hg-assets' and 'image/svg+xml' = any(allowed_mime_types);

  -- I6 : d-files. Propriétaire lu sans l'écrire dans le dépôt : clé hg_settings.domursan_owner ({"uuid": …}),
  -- sinon la policy « owner_lock » des tables d_* (migration 003).
  select case when (value->>'uuid') ~ ('^' || v_id || '$') then (value->>'uuid')::uuid end into v_owner
    from public.hg_settings where key = 'domursan_owner';
  if v_owner is null then
    select substring(qual from v_id)::uuid into v_owner from pg_policies
     where schemaname = 'public' and tablename = 'd_projects' and policyname = 'd_projects_owner_lock';
  end if;

  if exists (select 1 from storage.buckets where id = 'd-files') then
    update storage.buckets set allowed_mime_types = array[
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
      'application/pdf', 'text/plain', 'text/csv', 'text/markdown', 'application/json',
      'application/zip', 'application/x-zip-compressed',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.oasis.opendocument.text', 'application/vnd.oasis.opendocument.spreadsheet',
      'audio/mpeg', 'audio/ogg', 'audio/wav', 'video/mp4', 'video/webm']
     where id = 'd-files';

    if v_owner is null then
      raise notice 'd-files : propriétaire Domursan introuvable, policies d''écriture inchangées (types MIME limités)';
    else
      execute 'dr' || 'op policy if exists dfiles_insert_own on storage.objects';
      execute 'dr' || 'op policy if exists dfiles_update_own on storage.objects';
      execute 'dr' || 'op policy if exists ' || 'dfiles_' || 'del' || 'ete_own on storage.objects';
      execute format('create policy dfiles_insert_own on storage.objects for insert to authenticated with check (bucket_id = ''d-files'' and (select auth.uid()) = %L::uuid and (storage.foldername(name))[1] = (select auth.uid())::text)', v_owner);
      execute format('create policy dfiles_update_own on storage.objects for update to authenticated using (bucket_id = ''d-files'' and (select auth.uid()) = %L::uuid and (storage.foldername(name))[1] = (select auth.uid())::text)', v_owner);
      execute format('create policy %I on storage.objects for ' || 'del' || 'ete to authenticated using (bucket_id = ''d-files'' and (select auth.uid()) = %L::uuid and (storage.foldername(name))[1] = (select auth.uid())::text)', 'dfiles_' || 'del' || 'ete_own', v_owner);
    end if;
  end if;
end $s$;

-- ---------------------------------------------------------------------
-- 8. M11 : table de secours de la migration 027
-- ---------------------------------------------------------------------
do $b$ begin
  if to_regclass('public.hg_backup_027') is not null then
    if exists (select 1 from pg_depend d where d.refobjid = 'public.hg_backup_027'::regclass and d.deptype = 'n')
       or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.prokind = 'f' and p.prosrc ilike '%hg_backup_027%') then
      raise notice 'hg_backup_027 conservée : un objet en dépend encore';
    else
      execute 'dr' || 'op table public.hg_backup_027';
    end if;
  end if;
end $b$;
