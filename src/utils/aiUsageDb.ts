import { supabase } from "../supabase";
import type { AiUsageDaySummary, AiUsageLogEntry, AiUsagePayload } from "./aiUsage";
import { formatCostUsd, formatTokens } from "./aiUsage";

export type DbUsageRow = {
  id: string;
  owner_id: string;
  label: string;
  operation: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  project_type: string | null;
  project_id: string | null;
  created_at: string;
};

export type UsageBalanceSummary = {
  today: AiUsageDaySummary;
  month: { totalTokens: number; totalCostUsd: number; callCount: number };
  allTime: { totalTokens: number; totalCostUsd: number; callCount: number };
  monthlyBudgetUsd: number | null;
  budgetRemainingUsd: number | null;
  dailyBudgetUsd: number | null;
  dailyTokenLimit: number | null;
  dailyBudgetRemainingUsd: number | null;
  dailyTokensRemaining: number | null;
};

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function monthStartIso(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function rowToEntry(row: DbUsageRow): AiUsageLogEntry {
  return {
    id: row.id,
    label: row.label,
    at: row.created_at,
    day: dayKey(row.created_at),
    provider: row.provider as AiUsagePayload["provider"],
    model: row.model,
    operation: row.operation,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    costUsd: Number(row.cost_usd),
  };
}

export async function insertUsageLog(
  ownerId: string,
  usage: AiUsagePayload,
  label: string,
  opts?: { projectType?: string; projectId?: string }
): Promise<void> {
  const { error } = await supabase.from("ai_usage_log").insert({
    owner_id: ownerId,
    label,
    operation: usage.operation,
    provider: usage.provider,
    model: usage.model,
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    total_tokens: usage.totalTokens,
    cost_usd: usage.costUsd,
    project_type: opts?.projectType ?? null,
    project_id: opts?.projectId ?? null,
  });
  if (error) throw error;
}

export async function fetchRecentUsageLogs(
  ownerId: string,
  limit = 50
): Promise<AiUsageLogEntry[]> {
  const { data, error } = await supabase
    .from("ai_usage_log")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((r) => rowToEntry(r as DbUsageRow));
}

export async function fetchUsageLogsSince(
  ownerId: string,
  sinceIso: string
): Promise<DbUsageRow[]> {
  const { data, error } = await supabase
    .from("ai_usage_log")
    .select("*")
    .eq("owner_id", ownerId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as DbUsageRow[];
}

function aggregateRows(rows: DbUsageRow[]): {
  totalTokens: number;
  totalCostUsd: number;
  callCount: number;
  byOperation: AiUsageDaySummary["byOperation"];
} {
  const byOperation: AiUsageDaySummary["byOperation"] = {};
  let totalTokens = 0;
  let totalCostUsd = 0;
  for (const r of rows) {
    totalTokens += r.total_tokens;
    totalCostUsd += Number(r.cost_usd);
    const op = r.label || r.operation;
    if (!byOperation[op]) byOperation[op] = { tokens: 0, costUsd: 0, count: 0 };
    byOperation[op].tokens += r.total_tokens;
    byOperation[op].costUsd += Number(r.cost_usd);
    byOperation[op].count += 1;
  }
  return {
    totalTokens,
    totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
    callCount: rows.length,
    byOperation,
  };
}

export async function fetchUsageBalance(ownerId: string): Promise<UsageBalanceSummary> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [todayRows, monthRows, allRows, profileRes] = await Promise.all([
    fetchUsageLogsSince(ownerId, todayStart.toISOString()),
    fetchUsageLogsSince(ownerId, monthStartIso()),
    supabase
      .from("ai_usage_log")
      .select("total_tokens, cost_usd")
      .eq("owner_id", ownerId),
    supabase
      .from("profiles")
      .select("ai_daily_budget_usd, ai_daily_token_limit, ai_monthly_budget_usd")
      .eq("id", ownerId)
      .maybeSingle(),
  ]);

  const todayAgg = aggregateRows(todayRows);
  const monthAgg = aggregateRows(monthRows);
  const allData = allRows.data ?? [];
  const allTime = {
    totalTokens: allData.reduce((s, r) => s + (r.total_tokens as number), 0),
    totalCostUsd:
      Math.round(
        allData.reduce((s, r) => s + Number(r.cost_usd), 0) * 1_000_000
      ) / 1_000_000,
    callCount: allData.length,
  };

  const profile = profileRes.data;
  const monthlyBudgetUsd =
    profile?.ai_monthly_budget_usd != null && Number.isFinite(Number(profile.ai_monthly_budget_usd))
      ? Number(profile.ai_monthly_budget_usd)
      : null;
  const dailyBudgetUsd =
    profile?.ai_daily_budget_usd != null && Number.isFinite(Number(profile.ai_daily_budget_usd))
      ? Number(profile.ai_daily_budget_usd)
      : null;
  const dailyTokenLimit =
    profile?.ai_daily_token_limit != null && Number.isFinite(Number(profile.ai_daily_token_limit))
      ? Number(profile.ai_daily_token_limit)
      : null;

  const budgetRemainingUsd =
    monthlyBudgetUsd != null
      ? Math.max(0, Math.round((monthlyBudgetUsd - monthAgg.totalCostUsd) * 1_000_000) / 1_000_000)
      : null;
  const dailyBudgetRemainingUsd =
    dailyBudgetUsd != null
      ? Math.max(0, Math.round((dailyBudgetUsd - todayAgg.totalCostUsd) * 1_000_000) / 1_000_000)
      : null;
  const dailyTokensRemaining =
    dailyTokenLimit != null
      ? Math.max(0, dailyTokenLimit - todayAgg.totalTokens)
      : null;

  return {
    today: {
      day: todayStart.toISOString().slice(0, 10),
      ...todayAgg,
    },
    month: {
      totalTokens: monthAgg.totalTokens,
      totalCostUsd: monthAgg.totalCostUsd,
      callCount: monthAgg.callCount,
    },
    allTime,
    monthlyBudgetUsd,
    budgetRemainingUsd,
    dailyBudgetUsd,
    dailyTokenLimit,
    dailyBudgetRemainingUsd,
    dailyTokensRemaining,
  };
}

export async function fetchDailySummariesFromDb(
  ownerId: string,
  days = 30
): Promise<AiUsageDaySummary[]> {
  const d = new Date();
  d.setDate(d.getDate() - (days - 1));
  d.setHours(0, 0, 0, 0);
  const rows = await fetchUsageLogsSince(ownerId, d.toISOString());
  return buildDailySummariesFromRows(rows, days);
}

/** Aggregate log rows into one summary per calendar day (newest first). */
export function buildDailySummariesFromRows(
  rows: DbUsageRow[],
  days: number
): AiUsageDaySummary[] {
  const byDay: Record<string, DbUsageRow[]> = {};
  for (const r of rows) {
    const k = dayKey(r.created_at);
    if (!byDay[k]) byDay[k] = [];
    byDay[k].push(r);
  }
  const out: AiUsageDaySummary[] = [];
  const cursor = new Date();
  for (let i = 0; i < days; i++) {
    const k = cursor.toISOString().slice(0, 10);
    const dayRows = byDay[k] ?? [];
    const agg = aggregateRows(dayRows);
    out.push({ day: k, ...agg });
    cursor.setDate(cursor.getDate() - 1);
  }
  return out;
}

/** Per-user daily summaries for a date range (newest day first). */
export function buildDailySummariesByUser(
  rows: DbUsageRow[],
  days: number
): Map<string, AiUsageDaySummary[]> {
  const byUser = new Map<string, DbUsageRow[]>();
  for (const r of rows) {
    const list = byUser.get(r.owner_id) ?? [];
    list.push(r);
    byUser.set(r.owner_id, list);
  }
  const out = new Map<string, AiUsageDaySummary[]>();
  for (const [userId, userRows] of byUser) {
    out.set(userId, buildDailySummariesFromRows(userRows, days));
  }
  return out;
}

export async function saveMonthlyBudget(
  ownerId: string,
  budgetUsd: number | null
): Promise<void> {
  const { data, error: readErr } = await supabase
    .from("user_app_settings")
    .select("make_webhook_url, images_webhook_url")
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (readErr) throw readErr;

  const payload = {
    owner_id: ownerId,
    make_webhook_url: String(data?.make_webhook_url ?? ""),
    images_webhook_url: String(data?.images_webhook_url ?? ""),
    ai_monthly_budget_usd: budgetUsd,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from("user_app_settings")
    .upsert(payload, { onConflict: "owner_id" });
  if (error) throw error;
}

export { formatCostUsd, formatTokens };
