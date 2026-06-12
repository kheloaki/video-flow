import { apiUrl } from "../apiBase";

async function fetchWithTimeout(
  url: string,
  body: unknown,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const id = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(id);
  }
}

/** POST + JSON body; parse JSON response; throw with useful message if server returns non-JSON. */
export async function postAiJson(
  path: string,
  body: unknown,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const res = await fetchWithTimeout(apiUrl(path), body, timeoutMs);
  const rawText = await res.text();
  const ct = res.headers.get("content-type") ?? "";
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    if (!res.ok) {
      const hint =
        rawText.trim() === ""
          ? ` Body khawi — 9lban timeout wla crash. Content-Type: ${ct || "?"}`
          : "";
      throw new Error((rawText.trim().slice(0, 500) || `HTTP ${res.status}`) + hint);
    }
    throw new Error("Natija dial server ma-shi JSON.");
  }
  if (!res.ok) {
    const errMsg = typeof data.error === "string" ? data.error.trim() : "";
    throw new Error(errMsg || rawText.trim().slice(0, 500) || `HTTP ${res.status}`);
  }
  return data;
}
