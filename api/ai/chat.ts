import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runOpenAIChat } from "../lib/aiHandlers";

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
    const { text } = await runOpenAIChat(
      messages,
      typeof temperature === "number" ? temperature : 0.7,
      { apiKey, model: process.env.OPENAI_CHAT_MODEL }
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
