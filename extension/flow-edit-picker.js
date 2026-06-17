(function () {
  if (globalThis.__VF_EDIT_PICKER__) return;

/** Google Flow grid picker — select videos + order #, send to extension Editing tab. */

const VF_EDIT = "[Video Flow Edit]";
let pickerEnabled = true;
/** Increments each time a tile is newly checked (selection sequence). */
let selectionSeq = 0;
/** @type {Map<string, { host: HTMLElement, order: number, checked: boolean, pickedAt: number }>} */
const tileState = new Map();

const BAR_INLINE_STYLE = {
  position: "fixed",
  top: "12px",
  right: "12px",
  zIndex: "2147483646",
  display: "flex",
  alignItems: "center",
  gap: "10px",
  padding: "10px 14px",
  background: "rgba(15, 17, 21, 0.96)",
  border: "1px solid rgba(124, 58, 237, 0.65)",
  borderRadius: "12px",
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: "13px",
  color: "#e8eaed",
};

const OVERLAY_INLINE_STYLE = {
  position: "absolute",
  top: "6px",
  left: "6px",
  zIndex: "9999",
  display: "flex",
  alignItems: "center",
  gap: "4px",
  padding: "4px 6px",
  background: "rgba(15, 17, 21, 0.92)",
  border: "1px solid rgba(124, 58, 237, 0.6)",
  borderRadius: "8px",
  pointerEvents: "auto",
};

function isFlowPage() {
  return /\/tools\/flow/i.test(`${location.pathname}${location.search}${location.hash}`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isVisible(el) {
  if (!(el instanceof HTMLElement)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
}

/** Query including open shadow roots. */
function collectDeep(selector) {
  const seen = new Set();
  const out = [];
  const roots = [document];

  while (roots.length) {
    const root = roots.pop();
    if (!root?.querySelectorAll) continue;

    for (const el of root.querySelectorAll(selector)) {
      if (!seen.has(el)) {
        seen.add(el);
        out.push(el);
      }
    }

    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot && !seen.has(el.shadowRoot)) {
        seen.add(el.shadowRoot);
        roots.push(el.shadowRoot);
      }
    }
  }

  return out;
}

function showToast(msg, isError = false) {
  document.querySelector(".vf-edit-toast")?.remove();
  const el = document.createElement("div");
  el.className = `vf-edit-toast${isError ? " error" : ""}`;
  el.textContent = msg;
  Object.assign(el.style, {
    position: "fixed",
    bottom: "20px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    padding: "12px 18px",
    background: "rgba(15, 17, 21, 0.96)",
    border: `1px solid ${isError ? "rgba(248,113,113,0.5)" : "rgba(52,211,153,0.5)"}`,
    color: isError ? "#fecaca" : "#bbf7d0",
    borderRadius: "10px",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

function ensureBar() {
  let bar = document.getElementById("vf-edit-bar");
  if (bar) return bar;

  bar = document.createElement("div");
  bar.id = "vf-edit-bar";
  bar.className = "vf-edit-bar";
  Object.assign(bar.style, BAR_INLINE_STYLE);
  bar.innerHTML = `
    <strong style="color:#c4b5fd">Video Flow</strong>
    <span id="vf-edit-count">0 selected</span>
    <button type="button" class="vf-edit-toggle" id="vf-edit-refresh" style="border:none;border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer;font-size:12px;background:#242830;color:#e8eaed">Refresh grid</button>
    <button type="button" class="vf-edit-send" id="vf-edit-send" disabled style="border:none;border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer;font-size:12px;background:#7c3aed;color:#fff">Send to Editing</button>
  `;
  document.body.appendChild(bar);

  bar.querySelector("#vf-edit-refresh")?.addEventListener("click", (e) => {
    e.stopPropagation();
    tileState.clear();
    selectionSeq = 0;
    document.querySelectorAll(".vf-edit-overlay").forEach((n) => n.remove());
    document.querySelectorAll(".vf-edit-host").forEach((n) => n.classList.remove("vf-edit-host", "vf-edit-picked"));
    scanAndAttach();
  });

  bar.querySelector("#vf-edit-send")?.addEventListener("click", (e) => {
    e.stopPropagation();
    void sendSelectedToEditing();
  });

  return bar;
}

function updateBar() {
  const bar = ensureBar();
  const selected = [...tileState.values()].filter((t) => t.checked).length;
  const count = bar.querySelector("#vf-edit-count");
  const send = bar.querySelector("#vf-edit-send");
  if (count) count.textContent = `${selected} selected`;
  if (send) {
    send.disabled = selected === 0;
    send.style.opacity = selected === 0 ? "0.45" : "1";
  }
}

function syncOrderInput(state) {
  const input = state.host.querySelector(".vf-edit-order");
  if (!input) return;
  if (state.checked && state.order > 0) {
    input.style.display = "";
    input.value = String(state.order);
  } else {
    input.style.display = "none";
    input.value = "";
  }
}

/** First checked = 1, second = 2, etc. Renumbers when one is unchecked. */
function renumberSelectedTiles() {
  const checked = [...tileState.values()]
    .filter((t) => t.checked)
    .sort((a, b) => a.pickedAt - b.pickedAt);

  checked.forEach((t, i) => {
    t.order = i + 1;
    syncOrderInput(t);
  });

  for (const t of tileState.values()) {
    if (!t.checked) syncOrderInput(t);
  }
}

function tileKey(host) {
  const r = host.getBoundingClientRect();
  const media = host.querySelector("img, video");
  const src = media?.getAttribute("src") || media?.currentSrc || "";
  return `${Math.round(r.left)}:${Math.round(r.top)}:${src.slice(-40)}`;
}

function attachOverlay(host) {
  if (!pickerEnabled || host.querySelector(".vf-edit-overlay")) return;

  const key = tileKey(host);
  if (tileState.has(key)) return;

  const state = { host, order: 0, checked: false, pickedAt: 0 };
  tileState.set(key, state);

  const style = getComputedStyle(host);
  if (style.position === "static") host.style.position = "relative";
  host.classList.add("vf-edit-host");

  const overlay = document.createElement("div");
  overlay.className = "vf-edit-overlay";
  Object.assign(overlay.style, OVERLAY_INLINE_STYLE);
  overlay.addEventListener("mousedown", (e) => e.stopPropagation());
  overlay.addEventListener("click", (e) => e.stopPropagation());
  overlay.innerHTML = `
    <input type="checkbox" class="vf-edit-check" title="Select for editing" style="width:16px;height:16px;accent-color:#7c3aed;cursor:pointer" />
    <input type="number" class="vf-edit-order" min="1" max="99" value="" title="Combine order (auto: 1st checked = 1, 2nd = 2…)" style="display:none;width:36px;padding:2px 4px;text-align:center;font-weight:700;font-size:13px;border-radius:6px;border:1px solid #444;background:#0f1115;color:#fff" />
  `;

  const check = overlay.querySelector(".vf-edit-check");
  const orderInput = overlay.querySelector(".vf-edit-order");

  check?.addEventListener("click", (e) => e.stopPropagation());
  orderInput?.addEventListener("click", (e) => e.stopPropagation());

  check?.addEventListener("change", () => {
    const wasChecked = state.checked;
    state.checked = !!check.checked;

    if (state.checked && !wasChecked) {
      state.pickedAt = ++selectionSeq;
    } else if (!state.checked) {
      state.pickedAt = 0;
      state.order = 0;
    }

    host.classList.toggle("vf-edit-picked", state.checked);
    if (state.checked) {
      host.style.outline = "2px solid #7c3aed";
      host.style.outlineOffset = "2px";
    } else {
      host.style.outline = "";
      host.style.outlineOffset = "";
    }

    renumberSelectedTiles();
    updateBar();
  });

  orderInput?.addEventListener("change", () => {
    if (!state.checked) return;
    state.order = Math.max(1, Number(orderInput.value) || 1);
    orderInput.value = String(state.order);
  });

  host.appendChild(overlay);
}

function toAbsoluteFlowUrl(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("blob:") || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.startsWith("/")) return `${location.origin}${trimmed}`;
  try {
    return new URL(trimmed, location.href).href;
  } catch {
    return null;
  }
}

function isUsableVideoSrc(src) {
  if (!src) return false;
  return (
    src.startsWith("blob:") ||
    src.includes("getMediaUrlRedirect") ||
    src.includes("flow-content.google") ||
    src.includes("/fx/api/") ||
    src.includes(".mp4") ||
    src.includes(".webm")
  );
}

function readVideoSrcFromHost(host) {
  const tile = host.closest("[data-tile-id]") || host;
  const videos = [
    host.querySelector("video[src]"),
    host.querySelector("video"),
    tile.querySelector("video[src]"),
    tile.querySelector("video"),
  ].filter(Boolean);

  for (const video of videos) {
    const raw = video.getAttribute("src") || video.currentSrc || video.src;
    const abs = toAbsoluteFlowUrl(raw);
    if (abs && isUsableVideoSrc(abs)) return abs;
  }
  return null;
}

function findMediaCards() {
  const seen = new Set();
  const cards = [];

  for (const tile of collectDeep("[data-tile-id]")) {
    if (!isVisible(tile)) continue;
    const video = tile.querySelector("video");
    if (!video) continue;
    const host = tile.querySelector("button") || tile.querySelector("a") || tile;
    if (!host || seen.has(host)) continue;
    const r = host.getBoundingClientRect();
    if (r.width < 64 || r.height < 64) continue;
    seen.add(host);
    cards.push(host);
  }

  if (cards.length) return cards;

  const mediaEls = collectDeep("img, video");

  for (const media of mediaEls) {
    if (!isVisible(media)) continue;
    const r = media.getBoundingClientRect();
    if (r.width < 64 || r.height < 64 || r.width > 480) continue;

    let host =
      media.closest('button, a, [role="button"], li, article, [data-testid], [class*="card"], [class*="tile"], [class*="grid"] > *') ||
      media.parentElement;

    for (let i = 0; i < 8 && host; i++) {
      const hr = host.getBoundingClientRect();
      if (hr.width >= 64 && hr.width <= 480 && hr.height >= 64 && hr.height <= 720) break;
      host = host.parentElement;
    }

    if (!host || seen.has(host)) continue;

    const hr = host.getBoundingClientRect();
    if (hr.width < 64 || hr.height < 64 || hr.top < 40) continue;

    seen.add(host);
    cards.push(host);
  }

  if (cards.length) return cards;

  for (const btn of collectDeep('button, a, [role="button"], div[type="button"]')) {
    if (!isVisible(btn)) continue;
    const r = btn.getBoundingClientRect();
    if (r.width < 80 || r.height < 80 || r.width > 480 || r.height > 720) continue;
    if (!btn.querySelector("img, video, i.google-symbols, svg")) continue;
    if (seen.has(btn)) continue;
    seen.add(btn);
    cards.push(btn);
  }

  return cards;
}

function scanAndAttach() {
  if (!pickerEnabled || !isFlowPage()) return;
  ensureBar();
  const cards = findMediaCards();
  for (const host of cards) attachOverlay(host);
  updateBar();
}

function pickBestVideoUrl(urls) {
  const list = [...new Set(urls.filter(Boolean).map((u) => toAbsoluteFlowUrl(u)).filter(Boolean))];
  const cdn = list.find((u) => u.includes("flow-content.google"));
  if (cdn) return cdn;
  const redirect = list.find((u) => u.includes("getMediaUrlRedirect"));
  if (redirect) return redirect;
  const blob = list.find((u) => u.startsWith("blob:"));
  if (blob) return blob;
  return list[0] || null;
}

async function resolveVideoUrl(host) {
  const direct = readVideoSrcFromHost(host);
  if (direct) return direct;

  const found = [];
  for (const v of collectDeep("video")) {
    if (!host.contains(v) && !v.contains(host)) continue;
    const raw = v.getAttribute("src") || v.currentSrc || v.src;
    const abs = toAbsoluteFlowUrl(raw);
    if (abs && isUsableVideoSrc(abs)) found.push(abs);
  }

  if (found.length) return pickBestVideoUrl(found);

  host.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  await sleep(1500);

  const dialog =
    document.querySelector('[role="dialog"]') ||
    document.querySelector('[data-radix-popper-content-wrapper]');
  const scope = dialog || document.body;

  const dialogUrls = [];
  for (const v of collectDeep("video")) {
    if (!scope.contains(v) && scope !== document.body) continue;
    if (!isVisible(v)) continue;
    const raw = v.getAttribute("src") || v.currentSrc || v.src;
    const abs = toAbsoluteFlowUrl(raw);
    if (abs && isUsableVideoSrc(abs)) dialogUrls.push(abs);
  }

  const best = pickBestVideoUrl(dialogUrls);
  if (best) {
    const close =
      scope.querySelector('button[aria-label="Close"]') ||
      scope.querySelector('button[aria-label="close"]');
    close?.click();
    await sleep(300);
    return best;
  }

  const close =
    scope.querySelector('button[aria-label="Close"]') ||
    scope.querySelector('button[aria-label="close"]');
  close?.click();

  const dl = host.querySelector('a[download], a[href*=".mp4"], a[href*="video"]');
  if (dl instanceof HTMLAnchorElement && dl.href) return toAbsoluteFlowUrl(dl.href);

  return null;
}

async function sendSelectedToEditing() {
  const picked = [...tileState.values()]
    .filter((t) => t.checked)
    .sort((a, b) => a.order - b.order);

  if (!picked.length) {
    showToast("Select at least one video.", true);
    return;
  }

  const sendBtn = document.querySelector("#vf-edit-send");
  if (sendBtn) sendBtn.disabled = true;
  showToast(`Importing ${picked.length} clip(s)…`);

  const items = [];
  let idx = 0;

  for (const item of picked) {
    idx += 1;
    showToast(`Importing clip ${idx} / ${picked.length}…`);
    try {
      const sourceUrl = await resolveVideoUrl(item.host);
      if (!sourceUrl) throw new Error("Could not find video URL");

      const entry = {
        id: `flow-${Date.now()}-${idx}`,
        name: `flow-scene-${item.order}.mp4`,
        order: item.order,
        sourceUrl: toAbsoluteFlowUrl(sourceUrl),
      };

      if (sourceUrl.startsWith("blob:")) {
        const res = await fetch(sourceUrl);
        if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
        entry.buffer = await res.arrayBuffer();
        entry.mimeType = res.headers.get("content-type") || "video/mp4";
      }

      items.push(entry);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(VF_EDIT, "clip import failed", msg);
      showToast(`Clip #${item.order} failed: ${msg}`, true);
      if (sendBtn) sendBtn.disabled = false;
      return;
    }
  }

  try {
    const res = await chrome.runtime.sendMessage({
      type: "VF_IMPORT_EDIT_CLIPS",
      items,
    });
    if (!res?.ok) throw new Error(res?.error || "Save failed");
    showToast(`${items.length} clip(s) sent — open extension → Editing tab`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showToast(msg, true);
  } finally {
    if (sendBtn) sendBtn.disabled = false;
    updateBar();
  }
}

function injectStylesheet() {
  if (document.getElementById("vf-edit-picker-style")) return;
  try {
    const link = document.createElement("link");
    link.id = "vf-edit-picker-style";
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("flow-edit-picker.css");
    document.head.appendChild(link);
  } catch (e) {
    console.warn(VF_EDIT, "stylesheet inject failed", e);
  }
}

let scanTimer = 0;
function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => scanAndAttach(), 250);
}

async function bootPicker() {
  if (!isFlowPage()) return;
  if (typeof chrome === "undefined" || !chrome.runtime?.id) return;

  for (let i = 0; i < 40 && !document.body; i += 1) {
    await sleep(100);
  }
  if (!document.body) {
    console.warn(VF_EDIT, "no document.body — picker aborted");
    return;
  }

  injectStylesheet();
  ensureBar();
  scanAndAttach();

  if (globalThis.__VF_EDIT_PICKER_STARTED__) return;
  globalThis.__VF_EDIT_PICKER_STARTED__ = true;

  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  if (!globalThis.__VF_EDIT_HISTORY_HOOKED__) {
    globalThis.__VF_EDIT_HISTORY_HOOKED__ = true;
    window.addEventListener("popstate", scheduleScan);
    const pushState = history.pushState;
    const replaceState = history.replaceState;
    history.pushState = function (...args) {
      pushState.apply(this, args);
      scheduleScan();
    };
    history.replaceState = function (...args) {
      replaceState.apply(this, args);
      scheduleScan();
    };
  }

  setInterval(scheduleScan, 3000);
  console.log(VF_EDIT, "picker active", location.href);
}

void bootPicker();

globalThis.__VF_EDIT_PICKER__ = { scanAndAttach, sendSelectedToEditing, bootPicker };
})();
