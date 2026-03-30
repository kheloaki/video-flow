import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import express from "express";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import path from "path";
import { createRouteHandler, createUploadthing, type FileRouter } from "uploadthing/express";

/** Gemini inline payload limit — stay under typical API caps */
const GEMINI_INLINE_MAX_BYTES = 20 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 26 * 1024 * 1024 },
});

const f = createUploadthing();

export const uploadRouter = {
  imageUploader: f({ image: { maxFileSize: "4MB", maxFileCount: 1 } })
    .onUploadComplete((data) => {
      console.log("file url", data.file.url);
    }),
} satisfies FileRouter;

export type OurFileRouter = typeof uploadRouter;

async function startServer() {
  const app = express();
  const PORT = 3000;

  // UploadThing API Route
  app.use(
    "/api/uploadthing",
    createRouteHandler({
      router: uploadRouter,
      config: {
        token: process.env.UPLOADTHING_TOKEN,
      },
    })
  );

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // In-memory store for scenes received from webhook
  const scenesStore = new Map<string, any[]>();

  // Webhook endpoint to receive individual scenes from Make.com
  app.post("/api/webhook/scene", express.json(), (req, res) => {
    const { videoId, scene } = req.body;
    if (!videoId || !scene) {
      return res.status(400).json({ error: "Missing videoId or scene" });
    }
    
    const currentScenes = scenesStore.get(videoId) || [];
    // Check if scene already exists to avoid duplicates (based on sceneNumber)
    const existingIndex = currentScenes.findIndex((s: any) => 
      (s.sceneNumber || s.scene_number) === (scene.sceneNumber || scene.scene_number)
    );
    
    if (existingIndex >= 0) {
      currentScenes[existingIndex] = scene; // Update existing
    } else {
      currentScenes.push(scene); // Add new
    }
    
    // Sort scenes by sceneNumber
    currentScenes.sort((a: any, b: any) => {
      const numA = a.sceneNumber || a.scene_number || 0;
      const numB = b.sceneNumber || b.scene_number || 0;
      return numA - numB;
    });

    scenesStore.set(videoId, currentScenes);
    
    res.json({ success: true, message: "Scene received and stored" });
  });

  // Endpoint for the frontend to poll for received scenes
  app.get("/api/scenes/:videoId", (req, res) => {
    const { videoId } = req.params;
    const scenes = scenesStore.get(videoId) || [];
    res.json({ scenes });
  });

  // Endpoint to clear scenes for a video (optional, for cleanup)
  app.delete("/api/scenes/:videoId", (req, res) => {
    const { videoId } = req.params;
    scenesStore.delete(videoId);
    res.json({ success: true });
  });

  app.post("/api/ai/transcribe", upload.single("file"), async (req, res) => {
    try {
      if (!req.file?.buffer) {
        return res.status(400).json({ error: "Missing file" });
      }
      const apiKey = process.env.GEMINI_API_KEY?.trim();
      if (!apiKey) {
        return res.status(500).json({
          error:
            "GEMINI_API_KEY nqsa 3la server. Zid GEMINI_API_KEY f .env w 3awd demmar npm run dev.",
        });
      }
      if (req.file.buffer.length > GEMINI_INLINE_MAX_BYTES) {
        return res.status(400).json({
          error:
            "Media kbir bzaf (~max 20MB l-Gemini inline). Jereb video sgher wla extract dial soute.",
        });
      }
      const model =
        process.env.GEMINI_TRANSCRIPTION_MODEL?.trim() || "gemini-2.5-flash";
      const mimeType =
        req.file.mimetype && req.file.mimetype !== ""
          ? req.file.mimetype
          : "application/octet-stream";
      const base64Data = req.file.buffer.toString("base64");
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
          {
            text: "Transcribe the voice script of this media in Moroccan Darija. Just the text. If there is no voice, say 'Makaynch soute f had l-video'.",
          },
        ],
      });
      const out = (response.text ?? "").trim();
      res.json({ text: out });
    } catch (e) {
      console.error("transcribe", e);
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: msg.slice(0, 600) });
    }
  });

  app.post(
    "/api/ai/chat",
    express.json({ limit: "4mb" }),
    async (req, res) => {
      try {
        const { messages, temperature } = req.body as {
          messages?: unknown;
          temperature?: unknown;
        };
        if (!Array.isArray(messages) || messages.length === 0) {
          return res.status(400).json({ error: "messages (array) required" });
        }
        const apiKey = process.env.OPENAI_API_KEY?.trim();
        if (!apiKey) {
          return res.status(500).json({
            error:
              "OPENAI_API_KEY nqsa 3la server. Zid OPENAI_API_KEY f .env w 3awd demmar npm run dev.",
          });
        }
        const model = process.env.OPENAI_CHAT_MODEL?.trim() || "gpt-4o-mini";
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
          return res.status(r.status).json({ error: msg });
        }
        const j = JSON.parse(text) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = j.choices?.[0]?.message?.content ?? "";
        res.json({ text: content });
      } catch (e) {
        console.error("chat", e);
        res.status(500).json({ error: String(e) });
      }
    }
  );

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      root: process.cwd(),
      configFile: path.join(process.cwd(), "vite.config.ts"),
      server: {
        middlewareMode: true,
        // Avoid clashing with another Vite dev server on the default HMR port
        hmr: { port: 24679 },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
