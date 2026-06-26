import type { AiUsagePayload } from "./aiUsage.js";
import { parseOpenAiUsage } from "./aiUsage.js";
import { fetchOpenAiChat } from "./openaiRetry.js";
import {
  buildContentStylePackageBlock,
  buildContentStyleVisionBlock,
  CLONE_AUDIO_LABEL,
  CLONE_LANGUAGE_LABEL,
  parseCloneContentStyle,
  type CloneContentStyle,
} from "./cloneContentStyle.js";

export { CLONE_LANGUAGE_LABEL, CLONE_AUDIO_LABEL };

export type VeoScenePackageRequestBody = {
  fullScript?: string;
  sceneNumber?: number;
  debutImageUrl?: string;
  finImageUrl?: string;
  debutPrompt?: string;
  finPrompt?: string;
  languageLabel?: string;
  /** If set (from /veo-scene-analyze), skip vision — avoids one long serverless invocation. */
  imageAnalysis?: string;
  /** `clone` = reference video reproduction (long veoPrompt like Video Flow). Default `ad`. */
  workflowMode?: "ad" | "clone";
  contentStyle?: CloneContentStyle;
};

export type VeoSceneAnalyzeRequestBody = {
  debutImageUrl?: string;
  finImageUrl?: string;
  debutPrompt?: string;
  finPrompt?: string;
  /** `clone` = reference-video diff analysis (what changed A→B). Default `ad`. */
  workflowMode?: "ad" | "clone";
  /** Source video timestamp of debut still (seconds). */
  referenceDebutSec?: number;
  /** Source video timestamp of fin still (seconds). */
  referenceFinSec?: number;
  /** Veo output length to plan beats for (default 8). */
  veoOutputDurationSec?: number;
  sceneNumber?: number;
  /** All scene frames in order: debut → … → fin (clone workflow). */
  sceneFrameImageUrls?: string[];
  /** Seconds in source video for each frame in sceneFrameImageUrls. */
  sceneFrameTimesSec?: number[];
  /** Timelapse vs standard — shapes vision analysis depth and pacing. */
  contentStyle?: CloneContentStyle;
};

export type VeoSceneAnalyzeResult =
  | { ok: false; status: number; error: string }
  | { ok: true; analysis: string; usage?: AiUsagePayload | null };

export type VeoScenePackageResult =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      analysis: string;
      /** Parsed JSON object, or null if model output was not valid JSON */
      scenePackage: unknown | null;
      rawPackageText?: string;
      parseError?: string;
      usage?: AiUsagePayload | null;
    };

type OpenAiChatResult = { content: string; usage: AiUsagePayload | null };

async function openaiChat(
  messages: unknown[],
  temperature: number,
  apiKey: string,
  model: string,
  opts?: { max_tokens?: number; operation?: string }
): Promise<OpenAiChatResult> {
  const operation = opts?.operation ?? "openai-chat";
  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature,
  };
  if (opts?.max_tokens != null) {
    payload.max_tokens = opts.max_tokens;
  }
  const { ok, status, text } = await fetchOpenAiChat(apiKey, payload);
  if (!ok) {
    let msg = text.slice(0, 800);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      if (j.error?.message) msg = j.error.message;
    } catch {
      /* ignore */
    }
    const err = new Error(`OpenAI ${status}: ${msg}`) as Error & { httpStatus?: number };
    err.httpStatus = status;
    throw err;
  }
  let j: {
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  try {
    j = JSON.parse(text) as typeof j;
  } catch {
    const err = new Error(`OpenAI response ma-shi JSON: ${text.slice(0, 240)}`) as Error & {
      httpStatus?: number;
    };
    err.httpStatus = 502;
    throw err;
  }
  const content = j.choices?.[0]?.message?.content;
  if (content == null || String(content).trim() === "") {
    const fr = j.choices?.[0]?.finish_reason ?? "?";
    const err = new Error(`OpenAI rja3 contenu khawi (finish_reason=${fr}).`) as Error & { httpStatus?: number };
    err.httpStatus = 502;
    throw err;
  }
  return {
    content: String(content).trim(),
    usage: parseOpenAiUsage(j, model, operation),
  };
}

function extractFirstJsonObject(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("```")) {
    s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  }
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("Ma-l9inach JSON f l-resposta.");
  return s.slice(start, end + 1);
}

/** Post-edit overlay spec removed from product — strip if the model still returns it. */
function omitTextOnScreen(pkg: unknown): unknown {
  if (pkg && typeof pkg === "object" && !Array.isArray(pkg)) {
    const o = { ...(pkg as Record<string, unknown>) };
    delete o.textOnScreen;
    return o;
  }
  return pkg;
}

function buildVeoPackageUserPrompt(args: {
  fullScript: string;
  sceneNumber: number;
  imageAnalysis: string;
  languageLabel: string;
  workflowMode?: "ad" | "clone";
  contentStyle?: CloneContentStyle;
}): string {
  const {
    fullScript,
    sceneNumber,
    imageAnalysis,
    languageLabel,
    workflowMode = "ad",
    contentStyle = "standard",
  } = args;
  const isClone = workflowMode === "clone";
  const langJson = JSON.stringify(isClone ? CLONE_AUDIO_LABEL : languageLabel);

  const cloneModeBlock = isClone
    ? `
CLONE VIDEO MODE (mandatory):
- Reproduce the REFERENCE clip for scene ${sceneNumber} — not a new ad concept.
- IMAGE ANALYSIS is ground truth: use "PROGRESSION A → … → B" (every reference frame), "CHANGES A → B", and "TIMED ACTION SPLIT" as the motion schedule.
- veoPrompt: 500–800+ words in clear English — opening frame, environment, subjects, props, lighting, lens feel, beat-by-beat motion mapped to TIMED ACTION SPLIT, camera path, pacing for 8.0s.
- Include a detailed "Audio / ambience" paragraph: list specific diegetic action SFX (tools, engines, impacts, footsteps, wind). NO music bed, NO song, NO soundtrack.
- negativePrompt: 25+ comma-separated constraints (identity drift, captions, watermark, bad anatomy, music, soundtrack, song, voiceover, etc.).
- actionFlow, shotDesign, motionPlan, continuity.mustPreserve (8+ items), generationNotes: all detailed.

${buildContentStylePackageBlock(contentStyle)}
`
    : "";

  const creativeRules = isClone
    ? `Creative rules (CLONE — reference reproduction):
- Match the reference content type (construction timelapse, B-roll, demo, lifestyle, etc.) — do NOT force UGC talking-head if reference has none.
- Vertical 9:16 unless reference implies otherwise.
- Ultra-realistic; motion interpolates debut → every intermediate state → fin across 8 seconds.
- Use TIMED ACTION SPLIT beats exactly — one major change per window, never all at once.
- Preserve everything listed under WHAT STAYED THE SAME in IMAGE ANALYSIS.

Audio rules (CRITICAL — action sounds only, NO music):
- ONLY diegetic action/environment SFX from the reference scene (machinery, tools, footsteps, wind, water, impacts, room tone, engines).
- NO music, NO song, NO soundtrack, NO cinematic score unless IMAGE ANALYSIS explicitly confirms music is audible in reference.
- voiceoverDarija and voiceoverDarijaClearTTS MUST remain empty strings "".
- speaker.isSpeakingToCamera: false and speaker.lipSyncRequired: false UNLESS IMAGE ANALYSIS explicitly confirms visible on-camera speech with lip movement.
- Do NOT invent marketing copy, Darija, Arabic, French, or English narration.
- In veoPrompt, describe action SFX bed in detail; do NOT write dialogue lines or music cues.

Scene extraction rules:
- Extract only scene ${sceneNumber}.
- sceneGoal = reproduce reference visual + ambient audio for this beat.
- Ignore ad-style hooks/CTA unless clearly present in reference.`
    : `Creative rules:
- The scene must feel like a real Moroccan TikTok / Reels UGC ad.
- Keep it vertical 9:16 unless the script clearly says otherwise.
- Keep it ultra-realistic.
- Keep it simple, believable, and easy to generate.
- Use smartphone UGC energy: natural handheld but stable.
- Use warm soft lighting or natural home lighting if supported by the script and image analysis.
- Use shallow depth of field when relevant.
- Use simple camera motion only: soft push-in, slight reframing, close-up, medium shot, selfie framing.
- Keep the motion natural and smooth from the debut image toward the fin image.

Scene extraction rules:
- Extract only the selected scene.
- Extract or infer: scene name, scene goal, visual role, voiceover, whether speaking to camera, product visibility.
- Do not mix details from other scenes except if needed for continuity.

Speaking rules:
- If the selected scene includes speaking or voiceover, the woman in the video must be the one speaking directly to camera.
- Explicitly mention natural realistic lip sync and believable mouth movement.
- Make it feel like real UGC speaking, not an external voiceover.`;

  const continuityRules = isClone
    ? `Continuity rules:
- Preserve all anchors from IMAGE ANALYSIS (identity, outfit, environment, props, camera rig when static).
- Smooth transition through every intermediate frame state — not a jump cut from A to B.`
    : `Continuity rules:
- Preserve the same woman identity, face, hair, outfit, room, lighting, background when continuity is required.
- Preserve all important details found in the image analysis.
- The scene must feel like a smooth transition, not two disconnected frames.`;

  const sceneIntro = isClone
    ? "reference-video CLONE"
    : "Moroccan UGC ad";

  return `Generate one final VEO 3.1 scene package for a single ${sceneIntro} scene.

You are creating only one scene.
${cloneModeBlock}

Inputs:

FULL SCRIPT:
${fullScript}

SCENE NUMBER:${sceneNumber}

IMAGE ANALYSIS:
${imageAnalysis}

Your job:
Read the full script, identify scene ${sceneNumber}, then use IMAGE ANALYSIS as the main visual continuity source for one detailed VEO 3.1 scene package.

Important:
- Return valid JSON only. No markdown. No text before or after the JSON.

${creativeRules}

On-screen text / overlays (IMPORTANT):
- Do NOT include a "textOnScreen" field. Omit it completely.
- veoPrompt and negativePrompt: no baked subtitles, captions, or readable UI text unless a real-world sign is explicitly required in reference.

${continuityRules}

Product rules:
- If a product is visible, keep packaging/design unchanged; label readable when visible.

Visual rules:
- Use IMAGE ANALYSIS for expression, hands, hair, camera, implied motion, environment, realism risks.
- Reference every frame progression when present in analysis — not only debut/fin endpoints.

Naturally include in veoPrompt and negativePrompt:
- no subtitles, no captions, no watermark, no logo, no fake UI
- no identity drift, no outfit change, no room swap (unless reference changes it)
- no bad anatomy, no extra fingers, no chaotic shake
${isClone ? "- no spoken dialogue, no voiceover narration, no music, no song, no soundtrack (action SFX only unless reference has music or speech)" : ""}

Use this exact JSON string for the field "language": ${langJson}
${isClone ? "- voiceoverDarija and voiceoverDarijaClearTTS must be empty strings." : ""}

Return exactly this JSON structure (sceneNumber must be ${sceneNumber}):

{
  "sceneNumber": ${sceneNumber},
  "sceneName": "",
  "sceneType": "",
  "sceneGoal": "",
  "product": "",
  "format": "",
  "platform": "",
  "generation": "",
  "durationSeconds": 8,
  "aspectRatio": "9:16",
  "language": ${langJson},
  "voiceoverDarija": "",
  "voiceoverDarijaClearTTS": "",
  "speaker": {
    "isSpeakingToCamera": false,
    "speakerType": "",
    "deliveryTone": "",
    "lipSyncRequired": ${isClone ? "false" : "true"}
  },
  "productVisibility": {
    "visible": false,
    "productRole": "",
    "labelMustStayReadable": false,
    "packagingMustStayUnchanged": false
  },
  "continuity": {
    "sameIdentity": true,
    "sameHair": true,
    "sameOutfit": true,
    "sameRoom": true,
    "sameLighting": true,
    "sameBackground": true,
    "sameProductDesignIfVisible": false,
    "mustPreserve": []
  },
  "shotDesign": {
    "cameraStyle": "",
    "framingStart": "",
    "framingMiddle": "",
    "framingEnd": "",
    "cameraMovement": "",
    "lighting": "",
    "depthOfField": "",
    "mood": "",
    "pace": ""
  },
  "motionPlan": {
    "subjectMotion": "",
    "handMotion": "",
    "hairMotion": "",
    "cameraMotion": "",
    "expressionProgression": "",
    "startToEndArc": ""
  },
  "actionFlow": [
    {
      "time": "0.0-2.0s",
      "action": "",
      "expression": "",
      "camera": ""
    },
    {
      "time": "2.0-4.0s",
      "action": "",
      "expression": "",
      "camera": ""
    },
    {
      "time": "4.0-6.0s",
      "action": "",
      "expression": "",
      "camera": ""
    },
    {
      "time": "6.0-8.0s",
      "action": "",
      "expression": "",
      "camera": ""
    }
  ],
  "veoPrompt": "",
  "negativePrompt": "",
  "generationNotes": {
    "realismPriority": "",
    "ugcPriority": "",
    "mainRiskFlags": [],
    "externalClipRecommended": false,
    "externalClipReason": ""
  }
}`;
}

const VISION_USER_PROMPT_AD = `You are a video continuity analyst for Moroccan UGC ads (TikTok / Reels, vertical 9:16).

Two images are attached IN ORDER:
IMAGE A = scene START (debut). IMAGE B = scene END (fin) for the SAME 8-second clip.

Optional user notes (may be empty):
DEBUT_PROMPT: {{DEBUT}}
FIN_PROMPT: {{FIN}}

Rules:
- Look at BOTH images carefully before writing. Do not skip small details.
- Do not return JSON. Plain text only.
- Do not generate a VEO prompt.

Return EXACTLY this structure (fill every line; write "none" if truly absent):

Scene Type Guess:
[one line]

Debut Image Analysis:
- Subject:
- Hair:
- Outfit:
- Face and Expression:
- Pose and Hands:
- Objects:
- Camera:
- Environment:
- Realism Notes:

Fin Image Analysis:
- Subject:
- Hair:
- Outfit:
- Face and Expression:
- Pose and Hands:
- Objects:
- Camera:
- Environment:
- Realism Notes:

Continuity Requirements:
- Same identity:
- Same hair:
- Same outfit:
- Same room:
- Same lighting:
- Same product design if visible:
- Must preserve:

Changes from Debut to Fin:
- Expression change:
- Pose change:
- Hand change:
- Camera change:
- Object change:
- Hair presentation change:
- Background change:

Implied Motion for Video:
- Subject motion:
- Hand motion:
- Hair motion:
- Camera motion:
- Emotion progression:
- Most natural transition arc:

VEO Generation Notes:
- Scene goal guess:
- Product focus level:
- Speaking to camera likelihood:
- Best prompting keywords:
- Risk flags:

One Paragraph Summary:
[one clear paragraph]`;

const VISION_USER_PROMPT_CLONE = `You are a reference-video frame analyst for CLONE / reproduction workflows.

Two images are attached IN ORDER:
IMAGE A = clip START (debut still). IMAGE B = clip END (fin still).
Veo must generate an 8-second vertical video that naturally moves from A toward B.

Optional user notes (may be empty):
DEBUT_PROMPT: {{DEBUT}}
FIN_PROMPT: {{FIN}}

{{TIMING_BLOCK}}

{{CONTENT_STYLE_BLOCK}}

CRITICAL RULES:
- Examine BOTH images pixel-by-pixel. NEVER assume "no people" — count every person, vehicle, machine, animal, prop.
- If workers, equipment, or objects appear in A but not B (or the reverse), you MUST list them under "Changes A → B".
- Adapt to the actual content: construction timelapse, UGC creator, product demo, outdoor B-roll, etc. Do NOT force UGC/person fields when the scene has no on-camera talent.
- Title/caption overlays (e.g. bold text at top) are POST-PRODUCTION — note them under "Overlays" but they are NOT part of the 3D world Veo should generate unless explicitly required.
- The section "Changes A → B" is the MOST IMPORTANT output — be exhaustive and specific.
- NEVER assign all changes to the same instant or only the last second. Split each change into its own logical time window across 0.0–{{VEO_DURATION}}s (see TIMED ACTION SPLIT).

Do not return JSON. Plain text only. Do not generate a VEO prompt.

Return EXACTLY this structure (fill every line; write "none" if truly absent):

Scene Type:
[UGC talking head | product demo | construction / timelapse | outdoor B-roll | indoor lifestyle | other — pick one]

IMAGE A (debut) — full snapshot:
- People (count, clothing colors, positions, actions):
- Main focal subject / hero element:
- Environment & set (room, yard, street, etc.):
- Structures / terrain / excavation / build state:
- Machinery, vehicles, tools, props:
- Camera (angle, height, distance, drone/aerial/handheld/selfie):
- Lighting & weather:
- Overlays / on-image text (NOT part of 3D scene):

IMAGE B (fin) — full snapshot:
- People (count, clothing colors, positions, actions):
- Main focal subject / hero element:
- Environment & set:
- Structures / terrain / excavation / build state:
- Machinery, vehicles, tools, props:
- Camera (angle, height, distance):
- Lighting & weather:
- Overlays / on-image text:

WHAT STAYED THE SAME (lock for continuity):
- Fixed anchors (buildings, fences, horizon, trees that did not move):
- Camera rig / angle (if static):
- Identity / outfit (if same person on camera):
- Lighting mood (if unchanged):
- Other locked elements:

CHANGES A → B (MOST IMPORTANT — list every visible delta):
- People added / removed / moved:
- Main subject / structure / product change:
- Construction / ground / terrain progression:
- Objects added / removed / repositioned:
- Machinery / vehicles (enter, exit, move, load, etc.):
- Camera reframe / zoom / tilt (if any):
- Lighting or weather shift (if any):
- Expression / pose / gesture (if people present):
- Top 3 changes Veo MUST animate over 8 seconds (ranked):

TIMED ACTION SPLIT (THIS SCENE — stagger changes; never all at once):
List EVERY distinct change from "CHANGES A → B" as its own timed beat. Use one row per change:

Beat 1 | [change name] | {{VEO_DURATION_START}}–[end]s | [what the viewer sees during this window] | [depends on / follows beat # or "—"]
Beat 2 | ...
(continue until all changes are scheduled; beats must cover 0.0–{{VEO_DURATION}}s with no gaps longer than 1.5s unless holding a static state)

Timing rules:
- 0.0–0.8s: hold IMAGE A state with only micro-motion (breathing, dust, idle machine vibration, etc.)
- Middle beats: each major change gets its OWN window — cause before effect (e.g. excavator dumps → truck fills → truck exits → structure appears)
- Do NOT stack unrelated changes in the same second
- If reference elapsed is long (>{{REF_DELTA}}s hint), spread progression slowly; if short, compress but still sequence logically
- Last 0.8s: settle into IMAGE B state (match fin still)
- Sum of beats must span the full {{VEO_DURATION}}s clip

8-SECOND MOTION PLAN (debut → fin) — summary view:
- 0.0–2.0s:
- 2.0–4.0s:
- 4.0–6.0s:
- 6.0–8.0s:
- Overall arc (one sentence):

VEO RISKS & NOTES:
- Continuity risks:
- Elements to exclude from generation (overlays, watermarks):
- Realism flags:

AUDIO / SOUND (action SFX only — NO music unless clearly in reference):
- Environmental / ambient action sounds (wind, room tone, outdoor bed):
- Tool / machine / vehicle / impact sounds (list each heard or implied):
- Human action sounds (footsteps, handling, shouts — if any):
- Visible speech / lip sync: [none | describe]
- Music / song / soundtrack in reference: [none | describe — default none]
- Veo output audio: diegetic action SFX ONLY; NO added music, NO score, NO Darija/Arabic/French/English voiceover script

One-Line Summary for Prompt Writer:
[Single sentence: visual motion A → B in 8 seconds; ambient sound only unless speech visible]`;

const VISION_USER_PROMPT_CLONE_MULTI = `You are a reference-video frame analyst for CLONE / reproduction workflows.

{{FRAME_COUNT}} images are attached IN ORDER — COMPLETE scene from START through EVERY intermediate frame to END:
- IMAGE 1 = debut | IMAGES 2..{{FRAME_COUNT_MINUS_ONE}} = intermediate (mandatory) | IMAGE {{FRAME_COUNT}} = fin

Frame timestamps (seconds):
{{FRAME_TIMES_LIST}}

Veo generates {{VEO_DURATION}}s video: IMAGE 1 → … → IMAGE {{FRAME_COUNT}} honoring ALL intermediate states.

DEBUT_PROMPT: {{DEBUT}}
FIN_PROMPT: {{FIN}}
{{TIMING_BLOCK}}

{{CONTENT_STYLE_BLOCK}}

CRITICAL:
- Analyze ALL {{FRAME_COUNT}} images individually — skipping frames is forbidden.
- For each frame i→i+1, list every visible delta (even subtle: hands, shadows, tools, dust).
- PROGRESSION + CHANGES A → B are most important. TIMED ACTION SPLIT: one beat per change.
- Overlays = post-production only. Do NOT invent dialogue/voiceover — note ambient sounds only.

Plain text only. No JSON. No VEO prompt.

Scene Type:
[construction/timelapse | demo | B-roll | lifestyle | UGC | other]

PROGRESSION A → … → B (exactly {{FRAME_COUNT}} entries — one per attached image; minimum 4 bullet lines per frame):
For i = 1..{{FRAME_COUNT}}:
  Frame [i] @ [time]s:
  - Snapshot (detailed): people count/positions/clothing, main subject, environment, structures/terrain state, machinery/props with positions, camera rig, lighting, shadows, overlays
  - Delta vs frame i-1 (exhaustive): every added/removed/moved element, even subtle (dust, partial completion, shadow shift, tool reposition)

IMAGE A / IMAGE B — summary snapshots (debut + fin)

WHAT STAYED THE SAME:

CHANGES A → B (use ALL frames; cite frame numbers):
- Cumulative frame-by-frame changes:
- People / subject / terrain / objects / machinery / camera / lighting:
- Top 5 Veo must animate (ranked, mapped to frames):

TIMED ACTION SPLIT (0.0–{{VEO_DURATION}}s):
Beat | change | window | viewer sees | source frames

8-SECOND MOTION PLAN:
- 0.0–2.0s / 2.0–4.0s / 4.0–6.0s / 6.0–{{VEO_DURATION}}s (tie to frame progression)

AUDIO / SOUND (action SFX only — NO music unless clearly in reference):
- Environmental / ambient action sounds:
- Tool / machine / vehicle / impact sounds (enumerate):
- Visible speech / lip sync: [none | describe]
- Music / song / soundtrack in reference: [none | describe — default none]
- Veo: diegetic action SFX bed ONLY; NO music, NO score, NO voiceover script

VEO RISKS & NOTES:

One-Line Summary:
[Motion through all {{FRAME_COUNT}} frames in {{VEO_DURATION}}s; ambient audio unless speech visible]`;

function buildVisionTimingBlock(args: {
  sceneNumber?: number;
  referenceDebutSec?: number;
  referenceFinSec?: number;
  veoOutputDurationSec: number;
}): string {
  const { sceneNumber, referenceDebutSec, referenceFinSec, veoOutputDurationSec } = args;
  const hasRef =
    Number.isFinite(referenceDebutSec) &&
    Number.isFinite(referenceFinSec) &&
    (referenceFinSec as number) >= (referenceDebutSec as number);
  const refDelta = hasRef
    ? Math.max(0, (referenceFinSec as number) - (referenceDebutSec as number))
    : null;
  const sceneLine =
    Number.isFinite(sceneNumber) && (sceneNumber as number) > 0
      ? `Scene number: ${sceneNumber}\n`
      : "";
  const refLines = hasRef
    ? `- Reference debut still: ${(referenceDebutSec as number).toFixed(2)}s in source video\n- Reference fin still: ${(referenceFinSec as number).toFixed(2)}s in source video\n- Elapsed in reference clip: ${refDelta!.toFixed(2)}s (use as pacing hint — longer = more time for multi-step progression)\n`
    : "- Reference timestamps: not provided — infer logical pacing from visual delta.\n";
  return `${sceneLine}REFERENCE TIMING (map this scene's changes into exactly ${veoOutputDurationSec}s Veo output):
${refLines}- Veo output duration: ${veoOutputDurationSec}s fixed`;
}

function buildVisionUserText(
  debutPrompt: string,
  finPrompt: string,
  workflowMode: "ad" | "clone" = "ad",
  timing?: {
    sceneNumber?: number;
    referenceDebutSec?: number;
    referenceFinSec?: number;
    veoOutputDurationSec?: number;
    frameCount?: number;
    frameTimesSec?: number[];
    contentStyle?: CloneContentStyle;
  }
): string {
  const veoDuration = timing?.veoOutputDurationSec ?? 8;
  const refDelta =
    Number.isFinite(timing?.referenceDebutSec) &&
    Number.isFinite(timing?.referenceFinSec)
      ? Math.max(0, (timing!.referenceFinSec as number) - (timing!.referenceDebutSec as number))
      : 0;
  const frameCount = timing?.frameCount ?? 2;
  const useMulti = workflowMode === "clone" && frameCount > 2;
  const template = useMulti
    ? VISION_USER_PROMPT_CLONE_MULTI
    : workflowMode === "clone"
      ? VISION_USER_PROMPT_CLONE
      : VISION_USER_PROMPT_AD;
  const times = timing?.frameTimesSec ?? [];
  const frameTimesList =
    times.length > 0
      ? times.map((t, i) => `  - Image ${i + 1}: ${Number(t).toFixed(2)}s`).join("\n")
      : "  (timestamps not provided)";
  const frameATime =
    times.length > 0 ? Number(times[0]).toFixed(2) : String(timing?.referenceDebutSec ?? "?");
  const frameBTime =
    times.length > 0
      ? Number(times[times.length - 1]).toFixed(2)
      : String(timing?.referenceFinSec ?? "?");

  return template
    .replace("{{DEBUT}}", debutPrompt || "(none)")
    .replace("{{FIN}}", finPrompt || "(none)")
    .replace(
      "{{CONTENT_STYLE_BLOCK}}",
      workflowMode === "clone"
        ? buildContentStyleVisionBlock(timing?.contentStyle ?? "standard")
        : ""
    )
    .replace(/\{\{FRAME_COUNT\}\}/g, String(frameCount))
    .replace(/\{\{FRAME_COUNT_MINUS_ONE\}\}/g, String(Math.max(1, frameCount - 1)))
    .replace("{{FRAME_TIMES_LIST}}", frameTimesList)
    .replace(/\{\{FRAME_A_TIME\}\}/g, frameATime)
    .replace(/\{\{FRAME_B_TIME\}\}/g, frameBTime)
    .replace(
      "{{TIMING_BLOCK}}",
      workflowMode === "clone"
        ? buildVisionTimingBlock({
            sceneNumber: timing?.sceneNumber,
            referenceDebutSec: timing?.referenceDebutSec,
            referenceFinSec: timing?.referenceFinSec,
            veoOutputDurationSec: veoDuration,
          })
        : ""
    )
    .replace(/\{\{VEO_DURATION\}\}/g, String(veoDuration))
    .replace(/\{\{VEO_DURATION_START\}\}/g, "0.0")
    .replace(/\{\{REF_DELTA\}\}/g, refDelta > 0 ? refDelta.toFixed(1) : "2");
}

/** Vision only — short serverless-friendly step (Vercel Hobby ~10s cap). */
export async function runVeoSceneAnalyze(
  body: VeoSceneAnalyzeRequestBody,
  env: { apiKey: string; visionModel?: string }
): Promise<VeoSceneAnalyzeResult> {
  const apiKey = env.apiKey;
  const visionModel = env.visionModel?.trim() || "gpt-4o-mini";
  const debutImageUrl = typeof body.debutImageUrl === "string" ? body.debutImageUrl.trim() : "";
  const finImageUrl = typeof body.finImageUrl === "string" ? body.finImageUrl.trim() : "";
  const debutPrompt = typeof body.debutPrompt === "string" ? body.debutPrompt.trim() : "";
  const finPrompt = typeof body.finPrompt === "string" ? body.finPrompt.trim() : "";
  const workflowMode =
    body.workflowMode === "clone" || body.workflowMode === "ad" ? body.workflowMode : "ad";
  const veoOutputDurationSec =
    typeof body.veoOutputDurationSec === "number" && body.veoOutputDurationSec > 0
      ? body.veoOutputDurationSec
      : 8;
  const sceneNumber =
    typeof body.sceneNumber === "number" ? body.sceneNumber : Number(body.sceneNumber);
  const referenceDebutSec =
    typeof body.referenceDebutSec === "number"
      ? body.referenceDebutSec
      : Number(body.referenceDebutSec);
  const referenceFinSec =
    typeof body.referenceFinSec === "number" ? body.referenceFinSec : Number(body.referenceFinSec);
  const contentStyle = parseCloneContentStyle(body.contentStyle);

  const rawSceneFrames = Array.isArray(body.sceneFrameImageUrls)
    ? body.sceneFrameImageUrls
        .filter((u): u is string => typeof u === "string" && u.trim().length > 0)
        .map((u) => u.trim())
    : [];
  const imageUrls =
    rawSceneFrames.length >= 2 ? rawSceneFrames : [debutImageUrl, finImageUrl].filter(Boolean);
  const frameTimesSec = Array.isArray(body.sceneFrameTimesSec)
    ? body.sceneFrameTimesSec.filter((t) => typeof t === "number" && Number.isFinite(t))
    : [];

  if (imageUrls.length < 2) {
    return { ok: false, status: 400, error: "debutImageUrl w finImageUrl (URLs dial tsawer) khasshom." };
  }

  const usesInlineImages = imageUrls.some((u) => u.startsWith("data:"));
  /** `high` only with HTTPS URLs — data URLs on Vercel are already compressed client-side. */
  const imageDetail =
    workflowMode === "clone" && !usesInlineImages ? "high" : "auto";

  const inlinePayloadBytes = imageUrls.reduce(
    (sum, u) => sum + (u.startsWith("data:") ? u.length : 0),
    0
  );
  if (inlinePayloadBytes > 3_800_000) {
    return {
      ok: false,
      status: 413,
      error:
        "Tsawer kbira bzaf f request (data URL). Compressiw frames wla uploadiw b UploadThing — max ~3.5MB total.",
    };
  }

  const maxTokens =
    workflowMode === "clone"
      ? Math.min(8192, 4096 + Math.max(0, imageUrls.length - 2) * 400)
      : 2048;

  try {
    const visionContent: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail: string } }
    > = [
      {
        type: "text",
        text: buildVisionUserText(debutPrompt, finPrompt, workflowMode, {
          sceneNumber: Number.isFinite(sceneNumber) ? sceneNumber : undefined,
          referenceDebutSec: Number.isFinite(referenceDebutSec)
            ? referenceDebutSec
            : undefined,
          referenceFinSec: Number.isFinite(referenceFinSec) ? referenceFinSec : undefined,
          veoOutputDurationSec,
          frameCount: imageUrls.length,
          frameTimesSec:
            frameTimesSec.length === imageUrls.length
              ? frameTimesSec
              : frameTimesSec.length > 0
                ? frameTimesSec
                : undefined,
          contentStyle,
        }),
      },
      ...imageUrls.map((url) => ({
        type: "image_url" as const,
        image_url: { url, detail: imageDetail },
      })),
    ];

    const { content: analysisText, usage } = await openaiChat(
      [
        {
          role: "user",
          content: visionContent,
        },
      ],
      0.3,
      apiKey,
      visionModel,
      { max_tokens: maxTokens, operation: "veo-scene-analyze" }
    );
    return { ok: true, analysis: analysisText, usage };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const httpStatus =
      e instanceof Error && "httpStatus" in e
        ? (e as Error & { httpStatus?: number }).httpStatus
        : 500;
    return { ok: false, status: typeof httpStatus === "number" ? httpStatus : 500, error: msg.slice(0, 800) };
  }
}

/** JSON package only — no images (second step after analyze). */
export async function runVeoScenePackageFromAnalysis(
  body: Pick<
    VeoScenePackageRequestBody,
    "fullScript" | "sceneNumber" | "languageLabel" | "imageAnalysis" | "workflowMode" | "contentStyle"
  >,
  env: { apiKey: string; model?: string }
): Promise<VeoScenePackageResult> {
  const apiKey = env.apiKey;
  const textModel = env.model?.trim() || "gpt-4o-mini";

  const fullScript = typeof body.fullScript === "string" ? body.fullScript.trim() : "";
  const sceneNumber = typeof body.sceneNumber === "number" ? body.sceneNumber : Number(body.sceneNumber);
  const imageAnalysis =
    typeof body.imageAnalysis === "string" ? body.imageAnalysis.trim() : "";
  const workflowMode =
    body.workflowMode === "clone" || body.workflowMode === "ad" ? body.workflowMode : "ad";
  const contentStyle = parseCloneContentStyle(body.contentStyle);
  const languageLabel =
    workflowMode === "clone"
      ? CLONE_AUDIO_LABEL
      : typeof body.languageLabel === "string" && body.languageLabel.trim()
        ? body.languageLabel.trim()
        : "Moroccan Darija";

  if (!fullScript || !Number.isFinite(sceneNumber) || sceneNumber < 1) {
    return { ok: false, status: 400, error: "fullScript w sceneNumber (>=1) khasshom ykouno m3molin." };
  }
  if (!imageAnalysis) {
    return { ok: false, status: 400, error: "imageAnalysis khassa (jibha men /api/ai/veo-scene-analyze)." };
  }

  try {
    const packagePrompt = buildVeoPackageUserPrompt({
      fullScript,
      sceneNumber,
      imageAnalysis,
      languageLabel,
      workflowMode,
      contentStyle,
    });

    const { content: jsonRaw, usage } = await openaiChat(
      [{ role: "user", content: packagePrompt }],
      0.35,
      apiKey,
      textModel,
      { max_tokens: 8192, operation: "veo-scene-package" }
    );

    try {
      const scenePackage = omitTextOnScreen(JSON.parse(extractFirstJsonObject(jsonRaw)));
      return { ok: true, analysis: imageAnalysis, scenePackage, usage };
    } catch (parseErr) {
      return {
        ok: true,
        analysis: imageAnalysis,
        scenePackage: null,
        rawPackageText: jsonRaw,
        parseError: parseErr instanceof Error ? parseErr.message : String(parseErr),
        usage,
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const httpStatus =
      e instanceof Error && "httpStatus" in e
        ? (e as Error & { httpStatus?: number }).httpStatus
        : 500;
    return { ok: false, status: typeof httpStatus === "number" ? httpStatus : 500, error: msg.slice(0, 800) };
  }
}

/**
 * Full flow: vision + JSON in one call (fine for local Express; Vercel Hobby may timeout — use analyze + package in app).
 */
export async function runVeoScenePackage(
  body: VeoScenePackageRequestBody,
  env: { apiKey: string; model?: string; visionModel?: string }
): Promise<VeoScenePackageResult> {
  const precomputed =
    typeof body.imageAnalysis === "string" && body.imageAnalysis.trim().length > 0
      ? body.imageAnalysis.trim()
      : "";

  if (precomputed) {
    return runVeoScenePackageFromAnalysis(
      {
        fullScript: body.fullScript,
        sceneNumber: body.sceneNumber,
        imageAnalysis: precomputed,
        languageLabel: body.languageLabel,
        workflowMode: body.workflowMode,
      },
      { apiKey: env.apiKey, model: env.model }
    );
  }

  const visionModel = env.visionModel?.trim() || "gpt-4o-mini";
  const analyze = await runVeoSceneAnalyze(
    {
      debutImageUrl: body.debutImageUrl,
      finImageUrl: body.finImageUrl,
      debutPrompt: body.debutPrompt,
      finPrompt: body.finPrompt,
    },
    { apiKey: env.apiKey, visionModel }
  );
  if (analyze.ok === false) {
    return { ok: false, status: analyze.status, error: analyze.error };
  }

  return runVeoScenePackageFromAnalysis(
    {
      fullScript: body.fullScript,
      sceneNumber: body.sceneNumber,
      imageAnalysis: analyze.analysis,
      languageLabel: body.languageLabel,
      workflowMode: body.workflowMode,
    },
    { apiKey: env.apiKey, model: env.model }
  );
}
