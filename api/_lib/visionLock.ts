export const VISION_LOCK_KEY = "global_clone_analyze";

export type VisionLockStatus = {
  locked: boolean;
  ownerId?: string;
  ownerLabel?: string;
  progressHint?: string;
  expiresAt?: string;
  heartbeatAt?: string;
};

export type VisionLockAcquireResult =
  | { ok: true }
  | { ok: false; status: number; error: string; lock?: VisionLockStatus };

type RequestLike = {
  headers?: {
    authorization?: string;
    Authorization?: string;
  };
  body?: Record<string, unknown>;
};

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
  env: { url: string; anonKey: string },
  init?: RequestInit
) {
  const res = await fetch(`${env.url}${path}`, {
    ...init,
    headers: {
      apikey: env.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function currentUser(token: string, env: { url: string; anonKey: string }) {
  const user = await supabaseFetch("/auth/v1/user", token, env);
  if (!user?.id) return null;
  const email = typeof user.email === "string" ? user.email : "";
  return { id: user.id as string, label: email || "Another user" };
}

function lockFromRpc(data: Record<string, unknown> | null): VisionLockStatus | undefined {
  if (!data || data.locked !== true) return undefined;
  return {
    locked: true,
    ownerId: typeof data.owner_id === "string" ? data.owner_id : undefined,
    ownerLabel: typeof data.owner_label === "string" ? data.owner_label : undefined,
    progressHint: typeof data.progress_hint === "string" ? data.progress_hint : undefined,
    expiresAt: typeof data.expires_at === "string" ? data.expires_at : undefined,
    heartbeatAt: typeof data.heartbeat_at === "string" ? data.heartbeat_at : undefined,
  };
}

/** Skip lock when no Supabase auth (local dev without login). */
export async function acquireVisionLock(req: RequestLike): Promise<VisionLockAcquireResult> {
  const token = authHeader(req);
  const env = supabaseEnv();
  if (!token || !env) return { ok: true };

  const user = await currentUser(token, env);
  if (!user) return { ok: true };

  const progressHint =
    typeof req.body?.lockHint === "string" ? req.body.lockHint.trim().slice(0, 120) : "";

  const result = (await supabaseFetch("/rest/v1/rpc/try_acquire_vision_lock", token, env, {
    method: "POST",
    body: JSON.stringify({
      p_lock_key: VISION_LOCK_KEY,
      p_owner_id: user.id,
      p_owner_label: user.label,
      p_progress_hint: progressHint,
      p_ttl_seconds: 300,
    }),
  })) as Record<string, unknown> | null;

  if (!result) return { ok: true };

  if (result.ok === true && result.acquired === true) {
    return { ok: true };
  }

  const ownerLabel =
    typeof result.owner_label === "string" && result.owner_label.trim()
      ? result.owner_label.trim()
      : "Another user";
  const progress =
    typeof result.progress_hint === "string" && result.progress_hint.trim()
      ? ` (${result.progress_hint.trim()})`
      : "";

  const status = await getVisionLockStatus(req);

  return {
    ok: false,
    status: 423,
    error: `${ownerLabel} is running vision analyze${progress}. Please wait until they finish.`,
    lock: status.locked ? status : lockFromRpc(result),
  };
}

export async function releaseVisionLock(req: RequestLike): Promise<void> {
  const token = authHeader(req);
  const env = supabaseEnv();
  if (!token || !env) return;

  const user = await currentUser(token, env);
  if (!user) return;

  await supabaseFetch("/rest/v1/rpc/release_vision_lock", token, env, {
    method: "POST",
    body: JSON.stringify({
      p_lock_key: VISION_LOCK_KEY,
      p_owner_id: user.id,
    }),
  });
}

export async function getVisionLockStatus(req: RequestLike): Promise<VisionLockStatus> {
  const token = authHeader(req);
  const env = supabaseEnv();
  if (!token || !env) return { locked: false };

  const user = await currentUser(token, env);

  const result = (await supabaseFetch("/rest/v1/rpc/get_vision_lock_status", token, env, {
    method: "POST",
    body: JSON.stringify({ p_lock_key: VISION_LOCK_KEY }),
  })) as Record<string, unknown> | null;

  if (!result || result.locked !== true) {
    return { locked: false };
  }

  const status: VisionLockStatus = {
    locked: true,
    ownerId: typeof result.owner_id === "string" ? result.owner_id : undefined,
    ownerLabel: typeof result.owner_label === "string" ? result.owner_label : undefined,
    progressHint: typeof result.progress_hint === "string" ? result.progress_hint : undefined,
    expiresAt: typeof result.expires_at === "string" ? result.expires_at : undefined,
    heartbeatAt: typeof result.heartbeat_at === "string" ? result.heartbeat_at : undefined,
  };

  if (user && status.ownerId === user.id) {
    return { locked: false };
  }

  return status;
}
