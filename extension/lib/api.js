const DEFAULT_BASE = "http://localhost:3000";

import { getValidSession } from "./auth.js";
import { isAiRateLimitError, parseOpenAiRetryMs, withAiRateLimitRetry } from "./ai-rate-limit-retry.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getApiBase() {
  const data = await chrome.storage.sync.get("appBaseUrl");
  const base = (data.appBaseUrl || DEFAULT_BASE).trim().replace(/\/$/, "");
  return base || DEFAULT_BASE;
}

export async function setApiBase(url) {
  await chrome.storage.sync.set({ appBaseUrl: url.trim().replace(/\/$/, "") });
}

export async function postAiJson(path, body, timeoutMs = 180_000, baseOverride) {
  return withAiRateLimitRetry(async () => {
    const base = (baseOverride || (await getApiBase())).replace(/\/$/, "");
    const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
    const session = await getValidSession();
    const headers = { "Content-Type": "application/json" };
    if (session?.accessToken) {
      headers.Authorization = `Bearer ${session.accessToken}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(text.slice(0, 400) || `HTTP ${res.status}`);
      }
      if (!res.ok) {
        const msg = data.error || data.message || `HTTP ${res.status}`;
        if (isAiRateLimitError(msg, res.status)) {
          const waitMs = parseOpenAiRetryMs(msg);
          if (waitMs) await sleep(waitMs);
        }
        throw new Error(msg);
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  });
}

export async function testApiConnection() {
  try {
    await postAiJson("/api/ai/chat", { messages: [{ role: "user", content: "ping" }] }, 8000);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
