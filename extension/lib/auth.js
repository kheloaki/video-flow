const SESSION_KEY = "vf_supabase_session";
const CONFIG_KEY = "vf_supabase_config";

export async function getSupabaseConfig() {
  const data = await chrome.storage.sync.get(CONFIG_KEY);
  return data[CONFIG_KEY] ?? { url: "", anonKey: "" };
}

export async function setSupabaseConfig(url, anonKey) {
  await chrome.storage.sync.set({
    [CONFIG_KEY]: { url: url.trim().replace(/\/$/, ""), anonKey: anonKey.trim() },
  });
}

export async function getSession() {
  const data = await chrome.storage.local.get(SESSION_KEY);
  return data[SESSION_KEY] ?? null;
}

export async function setSession(session) {
  if (!session?.accessToken || !session?.userId) {
    await chrome.storage.local.remove(SESSION_KEY);
    return;
  }
  await chrome.storage.local.set({
    [SESSION_KEY]: {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken ?? null,
      userId: session.userId,
      email: session.email ?? null,
      savedAt: Date.now(),
    },
  });
}

export async function isLoggedIn() {
  const s = await getSession();
  return !!(s?.accessToken && s?.userId);
}
