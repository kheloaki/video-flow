import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env"
  );
}

export const supabase = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "");

if (typeof window !== "undefined" && supabaseUrl && supabaseAnonKey) {
  (
    window as unknown as {
      __VIDEO_FLOW_SUPABASE_CONFIG__?: { url: string; anonKey: string };
    }
  ).__VIDEO_FLOW_SUPABASE_CONFIG__ = {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
  };
}
