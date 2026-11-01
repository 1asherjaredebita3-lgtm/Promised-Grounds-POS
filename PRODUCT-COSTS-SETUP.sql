-- Promised Grounds POS: per-product production costs and profitability analytics.
-- Run once in Supabase SQL Editor after the original supabase-setup.sql.
-- The old cafe_ad_costs table, if present, is left untouched but is no longer used.
begin;
create table if not exists public.cafe_product_costs (
  product_id text primary key,
  product_name text not null,
  cost_cents bigint not null default 0 check (cost_cents >= 0),
  updated_at timestamptz not null default now()
);
alter table public.cafe_product_costs enable row level security;
revoke all on public.cafe_product_costs from anon, authenticated;
grant select, insert, update on public.cafe_product_costs to authenticated;
drop policy if exists "Staff manage product costs" on public.cafe_product_costs;
create policy "Staff manage product costs"
on public.cafe_product_costs for all to authenticated
using (exists (select 1 from public.staff_users s where s.user_id = (select auth.uid())))
with check (exists (select 1 from public.staff_users s where s.user_id = (select auth.uid())));
create or replace function public.get_cafe_analytics(p_start_date date, p_end_date date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not exists (select 1 from public.staff_users where user_id = auth.uid()) then raise exception 'Staff access required'; end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date or p_end_date - p_start_date > 366 then raise exception 'Choose a valid date range of up to 367 days'; end if;
  with eligible_orders as (
    select payload from public.cafe_orders
    where payload->>'status' = 'collected' and payload->>'payment' in ('Cash', 'GCash')
      and ((to_timestamp((payload->>'createdAt')::double precision / 1000) at time zone 'Asia/Manila')::date between p_start_date and p_end_date)
  ), sold_items as (
    select item->>'id' as product_id,item->>'name' as name,sum((item->>'quantity')::integer)::bigint as quantity
    from eligible_orders cross join lateral jsonb_array_elements(payload->'items') item
    group by item->>'id',item->>'name'
  ), product_totals as (
    select s.name,s.quantity,coalesce(c.cost_cents,0)::bigint as cost_cents,(s.quantity*coalesce(c.cost_cents,0))::bigint as total_cost_cents
    from sold_items s left join public.cafe_product_costs c on c.product_id=s.product_id
  ), totals as (select coalesce(sum(total_cost_cents),0)::bigint as product_cost_cents from product_totals)
  select jsonb_build_object(
    'revenue_cents',coalesce((select sum((payload->>'total')::bigint) from eligible_orders),0),
    'order_count',(select count(*) from eligible_orders),
    'product_cost_cents',(select product_cost_cents from totals),
    'estimated_profit_cents',coalesce((select sum((payload->>'total')::bigint) from eligible_orders),0)-(select product_cost_cents from totals),
    'products',coalesce((select jsonb_agg(jsonb_build_object('name',name,'quantity',quantity,'cost_cents',cost_cents,'total_cost_cents',total_cost_cents) order by quantity desc) from product_totals),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke all on function public.get_cafe_analytics(date,date) from public,anon,authenticated;
grant execute on function public.get_cafe_analytics(date,date) to authenticated;
commit;
