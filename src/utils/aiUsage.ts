/** Client-side AI usage log (localStorage) + display helpers. */

import { insertUsageLog } from "./aiUsageDb";

export type AiUsagePayload = {
  provider: "openai" | "gemini";
  model: string;
  operation: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type AiUsageLogEntry = AiUsagePayload & {
  id: string;
  label: string;
  at: string;
  day: string;
};

export type AiUsageDaySummary = {
  day: string;
  totalTokens: number;
  totalCostUsd: number;
  callCount: number;
  byOperation: Record<string, { tokens: number; costUsd: number; count: number }>;
};

const STORAGE_KEY = "ai-usage-log-v1";
const MAX_ENTRIES = 2000;
export const AI_USAGE_CHANGED_EVENT = "ai-usage-changed";
export const AI_USAGE_DB_CHANGED_EVENT = "ai-usage-db-changed";

export type UsagePersistContext = {
  userId: string;
  projectType?: string;
  projectId?: string;
};

let persistContext: UsagePersistContext | null = null;

export function setUsagePersistContext(ctx: UsagePersistContext | null) {
  persistContext = ctx;
}

export function getUsagePersistContext(): UsagePersistContext | null {
  return persistContext;
}

function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function loadLog(): AiUsageLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AiUsageLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLog(entries: AiUsageLogEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  window.dispatchEvent(new CustomEvent(AI_USAGE_CHANGED_EVENT));
}

export function isAiUsagePayload(v: unknown): v is AiUsagePayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.costUsd === "number" &&
    typeof o.totalTokens === "number" &&
    typeof o.model === "string"
  );
}

/** Record one API call (from server `usage` field). */
export function recordAiUsage(usage: AiUsagePayload, label: string): AiUsageLogEntry {
  const at = new Date().toISOString();
  const entry: AiUsageLogEntry = {
    ...usage,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    label,
    at,
    day: todayKey(new Date(at)),
  };
  const next = [entry, ...loadLog()];
  saveLog(next);

  if (persistContext?.userId) {
    void insertUsageLog(persistContext.userId, usage, label, {
      projectType: persistContext.projectType,
      projectId: persistContext.projectId,
    })
      .then(() => {
        window.dispatchEvent(new CustomEvent(AI_USAGE_DB_CHANGED_EVENT));
      })
      .catch((e) => console.error("ai_usage_log insert failed", e));
  }

  return entry;
}

export function recordAiUsageFromResponse(
  data: Record<string, unknown>,
  label: string
): AiUsageLogEntry | null {
  if (!isAiUsagePayload(data.usage)) return null;
  return recordAiUsage(data.usage, label);
}

export function formatUsageDayLabel(day: string): string {
  const todayKey = new Date().toISOString().slice(0, 10);
  if (day === todayKey) return "Today";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (day === y.toISOString().slice(0, 10)) return "Yesterday";
  return new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export function daysElapsedThisMonth(): number {
  return new Date().getDate();
}

export function getTodaySummary(): AiUsageDaySummary {
  return summarizeDay(todayKey());
}

export function getAllTimeSummary(): {
  totalTokens: number;
  totalCostUsd: number;
  callCount: number;
} {
  const entries = loadLog();
  let totalTokens = 0;
  let totalCostUsd = 0;
  for (const e of entries) {
    totalTokens += e.totalTokens;
    totalCostUsd += e.costUsd;
  }
  return {
    totalTokens,
    totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
    callCount: entries.length,
  };
}

export function summarizeDay(day: string): AiUsageDaySummary {
  const entries = loadLog().filter((e) => e.day === day);
  const byOperation: AiUsageDaySummary["byOperation"] = {};
  let totalTokens = 0;
  let totalCostUsd = 0;
  for (const e of entries) {
    totalTokens += e.totalTokens;
    totalCostUsd += e.costUsd;
    const op = e.label || e.operation;
    if (!byOperation[op]) byOperation[op] = { tokens: 0, costUsd: 0, count: 0 };
    byOperation[op].tokens += e.totalTokens;
    byOperation[op].costUsd += e.costUsd;
    byOperation[op].count += 1;
  }
  return {
    day,
    totalTokens,
    totalCostUsd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
    callCount: entries.length,
    byOperation,
  };
}

export function getRecentDailySummaries(days = 14): AiUsageDaySummary[] {
  const out: AiUsageDaySummary[] = [];
  const d = new Date();
  for (let i = 0; i < days; i++) {
    const key = todayKey(d);
    out.push(summarizeDay(key));
    d.setDate(d.getDate() - 1);
  }
  return out;
}

export function getRecentEntries(limit = 30): AiUsageLogEntry[] {
  return loadLog().slice(0, limit);
}

export function formatCostUsd(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function formatUsageLine(u: AiUsagePayload): string {
  return `${formatTokens(u.totalTokens)} tokens · ${formatCostUsd(u.costUsd)} · ${u.model}`;
}
