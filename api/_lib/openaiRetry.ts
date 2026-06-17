function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseOpenAiRetryMs(message: string): number | null {
  const m = message.match(/try again in ([\d.]+)s/i);
  if (!m) return null;
  return Math.ceil(parseFloat(m[1]) * 1000) + 400;
}

/** POST chat/completions with automatic backoff on HTTP 429. */
export async function fetchOpenAiChat(
  apiKey: string,
  payload: Record<string, unknown>,
  maxRetries = 4
): Promise<{ ok: boolean; status: number; text: string }> {
  const body = JSON.stringify(payload);
  const url = "https://api.openai.com/v1/chat/completions";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
    });
    const text = await r.text();
    if (r.ok || r.status !== 429) {
      return { ok: r.ok, status: r.status, text };
    }
    if (attempt === maxRetries) {
      return { ok: false, status: r.status, text };
    }
    let waitMs = Math.min(30_000, 2500 * 2 ** attempt);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      const parsed = parseOpenAiRetryMs(j.error?.message ?? text);
      if (parsed) waitMs = parsed;
    } catch {
      const parsed = parseOpenAiRetryMs(text);
      if (parsed) waitMs = parsed;
    }
    await sleep(waitMs);
  }

  return { ok: false, status: 429, text: "Rate limit exceeded" };
}
