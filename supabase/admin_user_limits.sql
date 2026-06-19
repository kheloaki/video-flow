-- Per-user AI spend limits (admin-managed on profiles).
-- Run after admin_profiles.sql (or use admin_rls_fix.sql which includes everything).

alter table public.profiles
  add column if not exists ai_daily_budget_usd numeric(10, 2),
  add column if not exists ai_daily_token_limit integer,
  add column if not exists ai_monthly_budget_usd numeric(10, 2);

comment on column public.profiles.ai_daily_budget_usd is 'Max AI spend per calendar day (USD). NULL = no cap.';
comment on column public.profiles.ai_daily_token_limit is 'Max AI tokens per calendar day. NULL = no cap.';
comment on column public.profiles.ai_monthly_budget_usd is 'Max AI spend per calendar month (USD). NULL = no cap.';

-- profiles_update_admin is created in admin_profiles.sql via is_admin()
