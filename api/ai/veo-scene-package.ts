/**
 * Vercel serverless: vision analysis (default gpt-4o) + VEO 3.1 scene JSON (OPENAI_VEO_SCENE_MODEL / gpt-4o-mini).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runVeoScenePackage } from "../../lib/veoScenePackage";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "12mb",
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

    const model =
      process.env.OPENAI_VEO_SCENE_MODEL?.trim() ||
      process.env.OPENAI_CHAT_MODEL?.trim() ||
      "gpt-4o-mini";
    const visionModel = process.env.OPENAI_VEO_VISION_MODEL?.trim();
    const body = req.body as Parameters<typeof runVeoScenePackage>[0];

    const result = await runVeoScenePackage(body, { apiKey, model, visionModel });
    if (result.ok === false) {
      return res.status(result.status).json({ error: result.error });
    }

    return res.status(200).json({
      analysis: result.analysis,
      scenePackage: result.scenePackage,
      ...(result.rawPackageText !== undefined ? { rawPackageText: result.rawPackageText } : {}),
      ...(result.parseError !== undefined ? { parseError: result.parseError } : {}),
    });
  } catch (e) {
    console.error("veo-scene-package", e);
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: msg.slice(0, 800) });
  }
}
