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
