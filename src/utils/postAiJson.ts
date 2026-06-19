import { apiUrl } from "../apiBase";
import { recordAiUsageFromResponse } from "./aiUsage";
import { getApiAuthHeader } from "./apiAuth";

async function fetchWithTimeout(
  url: string,
  body: unknown,
  timeoutMs: number,
  extraHeaders?: Record<string, string>
): Promise<Response> {
  const controller = new AbortController();
  const id = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...extraHeaders,
      },
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
  timeoutMs: number,
  label?: string
): Promise<Record<string, unknown>> {
  const authHeaders = await getApiAuthHeader();
  const res = await fetchWithTimeout(apiUrl(path), body, timeoutMs, authHeaders);
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
    const body = rawText.trim().slice(0, 500) || `HTTP ${res.status}`;
    if (body.includes("FUNCTION_INVOCATION_FAILED")) {
      throw new Error(
        "Vercel server crash (FUNCTION_INVOCATION_FAILED) — 9rib tsawer kbira bzaf f request. Kan-compressiw auto; 3awd analyze. Ila baqi, chof Vercel logs."
      );
    }
    throw new Error(errMsg || body);
  }
  if (label) recordAiUsageFromResponse(data, label);
  return data;
}
