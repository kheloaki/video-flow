export const CLONE_VEO_SCENE_SECONDS = 8;

export const CLONE_AUDIO_LABEL =
  "action sounds only — diegetic SFX from the scene (tools, machinery, impacts, footsteps, wind, room tone). No music, no song, no soundtrack, no spoken dialogue unless reference shows on-camera speech";

export const CLONE_LANGUAGE_LABEL = CLONE_AUDIO_LABEL;

function contentStyleVisionBlock(style = "standard") {
  if (style === "timelapse") {
    return `USER SELECTED: TIMELAPSE / PROGRESSION MODE
- Reference is compressed time: construction, assembly, landscaping, process B-roll, or fast-forward state change.
- Each frame may represent minutes/hours of real elapsed time — infer logical build/process order across frames.
- Veo 8s must show readable step-by-step progression (cause → effect), NOT a single magic morph.
- Camera often locked tripod, drone, or slow pan — note rig in every frame snapshot.
- Audio: ONLY action-linked diegetic sounds (hammer, drill, engine, gravel, truck reverse beep, wind). NO music, NO song, NO cinematic score.`;
  }
  return `USER SELECTED: STANDARD CLONE MODE
- Match reference pacing and content type faithfully.
- Audio: ONLY diegetic action/environment sounds. NO music, NO song, NO soundtrack unless clearly audible in reference.`;
}

export function buildCloneDebutFinPrompts(scene, contentStyle = "standard") {
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
    debutPrompt: `CLONE SCENE ${sn} — START (debut) still. Frame #${scene.debut.index + 1} at ${scene.debut.timeSec.toFixed(2)}s (${refDelta.toFixed(2)}s before fin).${styleBit}${frameRange} Exhaustive visual snapshot.${analysisBit} Audio: action SFX only — no music.`,
    finPrompt: `CLONE SCENE ${sn} — END (fin) still. Frame #${scene.fin.index + 1} at ${scene.fin.timeSec.toFixed(2)}s.${styleBit}${frameRange} List every change vs debut and each intermediate frame.${analysisBit} Audio: action SFX only — no music.`,
  };
}

export function buildCloneFullScript(scenes, videoDurationSec, contentStyle = "standard") {
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
      debut: { prompt: debutPrompt, use_model_ref: true, use_product_ref: true, use_background_ref: true },
      fin: { prompt: finPrompt, use_model_ref: true, use_product_ref: true, use_background_ref: true },
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
      return `**Scene ${s.sceneNumber} — ${startSec}s to ${endSec}s**
Reference: t=${s.debut.timeSec.toFixed(2)}s → t=${s.fin.timeSec.toFixed(2)}s (${refDelta.toFixed(1)}s source, ${frames} frames). ${paceNote}
Audio: ${CLONE_AUDIO_LABEL}
---
${s.analysis?.trim() || "(see image analysis)"}`;
    })
    .join("\n\n");

  return `CLONE VIDEO — ${styleLabel}
Content style: ${contentStyle}
Duration: ${total * CLONE_VEO_SCENE_SECONDS}s (${total} scenes × ${CLONE_VEO_SCENE_SECONDS}s)
Source reference: ~${videoDurationSec.toFixed(1)}s
Language / audio: ${CLONE_AUDIO_LABEL}

${contentStyleVisionBlock(contentStyle)}

CRITICAL: NO music, NO song, NO soundtrack — only diegetic action sounds unless reference clearly has music.

${narrative}

--- SCENE METADATA ---
${JSON.stringify({ content_style: contentStyle, scenes: scenesMeta }, null, 2)}`;
}
