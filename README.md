# Video Flow

Web app to **generate TikTok-style ad scripts in Moroccan Darija** with **OpenAI** (`gpt-4o-mini` for scripts) and **Google Gemini** (transcription only), manage **products** and **video transcriptions**, optional **webhooks**, and **Supabase** (email + password auth + Postgres).

## Stack

- React 19, Vite 6, TypeScript, Tailwind CSS  
- Express dev server (API routes + Vite middleware)  
- Supabase Auth + database  
- UploadThing (optional image uploads)  
- OpenAI API (Chat Completions) + Google Gemini (transcription) — keys stay on the server (`/api/ai/*`)

## Prerequisites

- Node.js 20+ recommended  
- An [OpenAI API key](https://platform.openai.com/api-keys) (`OPENAI_API_KEY`) for script generation  
- A [Gemini API key](https://ai.google.dev/gemini-api/docs/api-key) (`GEMINI_API_KEY`) for transcription  
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
   | `OPENAI_API_KEY` | OpenAI (required for **Generi** script generation); Express only |
   | `GEMINI_API_KEY` | Gemini (required for **video transcription**); Express only |
   | `OPENAI_CHAT_MODEL` | Optional; default `gpt-4o-mini` |
   | `GEMINI_TRANSCRIPTION_MODEL` | Optional; default `gemini-2.5-flash` |
   | `VITE_SUPABASE_URL` | Supabase project URL |
   | `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key |
   | `UPLOADTHING_TOKEN` | Only if you use image uploads ([UploadThing](https://uploadthing.com)) |

3. **Database**

   In Supabase → **SQL Editor**, run the contents of [`supabase/schema.sql`](supabase/schema.sql).

4. **Auth**

   Under Authentication → **Providers**, enable **Email** and allow **email + password** sign-in. Add your app URL to **Redirect URLs** (e.g. `http://localhost:3000`). For local testing you can disable **Confirm email** in Authentication → Providers → Email (optional). Users sign up from the app’s **Compte jdid** tab, then sign in with **Dkhol**.

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
- `OPENAI_API_KEY` and `GEMINI_API_KEY` are only used in `server.ts` and are not injected into the Vite bundle.

## License

`src/App.tsx` retains the Apache-2.0 header from the original template. Add a root `LICENSE` file for the whole repo if you want a single explicit license for GitHub.
