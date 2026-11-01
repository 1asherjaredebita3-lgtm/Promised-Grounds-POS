-- Promised Grounds POS analytics
-- Run this once in Supabase SQL Editor after the existing supabase-setup.sql.
begin;

create table if not exists public.cafe_ad_costs (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default (now() at time zone 'Asia/Manila')::date,
  description text not null default 'Advertising',
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);

alter table public.cafe_ad_costs enable row level security;
revoke all on public.cafe_ad_costs from anon, authenticated;
grant select, insert, update, delete on public.cafe_ad_costs to authenticated;

drop policy if exists "Staff manage advertising costs" on public.cafe_ad_costs;
create policy "Staff manage advertising costs"
on public.cafe_ad_costs for all to authenticated
using (exists (select 1 from public.staff_users s where s.user_id = (select auth.uid())))
with check (exists (select 1 from public.staff_users s where s.user_id = (select auth.uid())));

create or replace function public.get_cafe_analytics(p_start_date date, p_end_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not exists (select 1 from public.staff_users where user_id = auth.uid()) then
    raise exception 'Staff access required';
  end if;
  if p_start_date is null or p_end_date is null or p_end_date < p_start_date or p_end_date - p_start_date > 366 then
    raise exception 'Choose a valid date range of up to 367 days';
  end if;

  with eligible_orders as (
    select payload
    from public.cafe_orders
    where payload->>'status' = 'collected'
      and payload->>'payment' in ('Cash', 'GCash')
      and ((to_timestamp((payload->>'createdAt')::double precision / 1000) at time zone 'Asia/Manila')::date between p_start_date and p_end_date)
  ),
  product_totals as (
    select item->>'name' as name, sum((item->>'quantity')::integer)::bigint as quantity
    from eligible_orders
    cross join lateral jsonb_array_elements(payload->'items') item
    group by item->>'name'
  ),
  expense_totals as (
    select coalesce(sum(amount_cents),0)::bigint as amount
    from public.cafe_ad_costs
    where expense_date between p_start_date and p_end_date
  ),
  expense_rows as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'expense_date', expense_date, 'description', description, 'amount_cents', amount_cents
    ) order by expense_date desc, created_at desc), '[]'::jsonb) as rows
    from public.cafe_ad_costs
    where expense_date between p_start_date and p_end_date
  )
  select jsonb_build_object(
    'revenue_cents', coalesce((select sum((payload->>'total')::bigint) from eligible_orders),0),
    'order_count', (select count(*) from eligible_orders),
    'ad_cost_cents', (select amount from expense_totals),
    'estimated_profit_cents', coalesce((select sum((payload->>'total')::bigint) from eligible_orders),0) - (select amount from expense_totals),
    'products', coalesce((select jsonb_agg(jsonb_build_object('name',name,'quantity',quantity) order by quantity desc) from product_totals), '[]'::jsonb),
    'expenses', (select rows from expense_rows)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_cafe_analytics(date,date) from public, anon, authenticated;
grant execute on function public.get_cafe_analytics(date,date) to authenticated;
commit;
