import { supabase } from "../supabase";
import type { AiUsageLogEntry } from "./aiUsage";
import { formatCostUsd, formatTokens } from "./aiUsage";
import type { DbUsageRow } from "./aiUsageDb";

export type AdminUserLimits = {
  dailyBudgetUsd: number | null;
  dailyTokenLimit: number | null;
  monthlyBudgetUsd: number | null;
};

export type AdminUserRow = {
  userId: string;
  email: string | null;
  isAdmin: boolean;
  limits: AdminUserLimits;
  today: { callCount: number; totalTokens: number; totalCostUsd: number };
  month: { callCount: number; totalTokens: number; totalCostUsd: number };
  lastCallAt: string | null;
};

export type AdminUsageOverview = {
  totalUsers: number;
  totalCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  users: AdminUserRow[];
  recentLogs: AiUsageLogEntry[];
};

export type AdminUserLimitsPatch = {
  dailyBudgetUsd?: number | null;
  dailyTokenLimit?: number | null;
  monthlyBudgetUsd?: number | null;
};

function rowToEntry(row: DbUsageRow): AiUsageLogEntry {
  return {
    id: row.id,
    label: row.label,
    at: row.created_at,
    day: row.created_at.slice(0, 10),
    provider: row.provider as AiUsageLogEntry["provider"],
    model: row.model,
    operation: row.operation,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    costUsd: Number(row.cost_usd),
  };
}

function monthStartIso(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function todayStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function aggregateUsage(rows: DbUsageRow[]) {
  let totalTokens = 0;
  let totalCostUsd = 0;
  let lastCallAt: string | null = null;
  for (const row of rows) {
    totalTokens += row.total_tokens;
    totalCostUsd += Number(row.cost_usd);
    if (!lastCallAt || row.created_at > lastCallAt) lastCallAt = row.created_at;
  }
  return {
    callCount: rows.length,
    totalTokens,
    totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
    lastCallAt,
  };
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatAdminFetchError(err: { message?: string; code?: string }): string {
  const msg = err.message ?? "Failed to load admin data";
  if (err.code === "42P17" || /infinite recursion/i.test(msg)) {
    return "Profiles RLS recursion — run supabase/admin_rls_fix.sql in Supabase SQL Editor, then refresh.";
  }
  if (/ai_daily_|ai_monthly_/i.test(msg) && /column/i.test(msg)) {
    return "Missing limit columns — run supabase/admin_user_limits.sql (or admin_rls_fix.sql), then refresh.";
  }
  if (/permission denied|42501/i.test(msg)) {
    return "Permission denied — confirm is_admin = true on your profile and run admin_rls_fix.sql.";
  }
  return msg;
}

async function fetchAllProfiles() {
  const withLimits = await supabase
    .from("profiles")
    .select(
      "id, email, is_admin, ai_daily_budget_usd, ai_daily_token_limit, ai_monthly_budget_usd"
    )
    .order("email");

  if (!withLimits.error) return withLimits.data ?? [];

  const basic = await supabase
    .from("profiles")
    .select("id, email, is_admin")
    .order("email");
  if (basic.error) throw new Error(formatAdminFetchError(basic.error));
  return (basic.data ?? []).map((p) => ({
    ...p,
    ai_daily_budget_usd: null,
    ai_daily_token_limit: null,
    ai_monthly_budget_usd: null,
  }));
}

export async function fetchAdminUsageOverview(limit = 80): Promise<AdminUsageOverview> {
  const monthStart = monthStartIso();
  const todayStart = todayStartIso();

  const [profiles, monthLogsRes, todayLogsRes] = await Promise.all([
    fetchAllProfiles(),
    supabase
      .from("ai_usage_log")
      .select("*")
      .gte("created_at", monthStart)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("ai_usage_log")
      .select("owner_id, total_tokens, cost_usd, created_at")
      .gte("created_at", todayStart),
  ]);

  if (monthLogsRes.error) throw new Error(formatAdminFetchError(monthLogsRes.error));
  if (todayLogsRes.error) throw new Error(formatAdminFetchError(todayLogsRes.error));
  const monthLogs = (monthLogsRes.data ?? []) as DbUsageRow[];
  const todayLogs = todayLogsRes.data ?? [];

  const monthByUser = new Map<string, DbUsageRow[]>();
  for (const row of monthLogs) {
    const list = monthByUser.get(row.owner_id) ?? [];
    list.push(row);
    monthByUser.set(row.owner_id, list);
  }

  const todayByUser = new Map<string, typeof todayLogs>();
  for (const row of todayLogs) {
    const list = todayByUser.get(row.owner_id) ?? [];
    list.push(row);
    todayByUser.set(row.owner_id, list);
  }

  const users: AdminUserRow[] = profiles.map((p) => {
    const monthRows = monthByUser.get(p.id) ?? [];
    const todayRows = todayByUser.get(p.id) ?? [];
    const monthAgg = aggregateUsage(monthRows);
    const todayAgg = {
      callCount: todayRows.length,
      totalTokens: todayRows.reduce((s, r) => s + Number(r.total_tokens || 0), 0),
      totalCostUsd:
        Math.round(todayRows.reduce((s, r) => s + Number(r.cost_usd || 0), 0) * 1_000_000) /
        1_000_000,
    };
    return {
      userId: p.id,
      email: p.email as string | null,
      isAdmin: Boolean(p.is_admin),
      limits: {
        dailyBudgetUsd: numOrNull(p.ai_daily_budget_usd),
        dailyTokenLimit:
          p.ai_daily_token_limit != null ? Number(p.ai_daily_token_limit) : null,
        monthlyBudgetUsd: numOrNull(p.ai_monthly_budget_usd),
      },
      today: todayAgg,
      month: {
        callCount: monthAgg.callCount,
        totalTokens: monthAgg.totalTokens,
        totalCostUsd: monthAgg.totalCostUsd,
      },
      lastCallAt: monthAgg.lastCallAt,
    };
  });

  users.sort((a, b) => b.month.totalCostUsd - a.month.totalCostUsd);

  const totalCalls = monthLogs.length;
  const totalTokens = monthLogs.reduce((s, r) => s + r.total_tokens, 0);
  const totalCostUsd =
    Math.round(monthLogs.reduce((s, r) => s + Number(r.cost_usd), 0) * 1_000_000) / 1_000_000;

  return {
    totalUsers: users.length,
    totalCalls,
    totalTokens,
    totalCostUsd,
    users,
    recentLogs: monthLogs.slice(0, limit).map(rowToEntry),
  };
}

export async function updateAdminUserLimits(
  userId: string,
  patch: AdminUserLimitsPatch
): Promise<void> {
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if ("dailyBudgetUsd" in patch) {
    payload.ai_daily_budget_usd = patch.dailyBudgetUsd;
  }
  if ("dailyTokenLimit" in patch) {
    payload.ai_daily_token_limit = patch.dailyTokenLimit;
  }
  if ("monthlyBudgetUsd" in patch) {
    payload.ai_monthly_budget_usd = patch.monthlyBudgetUsd;
  }

  const { error } = await supabase.from("profiles").update(payload).eq("id", userId);
  if (error) throw error;
}

export { formatCostUsd, formatTokens };
