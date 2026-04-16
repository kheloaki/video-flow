-- Run in Supabase: SQL Editor → New query → paste → Run.
-- Safe to re-run: drops policies first, then recreates (tables use IF NOT EXISTS).

-- ========== products ==========
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text default '',
  script_details text default '',
  model_image_url text,
  product_image_url text,
  created_at timestamptz not null default now()
);

-- If table already existed before this column was added
alter table public.products
  add column if not exists script_details text default '';

alter table public.products enable row level security;

drop policy if exists "products_select_own" on public.products;
drop policy if exists "products_insert_own" on public.products;
drop policy if exists "products_update_own" on public.products;
drop policy if exists "products_delete_own" on public.products;

create policy "products_select_own" on public.products
  for select using (owner_id = auth.uid());

create policy "products_insert_own" on public.products
  for insert with check (owner_id = auth.uid());

create policy "products_update_own" on public.products
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "products_delete_own" on public.products
  for delete using (owner_id = auth.uid());

create index if not exists products_owner_created_idx on public.products (owner_id, created_at desc);

-- ========== videos ==========
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  product_id text not null,
  name text default '',
  transcription text not null,
  example_kind text not null default 'same_product',
  thumbnail_base64 text,
  created_at timestamptz not null default now()
);

-- If table already existed before this column was added
alter table public.videos
  add column if not exists example_kind text not null default 'same_product';

alter table public.videos enable row level security;

drop policy if exists "videos_select_own" on public.videos;
drop policy if exists "videos_insert_own" on public.videos;
drop policy if exists "videos_update_own" on public.videos;
drop policy if exists "videos_delete_own" on public.videos;

create policy "videos_select_own" on public.videos
  for select using (owner_id = auth.uid());

create policy "videos_insert_own" on public.videos
  for insert with check (owner_id = auth.uid());

create policy "videos_update_own" on public.videos
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "videos_delete_own" on public.videos
  for delete using (owner_id = auth.uid());

create index if not exists videos_owner_created_idx on public.videos (owner_id, created_at desc);

-- ========== saved_scripts ==========
create table if not exists public.saved_scripts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  product_id text not null,
  custom_prompt text default '',
  content text not null,
  scenes jsonb,
  created_at timestamptz not null default now()
);

alter table public.saved_scripts enable row level security;

drop policy if exists "saved_scripts_select_own" on public.saved_scripts;
drop policy if exists "saved_scripts_insert_own" on public.saved_scripts;
drop policy if exists "saved_scripts_update_own" on public.saved_scripts;
drop policy if exists "saved_scripts_delete_own" on public.saved_scripts;

create policy "saved_scripts_select_own" on public.saved_scripts
  for select using (owner_id = auth.uid());

create policy "saved_scripts_insert_own" on public.saved_scripts
  for insert with check (owner_id = auth.uid());

create policy "saved_scripts_update_own" on public.saved_scripts
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "saved_scripts_delete_own" on public.saved_scripts
  for delete using (owner_id = auth.uid());

create index if not exists saved_scripts_owner_created_idx on public.saved_scripts (owner_id, created_at desc);

-- ========== video_history ==========
create table if not exists public.video_history (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  event_at timestamptz not null default now(),
  data jsonb, -- webhook JSON; app may add `veoInApp: { scenes, generatedInApp, updatedAt }` for in-app Veo packages
  raw_text text,
  video_url text,
  product_id text,
  name text,
  sent_to_webhook boolean not null default false,
  scene_images jsonb,
  created_at timestamptz not null default now()
);

alter table public.video_history enable row level security;

drop policy if exists "video_history_select_own" on public.video_history;
drop policy if exists "video_history_insert_own" on public.video_history;
drop policy if exists "video_history_update_own" on public.video_history;
drop policy if exists "video_history_delete_own" on public.video_history;

create policy "video_history_select_own" on public.video_history
  for select using (owner_id = auth.uid());

create policy "video_history_insert_own" on public.video_history
  for insert with check (owner_id = auth.uid());

create policy "video_history_update_own" on public.video_history
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "video_history_delete_own" on public.video_history
  for delete using (owner_id = auth.uid());

create index if not exists video_history_owner_created_idx on public.video_history (owner_id, created_at desc);

-- ========== user_app_settings (webhooks — replaces localStorage-only for signed-in users) ==========
create table if not exists public.user_app_settings (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  make_webhook_url text not null default '',
  images_webhook_url text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.user_app_settings enable row level security;

drop policy if exists "user_app_settings_select_own" on public.user_app_settings;
drop policy if exists "user_app_settings_insert_own" on public.user_app_settings;
drop policy if exists "user_app_settings_update_own" on public.user_app_settings;

create policy "user_app_settings_select_own" on public.user_app_settings
  for select using (owner_id = auth.uid());

create policy "user_app_settings_insert_own" on public.user_app_settings
  for insert with check (owner_id = auth.uid());

create policy "user_app_settings_update_own" on public.user_app_settings
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
