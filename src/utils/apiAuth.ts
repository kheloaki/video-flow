import { supabase } from "../supabase";

/** Bearer token for AI API routes (usage budget enforcement). */
export async function getApiAuthHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}
