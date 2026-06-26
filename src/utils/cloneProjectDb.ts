import { supabase } from "../supabase";
import type { AiUsagePayload } from "./aiUsage";

export type StoredFrameMeta = {
  id: string;
  index: number;
  timeSec: number;
};

export type StoredCloneScene = {
  sceneNumber: number;
  debutIndex: number;
  finIndex: number;
  debutTimeSec: number;
  finTimeSec: number;
  debutUrl?: string;
  finUrl?: string;
  analysis?: string;
  scenePackage?: Record<string, unknown>;
  veoPrompt?: string;
  negativePrompt?: string;
  parseError?: string;
  rawPackageText?: string;
  usageAnalyze?: AiUsagePayload;
  usagePrompt?: AiUsagePayload;
  analyzeStatus: string;
  promptStatus: string;
  error?: string;
};

export type CloneProjectData = {
  extractMode: "count" | "interval";
  frameCount: string;
  intervalSec: string;
  sceneCount: string;
  boundaryIndices: number[];
  frameMeta: StoredFrameMeta[];
  scenes: StoredCloneScene[];
  /** Timelapse vs standard clone — affects vision + Veo prompts. */
  contentStyle?: "standard" | "timelapse";
};

export type CloneProject = {
  id: string;
  name: string;
  sourceVideoName: string | null;
  durationSec: number | null;
  status: string;
  step: number;
  data: CloneProjectData;
  totalCostUsd: number;
  createdAt: string;
  updatedAt: string;
};

function mapRow(row: Record<string, unknown>): CloneProject {
  const data = (row.data as CloneProjectData | null) ?? {
    extractMode: "count",
    frameCount: "24",
    intervalSec: "1",
    sceneCount: "6",
    boundaryIndices: [],
    frameMeta: [],
    scenes: [],
    contentStyle: "standard",
  };
  return {
    id: row.id as string,
    name: (row.name as string) ?? "Clone project",
    sourceVideoName: (row.source_video_name as string | null) ?? null,
    durationSec: row.duration_sec != null ? Number(row.duration_sec) : null,
    status: (row.status as string) ?? "draft",
    step: Number(row.step) || 1,
    data,
    totalCostUsd: Number(row.total_cost_usd) || 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function sumSceneUsage(scenes: StoredCloneScene[]): number {
  let total = 0;
  for (const s of scenes) {
    if (s.usageAnalyze) total += s.usageAnalyze.costUsd;
    if (s.usagePrompt) total += s.usagePrompt.costUsd;
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}

export async function fetchCloneProject(
  projectId: string,
  ownerId: string
): Promise<CloneProject | null> {
  const { data, error } = await supabase
    .from("clone_projects")
    .select("*")
    .eq("id", projectId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return mapRow(data as Record<string, unknown>);
}

export async function listCloneProjects(ownerId: string): Promise<CloneProject[]> {
  const { data, error } = await supabase
    .from("clone_projects")
    .select("*")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function createCloneProject(
  ownerId: string,
  payload: {
    name: string;
    sourceVideoName?: string;
    durationSec?: number;
    step?: number;
    status?: string;
    data: CloneProjectData;
  }
): Promise<CloneProject> {
  const totalCostUsd = sumSceneUsage(payload.data.scenes);
  const { data, error } = await supabase
    .from("clone_projects")
    .insert({
      owner_id: ownerId,
      name: payload.name,
      source_video_name: payload.sourceVideoName ?? null,
      duration_sec: payload.durationSec ?? null,
      step: payload.step ?? 1,
      status: payload.status ?? "draft",
      data: payload.data,
      total_cost_usd: totalCostUsd,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data as Record<string, unknown>);
}

export async function updateCloneProject(
  projectId: string,
  ownerId: string,
  payload: {
    name?: string;
    durationSec?: number;
    step?: number;
    status?: string;
    data?: CloneProjectData;
  }
): Promise<CloneProject> {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (payload.name != null) patch.name = payload.name;
  if (payload.durationSec != null) patch.duration_sec = payload.durationSec;
  if (payload.step != null) patch.step = payload.step;
  if (payload.status != null) patch.status = payload.status;
  if (payload.data != null) {
    patch.data = payload.data;
    patch.total_cost_usd = sumSceneUsage(payload.data.scenes);
  }
  const { data, error } = await supabase
    .from("clone_projects")
    .update(patch)
    .eq("id", projectId)
    .eq("owner_id", ownerId)
    .select("*")
    .single();
  if (error) throw error;
  return mapRow(data as Record<string, unknown>);
}

export async function deleteCloneProject(projectId: string, ownerId: string): Promise<void> {
  const { error } = await supabase
    .from("clone_projects")
    .delete()
    .eq("id", projectId)
    .eq("owner_id", ownerId);
  if (error) throw error;
}
