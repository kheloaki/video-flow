# Video Flow

Web app to **generate TikTok-style ad scripts in Moroccan Darija** with **OpenAI** (`gpt-4o-mini` for scripts, **Whisper** for transcription), manage **products** and **video transcriptions**, optional **webhooks**, and **Supabase** (magic-link auth + Postgres).

## Stack

- React 19, Vite 6, TypeScript, Tailwind CSS  
- Express dev server (API routes + Vite middleware)  
- Supabase Auth + database  
- UploadThing (optional image uploads)  
- OpenAI API (Whisper + Chat Completions) — keys stay on the server (`/api/ai/*`)

## Prerequisites

- Node.js 20+ recommended  
- An [OpenAI API key](https://platform.openai.com/api-keys) (`OPENAI_API_KEY`)  
- A [Supabase](https://supabase.com) project  

## Setup

1. **Clone and install**

   ```bash
   npm install
   ```

2. **Environment**

   Copy `.env.example` to `.env` and fill in:

   | Variable | Purpose |
   |----------|---------|
   | `OPENAI_API_KEY` | OpenAI (required for transcribe + generate); read by Express only |
   | `OPENAI_CHAT_MODEL` | Optional; default `gpt-4o-mini` |
   | `OPENAI_WHISPER_MODEL` | Optional; default `whisper-1` |
   | `VITE_SUPABASE_URL` | Supabase project URL |
   | `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key |
   | `UPLOADTHING_TOKEN` | Only if you use image uploads ([UploadThing](https://uploadthing.com)) |

3. **Database**

   In Supabase → **SQL Editor**, run the contents of [`supabase/schema.sql`](supabase/schema.sql).

4. **Auth**

   Enable **Email** (magic link) under Authentication → Providers. Add your app URL to **Redirect URLs** (e.g. `http://localhost:3000`).

5. **Run**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server (Express + Vite) |
| `npm run build` | Production build to `dist/` |
| `npm run start` | Serve production build (set `NODE_ENV=production` after build) |
| `npm run lint` | Typecheck (`tsc --noEmit`) |

## Security notes for contributors

- Never commit `.env` — it is gitignored; only `.env.example` should hold placeholders.  
- Rotate any API key that was ever committed or shared.  
- Supabase **anon** key is safe in the client; enable **RLS** (included in `schema.sql`).  
- `OPENAI_API_KEY` is only used in `server.ts` and is not injected into the Vite bundle.

## License

`src/App.tsx` retains the Apache-2.0 header from the original template. Add a root `LICENSE` file for the whole repo if you want a single explicit license for GitHub.
