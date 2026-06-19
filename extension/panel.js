import {
  extractVideoFrames,
  autoSceneBoundaries,
  scenesFromBoundaries,
  clampCloneSceneCount,
  MAX_CLONE_SCENES,
} from "./lib/video-frames.js";
import {
  buildCloneFullScript,
} from "./lib/clone-prompts.js";
import { getApiBase, setApiBase, postAiJson } from "./lib/api.js";
import { saveFrames, loadFrames } from "./lib/frame-store.js";
import { loadEditClips, clearEditClips, saveEditClips } from "./lib/edit-clip-store.js";
import {
  getSession,
  isLoggedIn,
  signIn,
  signOut,
  setSupabaseConfig,
  getSupabaseConfig,
  getSupabaseConfigOverrides,
} from "./lib/auth.js";
import {
  createCloneProject,
  updateCloneProject,
  listCloneProjects,
  fetchCloneProject,
} from "./lib/clone-db.js";
import { getFlowSettings, setFlowSettings } from "./lib/flow-settings.js";
import { buildFlowPromptJson, buildFlowScenePayload } from "./lib/flow-prompt.js";
import { fetchIsAdmin } from "./lib/profile-db.js";
import { fetchAdminUsageOverview, formatCostUsd as adminFormatCost, updateAdminUserLimits } from "./lib/admin-usage-db.js";
import {
  isAiUsagePayload,
  insertUsageLog,
  fetchUsageBalance,
  formatCostUsd,
  formatUsageLine,
} from "./lib/usage-db.js";
import {
  combineVideoClips,
  downloadBlob,
  guessClipOrder,
  probeVideoUrl,
} from "./lib/video-edit.js";
import { normalizeArrayBuffer, formatByteSize } from "./lib/video-buffer-utils.js";
import { CLONE_AI_CONCURRENCY, runWithConcurrency } from "./lib/concurrency.js";

const DRAFT_META_KEY = "vf_draft_meta";
const ACTIVE_PROJECT_KEY = "vf_active_project_id";
const QUEUE_SELECTION_KEY = "vf_queue_selection";
const EDIT_CLIPS_UPDATED_KEY = "vf_edit_clips_updated";
const STEP_LABELS = ["Split video", "Scenes", "Analyze", "Veo prompts"];

const state = {
  step: 1,
  videoFile: null,
  videoObjectUrl: null,
  duration: 0,
  frames: [],
  extractMode: "count",
  frameCount: 24,
  intervalSec: 1,
  sceneCount: 6,
  boundaryIndices: [],
  scenes: [],
  busy: false,
  projectId: null,
  dbProjectId: null,
  videoName: null,
  analyzeJobRunning: false,
  queueBatchPoll: null,
  editClips: [],
  autoPipeline: true,
  promptsAutoTriggered: false,
  isAdmin: false,
  isGeneratingPrompts: false,
};

let persistTimer = null;
let analyzePollTimer = null;

const $ = (sel) => document.querySelector(sel);

function buildCloneProjectData() {
  return {
    extractMode: state.extractMode,
    frameCount: String(state.frameCount),
    intervalSec: String(state.intervalSec),
    sceneCount: String(state.sceneCount),
    boundaryIndices: state.boundaryIndices,
    frameMeta: state.frames.map((f) => ({ id: f.id, index: f.index, timeSec: f.timeSec })),
    scenes: state.scenes.map((s) => ({
      sceneNumber: s.sceneNumber,
      debutIndex: s.debut.index,
      finIndex: s.fin.index,
      debutTimeSec: s.debut.timeSec,
      finTimeSec: s.fin.timeSec,
      analysis: s.analysis,
      scenePackage: s.scenePackage,
      veoPrompt: s.veoPrompt,
      negativePrompt: s.negativePrompt,
      analyzeStatus: s.analyzeStatus,
      promptStatus: s.promptStatus,
      usageAnalyze: s.usageAnalyze,
      usagePrompt: s.usagePrompt,
      error: s.error,
    })),
  };
}

function projectStatus() {
  if (state.scenes.some((s) => s.promptStatus === "done")) return "complete";
  if (state.scenes.some((s) => s.analyzeStatus === "done")) return "analyzed";
  return state.step >= 2 ? "scenes" : "draft";
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => void persistAll(), 350);
}

async function persistAll() {
  if (!state.projectId) state.projectId = crypto.randomUUID();

  if (state.frames.length) {
    await saveFrames(
      state.projectId,
      state.frames.map((f) => ({ index: f.index, dataUrl: f.dataUrl }))
    );
  }

  const meta = {
    step: state.step,
    duration: state.duration,
    extractMode: state.extractMode,
    frameCount: state.frameCount,
    intervalSec: state.intervalSec,
    sceneCount: state.sceneCount,
    boundaryIndices: state.boundaryIndices,
    videoName: state.videoName,
    dbProjectId: state.dbProjectId,
    scenes: state.scenes.map((s) => ({
      sceneNumber: s.sceneNumber,
      debutIndex: s.debut.index,
      finIndex: s.fin.index,
      debutTimeSec: s.debut.timeSec,
      finTimeSec: s.fin.timeSec,
      analysis: s.analysis,
      scenePackage: s.scenePackage,
      veoPrompt: s.veoPrompt,
      negativePrompt: s.negativePrompt,
      analyzeStatus: s.analyzeStatus,
      promptStatus: s.promptStatus,
      usageAnalyze: s.usageAnalyze,
      usagePrompt: s.usagePrompt,
      error: s.error,
    })),
  };

  await chrome.storage.local.set({
    [DRAFT_META_KEY]: meta,
    [ACTIVE_PROJECT_KEY]: state.projectId,
  });
  updateDbBadge("local");

  if (!(await isLoggedIn()) || !state.frames.length) return;

  try {
    const data = buildCloneProjectData();
    const name = state.videoName?.replace(/\.[^.]+$/, "") || "Extension clone";
    if (state.dbProjectId) {
      await updateCloneProject(state.dbProjectId, {
        step: state.step,
        durationSec: state.duration,
        status: projectStatus(),
        data,
      });
    } else {
      const created = await createCloneProject({
        name,
        sourceVideoName: state.videoName,
        durationSec: state.duration,
        step: state.step,
        status: projectStatus(),
        data,
      });
      state.dbProjectId = created.id;
      meta.dbProjectId = created.id;
      await chrome.storage.local.set({ [DRAFT_META_KEY]: meta });
    }
    updateDbBadge("db");
    const el = $("#saveStatus");
    if (el) el.textContent = `Saved to DB · ${new Date().toLocaleTimeString()}`;
  } catch (e) {
    const el = $("#saveStatus");
    if (el) el.textContent = `DB: ${e.message}`;
    updateDbBadge("warn");
  }
}

async function restoreFromMeta(meta, frameRows) {
  const jobStatus = await chrome.runtime.sendMessage({ type: "VF_GET_ANALYZE_STATUS" });
  const jobRunning = jobStatus?.running === true;

  state.step = meta.step ?? 1;
  state.duration = meta.duration ?? 0;
  state.extractMode = meta.extractMode ?? "count";
  state.frameCount = meta.frameCount ?? 24;
  state.intervalSec = meta.intervalSec ?? 1;
  state.sceneCount = meta.sceneCount ?? 6;
  state.boundaryIndices = meta.boundaryIndices ?? [];
  state.videoName = meta.videoName ?? null;
  state.dbProjectId = meta.dbProjectId ?? null;
  if (meta.videoName) $("#videoLabel").textContent = meta.videoName;

  if (frameRows.length) {
    state.frames = frameRows.map((r) => {
      const sceneRef = meta.scenes?.find((s) => s.debutIndex === r.index);
      return {
        id: `f-${r.index}`,
        index: r.index,
        timeSec: sceneRef?.debutTimeSec ?? 0,
        dataUrl: r.dataUrl,
      };
    });
    for (const s of meta.scenes ?? []) {
      const fin = state.frames.find((f) => f.index === s.finIndex);
      if (fin && s.finTimeSec) fin.timeSec = s.finTimeSec;
    }
  }

  if (meta.scenes?.length) {
    state.scenes = meta.scenes.map((s) => {
      const debut = state.frames[s.debutIndex] ?? {
        id: `d-${s.sceneNumber}`,
        index: s.debutIndex,
        timeSec: s.debutTimeSec,
        dataUrl: "",
      };
      const fin = state.frames[s.finIndex] ?? {
        id: `f-${s.sceneNumber}`,
        index: s.finIndex,
        timeSec: s.finTimeSec,
        dataUrl: "",
      };
      return {
        sceneNumber: s.sceneNumber,
        debut,
        fin,
        analysis: s.analysis,
        scenePackage: s.scenePackage,
        veoPrompt: s.veoPrompt,
        negativePrompt: s.negativePrompt,
        analyzeStatus:
          jobRunning && s.analyzeStatus === "loading"
            ? "loading"
            : s.analyzeStatus === "loading"
              ? "idle"
              : (s.analyzeStatus ?? "idle"),
        promptStatus: s.promptStatus ?? "idle",
        usageAnalyze: s.usageAnalyze,
        usagePrompt: s.usagePrompt,
        error: s.error,
      };
    });
  }

  goStep(state.step, { skipPersist: true });
  if (state.frames.length) renderFrames();
  if (state.scenes.length) renderScenes();
  updateAnalyzeButton();
}

function scenesLeftToAnalyze() {
  return state.scenes.filter((s) => s.analyzeStatus !== "done" || !s.analysis?.trim()).length;
}

function updateAnalyzeButton() {
  const btn = $("#btnAnalyzeAll");
  if (!btn || !state.scenes.length) return;
  const done = state.scenes.filter((s) => s.analyzeStatus === "done").length;
  const left = scenesLeftToAnalyze();
  if (state.analyzeJobRunning) {
    btn.textContent = `Analyzing… (${done}/${state.scenes.length})`;
  } else if (left === 0) {
    btn.textContent = "All scenes analyzed";
  } else if (done > 0) {
    btn.textContent = `Continue analyze (${left} left)`;
  } else {
    btn.textContent = "Analyze all scenes";
  }
}

async function syncMetaFromStorage() {
  const stored = await chrome.storage.local.get([DRAFT_META_KEY, ACTIVE_PROJECT_KEY]);
  const projectId = stored[ACTIVE_PROJECT_KEY];
  const meta = stored[DRAFT_META_KEY];
  if (!projectId || !meta || projectId !== state.projectId || !meta.scenes?.length) return;

  for (let i = 0; i < meta.scenes.length; i++) {
    const ms = meta.scenes[i];
    const ss = state.scenes[i];
    if (!ss) continue;
    ss.analysis = ms.analysis;
    ss.analyzeStatus = ms.analyzeStatus ?? ss.analyzeStatus;
    ss.usageAnalyze = ms.usageAnalyze ?? ss.usageAnalyze;
    ss.usagePrompt = ms.usagePrompt ?? ss.usagePrompt;
    ss.error = ms.error;
  }
  if (meta.step && meta.step !== state.step) goStep(meta.step, { skipPersist: true });
  renderScenes();
  updateAnalyzeButton();
}

function stopAnalyzePolling() {
  if (analyzePollTimer) {
    clearInterval(analyzePollTimer);
    analyzePollTimer = null;
  }
}

function startAnalyzePolling() {
  stopAnalyzePolling();
  state.analyzeJobRunning = true;
  updateAnalyzeButton();
  analyzePollTimer = setInterval(() => void pollAnalyzeJob(), 1200);
  void pollAnalyzeJob();
}

async function pollAnalyzeJob() {
  await syncMetaFromStorage();
  const status = await chrome.runtime.sendMessage({ type: "VF_GET_ANALYZE_STATUS" });
  state.analyzeJobRunning = status?.running === true;
  updateAnalyzeButton();
  if (!state.analyzeJobRunning) {
    stopAnalyzePolling();
    setBusy(false);
    await syncMetaFromStorage();
    await persistAll();
    void refreshUsageBadge();
    if (state.scenes.every((s) => s.analyzeStatus === "done")) {
      goStep(4);
      renderPipelineBoard();
      showStatus("All scenes analyzed.");
      const needsPrompts = state.scenes.some(
        (s) => s.analysis?.trim() && s.promptStatus !== "done" && s.promptStatus !== "loading"
      );
      if (state.autoPipeline && !state.promptsAutoTriggered && needsPrompts) {
        state.promptsAutoTriggered = true;
        showStatus("All scenes analyzed — generating Veo prompts…");
        void onGeneratePrompts();
      }
    } else if (state.scenes.some((s) => s.analyzeStatus === "error")) {
      showStatus("Analyze finished with errors — tap Continue to retry.", "error");
    }
  }
}

async function loadDraft() {
  const stored = await chrome.storage.local.get([DRAFT_META_KEY, ACTIVE_PROJECT_KEY]);
  const projectId = stored[ACTIVE_PROJECT_KEY];
  const meta = stored[DRAFT_META_KEY];
  if (!projectId || !meta) return;
  state.projectId = projectId;
  const frameRows = await loadFrames(projectId);
  await restoreFromMeta(meta, frameRows);
  showStatus("Project restored.");
}

async function loadProjectFromDb(dbId) {
  const project = await fetchCloneProject(dbId);
  if (!project) return;
  state.dbProjectId = project.id;
  state.projectId = state.projectId ?? crypto.randomUUID();
  state.videoName = project.sourceVideoName;
  state.duration = project.durationSec ?? 0;
  state.extractMode = project.data.extractMode ?? "count";
  state.frameCount = Number(project.data.frameCount) || 24;
  state.intervalSec = Number(project.data.intervalSec) || 1;
  state.sceneCount = Number(project.data.sceneCount) || 6;
  state.boundaryIndices = project.data.boundaryIndices ?? [];

  const frameRows = await loadFrames(state.projectId);
  state.frames = frameRows.map((r) => ({
    id: `f-${r.index}`,
    index: r.index,
    timeSec: 0,
    dataUrl: r.dataUrl,
  }));

  state.scenes = (project.data.scenes ?? []).map((s) => {
    const debut = state.frames[s.debutIndex] ?? {
      id: `d-${s.sceneNumber}`,
      index: s.debutIndex,
      timeSec: s.debutTimeSec,
      dataUrl: "",
    };
    const fin = state.frames[s.finIndex] ?? {
      id: `f-${s.sceneNumber}`,
      index: s.finIndex,
      timeSec: s.finTimeSec,
      dataUrl: "",
    };
    debut.timeSec = s.debutTimeSec;
    fin.timeSec = s.finTimeSec;
    return {
      sceneNumber: s.sceneNumber,
      debut,
      fin,
      analysis: s.analysis,
      scenePackage: s.scenePackage,
      veoPrompt: s.veoPrompt,
      negativePrompt: s.negativePrompt,
      analyzeStatus: s.analyzeStatus ?? "idle",
      promptStatus: s.promptStatus ?? "idle",
      usageAnalyze: s.usageAnalyze,
      usagePrompt: s.usagePrompt,
      error: s.error,
    };
  });

  goStep(Math.min(4, Math.max(1, project.step)), { skipPersist: true });
  renderFrames();
  renderScenes();
  showStatus(`Loaded: ${project.name}`);
}

function usageChipHtml(usage) {
  if (!usage) return "";
  return `<span class="usage-chip" title="${escapeHtml(formatUsageLine(usage))}">${escapeHtml(formatCostUsd(usage.costUsd))}</span>`;
}

async function refreshUsageBadge() {
  const el = $("#usageBadge");
  if (!el) return;
  if (!(await isLoggedIn())) {
    el.classList.add("hidden");
    return;
  }
  try {
    const balance = await fetchUsageBalance();
    if (!balance) {
      el.classList.add("hidden");
      return;
    }
    el.classList.remove("hidden");
    el.textContent = `Today ${formatCostUsd(balance.today.totalCostUsd)} · Month ${formatCostUsd(balance.month.totalCostUsd)}`;
  } catch {
    el.classList.add("hidden");
  }
}

async function recordUsageFromResponse(json, label, sceneRef, field) {
  if (!isAiUsagePayload(json.usage)) return;
  if (sceneRef && field) sceneRef[field] = json.usage;
  try {
    await insertUsageLog(json.usage, label, {
      projectType: "clone_extension",
      projectId: state.dbProjectId ?? state.projectId,
    });
  } catch {
    /* optional */
  }
  void refreshUsageBadge();
}

function updateDbBadge(mode) {
  const el = $("#dbBadge");
  if (!el) return;
  if (mode === "db") {
    el.textContent = "DB saved";
    el.className = "db-badge ok";
  } else if (mode === "warn") {
    el.textContent = "DB err";
    el.className = "db-badge warn";
  } else {
    el.textContent = "Local";
    el.className = "db-badge";
  }
}

async function refreshAuthUi() {
  const session = await getSession();
  const loggedIn = !!(session?.accessToken && session?.userId);
  const statusEl = $("#authStatus");
  const outEl = $("#authLoggedOut");
  const inEl = $("#authLoggedIn");
  const errEl = $("#authError");

  if (loggedIn && session?.email) {
    statusEl.textContent = `Signed in as ${session.email}`;
    outEl?.classList.add("hidden");
    inEl?.classList.remove("hidden");
  } else if (loggedIn) {
    statusEl.textContent = "Signed in";
    outEl?.classList.add("hidden");
    inEl?.classList.remove("hidden");
  } else {
    statusEl.textContent = "Sign in to save projects and track usage.";
    outEl?.classList.remove("hidden");
    inEl?.classList.add("hidden");
  }
  errEl?.classList.add("hidden");

  await refreshUsageBadge();
  state.isAdmin = loggedIn ? await fetchIsAdmin() : false;
  const adminTab = $("#tabAdminBtn");
  if (adminTab) adminTab.classList.toggle("hidden", !state.isAdmin);
  const projectsBox = $("#savedProjects");
  if (!loggedIn) {
    if (projectsBox) projectsBox.innerHTML = "";
    return;
  }
  try {
    const projects = await listCloneProjects();
    const box = $("#savedProjects");
    if (!projects.length) {
      box.innerHTML = "<p class='muted'>No DB projects yet.</p>";
      return;
    }
    box.innerHTML = projects
      .map(
        (p) =>
          `<button type="button" data-id="${p.id}">${escapeHtml(p.name)} · step ${p.step}</button>`
      )
      .join("");
    box.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => void loadProjectFromDb(btn.dataset.id));
    });
  } catch (e) {
    $("#savedProjects").innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`;
  }
}

function showStatus(msg, type = "ok") {
  const bar = $("#statusBar");
  bar.textContent = msg;
  bar.className = `status-bar ${type}`;
}

function hideStatus() {
  $("#statusBar").className = "status-bar hidden";
}

function setBusy(busy) {
  state.busy = busy;
  document.querySelectorAll(".btn.primary").forEach((b) => {
    b.disabled = busy;
  });
}

async function saveDraft() {
  schedulePersist();
}

function renderStepNav() {
  const nav = $("#stepNav");
  nav.innerHTML = STEP_LABELS.map((label, i) => {
    const n = i + 1;
    const cls = state.step === n ? "active" : state.step > n ? "done" : "";
    return `<button type="button" class="step-pill ${cls}" data-step="${n}">${n}. ${label}</button>`;
  }).join("");
  nav.querySelectorAll(".step-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const n = Number(btn.dataset.step);
      if (n <= state.step || state.frames.length) goStep(n);
    });
  });
  renderPipelineBoard();
}

function pipelineStepStatus(key) {
  const total = state.scenes.length;
  const analyzed = state.scenes.filter((s) => s.analyzeStatus === "done").length;
  const analyzeErrors = state.scenes.filter((s) => s.analyzeStatus === "error").length;
  const prompted = state.scenes.filter((s) => s.promptStatus === "done").length;
  const promptErrors = state.scenes.filter((s) => s.promptStatus === "error").length;

  switch (key) {
    case "upload":
      return {
        done: !!(state.videoFile || state.videoName),
        active: false,
        detail: state.videoName || "No video",
      };
    case "frames":
      return {
        done: state.frames.length > 0,
        active: state.busy && state.step === 1 && !state.frames.length,
        detail: state.frames.length ? `${state.frames.length} frames` : "—",
      };
    case "scenes":
      return {
        done: total > 0,
        active: state.step === 2 && total === 0,
        detail: total ? `${total} scene(s)` : "—",
      };
    case "analyze":
      return {
        done: total > 0 && analyzed === total,
        active: state.analyzeJobRunning,
        detail: total
          ? analyzeErrors
            ? `${analyzed}/${total} · ${analyzeErrors} error(s)`
            : `${analyzed}/${total}`
          : "—",
        error: analyzeErrors > 0 && analyzed + analyzeErrors === total,
      };
    case "prompts":
      return {
        done: total > 0 && state.scenes.every((s) => !s.analysis?.trim() || s.promptStatus === "done"),
        active: state.isGeneratingPrompts,
        detail: total
          ? promptErrors
            ? `${prompted}/${total} · ${promptErrors} error(s)`
            : `${prompted}/${total}`
          : "—",
        error: promptErrors > 0,
      };
    default:
      return { done: false, active: false, detail: "—" };
  }
}

function renderPipelineBoard() {
  const board = $("#pipelineBoard");
  if (!board) return;
  const hasProgress =
    state.videoFile ||
    state.videoName ||
    state.frames.length ||
    state.scenes.length ||
    state.step > 1;
  if (!hasProgress) {
    board.classList.add("hidden");
    return;
  }
  board.classList.remove("hidden");

  const steps = [
    { key: "upload", label: "Video" },
    { key: "frames", label: "Frames" },
    { key: "scenes", label: "Scenes" },
    { key: "analyze", label: "Analyze" },
    { key: "prompts", label: "Veo prompts" },
  ];

  board.innerHTML = `
    <h2 class="pipeline-title">Pipeline status</h2>
    <div class="pipeline-steps">
      ${steps
        .map((s) => {
          const st = pipelineStepStatus(s.key);
          const cls = st.done ? "done" : st.active ? "active" : st.error ? "error" : "";
          return `<div class="pipeline-step ${cls}">
            <div class="pipeline-step-label">${escapeHtml(s.label)}</div>
            <div class="pipeline-step-detail">${escapeHtml(st.detail)}</div>
          </div>`;
        })
        .join("")}
    </div>
    ${
      state.autoPipeline
        ? `<p class="hint pipeline-hint">Auto pipeline ON — wait until all Veo prompts show <strong>done</strong> below.</p>`
        : `<p class="hint pipeline-hint">Manual mode — run Analyze and Generate prompts yourself.</p>`
    }`;
}

async function renderFlowSettingsSummary() {
  const el = $("#flowSettingsSummary");
  if (!el) return;
  const flow = await getFlowSettings();
  el.innerHTML = `
    <h3 class="flow-summary-title">Google Flow settings</h3>
    <div class="flow-summary-grid">
      <span><strong>Aspect</strong> ${escapeHtml(flow.aspectRatio)}</span>
      <span><strong>Model</strong> ${escapeHtml(flow.model)}</span>
      <span><strong>Duration</strong> ${escapeHtml(flow.duration)}s</span>
      <span><strong>Outputs</strong> ${escapeHtml(flow.outputs)}</span>
      <span><strong>Mode</strong> ${escapeHtml(flow.videoMode)}</span>
      <span><strong>Auto-run Flow</strong> ${flow.autoRun !== false ? "Yes" : "No"}</span>
    </div>
    <p class="hint">Change in Settings tab → Google Flow automation.</p>`;
}

async function renderAdminTab() {
  const stats = $("#adminStats");
  const users = $("#adminUsers");
  const recent = $("#adminRecent");
  if (!stats || !users || !recent) return;
  stats.innerHTML = `<p class="muted">Loading admin data…</p>`;
  users.innerHTML = "";
  recent.innerHTML = "";
  try {
    const data = await fetchAdminUsageOverview();
    stats.innerHTML = `
      <div class="admin-stat-grid">
        <div><span class="muted">All users</span><strong>${data.totalUsers}</strong></div>
        <div><span class="muted">Calls (month)</span><strong>${data.totalCalls}</strong></div>
        <div><span class="muted">Tokens</span><strong>${data.totalTokens.toLocaleString()}</strong></div>
        <div><span class="muted">Cost</span><strong>${adminFormatCost(data.totalCostUsd)}</strong></div>
      </div>`;

    users.innerHTML = `
      <p class="hint">Empty cap = unlimited. If no users appear, run <code>supabase/admin_rls_fix.sql</code> in Supabase.</p>
      ${data.users.length === 0 ? `<p class="muted center">No users — run admin_rls_fix.sql to sync Auth accounts.</p>` : `
      <table class="admin-table admin-table-limits">
        <thead>
          <tr>
            <th>User</th>
            <th>Today</th>
            <th>Month</th>
            <th>Daily $</th>
            <th>Daily tokens</th>
            <th>Monthly $</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${data.users
            .map((u) => {
              const overDaily =
                (u.limits.dailyBudgetUsd != null && u.today.totalCostUsd >= u.limits.dailyBudgetUsd) ||
                (u.limits.dailyTokenLimit != null && u.today.totalTokens >= u.limits.dailyTokenLimit);
              const overMonth =
                u.limits.monthlyBudgetUsd != null && u.month.totalCostUsd >= u.limits.monthlyBudgetUsd;
              return `<tr data-user-id="${u.userId}" class="${overDaily || overMonth ? "over-limit" : ""}">
                <td>
                  <strong>${escapeHtml(u.email || `${u.userId.slice(0, 8)}…`)}</strong>
                  ${u.isAdmin ? '<span class="admin-pill">admin</span>' : ""}
                  <div class="muted xs">${u.lastCallAt ? new Date(u.lastCallAt).toLocaleString() : "No calls"}</div>
                </td>
                <td class="tabular-nums">
                  ${adminFormatCost(u.today.totalCostUsd)}<br>
                  <span class="muted">${u.today.totalTokens.toLocaleString()} tok</span>
                </td>
                <td class="tabular-nums">
                  ${adminFormatCost(u.month.totalCostUsd)}<br>
                  <span class="muted">${u.month.totalTokens.toLocaleString()} tok</span>
                </td>
                <td><input type="number" min="0" step="0.01" class="limit-input" data-field="dailyBudgetUsd" value="${u.limits.dailyBudgetUsd ?? ""}" placeholder="—" /></td>
                <td><input type="number" min="0" step="1" class="limit-input" data-field="dailyTokenLimit" value="${u.limits.dailyTokenLimit ?? ""}" placeholder="—" /></td>
                <td><input type="number" min="0" step="0.01" class="limit-input" data-field="monthlyBudgetUsd" value="${u.limits.monthlyBudgetUsd ?? ""}" placeholder="—" /></td>
                <td><button type="button" class="btn secondary sm btn-save-limits">Save</button></td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>`}`;

    users.querySelectorAll(".btn-save-limits").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const row = btn.closest("tr");
        const userId = row?.dataset.userId;
        if (!userId) return;
        const parseField = (field) => {
          const input = row.querySelector(`[data-field="${field}"]`);
          const raw = input?.value?.trim() ?? "";
          if (!raw) return null;
          const n = Number(raw);
          if (!Number.isFinite(n) || n <= 0) throw new Error("Limits must be positive or empty.");
          return n;
        };
        btn.disabled = true;
        try {
          await updateAdminUserLimits(userId, {
            dailyBudgetUsd: parseField("dailyBudgetUsd"),
            dailyTokenLimit: parseField("dailyTokenLimit"),
            monthlyBudgetUsd: parseField("monthlyBudgetUsd"),
          });
          showStatus("Limits saved.", "ok");
          void renderAdminTab();
        } catch (e) {
          showStatus(e.message, "err");
        } finally {
          btn.disabled = false;
        }
      });
    });

    recent.innerHTML = data.recentLogs
      .map(
        (log) => `<div class="admin-log-row">
          <div><strong>${escapeHtml(log.label || "API")}</strong><br><span class="muted">${new Date(log.created_at).toLocaleString()} · ${escapeHtml(log.model || "")}</span></div>
          <div class="admin-log-cost">${adminFormatCost(Number(log.cost_usd || 0))}</div>
        </div>`
      )
      .join("");
  } catch (e) {
    stats.innerHTML = `<p class="muted" style="color:var(--red)">${escapeHtml(e.message)}</p>`;
  }
}

function goStep(n, opts = {}) {
  state.step = n;
  for (let i = 1; i <= 4; i++) {
    $(`#clone-step-${i}`).classList.toggle("hidden", i !== n);
  }
  renderStepNav();
  if (!opts.skipPersist) schedulePersist();
}

function renderFrames() {
  const strip = $("#frameStrip");
  strip.innerHTML = state.frames
    .map(
      (f) => `
    <button type="button" class="frame-thumb ${state.boundaryIndices.includes(f.index) ? "boundary" : ""}" data-idx="${f.index}">
      <img src="${f.dataUrl}" alt="" />
      <div class="meta">#${f.index + 1} · ${f.timeSec.toFixed(2)}s</div>
    </button>`
    )
    .join("");
  strip.querySelectorAll(".frame-thumb").forEach((btn) => {
    btn.addEventListener("click", () => toggleBoundary(Number(btn.dataset.idx)));
  });

  const pairs = scenesFromBoundaries(state.frames, state.boundaryIndices);
  $("#boundarySummary").textContent = `${state.boundaryIndices.length} boundaries → ${pairs.length} scene(s)`;
  $("#scenePairList").innerHTML = pairs
    .map(
      (p) =>
        `<li><strong>Scene ${p.sceneNumber}</strong> — #${p.debut.index + 1} (${p.debut.timeSec.toFixed(2)}s) → #${p.fin.index + 1} (${p.fin.timeSec.toFixed(2)}s)</li>`
    )
    .join("");
}

function toggleBoundary(index) {
  let next = state.boundaryIndices.includes(index)
    ? state.boundaryIndices.filter((i) => i !== index)
    : [...state.boundaryIndices, index];
  next = [...new Set(next)].sort((a, b) => a - b);
  if (next.length < 2) return;
  state.boundaryIndices = next;
  renderFrames();
  schedulePersist();
}

function sceneCardHtml(s, large = false) {
  const analyzeBadge = s.analyzeStatus
    ? `<span class="badge ${s.analyzeStatus}">${s.analyzeStatus}</span>`
    : "";
  const promptBadge = s.promptStatus
    ? `<span class="badge ${s.promptStatus}">${s.promptStatus}</span>`
    : "";
  const imgClass = large ? "large" : "";
  return `
    <article class="scene-card" data-scene="${s.sceneNumber}">
      <h3>Scene ${s.sceneNumber} ${analyzeBadge} ${promptBadge} ${usageChipHtml(s.usageAnalyze)} ${usageChipHtml(s.usagePrompt)}</h3>
      <div class="pair-images ${imgClass}">
        <figure>
          <img src="${s.debut.dataUrl}" alt="debut" />
          <figcaption>Debut · ${s.debut.timeSec.toFixed(2)}s</figcaption>
        </figure>
        <figure>
          <img src="${s.fin.dataUrl}" alt="fin" />
          <figcaption>Fin · ${s.fin.timeSec.toFixed(2)}s</figcaption>
        </figure>
      </div>
      ${s.error ? `<p class="muted" style="color:var(--red)">${escapeHtml(s.error)}</p>` : ""}
      ${
        s.analysis
          ? `<details class="detail-block" open><summary>Vision analysis</summary><pre>${escapeHtml(s.analysis)}</pre></details>`
          : ""
      }
      ${
        s.scenePackage || s.veoPrompt
          ? `<details class="detail-block" open><summary>Full JSON package (Google Flow)</summary><textarea readonly class="json-pkg">${escapeHtml(buildFlowPromptJson(s))}</textarea></details>`
          : ""
      }
      ${
        s.veoPrompt
          ? `<details class="detail-block"><summary>veoPrompt only (${s.veoPrompt.trim().split(/\s+/).length} words)</summary><textarea readonly>${escapeHtml(s.veoPrompt)}</textarea></details>`
          : ""
      }
      ${
        s.negativePrompt
          ? `<details class="detail-block"><summary>Negative prompt</summary><pre>${escapeHtml(s.negativePrompt)}</pre></details>`
          : ""
      }
      <div class="actions">
        <button type="button" class="btn secondary btn-fill-flow" data-scene="${s.sceneNumber}">→ Google Flow</button>
        <button type="button" class="btn ghost btn-copy-prompt" data-scene="${s.sceneNumber}">Copy JSON</button>
      </div>
    </article>`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderScenes() {
  $("#analyzeScenes").innerHTML = state.scenes.map((s) => sceneCardHtml(s, false)).join("");
  $("#promptScenes").innerHTML = state.scenes.map((s) => sceneCardHtml(s, true)).join("");
  bindSceneActions();
}

function bindSceneActions() {
  document.querySelectorAll(".btn-fill-flow").forEach((btn) => {
    btn.onclick = () => {
      const sn = Number(btn.dataset.scene);
      const s = state.scenes.find((x) => x.sceneNumber === sn);
      if (!s?.scenePackage && !s?.veoPrompt) {
        showStatus("Generi Veo prompt lwl.", "error");
        return;
      }
      void fillSceneInFlow(buildFlowScenePayload(s));
    };
  });
  document.querySelectorAll(".btn-copy-prompt").forEach((btn) => {
    btn.onclick = () => {
      const sn = Number(btn.dataset.scene);
      const s = state.scenes.find((x) => x.sceneNumber === sn);
      if (s) void navigator.clipboard.writeText(buildFlowPromptJson(s));
    };
  });
}

async function fillSceneInFlow(scene) {
  await persistAll();
  showStatus("Opening Google Flow…");
  const res = await chrome.runtime.sendMessage({
    type: "VF_FILL_SCENE_NOW",
    payload: scene,
  });
  if (!res?.ok) showStatus(res?.error || "Fill failed", "error");
  else showStatus(`Scene ${scene.sceneNumber} — filled in Google Flow.`);
}

// ——— Clone actions ———

async function onExtract() {
  if (!state.videoFile) {
    showStatus("Uploadi video lwl.", "error");
    return;
  }
  setBusy(true);
  hideStatus();
  state.promptsAutoTriggered = false;
  try {
    const result = await extractVideoFrames(state.videoFile, {
      mode: state.extractMode,
      frameCount: state.frameCount,
      intervalSec: state.intervalSec,
    });
    state.duration = result.duration;
    state.frames = result.frames;
    const sc = clampCloneSceneCount(state.sceneCount, result.frames.length);
    state.sceneCount = sc;
    state.boundaryIndices = autoSceneBoundaries(result.frames.length, sc);
    renderFrames();
    if (!buildScenesFromBoundaries()) {
      goStep(2);
      showStatus(`${result.frames.length} frames extracted — set scene boundaries.`);
      schedulePersist();
      return;
    }
    renderScenes();
    goStep(3);
    showStatus(`${result.frames.length} frames — analyzing ${state.scenes.length} scene(s)…`);
    schedulePersist();
    void onAnalyzeAll();
  } catch (e) {
    showStatus(e.message, "error");
  } finally {
    setBusy(false);
  }
}

function buildScenesFromBoundaries() {
  const pairs = scenesFromBoundaries(state.frames, state.boundaryIndices);
  if (!pairs.length) return false;
  state.scenes = pairs.map((p) => ({
    sceneNumber: p.sceneNumber,
    debut: p.debut,
    fin: p.fin,
    analyzeStatus: "idle",
    promptStatus: "idle",
  }));
  return true;
}

function onConfirmScenes() {
  if (!buildScenesFromBoundaries()) {
    showStatus("Khass boundaries bach tkon scene.", "error");
    return;
  }
  renderScenes();
  goStep(3);
  schedulePersist();
  void onAnalyzeAll();
}

async function onAnalyzeAll() {
  const left = scenesLeftToAnalyze();
  if (!left) {
    showStatus("All scenes already analyzed.");
    goStep(4);
    return;
  }
  if (!state.projectId) state.projectId = crypto.randomUUID();
  await persistAll();

  const status = await chrome.runtime.sendMessage({ type: "VF_GET_ANALYZE_STATUS" });
  if (status?.running) {
    showStatus("Analyze already running — reopen anytime to check progress.");
    setBusy(true);
    startAnalyzePolling();
    return;
  }

  setBusy(true);
  const res = await chrome.runtime.sendMessage({
    type: "VF_START_ANALYZE",
    projectId: state.projectId,
  });
  if (!res?.ok) {
    setBusy(false);
    showStatus(res?.error || "Failed to start analyze", "error");
    return;
  }
  showStatus("Analyze running in parallel — safe to close the sidebar.");
  startAnalyzePolling();
}

async function onGeneratePrompts() {
  const pending = state.scenes.filter((s) => s.analysis?.trim());
  if (!pending.length) {
    showStatus("Analyze scenes first.", "error");
    return;
  }

  setBusy(true);
  state.isGeneratingPrompts = true;
  renderPipelineBoard();
  const fullScript = buildCloneFullScript(state.scenes, state.duration);
  const progress = $("#generateProgress");
  if (progress) {
    progress.classList.remove("hidden");
    progress.textContent = `Generating ${pending.length} scene(s) (${CLONE_AI_CONCURRENCY} at a time)…`;
  }

  for (const s of pending) {
    s.promptStatus = "loading";
    s.error = undefined;
  }
  renderScenes();

  let done = 0;
  const promptTasks = pending.map((s) => async () => {
    try {
      const data = await postAiJson("/api/ai/veo-scene-package", {
        fullScript,
        sceneNumber: s.sceneNumber,
        imageAnalysis: s.analysis,
        languageLabel: "Moroccan Darija",
        workflowMode: "clone",
      });
      if (data.scenePackage) {
        s.scenePackage = data.scenePackage;
        s.veoPrompt = data.scenePackage.veoPrompt || "";
        s.negativePrompt = data.scenePackage.negativePrompt || "";
        s.promptStatus = "done";
        await recordUsageFromResponse(
          data,
          `Clone Veo prompt · scene ${s.sceneNumber}`,
          s,
          "usagePrompt"
        );
      } else {
        s.promptStatus = "error";
        s.error = data.parseError || "JSON parse failed";
      }
    } catch (e) {
      s.promptStatus = "error";
      s.error = e instanceof Error ? e.message : String(e);
    } finally {
      done += 1;
      if (progress) progress.textContent = `Prompts ${done} / ${pending.length} done…`;
      renderScenes();
    }
  });

  await runWithConcurrency(promptTasks, CLONE_AI_CONCURRENCY);

  if (progress) progress.classList.add("hidden");
  state.isGeneratingPrompts = false;
  setBusy(false);
  renderPipelineBoard();
  schedulePersist();
  showStatus(
    state.scenes.every((s) => !s.analysis?.trim() || s.promptStatus === "done")
      ? "All Veo prompts generated."
      : "Some prompts failed — check scene cards."
  );
}

async function onQueueAllFlow() {
  const ready = state.scenes.filter((s) => s.scenePackage || s.veoPrompt?.trim());
  for (const s of ready) {
    await chrome.runtime.sendMessage({
      type: "VF_QUEUE_SCENE",
      payload: buildFlowScenePayload(s),
    });
  }
  showStatus(`${ready.length} scene(s) queued — check scenes, then Run selected scenes.`);
  await refreshQueue();
  await setAllQueueSelected(true);
}

// ——— Queue tab ———

/** @type {Set<string>} */
let queueSelectedIds = new Set();

function queueItemId(q, idx = 0) {
  return String(q.queuedAt ?? `scene-${q.sceneNumber ?? idx}`);
}

async function saveQueueSelection() {
  await chrome.storage.local.set({ [QUEUE_SELECTION_KEY]: [...queueSelectedIds] });
}

async function loadQueueSelection() {
  const data = await chrome.storage.local.get(QUEUE_SELECTION_KEY);
  queueSelectedIds = new Set(Array.isArray(data[QUEUE_SELECTION_KEY]) ? data[QUEUE_SELECTION_KEY] : []);
}

function pruneQueueSelection(queue) {
  const valid = new Set(queue.map((q, idx) => queueItemId(q, idx)));
  queueSelectedIds = new Set([...queueSelectedIds].filter((id) => valid.has(id)));
}

function getSelectedQueueEntries(queue) {
  return queue
    .map((q, idx) => ({ q, idx, id: queueItemId(q, idx) }))
    .filter(({ id }) => queueSelectedIds.has(id));
}

function formatQueueDoneMessage(res, nextEntry, batch) {
  if (batch?.running) {
    return `Running Scene ${batch.currentScene}… ${batch.remaining} selected left.`;
  }
  if (res?.autoContinuing && nextEntry) {
    return `Scene ${res.sceneNumber} done — auto-starting Scene ${nextEntry.q.sceneNumber}…`;
  }
  if (res?.result?.needsManualGenerate) {
    const next = nextEntry ? ` Next: Scene ${nextEntry.q.sceneNumber}.` : "";
    return `Scene ${res.sceneNumber} filled — click Generate on Flow.${next}`;
  }
  if (nextEntry) {
    return `Scene ${res.sceneNumber} done. Next: Scene ${nextEntry.q.sceneNumber}.`;
  }
  if (res?.batchRemaining > 0) {
    return `Scene ${res.sceneNumber} done. ${res.batchRemaining} selected left.`;
  }
  if (res?.remaining > 0) {
    return `Scene ${res.sceneNumber} done. ${res.remaining} left in queue.`;
  }
  return `Scene ${res.sceneNumber} done. All selected scenes finished.`;
}

function updateQueueBatchUi(batch) {
  const running = !!batch?.running;
  const fillBtn = $("#btnFillSelected");
  const stopBtn = $("#btnStopQueueBatch");
  if (fillBtn) fillBtn.disabled = running;
  if (stopBtn) stopBtn.classList.toggle("hidden", !running);
  $("#btnQueueSelectAll")?.toggleAttribute("disabled", running);
  $("#btnQueueSelectNone")?.toggleAttribute("disabled", running);
  $("#btnClearQueue")?.toggleAttribute("disabled", running);
  document.querySelectorAll(".btn-queue-fill, .queue-check").forEach((el) => {
    el.toggleAttribute("disabled", running);
  });
}

function stopQueueBatchPolling() {
  if (state.queueBatchPoll) {
    clearInterval(state.queueBatchPoll);
    state.queueBatchPoll = null;
  }
}

function startQueueBatchPolling() {
  stopQueueBatchPolling();
  state.queueBatchPoll = setInterval(() => void syncQueueBatchUi(), 2000);
  void syncQueueBatchUi();
}

async function syncQueueBatchUi() {
  const res = await chrome.runtime.sendMessage({ type: "VF_GET_QUEUE_BATCH" });
  const batch = res?.batch ?? { running: false };
  updateQueueBatchUi(batch);

  if (batch.running) {
    setBusy(true);
    showStatus(formatQueueDoneMessage(null, null, batch));
    const banner = $("#queueDoneBanner");
    if (banner) {
      banner.classList.remove("hidden");
      banner.textContent = formatQueueDoneMessage(null, null, batch);
      banner.className = "queue-done-banner";
    }
    void refreshQueue();
    return;
  }

  stopQueueBatchPolling();
  setBusy(false);
  void refreshQueue();

  const lastFill = (await chrome.storage.local.get("vf_last_queue_fill")).vf_last_queue_fill;
  if (lastFill?.completedAt && Date.now() - lastFill.completedAt < 120000) {
    const queue = (await chrome.runtime.sendMessage({ type: "VF_GET_QUEUE" })).queue ?? [];
    await loadQueueSelection();
    pruneQueueSelection(queue);
    const nextEntry = getSelectedQueueEntries(queue)[0] ?? null;
    if (lastFill.ok) {
      showStatus(formatQueueDoneMessage(lastFill, nextEntry, batch));
      await showQueueDoneBanner(lastFill, false, nextEntry);
    } else {
      showStatus(lastFill.error || "Batch stopped.", "error");
      await showQueueDoneBanner(lastFill, true);
    }
  }
}

async function showQueueDoneBanner(res, isError = false, nextEntry = null) {
  const banner = $("#queueDoneBanner");
  if (!banner) return;
  banner.classList.remove("hidden");
  if (isError) {
    banner.textContent = res?.error || "Fill failed.";
    banner.className = "queue-done-banner error";
    return;
  }
  banner.textContent = formatQueueDoneMessage(res, nextEntry);
  banner.className = "queue-done-banner";
}

async function fillQueueSceneAt(idx) {
  const batch = (await chrome.runtime.sendMessage({ type: "VF_GET_QUEUE_BATCH" }))?.batch;
  if (batch?.running) {
    showStatus("Batch kaydour — stop it first or wait.", "error");
    return;
  }

  setBusy(true);
  showStatus("Filling scene in Google Flow…");
  try {
    const queueRes = await chrome.runtime.sendMessage({ type: "VF_GET_QUEUE" });
    const queue = queueRes?.queue ?? [];
    const doneId = queue[idx] ? queueItemId(queue[idx], idx) : null;

    const res = await chrome.runtime.sendMessage({
      type: "VF_FILL_QUEUE_AT",
      index: idx,
    });
    if (!res?.ok) {
      showStatus(res?.error || "Fill failed", "error");
      await showQueueDoneBanner(res, true);
      return;
    }

    if (doneId) queueSelectedIds.delete(doneId);
    if (res.queuedAt) queueSelectedIds.delete(String(res.queuedAt));
    await saveQueueSelection();

    const freshQueue = (await chrome.runtime.sendMessage({ type: "VF_GET_QUEUE" })).queue ?? [];
    pruneQueueSelection(freshQueue);
    const nextEntry = getSelectedQueueEntries(freshQueue)[0] ?? null;

    showStatus(formatQueueDoneMessage(res, nextEntry));
    await showQueueDoneBanner(res, false, nextEntry);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showStatus(msg, "error");
    await showQueueDoneBanner({ error: msg }, true);
  } finally {
    setBusy(false);
    void refreshQueue();
  }
}

async function startSelectedBatch() {
  const batch = (await chrome.runtime.sendMessage({ type: "VF_GET_QUEUE_BATCH" }))?.batch;
  if (batch?.running) {
    showStatus("Batch already running…");
    startQueueBatchPolling();
    return;
  }

  const queueRes = await chrome.runtime.sendMessage({ type: "VF_GET_QUEUE" });
  const queue = queueRes?.queue ?? [];
  pruneQueueSelection(queue);
  const selected = getSelectedQueueEntries(queue);
  if (!selected.length) {
    showStatus("Check at least one scene in the queue.", "error");
    return;
  }

  const res = await chrome.runtime.sendMessage({
    type: "VF_START_QUEUE_BATCH",
  });
  if (!res?.ok) {
    showStatus(res?.error || "Failed to start batch", "error");
    return;
  }

  showStatus(`Running ${res.count} scene(s) — auto-continuing in Google Flow…`);
  startQueueBatchPolling();
}

async function setAllQueueSelected(selectAll) {
  const queueRes = await chrome.runtime.sendMessage({ type: "VF_GET_QUEUE" });
  const queue = queueRes?.queue ?? [];
  if (selectAll) {
    queueSelectedIds = new Set(queue.map((q, idx) => queueItemId(q, idx)));
  } else {
    queueSelectedIds = new Set();
  }
  await saveQueueSelection();
  void refreshQueue();
}

async function toggleQueueItemSelection(id, checked) {
  if (checked) queueSelectedIds.add(id);
  else queueSelectedIds.delete(id);
  await saveQueueSelection();
}

async function refreshQueue() {
  await loadQueueSelection();
  const res = await chrome.runtime.sendMessage({ type: "VF_GET_QUEUE" });
  const queue = res?.queue ?? [];
  pruneQueueSelection(queue);
  await saveQueueSelection();

  const batchRes = await chrome.runtime.sendMessage({ type: "VF_GET_QUEUE_BATCH" });
  const batch = batchRes?.batch ?? { running: false };
  updateQueueBatchUi(batch);

  const selectedCount = getSelectedQueueEntries(queue).length;
  const batchLabel = batch.running ? ` · Running Scene ${batch.currentScene}` : "";
  $("#queueCount").textContent =
    queue.length > 0
      ? `Queue: ${queue.length} scene(s) · Selected: ${selectedCount}${batchLabel}`
      : "Queue: 0";

  const fillBtn = $("#btnFillSelected");
  if (fillBtn) fillBtn.disabled = batch.running || selectedCount === 0;

  if (!batch.running) {
    const lastFill = (await chrome.storage.local.get("vf_last_queue_fill")).vf_last_queue_fill;
    if (lastFill?.ok && queue.length > 0 && Date.now() - (lastFill.completedAt || 0) < 3600000) {
      const nextEntry = getSelectedQueueEntries(queue)[0] ?? null;
      await showQueueDoneBanner(lastFill, false, nextEntry);
    }
  }

  if (!queue.length) {
    $("#queueList").innerHTML = '<p class="muted">No scenes in queue.</p>';
    return;
  }

  $("#queueList").innerHTML = queue
    .map((q, idx) => {
      const id = queueItemId(q, idx);
      const checked = queueSelectedIds.has(id);
      return `
    <div class="queue-item${checked ? " selected" : ""}" data-id="${id}">
      <label class="queue-select" title="Select scene">
        <input type="checkbox" class="queue-check" value="${id}" ${checked ? "checked" : ""} />
      </label>
      <img src="${q.debutImageUrl}" alt="debut" />
      <img src="${q.finImageUrl}" alt="fin" />
      <div>
        <strong>Scene ${q.sceneNumber ?? "?"}</strong>
        <div class="prompt-preview">${escapeHtml((q.prompt || "").slice(0, 400))}</div>
      </div>
      <button type="button" class="btn secondary btn-queue-fill" data-idx="${idx}">Fill</button>
    </div>`;
    })
    .join("");

  document.querySelectorAll(".queue-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target.closest("label")) return;
      const cb = item.querySelector(".queue-check");
      if (!cb) return;
      cb.checked = !cb.checked;
      void toggleQueueItemSelection(item.dataset.id, cb.checked);
      void refreshQueue();
    });
  });

  document.querySelectorAll(".queue-check").forEach((cb) => {
    cb.addEventListener("change", () => {
      void toggleQueueItemSelection(cb.value, cb.checked);
      void refreshQueue();
    });
  });

  document.querySelectorAll(".btn-queue-fill").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      void fillQueueSceneAt(Number(btn.dataset.idx));
    });
  });
}

// ——— Editing tab ———

async function storedClipToState(clip) {
  const buffer = normalizeArrayBuffer(clip.buffer);
  if (!buffer) {
    return {
      id: clip.id,
      name: clip.name,
      order: clip.order,
      selected: clip.selected !== false,
      duration: 0,
      url: "",
      sourceUrl: clip.sourceUrl || "",
      byteLength: 0,
      mimeType: clip.mimeType || "video/mp4",
      valid: false,
      playError: "Missing video data",
      file: null,
    };
  }

  const mimeType = clip.mimeType || "video/mp4";
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const probe = await probeVideoUrl(url);

  return {
    id: clip.id,
    name: clip.name,
    order: clip.order,
    selected: clip.selected !== false,
    duration: probe.duration || clip.duration || 0,
    url,
    sourceUrl: clip.sourceUrl || "",
    byteLength: clip.byteLength || buffer.byteLength,
    mimeType,
    valid: probe.ok,
    playError: probe.error || "",
    file: null,
  };
}

async function loadEditClipsFromStore() {
  try {
    const stored = await loadEditClips();
    revokeEditClipUrls();
    state.editClips = [];
    for (const clip of stored.sort((a, b) => a.order - b.order)) {
      state.editClips.push(await storedClipToState(clip));
    }
    renderEditClips();
  } catch (e) {
    console.warn("[Video Flow] load edit clips", e);
  }
}

async function persistEditClipsToStore() {
  const clips = [];
  for (const c of state.editClips) {
    if (!c.url) continue;
    const res = await fetch(c.url);
    const blob = await res.blob();
    const buffer = normalizeArrayBuffer(await blob.arrayBuffer());
    if (!buffer) continue;
    clips.push({
      id: c.id,
      name: c.name,
      order: c.order,
      selected: c.selected,
      mimeType: blob.type || c.mimeType || "video/mp4",
      duration: c.duration || 0,
      buffer,
      sourceUrl: c.sourceUrl || "",
      byteLength: c.byteLength || buffer.byteLength,
    });
  }
  await saveEditClips(clips);
  await chrome.storage.local.set({ [EDIT_CLIPS_UPDATED_KEY]: Date.now() });
}

async function refetchEditClip(clipId) {
  const clip = state.editClips.find((c) => c.id === clipId);
  if (!clip?.sourceUrl) {
    showStatus("No source URL — re-select this clip on Google Flow.", "error");
    return;
  }

  showStatus("Re-importing clip from Flow…");
  setBusy(true);
  try {
    const res = await chrome.runtime.sendMessage({
      type: "VF_REFETCH_EDIT_CLIP",
      url: clip.sourceUrl,
    });
    if (!res?.ok) throw new Error(res?.error || "Re-import failed");

    if (clip.url) URL.revokeObjectURL(clip.url);
    const blob = new Blob([res.buffer], { type: res.mimeType || "video/mp4" });
    clip.url = URL.createObjectURL(blob);
    clip.mimeType = res.mimeType || "video/mp4";
    clip.byteLength = res.byteLength || res.buffer?.byteLength || 0;
    clip.sourceUrl = res.finalUrl || clip.sourceUrl;

    const probe = await probeVideoUrl(clip.url);
    clip.valid = probe.ok;
    clip.playError = probe.error || "";
    clip.duration = probe.duration || 0;

    await persistEditClipsToStore();
    renderEditClips();
    showStatus(probe.ok ? "Clip re-imported — press ▶ to verify." : probe.error || "Still not playable", probe.ok ? "ok" : "error");
  } catch (e) {
    showStatus(e instanceof Error ? e.message : String(e), "error");
  } finally {
    setBusy(false);
  }
}

function openEditPreview(clip) {
  if (!clip?.url || !clip.valid) {
    showStatus(clip?.playError || "This clip cannot be played.", "error");
    return;
  }
  const modal = $("#editPreviewModal");
  const video = $("#editPreviewVideo");
  const title = $("#editPreviewTitle");
  if (!modal || !video) return;
  if (title) title.textContent = clip.name;
  video.src = clip.url;
  video.currentTime = 0;
  modal.classList.remove("hidden");
  void video.play().catch(() => showStatus("Could not start playback.", "error"));
}

function closeEditPreview() {
  const modal = $("#editPreviewModal");
  const video = $("#editPreviewVideo");
  video?.pause();
  if (video) {
    video.removeAttribute("src");
    video.load();
  }
  modal?.classList.add("hidden");
}

function nextEditOrder() {
  const orders = state.editClips.map((c) => c.order);
  return orders.length ? Math.max(...orders) + 1 : 1;
}

function revokeEditClipUrls() {
  for (const clip of state.editClips) {
    if (clip.url) URL.revokeObjectURL(clip.url);
  }
}

function getSelectedEditClips() {
  return state.editClips.filter((c) => c.selected);
}

function renderEditTimeline() {
  const timeline = $("#editTimeline");
  if (!timeline) return;
  const selected = getSelectedEditClips().sort((a, b) => a.order - b.order);
  if (!selected.length) {
    timeline.textContent = "Timeline order will appear here.";
    timeline.className = "edit-timeline muted";
    return;
  }
  timeline.className = "edit-timeline";
  timeline.innerHTML = selected
    .map(
      (c) =>
        `<span class="edit-timeline-chip"><strong>#${c.order}</strong> ${escapeHtml(c.name)}</span>`
    )
    .join('<span class="edit-timeline-arrow">→</span>');
}

function renderEditClips() {
  const list = $("#editClipList");
  const summary = $("#editSummary");
  const combineBtn = $("#btnCombineClips");
  if (!list) return;

  const selectedCount = getSelectedEditClips().length;
  if (summary) {
    summary.textContent =
      state.editClips.length > 0
        ? `${state.editClips.length} clip(s) · ${selectedCount} selected for combine`
        : "0 clips";
  }
  if (combineBtn) combineBtn.disabled = selectedCount < 1;

  renderEditTimeline();

  if (!state.editClips.length) {
    list.innerHTML =
      '<p class="muted">No clips yet — on Google Flow, check videos on the grid and click <strong>Send to Editing</strong>.</p>';
    return;
  }

  list.innerHTML = state.editClips
    .map((clip) => {
      const selected = clip.selected ? " selected" : "";
      const validClass = clip.valid ? "valid" : "invalid";
      const statusText = clip.valid
        ? "Ready to play"
        : escapeHtml(clip.playError || "Cannot play");
      const sizeText = clip.byteLength ? formatByteSize(clip.byteLength) : "";
      const durText = clip.duration ? `${clip.duration.toFixed(1)}s` : "";
      const metaExtra = [sizeText, durText].filter(Boolean).join(" · ");
      return `
    <div class="edit-clip-item${selected} ${validClass}" data-id="${clip.id}">
      <label class="edit-select" title="Include in combine">
        <input type="checkbox" class="edit-check" ${clip.selected ? "checked" : ""} />
      </label>
      <div class="edit-order-box">
        <span class="edit-order-label">#</span>
        <input type="number" class="edit-order-input" min="1" max="99" value="${clip.order}" />
      </div>
      <div class="edit-thumb-wrap">
        <video class="edit-thumb" src="${clip.url || ""}" muted playsinline preload="metadata"></video>
        <button type="button" class="btn-edit-play" title="Play preview" ${clip.valid ? "" : "disabled"}>▶</button>
      </div>
      <div class="edit-meta">
        <strong>${escapeHtml(clip.name)}</strong>
        <span class="edit-status ${clip.valid ? "ok" : "bad"}">${statusText}</span>
        ${metaExtra ? `<span class="muted">${metaExtra}</span>` : ""}
      </div>
      <div class="edit-actions">
        <button type="button" class="btn ghost sm btn-edit-refetch" data-id="${clip.id}" ${clip.sourceUrl ? "" : "disabled"}>Re-import</button>
        <button type="button" class="btn ghost sm btn-edit-remove" data-id="${clip.id}">Remove</button>
      </div>
    </div>`;
    })
    .join("");

  list.querySelectorAll(".edit-clip-item").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (
        e.target.closest("button") ||
        e.target.closest("input") ||
        e.target.closest("video")
      ) {
        return;
      }
      const id = row.dataset.id;
      const clip = state.editClips.find((c) => c.id === id);
      if (!clip) return;
      clip.selected = !clip.selected;
      renderEditClips();
    });
  });

  list.querySelectorAll(".btn-edit-play").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.closest(".edit-clip-item")?.dataset.id;
      const clip = state.editClips.find((c) => c.id === id);
      if (clip) openEditPreview(clip);
    });
  });

  list.querySelectorAll(".btn-edit-refetch").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      void refetchEditClip(btn.dataset.id);
    });
  });

  list.querySelectorAll(".edit-check").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = cb.closest(".edit-clip-item")?.dataset.id;
      const clip = state.editClips.find((c) => c.id === id);
      if (!clip) return;
      clip.selected = cb.checked;
      renderEditClips();
    });
  });

  list.querySelectorAll(".edit-order-input").forEach((input) => {
    input.addEventListener("change", () => {
      const id = input.closest(".edit-clip-item")?.dataset.id;
      const clip = state.editClips.find((c) => c.id === id);
      if (!clip) return;
      clip.order = Math.max(1, Number(input.value) || 1);
      input.value = String(clip.order);
      renderEditClips();
    });
  });

  list.querySelectorAll(".btn-edit-remove").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const idx = state.editClips.findIndex((c) => c.id === id);
      if (idx < 0) return;
      URL.revokeObjectURL(state.editClips[idx].url);
      state.editClips.splice(idx, 1);
      renderEditClips();
      void persistEditClipsToStore();
    });
  });
}

async function addEditClips(files) {
  const arr = [...files].filter((f) => f.type.startsWith("video/"));
  if (!arr.length) {
    showStatus("No video files found.", "error");
    return;
  }

  let order = nextEditOrder();
  for (const file of arr) {
    const guessed = guessClipOrder(file.name);
    const url = URL.createObjectURL(file);
    let duration = 0;
    try {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.src = url;
      await new Promise((res, rej) => {
        video.onloadedmetadata = () => res();
        video.onerror = () => rej();
      });
      duration = video.duration || 0;
    } catch {
      /* ignore */
    }

    state.editClips.push({
      id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file,
      name: file.name,
      url,
      order: guessed ?? order++,
      selected: true,
      duration,
      sourceUrl: "",
      byteLength: file.size,
      mimeType: file.type || "video/mp4",
      valid: false,
      playError: "",
    });
    if (guessed != null) order = Math.max(order, guessed + 1);
  }

  for (const clip of state.editClips.slice(-arr.length)) {
    const probe = await probeVideoUrl(clip.url);
    clip.valid = probe.ok;
    clip.playError = probe.error || "";
    clip.duration = probe.duration || clip.duration;
  }

  renderEditClips();
  showStatus(`${arr.length} clip(s) added — set order # then Combine.`);
  void persistEditClipsToStore();
}

async function onCombineEditClips() {
  const selected = getSelectedEditClips();
  if (!selected.length) {
    showStatus("Select at least one clip.", "error");
    return;
  }

  const broken = selected.filter((c) => !c.valid);
  if (broken.length) {
    showStatus(
      `${broken.length} selected clip(s) cannot play — use ▶ to test or Re-import.`,
      "error"
    );
    return;
  }

  const progress = $("#editProgress");
  if (progress) {
    progress.classList.remove("hidden");
    progress.textContent = "Preparing combine…";
  }
  setBusy(true);

  try {
    const result = await combineVideoClips(
      selected.map((c) => ({ url: c.url, order: c.order })),
      {
        onProgress: (msg) => {
          if (progress) progress.textContent = msg;
          showStatus(msg);
        },
      }
    );

    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    downloadBlob(result.blob, `video-flow-combined-${stamp}.${result.ext}`);
    showStatus(`Combined ${result.clipCount} clip(s) — download started.`);
    if (progress) progress.textContent = `Done — saved as .${result.ext}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showStatus(msg, "error");
    if (progress) progress.textContent = msg;
  } finally {
    setBusy(false);
  }
}

function setAllEditSelected(selectAll) {
  for (const clip of state.editClips) clip.selected = selectAll;
  renderEditClips();
}

async function showPickerOnFlowTab() {
  const tabs = await chrome.tabs.query({ url: "https://labs.google/*" });
  const flowTab = tabs.find((t) => t.url && /\/tools\/flow/i.test(t.url));
  if (!flowTab?.id) {
    showStatus("Open Google Flow in a tab first.", "error");
    chrome.tabs.create({ url: "https://labs.google/fx/tools/flow", active: true });
    return;
  }

  let ready = false;
  try {
    const pong = await chrome.tabs.sendMessage(flowTab.id, { type: "VF_PING" });
    ready = !!pong?.ok;
  } catch {
    ready = false;
  }

  if (!ready) {
    await chrome.scripting.executeScript({
      target: { tabId: flowTab.id },
      files: ["flow-dom.js", "flow-edit-picker.js", "content-flow.js"],
    });
    await chrome.scripting.insertCSS({
      target: { tabId: flowTab.id },
      files: ["flow-edit-picker.css"],
    });
  }

  await chrome.tabs.sendMessage(flowTab.id, { type: "VF_BOOT_EDIT_PICKER" });
  await chrome.tabs.update(flowTab.id, { active: true });
  showStatus(ready ? "Picker refreshed on Google Flow." : "Picker injected on Google Flow.");
}

function clearAllEditClips() {
  revokeEditClipUrls();
  state.editClips = [];
  renderEditClips();
  $("#editProgress")?.classList.add("hidden");
  void clearEditClips();
}

// ——— Tabs ———

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
  $(`#tab-${name}`).classList.remove("hidden");
  if (name === "queue") void refreshQueue();
  if (name === "editing") void loadEditClipsFromStore();
  if (name === "admin") void renderAdminTab();
}

// ——— Init ———

function bindUi() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });

  $("#videoInput").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    state.videoFile = file;
    state.videoName = file.name;
    if (state.videoObjectUrl) URL.revokeObjectURL(state.videoObjectUrl);
    state.videoObjectUrl = URL.createObjectURL(file);
    const vid = $("#videoPreview");
    vid.src = state.videoObjectUrl;
    vid.classList.remove("hidden");
    $("#videoLabel").textContent = file.name;
  });

  $("#extractMode").addEventListener("change", (e) => {
    state.extractMode = e.target.value;
  });
  $("#frameCount").addEventListener("input", (e) => {
    state.frameCount = Number(e.target.value) || 24;
  });
  $("#intervalSec").addEventListener("input", (e) => {
    state.intervalSec = Number(e.target.value) || 1;
  });
  $("#sceneCount").addEventListener("input", (e) => {
    state.sceneCount = clampCloneSceneCount(Number(e.target.value) || 6, state.frames.length || 120);
    e.target.value = String(state.sceneCount);
  });

  $("#autoPipeline")?.addEventListener("change", async (e) => {
    state.autoPipeline = e.target.checked;
    await setFlowSettings({ autoPipeline: state.autoPipeline });
    renderPipelineBoard();
  });

  $("#btnExtract").addEventListener("click", () => void onExtract());
  $("#btnAutoBoundaries").addEventListener("click", () => {
    state.boundaryIndices = autoSceneBoundaries(
      state.frames.length,
      clampCloneSceneCount(state.sceneCount, state.frames.length)
    );
    renderFrames();
  });
  $("#btnConfirmScenes").addEventListener("click", onConfirmScenes);
  $("#btnAnalyzeAll").addEventListener("click", () => void onAnalyzeAll());
  $("#btnGeneratePrompts").addEventListener("click", () => void onGeneratePrompts());
  $("#btnQueueAllFlow").addEventListener("click", () => void onQueueAllFlow());

  $("#btnFillSelected").addEventListener("click", () => void startSelectedBatch());
  $("#btnStopQueueBatch").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "VF_STOP_QUEUE_BATCH" });
    showStatus("Stopping after current scene…");
    stopQueueBatchPolling();
    void syncQueueBatchUi();
  });
  $("#btnQueueSelectAll").addEventListener("click", () => void setAllQueueSelected(true));
  $("#btnQueueSelectNone").addEventListener("click", () => void setAllQueueSelected(false));
  $("#btnClearQueue").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "VF_CLEAR_QUEUE" });
    queueSelectedIds = new Set();
    await saveQueueSelection();
    $("#queueDoneBanner")?.classList.add("hidden");
    void refreshQueue();
  });

  $("#editVideoInput").addEventListener("change", (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    void addEditClips(files);
    e.target.value = "";
  });
  $("#btnEditSelectAll").addEventListener("click", () => setAllEditSelected(true));
  $("#btnEditSelectNone").addEventListener("click", () => setAllEditSelected(false));
  $("#btnEditClearClips").addEventListener("click", () => clearAllEditClips());
  $("#btnEditRefreshFromFlow")?.addEventListener("click", () => void loadEditClipsFromStore());
  $("#btnEditShowPicker")?.addEventListener("click", () => void showPickerOnFlowTab());
  $("#btnCombineClips").addEventListener("click", () => void onCombineEditClips());
  $("#editPreviewClose")?.addEventListener("click", () => closeEditPreview());
  $("#editPreviewModal")?.addEventListener("click", (e) => {
    if (e.target.id === "editPreviewModal") closeEditPreview();
  });

  $("#btnOpenFlow").addEventListener("click", () => {
    chrome.tabs.create({ url: "https://labs.google/fx/tools/flow", active: true });
  });

  $("#btnSaveSettings").addEventListener("click", async () => {
    await setApiBase($("#appBaseUrl").value);
    const url = $("#supabaseUrl").value.trim();
    const anonKey = $("#supabaseAnonKey").value.trim();
    if (url || anonKey) {
      const current = await getSupabaseConfig();
      await setSupabaseConfig(url || current.url, anonKey || current.anonKey);
    }
    await setFlowSettings({
      autoRun: $("#flowAutoRun").checked,
      autoPipeline: $("#autoPipeline")?.checked !== false,
      aspectRatio: $("#flowAspect").value,
      model: $("#flowModel").value,
      duration: $("#flowDuration").value,
      outputs: $("#flowOutputs").value,
      videoMode: $("#flowVideoMode").value,
    });
    $("#settingsStatus").textContent = "All settings saved.";
    void refreshAuthUi();
    void renderFlowSettingsSummary();
  });

  $("#btnSignIn").addEventListener("click", () => void onSignIn());

  $("#authPassword")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") void onSignIn();
  });

  async function onSignIn() {
    const errEl = $("#authError");
    errEl.classList.add("hidden");
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    if (!email || !password) {
      errEl.textContent = "Email and password required.";
      errEl.classList.remove("hidden");
      return;
    }
    $("#btnSignIn").disabled = true;
    try {
      await signIn(email, password);
      $("#authPassword").value = "";
      await refreshAuthUi();
    } catch (e) {
      errEl.textContent = e instanceof Error ? e.message : String(e);
      errEl.classList.remove("hidden");
    } finally {
      $("#btnSignIn").disabled = false;
    }
  }

  $("#btnSignOut").addEventListener("click", async () => {
    await signOut();
    await refreshAuthUi();
  });

  $("#btnSyncAuth").addEventListener("click", async () => {
    const tabs = await chrome.tabs.query({});
    const appTab = tabs.find(
      (t) =>
        t.url &&
        (t.url.includes("localhost") ||
          t.url.includes("127.0.0.1") ||
          t.url.includes("vercel.app"))
    );
    if (!appTab?.id) {
      const errEl = $("#authError");
      errEl.textContent = "Open Video Flow in a browser tab first, then try again.";
      errEl.classList.remove("hidden");
      return;
    }
    try {
      await chrome.tabs.sendMessage(appTab.id, { type: "VF_PUSH_AUTH" });
    } catch {
      /* content script may not be loaded */
    }
    setTimeout(() => void refreshAuthUi(), 600);
  });

  $("#btnTestApi").addEventListener("click", async () => {
    $("#settingsStatus").textContent = "Testing…";
    try {
      await postAiJson("/api/ai/veo-scene-analyze", {
        debutImageUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=",
        finImageUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=",
        workflowMode: "clone",
      }, 15000);
      $("#settingsStatus").textContent = "API reachable (analyze endpoint responded).";
    } catch (e) {
      $("#settingsStatus").textContent = `Failed: ${e.message}`;
    }
  });
}

async function loadSettings() {
  const base = await getApiBase();
  $("#appBaseUrl").value = base;
  const overrides = await getSupabaseConfigOverrides();
  $("#supabaseUrl").value = overrides.url ?? "";
  $("#supabaseAnonKey").value = overrides.anonKey ?? "";
  const flow = await getFlowSettings();
  $("#flowAutoRun").checked = flow.autoRun !== false;
  $("#flowAspect").value = flow.aspectRatio ?? "9:16";
  $("#flowModel").value = flow.model ?? "Veo 3.1";
  $("#flowDuration").value = flow.duration ?? "8";
  $("#flowOutputs").value = flow.outputs ?? "1";
  $("#flowVideoMode").value = flow.videoMode ?? "Frames to Video";
  state.autoPipeline = flow.autoPipeline !== false;
  const autoEl = $("#autoPipeline");
  if (autoEl) autoEl.checked = state.autoPipeline;
  await renderFlowSettingsSummary();
}

async function init() {
  bindUi();
  await loadSettings();
  await loadDraft();
  await refreshAuthUi();
  renderStepNav();
  if (!state.frames.length) goStep(1, { skipPersist: true });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (
      area === "local" &&
      (changes.vf_flow_queue ||
        changes.vf_last_queue_fill ||
        changes[QUEUE_SELECTION_KEY] ||
        changes.vf_queue_batch)
    ) {
      void refreshQueue();
      if (changes.vf_queue_batch) void syncQueueBatchUi();
    }
    if (area === "local" && changes.vf_supabase_session) void refreshAuthUi();
    if (area === "local" && changes[EDIT_CLIPS_UPDATED_KEY]) {
      const editingTab = document.querySelector('.tab[data-tab="editing"]');
      if (editingTab?.classList.contains("active")) {
        void loadEditClipsFromStore();
        showStatus("Clips imported from Google Flow.");
      }
    }
    if (area === "local" && changes[DRAFT_META_KEY] && state.analyzeJobRunning) {
      void syncMetaFromStorage();
    }
  });

  const jobStatus = await chrome.runtime.sendMessage({ type: "VF_GET_ANALYZE_STATUS" });
  if (jobStatus?.running) {
    setBusy(true);
    startAnalyzePolling();
    showStatus("Analyze in progress…");
  } else {
    updateAnalyzeButton();
  }

  const batch = (await chrome.runtime.sendMessage({ type: "VF_GET_QUEUE_BATCH" }))?.batch;
  if (batch?.running) startQueueBatchPolling();

  window.addEventListener("beforeunload", () => {
    revokeEditClipUrls();
    void persistAll();
  });
}

void init();
