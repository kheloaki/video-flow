export type CloneSceneScriptInput = {
  sceneNumber: number;
  debut: { index: number; timeSec: number };
  fin: { index: number; timeSec: number };
  analysis?: string;
  /** Total reference frames in this scene (debut → fin inclusive). */
  frameCount?: number;
};

export const CLONE_VEO_SCENE_SECONDS = 8;

/** Clone Veo packages: ambient/source audio only — no scripted dialogue. */
export const CLONE_LANGUAGE_LABEL = "ambient source audio only (no spoken dialogue)";

export function buildCloneDebutFinPrompts(scene: CloneSceneScriptInput): {
  debutPrompt: string;
  finPrompt: string;
} {
  const sn = scene.sceneNumber;
  const refDelta = Math.max(0, scene.fin.timeSec - scene.debut.timeSec);
  const frameCount = scene.frameCount ?? 2;
  const frameRange =
    frameCount > 2
      ? ` Scene spans ${frameCount} reference frames (#${scene.debut.index + 1} debut → #${scene.fin.index + 1} fin). Describe EVERY intermediate frame — not only endpoints.`
      : "";
  const analysisBit = scene.analysis?.trim()
    ? `\nVision notes: ${scene.analysis.trim().slice(0, 1200)}`
    : "";
  return {
    debutPrompt: `CLONE SCENE ${sn} — START (debut) still. Frame #${scene.debut.index + 1} at ${scene.debut.timeSec.toFixed(2)}s (${refDelta.toFixed(2)}s before fin in reference).${frameRange} Exhaustive visual snapshot; diff vs every later frame.${analysisBit}`,
    finPrompt: `CLONE SCENE ${sn} — END (fin) still. Frame #${scene.fin.index + 1} at ${scene.fin.timeSec.toFixed(2)}s.${frameRange} List every change vs debut and each intermediate frame; schedule each change in its own timed beat across ${CLONE_VEO_SCENE_SECONDS}s.${analysisBit}`,
  };
}

/** Rich fullScript for clone Veo package generation (English, ambient audio only). */
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
      reference_frame_count: s.frameCount ?? 2,
      audio: "ambient source audio only — environmental sounds from reference (tools, machinery, room tone, impacts). No spoken dialogue or voiceover script unless reference clearly shows on-camera speech.",
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
      const frames = s.frameCount ?? 2;
      return `**Scene ${s.sceneNumber} — ${startSec}s to ${endSec}s (Veo output)**
Reference span: still A at t=${s.debut.timeSec.toFixed(2)}s → still B at t=${s.fin.timeSec.toFixed(2)}s (${refDelta.toFixed(1)}s in source, ${frames} reference frames analyzed).
Visual goal: Recreate reference motion using TIMED ACTION SPLIT from vision analysis — every frame-to-frame change gets its own beat across ${CLONE_VEO_SCENE_SECONDS}s.
Audio goal: Ambient / environmental sound from the reference clip only (machinery, footsteps, wind, impacts, room tone). NO scripted voiceover, NO Darija/Arabic/French dialogue unless reference clearly shows on-camera speech.
---
Vision continuity (all frames debut → fin):
${s.analysis?.trim() || "(see image analysis for this scene)"}`;
    })
    .join("\n\n");

  return `CLONE VIDEO — Reference reproduction (visual + ambient sound)
Product: Reference video clone (preserve talent, environment, props as in reference)
Output duration: ${total * CLONE_VEO_SCENE_SECONDS}s (${total} scenes × ${CLONE_VEO_SCENE_SECONDS}s each)
Platform: vertical 9:16
Generation model: Google Veo 3.1
Source reference duration: ~${videoDurationSec.toFixed(1)}s
Language / audio: ${CLONE_LANGUAGE_LABEL}

CRITICAL:
- Each scene is EXACTLY ${CLONE_VEO_SCENE_SECONDS} seconds of generated video.
- Vision analysis covers ALL reference frames between debut and fin — use the full PROGRESSION, not only endpoints.
- Follow TIMED ACTION SPLIT beat-by-beat; never dump all changes in one instant.
- Do NOT invent marketing narration or Darija voiceover.

${narrative}

--- SCENE METADATA ---
${JSON.stringify(scenesMeta, null, 2)}`;
}
