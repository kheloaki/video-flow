export type CloneContentStyle = "standard" | "timelapse";

export const CLONE_AUDIO_LABEL =
  "action sounds only — diegetic SFX from the scene (tools, machinery, impacts, footsteps, wind, room tone). No music, no song, no soundtrack, no spoken dialogue unless reference shows on-camera speech";

export const CLONE_LANGUAGE_LABEL = CLONE_AUDIO_LABEL;

export function parseCloneContentStyle(raw: unknown): CloneContentStyle {
  return raw === "timelapse" ? "timelapse" : "standard";
}

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
- shotDesign.pace = timelapse-compressed; camera often static with subject/environment evolving.
- negativePrompt MUST include: music, soundtrack, background song, cinematic score, voiceover narration.
- Audio paragraph: list specific action SFX only — never music.`;
  }
  return `STANDARD CLONE PACKAGE RULES:
- Follow reference motion pace; do not force timelapse unless analysis indicates it.
- negativePrompt MUST include: music, soundtrack, background song unless reference clearly has music.
- Audio paragraph: diegetic action sounds only.`;
}
