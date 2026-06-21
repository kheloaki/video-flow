import { apiUrl } from "../apiBase";
import { getApiAuthHeader } from "./apiAuth";

export type VisionLockStatus = {
  locked: boolean;
  ownerId?: string;
  ownerLabel?: string;
  progressHint?: string;
  expiresAt?: string;
  heartbeatAt?: string;
};

export function visionLockWaitMessage(status: VisionLockStatus): string {
  const who = status.ownerLabel?.trim() || "Another user";
  const hint = status.progressHint?.trim() ? ` (${status.progressHint})` : "";
  return `${who} is running vision analyze${hint}. Please wait until they finish.`;
}

export async function fetchVisionLockStatus(): Promise<VisionLockStatus> {
  const headers = await getApiAuthHeader();
  if (!headers.Authorization) return { locked: false };

  try {
    const res = await fetch(apiUrl("/api/ai/vision-lock"), { headers });
    if (!res.ok) return { locked: false };
    return (await res.json()) as VisionLockStatus;
  } catch {
    return { locked: false };
  }
}

export async function releaseVisionAnalyzeLock(): Promise<void> {
  const headers = await getApiAuthHeader();
  if (!headers.Authorization) return;

  try {
    await fetch(apiUrl("/api/ai/vision-lock"), {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release" }),
    });
  } catch {
    /* ignore */
  }
}
