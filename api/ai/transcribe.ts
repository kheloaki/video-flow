import type { VercelRequest, VercelResponse } from "@vercel/node";
import formidable from "formidable";
import fs from "fs/promises";
import { runGeminiTranscription } from "../../aiHandlers";

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
    const { text } = await runGeminiTranscription(buffer, mime, {
      apiKey: geminiKey,
      model: process.env.GEMINI_TRANSCRIPTION_MODEL,
    });
    return res.status(200).json({ text });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("kbir") ? 400 : 500;
    return res.status(status).json({ error: msg.slice(0, 600) });
  }
}
