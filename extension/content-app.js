/** Bridge: Video Flow web app ↔ extension */

window.__VIDEO_FLOW_EXT__ = true;

let authSyncInterval = null;

function extensionAlive() {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function isContextInvalidatedError(message) {
  const msg = String(message || "").toLowerCase();
  return msg.includes("extension context invalidated") || msg.includes("message port closed");
}

function stopExtensionBridge() {
  if (authSyncInterval) {
    clearInterval(authSyncInterval);
    authSyncInterval = null;
  }
  window.__VIDEO_FLOW_EXT__ = false;
}

function safeSendMessage(message, callback) {
  if (!extensionAlive()) {
    stopExtensionBridge();
    callback?.(null, "Extension context invalidated — refresh the page after reloading the extension.");
    return;
  }

  try {
    chrome.runtime.sendMessage(message, (res) => {
      const err = chrome.runtime.lastError;
      if (err) {
        if (isContextInvalidatedError(err.message)) stopExtensionBridge();
        callback?.(null, err.message);
        return;
      }
      callback?.(res, null);
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isContextInvalidatedError(msg)) stopExtensionBridge();
    callback?.(null, msg);
  }
}

function readSupabaseConfigFromPage() {
  const cfg = window.__VIDEO_FLOW_SUPABASE_CONFIG__;
  if (cfg?.url && cfg?.anonKey) {
    return { url: cfg.url, anonKey: cfg.anonKey };
  }
  return null;
}

function readSupabaseSessionFromPage() {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.includes("auth-token")) continue;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const accessToken = parsed?.access_token;
      const userId = parsed?.user?.id;
      if (!accessToken || !userId) continue;
      const urlMatch = key.match(/^sb-([^-]+)-/);
      const projectRef = urlMatch?.[1];
      const supabaseUrl = projectRef ? `https://${projectRef}.supabase.co` : null;
      return {
        accessToken,
        refreshToken: parsed.refresh_token ?? null,
        userId,
        email: parsed.user?.email ?? null,
        supabaseUrl,
      };
    } catch {
      /* skip */
    }
  }
  return null;
}

function pushSessionToExtension() {
  if (!extensionAlive()) {
    stopExtensionBridge();
    return;
  }
  const session = readSupabaseSessionFromPage();
  if (!session) return;
  const pageConfig = readSupabaseConfigFromPage();
  safeSendMessage({
    type: "VF_AUTH_SESSION",
    payload: {
      ...session,
      supabaseAnonKey: pageConfig?.anonKey ?? null,
    },
  });
}

pushSessionToExtension();
authSyncInterval = setInterval(pushSessionToExtension, 4000);

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "VF_PUSH_AUTH") {
    pushSessionToExtension();
    sendResponse({ ok: extensionAlive() });
    return;
  }
});

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== "video-flow-app") return;

  const reply = (payload) => {
    window.postMessage(
      { source: "video-flow-extension", requestId: data.requestId, ...payload },
      "*"
    );
  };

  if (data.type === "VF_PING") {
    reply({ ok: extensionAlive() });
    return;
  }

  const forwardTypes = [
    "VF_QUEUE_SCENE",
    "VF_FILL_SCENE_NOW",
    "VF_FILL_NEXT",
    "VF_FILL_QUEUE_AT",
    "VF_START_QUEUE_BATCH",
    "VF_STOP_QUEUE_BATCH",
    "VF_GET_QUEUE_BATCH",
    "VF_GET_QUEUE",
    "VF_CLEAR_QUEUE",
  ];
  if (!forwardTypes.includes(data.type)) return;

  safeSendMessage({ type: data.type, payload: data.payload }, (res, err) => {
    if (err) {
      reply({
        ok: false,
        error: isContextInvalidatedError(err)
          ? "Extension reloaded — refresh this page (F5) then try again."
          : err,
      });
      return;
    }
    reply(res ?? { ok: false, error: "No response" });
  });
});
