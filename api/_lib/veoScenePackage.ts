import type { AiUsagePayload } from "./aiUsage.js";
import { parseOpenAiUsage } from "./aiUsage.js";
import { fetchOpenAiChat } from "./openaiRetry.js";

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
}): string {
  const { fullScript, sceneNumber, imageAnalysis, languageLabel, workflowMode = "ad" } = args;
  const langJson = JSON.stringify(languageLabel);
  const cloneModeBlock =
    workflowMode === "clone"
      ? `
CLONE VIDEO MODE (mandatory — same package depth as Video Flow in-app Veo):
- The FULL SCRIPT is a reference-video clone breakdown + SCENE METADATA, not a brand-new ad brief.
- Your job is to reproduce the reference clip for scene ${sceneNumber} using IMAGE ANALYSIS as the motion ground truth (debut still → fin still over 8 seconds).
- The IMAGE ANALYSIS contains "CHANGES A → B" and "TIMED ACTION SPLIT" — use TIMED ACTION SPLIT as the beat-by-beat motion schedule; veoPrompt actionFlow must mirror those windows exactly.
- veoPrompt MUST be long-form and production-ready: target 400–700+ words in clear English. Structure it like a senior Veo operator brief: opening frame, talent identity, wardrobe, room/background, lighting, lens feel (smartphone handheld), beat-by-beat subject motion, hands/face/hair, product handling if visible, expression arc, camera path, pacing for 8.0s, ambience, lip-sync only if reference shows speaking.
- negativePrompt MUST be a long comma-separated list (20+ constraints): identity drift, outfit change, room swap, captions, subtitles, watermark, bad anatomy, extra fingers, cinematic gloss, etc.
- Fill EVERY JSON field with substantive content — no empty strings except voiceover fields when the reference is clearly silent.
- actionFlow: all four 2-second blocks with specific action, expression, camera notes.
- shotDesign, motionPlan, continuity.mustPreserve (array of 6+ items), generationNotes: all detailed.
- Do NOT output a short or one-paragraph veoPrompt — match the richness of full Video Flow Veo packages.

`
      : "";

  return `Generate one final VEO 3.1 scene package for a single Moroccan UGC ${workflowMode === "clone" ? "clone-reference" : "ad"} scene.

You are creating only one scene, not the full ad.
${cloneModeBlock}

Inputs:

FULL SCRIPT:
${fullScript}


SCENE NUMBER:${sceneNumber}


IMAGE ANALYSIS:
${imageAnalysis}


Your job:
Read the full script, identify the requested scene using the scene number, extract the correct scene information, then use the image analysis as the main visual continuity source to generate one final detailed VEO 3.1 scene package.

Important:
- The full script contains the product context, format, platform, generation model, duration, total scenes, scene titles, goals, visuals, voiceover, and flow.
- You must identify the correct scene from the script using the given scene number only.
- You must use the image analysis as the main source of truth for visual continuity and motion.
- Return valid JSON only.
- Do not return markdown.
- Do not explain anything.
- Do not add any text before or after the JSON.
- Output exactly one JSON object.

Creative rules:
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
- Extract or infer:
  - scene name
  - scene goal
  - visual role of the scene
  - whether the scene is hook, product intro, usage, proof, result, or CTA
  - scene voiceover
  - whether the woman is speaking to camera
  - whether product is visible
- Do not mix details from other scenes except if needed for continuity.

On-screen text / overlays (IMPORTANT):
- Do NOT include a "textOnScreen" field in your JSON. Omit it completely.
- Do NOT propose CapCut/Reels overlay lines, sticker copy, hook text, prices, CTAs as text, or "lines"/"rationale" for post-production anywhere in this package.
- veoPrompt and negativePrompt must keep Veo clean: no baked subtitles, captions, lower-thirds, or readable UI text unless the source script explicitly requires one specific real-world sign already in the scene (rare); when unsure, describe visuals only with no readable text.

Continuity rules:
- Preserve the same woman identity.
- Preserve the same face, same hair, same outfit, same room, same lighting, same background, and same vibe when continuity is required.
- Preserve all important details found in the image analysis.
- The scene must feel like a smooth transition, not two disconnected frames.

Speaking rules:
- If the selected scene includes speaking or voiceover, the woman in the video must be the one speaking directly to camera.
- Explicitly mention natural realistic lip sync and believable mouth movement.
- Make it feel like real UGC speaking, not an external voiceover.

Product rules:
- If the selected scene includes a visible product, keep the exact same bottle design, label, cap, colors, illustration, and packaging unchanged.
- Keep the label readable when visible.
- Never redesign the product.

Visual rules:
- Use the image analysis to infer:
  - facial expression progression
  - hand movement
  - hair movement
  - camera framing
  - implied motion
  - environment continuity
  - realism risks
- Reference stills may contain incidental text: ignore it for Veo continuity unless the script explicitly requires echoing a specific real sign; never invent overlay or caption copy in this JSON.

Naturally include these constraints inside the final prompt and negative prompt:
- no subtitles
- no captions
- no watermark
- no logo
- no fake UI
- no unnecessary graphics
- no identity drift
- no outfit change
- no room change
- no lighting change
- no bad anatomy
- no extra fingers
- no unrealistic beauty filter
- no exaggerated transformation
- no chaotic camera shake
- no over-cinematic glossy commercial style

Use this exact JSON string value for the field "language" unless the script clearly specifies another spoken language for this scene: ${langJson}

Return exactly this JSON structure (fill every string field; booleans and numbers as appropriate; sceneNumber must be ${sceneNumber}):

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
    "lipSyncRequired": true
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

One-Line Summary for Prompt Writer:
[Single sentence: what must happen visually from A to B in 8 seconds]`;

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
  }
): string {
  const veoDuration = timing?.veoOutputDurationSec ?? 8;
  const refDelta =
    Number.isFinite(timing?.referenceDebutSec) &&
    Number.isFinite(timing?.referenceFinSec)
      ? Math.max(0, (timing!.referenceFinSec as number) - (timing!.referenceDebutSec as number))
      : 0;
  const template = workflowMode === "clone" ? VISION_USER_PROMPT_CLONE : VISION_USER_PROMPT_AD;
  return template
    .replace("{{DEBUT}}", debutPrompt || "(none)")
    .replace("{{FIN}}", finPrompt || "(none)")
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
  const usesInlineImages =
    debutImageUrl.startsWith("data:") || finImageUrl.startsWith("data:");
  /** `high` only with HTTPS URLs — data URLs on Vercel are already compressed client-side. */
  const imageDetail =
    workflowMode === "clone" && !usesInlineImages ? "high" : "auto";
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

  if (!debutImageUrl || !finImageUrl) {
    return { ok: false, status: 400, error: "debutImageUrl w finImageUrl (URLs dial tsawer) khasshom." };
  }

  const inlinePayloadBytes =
    (debutImageUrl.startsWith("data:") ? debutImageUrl.length : 0) +
    (finImageUrl.startsWith("data:") ? finImageUrl.length : 0);
  if (inlinePayloadBytes > 3_800_000) {
    return {
      ok: false,
      status: 413,
      error:
        "Tsawer kbira bzaf f request (data URL). Compressiw frames wla uploadiw b UploadThing — max ~3.5MB l-jouj tsawer.",
    };
  }

  try {
    const { content: analysisText, usage } = await openaiChat(
      [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: buildVisionUserText(debutPrompt, finPrompt, workflowMode, {
                sceneNumber: Number.isFinite(sceneNumber) ? sceneNumber : undefined,
                referenceDebutSec: Number.isFinite(referenceDebutSec)
                  ? referenceDebutSec
                  : undefined,
                referenceFinSec: Number.isFinite(referenceFinSec) ? referenceFinSec : undefined,
                veoOutputDurationSec,
              }),
            },
            {
              type: "image_url",
              image_url: { url: debutImageUrl, detail: imageDetail },
            },
            {
              type: "image_url",
              image_url: { url: finImageUrl, detail: imageDetail },
            },
          ],
        },
      ],
      0.3,
      apiKey,
      visionModel,
      { max_tokens: workflowMode === "clone" ? 4096 : 2048, operation: "veo-scene-analyze" }
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
    "fullScript" | "sceneNumber" | "languageLabel" | "imageAnalysis" | "workflowMode"
  >,
  env: { apiKey: string; model?: string }
): Promise<VeoScenePackageResult> {
  const apiKey = env.apiKey;
  const textModel = env.model?.trim() || "gpt-4o-mini";

  const fullScript = typeof body.fullScript === "string" ? body.fullScript.trim() : "";
  const sceneNumber = typeof body.sceneNumber === "number" ? body.sceneNumber : Number(body.sceneNumber);
  const imageAnalysis =
    typeof body.imageAnalysis === "string" ? body.imageAnalysis.trim() : "";
  const languageLabel =
    typeof body.languageLabel === "string" && body.languageLabel.trim()
      ? body.languageLabel.trim()
      : "Moroccan Darija";

  if (!fullScript || !Number.isFinite(sceneNumber) || sceneNumber < 1) {
    return { ok: false, status: 400, error: "fullScript w sceneNumber (>=1) khasshom ykouno m3molin." };
  }
  if (!imageAnalysis) {
    return { ok: false, status: 400, error: "imageAnalysis khassa (jibha men /api/ai/veo-scene-analyze)." };
  }

  try {
    const workflowMode =
      body.workflowMode === "clone" || body.workflowMode === "ad" ? body.workflowMode : "ad";

    const packagePrompt = buildVeoPackageUserPrompt({
      fullScript,
      sceneNumber,
      imageAnalysis,
      languageLabel,
      workflowMode,
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
