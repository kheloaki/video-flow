import { getApiBase } from "./api.js";
import { getValidSession } from "./auth.js";

export function visionLockWaitMessage(status) {
  const who = status.ownerLabel?.trim() || "Another user";
  const hint = status.progressHint?.trim() ? ` (${status.progressHint})` : "";
  return `${who} is running vision analyze${hint}. Please wait until they finish.`;
}

async function authHeaders() {
  const session = await getValidSession();
  if (!session?.accessToken) return null;
  return { Authorization: `Bearer ${session.accessToken}` };
}

export async function fetchVisionLockStatus(baseOverride) {
  const headers = await authHeaders();
  if (!headers) return { locked: false };

  try {
    const base = (baseOverride || (await getApiBase())).replace(/\/$/, "");
    const res = await fetch(`${base}/api/ai/vision-lock`, { headers });
    if (!res.ok) return { locked: false };
    return await res.json();
  } catch {
    return { locked: false };
  }
}

export async function releaseVisionAnalyzeLock(baseOverride) {
  const headers = await authHeaders();
  if (!headers) return;

  try {
    const base = (baseOverride || (await getApiBase())).replace(/\/$/, "");
    await fetch(`${base}/api/ai/vision-lock`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release" }),
    });
  } catch {
    /* ignore */
  }
}
