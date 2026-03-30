/**
 * Vercel serverless: self-contained (no ../../ imports) so the bundle always resolves.
 * Logic mirrors root `aiHandlers.ts` — update both when changing transcription.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI } from "@google/genai";
import formidable from "formidable";
import fs from "fs/promises";

const GEMINI_INLINE_MAX_BYTES = 20 * 1024 * 1024;

export const config = {
  api: {
    bodyParser: false,
  },
};

function applyCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function runGeminiTranscription(
  buffer: Buffer,
  mimeType: string,
  apiKey: string,
  modelEnv: string | undefined
): Promise<string> {
  if (buffer.length > GEMINI_INLINE_MAX_BYTES) {
    throw new Error(
      "Media kbir bzaf (~max 20MB l-Gemini inline). Jereb video sgher wla extract dial soute."
    );
  }
  const model = modelEnv?.trim() || "gemini-2.5-flash";
  const mt =
    mimeType && mimeType !== "" ? mimeType : "application/octet-stream";
  const base64Data = buffer.toString("base64");
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: [
      { inlineData: { mimeType: mt, data: base64Data } },
      {
        text: "Transcribe the voice script of this media in Moroccan Darija. Just the text. If there is no voice, say 'Makaynch soute f had l-video'.",
      },
    ],
  });
  return (response.text ?? "").trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(res);
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (!geminiKey) {
    return res.status(500).json({
      error:
        "GEMINI_API_KEY nqsa. Zidha f Vercel → Project → Settings → Environment Variables.",
    });
  }

  const form = formidable({
    maxFileSize: 20 * 1024 * 1024,
    multiples: false,
  });

  let buffer: Buffer;
  let mime = "application/octet-stream";

  try {
    const [, files] = await form.parse(req);
    const raw = files.file;
    const file = Array.isArray(raw) ? raw[0] : raw;
    if (!file) {
      return res.status(400).json({ error: "Missing file" });
    }
    const fp = "filepath" in file ? (file as { filepath: string }).filepath : null;
    if (!fp) {
      return res.status(400).json({ error: "Missing file path" });
    }
    buffer = await fs.readFile(fp);
    mime =
      "mimetype" in file && (file as { mimetype?: string }).mimetype
        ? (file as { mimetype: string }).mimetype
        : mime;
    await fs.unlink(fp).catch(() => {});
  } catch (e) {
    console.error("transcribe multipart", e);
    return res.status(400).json({ error: "Invalid multipart upload" });
  }

  try {
    const text = await runGeminiTranscription(
      buffer,
      mime,
      geminiKey,
      process.env.GEMINI_TRANSCRIPTION_MODEL
    );
    return res.status(200).json({ text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("kbir") ? 400 : 500;
    return res.status(status).json({ error: msg.slice(0, 600) });
  }
}
