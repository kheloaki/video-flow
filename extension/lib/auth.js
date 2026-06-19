import {
  DEFAULT_SUPABASE_URL,
  DEFAULT_SUPABASE_ANON_KEY,
} from "./supabase-defaults.js";
import {
  signInWithPassword,
  refreshAccessToken,
  signOutRemote,
} from "./supabase-auth.js";

const SESSION_KEY = "vf_supabase_session";
const CONFIG_KEY = "vf_supabase_config";

let refreshPromise = null;

export async function getSupabaseConfig() {
  const data = await chrome.storage.sync.get(CONFIG_KEY);
  const stored = data[CONFIG_KEY] ?? {};
  return {
    url: (stored.url || DEFAULT_SUPABASE_URL || "").trim().replace(/\/$/, ""),
    anonKey: (stored.anonKey || DEFAULT_SUPABASE_ANON_KEY || "").trim(),
  };
}

export async function getSupabaseConfigOverrides() {
  const data = await chrome.storage.sync.get(CONFIG_KEY);
  return data[CONFIG_KEY] ?? { url: "", anonKey: "" };
}

export async function setSupabaseConfig(url, anonKey) {
  await chrome.storage.sync.set({
    [CONFIG_KEY]: {
      url: url.trim().replace(/\/$/, ""),
      anonKey: anonKey.trim(),
    },
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

export async function getValidSession() {
  const session = await getSession();
  if (!session?.accessToken) return null;

  const age = Date.now() - (session.savedAt || 0);
  if (!session.refreshToken || age < 45 * 60 * 1000) return session;

  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const config = await getSupabaseConfig();
        if (!config.url || !config.anonKey) return;
        const refreshed = await refreshAccessToken(
          config.url,
          config.anonKey,
          session.refreshToken
        );
        await setSession({
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          userId: refreshed.userId || session.userId,
          email: refreshed.email || session.email,
        });
      } catch {
        /* keep existing session; caller may get 401 */
      } finally {
        refreshPromise = null;
      }
    })();
  }
  await refreshPromise;
  return getSession();
}

export async function signIn(email, password) {
  const config = await getSupabaseConfig();
  if (!config.url || !config.anonKey) {
    throw new Error("Supabase not configured — run npm run extension:config");
  }
  const session = await signInWithPassword(
    config.url,
    config.anonKey,
    email.trim(),
    password
  );
  if (!session.accessToken || !session.userId) {
    throw new Error("Sign in failed — no session returned.");
  }
  await setSession(session);
  return session;
}

export async function signOut() {
  const config = await getSupabaseConfig();
  const session = await getSession();
  if (session?.accessToken && config.url && config.anonKey) {
    await signOutRemote(config.url, config.anonKey, session.accessToken);
  }
  await chrome.storage.local.remove(SESSION_KEY);
}

export async function isLoggedIn() {
  const s = await getValidSession();
  return !!(s?.accessToken && s?.userId);
}
