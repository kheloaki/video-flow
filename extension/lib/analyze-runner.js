import { loadFrames } from "./frame-store.js";
import { buildCloneDebutFinPrompts, CLONE_VEO_SCENE_SECONDS } from "./clone-prompts.js";
import { postAiJson, getApiBase } from "./api.js";
import { prepareVisionImageUrl } from "./images.js";
import { isAiUsagePayload, insertUsageLog } from "./usage-db.js";
import { CLONE_AI_CONCURRENCY, runWithConcurrency } from "./concurrency.js";

const DRAFT_META_KEY = "vf_draft_meta";
const ACTIVE_PROJECT_KEY = "vf_active_project_id";
const ANALYZE_JOB_KEY = "vf_analyze_job";

export async function getAnalyzeJobStatus() {
  const data = await chrome.storage.local.get(ANALYZE_JOB_KEY);
  return data[ANALYZE_JOB_KEY] ?? { running: false };
}

async function saveMeta(meta, projectId) {
  await chrome.storage.local.set({
    [DRAFT_META_KEY]: meta,
    [ACTIVE_PROJECT_KEY]: projectId,
  });
}

async function loadMeta(projectId) {
  const stored = await chrome.storage.local.get([DRAFT_META_KEY, ACTIVE_PROJECT_KEY]);
  if (stored[ACTIVE_PROJECT_KEY] !== projectId || !stored[DRAFT_META_KEY]) {
    throw new Error("Project meta ma-l9ach.");
  }
  return stored[DRAFT_META_KEY];
}

function sceneFromMeta(s, frameByIndex) {
  const debut = frameByIndex.get(s.debutIndex);
  const fin = frameByIndex.get(s.finIndex);
  if (!debut?.dataUrl || !fin?.dataUrl) {
    throw new Error(`Scene ${s.sceneNumber}: frames missing — reopen popup w extract.`);
  }
  return {
    sceneNumber: s.sceneNumber,
    debut: { index: s.debutIndex, timeSec: s.debutTimeSec, dataUrl: debut.dataUrl },
    fin: { index: s.finIndex, timeSec: s.finTimeSec, dataUrl: fin.dataUrl },
  };
}

async function setAnalyzeProgress(projectId, patch) {
  const current = await getAnalyzeJobStatus();
  await chrome.storage.local.set({
    [ANALYZE_JOB_KEY]: {
      ...current,
      running: true,
      projectId,
      ...patch,
    },
  });
}

async function analyzeSceneAtIndex(meta, index, frameByIndex, apiBase, projectId) {
  const job = await getAnalyzeJobStatus();
  if (!job.running) return;

  try {
    const s = sceneFromMeta(meta.scenes[index], frameByIndex);
    const { debutPrompt, finPrompt } = buildCloneDebutFinPrompts(s);
    const [debutImageUrl, finImageUrl] = await Promise.all([
      prepareVisionImageUrl(s.debut.dataUrl),
      prepareVisionImageUrl(s.fin.dataUrl),
    ]);
    const json = await postAiJson(
      "/api/ai/veo-scene-analyze",
      {
        debutImageUrl,
        finImageUrl,
        debutPrompt,
        finPrompt,
        workflowMode: "clone",
        sceneNumber: s.sceneNumber,
        referenceDebutSec: s.debut.timeSec,
        referenceFinSec: s.fin.timeSec,
        veoOutputDurationSec: CLONE_VEO_SCENE_SECONDS,
      },
      180_000,
      apiBase
    );
    meta.scenes[index] = {
      ...meta.scenes[index],
      analysis: typeof json.analysis === "string" ? json.analysis.trim() : "",
      analyzeStatus: "done",
      error: undefined,
      usageAnalyze: isAiUsagePayload(json.usage) ? json.usage : meta.scenes[index].usageAnalyze,
    };
    if (isAiUsagePayload(json.usage)) {
      try {
        await insertUsageLog(json.usage, `Clone analyze · scene ${s.sceneNumber}`, {
          projectType: "clone_extension",
          projectId: meta.dbProjectId ?? projectId,
        });
      } catch {
        /* usage log optional */
      }
    }
  } catch (e) {
    meta.scenes[index] = {
      ...meta.scenes[index],
      analyzeStatus: "error",
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/** Runs in background — all pending scenes analyze in parallel (survives popup close). */
export async function runAnalyzeJob(projectId) {
  const existing = await getAnalyzeJobStatus();
  if (existing.running) return;

  const startedAt = Date.now();
  await chrome.storage.local.set({
    [ANALYZE_JOB_KEY]: { running: true, projectId, startedAt, completed: 0, total: 0 },
  });

  let saveChain = Promise.resolve();
  const lockedSave = () => {
    saveChain = saveChain.then(() => saveMeta(meta, projectId));
    return saveChain;
  };

  let meta;

  try {
    const apiBase = await getApiBase();
    meta = await loadMeta(projectId);
    const frameRows = await loadFrames(projectId);
    const frameByIndex = new Map(frameRows.map((r) => [r.index, r]));

    if (!meta.scenes?.length) throw new Error("No scenes f analyze.");

    const pending = meta.scenes
      .map((stored, index) => ({ stored, index }))
      .filter(({ stored }) => !(stored.analyzeStatus === "done" && stored.analysis?.trim()));

    for (const { index } of pending) {
      meta.scenes[index] = { ...meta.scenes[index], analyzeStatus: "loading", error: undefined };
    }
    meta.step = 3;
    await saveMeta(meta, projectId);
    await setAnalyzeProgress(projectId, { completed: 0, total: pending.length, startedAt });

    let completed = 0;

    const tasks = pending.map(({ index }) => async () => {
      await analyzeSceneAtIndex(meta, index, frameByIndex, apiBase, projectId);
      completed += 1;
      if (meta.scenes.every((sc) => sc.analyzeStatus === "done")) meta.step = 4;
      await lockedSave();
      await setAnalyzeProgress(projectId, { completed, total: pending.length, startedAt });
    });

    await runWithConcurrency(tasks, CLONE_AI_CONCURRENCY);
  } finally {
    await saveChain;
    await chrome.storage.local.set({
      [ANALYZE_JOB_KEY]: {
        running: false,
        projectId,
        finishedAt: Date.now(),
        completed: meta?.scenes?.filter((s) => s.analyzeStatus === "done").length ?? 0,
        total: meta?.scenes?.length ?? 0,
      },
    });
  }
}

export async function stopAnalyzeJob() {
  await chrome.storage.local.set({
    [ANALYZE_JOB_KEY]: { running: false, stoppedAt: Date.now() },
  });
}
