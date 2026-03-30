/**
 * Vercel serverless: self-contained. Mirrors root `aiHandlers.ts` — update both when changing chat.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4.5mb",
    },
  },
};

function applyCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function runOpenAIChat(
  messages: unknown[],
  temperature: number,
  apiKey: string,
  modelEnv: string | undefined
): Promise<string> {
  const model = modelEnv?.trim() || "gpt-4o-mini";
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: typeof temperature === "number" ? temperature : 0.7,
    }),
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 600);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      if (j.error?.message) msg = j.error.message;
    } catch {
      /* ignore */
    }
    const err = new Error(msg) as Error & { httpStatus?: number };
    err.httpStatus = r.status;
    throw err;
  }
  const j = JSON.parse(text) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return j.choices?.[0]?.message?.content ?? "";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return res.status(500).json({
      error:
        "OPENAI_API_KEY nqsa. Zidha f Vercel → Project → Settings → Environment Variables.",
    });
  }

  const body = req.body as {
    messages?: unknown;
    temperature?: unknown;
  };
  const { messages, temperature } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages (array) required" });
  }

  try {
    const text = await runOpenAIChat(
      messages,
      typeof temperature === "number" ? temperature : 0.7,
      apiKey,
      process.env.OPENAI_CHAT_MODEL
    );
    return res.status(200).json({ text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const httpStatus =
      e instanceof Error && "httpStatus" in e
        ? (e as Error & { httpStatus?: number }).httpStatus
        : 500;
    return res
      .status(typeof httpStatus === "number" ? httpStatus : 500)
      .json({ error: msg.slice(0, 600) });
  }
}
