/**
 * Express API (transcribe, chat, webhooks).
 *
 * - `npm run dev` on http://localhost:3000 → same origin, relative `/api/...`.
 * - `vite` alone on :5173 → requests go to http://127.0.0.1:3000 (Express must run there; CORS enabled in server.ts).
 * - Override with `VITE_API_BASE_URL` or `VITE_DEV_API_ORIGIN` (dev backend base).
 */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const envBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (envBase?.trim()) {
    return `${envBase.trim().replace(/\/$/, "")}${normalized}`;
  }
  if (import.meta.env.DEV && typeof window !== "undefined") {
    const { hostname, port } = window.location;
    const isLocal =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]";
    if (isLocal && port && port !== "3000") {
      const origin =
        (import.meta.env.VITE_DEV_API_ORIGIN as string | undefined)
          ?.trim()
          .replace(/\/$/, "") || "http://127.0.0.1:3000";
      return `${origin}${normalized}`;
    }
  }
  return normalized;
}
