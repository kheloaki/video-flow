/**
 * Express API (transcribe, chat, webhooks). Same origin when you use `npm run dev` / `npm start` on :3000.
 * Set `VITE_API_BASE_URL` if the UI is on another origin (e.g. Vite :5173 without proxy, or static host + API elsewhere).
 */
export function apiUrl(path: string): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const base = raw?.trim().replace(/\/$/, "") ?? "";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}
