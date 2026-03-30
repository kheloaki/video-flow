/**
 * Shared AI handlers for Express (server.ts) and Vercel serverless (api/).
 */
import { GoogleGenAI } from "@google/genai";

export const GEMINI_INLINE_MAX_BYTES = 20 * 1024 * 1024;

export async function runGeminiTranscription(
  buffer: Buffer,
  mimeType: string,
  options: { apiKey: string; model?: string }
): Promise<{ text: string }> {
  if (buffer.length > GEMINI_INLINE_MAX_BYTES) {
    throw new Error(
      "Media kbir bzaf (~max 20MB l-Gemini inline). Jereb video sgher wla extract dial soute."
    );
  }
  const model = options.model?.trim() || "gemini-2.5-flash";
  const mt =
    mimeType && mimeType !== "" ? mimeType : "application/octet-stream";
  const base64Data = buffer.toString("base64");
  const ai = new GoogleGenAI({ apiKey: options.apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: [
      { inlineData: { mimeType: mt, data: base64Data } },
      {
        text: "Transcribe the voice script of this media in Moroccan Darija. Just the text. If there is no voice, say 'Makaynch soute f had l-video'.",
      },
    ],
  });
  return { text: (response.text ?? "").trim() };
}

export async function runOpenAIChat(
  messages: unknown[],
  temperature: number,
  options: { apiKey: string; model?: string }
): Promise<{ text: string }> {
  const model = options.model?.trim() || "gpt-4o-mini";
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
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
  return { text: j.choices?.[0]?.message?.content ?? "" };
}
