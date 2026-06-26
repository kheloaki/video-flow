import type { ExtractedFrame } from "./videoFrames";
import { getSceneFrames, subsampleSceneFrames } from "./videoFrames";
import { prepareSceneFrameImageUrls } from "./prepareVisionImageUrl";
import { buildCloneDebutFinPrompts, CLONE_VEO_SCENE_SECONDS } from "./buildCloneFullScript";
import type { CloneContentStyle } from "./cloneContentStyle";

export type CloneAnalyzeRequestBody = {
  debutImageUrl: string;
  finImageUrl: string;
  sceneFrameImageUrls: string[];
  sceneFrameTimesSec: number[];
  debutPrompt: string;
  finPrompt: string;
  workflowMode: "clone";
  sceneNumber: number;
  referenceDebutSec: number;
  referenceFinSec: number;
  veoOutputDurationSec: number;
  contentStyle?: CloneContentStyle;
};

/** Build analyze API body using every frame from scene debut → fin (subsampled if needed). */
export async function buildCloneAnalyzeRequest(
  scene: {
    sceneNumber: number;
    debut: ExtractedFrame;
    fin: ExtractedFrame;
  },
  allFrames: ExtractedFrame[],
  contentStyle: CloneContentStyle = "standard"
): Promise<CloneAnalyzeRequestBody> {
  const sceneFrames = subsampleSceneFrames(getSceneFrames(allFrames, scene.debut, scene.fin));
  const { debutPrompt, finPrompt } = buildCloneDebutFinPrompts(
    {
      sceneNumber: scene.sceneNumber,
      debut: scene.debut,
      fin: scene.fin,
      frameCount: sceneFrames.length,
    },
    contentStyle
  );
  const sceneFrameImageUrls = await prepareSceneFrameImageUrls(
    sceneFrames.map((f) => f.dataUrl),
    scene.sceneNumber
  );
  return {
    debutImageUrl: sceneFrameImageUrls[0],
    finImageUrl: sceneFrameImageUrls[sceneFrameImageUrls.length - 1],
    sceneFrameImageUrls,
    sceneFrameTimesSec: sceneFrames.map((f) => f.timeSec),
    debutPrompt,
    finPrompt,
    workflowMode: "clone",
    sceneNumber: scene.sceneNumber,
    referenceDebutSec: scene.debut.timeSec,
    referenceFinSec: scene.fin.timeSec,
    veoOutputDurationSec: CLONE_VEO_SCENE_SECONDS,
    contentStyle,
  };
}
