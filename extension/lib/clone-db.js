import { getSupabaseConfig, getValidSession } from "./auth.js";

async function rest(path, options = {}) {
  const config = await getSupabaseConfig();
  const session = await getValidSession();
  if (!config.url || !config.anonKey) {
    throw new Error("Supabase not configured.");
  }
  if (!session?.accessToken) {
    throw new Error("Sign in from Settings (email/password) or sync from the web app.");
  }
  const url = `${config.url}/rest/v1${path}`;
  const headers = {
    apikey: config.anonKey,
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
    Prefer: options.prefer ?? "return=representation",
    ...options.headers,
  };
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function mapRow(row) {
  const data = row.data ?? {
    extractMode: "count",
    frameCount: "24",
    intervalSec: "1",
    sceneCount: "6",
    boundaryIndices: [],
    frameMeta: [],
    scenes: [],
  };
  return {
    id: row.id,
    name: row.name ?? "Clone project",
    sourceVideoName: row.source_video_name,
    durationSec: row.duration_sec != null ? Number(row.duration_sec) : null,
    status: row.status ?? "draft",
    step: Number(row.step) || 1,
    data,
    totalCostUsd: Number(row.total_cost_usd) || 0,
    updatedAt: row.updated_at,
  };
}

function sumSceneUsage(scenes) {
  let total = 0;
  for (const s of scenes) {
    if (s.usageAnalyze?.costUsd) total += s.usageAnalyze.costUsd;
    if (s.usagePrompt?.costUsd) total += s.usagePrompt.costUsd;
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}

export async function listCloneProjects() {
  const session = await getValidSession();
  const rows = await rest(
    `/clone_projects?owner_id=eq.${session.userId}&order=updated_at.desc&limit=30`,
    { method: "GET" }
  );
  return (rows ?? []).map(mapRow);
}

export async function fetchCloneProject(projectId) {
  const session = await getValidSession();
  const rows = await rest(
    `/clone_projects?id=eq.${projectId}&owner_id=eq.${session.userId}&limit=1`,
    { method: "GET" }
  );
  return rows?.[0] ? mapRow(rows[0]) : null;
}

export async function createCloneProject(payload) {
  const session = await getValidSession();
  const body = {
    owner_id: session.userId,
    name: payload.name,
    source_video_name: payload.sourceVideoName ?? null,
    duration_sec: payload.durationSec ?? null,
    step: payload.step ?? 1,
    status: payload.status ?? "draft",
    data: payload.data,
    total_cost_usd: sumSceneUsage(payload.data.scenes ?? []),
    updated_at: new Date().toISOString(),
  };
  const rows = await rest("/clone_projects", {
    method: "POST",
    body: JSON.stringify(body),
    prefer: "return=representation",
  });
  return mapRow(Array.isArray(rows) ? rows[0] : rows);
}

export async function updateCloneProject(projectId, payload) {
  const session = await getValidSession();
  const patch = { updated_at: new Date().toISOString() };
  if (payload.name != null) patch.name = payload.name;
  if (payload.durationSec != null) patch.duration_sec = payload.durationSec;
  if (payload.step != null) patch.step = payload.step;
  if (payload.status != null) patch.status = payload.status;
  if (payload.data != null) {
    patch.data = payload.data;
    patch.total_cost_usd = sumSceneUsage(payload.data.scenes ?? []);
  }
  const rows = await rest(
    `/clone_projects?id=eq.${projectId}&owner_id=eq.${session.userId}`,
    { method: "PATCH", body: JSON.stringify(patch), prefer: "return=representation" }
  );
  return mapRow(Array.isArray(rows) ? rows[0] : rows);
}
