import "dotenv/config";
import express from "express";
import { runGeminiTranscription, runOpenAIChat } from "./aiHandlers";
import { runVeoSceneAnalyze, runVeoScenePackage } from "./lib/veoScenePackage";
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

/** Express 4 does not catch `async` route rejections — forward to `next` so JSON error middleware runs. */
function wrapAsync(
  fn: (req: express.Request, res: express.Response) => Promise<void>
): express.RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

function safeErrMessage(e: unknown): string {
  try {
    return (e instanceof Error ? e.message : String(e)).slice(0, 800);
  } catch {
    return "Error ma-t9rachch.";
  }
}

function sendJson(
  res: express.Response,
  status: number,
  body: Record<string, unknown>
): void {
  if (res.headersSent) return;
  const code =
    Number.isFinite(status) && status >= 100 && status < 600 ? status : 500;
  const payload = JSON.stringify(body);
  res.status(code);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload, "utf8"));
  res.end(payload);
}

function jsonErrorHandler(
  err: unknown,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  if (res.headersSent) {
    return next(err);
  }
  console.error("api-error", err);
  const statusFromErr =
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : typeof err === "object" &&
          err !== null &&
          "statusCode" in err &&
          typeof (err as { statusCode: unknown }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : err instanceof SyntaxError
          ? 400
          : 500;
  const code =
    statusFromErr >= 400 && statusFromErr < 600 ? statusFromErr : 500;
  sendJson(res, code, { error: safeErrMessage(err) });
}

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

  app.post(
    "/api/ai/transcribe",
    upload.single("file"),
    wrapAsync(async (req, res) => {
      try {
        if (!req.file?.buffer) {
          return sendJson(res, 400, { error: "Missing file" });
        }
        const apiKey = process.env.GEMINI_API_KEY?.trim();
        if (!apiKey) {
          return sendJson(res, 500, {
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
        sendJson(res, 200, { text });
      } catch (e) {
        console.error("transcribe", e);
        const msg = safeErrMessage(e);
        const status = msg.includes("kbir") ? 400 : 500;
        sendJson(res, status, { error: msg.slice(0, 600) });
      }
    })
  );

  app.post(
    "/api/ai/chat",
    express.json({ limit: "4mb" }),
    wrapAsync(async (req, res) => {
      try {
        const { messages, temperature } = req.body as {
          messages?: unknown;
          temperature?: unknown;
        };
        if (!Array.isArray(messages) || messages.length === 0) {
          return sendJson(res, 400, { error: "messages (array) required" });
        }
        const apiKey = process.env.OPENAI_API_KEY?.trim();
        if (!apiKey) {
          return sendJson(res, 500, {
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
        sendJson(res, 200, { text: content });
      } catch (e) {
        console.error("chat", e);
        const msg = safeErrMessage(e);
        const httpStatus =
          e instanceof Error && "httpStatus" in e
            ? (e as Error & { httpStatus?: number }).httpStatus
            : undefined;
        sendJson(res, typeof httpStatus === "number" ? httpStatus : 500, {
          error: msg.slice(0, 600),
        });
      }
    })
  );

  app.post(
    "/api/ai/veo-scene-analyze",
    express.json({ limit: "4mb" }),
    wrapAsync(async (req, res) => {
      try {
        const apiKey = process.env.OPENAI_API_KEY?.trim();
        if (!apiKey) {
          return sendJson(res, 500, {
            error:
              "OPENAI_API_KEY nqsa 3la server. Zid OPENAI_API_KEY f .env w 3awd demmar npm run dev.",
          });
        }
        const visionModel = process.env.OPENAI_VEO_VISION_MODEL?.trim();
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const result = await runVeoSceneAnalyze(body, { apiKey, visionModel });
        if (result.ok === false) {
          return sendJson(res, result.status, { error: result.error });
        }
        return sendJson(res, 200, { analysis: result.analysis });
      } catch (e) {
        console.error("veo-scene-analyze", e);
        sendJson(res, 500, { error: safeErrMessage(e) });
      }
    })
  );

  app.post(
    "/api/ai/veo-scene-package",
    express.json({ limit: "12mb" }),
    wrapAsync(async (req, res) => {
      try {
        const apiKey = process.env.OPENAI_API_KEY?.trim();
        if (!apiKey) {
          return sendJson(res, 500, {
            error:
              "OPENAI_API_KEY nqsa 3la server. Zid OPENAI_API_KEY f .env w 3awd demmar npm run dev.",
          });
        }
        const model =
          process.env.OPENAI_VEO_SCENE_MODEL?.trim() ||
          process.env.OPENAI_CHAT_MODEL?.trim() ||
          "gpt-4o-mini";
        const visionModel = process.env.OPENAI_VEO_VISION_MODEL?.trim();
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const result = await runVeoScenePackage(body, { apiKey, model, visionModel });
        if (result.ok === false) {
          return sendJson(res, result.status, { error: result.error });
        }
        const payload: Record<string, unknown> = {
          analysis: result.analysis,
          scenePackage: result.scenePackage,
        };
        if (result.rawPackageText !== undefined) {
          payload.rawPackageText = result.rawPackageText;
        }
        if (result.parseError !== undefined) {
          payload.parseError = result.parseError;
        }
        return sendJson(res, 200, payload);
      } catch (e) {
        console.error("veo-scene-package", e);
        sendJson(res, 500, { error: safeErrMessage(e) });
      }
    })
  );

  // JSON errors from body-parser + any `next(err)` from routes above must run BEFORE Vite (otherwise Vite can answer with text/plain).
  app.use(jsonErrorHandler);

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
