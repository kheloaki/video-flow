import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getVisionLockStatus, releaseVisionLock } from "../_lib/visionLock.js";

function applyCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    applyCors(res);
    if (req.method === "OPTIONS") return res.status(204).end();

    if (req.method === "GET") {
      const status = await getVisionLockStatus(req);
      return res.status(200).json(status);
    }

    if (req.method === "POST") {
      const action =
        typeof req.body === "object" && req.body && "action" in req.body
          ? String((req.body as { action?: string }).action)
          : "release";
      if (action === "release") {
        await releaseVisionLock(req);
        return res.status(200).json({ ok: true });
      }
      return res.status(400).json({ error: "Unknown action" });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("vision-lock", e);
    const msg = e instanceof Error ? e.message : String(e);
    return res.status(500).json({ error: msg.slice(0, 400) });
  }
}
