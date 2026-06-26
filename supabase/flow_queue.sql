-- Google Flow scene queue — shared by web app and extension (per user, Supabase only).

create table if not exists public.flow_queue (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  scene_number integer,
  debut_image_url text not null,
  fin_image_url text not null,
  prompt text not null,
  clone_project_id uuid references public.clone_projects (id) on delete set null,
  queued_at bigint not null default (extract(epoch from now()) * 1000)::bigint,
  created_at timestamptz not null default now()
);

create index if not exists flow_queue_owner_queued_idx
  on public.flow_queue (owner_id, queued_at asc);

alter table public.flow_queue enable row level security;

drop policy if exists "flow_queue_select_own" on public.flow_queue;
drop policy if exists "flow_queue_insert_own" on public.flow_queue;
drop policy if exists "flow_queue_update_own" on public.flow_queue;
drop policy if exists "flow_queue_delete_own" on public.flow_queue;
drop policy if exists "flow_queue_select_admin" on public.flow_queue;

create policy "flow_queue_select_own" on public.flow_queue
  for select using (owner_id = auth.uid() and public.can_use_app());

create policy "flow_queue_insert_own" on public.flow_queue
  for insert with check (owner_id = auth.uid() and public.can_use_app());

create policy "flow_queue_update_own" on public.flow_queue
  for update using (owner_id = auth.uid() and public.can_use_app())
  with check (owner_id = auth.uid() and public.can_use_app());

create policy "flow_queue_delete_own" on public.flow_queue
  for delete using (owner_id = auth.uid() and public.can_use_app());

create policy "flow_queue_select_admin" on public.flow_queue
  for select using (public.is_admin());
