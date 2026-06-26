-- Account approval: pending (new) | active | inactive
-- Run in Supabase SQL Editor after admin_profiles.sql / admin_rls_fix.sql

alter table public.profiles
  add column if not exists account_status text not null default 'pending';

alter table public.profiles
  drop constraint if exists profiles_account_status_check;

alter table public.profiles
  add constraint profiles_account_status_check
  check (account_status in ('pending', 'active', 'inactive'));

comment on column public.profiles.account_status is
  'pending = awaiting admin approval; active = full access; inactive = blocked';

-- Existing users keep access until an admin changes them
update public.profiles
set account_status = 'active'
where account_status is null or account_status = 'pending';

-- New signups start as pending (do not overwrite status on email sync)
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

create or replace function public.account_status()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.account_status from public.profiles p where p.id = auth.uid()),
    'pending'
  );
$$;

create or replace function public.can_use_app()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or public.account_status() = 'active';
$$;

revoke all on function public.account_status() from public;
revoke all on function public.can_use_app() from public;
grant execute on function public.account_status() to authenticated;
grant execute on function public.can_use_app() to authenticated;

-- Require active account (or admin) for writes and reads on app data
do $$
declare
  t text;
  tables text[] := array[
    'products', 'videos', 'saved_scripts', 'video_history',
    'user_app_settings', 'ai_usage_log', 'clone_projects'
  ];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for select using (owner_id = auth.uid() and public.can_use_app())',
      t || '_select_own', t
    );
    execute format(
      'create policy %I on public.%I for insert with check (owner_id = auth.uid() and public.can_use_app())',
      t || '_insert_own', t
    );
    execute format(
      'create policy %I on public.%I for update using (owner_id = auth.uid() and public.can_use_app()) with check (owner_id = auth.uid() and public.can_use_app())',
      t || '_update_own', t
    );

    if t <> 'ai_usage_log' and t <> 'user_app_settings' then
      execute format(
        'create policy %I on public.%I for delete using (owner_id = auth.uid() and public.can_use_app())',
        t || '_delete_own', t
      );
    end if;
  end loop;
end $$;

-- Admin cross-user read (unchanged — uses is_admin())
drop policy if exists "ai_usage_log_select_admin" on public.ai_usage_log;
create policy "ai_usage_log_select_admin" on public.ai_usage_log
  for select using (owner_id = auth.uid() or public.is_admin());

drop policy if exists "clone_projects_select_admin" on public.clone_projects;
create policy "clone_projects_select_admin" on public.clone_projects
  for select using (owner_id = auth.uid() or public.is_admin());
