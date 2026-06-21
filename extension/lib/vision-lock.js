import { getSupabaseConfig, getValidSession } from "./auth.js";

export const VISION_LOCK_KEY = "global_clone_analyze";

export function visionLockWaitMessage(status) {
  const who = status.ownerLabel?.trim() || "Another user";
  const hint = status.progressHint?.trim() ? ` (${status.progressHint})` : "";
  return `${who} is running vision analyze${hint}. Please wait until they finish.`;
}

async function supabaseRpc(fn, body) {
  const config = await getSupabaseConfig();
  const session = await getValidSession();
  if (!config.url || !config.anonKey || !session?.accessToken) {
    return null;
  }
  const res = await fetch(`${config.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function currentUserLabel(session, config) {
  try {
    const res = await fetch(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${session.accessToken}`,
      },
    });
    if (!res.ok) return "Another user";
    const user = await res.json();
    return typeof user.email === "string" && user.email.trim() ? user.email.trim() : "Another user";
  } catch {
    return "Another user";
  }
}

function statusFromRpc(data, session) {
  if (!data || data.locked !== true) return { locked: false };
  if (session?.userId && data.owner_id === session.userId) {
    return { locked: false };
  }
  return {
    locked: true,
    ownerId: typeof data.owner_id === "string" ? data.owner_id : undefined,
    ownerLabel: typeof data.owner_label === "string" ? data.owner_label : undefined,
    progressHint: typeof data.progress_hint === "string" ? data.progress_hint : undefined,
    expiresAt: typeof data.expires_at === "string" ? data.expires_at : undefined,
    heartbeatAt: typeof data.heartbeat_at === "string" ? data.heartbeat_at : undefined,
  };
}

export async function fetchVisionLockStatus() {
  const session = await getValidSession();
  if (!session?.accessToken) return { locked: false };

  const result = await supabaseRpc("get_vision_lock_status", {
    p_lock_key: VISION_LOCK_KEY,
  });
  return statusFromRpc(result, session);
}

export async function releaseVisionAnalyzeLock() {
  const session = await getValidSession();
  if (!session?.userId) return;

  await supabaseRpc("release_vision_lock", {
    p_lock_key: VISION_LOCK_KEY,
    p_owner_id: session.userId,
  });
}

/** Renew lock for the current user (optional progress hint). */
export async function renewVisionAnalyzeLock(progressHint = "") {
  const config = await getSupabaseConfig();
  const session = await getValidSession();
  if (!config.url || !session?.userId) return { ok: true };

  const ownerLabel = await currentUserLabel(session, config);
  await supabaseRpc("try_acquire_vision_lock", {
    p_lock_key: VISION_LOCK_KEY,
    p_owner_id: session.userId,
    p_owner_label: ownerLabel,
    p_progress_hint: progressHint.slice(0, 120),
    p_ttl_seconds: 300,
  });
  return { ok: true };
}
