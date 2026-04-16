/**
 * Vercel serverless: vision only (debut+fin stills) — keep under serverless time limits; pair with veo-scene-package + imageAnalysis.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runVeoSceneAnalyze } from "../../lib/veoScenePackage";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
  },
  maxDuration: 120,
};

function applyCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    applyCors(res);
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return res.status(500).json({
        error:
          "OPENAI_API_KEY nqsa. Zidha f Vercel → Project → Settings → Environment Variables.",
      });
    }

    const visionModel = process.env.OPENAI_VEO_VISION_MODEL?.trim();
    const body = req.body as Parameters<typeof runVeoSceneAnalyze>[0];

    const result = await runVeoSceneAnalyze(body, { apiKey, visionModel });
    if (result.ok === false) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.status(200).json({ analysis: result.analysis });
  } catch (e) {
    console.error("veo-scene-analyze", e);
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: msg.slice(0, 800) });
  }
}
