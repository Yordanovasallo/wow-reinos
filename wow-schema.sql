-- ================================================================
-- REINOS DE AZEROTH - v2
-- SOLO EL PORTAL DE USUARIOS (entrar / crear cuenta).
-- Datos que se guardan: Nombre del rey, Nombre del reino y contraseña.
-- A partir de aquí iremos construyendo el juego paso a paso.
-- ================================================================

-- ---------- limpiar la versión anterior del juego (si existe) ----------
drop function if exists public._wow_tick(text);
drop function if exists public._wow_rate(text);
drop function if exists public._wow_cap(text);
drop function if exists public._wow_bcost(text, integer);
drop function if exists public._wow_btime(text, integer);
drop function if exists public._wow_bprod(text, integer);
drop function if exists public._wow_tcost(text);
drop function if exists public._wow_ttime(text);
drop function if exists public._wow_points(text);
drop function if exists public.wow_state(text);
drop function if exists public.wow_build(text, text);
drop function if exists public.wow_train(text, text, integer);
drop function if exists public.wow_leaderboard(text);
drop function if exists public.wow_map(text);
drop function if exists public.wow_alliance_create(text, text, text, text);
drop function if exists public.wow_alliance_join(text, text);
drop function if exists public.wow_alliance_leave(text);
drop function if exists public.wow_alliance_list(text);
drop function if exists public.wow_alliance_info(text, text);
drop function if exists public.wow_chat_send(text, text);
drop function if exists public.wow_chat(text, bigint);
drop table if exists public.wow_chat cascade;
drop table if exists public.wow_alliances cascade;
drop table if exists public.wow_queue cascade;
drop table if exists public.wow_troops cascade;
drop table if exists public.wow_buildings cascade;

-- portal (recrear limpio)
drop function if exists public._wow_key(text);
drop function if exists public._wow_sess(text);
drop function if exists public.wow_register(text, text, text, text, bigint);
drop function if exists public.wow_login(text, text);
drop function if exists public.wow_logout(text);
drop function if exists public.wow_check(text);
drop function if exists public.wow_salt(text);
drop function if exists public.wow_change_password(text, text, text);
drop table if exists public.wow_sessions cascade;
drop table if exists public.wow_users cascade;

-- ---------- tablas del portal ----------
create table public.wow_users(
  id text primary key,
  name text not null,               -- Nombre del rey (con esto se entra)
  realm text not null,              -- Nombre del reino (se muestra)
  name_key text not null unique,
  salt text not null,
  hash text not null,
  created bigint not null default 0
);
create table public.wow_sessions(
  id bigserial primary key,
  user_id text not null references public.wow_users(id) on delete cascade,
  token text not null unique,
  expires bigint not null default 0
);

alter table public.wow_users enable row level security;
alter table public.wow_sessions enable row level security;

-- ---------- utilidades ----------
create or replace function public._wow_key(p_name text)
returns text language sql immutable as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
$$;

create or replace function public._wow_sess(p_token text)
returns wow_users language plpgsql security definer set search_path to 'public' as $$
declare u wow_users;
begin
  select u2.* into u from wow_sessions s join wow_users u2 on u2.id = s.user_id
   where s.token = p_token and s.expires > (extract(epoch from now())*1000)::bigint
   limit 1;
  return u;
end $$;

revoke all on function public._wow_key(text) from public, anon, authenticated;
revoke all on function public._wow_sess(text) from public, anon, authenticated;

-- ---------- crear cuenta ----------
create or replace function public.wow_register(p_name text, p_realm text, p_salt text, p_hash text, p_now bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare vname text; vrealm text; vkey text;
begin
  vname := btrim(coalesce(p_name,''));
  vrealm := btrim(coalesce(p_realm,''));
  vkey := _wow_key(vname);
  if length(vkey) < 2 then raise exception 'Escribe tu nombre de rey (así entrarás después).'; end if;
  if length(vrealm) < 2 then raise exception 'Escribe el nombre de tu reino.'; end if;
  if coalesce(p_salt,'') = '' or coalesce(p_hash,'') = '' then raise exception 'Faltan datos de seguridad.'; end if;
  if exists(select 1 from wow_users where name_key = vkey) then
    raise exception 'Ese nombre de rey ya está en uso. Prueba con otro.'; end if;
  insert into wow_users (id, name, realm, name_key, salt, hash, created)
  values (vkey, vname, vrealm, vkey, p_salt, p_hash, coalesce(p_now, (extract(epoch from now())*1000)::bigint));
  return jsonb_build_object('ok', true, 'id', vkey);
end $$;

-- ---------- entrar ----------
create or replace function public.wow_login(p_name text, p_hash text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users; tok text; exp bigint;
begin
  select * into u from wow_users where name_key = _wow_key(p_name) limit 1;
  if u.id is null or u.hash <> p_hash then
    raise exception 'Nombre o contraseña incorrectos.'; end if;
  tok := md5(random()::text || clock_timestamp()::text);
  exp := (extract(epoch from now())*1000)::bigint + 30::bigint * 86400000;
  delete from wow_sessions where user_id = u.id;
  insert into wow_sessions (user_id, token, expires) values (u.id, tok, exp);
  return jsonb_build_object('ok', true, 'id', u.id, 'name', u.name, 'realm', u.realm, 'token', tok, 'expires', exp);
end $$;

-- ---------- salir ----------
create or replace function public.wow_logout(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  delete from wow_sessions where token = p_token;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- comprobar sesión ----------
create or replace function public.wow_check(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users;
begin
  u := _wow_sess(p_token);
  if u.id is null then return null; end if;
  return jsonb_build_object('id', u.id, 'name', u.name, 'realm', u.realm);
end $$;

-- ---------- salt del nombre (para calcular el hash en el navegador) ----------
create or replace function public.wow_salt(p_name text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare s text;
begin
  select salt into s from wow_users where name_key = _wow_key(p_name) limit 1;
  return coalesce(s, '');
end $$;

-- ---------- cambiar contraseña ----------
create or replace function public.wow_change_password(p_token text, p_salt text, p_hash text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users;
begin
  u := _wow_sess(p_token);
  if u.id is null then raise exception 'Sesión expirada. Vuelve a entrar.'; end if;
  if coalesce(p_salt,'') = '' or coalesce(p_hash,'') = '' then raise exception 'Faltan datos de seguridad.'; end if;
  update wow_users set salt = p_salt, hash = p_hash where id = u.id;
  delete from wow_sessions where user_id = u.id and token <> p_token;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.wow_register(text, text, text, text, bigint) to anon, authenticated;
grant execute on function public.wow_login(text, text) to anon, authenticated;
grant execute on function public.wow_logout(text) to anon, authenticated;
grant execute on function public.wow_check(text) to anon, authenticated;
grant execute on function public.wow_salt(text) to anon, authenticated;
grant execute on function public.wow_change_password(text, text, text) to anon, authenticated;
