import {
  buildContentStyleVisionBlock,
  CLONE_AUDIO_LABEL,
  type CloneContentStyle,
} from "./cloneContentStyle";

export type CloneSceneScriptInput = {
  sceneNumber: number;
  debut: { index: number; timeSec: number };
  fin: { index: number; timeSec: number };
  analysis?: string;
  /** Total reference frames in this scene (debut → fin inclusive). */
  frameCount?: number;
};

export const CLONE_VEO_SCENE_SECONDS = 8;

export { CLONE_AUDIO_LABEL as CLONE_LANGUAGE_LABEL, CLONE_AUDIO_LABEL };

export function buildCloneDebutFinPrompts(
  scene: CloneSceneScriptInput,
  contentStyle: CloneContentStyle = "standard"
): {
  debutPrompt: string;
  finPrompt: string;
} {
  const sn = scene.sceneNumber;
  const refDelta = Math.max(0, scene.fin.timeSec - scene.debut.timeSec);
  const frameCount = scene.frameCount ?? 2;
  const styleBit =
    contentStyle === "timelapse"
      ? " TIMELAPSE mode: compressed real-world progression — describe build/process state at this exact moment."
      : "";
  const frameRange =
    frameCount > 2
      ? ` Scene spans ${frameCount} reference frames (#${scene.debut.index + 1} debut → #${scene.fin.index + 1} fin). Describe EVERY intermediate frame — not only endpoints.`
      : "";
  const analysisBit = scene.analysis?.trim()
    ? `\nVision notes: ${scene.analysis.trim().slice(0, 1200)}`
    : "";
  return {
    debutPrompt: `CLONE SCENE ${sn} — START (debut) still. Frame #${scene.debut.index + 1} at ${scene.debut.timeSec.toFixed(2)}s (${refDelta.toFixed(2)}s before fin in reference).${styleBit}${frameRange} Exhaustive visual snapshot; diff vs every later frame. Audio: action SFX only — no music.${analysisBit}`,
    finPrompt: `CLONE SCENE ${sn} — END (fin) still. Frame #${scene.fin.index + 1} at ${scene.fin.timeSec.toFixed(2)}s.${styleBit}${frameRange} List every change vs debut and each intermediate frame; schedule each change in its own timed beat across ${CLONE_VEO_SCENE_SECONDS}s. Audio: action SFX only — no music.${analysisBit}`,
  };
}

/** Rich fullScript for clone Veo package generation (English, action audio only). */
export function buildCloneFullScript(
  scenes: CloneSceneScriptInput[],
  videoDurationSec: number,
  contentStyle: CloneContentStyle = "standard"
): string {
  const total = scenes.length;
  const styleLabel = contentStyle === "timelapse" ? "Timelapse / progression clone" : "Standard reference clone";
  const scenesMeta = scenes.map((s) => {
    const { debutPrompt, finPrompt } = buildCloneDebutFinPrompts(s, contentStyle);
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
      content_style: contentStyle,
      audio: CLONE_AUDIO_LABEL,
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
      const paceNote =
        contentStyle === "timelapse"
          ? "Pacing: timelapse-compressed — each beat = one completed step in the build/process."
          : "Pacing: match reference — stagger changes per TIMED ACTION SPLIT.";
      return `**Scene ${s.sceneNumber} — ${startSec}s to ${endSec}s (Veo output)**
Reference span: still A at t=${s.debut.timeSec.toFixed(2)}s → still B at t=${s.fin.timeSec.toFixed(2)}s (${refDelta.toFixed(1)}s in source, ${frames} reference frames analyzed).
Visual goal: Recreate reference motion using TIMED ACTION SPLIT from vision analysis — every frame-to-frame change gets its own beat across ${CLONE_VEO_SCENE_SECONDS}s.
${paceNote}
Audio goal: ${CLONE_AUDIO_LABEL}
---
Vision continuity (all frames debut → fin):
${s.analysis?.trim() || "(see image analysis for this scene)"}`;
    })
    .join("\n\n");

  return `CLONE VIDEO — ${styleLabel}
Product: Reference video clone (preserve talent, environment, props as in reference)
Content style: ${contentStyle}
Output duration: ${total * CLONE_VEO_SCENE_SECONDS}s (${total} scenes × ${CLONE_VEO_SCENE_SECONDS}s each)
Platform: vertical 9:16
Generation model: Google Veo 3.1
Source reference duration: ~${videoDurationSec.toFixed(1)}s
Language / audio: ${CLONE_AUDIO_LABEL}

${buildContentStyleVisionBlock(contentStyle)}

CRITICAL:
- Each scene is EXACTLY ${CLONE_VEO_SCENE_SECONDS} seconds of generated video.
- Vision analysis covers ALL reference frames between debut and fin — use the full PROGRESSION, not only endpoints.
- Follow TIMED ACTION SPLIT beat-by-beat; never dump all changes in one instant.
- NO music, NO song, NO soundtrack — only diegetic action sounds unless reference clearly contains music (rare).

${narrative}

--- SCENE METADATA ---
${JSON.stringify({ content_style: contentStyle, scenes: scenesMeta }, null, 2)}`;
}
