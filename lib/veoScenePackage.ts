/**
 * Shared: vision analysis (debut+fin) + VEO 3.1 single-scene JSON package (OpenAI).
 * Used by Vercel `api/ai/veo-scene-package.ts` and local `server.ts`.
 */

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
};

export type VeoSceneAnalyzeRequestBody = {
  debutImageUrl?: string;
  finImageUrl?: string;
  debutPrompt?: string;
  finPrompt?: string;
};

export type VeoSceneAnalyzeResult =
  | { ok: false; status: number; error: string }
  | { ok: true; analysis: string };

export type VeoScenePackageResult =
  | { ok: false; status: number; error: string }
  | {
      ok: true;
      analysis: string;
      /** Parsed JSON object, or null if model output was not valid JSON */
      scenePackage: unknown | null;
      rawPackageText?: string;
      parseError?: string;
    };

async function openaiChat(
  messages: unknown[],
  temperature: number,
  apiKey: string,
  model: string,
  opts?: { max_tokens?: number }
): Promise<string> {
  const payload: Record<string, unknown> = {
    model,
    messages,
    temperature,
  };
  if (opts?.max_tokens != null) {
    payload.max_tokens = opts.max_tokens;
  }
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 800);
    try {
      const j = JSON.parse(text) as { error?: { message?: string } };
      if (j.error?.message) msg = j.error.message;
    } catch {
      /* ignore */
    }
    const err = new Error(`OpenAI ${r.status}: ${msg}`) as Error & { httpStatus?: number };
    err.httpStatus = r.status;
    throw err;
  }
  let j: { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }> };
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
  return String(content).trim();
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

function buildVeoPackageUserPrompt(args: {
  fullScript: string;
  sceneNumber: number;
  imageAnalysis: string;
  languageLabel: string;
}): string {
  const { fullScript, sceneNumber, imageAnalysis, languageLabel } = args;
  const langJson = JSON.stringify(languageLabel);
  return `Generate one final VEO 3.1 scene package for a single Moroccan UGC ad scene.

You are creating only one scene, not the full ad.

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
  - whether text on screen belongs only to editing
- Do not mix details from other scenes except if needed for continuity.

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
- If the image analysis mentions text overlays in the reference images, do not generate subtitles, captions, or graphic text unless the selected scene clearly requires them as editable overlay elements.

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
  "textOnScreen": {
    "allowed": false,
    "lines": []
  },
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

const VISION_USER_PROMPT = `You are a video continuity analyst for UGC ads. Two images are provided in order:
IMAGE A = scene START frame (debut). IMAGE B = scene END frame (fin) for the SAME 8-second vertical clip.

Optional text prompts from the user (may be empty):
DEBUT_PROMPT: {{DEBUT}}
FIN_PROMPT: {{FIN}}

Describe factually for video generation:
- identity (same person?), face, hair, outfit
- room / background / lighting / time-of-day vibe
- product: visible? label readable? packaging colors/shape
- expressions and implied emotion change A→B
- hands, props, gestures
- camera distance / angle / implied motion A→B
- any text, logos, watermarks on the images (note: do not invent if absent)
- continuity risks (identity drift, outfit change, jump cuts)

Output plain prose only (no JSON). Be detailed but scannable (short paragraphs or bullets).`;

function buildVisionUserText(debutPrompt: string, finPrompt: string): string {
  return VISION_USER_PROMPT.replace("{{DEBUT}}", debutPrompt || "(none)").replace(
    "{{FIN}}",
    finPrompt || "(none)"
  );
}

/** Vision only — short serverless-friendly step (Vercel Hobby ~10s cap). */
export async function runVeoSceneAnalyze(
  body: VeoSceneAnalyzeRequestBody,
  env: { apiKey: string; visionModel?: string }
): Promise<VeoSceneAnalyzeResult> {
  const apiKey = env.apiKey;
  const visionModel = env.visionModel?.trim() || "gpt-4o";
  const debutImageUrl = typeof body.debutImageUrl === "string" ? body.debutImageUrl.trim() : "";
  const finImageUrl = typeof body.finImageUrl === "string" ? body.finImageUrl.trim() : "";
  const debutPrompt = typeof body.debutPrompt === "string" ? body.debutPrompt.trim() : "";
  const finPrompt = typeof body.finPrompt === "string" ? body.finPrompt.trim() : "";

  if (!debutImageUrl || !finImageUrl) {
    return { ok: false, status: 400, error: "debutImageUrl w finImageUrl (URLs dial tsawer) khasshom." };
  }

  try {
    const analysisText = await openaiChat(
      [
        {
          role: "user",
          content: [
            { type: "text", text: buildVisionUserText(debutPrompt, finPrompt) },
            {
              type: "image_url",
              image_url: { url: debutImageUrl, detail: "low" },
            },
            {
              type: "image_url",
              image_url: { url: finImageUrl, detail: "low" },
            },
          ],
        },
      ],
      0.3,
      apiKey,
      visionModel,
      { max_tokens: 2048 }
    );
    return { ok: true, analysis: analysisText };
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
    "fullScript" | "sceneNumber" | "languageLabel" | "imageAnalysis"
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
    const packagePrompt = buildVeoPackageUserPrompt({
      fullScript,
      sceneNumber,
      imageAnalysis,
      languageLabel,
    });

    const jsonRaw = await openaiChat(
      [{ role: "user", content: packagePrompt }],
      0.35,
      apiKey,
      textModel,
      { max_tokens: 8192 }
    );

    try {
      const scenePackage = JSON.parse(extractFirstJsonObject(jsonRaw));
      return { ok: true, analysis: imageAnalysis, scenePackage };
    } catch (parseErr) {
      return {
        ok: true,
        analysis: imageAnalysis,
        scenePackage: null,
        rawPackageText: jsonRaw,
        parseError: parseErr instanceof Error ? parseErr.message : String(parseErr),
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
      },
      { apiKey: env.apiKey, model: env.model }
    );
  }

  const visionModel = env.visionModel?.trim() || "gpt-4o";
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
    },
    { apiKey: env.apiKey, model: env.model }
  );
}
