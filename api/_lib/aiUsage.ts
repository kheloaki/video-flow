/** OpenAI / Gemini token usage + USD estimate (server-side). */

export type AiUsagePayload = {
  provider: "openai" | "gemini";
  model: string;
  operation: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
};

type ModelRates = { inputPer1M: number; outputPer1M: number };

/** USD per 1M tokens — update when OpenAI/Gemini pricing changes. */
const MODEL_RATES: Record<string, ModelRates> = {
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gemini-2.5-flash": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4 },
};

function normalizeModelKey(model: string): string {
  const m = model.trim().toLowerCase();
  if (m.includes("gpt-4o-mini")) return "gpt-4o-mini";
  if (m.includes("gpt-4o")) return "gpt-4o";
  if (m.includes("gemini-2.5-flash")) return "gemini-2.5-flash";
  if (m.includes("gemini-2.0-flash")) return "gemini-2.0-flash";
  return m;
}

export function calcCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const key = normalizeModelKey(model);
  const rates = MODEL_RATES[key] ?? MODEL_RATES["gpt-4o-mini"];
  const cost =
    (promptTokens / 1_000_000) * rates.inputPer1M +
    (completionTokens / 1_000_000) * rates.outputPer1M;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function parseOpenAiUsage(
  json: {
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  },
  model: string,
  operation: string
): AiUsagePayload | null {
  const u = json.usage;
  if (!u) return null;
  const promptTokens = u.prompt_tokens ?? 0;
  const completionTokens = u.completion_tokens ?? 0;
  const totalTokens = u.total_tokens ?? promptTokens + completionTokens;
  if (totalTokens <= 0) return null;
  return {
    provider: "openai",
    model,
    operation,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: calcCostUsd(model, promptTokens, completionTokens),
  };
}

export function buildGeminiUsage(
  model: string,
  operation: string,
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  } | null
): AiUsagePayload | null {
  if (!usageMetadata) return null;
  const promptTokens = usageMetadata.promptTokenCount ?? 0;
  const completionTokens = usageMetadata.candidatesTokenCount ?? 0;
  const totalTokens = usageMetadata.totalTokenCount ?? promptTokens + completionTokens;
  if (totalTokens <= 0) return null;
  return {
    provider: "gemini",
    model,
    operation,
    promptTokens,
    completionTokens,
    totalTokens,
    costUsd: calcCostUsd(model, promptTokens, completionTokens),
  };
}
