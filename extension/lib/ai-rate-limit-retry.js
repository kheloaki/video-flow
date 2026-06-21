function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseOpenAiRetryMs(message) {
  const m = String(message).match(/try again in ([\d.]+)s/i);
  if (!m) return null;
  return Math.ceil(parseFloat(m[1]) * 1000) + 500;
}

export function isAiRateLimitError(message, status) {
  const low = String(message).toLowerCase();
  return (
    status === 429 ||
    low.includes("429") ||
    low.includes("rate limit") ||
    low.includes("tokens per min")
  );
}

export async function withAiRateLimitRetry(fn, maxRetries = 6) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!isAiRateLimitError(msg) || attempt === maxRetries) throw e;
      const waitMs = parseOpenAiRetryMs(msg) ?? Math.min(30_000, 2000 * 2 ** attempt);
      await sleep(waitMs);
    }
  }
  throw new Error("Rate limit retries exhausted");
}
