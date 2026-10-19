-- Run once in a NEW Supabase project's SQL Editor.
-- Then create a staff Auth user and insert their UUID at the bottom.
begin;
create table if not exists public.staff_users (
 user_id uuid primary key references auth.users(id) on delete cascade
);
create table if not exists public.cafe_orders (
 id uuid primary key,
 payload jsonb not null,
 revision bigint not null
);
-- Contains ONLY customer-safe fields, never notes, payment, or full names.
create table if not exists public.live_orders (
 id uuid primary key,
 number text not null,
 first_name text not null,
 status text not null check (status in ('queued','preparing','ready')),
 created_at bigint not null,
 ready_at bigint
);
alter table public.staff_users enable row level security;
alter table public.cafe_orders enable row level security;
alter table public.live_orders enable row level security;
revoke all on public.staff_users,public.cafe_orders,public.live_orders from anon,authenticated;
grant select on public.staff_users to authenticated;
grant select on public.live_orders to anon,authenticated;
drop policy if exists "Staff see own membership" on public.staff_users;
create policy "Staff see own membership" on public.staff_users for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists "Customers see active recent orders" on public.live_orders;
create policy "Customers see active recent orders" on public.live_orders for select to anon,authenticated using(created_at > extract(epoch from now()-interval '18 hours')*1000);
-- Only this function writes orders. It checks the staff allowlist, validates the
-- order, prevents stale retries, and atomically updates the public queue.
create or replace function public.save_cafe_order(p_order jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_id uuid; v_revision bigint; v_existing bigint; v_status text;
 v_item jsonb; v_total bigint:=0; v_name text; v_created bigint;
begin
 if not exists(select 1 from public.staff_users where user_id=auth.uid()) then raise exception 'Staff access required'; end if;
 v_id:=(p_order->>'id')::uuid;
 v_revision:=(p_order->>'updatedAt')::bigint;
 v_created:=(p_order->>'createdAt')::bigint;
 v_status:=p_order->>'status';
 if v_revision is null or v_created is null or v_revision<v_created or v_created<1 or v_status not in ('queued','preparing','ready','collected','cancelled') or v_status is null or length(p_order->>'number')>60 or coalesce(p_order->>'number','')='' then raise exception 'Invalid order'; end if;
 if jsonb_typeof(p_order->'items') is distinct from 'array' then raise exception 'Invalid items'; end if;
 if jsonb_array_length(p_order->'items') not between 1 and 200 then raise exception 'Invalid item count'; end if;
 for v_item in select value from jsonb_array_elements(p_order->'items') loop
  if (v_item->>'quantity')::integer not between 1 and 99 or (v_item->>'price')::bigint<=0 or coalesce(v_item->>'name','')='' then raise exception 'Invalid item'; end if;
  v_total:=v_total+(v_item->>'quantity')::integer*(v_item->>'price')::bigint;
 end loop;
 if v_total is distinct from (p_order->>'total')::bigint then raise exception 'Invalid total'; end if;
 -- Lock the UUID even for first inserts; simultaneous retries cannot duplicate.
 perform pg_advisory_xact_lock(hashtextextended(v_id::text,0));
 select revision into v_existing from public.cafe_orders where id=v_id;
 if v_existing is not null and v_existing>=v_revision then
  return jsonb_build_object('id',v_id,'revision',v_existing);
 end if;
 insert into public.cafe_orders(id,payload,revision) values(v_id,p_order-'syncedAt'-'cloudSyncedAt',v_revision)
 on conflict(id) do update set payload=excluded.payload,revision=excluded.revision;
 if v_status in ('collected','cancelled') then
  delete from public.live_orders where id=v_id;
 else
  v_name:=left(split_part(trim(coalesce(p_order->>'customer','')),' ',1),40);
  insert into public.live_orders(id,number,first_name,status,created_at,ready_at)
  values(v_id,p_order->>'number',coalesce(nullif(v_name,''),'Walk-in'),v_status,v_created,(p_order->>'readyAt')::bigint)
  on conflict(id) do update set number=excluded.number,first_name=excluded.first_name,status=excluded.status,created_at=excluded.created_at,ready_at=excluded.ready_at;
 end if;
 return jsonb_build_object('id',v_id,'revision',v_revision);
end;
$$;
revoke all on function public.save_cafe_order(jsonb) from public,anon,authenticated;
grant execute on function public.save_cafe_order(jsonb) to authenticated;
commit;
-- After creating your staff user in Authentication → Users, copy its UUID.
-- Replace YOUR_STAFF_USER_UUID and run this line separately:
-- insert into public.staff_users(user_id) values ('YOUR_STAFF_USER_UUID');
