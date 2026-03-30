import "dotenv/config";
import express from "express";
import { runGeminiTranscription, runOpenAIChat } from "./api/lib/aiHandlers";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import path from "path";
import { createRouteHandler, createUploadthing, type FileRouter } from "uploadthing/express";

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

  // Allow browser calls from Vite dev (:5173) while API stays on :3000
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (
      origin &&
      /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)
    ) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET,POST,DELETE,PUT,PATCH,OPTIONS"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        req.header("Access-Control-Request-Headers") ||
          "Content-Type, Authorization"
      );
    }
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

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
      const mimeType =
        req.file.mimetype && req.file.mimetype !== ""
          ? req.file.mimetype
          : "application/octet-stream";
      const { text } = await runGeminiTranscription(
        req.file.buffer,
        mimeType,
        {
          apiKey,
          model: process.env.GEMINI_TRANSCRIPTION_MODEL,
        }
      );
      res.json({ text });
    } catch (e) {
      console.error("transcribe", e);
      const msg = e instanceof Error ? e.message : String(e);
      const status = msg.includes("kbir") ? 400 : 500;
      res.status(status).json({ error: msg.slice(0, 600) });
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
        const { text: content } = await runOpenAIChat(
          messages,
          typeof temperature === "number" ? temperature : 0.7,
          {
            apiKey,
            model: process.env.OPENAI_CHAT_MODEL,
          }
        );
        res.json({ text: content });
      } catch (e) {
        console.error("chat", e);
        const msg = e instanceof Error ? e.message : String(e);
        const httpStatus =
          e instanceof Error && "httpStatus" in e
            ? (e as Error & { httpStatus?: number }).httpStatus
            : undefined;
        res
          .status(typeof httpStatus === "number" ? httpStatus : 500)
          .json({ error: msg.slice(0, 600) });
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
