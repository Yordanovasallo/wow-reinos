-- ================================================================
-- REINOS DE AZEROTH (tema WoW, estilo Xnova/OGame)
--   - Cada jugador es un reino con recursos que suben solos
--   - Edificios mejorable con temporizador (cola de construcción)
--   - Tropas que se entrenan con cola
--   - Ranking de todos los reinos (multijugador; ataques en la v2)
-- Recursos: Oro, Madera, Mineral. Facción: Alianza / Horda.
-- ================================================================

-- ---------- empezar de cero ----------
drop function if exists public._wow_key(text);
drop function if exists public._wow_sess(text);
drop function if exists public._wow_bcost(text, integer);
drop function if exists public._wow_btime(text, integer);
drop function if exists public._wow_bprod(text, integer);
drop function if exists public._wow_cap(text);
drop function if exists public._wow_rate(text);
drop function if exists public._wow_tcost(text);
drop function if exists public._wow_ttime(text);
drop function if exists public._wow_tick(text);
drop function if exists public.wow_register(text, text, text, text, bigint);
drop function if exists public.wow_register(text, text, text, text, text, bigint);
drop function if exists public.wow_login(text, text);
drop function if exists public.wow_logout(text);
drop function if exists public.wow_check(text);
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
drop function if exists public.wow_buildings(text);
drop table if exists public.wow_chat cascade;
drop table if exists public.wow_alliances cascade;
drop table if exists public.wow_queue cascade;
drop table if exists public.wow_troops cascade;
drop table if exists public.wow_buildings cascade;
drop table if exists public.wow_sessions cascade;
drop table if exists public.wow_users cascade;

-- ---------- tablas ----------
create table public.wow_users(
  id text primary key,
  name text not null,
  name_key text not null unique,
  faction text not null default 'alianza',
  salt text not null,
  hash text not null,
  active boolean not null default true,
  created bigint not null default 0,
  last_ms bigint not null default 0,
  gold numeric(16,2) not null default 500,
  wood numeric(16,2) not null default 500,
  ore numeric(16,2) not null default 500,
  pos integer not null default 0,
  alliance text
);
create table public.wow_sessions(
  id bigserial primary key,
  user_id text not null references public.wow_users(id) on delete cascade,
  token text not null unique,
  expires bigint not null default 0
);
create table public.wow_buildings(
  owner_id text not null references public.wow_users(id) on delete cascade,
  bkey text not null,
  level integer not null default 0,
  finish_ms bigint not null default 0,
  primary key (owner_id, bkey)
);
create table public.wow_troops(
  owner_id text not null references public.wow_users(id) on delete cascade,
  tkey text not null,
  qty integer not null default 0,
  primary key (owner_id, tkey)
);
create table public.wow_queue(
  owner_id text primary key references public.wow_users(id) on delete cascade,
  kind text not null default '',
  ref text not null default '',
  qty integer not null default 0,
  unit_ms bigint not null default 0,
  start_ms bigint not null default 0,
  finish_ms bigint not null default 0
);
create table public.wow_alliances(
  id text primary key,
  name text not null,
  tag text not null,
  leader text not null,
  created bigint not null default 0,
  descr text not null default ''
);
create table public.wow_chat(
  id bigserial primary key,
  alliance text not null references public.wow_alliances(id) on delete cascade,
  user_id text not null,
  name text not null,
  msg text not null,
  created bigint not null default 0
);

alter table public.wow_users enable row level security;
alter table public.wow_sessions enable row level security;
alter table public.wow_buildings enable row level security;
alter table public.wow_troops enable row level security;
alter table public.wow_queue enable row level security;
alter table public.wow_alliances enable row level security;
alter table public.wow_chat enable row level security;

-- ---------- utilidades ----------
create or replace function public._wow_key(p_name text)
returns text
language sql immutable as $$
  select lower(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'))
$$;

create or replace function public._wow_sess(p_token text)
returns wow_users
language plpgsql security definer set search_path to 'public' as $$
declare u wow_users;
begin
  select u2.* into u from wow_sessions s join wow_users u2 on u2.id = s.user_id
   where s.token = p_token and s.expires > (extract(epoch from now())*1000)::bigint and u2.active
   limit 1;
  return u;
end $$;

revoke all on function public._wow_key(text) from public, anon, authenticated;
revoke all on function public._wow_sess(text) from public, anon, authenticated;

-- ---------- configuración del juego ----------
-- costo del siguiente nivel de un edificio (factor 1.55 por nivel)
create or replace function public._wow_bcost(p_key text, p_level integer)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'gold', round((case p_key
      when 'mina' then 0 when 'aserradero' then 0 when 'tesoreria' then 80
      when 'almacen' then 50 when 'cuartel' then 70 when 'muralla' then 90 else 0 end) * power(1.55, p_level)),
    'wood', round((case p_key
      when 'mina' then 40 when 'aserradero' then 60 when 'tesoreria' then 60
      when 'almacen' then 50 when 'cuartel' then 70 when 'muralla' then 60 else 0 end) * power(1.55, p_level)),
    'ore',  round((case p_key
      when 'mina' then 60 when 'aserradero' then 40 when 'tesoreria' then 40
      when 'almacen' then 50 when 'cuartel' then 50 when 'muralla' then 80 else 0 end) * power(1.55, p_level)))
$$;

-- segundos que tarda subir de nivel (factor 1.4 por nivel)
create or replace function public._wow_btime(p_key text, p_level integer)
returns integer language sql immutable as $$
  select greatest(round((case p_key
    when 'mina' then 20 when 'aserradero' then 20 when 'tesoreria' then 25
    when 'almacen' then 30 when 'cuartel' then 35 when 'muralla' then 40 else 30 end) * power(1.4, p_level)), 1)
$$;

-- por hora: oro (tesorería), madera (aserradero), mineral (mina) / capacidad (almacén)
create or replace function public._wow_bprod(p_key text, p_level integer)
returns numeric language sql immutable as $$
  select case when p_key = 'almacen' then 2000 + 1500 * p_level
              when p_key in ('mina','aserradero','tesoreria') then 30 + 25 * p_level
              else 0 end
$$;

create or replace function public._wow_cap(p_owner text)
returns numeric language plpgsql security definer set search_path to 'public' as $$
declare lv integer;
begin
  select coalesce(max(level),0) into lv from wow_buildings where owner_id = p_owner and bkey = 'almacen';
  return 2000 + 1500 * lv;
end $$;

create or replace function public._wow_rate(p_owner text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare g integer; w integer; o integer;
begin
  select coalesce(max(case when bkey='tesoreria' then level end),0),
         coalesce(max(case when bkey='aserradero' then level end),0),
         coalesce(max(case when bkey='mina' then level end),0)
    into g,w,o from wow_buildings where owner_id = p_owner;
  return jsonb_build_object('gold', 30+25*g, 'wood', 30+25*w, 'ore', 30+25*o);
end $$;

-- costo por unidad de tropa
create or replace function public._wow_tcost(p_key text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'gold', (case p_key when 'soldado' then 40 when 'arquero' then 50 when 'jinete' then 80 when 'mago' then 120 else 0 end),
    'wood', (case p_key when 'soldado' then 20 when 'arquero' then 40 when 'jinete' then 30 when 'mago' then 20 else 0 end),
    'ore',  (case p_key when 'soldado' then 30 when 'arquero' then 20 when 'jinete' then 60 when 'mago' then 100 else 0 end))
$$;

-- segundos por unidad entrenada
create or replace function public._wow_ttime(p_key text)
returns integer language sql immutable as $$
  select case p_key when 'soldado' then 6 when 'arquero' then 8 when 'jinete' then 12 when 'mago' then 18 else 10 end
$$;

revoke all on function public._wow_bcost(text, integer) from public, anon, authenticated;
revoke all on function public._wow_btime(text, integer) from public, anon, authenticated;
revoke all on function public._wow_bprod(text, integer) from public, anon, authenticated;
revoke all on function public._wow_cap(text) from public, anon, authenticated;
revoke all on function public._wow_rate(text) from public, anon, authenticated;
revoke all on function public._wow_tcost(text) from public, anon, authenticated;
revoke all on function public._wow_ttime(text) from public, anon, authenticated;

-- ---------- avance del tiempo (recursos + cola) ----------
create or replace function public._wow_tick(p_owner text)
returns wow_users
language plpgsql security definer set search_path to 'public' as $$
declare u wow_users; ms bigint; el numeric; cap numeric; rate jsonb; q wow_queue; done integer;
begin
  select * into u from wow_users where id = p_owner for update;
  if u.id is null then return u; end if;
  ms := (extract(epoch from now())*1000)::bigint;
  el := greatest(ms - u.last_ms, 0)::numeric;

  select * into q from wow_queue where owner_id = p_owner;
  if q is not null and q.owner_id is not null then
    if q.kind = 'build' and q.finish_ms <= ms then
      update wow_buildings set level = level + 1, finish_ms = 0
       where owner_id = p_owner and bkey = q.ref;
      delete from wow_queue where owner_id = p_owner;
    elsif q.kind = 'train' and q.unit_ms > 0 then
      done := least(q.qty, floor((ms - q.start_ms) / q.unit_ms));
      if done > 0 then
        insert into wow_troops(owner_id, tkey, qty) values (p_owner, q.ref, done)
          on conflict (owner_id, tkey) do update set qty = wow_troops.qty + excluded.qty;
        update wow_queue set qty = qty - done, start_ms = start_ms + done * unit_ms
         where owner_id = p_owner and kind = 'train';
        select * into q from wow_queue where owner_id = p_owner;
        if q.qty <= 0 then delete from wow_queue where owner_id = p_owner; end if;
      end if;
    end if;
  end if;

  select * into q from wow_queue where owner_id = p_owner;
  rate := _wow_rate(p_owner);
  cap := _wow_cap(p_owner);
  update wow_users set
      gold = least(u.gold + el/3600000.0 * (rate->>'gold')::numeric, cap),
      wood = least(u.wood + el/3600000.0 * (rate->>'wood')::numeric, cap),
      ore  = least(u.ore  + el/3600000.0 * (rate->>'ore')::numeric, cap),
      last_ms = ms
    where id = p_owner returning * into u;
  return u;
end $$;

revoke all on function public._wow_tick(text) from public, anon, authenticated;

-- ---------- cuenta ----------
create or replace function public.wow_register(p_name text, p_realm text, p_faction text, p_salt text, p_hash text, p_now bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare vname text; vrealm text; vkey text; vfac text;
begin
  vname := btrim(coalesce(p_name,'')); vkey := _wow_key(vname); vrealm := btrim(coalesce(p_realm,''));
  if length(vkey) < 2 then raise exception 'Escribe un nombre de rey (así entrarás después).'; end if;
  if length(vrealm) < 2 then raise exception 'Escribe el nombre de tu reino.'; end if;
  vfac := lower(btrim(coalesce(p_faction,'')));
  if vfac not in ('alianza','horda') then raise exception 'Elige Alianza o Horda.'; end if;
  if coalesce(p_salt,'') = '' or coalesce(p_hash,'') = '' then raise exception 'Faltan datos de seguridad.'; end if;
  if exists(select 1 from wow_users where name_key = vkey) then
    raise exception 'Ese nombre de rey ya está en uso. Prueba con otro.'; end if;
  insert into wow_users (id, name, name_key, faction, salt, hash, active, created, last_ms, gold, wood, ore, pos, alliance)
  values (vkey, vrealm, vkey, vfac, p_salt, p_hash, true, p_now, p_now, 500, 500, 500,
          (select coalesce(max(pos), -1) + 1 from wow_users), null);
  return jsonb_build_object('ok', true, 'id', vkey);
end $$;

create or replace function public.wow_login(p_name text, p_hash text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users; tok text; exp bigint;
begin
  select * into u from wow_users where name_key = _wow_key(p_name) limit 1;
  if u.id is null or u.hash <> p_hash or not u.active then
    raise exception 'Nombre o contraseña incorrectos.'; end if;
  tok := md5(random()::text || clock_timestamp()::text);
  exp := (extract(epoch from now())*1000)::bigint + 30::bigint * 86400000;
  delete from wow_sessions where user_id = u.id;
  insert into wow_sessions (user_id, token, expires) values (u.id, tok, exp);
  return jsonb_build_object('ok', true, 'id', u.id, 'name', u.name, 'faction', u.faction, 'token', tok, 'expires', exp);
end $$;

create or replace function public.wow_logout(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  delete from wow_sessions where token = p_token;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.wow_check(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users;
begin
  u := _wow_sess(p_token);
  if u.id is null then return null; end if;
  return jsonb_build_object('id', u.id, 'name', u.name, 'faction', u.faction);
end $$;

grant execute on function public.wow_register(text, text, text, text, text, bigint) to anon, authenticated;
grant execute on function public.wow_login(text, text) to anon, authenticated;
grant execute on function public.wow_logout(text) to anon, authenticated;
grant execute on function public.wow_check(text) to anon, authenticated;

-- ---------- estado del reino ----------
create or replace function public.wow_state(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users; blds jsonb; trs jsonb; que jsonb; cap numeric; rate jsonb; ms bigint; pts integer;
begin
  u := _wow_sess(p_token);
  if u.id is null then raise exception 'Sesión expirada. Vuelve a entrar.'; end if;
  u := _wow_tick(u.id);
  cap := _wow_cap(u.id); rate := _wow_rate(u.id);
  ms := (extract(epoch from now())*1000)::bigint;
  select coalesce(jsonb_agg(jsonb_build_object('key', v.k, 'level', coalesce(b.level,0),
             'cost', _wow_bcost(v.k, coalesce(b.level,0)), 'time', _wow_btime(v.k, coalesce(b.level,0)),
             'prod', _wow_bprod(v.k, coalesce(b.level,0))) order by v.ord), '[]') into blds
    from (values ('mina',1),('aserradero',2),('tesoreria',3),('almacen',4),('cuartel',5),('muralla',6)) v(k,ord)
    left join wow_buildings b on b.owner_id = u.id and b.bkey = v.k;
  select coalesce(jsonb_agg(jsonb_build_object('key', v.t, 'qty', coalesce(t.qty,0),
             'cost', _wow_tcost(v.t), 'time', _wow_ttime(v.t)) order by v.ord), '[]') into trs
    from (values ('soldado',1),('arquero',2),('jinete',3),('mago',4)) v(t,ord)
    left join wow_troops t on t.owner_id = u.id and t.tkey = v.t;
  select jsonb_build_object('kind', q.kind, 'ref', q.ref, 'qty', q.qty, 'unit_ms', q.unit_ms,
           'start', q.start_ms, 'finish', q.finish_ms) into que
    from wow_queue q where q.owner_id = u.id;
  pts := (select coalesce(sum(level),0) from wow_buildings where owner_id = u.id) * 100
       + (select coalesce(sum(qty),0) from wow_troops where owner_id = u.id);
  return jsonb_build_object('id', u.id, 'name', u.name, 'faction', u.faction,
    'gold', u.gold, 'wood', u.wood, 'ore', u.ore, 'capacity', cap, 'rate', rate,
    'buildings', blds, 'troops', trs, 'queue', que, 'points', pts, 'now', ms,
    'alliance', u.alliance,
    'ally_tag', coalesce((select tag from wow_alliances where id = u.alliance), ''));
end $$;

grant execute on function public.wow_state(text) to anon, authenticated;

-- ---------- construir ----------
create or replace function public.wow_build(p_token text, p_key text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users; lvl integer; c jsonb; t integer; ms bigint;
begin
  u := _wow_sess(p_token);
  if u.id is null then raise exception 'Sesión expirada. Vuelve a entrar.'; end if;
  u := _wow_tick(u.id);
  if exists(select 1 from wow_queue where owner_id = u.id) then
    raise exception 'Ya tienes algo en construcción.'; end if;
  if coalesce(p_key,'') not in ('mina','aserradero','tesoreria','almacen','cuartel','muralla') then
    raise exception 'Edificio no válido.'; end if;
  select coalesce(max(level),0) into lvl from wow_buildings where owner_id = u.id and bkey = p_key;
  c := _wow_bcost(p_key, lvl);
  if u.gold < (c->>'gold')::numeric then raise exception 'No tienes suficiente Oro.'; end if;
  if u.wood < (c->>'wood')::numeric then raise exception 'No tienes suficiente Madera.'; end if;
  if u.ore < (c->>'ore')::numeric then raise exception 'No tienes suficiente Mineral.'; end if;
  update wow_users set gold = gold - (c->>'gold')::numeric, wood = wood - (c->>'wood')::numeric,
         ore = ore - (c->>'ore')::numeric where id = u.id;
  t := _wow_btime(p_key, lvl);
  ms := (extract(epoch from now())*1000)::bigint;
  insert into wow_buildings (owner_id, bkey, level, finish_ms) values (u.id, p_key, lvl, ms + t*1000)
    on conflict (owner_id, bkey) do update set level = excluded.level, finish_ms = excluded.finish_ms;
  insert into wow_queue (owner_id, kind, ref, qty, unit_ms, start_ms, finish_ms)
    values (u.id, 'build', p_key, 0, 0, ms, ms + t*1000);
  return jsonb_build_object('ok', true, 'key', p_key, 'finish', ms + t*1000);
end $$;

grant execute on function public.wow_build(text, text) to anon, authenticated;

-- ---------- entrenar tropas ----------
create or replace function public.wow_train(p_token text, p_key text, p_qty integer)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users; c jsonb; qty integer; um bigint; ms bigint; lv integer; tg numeric; tw numeric; tro numeric;
begin
  u := _wow_sess(p_token);
  if u.id is null then raise exception 'Sesión expirada. Vuelve a entrar.'; end if;
  u := _wow_tick(u.id);
  if exists(select 1 from wow_queue where owner_id = u.id) then
    raise exception 'Ya estás entrenando o construyendo algo.'; end if;
  if coalesce(p_key,'') not in ('soldado','arquero','jinete','mago') then raise exception 'Tropa no válida.'; end if;
  select coalesce(max(level),0) into lv from wow_buildings where owner_id = u.id and bkey = 'cuartel';
  if lv < 1 then raise exception 'Necesitas al menos un Cuartel para entrenar tropas.'; end if;
  qty := greatest(coalesce(p_qty,0), 0);
  if qty < 1 then raise exception 'Escribe cuántas tropas entrenar.'; end if;
  if qty > 100000 then raise exception 'Máximo 100.000 tropas a la vez.'; end if;
  c := _wow_tcost(p_key);
  tg := (c->>'gold')::numeric * qty; tw := (c->>'wood')::numeric * qty; tro := (c->>'ore')::numeric * qty;
  if u.gold < tg then raise exception 'No tienes suficiente Oro.'; end if;
  if u.wood < tw then raise exception 'No tienes suficiente Madera.'; end if;
  if u.ore < tro then raise exception 'No tienes suficiente Mineral.'; end if;
  update wow_users set gold = gold - tg, wood = wood - tw, ore = ore - tro where id = u.id;
  um := _wow_ttime(p_key)::bigint * 1000;
  ms := (extract(epoch from now())*1000)::bigint;
  insert into wow_queue (owner_id, kind, ref, qty, unit_ms, start_ms, finish_ms)
    values (u.id, 'train', p_key, qty, um, ms, ms + qty*um);
  return jsonb_build_object('ok', true, 'key', p_key, 'qty', qty, 'finish', ms + qty*um);
end $$;

grant execute on function public.wow_train(text, text, integer) to anon, authenticated;

-- ---------- ranking ----------
create or replace function public.wow_leaderboard(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users; out jsonb;
begin
  u := _wow_sess(p_token);
  if u.id is null then raise exception 'Sesión expirada. Vuelve a entrar.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
             'name', s.name, 'faction', s.faction, 'points', s.lsum*100 + s.tsum,
             'level_sum', s.lsum, 'troops', s.tsum, 'created', s.created,
             'alliance', s.atag, 'me', s.id = u.id) order by s.lsum*100 + s.tsum desc, s.created), '[]') into out
    from (
      select w.id, w.name, w.faction, w.created, coalesce(al.tag,'') atag,
             coalesce((select sum(b.level) from wow_buildings b where b.owner_id = w.id),0) lsum,
             coalesce((select sum(t.qty) from wow_troops t where t.owner_id = w.id),0) tsum
        from wow_users w left join wow_alliances al on al.id = w.alliance where w.active
    ) s;
  return out;
end $$;

grant execute on function public.wow_leaderboard(text) to anon, authenticated;

-- ---------- salt del nombre (para que el frontend calcule el hash) ----------
create or replace function public.wow_salt(p_name text)
returns text language plpgsql security definer set search_path to 'public' as $$
declare s text;
begin
  select salt into s from wow_users where name_key = _wow_key(p_name) limit 1;
  return coalesce(s, '');
end $$;
grant execute on function public.wow_salt(text) to anon, authenticated;

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
grant execute on function public.wow_change_password(text, text, text) to anon, authenticated;

-- ================================================================
-- MAPA DE REINOS + ALIANZAS + CHAT
-- ================================================================
create or replace function public._wow_points(p_owner text)
returns integer language sql security definer set search_path to 'public' as $$
  select (select coalesce(sum(level),0) from wow_buildings where owner_id = p_owner) * 100
       + (select coalesce(sum(qty),0) from wow_troops where owner_id = p_owner)
$$;
revoke all on function public._wow_points(text) from public, anon, authenticated;

-- ---------- mapa: todos los reinos con su posición ----------
create or replace function public.wow_map(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users; out jsonb;
begin
  u := _wow_sess(p_token);
  if u.id is null then raise exception 'Sesión expirada. Vuelve a entrar.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
             'pos', w.pos, 'name', w.name, 'faction', w.faction,
             'alliance', coalesce(al.tag,''), 'points', _wow_points(w.id), 'me', w.id = u.id)
           order by w.pos), '[]') into out
    from wow_users w left join wow_alliances al on al.id = w.alliance
   where w.active;
  return out;
end $$;
grant execute on function public.wow_map(text) to anon, authenticated;

-- ---------- crear alianza ----------
create or replace function public.wow_alliance_create(p_token text, p_name text, p_tag text, p_descr text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users; vname text; vkey text; vtag text;
begin
  u := _wow_sess(p_token);
  if u.id is null then raise exception 'Sesión expirada. Vuelve a entrar.'; end if;
  if u.alliance is not null then raise exception 'Ya estás en una alianza. Sal de la actual primero.'; end if;
  vname := btrim(coalesce(p_name,''));
  if length(vname) < 3 then raise exception 'El nombre de la alianza debe tener al menos 3 letras.'; end if;
  vtag := upper(regexp_replace(btrim(coalesce(p_tag,'')), '[^A-Za-z0-9]', '', 'g'));
  if length(vtag) < 2 or length(vtag) > 5 then raise exception 'La etiqueta debe tener entre 2 y 5 letras o números.'; end if;
  vkey := _wow_key(vname);
  if exists(select 1 from wow_alliances where id = vkey) then
    raise exception 'Ya existe una alianza con ese nombre.'; end if;
  insert into wow_alliances (id, name, tag, leader, created, descr)
  values (vkey, vname, vtag, u.id, (extract(epoch from now())*1000)::bigint, left(coalesce(p_descr,''), 200));
  update wow_users set alliance = vkey where id = u.id;
  return jsonb_build_object('ok', true, 'id', vkey, 'tag', vtag);
end $$;
grant execute on function public.wow_alliance_create(text, text, text, text) to anon, authenticated;

-- ---------- unirse ----------
create or replace function public.wow_alliance_join(p_token text, p_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users;
begin
  u := _wow_sess(p_token);
  if u.id is null then raise exception 'Sesión expirada. Vuelve a entrar.'; end if;
  if u.alliance is not null then raise exception 'Ya estás en una alianza. Sal de la actual primero.'; end if;
  if not exists(select 1 from wow_alliances where id = p_id) then
    raise exception 'Esa alianza ya no existe.'; end if;
  update wow_users set alliance = p_id where id = u.id;
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;
grant execute on function public.wow_alliance_join(text, text) to anon, authenticated;

-- ---------- salir ----------
create or replace function public.wow_alliance_leave(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users; vlea text; vnext text; vcnt integer;
begin
  u := _wow_sess(p_token);
  if u.id is null then raise exception 'Sesión expirada. Vuelve a entrar.'; end if;
  if u.alliance is null then raise exception 'No estás en ninguna alianza.'; end if;
  select leader into vlea from wow_alliances where id = u.alliance;
  if vlea = u.id then
    select count(*) into vcnt from wow_users where alliance = u.alliance and id <> u.id;
    if vcnt = 0 then
      delete from wow_alliances where id = u.alliance;
    else
      select id into vnext from wow_users where alliance = u.alliance and id <> u.id order by created limit 1;
      update wow_alliances set leader = vnext where id = u.alliance;
    end if;
  end if;
  update wow_users set alliance = null where id = u.id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.wow_alliance_leave(text) to anon, authenticated;

-- ---------- listar alianzas ----------
create or replace function public.wow_alliance_list(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users; out jsonb;
begin
  u := _wow_sess(p_token);
  if u.id is null then raise exception 'Sesión expirada. Vuelve a entrar.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
             'id', a.id, 'name', a.name, 'tag', a.tag, 'descr', a.descr,
             'members', (select count(*) from wow_users w where w.alliance = a.id),
             'points', (select coalesce(sum(_wow_points(w.id)),0) from wow_users w where w.alliance = a.id),
             'mine', a.id = u.alliance)
           order by (select coalesce(sum(_wow_points(w.id)),0) from wow_users w where w.alliance = a.id) desc, a.created), '[]') into out
    from wow_alliances a;
  return out;
end $$;
grant execute on function public.wow_alliance_list(text) to anon, authenticated;

-- ---------- info de una alianza ----------
create or replace function public.wow_alliance_info(p_token text, p_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users; a wow_alliances; mem jsonb;
begin
  u := _wow_sess(p_token);
  if u.id is null then raise exception 'Sesión expirada. Vuelve a entrar.'; end if;
  select * into a from wow_alliances where id = p_id;
  if a.id is null then raise exception 'Esa alianza ya no existe.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
             'name', w.name, 'faction', w.faction, 'points', _wow_points(w.id),
             'leader', w.id = a.leader, 'me', w.id = u.id)
           order by (w.id = a.leader) desc, w.created), '[]') into mem
    from wow_users w where w.alliance = a.id;
  return jsonb_build_object('id', a.id, 'name', a.name, 'tag', a.tag, 'descr', a.descr,
    'leader', (select name from wow_users where id = a.leader),
    'members', mem, 'is_member', u.alliance = a.id);
end $$;
grant execute on function public.wow_alliance_info(text, text) to anon, authenticated;

-- ---------- chat de alianza ----------
create or replace function public.wow_chat_send(p_token text, p_msg text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users; vmsg text;
begin
  u := _wow_sess(p_token);
  if u.id is null then raise exception 'Sesión expirada. Vuelve a entrar.'; end if;
  if u.alliance is null then raise exception 'Entra a una alianza para usar el chat.'; end if;
  vmsg := btrim(coalesce(p_msg,''));
  if vmsg = '' then raise exception 'Escribe un mensaje.'; end if;
  if length(vmsg) > 300 then vmsg := left(vmsg, 300); end if;
  insert into wow_chat (alliance, user_id, name, msg, created)
  values (u.alliance, u.id, u.name, vmsg, (extract(epoch from now())*1000)::bigint);
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.wow_chat_send(text, text) to anon, authenticated;

create or replace function public.wow_chat(p_token text, p_since bigint)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare u wow_users; out jsonb;
begin
  u := _wow_sess(p_token);
  if u.id is null then raise exception 'Sesión expirada. Vuelve a entrar.'; end if;
  if u.alliance is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
             'name', c.name, 'msg', c.msg, 'created', c.created, 'me', c.user_id = u.id) order by c.id), '[]') into out
    from (select * from wow_chat where alliance = u.alliance
           and (coalesce(p_since,0) = 0 or created > coalesce(p_since,0))
           order by id desc limit 60) c;
  return out;
end $$;
grant execute on function public.wow_chat(text, bigint) to anon, authenticated;
