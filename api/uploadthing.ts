/**
 * Vercel serverless: UploadThing route. Static deploy has no Express — keep router in sync with `server.ts`.
 *
 * Use a buffered body for the Web `Request` — `Readable.toWeb(req)` on Vercel often never completes,
 * which leaves the client `fetch` pending forever (spinner never stops).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { buffer } from "node:stream/consumers";
import {
  createRouteHandler,
  createUploadthing,
  type FileRouter,
} from "uploadthing/server";

export const config = {
  api: {
    bodyParser: false,
  },
};

const f = createUploadthing();

const uploadRouter = {
  imageUploader: f({ image: { maxFileSize: "4MB", maxFileCount: 1 } })
    .onUploadComplete((data) => {
      console.log("file url", data.file.url);
    }),
} satisfies FileRouter;

const handleRequest = createRouteHandler({
  router: uploadRouter,
  config: {
    token: process.env.UPLOADTHING_TOKEN,
  },
});

function headersFromIncoming(req: VercelRequest): Headers {
  const h = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) h.append(key, v);
    } else {
      h.set(key, value);
    }
  }
  return h;
}

async function toWebRequest(req: VercelRequest): Promise<Request> {
  const protocol = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = req.headers.host || "localhost";
  const url = `${protocol}://${host}${req.url}`;

  const method = req.method || "GET";
  const headers = headersFromIncoming(req);

  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers });
  }

  const buf = await buffer(req);
  return new Request(url, {
    method,
    headers,
    body: buf.length > 0 ? buf : undefined,
  });
}

async function sendWebResponse(res: VercelResponse, webRes: Response) {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    if (key.toLowerCase() === "transfer-encoding") return;
    res.setHeader(key, value);
  });
  const buf = Buffer.from(await webRes.arrayBuffer());
  res.end(buf);
}

export default async function uploadthing(
  req: VercelRequest,
  res: VercelResponse
) {
  const token = process.env.UPLOADTHING_TOKEN?.trim();
  if (!token) {
    res.status(500).json({ error: "UPLOADTHING_TOKEN is not configured" });
    return;
  }

  try {
    const webRes = await handleRequest(await toWebRequest(req));
    await sendWebResponse(res, webRes);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) {
      res.status(500).json({ error: "UploadThing handler failed" });
    }
  }
}
