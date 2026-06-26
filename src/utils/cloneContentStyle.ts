export type CloneContentStyle = "standard" | "timelapse";

export const CLONE_AUDIO_LABEL =
  "action sounds only — diegetic SFX from the scene (tools, machinery, impacts, footsteps, wind, room tone). No music, no song, no soundtrack, no spoken dialogue unless reference shows on-camera speech";

/** @deprecated use CLONE_AUDIO_LABEL */
export const CLONE_LANGUAGE_LABEL = CLONE_AUDIO_LABEL;

export function buildContentStyleVisionBlock(style: CloneContentStyle = "standard"): string {
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

export function buildContentStylePackageBlock(style: CloneContentStyle = "standard"): string {
  if (style === "timelapse") {
    return `TIMELAPSE PACKAGE RULES:
- veoPrompt must describe accelerated but readable progression: each TIMED ACTION SPLIT beat = one visible completed step.
- shotDesign.pace = "timelapse-compressed" or similar; camera often static with subject/environment evolving.
- motionPlan: structural/terrain/object changes dominate; micro human motion only if present in reference.
- negativePrompt MUST include: music, soundtrack, background song, cinematic score, voiceover narration.
- Audio paragraph: list specific action SFX only (tools, engines, impacts) — never music.`;
  }
  return `STANDARD CLONE PACKAGE RULES:
- Follow reference motion pace; do not force timelapse acceleration unless analysis indicates it.
- negativePrompt MUST include: music, soundtrack, background song unless reference clearly has music.
- Audio paragraph: diegetic action sounds only.`;
}
