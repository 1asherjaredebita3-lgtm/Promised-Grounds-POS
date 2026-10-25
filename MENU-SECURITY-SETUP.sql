-- Promised Grounds: secure shared menu editing
-- Run this in Supabase SQL Editor after creating public.menu_items.
-- Public visitors can read the menu. Only users listed in staff_users can edit it.

create table if not exists public.staff_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.staff_users enable row level security;

grant select on public.staff_users to authenticated;
create policy "Staff can read own approval"
on public.staff_users
for select
to authenticated
using (user_id = auth.uid());

grant insert, update, delete on public.menu_items to authenticated;

create policy "Approved staff can insert menu items"
on public.menu_items
for insert
to authenticated
with check (
  exists (select 1 from public.staff_users s where s.user_id = auth.uid())
);

create policy "Approved staff can update menu items"
on public.menu_items
for update
to authenticated
using (
  exists (select 1 from public.staff_users s where s.user_id = auth.uid())
)
with check (
  exists (select 1 from public.staff_users s where s.user_id = auth.uid())
);

create policy "Approved staff can delete menu items"
on public.menu_items
for delete
to authenticated
using (
  exists (select 1 from public.staff_users s where s.user_id = auth.uid())
);
