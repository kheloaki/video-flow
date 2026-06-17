import { getSupabaseConfig, getSession } from "./auth.js";
import { formatCostUsd } from "./usage-db.js";

function monthStartIso() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function fetchAdminUsageOverview() {
  const session = await getSession();
  const config = await getSupabaseConfig();
  if (!session?.accessToken || !config.url || !config.anonKey) {
    throw new Error("Not logged in or Supabase not configured.");
  }

  const headers = {
    apikey: config.anonKey,
    Authorization: `Bearer ${session.accessToken}`,
  };
  const since = monthStartIso();

  const [profilesRes, logsRes] = await Promise.all([
    fetch(`${config.url}/rest/v1/profiles?select=id,email&order=email`, { headers }),
    fetch(
      `${config.url}/rest/v1/ai_usage_log?created_at=gte.${since}&select=owner_id,label,model,total_tokens,cost_usd,created_at&order=created_at.desc&limit=500`,
      { headers }
    ),
  ]);

  if (profilesRes.status === 403 || logsRes.status === 403) {
    throw new Error("Admin access denied — set is_admin = true on your profile.");
  }
  if (!profilesRes.ok) throw new Error(`profiles HTTP ${profilesRes.status}`);
  if (!logsRes.ok) throw new Error(`usage HTTP ${logsRes.status}`);

  const profiles = await profilesRes.json();
  const logs = await logsRes.json();
  const emailById = new Map(profiles.map((p) => [p.id, p.email]));

  const byUser = new Map();
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
    existing.totalTokens += Number(row.total_tokens || 0);
    existing.totalCostUsd += Number(row.cost_usd || 0);
    if (!existing.lastCallAt || row.created_at > existing.lastCallAt) {
      existing.lastCallAt = row.created_at;
    }
    byUser.set(row.owner_id, existing);
  }

  const users = [...byUser.values()].sort((a, b) => b.totalCostUsd - a.totalCostUsd);
  const totalCalls = logs.length;
  const totalTokens = logs.reduce((s, r) => s + Number(r.total_tokens || 0), 0);
  const totalCostUsd = logs.reduce((s, r) => s + Number(r.cost_usd || 0), 0);

  return {
    totalUsers: users.length,
    totalCalls,
    totalTokens,
    totalCostUsd,
    users,
    recentLogs: logs.slice(0, 60),
  };
}

export { formatCostUsd };
