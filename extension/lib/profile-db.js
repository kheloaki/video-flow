import { getSupabaseConfig, getSession } from "./auth.js";

export async function fetchUserProfile() {
  const session = await getSession();
  const config = await getSupabaseConfig();
  if (!session?.accessToken || !config.url || !config.anonKey) return null;

  const res = await fetch(
    `${config.url}/rest/v1/profiles?id=eq.${session.userId}&select=id,email,is_admin`,
    {
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${session.accessToken}`,
      },
    }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows[0] ?? null;
}

export async function fetchIsAdmin() {
  const profile = await fetchUserProfile();
  return profile?.is_admin === true;
}
