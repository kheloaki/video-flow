import { getSupabaseConfig, getSession } from "./auth.js";

export function isAiUsagePayload(v) {
  if (!v || typeof v !== "object") return false;
  const o = v;
  return (
    typeof o.costUsd === "number" &&
    typeof o.totalTokens === "number" &&
    typeof o.model === "string"
  );
}

export function formatCostUsd(usd) {
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function formatUsageLine(u) {
  return `${u.totalTokens} tok · ${formatCostUsd(u.costUsd)} · ${u.model}`;
}

export async function insertUsageLog(usage, label, opts = {}) {
  const session = await getSession();
  const config = await getSupabaseConfig();
  if (!session?.accessToken || !config.url || !config.anonKey) return;

  const res = await fetch(`${config.url}/rest/v1/ai_usage_log`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      owner_id: session.userId,
      label,
      operation: usage.operation,
      provider: usage.provider,
      model: usage.model,
      prompt_tokens: usage.promptTokens,
      completion_tokens: usage.completionTokens,
      total_tokens: usage.totalTokens,
      cost_usd: usage.costUsd,
      project_type: opts.projectType ?? "clone_extension",
      project_id: opts.projectId ?? null,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `usage insert HTTP ${res.status}`);
  }
}

function monthStartIso() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function fetchUsageBalance() {
  const session = await getSession();
  const config = await getSupabaseConfig();
  if (!session?.accessToken || !config.url || !config.anonKey) {
    return null;
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const headers = {
    apikey: config.anonKey,
    Authorization: `Bearer ${session.accessToken}`,
  };

  const [todayRes, allRes] = await Promise.all([
    fetch(
      `${config.url}/rest/v1/ai_usage_log?owner_id=eq.${session.userId}&created_at=gte.${todayStart.toISOString()}&select=cost_usd,total_tokens`,
      { headers }
    ),
    fetch(
      `${config.url}/rest/v1/ai_usage_log?owner_id=eq.${session.userId}&created_at=gte.${monthStartIso()}&select=cost_usd,total_tokens`,
      { headers }
    ),
  ]);

  if (!todayRes.ok || !allRes.ok) return null;

  const todayRows = await todayRes.json();
  const monthRows = await allRes.json();

  const sum = (rows) =>
    rows.reduce(
      (acc, r) => ({
        cost: acc.cost + Number(r.cost_usd || 0),
        tokens: acc.tokens + Number(r.total_tokens || 0),
        count: acc.count + 1,
      }),
      { cost: 0, tokens: 0, count: 0 }
    );

  const today = sum(todayRows);
  const month = sum(monthRows);

  return {
    today: { totalCostUsd: today.cost, totalTokens: today.tokens, callCount: today.count },
    month: { totalCostUsd: month.cost, totalTokens: month.tokens, callCount: month.count },
  };
}
