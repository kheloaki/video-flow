export type CloneSceneScriptInput = {
  sceneNumber: number;
  debut: { index: number; timeSec: number };
  fin: { index: number; timeSec: number };
  analysis?: string;
};

export const CLONE_VEO_SCENE_SECONDS = 8;

export function buildCloneDebutFinPrompts(scene: CloneSceneScriptInput): {
  debutPrompt: string;
  finPrompt: string;
} {
  const sn = scene.sceneNumber;
  const refDelta = Math.max(0, scene.fin.timeSec - scene.debut.timeSec);
  const analysisBit = scene.analysis?.trim()
    ? `\nVision notes: ${scene.analysis.trim().slice(0, 1200)}`
    : "";
  return {
    debutPrompt: `CLONE SCENE ${sn} — START (debut) still. Frame #${scene.debut.index + 1} at ${scene.debut.timeSec.toFixed(2)}s (${refDelta.toFixed(2)}s before fin in reference). Describe everything visible; diff vs fin.${analysisBit}`,
    finPrompt: `CLONE SCENE ${sn} — END (fin) still. Frame #${scene.fin.index + 1} at ${scene.fin.timeSec.toFixed(2)}s. List every change vs debut; schedule each change in its own timed beat across ${CLONE_VEO_SCENE_SECONDS}s (not all at once).${analysisBit}`,
  };
}

/** Rich fullScript matching Video Flow density (script + SCENE METADATA JSON). */
export function buildCloneFullScript(
  scenes: CloneSceneScriptInput[],
  videoDurationSec: number
): string {
  const total = scenes.length;
  const scenesMeta = scenes.map((s) => {
    const { debutPrompt, finPrompt } = buildCloneDebutFinPrompts(s);
    const startSec = (s.sceneNumber - 1) * CLONE_VEO_SCENE_SECONDS;
    const endSec = s.sceneNumber * CLONE_VEO_SCENE_SECONDS;
    return {
      scene_number: s.sceneNumber,
      scene_title: `Clone beat ${s.sceneNumber}`,
      duration_seconds: CLONE_VEO_SCENE_SECONDS,
      timecode: `${startSec}–${endSec}s`,
      reference_debut_sec: s.debut.timeSec,
      reference_fin_sec: s.fin.timeSec,
      debut: {
        prompt: debutPrompt,
        use_model_ref: true,
        use_product_ref: true,
        use_background_ref: true,
      },
      fin: {
        prompt: finPrompt,
        use_model_ref: true,
        use_product_ref: true,
        use_background_ref: true,
      },
      vision_analysis: s.analysis ?? "",
    };
  });

  const narrative = scenes
    .map((s) => {
      const startSec = (s.sceneNumber - 1) * CLONE_VEO_SCENE_SECONDS;
      const endSec = s.sceneNumber * CLONE_VEO_SCENE_SECONDS;
      const refDelta = Math.max(0, s.fin.timeSec - s.debut.timeSec);
      return `**المشهد ${s.sceneNumber} (Scene ${s.sceneNumber}) - من ${startSec} إلى ${endSec} ثانية**
[شنو تبيني فالفيديو]: Ultra-realistic vertical clone. Recreate reference motion from still A (t=${s.debut.timeSec.toFixed(2)}s) to still B (t=${s.fin.timeSec.toFixed(2)}s, ${refDelta.toFixed(1)}s apart in source). Follow TIMED ACTION SPLIT from vision analysis — stagger each change across ${CLONE_VEO_SCENE_SECONDS}s, never all at once.
[النص الصوتي - Voice Script]: (infer only if reference clearly shows speaking; otherwise silent/natural ambience)
---
Vision continuity (debut → fin):
${s.analysis?.trim() || "(see image analysis for this scene)"}`;
    })
    .join("\n\n");

  return `📝 CLONE VIDEO — Reference reproduction (Moroccan UGC TikTok / Reels)
المنتج: Reference video clone (same talent, room, product if visible)
المدة المتوقعة: ${total * CLONE_VEO_SCENE_SECONDS} ثانية (${total} مشهد، كل مشهد ${CLONE_VEO_SCENE_SECONDS} ثواني)
Platform: TikTok / Instagram Reels
Format: vertical 9:16
Generation model: Google Veo 3.1
Source reference duration: ~${videoDurationSec.toFixed(1)}s
Total clone scenes: ${total}

🎬 السكريبت الصوتي والتعليمات البصرية (clone reference):
CRITICAL: Each scene is EXACTLY ${CLONE_VEO_SCENE_SECONDS} seconds. Follow TIMED ACTION SPLIT from vision analysis — each change gets its own beat; motion must interpolate debut → fin without dumping all changes at once.

${narrative}

--- SCENE METADATA ---
${JSON.stringify(scenesMeta, null, 2)}`;
}
