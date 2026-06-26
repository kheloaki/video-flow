-- Admin profiles + cross-user usage read for admins.
-- Run after schema.sql, then admin_user_limits.sql (or admin_rls_fix.sql bundles the fix).
-- Set admin: update profiles set is_admin = true where email = 'you@example.com';

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Avoid RLS recursion: never subquery profiles inside profiles policies
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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, account_status)
  values (new.id, new.email, 'pending')
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

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_admin" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
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

drop policy if exists "ai_usage_log_select_admin" on public.ai_usage_log;

create policy "ai_usage_log_select_admin" on public.ai_usage_log
  for select using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "clone_projects_select_admin" on public.clone_projects;

create policy "clone_projects_select_admin" on public.clone_projects
  for select using (owner_id = auth.uid() or public.is_admin());

create index if not exists profiles_email_idx on public.profiles (email);

-- Backfill existing auth users (run once)
insert into public.profiles (id, email)
select u.id, u.email from auth.users u
on conflict (id) do update set email = excluded.email, updated_at = now();
