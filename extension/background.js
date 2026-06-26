import { runAnalyzeJob, getAnalyzeJobStatus, stopAnalyzeJob } from "./lib/analyze-runner.js";
import { saveEditClips } from "./lib/edit-clip-store.js";
import {
  appendFlowQueueItem,
  clearFlowQueueDb,
  fetchFlowQueueItems,
  syncFlowQueueItems,
} from "./lib/flow-queue-db.js";
import {
  detectVideoMime,
  isVideoBuffer,
  normalizeArrayBuffer,
  toAbsoluteFlowUrl,
  extractMediaUrlFromPayload,
} from "./lib/video-buffer-utils.js";

const FLOW_URL = "https://labs.google/fx/tools/flow";
const FLOW_REFERER = "https://labs.google/fx/tools/flow";
const QUEUE_KEY = "vf_flow_queue";
const LAST_QUEUE_FILL_KEY = "vf_last_queue_fill";
const QUEUE_SELECTION_KEY = "vf_queue_selection";
const QUEUE_BATCH_KEY = "vf_queue_batch";
const EDIT_CLIPS_UPDATED_KEY = "vf_edit_clips_updated";
const BATCH_PAUSE_MS = 4000;

let batchRunId = 0;

function queueItemId(q, idx = 0) {
  return String(q.id ?? q.queuedAt ?? `scene-${q.sceneNumber ?? idx}`);
}

async function getQueueSelectionSet() {
  const data = await chrome.storage.local.get(QUEUE_SELECTION_KEY);
  return new Set(Array.isArray(data[QUEUE_SELECTION_KEY]) ? data[QUEUE_SELECTION_KEY] : []);
}

async function setQueueSelection(selection) {
  await chrome.storage.local.set({ [QUEUE_SELECTION_KEY]: [...selection] });
}

function pruneSelection(queue, selection) {
  const valid = new Set(queue.map((q, idx) => queueItemId(q, idx)));
  return new Set([...selection].filter((id) => valid.has(id)));
}

function getSelectedEntries(queue, selection) {
  return queue
    .map((q, idx) => ({ q, idx, id: queueItemId(q, idx) }))
    .filter(({ id }) => selection.has(id));
}

async function getQueueBatchStatus() {
  const data = await chrome.storage.local.get(QUEUE_BATCH_KEY);
  return data[QUEUE_BATCH_KEY] ?? { running: false };
}

async function getQueue() {
  try {
    const fromDb = await fetchFlowQueueItems();
    if (fromDb !== null) {
      await chrome.storage.local.set({ [QUEUE_KEY]: fromDb });
      return fromDb;
    }
  } catch (e) {
    console.warn("[vf] flow queue DB fetch failed:", e);
  }
  const data = await chrome.storage.local.get(QUEUE_KEY);
  return Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
}

async function setQueue(queue) {
  await chrome.storage.local.set({ [QUEUE_KEY]: queue });
  try {
    await syncFlowQueueItems(queue);
  } catch (e) {
    console.warn("[vf] flow queue DB sync failed:", e);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getFlowSettingsForFill() {
  const data = await chrome.storage.sync.get("flowSettings");
  return {
    autoRun: true,
    aspectRatio: "9:16",
    model: "Veo 3.1",
    videoMode: "Frames to Video",
    duration: "8",
    outputs: "1",
    ...(data.flowSettings ?? {}),
  };
}

async function getCookieHeaderForUrl(url) {
  try {
    const cookies = await chrome.cookies.getAll({ url });
    if (!cookies.length) return null;
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return null;
  }
}

/** Fetch video in extension context (no page CORS). */
async function fetchVideoBuffer(url) {
  const absUrl = toAbsoluteFlowUrl(url);
  if (!absUrl) throw new Error("Invalid video URL");

  if (absUrl.startsWith("blob:")) {
    throw new Error("Blob URLs must be read on the Flow page");
  }

  const attempts = [
    { url: absUrl, headers: { Referer: FLOW_REFERER, Origin: "https://labs.google" } },
    { url: absUrl, headers: { Referer: "https://labs.google/" } },
    { url: absUrl, headers: {} },
  ];

  let lastError = "Fetch failed";

  for (const attempt of attempts) {
    try {
      const headers = { ...attempt.headers };
      const cookie = await getCookieHeaderForUrl("https://labs.google/");
      if (cookie) headers.Cookie = cookie;

      const res = await fetch(attempt.url, { redirect: "follow", headers });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }

      const buffer = normalizeArrayBuffer(await res.arrayBuffer());
      if (!buffer || buffer.byteLength < 256) {
        lastError = "Empty response";
        continue;
      }

      const u = new Uint8Array(buffer);
      if (u[0] === 0x7b || u[0] === 0x5b) {
        try {
          const json = JSON.parse(new TextDecoder().decode(buffer));
          const next = extractMediaUrlFromPayload(json);
          if (next && next !== attempt.url) return fetchVideoBuffer(next);
        } catch {
          /* not json */
        }
        lastError = "API returned JSON, not video";
        continue;
      }

      if (!isVideoBuffer(buffer)) {
        lastError = `Not a video file (${formatBytes(buffer.byteLength)})`;
        continue;
      }

      const mimeType = detectVideoMime(buffer, res.headers.get("content-type"));
      return {
        buffer,
        mimeType,
        finalUrl: res.url || attempt.url,
        byteLength: buffer.byteLength,
      };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  throw new Error(lastError);
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

async function ensureFlowScripts(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: "VF_PING" });
    if (pong?.ok) return true;
  } catch {
    /* not injected yet */
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ["flow-dom.js", "flow-edit-picker.js", "content-flow.js"],
    });
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["flow-edit-picker.css"],
    });
    return true;
  } catch {
    return false;
  }
}

async function openOrFocusFlowTab() {
  const patterns = [
    "https://labs.google/fx/tools/flow*",
    "https://labs.google/fx/*/tools/flow*",
    "https://labs.google/*tools/flow*",
  ];
  for (const pattern of patterns) {
    const tabs = await chrome.tabs.query({ url: pattern });
    if (tabs[0]?.id) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      if (tabs[0].windowId) await chrome.windows.update(tabs[0].windowId, { focused: true });
      void ensureFlowScripts(tabs[0].id);
      return tabs[0].id;
    }
  }
  const tab = await chrome.tabs.create({ url: FLOW_URL, active: true });
  return tab.id;
}

async function sendFillToFlowTab(tabId, scene) {
  const flowSettings = await getFlowSettingsForFill();
  const send = () =>
    chrome.tabs.sendMessage(tabId, {
      type: "VF_FILL_ON_PAGE",
      payload: scene,
      flowSettings,
    });

  let response;
  try {
    response = await send();
  } catch {
    await ensureFlowScripts(tabId);
    await sleep(800);
    response = await send();
  }

  if (!response?.ok) {
    throw new Error(response?.error || "Fill failed on Google Flow tab.");
  }
  return response;
}

async function fillQueueSceneAtIndex(index) {
  const queue = await getQueue();
  if (index < 0 || index >= queue.length) {
    throw new Error("Scene machi f queue.");
  }

  const scene = queue[index];
  const tabId = await openOrFocusFlowTab();
  await sleep(3000);
  const fillResponse = await sendFillToFlowTab(tabId, scene);

  queue.splice(index, 1);
  await setQueue(queue);

  const payload = {
    ok: true,
    sceneNumber: scene.sceneNumber,
    queuedAt: scene.queuedAt,
    remaining: queue.length,
    nextIndex: queue.length ? Math.min(index, queue.length - 1) : 0,
    result: fillResponse.result,
    completedAt: Date.now(),
  };
  await chrome.storage.local.set({ [LAST_QUEUE_FILL_KEY]: payload });

  return payload;
}

async function runSelectedQueueBatch() {
  const runId = ++batchRunId;
  await chrome.storage.local.set({
    [QUEUE_BATCH_KEY]: { running: true, runId, startedAt: Date.now() },
  });

  while (true) {
    if (runId !== batchRunId) break;

    const batchSnap = await getQueueBatchStatus();
    if (batchSnap.stopRequested) break;

    const queue = await getQueue();
    let selection = pruneSelection(queue, await getQueueSelectionSet());
    await setQueueSelection(selection);

    const selected = getSelectedEntries(queue, selection);
    if (!selected.length) {
      await chrome.storage.local.set({
        [QUEUE_BATCH_KEY]: { running: false, done: true, completedAt: Date.now() },
      });
      return;
    }

    const { idx, q, id } = selected[0];
    const remaining = selected.length;

    await chrome.storage.local.set({
      [QUEUE_BATCH_KEY]: {
        running: true,
        runId,
        currentScene: q.sceneNumber,
        remaining,
        startedAt: batchSnap.startedAt ?? Date.now(),
      },
    });

    try {
      const result = await fillQueueSceneAtIndex(idx);
      selection.delete(id);
      if (result.queuedAt) selection.delete(String(result.queuedAt));
      await setQueueSelection(selection);

      const stillSelected = getSelectedEntries(await getQueue(), selection).length;
      await chrome.storage.local.set({
        [LAST_QUEUE_FILL_KEY]: {
          ...result,
          batchRemaining: stillSelected,
          autoContinuing: stillSelected > 0,
        },
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await chrome.storage.local.set({
        [LAST_QUEUE_FILL_KEY]: { ok: false, error, completedAt: Date.now() },
        [QUEUE_BATCH_KEY]: { running: false, error, completedAt: Date.now() },
      });
      return;
    }

    const nextQueue = await getQueue();
    const nextSelection = pruneSelection(nextQueue, await getQueueSelectionSet());
    if (!getSelectedEntries(nextQueue, nextSelection).length) {
      await chrome.storage.local.set({
        [QUEUE_BATCH_KEY]: { running: false, done: true, completedAt: Date.now() },
      });
      return;
    }

    if (runId !== batchRunId) break;
    await sleep(BATCH_PAUSE_MS);
  }

  await chrome.storage.local.set({
    [QUEUE_BATCH_KEY]: { running: false, stopped: true, completedAt: Date.now() },
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  void (async () => {
    try {
      if (msg.type === "VF_LEXICAL_SET_PROMPT") {
        const tabId = _sender.tab?.id;
        if (!tabId) {
          sendResponse({ ok: false, error: "No Flow tab" });
          return;
        }
        try {
          const [injection] = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: (promptText) => {
              function visibleSlateEditor() {
                const editors = [...document.querySelectorAll('[data-slate-editor="true"]')];
                const vis = editors.filter((el) => {
                  const r = el.getBoundingClientRect();
                  return r.width > 80 && r.height > 16 && r.bottom > 0 && r.top < window.innerHeight;
                });
                return vis.length ? vis[vis.length - 1] : editors[editors.length - 1] || null;
              }

              const root = visibleSlateEditor();
              const editor = root?.__lexicalEditor;
              if (!editor?.parseEditorState || !editor?.setEditorState) {
                return { ok: false, error: "Lexical editor not found" };
              }
              try {
                const stateJson = {
                  root: {
                    children: [
                      {
                        children: [
                          {
                            detail: 0,
                            format: 0,
                            mode: "normal",
                            style: "",
                            text: promptText,
                            type: "text",
                            version: 1,
                          },
                        ],
                        direction: "ltr",
                        format: "",
                        indent: 0,
                        type: "paragraph",
                        version: 1,
                      },
                    ],
                    direction: "ltr",
                    format: "",
                    indent: 0,
                    type: "root",
                    version: 1,
                  },
                };
                const state = editor.parseEditorState(JSON.stringify(stateJson));
                editor.setEditorState(state);
                root.focus?.();
                return { ok: true, chars: promptText.length };
              } catch (e) {
                return { ok: false, error: e?.message || String(e) };
              }
            },
            args: [msg.text],
          });
          sendResponse(injection?.result ?? { ok: false, error: "No result" });
        } catch (e) {
          sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      if (msg.type === "VF_START_ANALYZE") {
        const projectId = msg.projectId;
        if (!projectId) {
          sendResponse({ ok: false, error: "No project id" });
          return;
        }
        void runAnalyzeJob(projectId);
        sendResponse({ ok: true, started: true });
        return;
      }

      if (msg.type === "VF_STOP_ANALYZE") {
        await stopAnalyzeJob();
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "VF_GET_ANALYZE_STATUS") {
        sendResponse({ ok: true, ...(await getAnalyzeJobStatus()) });
        return;
      }

      if (msg.type === "VF_GET_QUEUE") {
        sendResponse({ ok: true, queue: await getQueue() });
        return;
      }

      if (msg.type === "VF_GET_QUEUE_BATCH") {
        sendResponse({ ok: true, batch: await getQueueBatchStatus() });
        return;
      }

      if (msg.type === "VF_START_QUEUE_BATCH") {
        const batch = await getQueueBatchStatus();
        if (batch.running) {
          sendResponse({ ok: false, error: "Batch deja kaydour." });
          return;
        }
        const queue = await getQueue();
        const selection = pruneSelection(queue, await getQueueSelectionSet());
        if (!getSelectedEntries(queue, selection).length) {
          sendResponse({ ok: false, error: "Check at least one scene." });
          return;
        }
        void runSelectedQueueBatch();
        sendResponse({
          ok: true,
          started: true,
          count: getSelectedEntries(queue, selection).length,
        });
        return;
      }

      if (msg.type === "VF_STOP_QUEUE_BATCH") {
        batchRunId += 1;
        await chrome.storage.local.set({
          [QUEUE_BATCH_KEY]: { running: false, stopRequested: true, stoppedAt: Date.now() },
        });
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "VF_QUEUE_SCENE") {
        const item = { ...msg.payload, queuedAt: Date.now() };
        try {
          const appended = await appendFlowQueueItem(item);
          if (appended) {
            const queue = await getQueue();
            sendResponse({ ok: true, queueLength: queue.length });
            return;
          }
        } catch (e) {
          sendResponse({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
          return;
        }
        const queue = await getQueue();
        queue.push(item);
        await chrome.storage.local.set({ [QUEUE_KEY]: queue });
        sendResponse({ ok: true, queueLength: queue.length });
        return;
      }

      if (msg.type === "VF_CLEAR_QUEUE") {
        batchRunId += 1;
        try {
          await clearFlowQueueDb();
        } catch {
          /* offline / not signed in */
        }
        await setQueue([]);
        await chrome.storage.local.set({
          [QUEUE_BATCH_KEY]: { running: false, stopRequested: true, stoppedAt: Date.now() },
        });
        sendResponse({ ok: true });
        return;
      }

      if (msg.type === "VF_FILL_NEXT") {
        const queue = await getQueue();
        if (!queue.length) {
          sendResponse({ ok: false, error: "Queue khawya." });
          return;
        }
        try {
          const result = await fillQueueSceneAtIndex(0);
          sendResponse({ ok: true, ...result });
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          await chrome.storage.local.set({
            [LAST_QUEUE_FILL_KEY]: { ok: false, error, completedAt: Date.now() },
          });
          sendResponse({ ok: false, error });
        }
        return;
      }

      if (msg.type === "VF_FILL_QUEUE_AT") {
        const queue = await getQueue();
        if (!queue.length) {
          sendResponse({ ok: false, error: "Queue khawya." });
          return;
        }
        const index = typeof msg.index === "number" ? msg.index : 0;
        try {
          const result = await fillQueueSceneAtIndex(index);
          sendResponse({ ok: true, ...result });
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          await chrome.storage.local.set({
            [LAST_QUEUE_FILL_KEY]: { ok: false, error, completedAt: Date.now() },
          });
          sendResponse({ ok: false, error });
        }
        return;
      }

      if (msg.type === "VF_FILL_SCENE_NOW") {
        const tabId = await openOrFocusFlowTab();
        await sleep(3000);
        const fillResponse = await sendFillToFlowTab(tabId, msg.payload);
        sendResponse({ ok: true, result: fillResponse.result });
        return;
      }

      if (msg.type === "VF_FETCH_VIDEO_BLOB") {
        const url = typeof msg.url === "string" ? msg.url.trim() : "";
        if (!url) {
          sendResponse({ ok: false, error: "No URL." });
          return;
        }
        const fetched = await fetchVideoBuffer(url);
        sendResponse({ ok: true, ...fetched });
        return;
      }

      if (msg.type === "VF_REFETCH_EDIT_CLIP") {
        const url = typeof msg.url === "string" ? msg.url.trim() : "";
        if (!url) {
          sendResponse({ ok: false, error: "No source URL to re-import." });
          return;
        }
        const fetched = await fetchVideoBuffer(url);
        sendResponse({ ok: true, ...fetched });
        return;
      }

      if (msg.type === "VF_IMPORT_EDIT_CLIPS") {
        const items = Array.isArray(msg.items) ? msg.items : [];
        if (!items.length) {
          sendResponse({ ok: false, error: "No clips to import." });
          return;
        }

        const clips = [];
        for (const item of items) {
          let fetched;
          if (item.buffer) {
            const buf = normalizeArrayBuffer(item.buffer);
            if (!buf || !isVideoBuffer(buf)) {
              sendResponse({
                ok: false,
                error: `Clip #${item.order ?? "?"} is not a valid video file.`,
              });
              return;
            }
            fetched = {
              buffer: buf,
              mimeType: detectVideoMime(buf, item.mimeType),
              finalUrl: item.sourceUrl || "",
              byteLength: buf.byteLength,
            };
          } else {
            const sourceUrl = toAbsoluteFlowUrl(item.sourceUrl);
            if (!sourceUrl) {
              sendResponse({ ok: false, error: `Clip #${item.order ?? "?"}: missing URL` });
              return;
            }
            fetched = await fetchVideoBuffer(sourceUrl);
          }

          clips.push({
            id: item.id || `flow-${Date.now()}-${clips.length}`,
            name: item.name || `flow-scene-${item.order}.mp4`,
            order: item.order,
            selected: true,
            mimeType: fetched.mimeType,
            duration: 0,
            buffer: fetched.buffer,
            sourceUrl: fetched.finalUrl || item.sourceUrl,
            byteLength: fetched.byteLength,
          });
        }

        await saveEditClips(clips);
        await chrome.storage.local.set({ [EDIT_CLIPS_UPDATED_KEY]: Date.now() });
        sendResponse({ ok: true, count: clips.length });
        return;
      }

      if (msg.type === "VF_SAVE_EDIT_CLIPS") {
        const clips = Array.isArray(msg.clips) ? msg.clips : [];
        if (!clips.length) {
          sendResponse({ ok: false, error: "No clips to save." });
          return;
        }
        for (const clip of clips) {
          const buf = normalizeArrayBuffer(clip.buffer);
          if (!buf || !isVideoBuffer(buf)) {
            sendResponse({
              ok: false,
              error: `Clip #${clip.order ?? "?"} is not a valid video file.`,
            });
            return;
          }
          clip.buffer = buf;
          clip.mimeType = detectVideoMime(buf, clip.mimeType);
        }
        await saveEditClips(clips);
        await chrome.storage.local.set({ [EDIT_CLIPS_UPDATED_KEY]: Date.now() });
        sendResponse({ ok: true, count: clips.length });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message" });
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
