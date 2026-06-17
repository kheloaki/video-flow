import { supabase } from "../supabase";
import type { AiUsageLogEntry } from "./aiUsage";
import { formatCostUsd, formatTokens } from "./aiUsage";
import type { DbUsageRow } from "./aiUsageDb";

export type AdminUserUsageSummary = {
  userId: string;
  email: string | null;
  callCount: number;
  totalTokens: number;
  totalCostUsd: number;
  lastCallAt: string | null;
};

export type AdminUsageOverview = {
  totalUsers: number;
  totalCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  users: AdminUserUsageSummary[];
  recentLogs: AiUsageLogEntry[];
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

export async function fetchAdminUsageOverview(limit = 80): Promise<AdminUsageOverview> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [profilesRes, logsRes] = await Promise.all([
    supabase.from("profiles").select("id, email").order("email"),
    supabase
      .from("ai_usage_log")
      .select("*")
      .gte("created_at", monthStart.toISOString())
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  if (profilesRes.error) throw profilesRes.error;
  if (logsRes.error) throw logsRes.error;

  const profiles = profilesRes.data ?? [];
  const logs = (logsRes.data ?? []) as DbUsageRow[];
  const emailById = new Map(profiles.map((p) => [p.id, p.email as string | null]));

  const byUser = new Map<string, AdminUserUsageSummary>();
  for (const row of logs) {
    const existing = byUser.get(row.owner_id) ?? {
      userId: row.owner_id,
      email: emailById.get(row.owner_id) ?? null,
      callCount: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      lastCallAt: null,
    };
    existing.callCount += 1;
    existing.totalTokens += row.total_tokens;
    existing.totalCostUsd += Number(row.cost_usd);
    if (!existing.lastCallAt || row.created_at > existing.lastCallAt) {
      existing.lastCallAt = row.created_at;
    }
    byUser.set(row.owner_id, existing);
  }

  const users = [...byUser.values()]
    .map((u) => ({
      ...u,
      totalCostUsd: Math.round(u.totalCostUsd * 1_000_000) / 1_000_000,
    }))
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd);

  const totalCalls = logs.length;
  const totalTokens = logs.reduce((s, r) => s + r.total_tokens, 0);
  const totalCostUsd =
    Math.round(logs.reduce((s, r) => s + Number(r.cost_usd), 0) * 1_000_000) / 1_000_000;

  return {
    totalUsers: users.length,
    totalCalls,
    totalTokens,
    totalCostUsd,
    users,
    recentLogs: logs.slice(0, limit).map(rowToEntry),
  };
}

export { formatCostUsd, formatTokens };
