-- Global vision/analyze lock — one OpenAI org TPM pool shared by all users.
-- Run in Supabase SQL Editor (safe to re-run).

create table if not exists public.ai_vision_lock (
  lock_key text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  owner_label text not null default '',
  progress_hint text not null default '',
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.ai_vision_lock enable row level security;

drop policy if exists "ai_vision_lock_select_auth" on public.ai_vision_lock;
create policy "ai_vision_lock_select_auth" on public.ai_vision_lock
  for select to authenticated using (true);

-- Mutations only via security definer RPCs below.

create or replace function public.try_acquire_vision_lock(
  p_lock_key text,
  p_owner_id uuid,
  p_owner_label text default '',
  p_progress_hint text default '',
  p_ttl_seconds int default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.ai_vision_lock%rowtype;
  ttl interval := make_interval(secs => greatest(60, p_ttl_seconds));
begin
  delete from public.ai_vision_lock where expires_at < now();

  select * into existing
  from public.ai_vision_lock
  where lock_key = p_lock_key
  for update;

  if not found then
    insert into public.ai_vision_lock (
      lock_key, owner_id, owner_label, progress_hint, expires_at
    ) values (
      p_lock_key, p_owner_id, coalesce(p_owner_label, ''), coalesce(p_progress_hint, ''), now() + ttl
    );
    return jsonb_build_object('ok', true, 'acquired', true);
  end if;

  if existing.owner_id = p_owner_id then
    update public.ai_vision_lock
    set
      expires_at = now() + ttl,
      heartbeat_at = now(),
      owner_label = coalesce(nullif(p_owner_label, ''), owner_label),
      progress_hint = coalesce(nullif(p_progress_hint, ''), progress_hint)
    where lock_key = p_lock_key;
    return jsonb_build_object('ok', true, 'acquired', true, 'renewed', true);
  end if;

  return jsonb_build_object(
    'ok', false,
    'acquired', false,
    'owner_id', existing.owner_id,
    'owner_label', existing.owner_label,
    'progress_hint', existing.progress_hint,
    'expires_at', existing.expires_at
  );
end;
$$;

create or replace function public.release_vision_lock(
  p_lock_key text,
  p_owner_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.ai_vision_lock
  where lock_key = p_lock_key and owner_id = p_owner_id;
  return found;
end;
$$;

create or replace function public.get_vision_lock_status(p_lock_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.ai_vision_lock%rowtype;
begin
  delete from public.ai_vision_lock where expires_at < now();
  select * into row from public.ai_vision_lock where lock_key = p_lock_key;
  if not found then
    return jsonb_build_object('locked', false);
  end if;
  return jsonb_build_object(
    'locked', true,
    'owner_id', row.owner_id,
    'owner_label', row.owner_label,
    'progress_hint', row.progress_hint,
    'expires_at', row.expires_at,
    'heartbeat_at', row.heartbeat_at
  );
end;
$$;

grant execute on function public.try_acquire_vision_lock(text, uuid, text, text, int) to authenticated;
grant execute on function public.release_vision_lock(text, uuid) to authenticated;
grant execute on function public.get_vision_lock_status(text) to authenticated;
