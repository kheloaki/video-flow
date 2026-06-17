/**
 * Build Google Flow prompt text — full JSON package (same as web app displayPkg).
 */

/**
 * @param {{
 *   sceneNumber: number;
 *   scenePackage?: Record<string, unknown> | null;
 *   analysis?: string;
 *   veoPrompt?: string;
 *   negativePrompt?: string;
 * }} scene
 */
export function buildFlowPromptJson(scene) {
  const displayPkg = {
    ...(scene.scenePackage && typeof scene.scenePackage === "object" ? scene.scenePackage : {}),
    sceneNumber: scene.sceneNumber,
    _imageAnalysis: scene.analysis ?? "",
  };

  if (!scene.scenePackage) {
    if (scene.veoPrompt) displayPkg.veoPrompt = scene.veoPrompt;
    if (scene.negativePrompt) displayPkg.negativePrompt = scene.negativePrompt;
  }

  return JSON.stringify(displayPkg, null, 2);
}

/**
 * @param {{
 *   sceneNumber: number;
 *   debut?: { dataUrl?: string };
 *   fin?: { dataUrl?: string };
 *   debutImageUrl?: string;
 *   finImageUrl?: string;
 *   scenePackage?: Record<string, unknown> | null;
 *   analysis?: string;
 *   veoPrompt?: string;
 *   negativePrompt?: string;
 * }} scene
 */
export function buildFlowScenePayload(scene) {
  return {
    sceneNumber: scene.sceneNumber,
    debutImageUrl: scene.debut?.dataUrl ?? scene.debutImageUrl ?? "",
    finImageUrl: scene.fin?.dataUrl ?? scene.finImageUrl ?? "",
    prompt: buildFlowPromptJson(scene),
  };
}

/** @param {{ prompt?: string; scenePackage?: unknown; veoPrompt?: string }} q */
export function queueItemHasFlowPrompt(q) {
  if (q?.prompt?.trim()) return true;
  if (q?.scenePackage && typeof q.scenePackage === "object") return true;
  return Boolean(q?.veoPrompt?.trim());
}
