export const CLONE_VEO_SCENE_SECONDS = 8;

export function buildCloneDebutFinPrompts(scene) {
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

export function buildCloneFullScript(scenes, videoDurationSec) {
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
      return `**Scene ${s.sceneNumber} — ${startSec} to ${endSec}s**
Recreate reference motion from still A (t=${s.debut.timeSec.toFixed(2)}s) to still B (t=${s.fin.timeSec.toFixed(2)}s, ${refDelta.toFixed(1)}s apart). TIMED ACTION SPLIT across ${CLONE_VEO_SCENE_SECONDS}s.
---
${s.analysis?.trim() || "(see image analysis)"}`;
    })
    .join("\n\n");

  return `CLONE VIDEO — Reference reproduction
Duration: ${total * CLONE_VEO_SCENE_SECONDS}s (${total} scenes × ${CLONE_VEO_SCENE_SECONDS}s)
Source reference: ~${videoDurationSec.toFixed(1)}s

${narrative}

--- SCENE METADATA ---
${JSON.stringify({ scenes: scenesMeta }, null, 2)}`;
}
