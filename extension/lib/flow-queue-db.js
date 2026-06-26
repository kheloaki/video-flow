import { getSupabaseConfig, getValidSession } from "./auth.js";

async function rest(path, options = {}) {
  const config = await getSupabaseConfig();
  const session = await getValidSession();
  if (!config.url || !config.anonKey) return null;
  if (!session?.accessToken) return null;

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

function rowToQueueItem(row) {
  return {
    id: row.id,
    sceneNumber: row.scene_number ?? 0,
    debutImageUrl: row.debut_image_url,
    finImageUrl: row.fin_image_url,
    prompt: row.prompt,
    queuedAt: Number(row.queued_at) || Date.parse(row.created_at),
    cloneProjectId: row.clone_project_id ?? undefined,
  };
}

/** @returns {Promise<Array<object>|null>} null when not signed in */
export async function fetchFlowQueueItems() {
  const session = await getValidSession();
  if (!session?.userId) return null;
  const rows = await rest(
    `/flow_queue?owner_id=eq.${session.userId}&order=queued_at.asc&select=*`,
    { method: "GET" }
  );
  return (rows ?? []).map(rowToQueueItem);
}

export async function syncFlowQueueItems(items) {
  const session = await getValidSession();
  if (!session?.userId) return false;

  await rest(`/flow_queue?owner_id=eq.${session.userId}`, {
    method: "DELETE",
    prefer: "return=minimal",
  });

  if (!items.length) return true;

  const rows = items.map((item, i) => ({
    owner_id: session.userId,
    scene_number: item.sceneNumber ?? null,
    debut_image_url: item.debutImageUrl,
    fin_image_url: item.finImageUrl,
    prompt: item.prompt,
    clone_project_id: item.cloneProjectId ?? null,
    queued_at: item.queuedAt ?? Date.now() + i,
  }));

  await rest("/flow_queue", {
    method: "POST",
    body: JSON.stringify(rows),
    prefer: "return=minimal",
  });
  return true;
}

export async function appendFlowQueueItem(item) {
  const session = await getValidSession();
  if (!session?.userId) return false;
  await rest("/flow_queue", {
    method: "POST",
    body: JSON.stringify([
      {
        owner_id: session.userId,
        scene_number: item.sceneNumber ?? null,
        debut_image_url: item.debutImageUrl,
        fin_image_url: item.finImageUrl,
        prompt: item.prompt,
        clone_project_id: item.cloneProjectId ?? null,
        queued_at: item.queuedAt ?? Date.now(),
      },
    ]),
    prefer: "return=minimal",
  });
  return true;
}

export async function clearFlowQueueDb() {
  const session = await getValidSession();
  if (!session?.userId) return false;
  await rest(`/flow_queue?owner_id=eq.${session.userId}`, {
    method: "DELETE",
    prefer: "return=minimal",
  });
  return true;
}
