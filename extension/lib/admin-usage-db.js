import { getSupabaseConfig, getValidSession } from "./auth.js";
import { formatCostUsd } from "./usage-db.js";

function monthStartIso() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function todayStartIso() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

async function adminHeaders() {
  const session = await getValidSession();
  const config = await getSupabaseConfig();
  if (!session?.accessToken || !config.url || !config.anonKey) {
    throw new Error("Not logged in or Supabase not configured.");
  }
  return {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    url: config.url,
  };
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function fetchAdminUsageOverview() {
  const { headers, url } = await adminHeaders();
  const monthSince = monthStartIso();
  const todaySince = todayStartIso();

  const [profilesRes, monthLogsRes, todayLogsRes] = await Promise.all([
    fetch(
      `${url}/rest/v1/profiles?select=id,email,is_admin,ai_daily_budget_usd,ai_daily_token_limit,ai_monthly_budget_usd&order=email`,
      { headers }
    ),
    fetch(
      `${url}/rest/v1/ai_usage_log?created_at=gte.${monthSince}&select=id,owner_id,label,model,total_tokens,cost_usd,created_at&order=created_at.desc&limit=1000`,
      { headers }
    ),
    fetch(
      `${url}/rest/v1/ai_usage_log?created_at=gte.${todaySince}&select=owner_id,total_tokens,cost_usd`,
      { headers }
    ),
  ]);

  if (profilesRes.status === 403 || monthLogsRes.status === 403) {
    throw new Error("Admin access denied — set is_admin = true on your profile.");
  }
  if (!profilesRes.ok) throw new Error(`profiles HTTP ${profilesRes.status}`);
  if (!monthLogsRes.ok) throw new Error(`usage HTTP ${monthLogsRes.status}`);
  if (!todayLogsRes.ok) throw new Error(`today usage HTTP ${todayLogsRes.status}`);

  const profiles = await profilesRes.json();
  const monthLogs = await monthLogsRes.json();
  const todayLogs = await todayLogsRes.json();

  const monthByUser = new Map();
  for (const row of monthLogs) {
    const list = monthByUser.get(row.owner_id) ?? [];
    list.push(row);
    monthByUser.set(row.owner_id, list);
  }

  const todayByUser = new Map();
  for (const row of todayLogs) {
    const list = todayByUser.get(row.owner_id) ?? [];
    list.push(row);
    todayByUser.set(row.owner_id, list);
  }

  const users = profiles.map((p) => {
    const monthRows = monthByUser.get(p.id) ?? [];
    const todayRows = todayByUser.get(p.id) ?? [];
    const monthTokens = monthRows.reduce((s, r) => s + Number(r.total_tokens || 0), 0);
    const monthCost = monthRows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
    const todayTokens = todayRows.reduce((s, r) => s + Number(r.total_tokens || 0), 0);
    const todayCost = todayRows.reduce((s, r) => s + Number(r.cost_usd || 0), 0);
    let lastCallAt = null;
    for (const r of monthRows) {
      if (!lastCallAt || r.created_at > lastCallAt) lastCallAt = r.created_at;
    }
    return {
      userId: p.id,
      email: p.email,
      isAdmin: Boolean(p.is_admin),
      limits: {
        dailyBudgetUsd: numOrNull(p.ai_daily_budget_usd),
        dailyTokenLimit: p.ai_daily_token_limit != null ? Number(p.ai_daily_token_limit) : null,
        monthlyBudgetUsd: numOrNull(p.ai_monthly_budget_usd),
      },
      today: {
        callCount: todayRows.length,
        totalTokens: todayTokens,
        totalCostUsd: todayCost,
      },
      month: {
        callCount: monthRows.length,
        totalTokens: monthTokens,
        totalCostUsd: monthCost,
      },
      lastCallAt,
    };
  });

  users.sort((a, b) => b.month.totalCostUsd - a.month.totalCostUsd);

  const totalCalls = monthLogs.length;
  const totalTokens = monthLogs.reduce((s, r) => s + Number(r.total_tokens || 0), 0);
  const totalCostUsd = monthLogs.reduce((s, r) => s + Number(r.cost_usd || 0), 0);

  return {
    totalUsers: users.length,
    totalCalls,
    totalTokens,
    totalCostUsd,
    users,
    recentLogs: monthLogs.slice(0, 60),
  };
}

export async function updateAdminUserLimits(userId, patch) {
  const { headers, url } = await adminHeaders();
  const payload = { updated_at: new Date().toISOString() };
  if ("dailyBudgetUsd" in patch) payload.ai_daily_budget_usd = patch.dailyBudgetUsd;
  if ("dailyTokenLimit" in patch) payload.ai_daily_token_limit = patch.dailyTokenLimit;
  if ("monthlyBudgetUsd" in patch) payload.ai_monthly_budget_usd = patch.monthlyBudgetUsd;

  const res = await fetch(`${url}/rest/v1/profiles?id=eq.${userId}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(payload),
  });
  if (res.status === 403) {
    throw new Error("Admin update denied — run supabase/admin_user_limits.sql");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
  }
}

export { formatCostUsd };
