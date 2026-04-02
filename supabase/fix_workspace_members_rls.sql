-- Fix: "infinite recursion detected in policy for relation workspace_members" (SQLSTATE 42P17)
--
-- Video Flow's schema.sql does NOT define workspace_members. This table + broken RLS often comes
-- from another app/template. PostgREST then returns 500 for products/videos/scripts/history too.
--
-- Run in Supabase → SQL Editor (whole block below).

-- Optional: see what will be removed
-- select tablename, policyname, cmd from pg_policies
-- where schemaname = 'public' and tablename in ('workspace_members', 'workspaces');

-- 1) Drop ALL policies on workspace_members (stops recursive policy definitions)
do $$
declare r record;
begin
  for r in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'workspace_members'
  loop
    execute format('drop policy if exists %I on public.workspace_members', r.policyname);
  end loop;
end $$;

alter table if exists public.workspace_members disable row level security;

-- 2) Same for public.workspaces if it exists (often paired with workspace_members)
do $$
declare r record;
begin
  for r in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'workspaces'
  loop
    execute format('drop policy if exists %I on public.workspaces', r.policyname);
  end loop;
end $$;

alter table if exists public.workspaces disable row level security;

-- 3) Refresh the app. If 500 persists, another policy still references workspace_members.
--    Find policies that mention it (run and inspect rows):
-- select tablename, policyname
-- from pg_policies
-- where schemaname = 'public'
--   and (qual::text ilike '%workspace_members%' or with_check::text ilike '%workspace_members%');

-- 4) Optional: remove the table entirely if unused (can break FKs — only if you know it's safe)
-- drop table if exists public.workspace_members cascade;
