import { getSceneFrames, subsampleSceneFrames } from "./video-frames.js";
import { prepareSceneFrameImageUrls } from "./images.js";
import { buildCloneDebutFinPrompts, CLONE_VEO_SCENE_SECONDS } from "./clone-prompts.js";

export async function buildCloneAnalyzeRequest(scene, allFrames, contentStyle = "standard") {
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

/** Build scene + all frames from stored meta indices. */
export function sceneWithFramesFromMeta(stored, frameByIndex, allFrames) {
  const debut = frameByIndex.get(stored.debutIndex);
  const fin = frameByIndex.get(stored.finIndex);
  if (!debut?.dataUrl || !fin?.dataUrl) {
    throw new Error(`Scene ${stored.sceneNumber}: frames missing — reopen popup w extract.`);
  }
  const scene = {
    sceneNumber: stored.sceneNumber,
    debut: { index: stored.debutIndex, timeSec: stored.debutTimeSec ?? debut.timeSec, dataUrl: debut.dataUrl },
    fin: { index: stored.finIndex, timeSec: stored.finTimeSec ?? fin.timeSec, dataUrl: fin.dataUrl },
  };
  return { scene, allFrames: allFrames ?? [...frameByIndex.values()].sort((a, b) => a.index - b.index) };
}
