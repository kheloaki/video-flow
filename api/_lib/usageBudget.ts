export type UsageBudgetResult =
  | { allowed: true }
  | { allowed: false; status: number; error: string };

type RequestLike = {
  headers?: {
    authorization?: string;
    Authorization?: string;
  };
};

function todayStartIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function monthStartIso(): string {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function authHeader(req: RequestLike): string | null {
  const raw = req.headers?.authorization ?? req.headers?.Authorization;
  if (!raw?.startsWith("Bearer ")) return null;
  const token = raw.slice(7).trim();
  return token || null;
}

function supabaseEnv() {
  const url = process.env.VITE_SUPABASE_URL?.trim().replace(/\/$/, "");
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

async function supabaseFetch(
  path: string,
  token: string,
  env: { url: string; anonKey: string }
) {
  const res = await fetch(`${env.url}${path}`, {
    headers: {
      apikey: env.anonKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Block AI routes when a signed-in user exceeded admin-set daily/monthly limits. */
export async function checkAiUsageBudget(req: RequestLike): Promise<UsageBudgetResult> {
  const token = authHeader(req);
  const env = supabaseEnv();
  if (!token || !env) return { allowed: true };

  const user = await supabaseFetch("/auth/v1/user", token, env);
  const userId = user?.id as string | undefined;
  if (!userId) return { allowed: true };

  const profiles = (await supabaseFetch(
    `/rest/v1/profiles?id=eq.${userId}&select=ai_daily_budget_usd,ai_daily_token_limit,ai_monthly_budget_usd`,
    token,
    env
  )) as Array<{
    ai_daily_budget_usd: number | null;
    ai_daily_token_limit: number | null;
    ai_monthly_budget_usd: number | null;
  }> | null;

  const profile = profiles?.[0];
  if (!profile) return { allowed: true };

  const dailyBudget =
    profile.ai_daily_budget_usd != null ? Number(profile.ai_daily_budget_usd) : null;
  const dailyTokenLimit =
    profile.ai_daily_token_limit != null ? Number(profile.ai_daily_token_limit) : null;
  const monthlyBudget =
    profile.ai_monthly_budget_usd != null ? Number(profile.ai_monthly_budget_usd) : null;

  if (dailyBudget == null && dailyTokenLimit == null && monthlyBudget == null) {
    return { allowed: true };
  }

  const todayRows = (await supabaseFetch(
    `/rest/v1/ai_usage_log?owner_id=eq.${userId}&created_at=gte.${todayStartIso()}&select=total_tokens,cost_usd`,
    token,
    env
  )) as Array<{ total_tokens: number; cost_usd: number }> | null;

  const todayTokens = (todayRows ?? []).reduce((s, r) => s + Number(r.total_tokens || 0), 0);
  const todayCost = (todayRows ?? []).reduce((s, r) => s + Number(r.cost_usd || 0), 0);

  if (dailyTokenLimit != null && dailyTokenLimit > 0 && todayTokens >= dailyTokenLimit) {
    return {
      allowed: false,
      status: 429,
      error: `Daily token limit reached (${dailyTokenLimit.toLocaleString()}). Ask an admin to raise your cap.`,
    };
  }

  if (dailyBudget != null && dailyBudget > 0 && todayCost >= dailyBudget) {
    return {
      allowed: false,
      status: 429,
      error: `Daily spend limit reached ($${dailyBudget.toFixed(2)}). Ask an admin to raise your cap.`,
    };
  }

  if (monthlyBudget != null && monthlyBudget > 0) {
    const monthRows = (await supabaseFetch(
      `/rest/v1/ai_usage_log?owner_id=eq.${userId}&created_at=gte.${monthStartIso()}&select=cost_usd`,
      token,
      env
    )) as Array<{ cost_usd: number }> | null;
    const monthCost = (monthRows ?? []).reduce((s, r) => s + Number(r.cost_usd || 0), 0);
    if (monthCost >= monthlyBudget) {
      return {
        allowed: false,
        status: 429,
        error: `Monthly spend limit reached ($${monthlyBudget.toFixed(2)}). Ask an admin to raise your cap.`,
      };
    }
  }

  return { allowed: true };
}
