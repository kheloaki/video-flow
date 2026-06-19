-- Fix admin RLS (infinite recursion on profiles) + sync all auth users into profiles.
-- Run this in Supabase SQL Editor if the admin page shows no users or only yourself.

-- 1) Spend limit columns (safe if already applied)
alter table public.profiles
  add column if not exists ai_daily_budget_usd numeric(10, 2),
  add column if not exists ai_daily_token_limit integer,
  add column if not exists ai_monthly_budget_usd numeric(10, 2);

-- 2) Security definer helper — avoids RLS recursion when checking is_admin
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- 3) Backfill profiles for every Supabase Auth account
insert into public.profiles (id, email)
select u.id, u.email
from auth.users u
on conflict (id) do update
  set email = excluded.email,
      updated_at = now();

-- 4) Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5) Profiles RLS (use is_admin(), not subquery on profiles)
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_admin" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;

create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());

create policy "profiles_select_admin" on public.profiles
  for select using (public.is_admin());

create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());

create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy "profiles_update_admin" on public.profiles
  for update using (public.is_admin()) with check (public.is_admin());

-- 6) Usage / clone admin read
drop policy if exists "ai_usage_log_select_admin" on public.ai_usage_log;
drop policy if exists "ai_usage_log_select_own" on public.ai_usage_log;

create policy "ai_usage_log_select_own" on public.ai_usage_log
  for select using (owner_id = auth.uid());

create policy "ai_usage_log_select_admin" on public.ai_usage_log
  for select using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "clone_projects_select_admin" on public.clone_projects;
drop policy if exists "clone_projects_select_own" on public.clone_projects;

create policy "clone_projects_select_own" on public.clone_projects
  for select using (owner_id = auth.uid());

create policy "clone_projects_select_admin" on public.clone_projects
  for select using (owner_id = auth.uid() or public.is_admin());

-- 7) Make yourself admin (edit email):
-- update public.profiles set is_admin = true where email = 'you@example.com';
