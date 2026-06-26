import { supabase } from "../supabase";
import type { FlowSceneExport } from "./flowPrompt";

export type FlowQueueRow = {
  id: string;
  owner_id: string;
  scene_number: number | null;
  debut_image_url: string;
  fin_image_url: string;
  prompt: string;
  clone_project_id: string | null;
  queued_at: number;
  created_at: string;
};

export async function listFlowQueue(ownerId: string): Promise<FlowQueueRow[]> {
  const { data, error } = await supabase
    .from("flow_queue")
    .select("*")
    .eq("owner_id", ownerId)
    .order("queued_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as FlowQueueRow[];
}

export async function addFlowQueueScenes(
  ownerId: string,
  scenes: FlowSceneExport[],
  cloneProjectId?: string | null
): Promise<number> {
  if (scenes.length === 0) return 0;
  const now = Date.now();
  const rows = scenes.map((s, i) => ({
    owner_id: ownerId,
    scene_number: s.sceneNumber,
    debut_image_url: s.debutImageUrl,
    fin_image_url: s.finImageUrl,
    prompt: s.prompt,
    clone_project_id: cloneProjectId ?? null,
    queued_at: now + i,
  }));
  const { error } = await supabase.from("flow_queue").insert(rows);
  if (error) throw error;
  return rows.length;
}

export async function clearFlowQueue(ownerId: string): Promise<void> {
  const { error } = await supabase.from("flow_queue").delete().eq("owner_id", ownerId);
  if (error) throw error;
}
