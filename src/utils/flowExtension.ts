export type FlowSceneExport = {
  sceneNumber: number;
  debutImageUrl: string;
  finImageUrl: string;
  prompt: string;
};

export type FlowScenePromptInput = {
  scenePackage?: Record<string, unknown> | null;
  analysis?: string;
  veoPrompt?: string;
  negativePrompt?: string;
};

/** Same JSON as web app “full package” block (displayPkg). */
export function buildFlowPromptJson(
  sceneNumber: number,
  input: FlowScenePromptInput
): string {
  const displayPkg: Record<string, unknown> = {
    ...(input.scenePackage ?? {}),
    sceneNumber,
    _imageAnalysis: input.analysis ?? "",
  };
  if (!input.scenePackage) {
    if (input.veoPrompt) displayPkg.veoPrompt = input.veoPrompt;
    if (input.negativePrompt) displayPkg.negativePrompt = input.negativePrompt;
  }
  return JSON.stringify(displayPkg, null, 2);
}

type ExtReply = {
  ok: boolean;
  error?: string;
  queueLength?: number;
  remaining?: number;
  sceneNumber?: number;
};

const APP_SOURCE = "video-flow-app";
const EXT_SOURCE = "video-flow-extension";

function postToExtension<T extends ExtReply>(
  type: string,
  payload?: unknown,
  timeoutMs = 4000
): Promise<T> {
  return new Promise((resolve) => {
    const requestId = `vf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const onReply = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== EXT_SOURCE || data.requestId !== requestId) return;
      window.removeEventListener("message", onReply);
      resolve(data as T);
    };
    window.addEventListener("message", onReply);
    window.postMessage({ source: APP_SOURCE, type, requestId, payload }, "*");
    window.setTimeout(() => {
      window.removeEventListener("message", onReply);
      resolve({
        ok: false,
        error:
          "Extension ma-jawbatche. Installi extension mn dossier extension/ w reloadi l-page.",
      } as T);
    }, timeoutMs);
  });
}

export function isFlowExtensionMarked(): boolean {
  return !!(window as unknown as { __VIDEO_FLOW_EXT__?: boolean }).__VIDEO_FLOW_EXT__;
}

export async function pingFlowExtension(): Promise<boolean> {
  const res = await postToExtension<ExtReply>("VF_PING", undefined, 2000);
  return res.ok === true;
}

export async function queueSceneForGoogleFlow(
  scene: FlowSceneExport
): Promise<ExtReply> {
  return postToExtension("VF_QUEUE_SCENE", scene);
}

export async function fillSceneInGoogleFlowNow(
  scene: FlowSceneExport
): Promise<ExtReply> {
  return postToExtension("VF_FILL_SCENE_NOW", scene, 30_000);
}

export async function queueAllScenesForGoogleFlow(
  scenes: FlowSceneExport[]
): Promise<ExtReply> {
  let last: ExtReply = { ok: true, queueLength: 0 };
  for (const scene of scenes) {
    last = await postToExtension("VF_QUEUE_SCENE", scene);
    if (!last.ok) return last;
  }
  return { ok: true, queueLength: last.queueLength };
}

export function toFlowSceneExport(
  sceneNumber: number,
  debutImageUrl: string,
  finImageUrl: string,
  promptInput: FlowScenePromptInput | string
): FlowSceneExport {
  const prompt =
    typeof promptInput === "string"
      ? promptInput
      : buildFlowPromptJson(sceneNumber, promptInput);
  return { sceneNumber, debutImageUrl, finImageUrl, prompt };
}
