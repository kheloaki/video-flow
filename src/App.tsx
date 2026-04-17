/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  Plus, 
  Trash2, 
  Sparkles, 
  Copy, 
  Check, 
  BookOpen, 
  PenTool,
  Loader2,
  AlertCircle,
  LogIn,
  KeyRound,
  LogOut,
  Package,
  Video,
  FileVideo,
  Save,
  History,
  ChevronDown,
  ChevronUp,
  Bookmark,
  Settings,
  Send,
  X,
  Upload,
  Edit2,
  CheckCircle,
  Download,
  Images
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';
import localforage from 'localforage';
import JSZip from 'jszip';

import type { User } from "@supabase/supabase-js";
import { apiUrl } from "./apiBase";
import { supabase } from "./supabase";
import { uploadFiles } from './utils/uploadthing';

/** Firestore-compatible timestamp shape for existing sort code */
function createdAtFromIso(iso: string | null | undefined) {
  const t = iso ? new Date(iso).getTime() : 0;
  return { toMillis: () => t };
}

/** Same suffix as shown in UI as `#xxxxx` (last 5 chars of history UUID). */
function videoPageDisplayId(fullHistoryId: string): string {
  return fullHistoryId.slice(-5);
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

function transcriptionErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);
  const d = raw.trim().slice(0, 320);
  const low = d.toLowerCase();
  if (!d) return "Mouchkil f-transcription. T2ked men connexion wla jereb video sgher.";
  if (
    d.includes("GEMINI_API_KEY") ||
    low.includes("api key not valid") ||
    low.includes("invalid api key") ||
    (low.includes("api key") && low.includes("google"))
  )
    return "GEMINI_API_KEY ma-shi s7i7a wla nqsa. Zidha f .env (racine dial l-projet) w 3awd demmar npm run dev.";
  if (
    low.includes("429") ||
    low.includes("quota") ||
    low.includes("rate limit") ||
    low.includes("resource exhausted")
  )
    return "Quota / rate limit dial Gemini (transcription). Jereb men ba3d wla chouf ai.google.dev / billing.";
  if (low.includes("not found") && low.includes("model"))
    return "Model ma-m7aynach. 7awel GEMINI_TRANSCRIPTION_MODEL=gemini-2.5-flash f .env.";
  return `Transcription: ${d}`;
}

function generationErrorMessage(err: unknown): string {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : String(err);
  const d = raw.trim().slice(0, 400);
  const low = d.toLowerCase();
  if (!d) return "Mouchkil f-generi. T2ked men connexion.";
  if (
    low.includes("openai_api_key") ||
    low.includes("api key") ||
    low.includes("invalid api") ||
    low.includes("incorrect api key") ||
    low.includes("unauthorized")
  )
    return "OPENAI_API_KEY ma-shi s7i7a wla nqsa. Zidha f .env w 3awd demmar npm run dev.";
  if (low.includes("429") || low.includes("quota") || low.includes("rate limit"))
    return "Quota / rate limit dial OpenAI t3ba. Jereb men ba3d wla chouf billing f platform.openai.com.";
  if (low.includes("not found") && low.includes("model"))
    return "Model ma-m7aynach. 7awel OPENAI_CHAT_MODEL=gpt-4o-mini f .env.";
  if (
    low.includes("aborted") ||
    low.includes("abort") ||
    low.includes("signal is aborted") ||
    (err instanceof DOMException && err.name === "AbortError")
  )
    return "Timeout 3la OpenAI (180s / machhad). Jereb men ba3d — ila kaybqa, sgher script wla chof connexion.";
  if (low.includes("failed to fetch") || low.includes("networkerror"))
    return "Ma-t9rachch l-server dial l-API. T2ked: npm run dev 3la port 3000 (w Vite 3la 5173) wla zid VITE_DEV_API_ORIGIN f .env.";
  return `Generi: ${d.slice(0, 280)}`;
}

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const parseBrokenWebhookResponse = (text: string) => {
  try {
    let script = "";
    let scenes: any = null;
    
    // Extract script
    const scriptRegex = /"script"\s*:\s*"(.*?)"(?=\s*,\s*"scenes"|\s*\})/s;
    const scriptMatch = text.match(scriptRegex);
    if (scriptMatch) {
      script = scriptMatch[1].replace(/\\"/g, '"');
    }
    
    // Extract scenes (string format)
    const scenesStrRegex = /"scenes"\s*:\s*"(.*?)"(?=\s*,\s*"script"|\s*\})/s;
    const scenesStrMatch = text.match(scenesStrRegex);
    if (scenesStrMatch) {
      let scenesStr = scenesStrMatch[1].replace(/\\"/g, '"');
      try {
        scenes = JSON.parse(scenesStr.replace(/\n/g, '\\n').replace(/\r/g, '\\r'));
      } catch(e) {
        scenes = scenesStr;
      }
    } else {
      // Extract scenes (array format)
      const scenesArrRegex = /"scenes"\s*:\s*(\[.*?\])(?=\s*,\s*"script"|\s*\})/s;
      const scenesArrMatch = text.match(scenesArrRegex);
      if (scenesArrMatch) {
        let scenesStr = scenesArrMatch[1];
        try {
          scenes = JSON.parse(scenesStr.replace(/\n/g, '\\n').replace(/\r/g, '\\r'));
        } catch(e) {
          scenes = scenesStr;
        }
      }
    }
    
    if (script || scenes) {
      return { script, scenes };
    }
  } catch (e) {
    console.error("Fallback parser error", e);
  }
  return null;
};

// Types
interface Product {
  id: string;
  name: string;
  description: string;
  scriptDetails?: string;
  ownerId: string;
  createdAt: any;
  modelImageUrl?: string;
  productImageUrl?: string;
}

interface VideoData {
  id: string;
  productId: string;
  name: string;
  transcription: string;
  exampleKind?: 'same_product' | 'same_effect';
  thumbnailBase64?: string;
  createdAt: any;
  ownerId: string;
}

interface PendingVideo {
  id: string;
  productId: string;
  file: File;
  url: string;
  exampleKind: 'same_product' | 'same_effect';
  status: 'pending' | 'transcribing' | 'done' | 'error';
  error?: string;
}

interface SavedScript {
  id: string;
  productId: string;
  customPrompt: string;
  content: string;
  scenes?: any[];
  createdAt: any;
  ownerId: string;
}

interface WebhookHistoryItem {
  id: string;
  timestamp: string;
  data: any;
  rawText: string | null;
  videoUrl: string | null;
  productId: string | null;
  name?: string;
  sentToWebhook?: boolean;
  sceneImages?: Record<string, string>;
  ownerId?: string;
  createdAt?: any;
}

// Error handling helper
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function formatDbErrorForLog(error: unknown): string {
  if (error == null) return "unknown";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const o = error as {
      message?: string;
      code?: string;
      details?: string;
      hint?: string;
    };
    const parts = [o.message, o.code && `code=${o.code}`, o.details && `details=${o.details}`].filter(
      Boolean
    );
    return parts.join(" — ") || JSON.stringify(error);
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function handleDbError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: formatDbErrorForLog(error),
    operationType,
    path,
  };
  console.error("Database error:", errInfo);
}

function supabaseErrorMessage(err: { message?: string; code?: string } | null): string {
  if (!err) return "Unknown error";
  const code = err.code ? ` (${err.code})` : "";
  return `${err.message ?? "Request failed"}${code}`;
}

type ModelGender = "any" | "woman" | "man";
type ModelAge = "any" | "young" | "aged";
type VoiceScriptLanguage =
  | "darija"
  | "darija_french"
  | "french"
  | "msa"
  | "english"
  | "spanish"
  | "portuguese"
  | "swahili"
  | "hausa"
  | "amharic"
  | "yoruba"
  | "zulu"
  | "other";

type VoiceAccent =
  | "neutral"
  | "moroccan"
  | "tanzanian"
  | "kenyan"
  | "nigerian"
  | "ghanaian"
  | "south_african"
  | "ethiopian"
  | "other";

/** Human-readable value injected into prompts as SCRIPT_LANGUAGE. */
function voiceLanguageDisplayForPrompt(lang: VoiceScriptLanguage, langOther: string): string {
  const o = langOther.trim();
  switch (lang) {
    case "darija":
      return "Moroccan Darija (الدارجة المغربية)";
    case "darija_french":
      return "Moroccan Darija + French (natural code-switching)";
    case "french":
      return "French";
    case "msa":
      return "Modern Standard Arabic (MSA / الفصحى)";
    case "english":
      return "English";
    case "spanish":
      return "Spanish";
    case "portuguese":
      return "Portuguese";
    case "swahili":
      return "Swahili";
    case "hausa":
      return "Hausa";
    case "amharic":
      return "Amharic";
    case "yoruba":
      return "Yorùbá";
    case "zulu":
      return "Zulu";
    case "other":
      return o || "Other (unspecified — use clear, simple English)";
    default:
      return "Moroccan Darija (الدارجة المغربية)";
  }
}

/** Human-readable value injected into prompts as SCRIPT_ACCENT. */
function voiceAccentDisplayForPrompt(accent: VoiceAccent, accentOther: string): string {
  const o = accentOther.trim();
  switch (accent) {
    case "neutral":
      return "Neutral / international";
    case "moroccan":
      return "Moroccan";
    case "tanzanian":
      return "Tanzanian";
    case "kenyan":
      return "Kenyan";
    case "nigerian":
      return "Nigerian";
    case "ghanaian":
      return "Ghanaian";
    case "south_african":
      return "South African";
    case "ethiopian":
      return "Ethiopian";
    case "other":
      return o || "Custom (match SCRIPT_LANGUAGE register)";
    default:
      return "Moroccan";
  }
}

/** Named variables every generation prompt must respect (language + accent). */
function scriptLanguageAccentVariablesBlock(args: {
  lang: VoiceScriptLanguage;
  langOther: string;
  accent: VoiceAccent;
  accentOther: string;
}): string {
  const LANGUAGE = voiceLanguageDisplayForPrompt(args.lang, args.langOther);
  const ACCENT = voiceAccentDisplayForPrompt(args.accent, args.accentOther);
  return `=== SCRIPT OUTPUT VARIABLES (fixed for this request) ===
SCRIPT_LANGUAGE: ${LANGUAGE}
SCRIPT_ACCENT: ${ACCENT}

BINDING RULES:
- All spoken dialogue, hooks, CTAs, and quoted on-screen spoken lines MUST match SCRIPT_LANGUAGE.
- SCRIPT_ACCENT shapes delivery: rhythm, local phrasing, and word choice where it still fits SCRIPT_LANGUAGE — natural and easy to pronounce (no caricature spelling).
- Do not switch language mid-script unless SCRIPT_LANGUAGE is explicitly "Darija + French" code-switching.
- If SCRIPT_LANGUAGE is French or English but SCRIPT_ACCENT is Moroccan (or another region), use that region’s real spoken flavor in that language (e.g. Moroccan French phrasing), not a different language.
===`;
}

function generationExpertRole(phase: "idea" | "voice" | "visuals" | "video"): string {
  const core =
    "You are an expert short-form social ad creative (TikTok / Reels / UGC). Always obey SCRIPT_LANGUAGE and SCRIPT_ACCENT from the block below — they override any default examples.";
  switch (phase) {
    case "idea":
      return `${core}\nPropose a sharp ad concept (not the final voiceover yet).`;
    case "voice":
      return `${core}\nOutput ONLY spoken words for the full ad.`;
    case "visuals":
      return `${core}\nYou write image prompts for reference stills (model sheet + background plate).`;
    case "video":
      return `${core}\nYou write the full on-screen / scene breakdown while locking spoken lines verbatim.`;
  }
}

function styleExamplesFallbackForPrompt(): string {
  return "No style examples loaded for this selection — invent fresh pacing and hooks that still match SCRIPT_LANGUAGE + SCRIPT_ACCENT (creator-realistic, easy to pronounce).";
}

function videoBreakdownStructureNote(lang: VoiceScriptLanguage): string {
  if (lang === "darija" || lang === "darija_french" || lang === "msa") {
    return "Use Arabic / Darija-friendly labels and structure in the template below (headings, stage directions, bracket tags). Spoken lines inside [النص الصوتي - Voice Script] must stay verbatim from the LOCKED VOICE SCRIPT (SCRIPT_LANGUAGE).";
  }
  return "Keep the template’s Arabic/Darija section titles and bracket labels exactly as given (layout consistency). Spoken lines inside [النص الصوتي - Voice Script] must stay verbatim from the LOCKED VOICE SCRIPT (SCRIPT_LANGUAGE + SCRIPT_ACCENT delivery).";
}

function onCameraModelLookFromAccentBlock(): string {
  return `ON-CAMERA MODEL LOOK (2×2 reference): Photorealistic, natural, contemporary “real creator” energy. Align subtly with SCRIPT_ACCENT for plausible demographics (skin tone, hair, styling) and CASTING — tasteful and respectful; avoid stereotypes or costume clichés.`;
}

/** “Kifach bghiti l-video tkon?” — must win over style examples so outputs don’t feel generic/repeated. */
function formatUserToneBlockForPrompt(customPrompt: string): string {
  const t = customPrompt.trim();
  if (!t) {
    return `=== USER TONE & DIRECTION (empty) ===
The user did not add extra tone notes. Default: punchy, clear, creator-authentic short-form ad — still avoid copying example hooks verbatim.`;
  }
  return `=== USER TONE & DIRECTION (“Kifach bghiti l-video tkon?”) — HIGHEST PRIORITY ===
${t}

MANDATORY:
- Shape hook angle, pacing, humor vs serious, storytelling vs direct sell, energy, POV, CTA, and word choice from THIS block.
- If Style Examples below suggest a different vibe, IGNORE the conflicting parts of the examples — keep only loose rhythm hints if helpful.
- Do NOT output a generic “same as last time” script or idea: the opening beat and CTA must clearly reflect THIS brief (not a paraphrase of examples).
===`;
}

function voiceLanguagePromptBlock(args: {
  lang: VoiceScriptLanguage;
  langOther: string;
  accent: VoiceAccent;
  accentOther: string;
}): string {
  const lang = args.lang;
  const header = scriptLanguageAccentVariablesBlock(args);

  switch (lang) {
    case "darija":
      return `${header}

VOICE DETAILS — apply SCRIPT_LANGUAGE + SCRIPT_ACCENT:
Moroccan Darija (الدارجة المغربية) for ALL spoken lines — same colloquial level from the first word to the last.

PRONUNCIATION — CRITICAL (Darija): Make every line easy to say out loud on camera or with TTS.
- The “Style Examples” in the prompt may be transcriptions in MSA, mixed Arabic, or older ad copy — treat them ONLY as rhythm, energy, and structure hints. NEVER copy their formal Arabic phrasing or vocabulary into your output; translate the same ideas into real spoken Darija (كي…، غادي، دابا، شنو، واش، بزاف، مزيان، شري، دير، شوف، راه… style), not classroom Arabic.
- Do NOT start with formal Arabic “ad copy” openings (e.g. heavy MSA like “عندك آلام في الظهر” / “هل تعاني من…”) and then switch to Darija — the whole script must sound like one consistent Darija speaker throughout; SCRIPT_ACCENT shapes delivery and any allowed non-Darija snippets (e.g. French loans), not a switch into another dialect of Arabic.
- Avoid heavy Classical Arabic (فصحى), rare literary words, case endings, and stiff MSA — prefer everyday Moroccan words people actually say in speech.
- Avoid tongue-twisters, cramped phrasing, and awkward consonant clusters; use short, clear sentences.
- Prefer simple, common Darija over fancy or “elevated” synonyms that are hard to pronounce.
- If you write in Arabic letters, use natural Darija orthography as on Moroccan social (e.g. كيعطي، غادي، ما تبقاش) — not MSA newsreader phrasing with the same ideas re-written in فصحى.
- Brand/product names: keep official spelling if required, but keep surrounding wording plain and natural to say.`;
    case "darija_french":
      return `${header}

VOICE DETAILS — apply SCRIPT_LANGUAGE + SCRIPT_ACCENT:
Natural Moroccan code-switching — Darija with French where people really use it in TikTok ads and daily talk.
SCRIPT_ACCENT steers how local the French feels and how dense the code-switch is (still believable for the chosen region).
Keep both languages easy to pronounce: no ornate or rare French, no heavy فصحى in Darija stretches.
- Style examples may be in MSA or formal Arabic — do NOT mirror that register in the Darija parts; keep Darija colloquial even when you borrow hook structure from examples.
- Do not mix a formal Arabic intro (fully vocalized or MSA-style) with colloquial body — keep one consistent spoken register.
- If Arabic script appears, it must be Darija-style wording, not formal marketing Arabic.`;
    case "french":
      return `${header}

VOICE DETAILS — apply SCRIPT_LANGUAGE + SCRIPT_ACCENT:
French for all spoken lines — natural, clear spoken French suited to short social ads (avoid stiff admin-style French).
Let SCRIPT_ACCENT guide everyday phrasing, fillers, and rhythm (e.g. Moroccan French vs Parisian) without breaking intelligibility.`;
    case "msa":
      return `${header}

VOICE DETAILS — apply SCRIPT_LANGUAGE + SCRIPT_ACCENT:
Modern Standard Arabic (العربية الفصحى) for all spoken lines — clear and sayable for short video (avoid archaic or overly poetic wording).
SCRIPT_ACCENT may lightly influence pacing and how “spoken” vs “written” it feels, but do not replace MSA with a different Arabic dialect unless SCRIPT_LANGUAGE is Darija.`;
    case "english":
    case "spanish":
    case "portuguese":
    case "swahili":
    case "hausa":
    case "amharic":
    case "yoruba":
    case "zulu":
    case "other": {
      const langName = voiceLanguageDisplayForPrompt(lang, args.langOther);
      return `${header}

VOICE DETAILS — apply SCRIPT_LANGUAGE + SCRIPT_ACCENT:
${langName} for ALL spoken lines.
PRONUNCIATION — CRITICAL: Keep the voiceover simple, natural, and easy to read out loud. Avoid rare words, tongue-twisters, and very long sentences.`;
    }
    default:
      return voiceLanguagePromptBlock({
        lang: "darija",
        langOther: "",
        accent: "moroccan",
        accentOther: "",
      });
  }
}

/** Full harakat mainly for MSA voice mode; Darija modes avoid textbook vocalization. */
const TASHKEEL_INSTRUCTIONS_MSA = `TASHKEEL / HARAKAT (تشكيل): For any word in Arabic script that is uncommon, long, easy to misread, or hard to pronounce, add full diacritics (فتحة، كسرة، ضمة، سكون، تنوين، شدة) on that word. Very short everyday words may stay unvocalized if obvious.`;

const ORTHOGRAPHY_DARIJA_ARABIC_SCRIPT = `SCRIPT LOOK (Darija in Arabic letters): Write like Moroccan TikTok/social voiceovers — normal Arabic letters, same style start to finish.
- Do NOT add harakat to every word or whole sentences (no “schoolbook” or Quranic-style full vocalization).
- Default: no diacritics. Only if one isolated word is truly ambiguous for reading or TTS, you may mark that word lightly — never the full line.
- The text must read as spoken Darija, not formal Arabic lines dressed in diacritics.`;

const ORTHOGRAPHY_DARIJA_FRENCH = `SCRIPT LOOK (Darija + French): Latin chat spelling is fine for Darija/French. For at most one genuinely hard Darija term you may add once Arabic in parentheses with light tashkeel, e.g. daba (دابا) — do not paste long fully vocalized Arabic paragraphs.
If you use Arabic script for Darija lines, same rule as Darija-only: no full-sentence harakat; colloquial Darija wording only.`;

const ORTHOGRAPHY_FRENCH_ONLY = `SCRIPT LOOK: Write the voiceover in Latin script (French). No Arabic diacritics.`;

function tashkeelAndOrthographyBlock(lang: VoiceScriptLanguage): string {
  switch (lang) {
    case "darija":
      return ORTHOGRAPHY_DARIJA_ARABIC_SCRIPT;
    case "darija_french":
      return ORTHOGRAPHY_DARIJA_FRENCH;
    case "french":
      return ORTHOGRAPHY_FRENCH_ONLY;
    case "msa":
      return TASHKEEL_INSTRUCTIONS_MSA;
    case "english":
    case "spanish":
    case "portuguese":
    case "swahili":
    case "hausa":
    case "amharic":
    case "yoruba":
    case "zulu":
    case "other":
      return `SCRIPT LOOK: Write in the normal script for the chosen language (usually Latin). Keep it easy to read and pronounce; avoid heavy diacritics unless the language normally requires them.`;
    default:
      return ORTHOGRAPHY_DARIJA_ARABIC_SCRIPT;
  }
}

function formatVeoAvoidWordsBlock(raw: string): string {
  const parts = raw
    .split(/[\n,،؛;|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  return `GOOGLE VEO 3 / VIDEO — FORBIDDEN WORDS (CRITICAL): Never use these terms (or obvious close variants / unsafe wording) in dialogue, on-screen text, visual descriptions, or CTAs. Replace with safe, on-brand wording that still matches SCRIPT_LANGUAGE and SCRIPT_ACCENT:
${parts.map((p) => `- ${p}`).join("\n")}`;
}

/** Fixed pacing: each scene is this many seconds. */
const SECONDS_PER_SCENE = 8;

function parseSceneCountForVideo(sceneCount: string): number {
  const n = parseInt(sceneCount, 10);
  return Number.isFinite(n) && n >= 2 && n <= 10 ? n : 5;
}

function totalVideoSecondsFromScenes(sceneCount: string): number {
  return parseSceneCountForVideo(sceneCount) * SECONDS_PER_SCENE;
}

function wordCountHintFromTotalSeconds(totalSec: number): string {
  if (totalSec <= 16)
    return "CRITICAL: The script MUST be VERY SHORT (max 30-40 words total). Keep it extremely punchy and fast. DO NOT write a long script.";
  if (totalSec <= 24)
    return "CRITICAL: The script MUST be SHORT (around 45-55 words total). Fast-paced, straight to the point.";
  if (totalSec <= 32)
    return "CRITICAL: The script MUST be SHORT (around 55-65 words total). Fast-paced, straight to the point.";
  if (totalSec <= 40)
    return "CRITICAL: The script MUST be SHORT-MEDIUM (around 70-85 words total). Good pacing.";
  if (totalSec <= 48)
    return "CRITICAL: The script MUST be MEDIUM length (around 100-120 words total).";
  if (totalSec <= 64)
    return "CRITICAL: The script MUST be MEDIUM-LONG length (around 130-145 words total).";
  return "CRITICAL: The script MUST be LONG (150+ words total). Detailed storytelling.";
}

const USED_VISUAL_PROMPTS_LS_KEY = "darijaScriptAi.usedVisualPrompts";
const USED_VISUAL_PROMPTS_MAX = 50;

type UsedVisualPromptsStore = {
  models: string[];
  backgrounds: string[];
};

function loadUsedVisualPrompts(): UsedVisualPromptsStore {
  if (typeof window === "undefined") return { models: [], backgrounds: [] };
  try {
    const raw = localStorage.getItem(USED_VISUAL_PROMPTS_LS_KEY);
    if (!raw) return { models: [], backgrounds: [] };
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== "object") return { models: [], backgrounds: [] };
    const o = j as Record<string, unknown>;
    const models = Array.isArray(o.models)
      ? o.models.map((x) => String(x).trim()).filter(Boolean)
      : [];
    const backgrounds = Array.isArray(o.backgrounds)
      ? o.backgrounds.map((x) => String(x).trim()).filter(Boolean)
      : [];
    return { models, backgrounds };
  } catch {
    return { models: [], backgrounds: [] };
  }
}

function saveUsedVisualPrompts(store: UsedVisualPromptsStore) {
  try {
    localStorage.setItem(USED_VISUAL_PROMPTS_LS_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

function appendUsedVisualPrompts(modelPrompt: string, backgroundPrompt: string) {
  const m = modelPrompt.trim();
  const b = backgroundPrompt.trim();
  if (!m || !b) return;
  const cur = loadUsedVisualPrompts();
  saveUsedVisualPrompts({
    models: [...cur.models, m].slice(-USED_VISUAL_PROMPTS_MAX),
    backgrounds: [...cur.backgrounds, b].slice(-USED_VISUAL_PROMPTS_MAX),
  });
}

function formatUsedVisualPromptsForAi(): string {
  const { models, backgrounds } = loadUsedVisualPrompts();
  if (models.length === 0 && backgrounds.length === 0) {
    return "PREVIOUS PROMPTS IN THIS BROWSER: none yet (first generation — no reuse constraints).";
  }
  const clip = (s: string) => (s.length > 380 ? `${s.slice(0, 377)}…` : s);
  const modelBlock = models
    .map((s, i) => `${i + 1}. ${clip(s)}`)
    .join("\n");
  const bgBlock = backgrounds.map((s, i) => `${i + 1}. ${clip(s)}`).join("\n");
  return `PREVIOUSLY USED MODEL PROMPT (same browser, Step 3) — you MUST NOT reproduce the same on-camera recipe: same pose family, same wardrobe vibe, same lens/lighting combo, or same facial micro-expression pattern. Invent a clearly DIFFERENT talent presentation:
${modelBlock || "—"}

PREVIOUSLY USED BACKGROUND PROMPT (same browser) — you MUST NOT reproduce the same environment: same room type, same palette, same prop arrangement, same time-of-day mood. Invent a clearly DIFFERENT set:
${bgBlock || "—"}`;
}

/** Rebuild locked markdown for Step 4 / webhooks from edited model + background blocks */
function buildStep3VisualMarkdown(modelBlock: string, background: string): string {
  return `## Model\n\n${modelBlock.trim()}\n\n## Background\n\n${background.trim()}`.trim();
}

/**
 * Expect ## Model (one block: single prompt for the whole sheet) then ## Background.
 */
const DEFAULT_STEP3_BACKGROUND_PROMPT =
  "ONE calm real interior for ALL scenes (same simple room every time — not a white studio): sparse furnishings, few visible objects, not cluttered; believable wall and surfaces (e.g. bathroom with mirror and tile, or quiet bedroom corner); soft natural daylight feel, photorealistic — absolutely no people, no hands, no equipment; not a plain empty white void.";

function parseStep3ModelBackground(full: string): { model: string; background: string } | null {
  const t = full.trim();
  const modelRe = /^##\s*Model\b/im;
  const bgRe = /^##\s*Background\b/im;
  const mm = t.match(modelRe);
  if (!mm || mm.index === undefined) return null;
  const bm = t.match(bgRe);

  let model: string;
  let background: string;

  if (bm && bm.index !== undefined && bm.index > mm.index) {
    model = t.slice(mm.index + mm[0].length, bm.index).trim();
    const afterBg = bm.index + bm[0].length;
    background = t.slice(afterBg).trim().split(/^##\s/m)[0]?.trim() ?? "";
  } else {
    model = t.slice(mm.index + mm[0].length).trim().split(/^##\s/m)[0]?.trim() ?? "";
    background = "";
  }

  if (!model) return null;
  if (!background) {
    background = DEFAULT_STEP3_BACKGROUND_PROMPT;
  }
  return { model, background };
}

/** Legacy drafts: four angle strings → one character-sheet prompt */
function migrateOldFourAnglesToSinglePrompt(angles: string[]): string {
  const hints = [
    "panel 1 front-facing",
    "panel 2 three-quarter",
    "panel 3 three-quarter other side",
    "panel 4 profile / back / product-use",
  ];
  return `A single photorealistic image divided into four equal quadrants (2×2 grid in one picture), same identical person and outfit in each quadrant, pure white seamless studio background, no product or packaging in hands or in frame, no on-image text. ${angles
    .map((a, i) => `${hints[i] ?? `panel ${i + 1}`}: ${a.trim()}`)
    .join(" ")}`;
}

const WORKSPACE_DRAFT_LS_KEY = "darijaScriptAi.workspaceDraft";

type WorkspaceTabId =
  | "products"
  | "generate"
  | "saved"
  | "videoResult"
  | "veoResult"
  | "settings";

type WorkspaceDraftV1 = {
  v: 1;
  savedAt: string;
  selectedProductId: string;
  customPrompt: string;
  sceneCount: string;
  modelGender: ModelGender;
  modelAge: ModelAge;
  scriptIdea: string | null;
  voiceOnlyScript: string | null;
  visualPromptsText: string | null;
  /** Single prompt: 2×2 character sheet + identity (not four separate prompts) */
  modelImagePrompt: string | null;
  backgroundPromptOnly: string | null;
  generatedScript: string | null;
  generatedScenes: unknown[] | null;
  activeTab: WorkspaceTabId;
  useModelRef: boolean;
  useProductRef: boolean;
  useBackgroundRef: boolean;
  modelImageUrl: string | null;
  productImageUrl: string | null;
  backgroundImageUrl: string | null;
  isScriptCollapsed: boolean;
  selectedHistoryId: string | null;
};

const WORKSPACE_TABS: WorkspaceTabId[] = [
  "products",
  "generate",
  "saved",
  "videoResult",
  "veoResult",
  "settings",
];

function parseSceneCountDraft(raw: unknown): string {
  const s = String(raw ?? "5");
  const n = parseInt(s, 10);
  if (Number.isFinite(n) && n >= 2 && n <= 10) return String(n);
  return "5";
}

function parseGenderDraft(raw: unknown): ModelGender {
  return raw === "woman" || raw === "man" || raw === "any" ? raw : "any";
}

function parseAgeDraft(raw: unknown): ModelAge {
  return raw === "young" || raw === "aged" || raw === "any" ? raw : "any";
}

function parseTabDraft(raw: unknown): WorkspaceTabId {
  return WORKSPACE_TABS.includes(raw as WorkspaceTabId) ? (raw as WorkspaceTabId) : "products";
}

function parseNullableString(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw === "string") return raw;
  return null;
}

function parseModelAnglesDraft(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const out = raw.map((x) => (typeof x === "string" ? x : ""));
  return out.every((s) => s.length > 0) ? out : null;
}

function loadWorkspaceDraft(): WorkspaceDraftV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(WORKSPACE_DRAFT_LS_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (!j || j.v !== 1) return null;
    const scenes = Array.isArray(j.generatedScenes) ? j.generatedScenes : null;
    return {
      v: 1,
      savedAt: typeof j.savedAt === "string" ? j.savedAt : "",
      selectedProductId: typeof j.selectedProductId === "string" ? j.selectedProductId : "",
      customPrompt: typeof j.customPrompt === "string" ? j.customPrompt : "",
      sceneCount: parseSceneCountDraft(j.sceneCount),
      modelGender: parseGenderDraft(j.modelGender),
      modelAge: parseAgeDraft(j.modelAge),
      scriptIdea: parseNullableString(j.scriptIdea),
      voiceOnlyScript: parseNullableString(j.voiceOnlyScript),
      visualPromptsText: parseNullableString(j.visualPromptsText),
      modelImagePrompt: (() => {
        const direct = parseNullableString(
          (j as Record<string, unknown>).modelImagePrompt
        );
        if (direct) return direct;
        const oldAngles = parseModelAnglesDraft(
          (j as Record<string, unknown>).modelAnglePrompts
        );
        return oldAngles ? migrateOldFourAnglesToSinglePrompt(oldAngles) : null;
      })(),
      backgroundPromptOnly: parseNullableString(j.backgroundPromptOnly),
      generatedScript: parseNullableString(j.generatedScript),
      generatedScenes: scenes,
      activeTab: parseTabDraft(j.activeTab),
      useModelRef: j.useModelRef === true,
      useProductRef: j.useProductRef === true,
      useBackgroundRef: j.useBackgroundRef === true,
      modelImageUrl: parseNullableString(j.modelImageUrl),
      productImageUrl: parseNullableString(j.productImageUrl),
      backgroundImageUrl: parseNullableString(j.backgroundImageUrl),
      isScriptCollapsed: j.isScriptCollapsed === true,
      selectedHistoryId: parseNullableString(j.selectedHistoryId),
    };
  } catch {
    return null;
  }
}

function saveWorkspaceDraft(draft: WorkspaceDraftV1) {
  try {
    localStorage.setItem(WORKSPACE_DRAFT_LS_KEY, JSON.stringify(draft));
  } catch (e) {
    console.warn("Workspace draft save failed (quota or private mode)", e);
  }
}

function clearWorkspaceDraft() {
  try {
    localStorage.removeItem(WORKSPACE_DRAFT_LS_KEY);
  } catch {
    /* ignore */
  }
}

const SCRIPT_PREFS_LS_KEY = "darijaScriptAi.scriptPrefs";

type StoredScriptPrefs = {
  voiceScriptLanguage?: string;
  voiceScriptLanguageOther?: string;
  voiceAccent?: string;
  voiceAccentOther?: string;
  veoAvoidWords?: string;
};

function loadScriptPrefsFromLS(): {
  voiceScriptLanguage: VoiceScriptLanguage;
  voiceScriptLanguageOther: string;
  voiceAccent: VoiceAccent;
  voiceAccentOther: string;
  veoAvoidWords: string;
} {
  const fallback = {
    voiceScriptLanguage: "darija" as VoiceScriptLanguage,
    voiceScriptLanguageOther: "",
    voiceAccent: "moroccan" as VoiceAccent,
    voiceAccentOther: "",
    veoAvoidWords: "",
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(SCRIPT_PREFS_LS_KEY);
    if (!raw) return fallback;
    const j = JSON.parse(raw) as StoredScriptPrefs;
    const langRaw = String(j.voiceScriptLanguage ?? "").trim();
    const voiceScriptLanguage = (
      [
        "darija",
        "darija_french",
        "french",
        "msa",
        "english",
        "spanish",
        "portuguese",
        "swahili",
        "hausa",
        "amharic",
        "yoruba",
        "zulu",
        "other",
      ].includes(langRaw)
        ? (langRaw as VoiceScriptLanguage)
        : fallback.voiceScriptLanguage
    ) as VoiceScriptLanguage;

    const voiceScriptLanguageOther =
      typeof j.voiceScriptLanguageOther === "string" ? j.voiceScriptLanguageOther : "";

    const accentRaw = String(j.voiceAccent ?? "").trim();
    const voiceAccent = (
      [
        "neutral",
        "moroccan",
        "tanzanian",
        "kenyan",
        "nigerian",
        "ghanaian",
        "south_african",
        "ethiopian",
        "other",
      ].includes(accentRaw)
        ? (accentRaw as VoiceAccent)
        : fallback.voiceAccent
    ) as VoiceAccent;

    const voiceAccentOther = typeof j.voiceAccentOther === "string" ? j.voiceAccentOther : "";
    const veoAvoidWords = typeof j.veoAvoidWords === "string" ? j.veoAvoidWords : "";
    return {
      voiceScriptLanguage,
      voiceScriptLanguageOther,
      voiceAccent,
      voiceAccentOther,
      veoAvoidWords,
    };
  } catch {
    return fallback;
  }
}

const SAVED_SCRIPT_CONTEXT_MAX = 1800;

function truncateForStyleContext(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function VoiceLanguageSelect(props: {
  value: VoiceScriptLanguage;
  onChange: (v: VoiceScriptLanguage) => void;
  otherValue: string;
  onChangeOther: (v: string) => void;
  accentValue: VoiceAccent;
  onChangeAccent: (v: VoiceAccent) => void;
  accentOtherValue: string;
  onChangeAccentOther: (v: string) => void;
  id?: string;
}) {
  const {
    value,
    onChange,
    otherValue,
    onChangeOther,
    accentValue,
    onChangeAccent,
    accentOtherValue,
    onChangeAccentOther,
    id,
  } = props;
  return (
    <div className="space-y-2">
      <select
        id={id}
        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value as VoiceScriptLanguage)}
      >
        <option value="darija">Darija (Morocco)</option>
        <option value="darija_french">Darija + Français (code-switch)</option>
        <option value="french">Français</option>
        <option value="msa">العربية الفصحى (MSA)</option>
        <option value="english">English</option>
        <option value="spanish">Español</option>
        <option value="portuguese">Português</option>
        <option value="swahili">Swahili</option>
        <option value="hausa">Hausa</option>
        <option value="amharic">Amharic</option>
        <option value="yoruba">Yorùbá</option>
        <option value="zulu">Zulu</option>
        <option value="other">Other (write it)</option>
      </select>

      {value === "other" && (
        <input
          className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
          value={otherValue}
          onChange={(e) => onChangeOther(e.target.value)}
          placeholder="Language name (e.g. Italian, Turkish, Arabic Egyptian, …)"
        />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select
          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
          value={accentValue}
          onChange={(e) => onChangeAccent(e.target.value as VoiceAccent)}
        >
          <option value="moroccan">Accent: Moroccan</option>
          <option value="neutral">Accent: Neutral</option>
          <option value="tanzanian">Accent: Tanzanian</option>
          <option value="kenyan">Accent: Kenyan</option>
          <option value="nigerian">Accent: Nigerian</option>
          <option value="ghanaian">Accent: Ghanaian</option>
          <option value="south_african">Accent: South African</option>
          <option value="ethiopian">Accent: Ethiopian</option>
          <option value="other">Accent: Other (write it)</option>
        </select>

        {accentValue === "other" ? (
          <input
            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
            value={accentOtherValue}
            onChange={(e) => onChangeAccentOther(e.target.value)}
            placeholder="Accent / dialect (e.g. Egyptian, Algerian, Cape Town, …)"
          />
        ) : (
          <div className="hidden sm:block" />
        )}
      </div>
    </div>
  );
}

const extractAudioBase64 = async (file: File): Promise<string> => {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const targetSampleRate = 16000;
  const offlineContext = new OfflineAudioContext(1, audioBuffer.duration * targetSampleRate, targetSampleRate);
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start();
  const renderedBuffer = await offlineContext.startRendering();

  const length = renderedBuffer.length * 2 + 44;
  const buffer = new ArrayBuffer(length);
  const view = new DataView(buffer);
  let pos = 0;

  const setUint16 = (data: number) => { view.setUint16(pos, data, true); pos += 2; };
  const setUint32 = (data: number) => { view.setUint32(pos, data, true); pos += 4; };

  setUint32(0x46464952); // "RIFF"
  setUint32(length - 8);
  setUint32(0x45564157); // "WAVE"
  setUint32(0x20746d66); // "fmt "
  setUint32(16);
  setUint16(1);
  setUint16(1);
  setUint32(targetSampleRate);
  setUint32(targetSampleRate * 2);
  setUint16(2);
  setUint16(16);
  setUint32(0x61746164); // "data"
  setUint32(length - pos - 4);

  const channelData = renderedBuffer.getChannelData(0);
  for (let i = 0; i < renderedBuffer.length; i++) {
    let sample = Math.max(-1, Math.min(1, channelData[i]));
    sample = sample < 0 ? sample * 32768 : sample * 32767;
    view.setInt16(pos, sample, true);
    pos += 2;
  }

  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
  }
  return btoa(binary);
};

const generateThumbnail = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.playsInline = true;
    video.muted = true;
    
    const url = URL.createObjectURL(file);
    video.src = url;
    
    const timeout = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error("Thumbnail generation timed out"));
    }, 5000);
    
    video.onloadeddata = () => {
      video.currentTime = Math.min(1, video.duration / 2 || 0);
    };
    
    video.onseeked = () => {
      clearTimeout(timeout);
      try {
        const canvas = document.createElement('canvas');
        const maxWidth = 320;
        const scale = maxWidth / (video.videoWidth || maxWidth);
        canvas.width = maxWidth;
        canvas.height = (video.videoHeight || 240) * scale;
        
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
        URL.revokeObjectURL(url);
        resolve(thumbnail);
      } catch (e) {
        reject(e);
      }
    };
    
    video.onerror = (e) => {
      clearTimeout(timeout);
      URL.revokeObjectURL(url);
      reject(e);
    };
    
    video.load();
  });
};

const parseScenesData = (scenesData: any) => {
  if (!scenesData) return [];
  if (Array.isArray(scenesData)) return scenesData;
  
  let scenes = scenesData;
  if (typeof scenes === 'string') {
    let s = scenes.trim();
    try { 
      // Fix literal newlines that break JSON.parse
      s = s.replace(/\n/g, ' ').replace(/\r/g, '');
      
      // Try to fix unescaped quotes inside "prompt" values
      s = s.replace(/"prompt"\s*:\s*"(.*?)"\s*(?=,\s*"use_model_ref"|,\s*"use_product_ref"|\})/g, (match, p1) => {
        return `"prompt":"${p1.replace(/(?<!\\)"/g, '\\"')}"`;
      });

      // If it's a comma-separated list of objects, wrap in array
      if (s.startsWith('{') && s.endsWith('}')) {
        s = `[${s}]`;
      }
      const parsed = JSON.parse(s); 
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'object' && parsed !== null) return [parsed];
    } catch(e) {
      console.error("Failed to parse scenes:", e);
      
      // Fallback regex parser if JSON.parse still fails
      try {
        const fallbackScenes = [];
        const sceneRegex = /"scene_number"\s*:\s*(\d+).*?"scene_title"\s*:\s*"(.*?)".*?"debut"\s*:\s*\{(.*?)\}.*?"fin"\s*:\s*\{(.*?)\}/gs;
        let match;
        while ((match = sceneRegex.exec(s)) !== null) {
          const extractPrompt = (str: string) => {
            const promptMatch = str.match(/"prompt"\s*:\s*"(.*?)"(?=,\s*"use_model_ref"|,\s*"use_product_ref"|\})/s);
            const modelRefMatch = str.match(/"use_model_ref"\s*:\s*(true|false)/);
            const productRefMatch = str.match(/"use_product_ref"\s*:\s*(true|false)/);
            return {
              prompt: promptMatch ? promptMatch[1] : "",
              use_model_ref: modelRefMatch ? modelRefMatch[1] === 'true' : false,
              use_product_ref: productRefMatch ? productRefMatch[1] === 'true' : false
            };
          };
          fallbackScenes.push({
            scene_number: parseInt(match[1]),
            scene_title: match[2],
            debut: extractPrompt(match[3]),
            fin: extractPrompt(match[4])
          });
        }
        if (fallbackScenes.length > 0) return fallbackScenes;
      } catch(fallbackErr) {
        console.error("Fallback parser failed:", fallbackErr);
      }
    }
  }
  return [];
};

const VEO_FULL_SCRIPT_MAX_CHARS = 100_000;

/** Make.com payloads sometimes nest `scenes` under `data` / `payload` / `result`. */
function pickScenesFromWebhookPayload(d: Record<string, unknown> | null | undefined): unknown {
  if (!d || typeof d !== "object") return undefined;
  const o = d as Record<string, unknown>;
  const nested = (x: unknown): Record<string, unknown> | null =>
    x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
  return (
    o.scenes ??
    o.Scenes ??
    o.sceneList ??
    nested(o.data)?.scenes ??
    nested(o.payload)?.scenes ??
    nested(o.result)?.scenes ??
    nested(o.output)?.scenes
  );
}

function pickScriptFromWebhookPayload(d: Record<string, unknown> | null | undefined): string {
  if (!d || typeof d !== "object") return "";
  const o = d as Record<string, unknown>;
  const nested = (x: unknown): Record<string, unknown> | null =>
    x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
  const from = (obj: Record<string, unknown> | null) => {
    if (!obj) return "";
    const s = obj.script ?? obj.markdown ?? obj.Script;
    return typeof s === "string" ? s : "";
  };
  return (
    from(o) ||
    from(nested(o.data)) ||
    from(nested(o.payload)) ||
    from(nested(o.result)) ||
    from(nested(o.output))
  );
}

/** Scene uploads are keyed `${historyId}-${idx}-debut`; fall back to any key ending with that suffix if history id drifted. */
function findSceneImageUrl(
  images: Record<string, string>,
  preferredHistoryId: string | null,
  sceneIdx: number,
  kind: "debut" | "fin"
): string | null {
  const pref =
    preferredHistoryId != null && preferredHistoryId !== ""
      ? `${preferredHistoryId}-${sceneIdx}-${kind}`
      : null;
  if (pref && images[pref]) return images[pref];
  const suffix = `-${sceneIdx}-${kind}`;
  const key = Object.keys(images).find((k) => k.endsWith(suffix));
  return key ? images[key] ?? null : null;
}

async function fetchVeoScenePackageWithTimeout(
  url: string,
  body: unknown,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const id = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(id);
  }
}

/** POST + JSON body; parse JSON response; throw with useful message if server returns non-JSON (e.g. Vercel timeout). */
async function postAiJson(url: string, body: unknown, timeoutMs: number): Promise<Record<string, unknown>> {
  const res = await fetchVeoScenePackageWithTimeout(url, body, timeoutMs);
  const rawText = await res.text();
  const ct = res.headers.get("content-type") ?? "";
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    if (!res.ok) {
      const hint =
        rawText.trim() === ""
          ? ` Body khawi — 9lban Vercel timeout (Hobby ~10s / function) wla crash. Content-Type: ${ct || "?"}`
          : "";
      throw new Error((rawText.trim().slice(0, 500) || `HTTP ${res.status}`) + hint);
    }
    throw new Error("Natija dial server ma-shi JSON.");
  }
  if (!res.ok) {
    const errMsg = typeof data.error === "string" ? data.error.trim() : "";
    throw new Error(errMsg || rawText.trim().slice(0, 500) || `HTTP ${res.status}`);
  }
  return data;
}

/** Fetch image as blob + extension (for ZIP; CORS must allow read on the image host). */
async function fetchRemoteImageBlob(url: string): Promise<{ blob: Blob; ext: string }> {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) {
    throw new Error(`Download HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const t = (blob.type || "").toLowerCase();
  let ext = ".jpg";
  if (t.includes("png")) ext = ".png";
  else if (t.includes("webp")) ext = ".webp";
  else if (t.includes("gif")) ext = ".gif";
  else if (t.includes("jpeg")) ext = ".jpg";
  else {
    try {
      const p = new URL(url).pathname;
      const m = p.match(/\.(png|jpe?g|webp|gif)$/i);
      if (m) ext = m[0].toLowerCase();
    } catch {
      /* keep .jpg */
    }
  }
  return { blob, ext };
}

/** Read Veo in-app packages stored under `video_history.data.veoInApp`. */
function veoInAppFromHistoryData(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const vi = d.veoInApp;
  if (!vi || typeof vi !== "object") return null;
  const v = vi as Record<string, unknown>;
  if (!Array.isArray(v.scenes)) return null;
  return {
    scenes: v.scenes,
    generatedInApp: Boolean(v.generatedInApp),
    generating: false,
    ...(v.partial === true ? { partial: true } : {}),
  };
}

function historyItemHasVeoPackage(item: WebhookHistoryItem): boolean {
  return veoInAppFromHistoryData(item.data) != null;
}

type NormalizedScreenLine = { text: string; role?: string; approxTimingSec?: string };

/** Supports legacy string[] or { text, role, approxTimingSec } objects from Veo JSON. */
function normalizeTextOnScreenLines(raw: unknown): NormalizedScreenLine[] {
  if (!Array.isArray(raw)) return [];
  const out: NormalizedScreenLine[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const t = item.trim();
      if (t) out.push({ text: t });
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const text = typeof o.text === "string" ? o.text.trim() : "";
      if (!text) continue;
      const role = typeof o.role === "string" ? o.role.trim() : undefined;
      const approxTimingSec =
        typeof o.approxTimingSec === "string"
          ? o.approxTimingSec.trim()
          : typeof o.timingHint === "string"
            ? o.timingHint.trim()
            : undefined;
      out.push({ text, role, approxTimingSec });
    }
  }
  return out;
}

/** Prefer packaging shot, else model ref. */
function productVisualRef(p: Pick<Product, "productImageUrl" | "modelImageUrl">): string | undefined {
  const a = p.productImageUrl?.trim();
  if (a) return a;
  const b = p.modelImageUrl?.trim();
  return b || undefined;
}

function ProductThumb({
  url,
  alt,
  size = "md",
  className,
}: {
  url?: string | null;
  alt?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dim =
    size === "sm" ? "w-9 h-9" : size === "lg" ? "w-14 h-14 min-w-[3.5rem] min-h-[3.5rem]" : "w-11 h-11 min-w-[2.75rem] min-h-[2.75rem]";
  if (url && /^https?:\/\//i.test(url.trim())) {
    return (
      <img
        src={url.trim()}
        alt={alt || ""}
        className={cn(`${dim} rounded-lg object-cover border border-gray-200 bg-white shrink-0`, className)}
      />
    );
  }
  return (
    <div
      className={cn(
        `${dim} rounded-lg border border-dashed border-gray-200 bg-gray-50 shrink-0 flex items-center justify-center text-[10px] text-gray-400 font-medium`,
        className
      )}
      title={alt}
    >
      ?
    </div>
  );
}

type WebhookHistoryProductSection =
  | { kind: "product"; product: Product; items: WebhookHistoryItem[] }
  | { kind: "orphan"; label: string; items: WebhookHistoryItem[] };

function buildWebhookHistoryProductSections(
  products: Product[],
  webhookHistory: WebhookHistoryItem[]
): WebhookHistoryProductSection[] {
  const productIds = new Set(products.map((p) => p.id));
  const byProduct = new Map<string, WebhookHistoryItem[]>();
  const orphans: WebhookHistoryItem[] = [];
  for (const item of webhookHistory) {
    const pid = item.productId;
    if (pid && productIds.has(pid)) {
      const arr = byProduct.get(pid);
      if (arr) arr.push(item);
      else byProduct.set(pid, [item]);
    } else {
      orphans.push(item);
    }
  }
  const sortDesc = (a: WebhookHistoryItem, b: WebhookHistoryItem) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  for (const arr of byProduct.values()) arr.sort(sortDesc);
  orphans.sort(sortDesc);

  const sections: WebhookHistoryProductSection[] = products.map((p) => ({
    kind: "product" as const,
    product: p,
    items: byProduct.get(p.id) ?? [],
  }));
  if (orphans.length > 0) {
    sections.push({
      kind: "orphan",
      label: "Ma m-rbout b produit",
      items: orphans,
    });
  }
  return sections;
}

function WebhookHistorySidebarGrouped({
  sections,
  products,
  selectedHistoryId,
  onSelect,
  onRename,
  onDelete,
  subtitle,
}: {
  sections: WebhookHistoryProductSection[];
  products: Product[];
  selectedHistoryId: string | null;
  onSelect: (item: WebhookHistoryItem) => void;
  onRename: (id: string, e: React.MouseEvent) => void;
  onDelete: (id: string, e: React.MouseEvent) => void;
  subtitle?: string | null;
}) {
  return (
    <div className="space-y-2">
      <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
        <History className="w-5 h-5 text-orange-500" />
        Sijil (by produit)
      </h3>
      {subtitle ? <p className="text-xs text-gray-500">{subtitle}</p> : null}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
        <div className="max-h-[600px] overflow-y-auto">
          {sections.map((section) => {
            const veoCount = section.items.filter(historyItemHasVeoPackage).length;
            const title =
              section.kind === "product" ? section.product.name : section.label;
            const thumbUrl =
              section.kind === "product" ? productVisualRef(section.product) : null;
            return (
              <details key={section.kind === "product" ? section.product.id : "orphan"} className="group border-b border-gray-100 last:border-b-0" open>
                <summary className="list-none cursor-pointer px-3 py-2.5 bg-gray-50/90 hover:bg-orange-50/60 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                  <ChevronDown className="w-4 h-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
                  {section.kind === "product" ? (
                    <ProductThumb url={thumbUrl} alt={title} size="sm" />
                  ) : (
                    <div className="w-9 h-9 rounded-lg bg-stone-100 border border-stone-200 flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4 text-stone-500" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1 text-left">
                    <div className="text-sm font-semibold text-gray-800 truncate">{title}</div>
                    <div className="text-[10px] text-gray-500">
                      {section.items.length} f s-sijil · Veo: {veoCount} / {section.items.length}
                      {section.items.length === 0 ? " · zid mn Video" : ""}
                    </div>
                  </div>
                </summary>
                <div className="bg-white">
                  {section.items.length === 0 ? (
                    <p className="text-[11px] text-gray-400 px-4 py-3 border-t border-gray-50">
                      Mazal ma-kayn hta video mrbouta b had l-produit.
                    </p>
                  ) : (
                    section.items.map((item) => {
                      const hasVeo = historyItemHasVeoPackage(item);
                      const prod =
                        item.productId != null
                          ? products.find((pr) => pr.id === item.productId)
                          : undefined;
                      const rowThumb = prod ? productVisualRef(prod) : undefined;
                      const displayTitle = item.name?.trim() || prod?.name || "Natija";
                      return (
                        <div
                          key={item.id}
                          className={cn(
                            "border-t border-gray-50 hover:bg-orange-50/40 transition-colors relative group",
                            selectedHistoryId === item.id ? "bg-orange-50 border-l-4 border-l-orange-500" : ""
                          )}
                        >
                          <button type="button" className="w-full text-left px-3 py-2.5 pr-10" onClick={() => onSelect(item)}>
                            <div className="flex gap-2 items-start">
                              <ProductThumb url={rowThumb} alt="" size="sm" className="mt-0.5" />
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                                  <span className="text-xs font-bold text-gray-800 truncate">
                                    {displayTitle}
                                  </span>
                                  {item.sentToWebhook && (
                                    <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-full bg-green-100 text-green-700 text-[9px] font-medium shrink-0">
                                      <CheckCircle className="w-2.5 h-2.5" /> Webhook
                                    </span>
                                  )}
                                  {item.videoUrl ? (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium shrink-0">
                                      Video
                                    </span>
                                  ) : null}
                                  {hasVeo ? (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 font-medium shrink-0">
                                      Veo ✓
                                    </span>
                                  ) : (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 font-medium shrink-0">
                                      Mazal Veo
                                    </span>
                                  )}
                                </div>
                                <div className="flex justify-between items-center gap-2">
                                  <span className="text-[10px] text-gray-500">
                                    {new Date(item.timestamp).toLocaleString("fr-FR", {
                                      day: "2-digit",
                                      month: "2-digit",
                                      year: "numeric",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                  <span className="text-[10px] font-mono bg-gray-100 text-gray-500 px-1 py-0.5 rounded border border-gray-200 shrink-0">
                                    #{item.id.slice(-5)}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </button>
                          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={(e) => onRename(item.id, e)}
                              className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-md transition-colors"
                              title="Bddel Smiya"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => onDelete(item.id, e)}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                              title="Mse7"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </details>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const REFERENCE_IMAGE_HISTORY_LS_KEY = "referenceImageHistoryV1";
const REFERENCE_IMAGE_HISTORY_MAX = 80;

function loadReferenceImageHistoryFromLs(): string[] {
  try {
    const raw = localStorage.getItem(REFERENCE_IMAGE_HISTORY_LS_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    return j.filter(
      (u): u is string => typeof u === "string" && /^https?:\/\//i.test(u.trim())
    );
  } catch {
    return [];
  }
}

function pushReferenceImageHistoryToLs(url: string) {
  const u = typeof url === "string" ? url.trim() : "";
  if (!/^https?:\/\//i.test(u)) return;
  try {
    const prev = loadReferenceImageHistoryFromLs().filter((x) => x !== u);
    const next = [u, ...prev].slice(0, REFERENCE_IMAGE_HISTORY_MAX);
    localStorage.setItem(REFERENCE_IMAGE_HISTORY_LS_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

function buildReferenceImagePickOptions(
  products: Product[],
  session: { model: string | null; product: string | null; background: string | null },
  saved: { model: string | null; product: string | null; background: string | null },
  historyUrls: string[]
): { url: string; label: string }[] {
  const seen = new Set<string>();
  const out: { url: string; label: string }[] = [];
  let recentIdx = 0;
  const add = (url: string | null | undefined, label: string) => {
    if (!url || typeof url !== "string") return;
    const v = url.trim();
    if (!/^https?:\/\//i.test(v)) return;
    if (seen.has(v)) return;
    seen.add(v);
    out.push({ url: v, label });
  };
  for (const u of historyUrls) {
    recentIdx += 1;
    add(u, recentIdx === 1 ? "Récent (upload)" : `Récent (${recentIdx})`);
  }
  add(session.model, "Session · Model");
  add(session.product, "Session · Product");
  add(session.background, "Session · Background");
  add(saved.model, "Script mkhbi · Model");
  add(saved.product, "Script mkhbi · Produit");
  add(saved.background, "Script mkhbi · Background");
  for (const p of products) {
    add(p.modelImageUrl, `${p.name} · model`);
    add(p.productImageUrl, `${p.name} · produit`);
  }
  return out;
}

type ImagePickerTarget =
  | { kind: "generateRef"; field: "model" | "product" | "background" }
  | { kind: "savedScriptRef"; field: "model" | "product" | "background" }
  | { kind: "newProductRef"; field: "model" | "product" }
  | { kind: "productCardRef"; productId: string; field: "model" | "product" };

export default function App() {
  const workspaceDraft = useMemo(() => {
    const d = loadWorkspaceDraft();
    if (!d?.visualPromptsText?.trim() || d.modelImagePrompt != null) return d;
    const p = parseStep3ModelBackground(d.visualPromptsText.trim());
    if (p) {
      return {
        ...d,
        modelImagePrompt: p.model,
        backgroundPromptOnly: p.background,
        visualPromptsText: buildStep3VisualMarkdown(p.model, p.background),
      };
    }
    return d;
  }, []);

  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  const [products, setProducts] = useState<Product[]>([]);
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([]);
  
  const [activeTab, setActiveTab] = useState<
    "products" | "generate" | "saved" | "videoResult" | "veoResult" | "settings"
  >(() => workspaceDraft?.activeTab ?? "products");
  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({});
  
  // Modal State
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductDesc, setNewProductDesc] = useState('');
  const [newProductScriptDetails, setNewProductScriptDetails] = useState('');
  const [newProductModelImageUrl, setNewProductModelImageUrl] = useState<string | null>(null);
  const [newProductProductImageUrl, setNewProductProductImageUrl] = useState<string | null>(null);
  const [isUploadingNewProductModel, setIsUploadingNewProductModel] = useState(false);
  const [isUploadingNewProductProduct, setIsUploadingNewProductProduct] = useState(false);
  const [productRefUploadKey, setProductRefUploadKey] = useState<string | null>(null);
  
  // Generation State
  const [selectedProductId, setSelectedProductId] = useState<string>(
    () => workspaceDraft?.selectedProductId ?? ""
  );
  const [customPrompt, setCustomPrompt] = useState(() => workspaceDraft?.customPrompt ?? "");
  const [veoAvoidWords, setVeoAvoidWords] = useState(() => loadScriptPrefsFromLS().veoAvoidWords);
  const [voiceScriptLanguage, setVoiceScriptLanguage] = useState<VoiceScriptLanguage>(() =>
    loadScriptPrefsFromLS().voiceScriptLanguage
  );
  const [voiceScriptLanguageOther, setVoiceScriptLanguageOther] = useState(() =>
    loadScriptPrefsFromLS().voiceScriptLanguageOther
  );
  const [voiceAccent, setVoiceAccent] = useState<VoiceAccent>(() => loadScriptPrefsFromLS().voiceAccent);
  const [voiceAccentOther, setVoiceAccentOther] = useState(() =>
    loadScriptPrefsFromLS().voiceAccentOther
  );
  const [sceneCount, setSceneCount] = useState(() => workspaceDraft?.sceneCount ?? "5");
  const [modelGender, setModelGender] = useState<ModelGender>(
    () => workspaceDraft?.modelGender ?? "any"
  );
  const [modelAge, setModelAge] = useState<ModelAge>(() => workspaceDraft?.modelAge ?? "any");
  const [useModelRef, setUseModelRef] = useState(() => workspaceDraft?.useModelRef ?? false);
  const [useProductRef, setUseProductRef] = useState(() => workspaceDraft?.useProductRef ?? false);
  const [useBackgroundRef, setUseBackgroundRef] = useState(
    () => workspaceDraft?.useBackgroundRef ?? false
  );
  const [modelImageFile, setModelImageFile] = useState<File | null>(null);
  const [productImageFile, setProductImageFile] = useState<File | null>(null);
  const [backgroundImageFile, setBackgroundImageFile] = useState<File | null>(null);
  const [modelImageUrl, setModelImageUrl] = useState<string | null>(
    () => workspaceDraft?.modelImageUrl ?? null
  );
  const [productImageUrl, setProductImageUrl] = useState<string | null>(
    () => workspaceDraft?.productImageUrl ?? null
  );
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(
    () => workspaceDraft?.backgroundImageUrl ?? null
  );
  const [isUploadingModel, setIsUploadingModel] = useState(false);
  const [isUploadingProduct, setIsUploadingProduct] = useState(false);
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingPhase, setGeneratingPhase] = useState<
    "idea" | "voice" | "visuals" | "video" | null
  >(null);
  const [scriptIdea, setScriptIdea] = useState<string | null>(
    () => workspaceDraft?.scriptIdea ?? null
  );
  const [voiceOnlyScript, setVoiceOnlyScript] = useState<string | null>(
    () => workspaceDraft?.voiceOnlyScript ?? null
  );
  const [visualPromptsText, setVisualPromptsText] = useState<string | null>(
    () => workspaceDraft?.visualPromptsText ?? null
  );
  /** Step 3: single model image prompt (e.g. one 2×2 character sheet) + background-only */
  const [modelImagePrompt, setModelImagePrompt] = useState<string | null>(
    () => workspaceDraft?.modelImagePrompt ?? null
  );
  const [backgroundPromptOnly, setBackgroundPromptOnly] = useState<string | null>(
    () => workspaceDraft?.backgroundPromptOnly ?? null
  );
  /** Bumps when Step 3 history in localStorage changes so Settings can show a fresh count */
  const [visualPromptHistoryTick, setVisualPromptHistoryTick] = useState(0);
  const usedStep3VisualCount = useMemo(() => {
    void visualPromptHistoryTick;
    return loadUsedVisualPrompts().models.length;
  }, [visualPromptHistoryTick]);
  const [generatedScript, setGeneratedScript] = useState<string | null>(
    () => workspaceDraft?.generatedScript ?? null
  );
  const [generatedScenes, setGeneratedScenes] = useState<any[] | null>(
    () => (workspaceDraft?.generatedScenes as any[] | null) ?? null
  );
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [webhookResponseText, setWebhookResponseText] = useState<string | null>(null);
  const [webhookResponseData, setWebhookResponseData] = useState<any | null>(null);
  const [veoResponseData, setVeoResponseData] = useState<any | null>(null);
  const [webhookHistory, setWebhookHistory] = useState<WebhookHistoryItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(
    () => workspaceDraft?.selectedHistoryId ?? null
  );
  const [isScriptCollapsed, setIsScriptCollapsed] = useState(
    () => workspaceDraft?.isScriptCollapsed ?? false
  );
  
  // Saved Script Webhook Modal State
  const [scriptToSend, setScriptToSend] = useState<SavedScript | null>(null);
  const [savedScriptModelImageFile, setSavedScriptModelImageFile] = useState<File | null>(null);
  const [savedScriptModelImageUrl, setSavedScriptModelImageUrl] = useState<string | null>(null);
  const [isUploadingSavedModel, setIsUploadingSavedModel] = useState(false);
  const [savedScriptProductImageFile, setSavedScriptProductImageFile] = useState<File | null>(null);
  const [savedScriptProductImageUrl, setSavedScriptProductImageUrl] = useState<string | null>(null);
  const [isUploadingSavedProduct, setIsUploadingSavedProduct] = useState(false);
  const [savedScriptBackgroundImageFile, setSavedScriptBackgroundImageFile] = useState<File | null>(null);
  const [savedScriptBackgroundImageUrl, setSavedScriptBackgroundImageUrl] = useState<string | null>(null);
  const [isUploadingSavedBackground, setIsUploadingSavedBackground] = useState(false);

  const [referenceImagePicker, setReferenceImagePicker] = useState<ImagePickerTarget | null>(null);
  const [referenceHistoryTick, setReferenceHistoryTick] = useState(0);

  const referenceImagePickOptions = useMemo(() => {
    void referenceHistoryTick;
    const historyUrls = loadReferenceImageHistoryFromLs();
    const base = buildReferenceImagePickOptions(
      products,
      {
        model: modelImageUrl,
        product: productImageUrl,
        background: backgroundImageUrl,
      },
      {
        model: savedScriptModelImageUrl,
        product: savedScriptProductImageUrl,
        background: savedScriptBackgroundImageUrl,
      },
      historyUrls
    );
    const seen = new Set(base.map((o) => o.url));
    const extra: { url: string; label: string }[] = [];
    const add = (url: string | null | undefined, label: string) => {
      const v = typeof url === "string" ? url.trim() : "";
      if (!/^https?:\/\//i.test(v) || seen.has(v)) return;
      seen.add(v);
      extra.push({ url: v, label });
    };
    add(newProductModelImageUrl, "Modal · model (jdid)");
    add(newProductProductImageUrl, "Modal · produit (jdid)");
    return [...extra, ...base];
  }, [
    referenceHistoryTick,
    products,
    modelImageUrl,
    productImageUrl,
    backgroundImageUrl,
    savedScriptModelImageUrl,
    savedScriptProductImageUrl,
    savedScriptBackgroundImageUrl,
    newProductModelImageUrl,
    newProductProductImageUrl,
  ]);

  const webhookHistoryProductSections = useMemo(
    () => buildWebhookHistoryProductSections(products, webhookHistory),
    [products, webhookHistory]
  );

  const selectedHistoryProduct = useMemo(() => {
    if (!selectedHistoryId) return null;
    const item = webhookHistory.find((h) => h.id === selectedHistoryId);
    if (!item?.productId) return null;
    return products.find((p) => p.id === item.productId) ?? null;
  }, [selectedHistoryId, webhookHistory, products]);

  const generateSelectedProductPreview = useMemo(() => {
    if (!selectedProductId || selectedProductId === "all") return null;
    return products.find((x) => x.id === selectedProductId) ?? null;
  }, [selectedProductId, products]);

  const applyReferenceImagePick = async (target: ImagePickerTarget, url: string) => {
    const u = url.trim();
    if (!u) return;
    if (target.kind === "productCardRef") {
      if (!user) return;
      const col = target.field === "model" ? "model_image_url" : "product_image_url";
      try {
        const { error } = await supabase
          .from("products")
          .update({ [col]: u })
          .eq("id", target.productId)
          .eq("owner_id", user.id);
        if (error) throw error;
        pushReferenceImageHistoryToLs(u);
        setReferenceHistoryTick((t) => t + 1);
        await refreshUserData(user.id);
      } catch (err) {
        handleDbError(err, OperationType.UPDATE, "products");
      }
      setReferenceImagePicker(null);
      return;
    }
    switch (target.kind) {
      case "generateRef":
        if (target.field === "model") {
          setModelImageUrl(u);
          setModelImageFile(null);
        } else if (target.field === "product") {
          setProductImageUrl(u);
          setProductImageFile(null);
        } else {
          setBackgroundImageUrl(u);
          setBackgroundImageFile(null);
        }
        break;
      case "savedScriptRef":
        if (target.field === "model") {
          setSavedScriptModelImageUrl(u);
          setSavedScriptModelImageFile(null);
        } else if (target.field === "product") {
          setSavedScriptProductImageUrl(u);
          setSavedScriptProductImageFile(null);
        } else {
          setSavedScriptBackgroundImageUrl(u);
          setSavedScriptBackgroundImageFile(null);
        }
        break;
      case "newProductRef":
        if (target.field === "model") setNewProductModelImageUrl(u);
        else setNewProductProductImageUrl(u);
        break;
      default:
        break;
    }
    setReferenceImagePicker(null);
  };
  
  // Settings State
  const [webhookUrl, setWebhookUrl] = useState(() => localStorage.getItem('makeWebhookUrl') || '');
  const [imagesWebhookUrl, setImagesWebhookUrl] = useState(() => localStorage.getItem('imagesWebhookUrl') || '');
  const [isSavingWebhookSettings, setIsSavingWebhookSettings] = useState(false);
  const [isSendingWebhook, setIsSendingWebhook] = useState(false);
  const [isGeneratingVeoPackages, setIsGeneratingVeoPackages] = useState(false);
  const [veoInlineProgress, setVeoInlineProgress] = useState<string | null>(null);
  const [isDownloadingSceneStills, setIsDownloadingSceneStills] = useState(false);
  const [webhookStatus, setWebhookStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Transcription State
  const [pendingVideos, setPendingVideos] = useState<PendingVideo[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcribingForProductId, setTranscribingForProductId] = useState<string | null>(null);

  // Modals state
  const [deleteHistoryConfirmId, setDeleteHistoryConfirmId] = useState<string | null>(null);
  const [renameHistoryModalId, setRenameHistoryModalId] = useState<string | null>(null);
  const [renameHistoryValue, setRenameHistoryValue] = useState("");
  const [missingImagesDialog, setMissingImagesDialog] = useState<string[] | null>(null);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginConfirmPassword, setLoginConfirmPassword] = useState("");
  const [authMode, setAuthMode] = useState<"login" | "signup" | "forgot">(
    "login"
  );
  const [passwordRecoveryMode, setPasswordRecoveryMode] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState("");
  const [recoverySending, setRecoverySending] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [loginSending, setLoginSending] = useState(false);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);

  useEffect(() => {
    localforage.getItem('sceneImages').then((val: any) => {
      if (val && typeof val === 'object') {
        setSceneImages(val);
      }
    }).catch(e => console.error("Failed to load scene images", e));
  }, []);

  // Warn user if they try to leave while transcribing
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pendingVideos.some(v => v.status === 'transcribing')) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [pendingVideos]);

  useEffect(() => {
    try {
      localStorage.setItem(
        SCRIPT_PREFS_LS_KEY,
        JSON.stringify({
          voiceScriptLanguage,
          voiceScriptLanguageOther,
          voiceAccent,
          voiceAccentOther,
          veoAvoidWords,
        })
      );
    } catch {
      /* ignore */
    }
  }, [voiceScriptLanguage, voiceScriptLanguageOther, voiceAccent, voiceAccentOther, veoAvoidWords]);

  const [copied, setCopied] = useState(false);
  /** Set when Supabase list queries fail — otherwise the UI looks “empty” with no explanation */
  const [dataSyncError, setDataSyncError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sceneImages, setSceneImages] = useState<Record<string, string>>({});
  const [isUploadingSceneImage, setIsUploadingSceneImage] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const id = window.setTimeout(() => {
      saveWorkspaceDraft({
        v: 1,
        savedAt: new Date().toISOString(),
        selectedProductId,
        customPrompt,
        sceneCount,
        modelGender,
        modelAge,
        scriptIdea,
        voiceOnlyScript,
        visualPromptsText,
        modelImagePrompt,
        backgroundPromptOnly,
        generatedScript,
        generatedScenes,
        activeTab,
        useModelRef,
        useProductRef,
        useBackgroundRef,
        modelImageUrl,
        productImageUrl,
        backgroundImageUrl,
        isScriptCollapsed,
        selectedHistoryId,
      });
    }, 450);
    return () => window.clearTimeout(id);
  }, [
    selectedProductId,
    customPrompt,
    sceneCount,
    modelGender,
    modelAge,
    scriptIdea,
    voiceOnlyScript,
    visualPromptsText,
    modelImagePrompt,
    backgroundPromptOnly,
    generatedScript,
    generatedScenes,
    activeTab,
    useModelRef,
    useProductRef,
    useBackgroundRef,
    modelImageUrl,
    productImageUrl,
    backgroundImageUrl,
    isScriptCollapsed,
    selectedHistoryId,
  ]);

  const refreshUserData = useCallback(async (userId: string) => {
    try {
    const [
      { data: productsRows, error: pErr },
      { data: videosRows, error: vErr },
      { data: scriptsRows, error: sErr },
      { data: historyRows, error: hErr },
      { data: settingsRow, error: stErr },
    ] = await Promise.all([
      supabase.from("products").select("*").eq("owner_id", userId).order("created_at", { ascending: false }),
      supabase.from("videos").select("*").eq("owner_id", userId).order("created_at", { ascending: false }),
      supabase.from("saved_scripts").select("*").eq("owner_id", userId).order("created_at", { ascending: false }),
      supabase.from("video_history").select("*").eq("owner_id", userId).order("created_at", { ascending: false }),
      supabase
        .from("user_app_settings")
        .select("make_webhook_url, images_webhook_url")
        .eq("owner_id", userId)
        .maybeSingle(),
    ]);
    if (pErr) handleDbError(pErr, OperationType.LIST, "products");
    if (vErr) handleDbError(vErr, OperationType.LIST, "videos");
    if (sErr) handleDbError(sErr, OperationType.LIST, "saved_scripts");
    if (hErr) handleDbError(hErr, OperationType.LIST, "video_history");
    if (stErr) handleDbError(stErr, OperationType.LIST, "user_app_settings");

    const syncErrParts: string[] = [];
    if (pErr) syncErrParts.push(`Products: ${supabaseErrorMessage(pErr)}`);
    if (vErr) syncErrParts.push(`Videos: ${supabaseErrorMessage(vErr)}`);
    if (sErr) syncErrParts.push(`Scripts: ${supabaseErrorMessage(sErr)}`);
    if (hErr) syncErrParts.push(`History: ${supabaseErrorMessage(hErr)}`);
    if (stErr) syncErrParts.push(`Settings: ${supabaseErrorMessage(stErr)}`);
    setDataSyncError(syncErrParts.length > 0 ? syncErrParts.join(" · ") : null);

    if (settingsRow && typeof settingsRow === "object") {
      const sr = settingsRow as Record<string, unknown>;
      const mk = String(sr.make_webhook_url ?? "");
      const im = String(sr.images_webhook_url ?? "");
      setWebhookUrl(mk);
      setImagesWebhookUrl(im);
      try {
        localStorage.setItem("makeWebhookUrl", mk);
        localStorage.setItem("imagesWebhookUrl", im);
      } catch {
        /* ignore quota */
      }
    }

    const productsMapped: Product[] = (productsRows ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) ?? "",
      scriptDetails: (row.script_details as string | undefined) ?? "",
      ownerId: row.owner_id as string,
      createdAt: createdAtFromIso(row.created_at as string | null),
      modelImageUrl: (row.model_image_url as string | undefined) ?? undefined,
      productImageUrl: (row.product_image_url as string | undefined) ?? undefined,
    }));

    const videosMapped: VideoData[] = (videosRows ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      productId: row.product_id as string,
      name: (row.name as string) ?? "",
      transcription: row.transcription as string,
      exampleKind:
        (row.example_kind as ('same_product' | 'same_effect' | undefined)) ??
        'same_product',
      thumbnailBase64: (row.thumbnail_base64 as string | undefined) ?? undefined,
      ownerId: row.owner_id as string,
      createdAt: createdAtFromIso(row.created_at as string | null),
    }));

    const scriptsMapped: SavedScript[] = (scriptsRows ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      productId: row.product_id as string,
      customPrompt: (row.custom_prompt as string) ?? "",
      content: row.content as string,
      scenes: row.scenes as unknown[] | undefined,
      ownerId: row.owner_id as string,
      createdAt: createdAtFromIso(row.created_at as string | null),
    }));

    const historyMapped: WebhookHistoryItem[] = (historyRows ?? []).map((row: Record<string, unknown>) => {
      let parsedData: unknown = row.data;
      if (typeof parsedData === "string") {
        try {
          parsedData = JSON.parse(parsedData);
        } catch {
          /* keep string */
        }
      }
      let parsedSceneImages: Record<string, string> = {};
      const si = row.scene_images;
      if (si != null) {
        if (typeof si === "string") {
          try {
            parsedSceneImages = JSON.parse(si) as Record<string, string>;
          } catch {
            parsedSceneImages = {};
          }
        } else if (typeof si === "object") {
          parsedSceneImages = si as Record<string, string>;
        }
      }
      const eventIso = row.event_at
        ? new Date(row.event_at as string).toISOString()
        : new Date().toISOString();
      return {
        id: row.id as string,
        timestamp: eventIso,
        data: parsedData,
        rawText: (row.raw_text as string | null) ?? null,
        videoUrl: (row.video_url as string | null) ?? null,
        productId: (row.product_id as string | null) ?? null,
        name: (row.name as string | undefined) ?? undefined,
        sentToWebhook: Boolean(row.sent_to_webhook),
        sceneImages: parsedSceneImages,
        ownerId: row.owner_id as string | undefined,
        createdAt: createdAtFromIso(row.created_at as string | null),
      };
    });

    setProducts(productsMapped);
    setVideos(videosMapped);
    setSavedScripts(scriptsMapped);
    setWebhookHistory(historyMapped);

    setSceneImages((prev) => {
      const updated = { ...prev };
      let hasChanges = false;
      historyMapped.forEach((doc) => {
        if (doc.sceneImages && typeof doc.sceneImages === "object") {
          Object.entries(doc.sceneImages).forEach(([key, value]) => {
            if (updated[key] !== value) {
              updated[key] = value as string;
              hasChanges = true;
            }
          });
        }
      });
      if (hasChanges) {
        localforage.setItem("sceneImages", updated).catch((e) => console.error(e));
      }
      return hasChanges ? updated : prev;
    });
    } catch (e) {
      console.error("refreshUserData failed:", e);
      handleDbError(e, OperationType.LIST, "refreshUserData");
      setDataSyncError(
        e instanceof Error ? e.message : "Ma9dernach n-chargiw l-data. Chof console."
      );
    }
  }, []);

  const openWebhookHistoryEntry = useCallback((item: WebhookHistoryItem) => {
    setSelectedHistoryId(item.id);
    if (item.videoUrl) {
      setGeneratedVideoUrl(item.videoUrl);
      setWebhookResponseData(null);
      setWebhookResponseText(null);
      setVeoResponseData(null);
    } else if (item.data) {
      setWebhookResponseData(item.data);
      setVeoResponseData(veoInAppFromHistoryData(item.data));
      setWebhookResponseText(null);
      setGeneratedVideoUrl(null);
    } else if (item.rawText) {
      setWebhookResponseText(item.rawText);
      setWebhookResponseData(null);
      setVeoResponseData(null);
      setGeneratedVideoUrl(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      setUser(session?.user ?? null);
      setIsAuthReady(true);
      if (session?.user) {
        void refreshUserData(session.user.id);
      } else {
        setDataSyncError(null);
        setProducts([]);
        setVideos([]);
        setSavedScripts([]);
        setWebhookHistory([]);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecoveryMode(true);
      }
      setUser(session?.user ?? null);
      setIsAuthReady(true);
      if (session?.user) {
        void refreshUserData(session.user.id);
      } else {
        setDataSyncError(null);
        setProducts([]);
        setVideos([]);
        setSavedScripts([]);
        setWebhookHistory([]);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [refreshUserData]);

  const handlePasswordAuth = async () => {
    const email = loginEmail.trim();
    if (!email) {
      setError("3afak dkhel l-email.");
      return;
    }
    if (!loginPassword) {
      setError("3afak dkhel l-password.");
      return;
    }
    setLoginSending(true);
    setLoginMessage(null);
    setError(null);
    try {
      if (authMode === "signup") {
        if (loginPassword !== loginConfirmPassword) {
          setError("L-passwords ma-mtchawch.");
          setLoginSending(false);
          return;
        }
        if (loginPassword.length < 6) {
          setError("L-password khas ykon f a9al 6 d l-7roof.");
          setLoginSending(false);
          return;
        }
        const redirectTo =
          typeof window !== "undefined"
            ? `${window.location.origin}${window.location.pathname}`
            : undefined;
        const { data, error: signErr } = await supabase.auth.signUp({
          email,
          password: loginPassword,
          options: { emailRedirectTo: redirectTo },
        });
        if (signErr) throw signErr;
        if (data.session) {
          setLoginMessage(null);
        } else {
          setLoginMessage(
            "Compte t-crea. Chof l-email ila khassk t-confirmer l-compte f Supabase."
          );
        }
      } else {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email,
          password: loginPassword,
        });
        if (signInErr) throw signInErr;
      }
    } catch (err) {
      console.error(err);
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Mouchkil f-login. Jereb tani.";
      setError(msg);
    } finally {
      setLoginSending(false);
    }
  };

  const handleLogout = async () => {
    setPasswordRecoveryMode(false);
    setDataSyncError(null);
    await supabase.auth.signOut();
  };

  const handleSendPasswordReset = async () => {
    const email = loginEmail.trim();
    if (!email) {
      setError("3afak dkhel l-email.");
      return;
    }
    setLoginSending(true);
    setLoginMessage(null);
    setError(null);
    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}${window.location.pathname}`
          : undefined;
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
        email,
        { redirectTo }
      );
      if (resetErr) throw resetErr;
      setLoginMessage(
        "T-fetcheck l-email: dghya l-lien bach t-7awed l-password. Ila ma-l9itch, chof spam."
      );
    } catch (err) {
      console.error(err);
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Ma-tsendnach l-email. Jereb tani.";
      setError(msg);
    } finally {
      setLoginSending(false);
    }
  };

  const handleCompletePasswordRecovery = async () => {
    if (recoveryPassword !== recoveryConfirmPassword) {
      setError("L-passwords ma-mtchawch.");
      return;
    }
    if (recoveryPassword.length < 6) {
      setError("L-password khas ykon f a9al 6 d l-7roof.");
      return;
    }
    setRecoverySending(true);
    setError(null);
    try {
      const { error: updErr } = await supabase.auth.updateUser({
        password: recoveryPassword,
      });
      if (updErr) throw updErr;
      setRecoveryPassword("");
      setRecoveryConfirmPassword("");
      setPasswordRecoveryMode(false);
      setAuthNotice("L-password t-beddel b naja7.");
    } catch (err) {
      console.error(err);
      const msg =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Mouchkil f beddel l-password.";
      setError(msg);
    } finally {
      setRecoverySending(false);
    }
  };

  // Product Actions
  const addProduct = async (
    name: string,
    description: string,
    scriptDetails: string,
    imageOpts?: { modelImageUrl?: string | null; productImageUrl?: string | null }
  ) => {
    if (!user) return;
    try {
      const m = imageOpts?.modelImageUrl?.trim();
      const pr = imageOpts?.productImageUrl?.trim();
      const { data, error } = await supabase
        .from("products")
        .insert({
          name,
          description,
          script_details: scriptDetails,
          owner_id: user.id,
          ...(m && /^https?:\/\//i.test(m) ? { model_image_url: m } : {}),
          ...(pr && /^https?:\/\//i.test(pr) ? { product_image_url: pr } : {}),
        })
        .select("id")
        .single();
      if (error) throw error;
      if (data?.id) setExpandedProducts((prev) => ({ ...prev, [data.id]: true }));
      await refreshUserData(user.id);
    } catch (err) {
      handleDbError(err, OperationType.WRITE, "products");
    }
  };

  const deleteProduct = async (id: string) => {
    if (!user) return;
    try {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
      await refreshUserData(user.id);
    } catch (err) {
      handleDbError(err, OperationType.DELETE, "products");
    }
  };

  const deleteVideo = async (id: string) => {
    if (!user) return;
    try {
      const { error } = await supabase.from("videos").delete().eq("id", id);
      if (error) throw error;
      try {
        await localforage.removeItem(`video_${id}`);
      } catch (e) {
        console.warn("Failed to remove local video", e);
      }
      await refreshUserData(user.id);
    } catch (err) {
      handleDbError(err, OperationType.DELETE, "videos");
    }
  };

  const handleVideoSelect = (files: FileList | null, productId: string) => {
    if (!files) return;
    const newPending: PendingVideo[] = Array.from(files).map(file => ({
      id: Math.random().toString(36).substring(7),
      productId,
      file,
      url: URL.createObjectURL(file),
      exampleKind: 'same_product',
      status: 'pending'
    }));
    setPendingVideos(prev => [...prev, ...newPending]);
    setExpandedProducts(prev => ({ ...prev, [productId]: true }));
  };

  const handleVideoTranscription = async (pendingVideo: PendingVideo) => {
    // Check file size (max 200MB to prevent browser crash)
    if (pendingVideo.file.size > 200 * 1024 * 1024) {
      setPendingVideos(prev => prev.map(v => v.id === pendingVideo.id ? { ...v, status: 'error', error: "Video kbir bzaf (Max 200MB). Jereb video sgher." } : v));
      return;
    }

    setPendingVideos(prev => prev.map(v => v.id === pendingVideo.id ? { ...v, status: 'transcribing', error: undefined } : v));
    setError(null);

    try {
      let fileToSend: File;

      try {
        const base64Data = await extractAudioBase64(pendingVideo.file);
        const blob = base64ToBlob(base64Data, "audio/wav");
        fileToSend = new File([blob], "audio.wav", { type: "audio/wav" });
      } catch (audioErr) {
        console.warn("Audio extraction failed, falling back to full media", audioErr);
        if (pendingVideo.file.size > 20 * 1024 * 1024) {
          throw new Error(
            "Video kbir bzaf o ma9dernach njebdo mno soute. Jereb video sgher men 20MB (limit dial Gemini transcription)."
          );
        }
        fileToSend = pendingVideo.file;
      }

      const form = new FormData();
      form.append("file", fileToSend);
      const transcribeRes = await fetch(apiUrl("/api/ai/transcribe"), {
        method: "POST",
        body: form,
      });
      const transcribeJson = (await transcribeRes.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
      };
      if (!transcribeRes.ok) {
        if (transcribeRes.status === 404) {
          throw new Error(
            "API 404: ma-l9inach /api/ai/transcribe. Production (Vercel): redploy + zid GEMINI_API_KEY f Env Variables + dossier api/ f repo. Local: npm run dev 3la localhost:3000."
          );
        }
        throw new Error(
          transcribeJson.error ||
            `Transcription HTTP ${transcribeRes.status}`
        );
      }

      const rawTranscript = transcribeJson.text?.trim() ?? "";
      const transcription =
        rawTranscript || "Makaynch soute f had l-video.";
      
      let thumbnailBase64 = '';
      try {
        thumbnailBase64 = await generateThumbnail(pendingVideo.file);
      } catch (thumbErr) {
        console.warn("Thumbnail generation failed", thumbErr);
      }
      
      const insertPayload: Record<string, unknown> = {
        product_id: pendingVideo.productId,
        name: pendingVideo.file.name,
        transcription,
        example_kind: pendingVideo.exampleKind,
        owner_id: user!.id,
      };
      if (thumbnailBase64) insertPayload.thumbnail_base64 = thumbnailBase64;
      const { error: vidErr } = await supabase.from("videos").insert(insertPayload);
      if (vidErr) throw vidErr;
      await refreshUserData(user!.id);

      // Remove from pending videos so UI updates instantly
      setPendingVideos(prev => prev.filter(v => v.id !== pendingVideo.id));

    } catch (err) {
      console.error("Transcription error:", err);
      const msg = transcriptionErrorMessage(err);
      setPendingVideos((prev) =>
        prev.map((v) => (v.id === pendingVideo.id ? { ...v, status: "error", error: msg } : v))
      );
    }
  };

  const removePendingVideo = (id: string) => {
    setPendingVideos(prev => {
      const video = prev.find(v => v.id === id);
      if (video) URL.revokeObjectURL(video.url);
      return prev.filter(v => v.id !== id);
    });
  };

  type ScriptGenBundle = {
    productInfo: string;
    context: string;
    /** “Kifach bghiti l-video tkon?” — prioritized over examples */
    userToneBlock: string;
    /** Either uploaded examples or a SCRIPT_LANGUAGE/ACCENT-aware fallback */
    styleExamplesBlock: string;
    wordCountHint: string;
    sceneInstruction: string;
    sceneCountNum: number;
    totalVideoSeconds: number;
    videoTimingBlock: string;
    arabicDurationLine: string;
    styleInstruction: string;
    castingBlock: string;
    voiceLanguageBlock: string;
    tashkeelBlock: string;
    veoAvoidBlock: string;
    veoLockedVoiceNote: string;
    isUniqueRequested: boolean;
    temperature: number;
  };

  const buildScriptGenerationBundle = (): ScriptGenBundle | null => {
    if (!selectedProductId) return null;

    const relevantVideos =
      selectedProductId === "all"
        ? videos
        : videos.filter((v) => v.productId === selectedProductId);

    const sameProductExamples = relevantVideos.filter(
      (v) => (v.exampleKind ?? "same_product") === "same_product"
    );
    const sameEffectExamples = relevantVideos.filter(
      (v) => (v.exampleKind ?? "same_product") === "same_effect"
    );

    const section = (title: string, list: VideoData[]) =>
      list.length
        ? `## ${title}\n\n${list
            .map((v) => `Example Script:\n${v.transcription}`)
            .join("\n\n---\n\n")}`
        : "";

    const relevantSaved =
      selectedProductId === "all"
        ? savedScripts.slice(0, 6)
        : savedScripts.filter((s) => s.productId === selectedProductId).slice(0, 6);

    const savedScriptsSection =
      relevantSaved.length > 0
        ? `## Style Examples (Saved full scripts in app)\n\n${relevantSaved
            .map(
              (s) =>
                `Saved script (voice / structure excerpt):\n${truncateForStyleContext(s.content, SAVED_SCRIPT_CONTEXT_MAX)}`
            )
            .join("\n\n---\n\n")}`
        : "";

    const contextParts = [
      section("Style Examples (Same Product)", sameProductExamples),
      section("Style Examples (Same Effect / Same Result)", sameEffectExamples),
      savedScriptsSection,
    ].filter(Boolean);

    const context = contextParts.join("\n\n\n");
    const styleExamplesBlock = context.trim()
      ? `Style Examples from previous videos / saved scripts:\n${context}`
      : styleExamplesFallbackForPrompt();

    let productInfo = "All Products";
    if (selectedProductId !== "all") {
      const product = products.find((p) => p.id === selectedProductId);
      if (product) {
        const details = (product.scriptDetails ?? "").trim();
        const fallbackDetails = details || (product.description ?? "").trim();
        productInfo = `Product: ${product.name}\nDescription: ${product.description}\nScript Details (extra context): ${fallbackDetails || "N/A"}`;
      }
    }

    const sceneCountNum = parseSceneCountForVideo(sceneCount);
    const totalVideoSeconds = sceneCountNum * SECONDS_PER_SCENE;
    const videoTimingBlock = `VIDEO STRUCTURE: EXACTLY ${sceneCountNum} scenes. Each scene is EXACTLY ${SECONDS_PER_SCENE} seconds. Total ≈ ${totalVideoSeconds} seconds.`;
    const arabicDurationLine = `${totalVideoSeconds} ثانية (${sceneCountNum} مشهد، كل مشهد 8 ثواني)`;
    const wordCountHint = wordCountHintFromTotalSeconds(totalVideoSeconds);

    const isUniqueRequested = customPrompt.toLowerCase().includes("unique");
    const hasUserTone = customPrompt.trim().length > 0;
    const styleInstruction = isUniqueRequested
      ? "CRITICAL INSTRUCTION: The user requested a UNIQUE script. DO NOT copy the examples. You MUST generate a completely NEW, UNIQUE, and DIFFERENT script. Do not repeat the exact same hooks or phrases."
      : hasUserTone
        ? "INSTRUCTION: Style Examples are OPTIONAL background only. The USER TONE & DIRECTION block always wins for angle, tone, and structure. Do not drift back into “example-default” hooks or CTAs — every run must visibly match the user’s brief."
        : "INSTRUCTION: You can take inspiration, mix, and match elements from the Style Examples above (video transcriptions + saved script excerpts) for pacing, hooks, and vibe. DO NOT output the exact same script. Create a fresh variation.";

    const sceneInstruction = `CRITICAL INSTRUCTION: You MUST divide the script into EXACTLY ${sceneCountNum} scenes. Each scene is EXACTLY ${SECONDS_PER_SCENE} seconds (total ${totalVideoSeconds} seconds). Scene timecodes: Scene 1 = 0–${SECONDS_PER_SCENE}s, Scene 2 = ${SECONDS_PER_SCENE}–${SECONDS_PER_SCENE * 2}s, … Scene ${sceneCountNum} = ${(sceneCountNum - 1) * SECONDS_PER_SCENE}–${totalVideoSeconds}s.`;

    const veoAvoidBlock = formatVeoAvoidWordsBlock(veoAvoidWords);
    const veoLockedVoiceNote = veoAvoidBlock
      ? "FORBIDDEN WORDS above apply to every NEW line you write (Text on Screen, visual descriptions, extra tips). The [النص الصوتي - Voice Script] lines in each scene and the 🎙️ Full Voice Script block MUST stay character-identical to the LOCKED VOICE SCRIPT — edit Step 2 if a banned term appears there."
      : "";

    const castingBlock =
      modelGender === "any" && modelAge === "any"
        ? "CASTING / ON-CAMERA TALENT: Any (creator-style, natural)."
        : `CASTING / ON-CAMERA TALENT: gender=${modelGender}, age vibe=${modelAge}.`;

    return {
      productInfo,
      context,
      styleExamplesBlock,
      wordCountHint,
      sceneInstruction,
      sceneCountNum,
      totalVideoSeconds,
      videoTimingBlock,
      arabicDurationLine,
      styleInstruction,
      castingBlock,
      voiceLanguageBlock: voiceLanguagePromptBlock({
        lang: voiceScriptLanguage,
        langOther: voiceScriptLanguageOther,
        accent: voiceAccent,
        accentOther: voiceAccentOther,
      }),
      tashkeelBlock: tashkeelAndOrthographyBlock(voiceScriptLanguage),
      veoAvoidBlock,
      veoLockedVoiceNote,
      isUniqueRequested,
      userToneBlock: formatUserToneBlockForPrompt(customPrompt),
      temperature: isUniqueRequested ? 0.9 : hasUserTone ? 0.82 : 0.7,
    };
  };

  const saveWebhookSettings = useCallback(async () => {
    const mk = webhookUrl.trim();
    const im = imagesWebhookUrl.trim();
    try {
      localStorage.setItem("makeWebhookUrl", mk);
      localStorage.setItem("imagesWebhookUrl", im);
    } catch {
      /* ignore */
    }
    if (!user) {
      alert(
        "Webhooks m-sauvegarder f l-appareil (localStorage). Dkhol b-compte bach t-sauvegard f Supabase."
      );
      return;
    }
    setIsSavingWebhookSettings(true);
    try {
      const { error } = await supabase.from("user_app_settings").upsert(
        {
          owner_id: user.id,
          make_webhook_url: mk,
          images_webhook_url: im,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id" }
      );
      if (error) {
        alert(formatDbErrorForLog(error));
        return;
      }
      alert("Webhooks m-sauvegarder f Supabase + local.");
    } finally {
      setIsSavingWebhookSettings(false);
    }
  }, [user, webhookUrl, imagesWebhookUrl]);

  const callAiChat = async (prompt: string, temperature: number) => {
    const chatRes = await fetch(apiUrl("/api/ai/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        temperature,
      }),
    });
    const chatJson = (await chatRes.json().catch(() => ({}))) as {
      text?: string;
      error?: string;
    };
    if (!chatRes.ok) {
      throw new Error(chatJson.error || `Generi HTTP ${chatRes.status}`);
    }
    const responseText = chatJson.text?.trim();
    if (!responseText) {
      throw new Error("Smah lina, ma9dernach n-generiw t-text.");
    }
    return responseText;
  };

  const generateScriptIdea = async () => {
    if (!selectedProductId) {
      setError("3afak khtar produit wla 'Ga3 l-Produits'.");
      return;
    }
    const b = buildScriptGenerationBundle();
    if (!b) return;

    setIsGenerating(true);
    setGeneratingPhase("idea");
    setError(null);
    try {
      setScriptIdea(null);
      setVoiceOnlyScript(null);
      setVisualPromptsText(null);
      setModelImagePrompt(null);
      setBackgroundPromptOnly(null);
      setGeneratedScript(null);
      setGeneratedScenes(null);

      const prompt = `${generationExpertRole("idea")}

${b.userToneBlock}

${b.voiceLanguageBlock}

${b.castingBlock}

Write the creative substance in SCRIPT_LANGUAGE (and SCRIPT_ACCENT where it affects phrasing): concept beats, hook angle, emotional arc, CTA direction. You may keep these section titles in Arabic with markdown **bold** exactly as listed:

Product Info: Name and Description
${b.productInfo}

${b.videoTimingBlock}
${b.wordCountHint}

${b.styleExamplesBlock}

${b.styleInstruction}

${b.tashkeelBlock}
${b.veoAvoidBlock ? `\n\n${b.veoAvoidBlock}` : ""}

Required sections (fill under each title, be concise — strategy only, no scene list, no full spoken script):
**الفكرة الأساسية**
**زاوية الخطاف (Hook)**
**المسار العاطفي**
**اتجاه الـ CTA**`;

      const text = await callAiChat(prompt, b.temperature);
      setScriptIdea(text);
    } catch (err) {
      console.error(err);
      setError(generationErrorMessage(err));
    } finally {
      setIsGenerating(false);
      setGeneratingPhase(null);
    }
  };

  const generateVoiceOnlyScript = async () => {
    if (!selectedProductId) {
      setError("3afak khtar produit wla 'Ga3 l-Produits'.");
      return;
    }
    if (!scriptIdea?.trim()) {
      setError("3afak dir l-fikra lwl (Step 1) blast ma t-kammel.");
      return;
    }
    const b = buildScriptGenerationBundle();
    if (!b) return;

    setIsGenerating(true);
    setGeneratingPhase("voice");
    setError(null);
    try {
      setVoiceOnlyScript(null);
      setVisualPromptsText(null);
      setModelImagePrompt(null);
      setBackgroundPromptOnly(null);
      setGeneratedScript(null);
      setGeneratedScenes(null);

      const prompt = `${generationExpertRole("voice")}

${b.userToneBlock}

${b.voiceLanguageBlock}

${b.castingBlock}

Product Info: Name and Description
${b.productInfo}

${b.videoTimingBlock}
${b.wordCountHint}

Creative idea (follow this angle closely):
${scriptIdea}

${b.styleExamplesBlock}

${b.styleInstruction}

${b.tashkeelBlock}
${b.veoAvoidBlock ? `\n\n${b.veoAvoidBlock}` : ""}

TASK: Write ONLY the voiceover dialogue for the full ad duration, strictly following SCRIPT_LANGUAGE, SCRIPT_ACCENT, script orthography / vocalization rules, and pronunciation rules above.
- One continuous block; short line breaks between beats are OK.
- NO markdown headings, NO scene labels, NO visual/B-roll instructions, NO bracketed stage directions.
- Respect the word-count / duration rules strictly.
- Do not add a title or preamble — start directly with the first spoken words.`;

      const text = await callAiChat(prompt, b.temperature);
      setVoiceOnlyScript(text);
    } catch (err) {
      console.error(err);
      setError(generationErrorMessage(err));
    } finally {
      setIsGenerating(false);
      setGeneratingPhase(null);
    }
  };

  const generateVisualPrompts = async () => {
    if (!selectedProductId) {
      setError("3afak khtar produit wla 'Ga3 l-Produits'.");
      return;
    }
    if (!voiceOnlyScript?.trim()) {
      setError("3afak kammel Step 2 (script swoti) blast ma t-zid prompts.");
      return;
    }
    const b = buildScriptGenerationBundle();
    if (!b) return;

    setIsGenerating(true);
    setGeneratingPhase("visuals");
    setError(null);
    try {
      setVisualPromptsText(null);
      setModelImagePrompt(null);
      setBackgroundPromptOnly(null);
      setGeneratedScript(null);
      setGeneratedScenes(null);

      const castingDetail =
        modelGender === "any" && modelAge === "any"
          ? "Any on-camera talent; natural creator / UGC look matching SCRIPT_ACCENT."
          : `Preferred casting detail: gender ${modelGender}, age vibe ${modelAge}.`;

      const prompt = `${generationExpertRole("visuals")}

${b.userToneBlock}

${b.voiceLanguageBlock}

${b.castingBlock}

Product Info: Name and Description
${b.productInfo}

${b.videoTimingBlock}

Creative idea:
${scriptIdea ?? "(see voice script)"}

LOCKED VOICE SCRIPT (match energy, who speaks on camera, product use):
---
${voiceOnlyScript}
---

Casting detail: ${castingDetail}

${onCameraModelLookFromAccentBlock()}

${b.styleExamplesBlock}

${b.styleInstruction}

${b.tashkeelBlock}
${b.veoAvoidBlock ? `\n\n${b.veoAvoidBlock}` : ""}

ANTI-REUSE (same browser — mandatory)
${formatUsedVisualPromptsForAi()}
You MUST output ONE NEW unified model-image prompt and ONE NEW background plate prompt, clearly different from the history above (not paraphrase).

TASK — Output ONLY markdown in English (French only if the voice script is clearly French-first). Exactly two top-level sections, in order — no emoji in headings.

## Model
ONE cohesive block (one or two dense paragraphs ONLY) — a single string the user will paste once into an image AI. It MUST instruct the generator to produce exactly ONE image file that is visually SPLIT into FOUR equal parts (a 2×2 layout: top-left, top-right, bottom-left, bottom-right — like a contact sheet or quad-split / four-quadrant composition inside a single frame). Use explicit wording image models understand, e.g. "single image divided into four equal quadrants", "four-panel grid in one picture", "one photograph split into 4 sections". The SAME identical photorealistic person must appear in all four quadrants (strict face, hair/hijab continuity, same outfit in every quadrant).

OUTFIT — Must be derived from the actual script context (voice script + creative idea + product details), not random fashion. The clothing, styling, and vibe must logically fit what happens in the ad and who is speaking (e.g. practical beauty demo, home-care, wellness routine, lifestyle testimonial). Must feel intentional and creator-ready, NOT generic "plain t-shirt only." Specify a rich, tasteful look: layered pieces or structured silhouette, interesting texture and color story (e.g. ribbed knit + tailored layer, quality loungewear set, modest fashion with fabric drape detail, denim + soft knit, coordinated accessories like minimal jewelry or watch, hijab fabric and wrap style if applicable). Makeup: soft camera-ready but still authentic; nails and grooming subtle. Never describe outfit details that conflict with the script tone or intended product use moment.

CRITICAL — NO PRODUCT IN MODEL SHOTS: the talent must NOT hold, touch, or display any product, packaging, bottle, tube, jar, box, or brand object. Hands empty or natural gestures only (e.g. relaxed hands, adjusting hair, touching shoulder). Pure white seamless studio cyclorama in every quadrant (talent reference only — no room furniture). NO text, NO logos, NO watermarks; soft even key light + gentle fill; natural skin; respect Casting, SCRIPT_ACCENT, and forbidden lists. Describe each quadrant (QL1…QL4) for pose and expression only — matching the MOOD of the LOCKED VOICE SCRIPT. Do NOT use "### Angle" subheadings — one continuous paragraph under ## Model.

## Background
ONE paragraph — realistic empty environment plate for the ENTIRE ad (same room in every scene; not a white cyclorama, not a blank white wall as the whole frame). The location must be directly relevant to what happens in the script and product use context (if script implies bathroom routine, use believable bathroom details; if kitchen/home context, use that context). Describe ONE simple, believable real-world interior with MINIMAL props — calm and uncrowded (avoid shelves packed with objects, busy patterns, or “a lot going on”). Hard rule: background plate must contain ZERO humans. Absolutely NO model, NO person, NO body parts, NO face, NO silhouette, NO reflection of any person in mirror/glass, NO human shadow, and NO mannequin. If any human is visible, the background prompt is invalid and must be regenerated. Keep it photorealistic and natural (real materials, real lighting), not CGI-looking, not surreal, not fantasy. Nothing that screams “studio,” “ring light,” “filming setup,” “content creator,” or branded lighting gear. Natural daylight mood, soft and realistic; shallow depth of field OK. Brand-safe; respect forbidden term lists.

ALWAYS output BOTH "## Model" and "## Background" sections in full — never omit ## Background.

Do not add any text before "## Model" or after the Background paragraph. Headings must be exactly "## Model" and "## Background".`;

      const text = await callAiChat(prompt, b.temperature);
      const trimmed = text.trim();
      const parsed = parseStep3ModelBackground(trimmed);
      if (parsed) {
        setModelImagePrompt(parsed.model);
        setBackgroundPromptOnly(parsed.background);
        setVisualPromptsText(buildStep3VisualMarkdown(parsed.model, parsed.background));
        appendUsedVisualPrompts(parsed.model, parsed.background);
        setVisualPromptHistoryTick((t) => t + 1);
      } else {
        setModelImagePrompt(null);
        setBackgroundPromptOnly(null);
        setVisualPromptsText(trimmed);
      }
    } catch (err) {
      console.error(err);
      setError(generationErrorMessage(err));
    } finally {
      setIsGenerating(false);
      setGeneratingPhase(null);
    }
  };

  const generateVideoScript = async () => {
    if (!selectedProductId) {
      setError("3afak khtar produit wla 'Ga3 l-Produits'.");
      return;
    }
    if (!voiceOnlyScript?.trim()) {
      setError("3afak generi script swoti (Step 2) blast ma t-kammel.");
      return;
    }
    if (!visualPromptsText?.trim()) {
      setError("3afak generi prompts dial model o background (Step 3) blast ma t-kammel.");
      return;
    }
    const b = buildScriptGenerationBundle();
    if (!b) return;

    setIsGenerating(true);
    setGeneratingPhase("video");
    setError(null);

    try {
      const prompt = `${generationExpertRole("video")}
${videoBreakdownStructureNote(voiceScriptLanguage)}

${b.userToneBlock}

VISUAL ALIGNMENT — Use the LOCKED VISUAL PROMPTS below when writing [شنو تبيني فالفيديو] and any camera/setting notes: (1) Model = quadrants reference — white seamless, talent-only, styled outfit, NO product in hands. (2) Background = ONE simple real interior for the WHOLE video (sparse, not busy; not a white void studio) — SAME room every scene; do NOT change location between scenes unless the creative idea has one explicit exception. Stay consistent.

${b.voiceLanguageBlock}

${b.castingBlock}

Product Info: Name and Description
${b.productInfo}

${b.videoTimingBlock}
${b.wordCountHint}

${b.tashkeelBlock}
${b.veoAvoidBlock ? `\n\n${b.veoAvoidBlock}` : ""}

LOCKED VISUAL PROMPTS (Model = styled talent quadrants on white ref; Background = same simple real room for ALL scenes — do not contradict):
---
${visualPromptsText}
---

LOCKED VOICE SCRIPT — use these EXACT characters for all spoken lines. Split across scenes without changing, adding, or removing any wording or diacritics (only divide into scene-sized chunks):
---
${voiceOnlyScript}
---
${b.veoLockedVoiceNote ? `\n${b.veoLockedVoiceNote}\n` : ""}

${b.styleInstruction}

You MUST follow this EXACT structure and format (in Arabic/Darija) with the exact markdown bolding. The sum of all [النص الصوتي - Voice Script] lines (minus stage directions) must equal the locked voice script verbatim. The section 🎙️ **السكريبت الصوتي الكامل (Full Voice Script):** must repeat the locked script exactly (spoken words only).

بصفتي خبير في كتابة إعلانات تيك توك بالمغرب، أؤكد لك أن هذا السكريبت سيكون له تأثير قوي جداً (High Conversion Rate). تلبيةً لطلبك، السكريبت **مختلف كلياً (Unique)** عن الإعلانات السابقة، و**يبدأ مباشرة بالنتيجة المبهرة** كما طلبت. البدء بالنتيجة يخطف انتباه المشاهد (Stop the scroll) في الثواني الأولى ويجعله يتساءل: "كيفاش دارت ليها؟"، مما يرفع نسبة المشاهدة الكاملة للفيديو.

📝 **هيكل الإعلان (TikTok Ad Script)**
المنتج: [Product Name]
المدة المتوقعة: ${b.arabicDurationLine}

🎬 **السكريبت الصوتي (Voice Script) والتعليمات البصرية:**
${b.sceneInstruction}

**المشهد 1 (Scene 1) - الخطاف (HOOK) - من 0 إلى 8 ثواني**
[شنو تبيني فالفيديو]: ...
[النص الصوتي - Voice Script]: ...

**المشهد 2 (Scene 2) - من 8 إلى 16 ثانية**
[شنو تبيني فالفيديو]: ...
[النص الصوتي - Voice Script]: ...

(Continue until all ${b.sceneCountNum} scenes are filled; each scene is exactly 8 seconds — Scene k covers seconds (k-1)×8 to k×8. The last scene must include the CTA).

BACKGROUND LOCK — In [شنو تبيني فالفيديو] for every scene, keep the SAME simple environment as the ## Background prompt (same room and surfaces — calm, not overloaded with new objects each scene). Avoid jumping to a different room or city unless one explicit exception is in the creative idea.

---

💡 **نصائح إضافية لنجاح الإعلان (Text On Screen):**
*   **الثانية X-Y:** اكتب الفوق بالبنط العريض: "..."
(Provide text to display on screen at specific seconds)

**نصيحة في الأداء الصوتي:**
*   **في المشهد الأول:** ...
*   **في المشهد الثاني والثالث:** ...
(Provide tips on how to deliver the voiceover — match SCRIPT_LANGUAGE + SCRIPT_ACCENT; keep advice practical for easy pronunciation.)

---

🎙️ **السكريبت الصوتي الكامل (Full Voice Script):**
(Repeat the locked voice script verbatim here — spoken words only, no visual instructions).

${b.styleExamplesBlock}`;

      const responseText = await callAiChat(prompt, b.temperature);
      setGeneratedScript(responseText);
      setGeneratedScenes(null);
    } catch (err) {
      console.error(err);
      setError(generationErrorMessage(err));
    } finally {
      setIsGenerating(false);
      setGeneratingPhase(null);
    }
  };

  const handleSceneImageUpload = async (contextId: string, sceneIdx: number, type: 'debut' | 'fin', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const key = `${contextId}-${sceneIdx}-${type}`;
    setIsUploadingSceneImage(prev => ({ ...prev, [key]: true }));
    
    try {
      const res = await uploadFiles("imageUploader", { files: [file] });
      if (res && res.length > 0) {
        const imageUrl = res[0].url;
        
        // Update local state
        setSceneImages(prev => {
          const updated = { ...prev, [key]: imageUrl };
          localforage.setItem('sceneImages', updated).catch(err => console.error("Failed to save scene images", err));
          
          if (activeTab === 'videoResult' && selectedHistoryId && user) {
            const newImages: Record<string, string> = {};
            Object.keys(updated).forEach(k => {
              if (k.startsWith(`${selectedHistoryId}-`)) {
                newImages[k] = updated[k];
              }
            });
            void supabase
              .from("video_history")
              .update({ scene_images: newImages })
              .eq("id", selectedHistoryId)
              .then(({ error }) => {
                if (error)
                  handleDbError(error, OperationType.UPDATE, `video_history/${selectedHistoryId}`);
                else void refreshUserData(user.id);
              });
          }
          
          return updated;
        });
      }
    } catch (err) {
      console.error("Failed to upload scene image:", err);
      alert("Mouchkil f upload d tswira");
    } finally {
      setIsUploadingSceneImage(prev => ({ ...prev, [key]: false }));
    }
  };

  const handleModelImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setModelImageFile(null);
      setModelImageUrl(null);
      return;
    }
    setModelImageFile(file);
    setIsUploadingModel(true);
    try {
      const res = await uploadFiles("imageUploader", {
        files: [file],
      });
      if (res && res.length > 0) {
        const u = res[0].url;
        setModelImageUrl(u);
        pushReferenceImageHistoryToLs(u);
        setReferenceHistoryTick((t) => t + 1);
      }
    } catch (err) {
      console.error("Failed to upload model image:", err);
      alert("Mouchkil f upload d tswira d l-model");
    } finally {
      setIsUploadingModel(false);
    }
  };

  const handleProductImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setProductImageFile(null);
      setProductImageUrl(null);
      return;
    }
    setProductImageFile(file);
    setIsUploadingProduct(true);
    try {
      const res = await uploadFiles("imageUploader", {
        files: [file],
      });
      if (res && res.length > 0) {
        const u = res[0].url;
        setProductImageUrl(u);
        pushReferenceImageHistoryToLs(u);
        setReferenceHistoryTick((t) => t + 1);
      }
    } catch (err) {
      console.error("Failed to upload product image:", err);
      alert("Mouchkil f upload d tswira d l-produit");
    } finally {
      setIsUploadingProduct(false);
    }
  };

  const handleBackgroundImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setBackgroundImageFile(null);
      setBackgroundImageUrl(null);
      return;
    }
    setBackgroundImageFile(file);
    setIsUploadingBackground(true);
    try {
      const res = await uploadFiles("imageUploader", {
        files: [file],
      });
      if (res && res.length > 0) {
        const u = res[0].url;
        setBackgroundImageUrl(u);
        pushReferenceImageHistoryToLs(u);
        setReferenceHistoryTick((t) => t + 1);
      }
    } catch (err) {
      console.error("Failed to upload background image:", err);
      alert("Mouchkil f upload d tswira d l-background");
    } finally {
      setIsUploadingBackground(false);
    }
  };

  const createVideoHistoryPending = async (
    productId: string | null
  ): Promise<string | null> => {
    if (!user) return null;
    try {
      const { data: inserted, error } = await supabase
        .from("video_history")
        .insert({
          owner_id: user.id,
          event_at: new Date().toISOString(),
          data: null,
          raw_text: null,
          video_url: null,
          product_id: productId,
        })
        .select("id")
        .single();
      if (error) throw error;
      await refreshUserData(user.id);
      return inserted?.id ?? null;
    } catch (err) {
      handleDbError(err, OperationType.CREATE, "video_history");
      return null;
    }
  };

  const finalizeVideoHistory = async (
    historyId: string,
    data: any,
    rawText: string | null,
    videoUrl: string | null
  ) => {
    if (!user) return;
    let dataJson: unknown = null;
    if (data != null) {
      if (typeof data === "string") {
        try {
          dataJson = JSON.parse(data);
        } catch {
          dataJson = data;
        }
      } else {
        dataJson = data;
      }
    }
    try {
      const { error } = await supabase
        .from("video_history")
        .update({
          event_at: new Date().toISOString(),
          data: dataJson,
          raw_text: rawText,
          video_url: videoUrl,
        })
        .eq("id", historyId);
      if (error) throw error;
      await refreshUserData(user.id);
    } catch (err) {
      handleDbError(err, OperationType.UPDATE, `video_history/${historyId}`);
    }
  };

  const rollbackVideoHistory = async (historyId: string) => {
    try {
      await supabase.from("video_history").delete().eq("id", historyId);
      if (user) await refreshUserData(user.id);
    } catch (e) {
      console.error("rollbackVideoHistory", e);
    }
  };

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteHistoryConfirmId(id);
  };

  const confirmDeleteHistoryItem = async () => {
    if (!deleteHistoryConfirmId || !user) return;
    try {
      const { error } = await supabase.from("video_history").delete().eq("id", deleteHistoryConfirmId);
      if (error) throw error;
      
      // Clean up scene images for this history item locally
      setSceneImages(prev => {
        const updated = { ...prev };
        let hasChanges = false;
        Object.keys(updated).forEach(key => {
          if (key.startsWith(`${deleteHistoryConfirmId}-`)) {
            delete updated[key];
            hasChanges = true;
          }
        });
        if (hasChanges) {
          localforage.setItem('sceneImages', updated).catch(err => console.error("Failed to save scene images", err));
        }
        return updated;
      });

      if (selectedHistoryId === deleteHistoryConfirmId) {
        setSelectedHistoryId(null);
        setWebhookResponseData(null);
        setWebhookResponseText(null);
        setVeoResponseData(null);
        setGeneratedVideoUrl(null);
      }
      setDeleteHistoryConfirmId(null);
      await refreshUserData(user.id);
    } catch (err) {
      handleDbError(err, OperationType.DELETE, `video_history/${deleteHistoryConfirmId}`);
    }
  };

  const renameHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const item = webhookHistory.find(i => i.id === id);
    const currentName = item?.name || (item?.productId ? products.find(p => p.id === item.productId)?.name || 'Produit' : 'Natija');
    setRenameHistoryValue(currentName);
    setRenameHistoryModalId(id);
  };

  const confirmRenameHistoryItem = async () => {
    if (!renameHistoryModalId || !renameHistoryValue.trim() || !user) return;
    try {
      const { error } = await supabase
        .from("video_history")
        .update({ name: renameHistoryValue.trim() })
        .eq("id", renameHistoryModalId);
      if (error) throw error;
      setRenameHistoryModalId(null);
      setRenameHistoryValue("");
      await refreshUserData(user.id);
    } catch (err) {
      handleDbError(err, OperationType.UPDATE, `video_history/${renameHistoryModalId}`);
    }
  };

  const showMissingImagesDialog = (items: string[]): boolean => {
    if (items.length === 0) return false;
    setMissingImagesDialog(items);
    return true;
  };

  /** Analyze debut+fin per scene (vision) then build VEO 3.1 JSON packages in-app — no images webhook. */
  const generateVeoScenePackagesInApp = async () => {
    if (!webhookResponseData || typeof webhookResponseData !== "object") {
      setError("Ma-kayn hta données dial l-webhook — sifet script l-webhook lwl.");
      alert("Ma-kayn hta données dial l-webhook.");
      return;
    }

    const wh = webhookResponseData as Record<string, unknown>;
    const scenesRaw = pickScenesFromWebhookPayload(wh);
    const parsedScenes = parseScenesData(scenesRaw);
    if (!parsedScenes.length) {
      const msg =
        "Ma-l9inach `scenes` f natija dial l-webhook (wla ma-t9rachch). Chof Make.com: khass y-rje3 `scenes` (array wla string JSON) f body.";
      setError(msg);
      alert(msg);
      return;
    }

    const missingImages: string[] = [];
    parsedScenes.forEach((scene: any, idx: number) => {
      const sceneNum = scene.sceneNumber || scene.scene_number || (idx + 1);
      if (!findSceneImageUrl(sceneImages, selectedHistoryId, idx, "debut")) {
        missingImages.push(`Scene ${sceneNum} - Debut`);
      }
      if (!findSceneImageUrl(sceneImages, selectedHistoryId, idx, "fin")) {
        missingImages.push(`Scene ${sceneNum} - Fin`);
      }
    });
    if (missingImages.length > 0) {
      setError("Zid tsawer debut + fin l-koll machhad 9bel Generi Veo.");
      if (showMissingImagesDialog(missingImages)) return;
    }

    if (!user || !selectedHistoryId) {
      const msg =
        "Khassek tkoun connecté w t-khtar video f History bach natija Veo t-tsajjel f Supabase (b7al sijil Video).";
      setError(msg);
      alert(msg);
      return;
    }

    const scriptPart = (
      pickScriptFromWebhookPayload(wh) ||
      (typeof wh.script === "string" ? wh.script : "") ||
      generatedScript ||
      ""
    ).trim();
    const scenesStr =
      scenesRaw === undefined || scenesRaw === null
        ? ""
        : typeof scenesRaw === "string"
          ? scenesRaw
          : JSON.stringify(scenesRaw, null, 2);
    let fullScript = `${scriptPart}\n\n--- SCENE METADATA ---\n${scenesStr}`.trim();
    if (fullScript.length > VEO_FULL_SCRIPT_MAX_CHARS) {
      fullScript = `${fullScript.slice(0, VEO_FULL_SCRIPT_MAX_CHARS)}\n\n[TRUNCATED — script kbir bzaf]`;
    }
    const languageLabel = voiceLanguageDisplayForPrompt(voiceScriptLanguage, voiceScriptLanguageOther);

    /** Working copy of webhook JSON merged with `veoInApp` for `video_history.data`. */
    const historyPayload: Record<string, unknown> = { ...wh };

    setIsGeneratingVeoPackages(true);
    setVeoInlineProgress(null);
    setError(null);
    setActiveTab("veoResult");
    setVeoResponseData({
      scenes: [],
      generatedInApp: true,
      generating: true,
      generationTotal: parsedScenes.length,
    });

    const packages: unknown[] = [];

    const persistVeoToHistory = async (scenes: unknown[], extra?: { partial?: boolean }) => {
      historyPayload.veoInApp = {
        scenes,
        generatedInApp: true,
        updatedAt: new Date().toISOString(),
        ...(extra?.partial ? { partial: true } : {}),
      };
      const { error: saveErr } = await supabase
        .from("video_history")
        .update({
          event_at: new Date().toISOString(),
          data: historyPayload,
        })
        .eq("id", selectedHistoryId)
        .eq("owner_id", user.id);
      if (saveErr) {
        handleDbError(saveErr, OperationType.UPDATE, `video_history/${selectedHistoryId}`);
      } else {
        setWebhookResponseData({ ...historyPayload });
      }
    };

    try {
      for (let idx = 0; idx < parsedScenes.length; idx++) {
        const scene = parsedScenes[idx] as Record<string, unknown>;
        const sceneNum = Number(scene.sceneNumber ?? scene.scene_number ?? idx + 1);
        const debutUrl = findSceneImageUrl(sceneImages, selectedHistoryId, idx, "debut");
        const finUrl = findSceneImageUrl(sceneImages, selectedHistoryId, idx, "fin");
        const debut = scene.debut as { prompt?: string } | string | undefined;
        const fin = scene.fin as { prompt?: string } | string | undefined;
        const debutPrompt =
          typeof debut === "object" && debut && "prompt" in debut ? String(debut.prompt ?? "") : "";
        const finPrompt =
          typeof fin === "object" && fin && "prompt" in fin ? String(fin.prompt ?? "") : "";

        if (!debutUrl || !finUrl) {
          throw new Error(`Tsawer na9sin l-machhad ${sceneNum} (debut/fin).`);
        }

        setVeoInlineProgress(
          `Machhad ${sceneNum} / ${parsedScenes.length} — vision (debut/fin)...`
        );

        const analyzeData = await postAiJson(
          apiUrl("/api/ai/veo-scene-analyze"),
          {
            debutImageUrl: debutUrl,
            finImageUrl: finUrl,
            debutPrompt,
            finPrompt,
          },
          180_000
        );
        const analysis =
          typeof analyzeData.analysis === "string" ? analyzeData.analysis : "";

        setVeoInlineProgress(
          `Machhad ${sceneNum} / ${parsedScenes.length} — VEO JSON (ba3d vision)...`
        );

        const data = (await postAiJson(
          apiUrl("/api/ai/veo-scene-package"),
          {
            fullScript,
            sceneNumber: sceneNum,
            languageLabel,
            imageAnalysis: analysis,
          },
          180_000
        )) as {
          analysis?: string;
          scenePackage?: unknown;
          rawPackageText?: string;
          parseError?: string;
        };

        if (data.scenePackage != null) {
          packages.push({
            ...(data.scenePackage as object),
            _imageAnalysis: data.analysis ?? analysis,
          });
        } else {
          packages.push({
            sceneNumber: sceneNum,
            _imageAnalysis: data.analysis ?? analysis,
            _parseError: data.parseError ?? "JSON parse failed",
            _rawPackageText: data.rawPackageText ?? "",
          });
        }

        setVeoResponseData({
          scenes: [...packages],
          generatedInApp: true,
          generating: true,
          generationTotal: parsedScenes.length,
        });

        await persistVeoToHistory(packages);
      }

      setVeoResponseData({
        scenes: packages,
        generatedInApp: true,
        generating: false,
        generationTotal: parsedScenes.length,
      });
      setVeoInlineProgress(`Tkmel — ${packages.length} machhad / ${parsedScenes.length}.`);
      await refreshUserData(user.id);
    } catch (err) {
      console.error(err);
      const msg = generationErrorMessage(err);
      setError(msg);
      setVeoResponseData({
        scenes: packages,
        generatedInApp: true,
        generating: false,
        generationTotal: parsedScenes.length,
      });
      if (packages.length > 0) {
        await persistVeoToHistory(packages, { partial: true });
        await refreshUserData(user.id);
      }
      alert(msg);
    } finally {
      setIsGeneratingVeoPackages(false);
      window.setTimeout(() => setVeoInlineProgress(null), 4000);
    }
  };

  const handleDownloadAllSceneStills = useCallback(async () => {
    if (!selectedHistoryId) {
      alert("Khtar video f History bach t-telecharger tsawer debut/fin.");
      return;
    }
    const vid = selectedHistoryId;
    type Entry = { idx: number; sceneNumber: number };
    let entries: Entry[] = [];

    const wh =
      webhookResponseData && typeof webhookResponseData === "object"
        ? (webhookResponseData as Record<string, unknown>)
        : null;
    const rawScenes = wh ? pickScenesFromWebhookPayload(wh) : undefined;
    const parsed = rawScenes != null ? parseScenesData(rawScenes) : [];
    if (parsed.length > 0) {
      parsed.forEach((scene: any, idx: number) => {
        const sceneNumber = Number(scene.sceneNumber ?? scene.scene_number ?? idx + 1);
        entries.push({ idx, sceneNumber });
      });
    } else {
      const prefix = `${vid}-`;
      const idxSet = new Set<number>();
      for (const k of Object.keys(sceneImages)) {
        if (!k.startsWith(prefix)) continue;
        const m = k.slice(prefix.length).match(/^(\d+)-(debut|fin)$/);
        if (m) idxSet.add(Number(m[1]));
      }
      const sorted = [...idxSet].sort((a, b) => a - b);
      entries = sorted.map((idx) => ({ idx, sceneNumber: idx + 1 }));
    }

    if (entries.length === 0) {
      alert("Ma-l9itach machahid ola tsawer dial had video.");
      return;
    }

    setIsDownloadingSceneStills(true);
    try {
      const idPrefix = (vid.length >= 3 ? vid.slice(0, 3) : vid || "id").replace(
        /[/\\?%*:|"<>]/g,
        "-"
      );
      const zip = new JSZip();
      let added = 0;
      for (const { idx, sceneNumber } of entries) {
        const debutUrl = findSceneImageUrl(sceneImages, selectedHistoryId, idx, "debut");
        const finUrl = findSceneImageUrl(sceneImages, selectedHistoryId, idx, "fin");
        if (debutUrl) {
          const { blob, ext } = await fetchRemoteImageBlob(debutUrl);
          zip.file(`${idPrefix}-debut-${sceneNumber}${ext}`, blob);
          added += 1;
        }
        if (finUrl) {
          const { blob, ext } = await fetchRemoteImageBlob(finUrl);
          zip.file(`${idPrefix}-fin-${sceneNumber}${ext}`, blob);
          added += 1;
        }
      }
      if (added === 0) {
        alert("Ma-l9itach URLs dial tsawer (uploadi debut/fin 9bel).");
        return;
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipName = `${idPrefix}-debut-fin-scenes.zip`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zipBlob);
      a.download = zipName.replace(/[/\\?%*:|"<>]/g, "-");
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (e) {
      console.error(e);
      alert(
        e instanceof Error
          ? e.message
          : "Mouchkil f-telechargement ZIP — t2ked men CORS (utfs.io) wla jereb browser akhor."
      );
    } finally {
      setIsDownloadingSceneStills(false);
    }
  }, [selectedHistoryId, webhookResponseData, sceneImages]);

  const sendToWebhook = async () => {
    if (!webhookUrl || !generatedScript || generatedScript === "Smah lina, ma9dernach n-generiw script.") return;
    if (!user) return;

    // Reference images are optional in the UI; draft flags can be stale. Send refs only when URLs exist.
    const payloadUseModelRef = !!modelImageUrl;
    const payloadUseProductRef = !!productImageUrl;
    const payloadUseBackgroundRef = !!backgroundImageUrl;

    setIsSendingWebhook(true);
    setWebhookStatus("idle");
    setGeneratedVideoUrl(null);
    setWebhookResponseText(null);
    setWebhookResponseData(null);
    setVeoResponseData(null);
    setActiveTab("videoResult");

    const historyId = await createVideoHistoryPending(selectedProductId);
    if (!historyId) {
      setIsSendingWebhook(false);
      return;
    }
    setSelectedHistoryId(historyId);
    const webhookVideoId = videoPageDisplayId(historyId);

    try {
      const step3Parsed =
        visualPromptsText?.trim() ? parseStep3ModelBackground(visualPromptsText.trim()) : null;
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productId: selectedProductId,
          sceneCount,
          secondsPerScene: SECONDS_PER_SCENE,
          totalVideoSeconds: parseSceneCountForVideo(sceneCount) * SECONDS_PER_SCENE,
          voiceScriptLanguage,
          veoAvoidWords: veoAvoidWords.trim(),
          customPrompt,
          modelGender,
          modelAge,
          script: generatedScript,
          visualPrompts: visualPromptsText?.trim() ?? "",
          modelPrompt: step3Parsed?.model ?? "",
          backgroundPrompt: step3Parsed?.background ?? "",
          scenes: generatedScenes ? generatedScenes.map((s) => JSON.stringify(s)).join(", ") : "",
          modelImageUrl: modelImageUrl ?? null,
          productImageUrl: productImageUrl ?? null,
          backgroundImageUrl: backgroundImageUrl ?? null,
          useModelRef: payloadUseModelRef,
          useProductRef: payloadUseProductRef,
          useBackgroundRef: payloadUseBackgroundRef,
          timestamp: new Date().toISOString(),
          videoId: webhookVideoId,
        }),
      });

      if (response.ok) {
        setWebhookStatus("success");
        try {
          const text = await response.text();
          try {
            const data = JSON.parse(text);
            let url = null;
            if (typeof data === "string") {
              url = data;
            } else if (data && typeof data === "object") {
              url =
                data.videoUrl ||
                data.url ||
                data.fileUrl ||
                data.result ||
                data.video ||
                data.link ||
                data.output;
            }

            if (url && typeof url === "string" && url.startsWith("http")) {
              setGeneratedVideoUrl(url);
              setWebhookResponseText(null);
              setWebhookResponseData(null);
              setVeoResponseData(null);
              await finalizeVideoHistory(historyId, null, null, url);
            } else {
              console.log("Webhook response JSON:", data);
              if (text.startsWith("http")) {
                setGeneratedVideoUrl(text);
                setWebhookResponseText(null);
                setWebhookResponseData(null);
                setVeoResponseData(null);
                await finalizeVideoHistory(historyId, null, null, text);
              } else {
                setWebhookResponseText(text);

                let parsedData = { ...data };
                if (
                  typeof parsedData.script === "string" &&
                  (parsedData.script.startsWith("{") || parsedData.script.startsWith("["))
                ) {
                  try {
                    parsedData.script = JSON.parse(parsedData.script);
                  } catch {
                    /* ignore */
                  }
                }
                if (typeof parsedData.scenes === "string") {
                  let s = parsedData.scenes.trim();
                  s = s.replace(/\n/g, " ").replace(/\r/g, "");
                  if (s.startsWith("{") && s.endsWith("}")) {
                    s = `[${s}]`;
                  }
                  try {
                    const parsed = JSON.parse(s);
                    if (Array.isArray(parsed)) parsedData.scenes = parsed;
                    else if (typeof parsed === "object" && parsed !== null)
                      parsedData.scenes = [parsed];
                  } catch (e) {
                    console.error("Failed to parse scenes in sendToWebhook:", e);
                  }
                }
                setWebhookResponseData(parsedData);
                setVeoResponseData(null);
                await finalizeVideoHistory(historyId, parsedData, text, null);
              }
            }
          } catch {
            const brokenData = parseBrokenWebhookResponse(text);
            if (brokenData) {
              setWebhookResponseData(brokenData);
              setVeoResponseData(null);
              setWebhookResponseText(null);
              await finalizeVideoHistory(historyId, brokenData, text, null);
            } else {
              const cleanText = text.replace(/^["']|["']$/g, "").trim();
              if (cleanText.startsWith("http")) {
                setGeneratedVideoUrl(cleanText);
                setWebhookResponseText(null);
                setWebhookResponseData(null);
                setVeoResponseData(null);
                await finalizeVideoHistory(historyId, null, null, cleanText);
              } else {
                console.log("Webhook raw response:", text);
                setWebhookResponseText(text);
                setWebhookResponseData(null);
                setVeoResponseData(null);
                await finalizeVideoHistory(historyId, null, text, null);
              }
            }
          }
        } catch (e) {
          console.error("Error reading response:", e);
        }
        setTimeout(() => setWebhookStatus("idle"), 3000);
      } else {
        await rollbackVideoHistory(historyId);
        setSelectedHistoryId(null);
        setWebhookStatus("error");
        setTimeout(() => setWebhookStatus("idle"), 3000);
      }
    } catch (e) {
      console.error("Failed to send to webhook:", e);
      await rollbackVideoHistory(historyId);
      setSelectedHistoryId(null);
      setWebhookStatus("error");
      setTimeout(() => setWebhookStatus("idle"), 3000);
    } finally {
      setIsSendingWebhook(false);
    }
  };

  const saveScript = async () => {
    if (!user || !generatedScript) return;
    try {
      const { error: scriptErr } = await supabase.from("saved_scripts").insert({
        product_id: selectedProductId,
        custom_prompt: customPrompt,
        content: generatedScript,
        scenes: generatedScenes ?? null,
        owner_id: user.id,
      });
      if (scriptErr) throw scriptErr;

      let voiceScriptOnly = (voiceOnlyScript ?? "").trim();
      if (!voiceScriptOnly) {
        const marker = "السكريبت الصوتي الكامل";
        if (generatedScript.includes(marker)) {
          const parts = generatedScript.split(marker);
          let lastPart = parts[parts.length - 1];
          const newlineIndex = lastPart.indexOf("\n");
          if (newlineIndex !== -1) {
            voiceScriptOnly = lastPart.substring(newlineIndex + 1).trim();
          } else {
            voiceScriptOnly = lastPart.replace(/^[^:]*:\s*/, "").trim();
          }
        }
      }

      if (voiceScriptOnly) {
        const { error: vErr } = await supabase.from("videos").insert({
          product_id: selectedProductId,
          name: "Script Généré (AI)",
          transcription: voiceScriptOnly,
          owner_id: user.id,
        });
        if (vErr) throw vErr;
      }

      await refreshUserData(user.id);
      alert("Script m-sauvegarder b-naja7! (Tzad 7ta f l-videos bach y-t3lem mno l-AI)");
    } catch (err) {
      handleDbError(err, OperationType.WRITE, 'saved_scripts');
    }
  };

  const deleteSavedScript = async (id: string) => {
    if (!user) return;
    try {
      const { error } = await supabase.from("saved_scripts").delete().eq("id", id);
      if (error) throw error;
      
      // Clean up scene images for this saved script
      setSceneImages(prev => {
        const updated = { ...prev };
        let hasChanges = false;
        Object.keys(updated).forEach(key => {
          if (key.startsWith(`${id}-`)) {
            delete updated[key];
            hasChanges = true;
          }
        });
        if (hasChanges) {
          localforage.setItem('sceneImages', updated).catch(err => console.error("Failed to save scene images", err));
        }
        return updated;
      });
      await refreshUserData(user.id);
    } catch (err) {
      handleDbError(err, OperationType.DELETE, 'saved_scripts');
    }
  };

  const handleSavedModelImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setSavedScriptModelImageFile(null);
      setSavedScriptModelImageUrl(null);
      return;
    }
    setSavedScriptModelImageFile(file);
    setIsUploadingSavedModel(true);
    try {
      const res = await uploadFiles("imageUploader", {
        files: [file],
      });
      if (res && res.length > 0) {
        const u = res[0].url;
        setSavedScriptModelImageUrl(u);
        pushReferenceImageHistoryToLs(u);
        setReferenceHistoryTick((t) => t + 1);
      }
    } catch (err) {
      console.error("Failed to upload model image:", err);
      alert("Mouchkil f upload d tswira d l-model");
    } finally {
      setIsUploadingSavedModel(false);
    }
  };

  const handleSavedProductImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setSavedScriptProductImageFile(null);
      setSavedScriptProductImageUrl(null);
      return;
    }
    setSavedScriptProductImageFile(file);
    setIsUploadingSavedProduct(true);
    try {
      const res = await uploadFiles("imageUploader", {
        files: [file],
      });
      if (res && res.length > 0) {
        const u = res[0].url;
        setSavedScriptProductImageUrl(u);
        pushReferenceImageHistoryToLs(u);
        setReferenceHistoryTick((t) => t + 1);
      }
    } catch (err) {
      console.error("Failed to upload product image:", err);
      alert("Mouchkil f upload d tswira d l-produit");
    } finally {
      setIsUploadingSavedProduct(false);
    }
  };

  const handleSavedBackgroundImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setSavedScriptBackgroundImageFile(null);
      setSavedScriptBackgroundImageUrl(null);
      return;
    }
    setSavedScriptBackgroundImageFile(file);
    setIsUploadingSavedBackground(true);
    try {
      const res = await uploadFiles("imageUploader", {
        files: [file],
      });
      if (res && res.length > 0) {
        const u = res[0].url;
        setSavedScriptBackgroundImageUrl(u);
        pushReferenceImageHistoryToLs(u);
        setReferenceHistoryTick((t) => t + 1);
      }
    } catch (err) {
      console.error("Failed to upload background image:", err);
      alert("Mouchkil f upload d tswira d l-background");
    } finally {
      setIsUploadingSavedBackground(false);
    }
  };

  const handleProductCardImageUpload = async (
    productId: string,
    field: "model" | "product",
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    setProductRefUploadKey(`${productId}-${field}`);
    try {
      const res = await uploadFiles("imageUploader", { files: [file] });
      if (res && res.length > 0) {
        const u = res[0].url;
        const col = field === "model" ? "model_image_url" : "product_image_url";
        const { error } = await supabase
          .from("products")
          .update({ [col]: u })
          .eq("id", productId)
          .eq("owner_id", user.id);
        if (error) throw error;
        pushReferenceImageHistoryToLs(u);
        setReferenceHistoryTick((t) => t + 1);
        await refreshUserData(user.id);
      }
    } catch (err) {
      console.error("Product ref upload failed:", err);
      alert("Mouchkil f upload d tswira d l-produit");
    } finally {
      setProductRefUploadKey(null);
    }
  };

  const handleNewProductModelImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setIsUploadingNewProductModel(true);
    try {
      const res = await uploadFiles("imageUploader", { files: [file] });
      if (res && res.length > 0) {
        const u = res[0].url;
        setNewProductModelImageUrl(u);
        pushReferenceImageHistoryToLs(u);
        setReferenceHistoryTick((t) => t + 1);
      }
    } catch (err) {
      console.error(err);
      alert("Mouchkil f upload d tswira d l-model");
    } finally {
      setIsUploadingNewProductModel(false);
    }
  };

  const handleNewProductProductImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setIsUploadingNewProductProduct(true);
    try {
      const res = await uploadFiles("imageUploader", { files: [file] });
      if (res && res.length > 0) {
        const u = res[0].url;
        setNewProductProductImageUrl(u);
        pushReferenceImageHistoryToLs(u);
        setReferenceHistoryTick((t) => t + 1);
      }
    } catch (err) {
      console.error(err);
      alert("Mouchkil f upload d tswira d l-produit");
    } finally {
      setIsUploadingNewProductProduct(false);
    }
  };

  const sendSavedScriptToWebhook = async () => {
    if (!webhookUrl || !scriptToSend) return;
    if (!user) return;
    const st = scriptToSend;

    const missingImages: string[] = [];
    if (savedScriptModelImageFile && !savedScriptModelImageUrl)
      missingImages.push("Tswira d l-Model");
    if (savedScriptProductImageFile && !savedScriptProductImageUrl)
      missingImages.push("Tswira d l-Produit");
    if (savedScriptBackgroundImageFile && !savedScriptBackgroundImageUrl)
      missingImages.push("Tswira d l-Background");
    if (showMissingImagesDialog(missingImages)) return;

    setIsSendingWebhook(true);
    setWebhookStatus("idle");
    setGeneratedVideoUrl(null);
    setWebhookResponseText(null);
    setWebhookResponseData(null);
    setVeoResponseData(null);
    setScriptToSend(null);
    setActiveTab("videoResult");

    const historyId = await createVideoHistoryPending(st.productId);
    if (!historyId) {
      setIsSendingWebhook(false);
      return;
    }
    setSelectedHistoryId(historyId);
    const webhookVideoId = videoPageDisplayId(historyId);

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productId: st.productId,
          customPrompt: st.customPrompt,
          script: st.content,
          scenes: st.scenes ? st.scenes.map((s) => JSON.stringify(s)).join(", ") : "",
          modelImageUrl: savedScriptModelImageUrl,
          productImageUrl: savedScriptProductImageUrl,
          backgroundImageUrl: savedScriptBackgroundImageUrl,
          timestamp: new Date().toISOString(),
          videoId: webhookVideoId,
        }),
      });

      if (response.ok) {
        setWebhookStatus("success");
        try {
          const text = await response.text();
          try {
            const data = JSON.parse(text);
            let url = null;
            if (typeof data === "string") {
              url = data;
            } else if (data && typeof data === "object") {
              url =
                data.videoUrl ||
                data.url ||
                data.fileUrl ||
                data.result ||
                data.video ||
                data.link ||
                data.output;
            }

            if (url && typeof url === "string" && url.startsWith("http")) {
              setGeneratedVideoUrl(url);
              setWebhookResponseText(null);
              setWebhookResponseData(null);
              setVeoResponseData(null);
              await finalizeVideoHistory(historyId, null, null, url);
            } else {
              console.log("Webhook response JSON:", data);
              if (text.startsWith("http")) {
                setGeneratedVideoUrl(text);
                setWebhookResponseText(null);
                setWebhookResponseData(null);
                setVeoResponseData(null);
                await finalizeVideoHistory(historyId, null, null, text);
              } else {
                setWebhookResponseText(text);

                let parsedData = { ...data };
                if (
                  typeof parsedData.script === "string" &&
                  (parsedData.script.startsWith("{") || parsedData.script.startsWith("["))
                ) {
                  try {
                    parsedData.script = JSON.parse(parsedData.script);
                  } catch {
                    /* ignore */
                  }
                }
                if (typeof parsedData.scenes === "string") {
                  let s = parsedData.scenes.trim();
                  s = s.replace(/\n/g, " ").replace(/\r/g, "");
                  if (s.startsWith("{") && s.endsWith("}")) {
                    s = `[${s}]`;
                  }
                  try {
                    const parsed = JSON.parse(s);
                    if (Array.isArray(parsed)) parsedData.scenes = parsed;
                    else if (typeof parsed === "object" && parsed !== null)
                      parsedData.scenes = [parsed];
                  } catch (e) {
                    console.error("Failed to parse scenes in sendSavedScriptToWebhook:", e);
                  }
                }
                setWebhookResponseData(parsedData);
                setVeoResponseData(null);
                await finalizeVideoHistory(historyId, parsedData, text, null);
              }
            }
          } catch {
            const brokenData = parseBrokenWebhookResponse(text);
            if (brokenData) {
              setWebhookResponseData(brokenData);
              setVeoResponseData(null);
              setWebhookResponseText(null);
              await finalizeVideoHistory(historyId, brokenData, text, null);
            } else {
              const cleanText = text.replace(/^["']|["']$/g, "").trim();
              if (cleanText.startsWith("http")) {
                setGeneratedVideoUrl(cleanText);
                setWebhookResponseText(null);
                setWebhookResponseData(null);
                setVeoResponseData(null);
                await finalizeVideoHistory(historyId, null, null, cleanText);
              } else {
                console.log("Webhook raw response:", text);
                setWebhookResponseText(text);
                setWebhookResponseData(null);
                setVeoResponseData(null);
                await finalizeVideoHistory(historyId, null, text, null);
              }
            }
          }
        } catch (e) {
          console.error("Error reading response:", e);
        }
        setTimeout(() => setWebhookStatus("idle"), 3000);
      } else {
        await rollbackVideoHistory(historyId);
        setSelectedHistoryId(null);
        setWebhookStatus("error");
        setTimeout(() => setWebhookStatus("idle"), 3000);
      }
    } catch (e) {
      console.error("Failed to send to webhook:", e);
      await rollbackVideoHistory(historyId);
      setSelectedHistoryId(null);
      setWebhookStatus("error");
      setTimeout(() => setWebhookStatus("idle"), 3000);
    } finally {
      setIsSendingWebhook(false);
      setSavedScriptModelImageFile(null);
      setSavedScriptModelImageUrl(null);
      setSavedScriptProductImageFile(null);
      setSavedScriptProductImageUrl(null);
    }
  };

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  if (passwordRecoveryMode && user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center space-y-6">
          <div className="bg-orange-500 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-orange-200">
            <KeyRound className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">7awed l-password</h1>
          <p className="text-gray-500 text-sm">
            Dkhel password jdid l-compte{" "}
            <span className="font-medium text-gray-700">{user.email}</span>
          </p>
          <div className="space-y-3 text-left">
            <label className="block text-sm font-medium text-gray-700">
              Password jdid
            </label>
            <input
              type="password"
              value={recoveryPassword}
              onChange={(e) => setRecoveryPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
              autoComplete="new-password"
            />
            <label className="block text-sm font-medium text-gray-700">
              3awd l-password
            </label>
            <input
              type="password"
              value={recoveryConfirmPassword}
              onChange={(e) => setRecoveryConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
              autoComplete="new-password"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>
          )}
          <button
            type="button"
            onClick={() => void handleCompletePasswordRecovery()}
            disabled={recoverySending}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-gray-800 transition-all disabled:opacity-60"
          >
            {recoverySending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <KeyRound className="w-5 h-5" />
            )}
            {recoverySending ? "Sandani..." : "7awed l-password"}
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center space-y-6">
          <div className="bg-orange-500 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-orange-200">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Video Flow</h1>
          <p className="text-gray-500">Kteb scripts dial TikTok ads b-Darija derya o b-style dialk.</p>
          {authMode !== "forgot" ? (
            <div className="flex rounded-xl bg-gray-100 p-1 text-sm font-medium">
              <button
                type="button"
                className={cn(
                  "flex-1 py-2 rounded-lg transition-colors",
                  authMode === "login" ? "bg-white shadow text-gray-900" : "text-gray-500"
                )}
                onClick={() => {
                  setAuthMode("login");
                  setError(null);
                  setLoginMessage(null);
                }}
              >
                Dkhol
              </button>
              <button
                type="button"
                className={cn(
                  "flex-1 py-2 rounded-lg transition-colors",
                  authMode === "signup" ? "bg-white shadow text-gray-900" : "text-gray-500"
                )}
                onClick={() => {
                  setAuthMode("signup");
                  setError(null);
                  setLoginMessage(null);
                }}
              >
                Compte jdid
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="text-sm text-orange-600 font-medium hover:underline"
              onClick={() => {
                setAuthMode("login");
                setError(null);
                setLoginMessage(null);
              }}
            >
              ← Rje3 l-login
            </button>
          )}
          <div className="space-y-3 text-left">
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="your@email.com"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
              autoComplete="email"
            />
            {authMode !== "forgot" && (
              <>
                <label className="block text-sm font-medium text-gray-700">Password</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
                  autoComplete={authMode === "signup" ? "new-password" : "current-password"}
                />
              </>
            )}
            {authMode === "signup" && (
              <>
                <label className="block text-sm font-medium text-gray-700">3awd l-password</label>
                <input
                  type="password"
                  value={loginConfirmPassword}
                  onChange={(e) => setLoginConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
                  autoComplete="new-password"
                />
              </>
            )}
            {authMode === "login" && (
              <button
                type="button"
                className="text-sm text-orange-600 hover:underline"
                onClick={() => {
                  setAuthMode("forgot");
                  setError(null);
                  setLoginMessage(null);
                }}
              >
                Nsit l-password?
              </button>
            )}
          </div>
          {loginMessage && (
            <p className="text-sm text-green-600 bg-green-50 rounded-xl px-3 py-2">{loginMessage}</p>
          )}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>
          )}
          <button
            type="button"
            onClick={() =>
              void (authMode === "forgot"
                ? handleSendPasswordReset()
                : handlePasswordAuth())
            }
            disabled={loginSending}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-gray-800 transition-all disabled:opacity-60"
          >
            {loginSending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : authMode === "forgot" ? (
              <KeyRound className="w-5 h-5" />
            ) : (
              <LogIn className="w-5 h-5" />
            )}
            {loginSending
              ? "Sandani..."
              : authMode === "signup"
                ? "Sijel"
                : authMode === "forgot"
                  ? "Sifet l-lien"
                  : "Dkhol"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans pb-20">
      {authNotice && (
        <div className="bg-green-50 border-b border-green-100 px-4 py-2.5 text-center text-sm text-green-800 flex flex-wrap items-center justify-center gap-2">
          <span>{authNotice}</span>
          <button
            type="button"
            onClick={() => setAuthNotice(null)}
            className="font-medium underline text-green-900"
          >
            Fermer
          </button>
        </div>
      )}
      {dataSyncError && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-sm text-amber-950">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold">Ma-tchargawch l-data mn Supabase</p>
              <p className="text-amber-900/90 break-words mt-1">{dataSyncError}</p>
              <p className="text-xs text-amber-800/80 mt-2">
                Ghaleb: migrations ma-texecutawch, RLS, wla <code className="bg-amber-100 px-1 rounded">VITE_SUPABASE_*</code> ma-homach dial nafs l-project li fih l-data. Chof browser console.
              </p>
            </div>
            <button
              type="button"
              onClick={() => user && void refreshUserData(user.id)}
              className="shrink-0 px-4 py-2 bg-amber-600 text-white rounded-xl font-medium hover:bg-amber-700"
            >
              Jereb tani
            </button>
          </div>
        </div>
      )}
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 sm:py-0 sm:h-auto sm:min-h-16 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center justify-between gap-2 min-w-0 sm:justify-start sm:shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="bg-orange-500 p-1.5 rounded-lg shrink-0">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <h1 className="font-bold text-base sm:text-xl tracking-tight truncate">Video Flow</h1>
            </div>
            <div className="flex items-center gap-1 sm:hidden shrink-0">
              <button onClick={() => setActiveTab("settings")} className="p-2 text-gray-400 hover:text-gray-700 transition-colors" type="button" title="I3dadat">
                <Settings className="w-5 h-5" />
              </button>
              <button onClick={() => void handleLogout()} className="p-2 text-gray-400 hover:text-red-500 transition-colors" type="button" title="Logout">
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>

          <nav className="flex bg-gray-100 p-1 rounded-xl overflow-x-auto max-w-full -mx-0.5 px-0.5 sm:mx-0 sm:px-0 sm:flex-1 sm:justify-center sm:min-w-0 touch-pan-x">
            {[
              { id: 'products', icon: Package, label: 'Produits' },
              { id: 'generate', icon: PenTool, label: 'Generi' },
              { id: 'saved', icon: Bookmark, label: 'Mkhbyin' },
              { id: 'videoResult', icon: Video, label: 'Video' },
              { id: 'veoResult', icon: Sparkles, label: 'Veo' },
              { id: 'settings', icon: Settings, label: 'I3dadat' },
            ].map(tab => (
              <button 
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                  "px-3 sm:px-5 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all flex items-center gap-1.5 sm:gap-2 whitespace-nowrap shrink-0",
                  activeTab === tab.id ? "bg-white shadow-sm text-orange-600" : "text-gray-500 hover:text-gray-700"
                )}
              >
                <tab.icon className="w-4 h-4 shrink-0" />
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="hidden sm:flex items-center gap-2 shrink-0">
            <button onClick={() => setActiveTab("settings")} className="p-2 text-gray-400 hover:text-gray-700 transition-colors" type="button" title="I3dadat">
              <Settings className="w-5 h-5" />
            </button>
            <button onClick={() => void handleLogout()} className="p-2 text-gray-400 hover:text-red-500 transition-colors" type="button" title="Logout">
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="w-full max-w-[1600px] mx-auto px-3 sm:px-4 py-4 sm:py-8 pb-24 sm:pb-8">
        {activeTab === 'products' && (
          <div className="space-y-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-xl sm:text-2xl font-bold">L-Produits dialk</h2>
              <button 
                type="button"
                onClick={() => setIsAddProductModalOpen(true)}
                className="w-full sm:w-auto justify-center px-4 py-2.5 bg-black text-white rounded-xl font-semibold flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Zid Produit
              </button>
            </div>

            <div className="grid grid-cols-1 gap-8">
              {products.map(p => (
                <div key={p.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <div 
                    className="p-4 sm:p-6 border-b border-gray-50 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-gray-50/50 cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={() => setExpandedProducts(prev => ({ ...prev, [p.id]: !prev[p.id] }))}
                  >
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                      <button type="button" className="p-1 bg-white rounded-full shadow-sm border border-gray-200 text-gray-500 shrink-0">
                        {expandedProducts[p.id] ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                      </button>
                      <ProductThumb url={productVisualRef(p)} alt={p.name} size="lg" className="shadow-sm" />
                      <div className="min-w-0">
                        <h3 className="font-bold text-lg sm:text-xl truncate">{p.name}</h3>
                        <p className="text-gray-500 text-sm line-clamp-2">{p.description}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                      <input 
                        type="file" 
                        accept="video/*" 
                        multiple
                        className="hidden" 
                        id={`video-upload-${p.id}`}
                        onChange={(e) => {
                          handleVideoSelect(e.target.files, p.id);
                          e.target.value = ''; // Reset input
                        }}
                      />
                      <label 
                        htmlFor={`video-upload-${p.id}`}
                        className="px-3 sm:px-4 py-2 bg-orange-500 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 cursor-pointer hover:bg-orange-600 transition-all"
                      >
                        <Video className="w-4 h-4" />
                        Zid Videos
                      </label>
                      <button onClick={(e) => { e.stopPropagation(); deleteProduct(p.id); }} className="p-2 text-gray-400 hover:text-red-500 transition-colors">
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>

                  {expandedProducts[p.id] && (
                    <div className="p-6">
                      <div className="mb-6 pb-6 border-b border-gray-100">
                        <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">
                          Tsawer l-produit (packaging / refs)
                        </h4>
                        <p className="text-xs text-gray-500 mb-4">
                          Kayt-sauvegardiw f Supabase o kaybano f liste Veo/Video o Generate bach t-organizi.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <span className="text-xs font-semibold text-gray-600">Model ref</span>
                            <div className="flex items-stretch gap-2">
                              <label className="flex-1 min-h-[2.75rem] cursor-pointer border border-dashed border-gray-200 rounded-xl px-3 py-2 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  id={`product-model-${p.id}`}
                                  onChange={(e) => void handleProductCardImageUpload(p.id, "model", e)}
                                  disabled={productRefUploadKey === `${p.id}-model`}
                                />
                                {productRefUploadKey === `${p.id}-model` ? (
                                  <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />
                                ) : (
                                  <Upload className="w-4 h-4 text-gray-400" />
                                )}
                                <span className="text-xs text-gray-500 truncate">Upload</span>
                              </label>
                              <button
                                type="button"
                                title="Khtar men tsawer li deja uploditi"
                                onClick={() =>
                                  setReferenceImagePicker({ kind: "productCardRef", productId: p.id, field: "model" })
                                }
                                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition-colors"
                              >
                                <Images className="w-4 h-4 shrink-0" />
                                <span className="hidden sm:inline">Déjà</span>
                              </button>
                            </div>
                            <div className="flex justify-start">
                              <ProductThumb url={p.modelImageUrl} alt="Model" size="lg" />
                            </div>
                          </div>
                          <div className="space-y-2">
                            <span className="text-xs font-semibold text-gray-600">Tswira d l-produit</span>
                            <div className="flex items-stretch gap-2">
                              <label className="flex-1 min-h-[2.75rem] cursor-pointer border border-dashed border-gray-200 rounded-xl px-3 py-2 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  id={`product-pack-${p.id}`}
                                  onChange={(e) => void handleProductCardImageUpload(p.id, "product", e)}
                                  disabled={productRefUploadKey === `${p.id}-product`}
                                />
                                {productRefUploadKey === `${p.id}-product` ? (
                                  <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />
                                ) : (
                                  <Upload className="w-4 h-4 text-gray-400" />
                                )}
                                <span className="text-xs text-gray-500 truncate">Upload</span>
                              </label>
                              <button
                                type="button"
                                title="Khtar men tsawer li deja uploditi"
                                onClick={() =>
                                  setReferenceImagePicker({ kind: "productCardRef", productId: p.id, field: "product" })
                                }
                                className="shrink-0 inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition-colors"
                              >
                                <Images className="w-4 h-4 shrink-0" />
                                <span className="hidden sm:inline">Déjà</span>
                              </button>
                            </div>
                            <div className="flex justify-start">
                              <ProductThumb url={p.productImageUrl} alt="Product" size="lg" />
                            </div>
                          </div>
                        </div>
                      </div>
                      <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Videos o Transcriptions</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {/* Pending Videos */}
                      {pendingVideos.filter(v => v.productId === p.id).map(v => (
                        <div key={v.id} className="bg-orange-50/50 p-4 rounded-xl border border-orange-100 space-y-3 relative">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-orange-600">
                              <FileVideo className="w-4 h-4" />
                              <span className="text-xs font-medium truncate max-w-[120px]">{v.file.name}</span>
                            </div>
                            <button onClick={() => removePendingVideo(v.id)} className="text-gray-400 hover:text-red-500 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          
                          <div className="relative w-full aspect-[9/16] bg-black rounded-lg overflow-hidden">
                            <video src={v.url} className="w-full h-full object-cover" controls />
                          </div>

                          <div className="space-y-1">
                            <label className="block text-[11px] font-semibold text-gray-600">
                              Had l-video kaymthel:
                            </label>
                            <select
                              value={v.exampleKind}
                              onChange={(e) => {
                                const next = e.target.value as
                                  | 'same_product'
                                  | 'same_effect';
                                setPendingVideos((prev) =>
                                  prev.map((pv) =>
                                    pv.id === v.id ? { ...pv, exampleKind: next } : pv
                                  )
                                );
                              }}
                              disabled={v.status === 'transcribing'}
                              className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 outline-none disabled:opacity-60"
                            >
                              <option value="same_product">Nafs l-produit</option>
                              <option value="same_effect">Produit akhor (nafs l-fa3alia)</option>
                            </select>
                          </div>

                          {v.error && <p className="text-xs text-red-500">{v.error}</p>}

                          <button 
                            onClick={() => handleVideoTranscription(v)}
                            disabled={v.status === 'transcribing'}
                            className="w-full py-2 bg-black text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            {v.status === 'transcribing' ? (
                              <><Loader2 className="w-4 h-4 animate-spin" /> Kan-sauvegardiw...</>
                            ) : (
                              <><Sparkles className="w-4 h-4" /> Transcribe o Sauvegarder</>
                            )}
                          </button>
                          <p className="text-[10px] text-center text-orange-600/70 font-medium">
                            L-video ma m-sauvegardach hta t-dir Transcribe
                          </p>
                        </div>
                      ))}

                      {/* Transcribed Videos */}
                      {videos.filter(v => v.productId === p.id).map(v => (
                        <div key={v.id} className="bg-gray-50 p-4 rounded-xl border border-gray-100 space-y-3 group relative">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-gray-600">
                              <FileVideo className="w-4 h-4" />
                              <span className="text-xs font-medium truncate max-w-[120px]">{v.name || 'Video'}</span>
                            </div>
                            <span
                              className={cn(
                                "text-[10px] px-2 py-0.5 rounded-full border font-semibold",
                                (v.exampleKind ?? 'same_product') === 'same_effect'
                                  ? "bg-purple-50 text-purple-700 border-purple-200"
                                  : "bg-green-50 text-green-700 border-green-200"
                              )}
                            >
                              {(v.exampleKind ?? 'same_product') === 'same_effect'
                                ? 'Same effect'
                                : 'Same product'}
                            </span>
                            <button onClick={() => deleteVideo(v.id)} className="text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          
                          {v.thumbnailBase64 ? (
                            <div className="relative w-full aspect-[9/16] bg-black rounded-lg overflow-hidden">
                              <img src={v.thumbnailBase64} alt="Thumbnail" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                                <div className="bg-white/90 p-3 rounded-full shadow-lg">
                                  <Video className="w-5 h-5 text-gray-800" />
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="w-full aspect-[9/16] bg-gray-100 rounded-lg flex flex-col items-center justify-center text-gray-500 text-xs p-4 text-center gap-2 border border-gray-200">
                              <FileVideo className="w-6 h-6 text-gray-300" />
                              <span>Thumbnail ma m-sauvegardach</span>
                            </div>
                          )}

                          <div className="text-sm text-gray-700 bg-white p-3 rounded-lg border border-gray-100 h-24 overflow-y-auto italic">
                            "{v.transcription}"
                          </div>
                        </div>
                      ))}
                      
                      {videos.filter(v => v.productId === p.id).length === 0 && pendingVideos.filter(v => v.productId === p.id).length === 0 && (
                        <div className="col-span-full py-8 text-center text-gray-400 text-sm border-2 border-dashed border-gray-100 rounded-xl">
                          Mazal ma ztti hta video l-had l-produit.
                        </div>
                      )}
                    </div>
                  </div>
                  )}
                </div>
              ))}
              {products.length === 0 && (
                <div
                  className={cn(
                    "py-20 text-center space-y-4",
                    dataSyncError ? "opacity-100" : "opacity-40"
                  )}
                >
                  <Package className="w-12 h-12 mx-auto text-gray-300" />
                  {dataSyncError ? (
                    <>
                      <p className="text-gray-800 font-medium">
                        Ma-l9inach produits — l-erreur dial Supabase f l-banner l-fou9.
                      </p>
                      <p className="text-sm text-gray-500 max-w-md mx-auto">
                        Ila ma-kayn hta erreur f l-banner, y3ni l-compte hada ma fih hta produit: zid wa7ed b &quot;Zid Produit&quot;.
                      </p>
                    </>
                  ) : (
                    <p>Mazal ma ztti hta produit. Click 3la &quot;Zid Produit&quot; l-fou9.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'generate' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-8">
            <div className="lg:col-span-5 space-y-4 sm:space-y-6">
              <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-sm border border-gray-100 space-y-4 sm:space-y-6">
                <h2 className="text-lg font-semibold">Generi Script Jdid</h2>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Khtar l-Produit</label>
                    <select 
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
                      value={selectedProductId}
                      onChange={(e) => setSelectedProductId(e.target.value)}
                    >
                      <option value="">-- Khtar --</option>
                      <option value="all">Ga3 l-Produits (All Products)</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    {generateSelectedProductPreview ? (
                      <div className="mt-2 flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-3 py-2">
                        <ProductThumb
                          url={productVisualRef(generateSelectedProductPreview)}
                          alt={generateSelectedProductPreview.name}
                          size="md"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-gray-800 truncate">
                            {generateSelectedProductPreview.name}
                          </p>
                          <p className="text-[10px] text-gray-500 truncate">
                            Tsawer dial l-produit: kaybano f Veo/Video o hnaya.
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Lougha d script swoti
                    </label>
                    <VoiceLanguageSelect
                      value={voiceScriptLanguage}
                      onChange={setVoiceScriptLanguage}
                      otherValue={voiceScriptLanguageOther}
                      onChangeOther={setVoiceScriptLanguageOther}
                      accentValue={voiceAccent}
                      onChangeAccent={setVoiceAccent}
                      accentOtherValue={voiceAccentOther}
                      onChangeAccentOther={setVoiceAccentOther}
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Ch7al mn machhad (Scenes)?</label>
                    <select 
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
                      value={sceneCount}
                      onChange={(e) => setSceneCount(e.target.value)}
                    >
                      <option value="2">2 Machahid</option>
                      <option value="3">3 Machahid</option>
                      <option value="4">4 Machahid</option>
                      <option value="5">5 Machahid</option>
                      <option value="6">6 Machahid</option>
                      <option value="7">7 Machahid</option>
                      <option value="8">8 Machahid</option>
                      <option value="9">9 Machahid</option>
                      <option value="10">10 Machahid</option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                        Model Gender
                      </label>
                      <select
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
                        value={modelGender}
                        onChange={(e) => setModelGender(e.target.value as ModelGender)}
                      >
                        <option value="any">Any</option>
                        <option value="woman">Woman</option>
                        <option value="man">Man</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                        Model Age
                      </label>
                      <select
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
                        value={modelAge}
                        onChange={(e) => setModelAge(e.target.value as ModelAge)}
                      >
                        <option value="any">Any</option>
                        <option value="young">Young</option>
                        <option value="aged">Aged</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Kifach bghiti l-video tkon? (Tone, Style, Ideas...)</label>
                    <textarea 
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none resize-none h-24 text-base sm:text-sm"
                      placeholder="Matalan: Bghit video tkon d7k o fiha storytelling 3la kifach had l-produit 3t9ni..."
                      value={customPrompt}
                      onChange={(e) => setCustomPrompt(e.target.value)}
                    />
                  </div>

                  {error && (
                    <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-center gap-2 text-red-600 text-sm">
                      <AlertCircle className="w-4 h-4" />
                      {error}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={generateScriptIdea}
                    disabled={isGenerating || !selectedProductId}
                    className="w-full py-3 bg-orange-500 text-white font-bold rounded-xl shadow-lg shadow-orange-100 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isGenerating && generatingPhase === "idea" ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" /> 1 — Generi l-Fikra
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={generateVoiceOnlyScript}
                    disabled={
                      isGenerating ||
                      !selectedProductId ||
                      !scriptIdea?.trim()
                    }
                    className="w-full py-3 bg-amber-600 text-white font-bold rounded-xl shadow-lg shadow-amber-100/80 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isGenerating && generatingPhase === "voice" ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" /> 2 — Generi Script Swoti
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={generateVisualPrompts}
                    disabled={
                      isGenerating ||
                      !selectedProductId ||
                      !voiceOnlyScript?.trim()
                    }
                    className="w-full py-3 bg-violet-700 text-white font-bold rounded-xl shadow-lg shadow-violet-100 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isGenerating && generatingPhase === "visuals" ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" /> 3 — Generi prompts (model wa7ed + décor)
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={generateVideoScript}
                    disabled={
                      isGenerating ||
                      !selectedProductId ||
                      !voiceOnlyScript?.trim() ||
                      !visualPromptsText?.trim()
                    }
                    className="w-full py-3 bg-stone-800 text-white font-bold rounded-xl shadow-lg shadow-stone-200 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isGenerating && generatingPhase === "video" ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" /> 4 — Generi Script Video (kamal)
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 min-h-0">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 h-full flex flex-col min-h-[280px] sm:min-h-[400px]">
                <div className="p-3 sm:p-4 border-b border-gray-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-lg font-semibold shrink-0">Natija</h2>
                  {(scriptIdea ||
                    voiceOnlyScript != null ||
                    visualPromptsText != null ||
                    generatedScript) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {webhookUrl && generatedScript && (
                        <button 
                          onClick={sendToWebhook}
                          disabled={
                            isSendingWebhook ||
                            isUploadingModel ||
                            isUploadingProduct ||
                            isUploadingBackground
                          }
                          className="p-2 hover:bg-purple-50 rounded-lg transition-colors flex items-center gap-2 text-sm text-purple-600 font-medium disabled:opacity-50"
                        >
                          {isSendingWebhook ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : webhookStatus === 'success' ? (
                            <Check className="w-4 h-4 text-green-500" />
                          ) : webhookStatus === 'error' ? (
                            <AlertCircle className="w-4 h-4 text-red-500" />
                          ) : (
                            <Send className="w-4 h-4" />
                          )}
                          {webhookStatus === 'success' ? 'Sifet!' : webhookStatus === 'error' ? 'Mouchkil' : 'Sifet l-Webhook'}
                        </button>
                      )}
                      {generatedScript && (
                        <button 
                          onClick={saveScript}
                          className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2 text-sm text-gray-600"
                        >
                          <Save className="w-4 h-4" />
                          Sauvegarder
                        </button>
                      )}
                      <button 
                        onClick={() => {
                          const scenesText = generatedScenes && generatedScenes.length > 0 ? '\n\n--- PROMPTS ---\n\n' + generatedScenes.map((s: any) => {
                            const debutModelRef = s.debut?.use_model_ref !== undefined ? ` [Model Ref: ${s.debut.use_model_ref ? 'Yes' : 'No'}]` : '';
                            const debutProductRef = s.debut?.use_product_ref !== undefined ? ` [Product Ref: ${s.debut.use_product_ref ? 'Yes' : 'No'}]` : '';
                            const debutBackgroundRef = s.debut?.use_background_ref !== undefined ? ` [Background Ref: ${s.debut.use_background_ref ? 'Yes' : 'No'}]` : '';
                            const finModelRef = s.fin?.use_model_ref !== undefined ? ` [Model Ref: ${s.fin.use_model_ref ? 'Yes' : 'No'}]` : '';
                            const finProductRef = s.fin?.use_product_ref !== undefined ? ` [Product Ref: ${s.fin.use_product_ref ? 'Yes' : 'No'}]` : '';
                            const finBackgroundRef = s.fin?.use_background_ref !== undefined ? ` [Background Ref: ${s.fin.use_background_ref ? 'Yes' : 'No'}]` : '';
                            return `Scene ${s.sceneNumber || s.scene_number}:\nDebut${debutModelRef}${debutProductRef}${debutBackgroundRef}: ${s.debut?.prompt || s.debut}\nFin${finModelRef}${finProductRef}${finBackgroundRef}: ${s.fin?.prompt || s.fin}`;
                          }).join('\n\n') : '';
                          const ideaBlock = scriptIdea ? `## 1. L-Fikra\n\n${scriptIdea}\n\n` : '';
                          const voiceBlock = voiceOnlyScript ? `## 2. Script swoti\n\n${voiceOnlyScript}\n\n` : '';
                          const visualBlock = visualPromptsText
                            ? `## 3. Prompts (model wa7ed + background)\n\n${visualPromptsText}\n\n`
                            : '';
                          const scriptBlock = generatedScript
                            ? `## 4. Script video (kamal)\n\n${generatedScript}`
                            : '';
                          const fullTextToCopy = `${ideaBlock}${voiceBlock}${visualBlock}${scriptBlock}${scenesText}`;
                          navigator.clipboard.writeText(fullTextToCopy);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2 text-sm text-gray-600"
                      >
                        {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                        {copied ? 'T-copia!' : 'Copi Kolchi'}
                      </button>
                    </div>
                  )}
                </div>
                <div className="p-4 sm:p-6 flex-1 overflow-y-auto min-h-0">
                  {(scriptIdea ||
                    voiceOnlyScript != null ||
                    visualPromptsText != null ||
                    generatedScript) ? (
                    <div>
                      {scriptIdea && (
                        <div className="mb-6 pb-6 border-b border-gray-100">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-3">
                            <h3 className="font-bold text-gray-800">1. L-Fikra</h3>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(scriptIdea);
                                  alert("T-copia l-fikra!");
                                }}
                                className="text-sm text-orange-600 hover:text-orange-800 bg-orange-50 px-3 py-2 rounded-lg font-medium"
                              >
                                <Copy className="w-4 h-4 inline mr-1" />
                                Copi
                              </button>
                              <button
                                type="button"
                                onClick={() => void generateScriptIdea()}
                                disabled={isGenerating || !selectedProductId}
                                className="text-sm text-gray-700 border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                              >
                                {isGenerating && generatingPhase === "idea" ? (
                                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                                ) : (
                                  <Sparkles className="w-4 h-4 shrink-0" />
                                )}
                                Generi merra khra
                              </button>
                            </div>
                          </div>
                          <div className="prose prose-orange prose-sm max-w-none text-gray-800 bg-amber-50/50 p-4 rounded-xl border border-amber-100">
                            <Markdown>{scriptIdea}</Markdown>
                          </div>
                        </div>
                      )}
                      {voiceOnlyScript !== null && (
                        <div className="mb-6 pb-6 border-b border-gray-100">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-3">
                            <h3 className="font-bold text-gray-800">2. Script swoti</h3>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(voiceOnlyScript);
                                  alert("T-copia script swoti!");
                                }}
                                className="text-sm text-orange-600 hover:text-orange-800 bg-orange-50 px-3 py-2 rounded-lg font-medium"
                              >
                                <Copy className="w-4 h-4 inline mr-1" />
                                Copi
                              </button>
                              <button
                                type="button"
                                onClick={() => void generateVoiceOnlyScript()}
                                disabled={
                                  isGenerating ||
                                  !selectedProductId ||
                                  !scriptIdea?.trim()
                                }
                                className="text-sm text-gray-700 border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                              >
                                {isGenerating && generatingPhase === "voice" ? (
                                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                                ) : (
                                  <Sparkles className="w-4 h-4 shrink-0" />
                                )}
                                Generi merra khra
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 mb-2">
                            Éditi l-voix hna، dīr Step 3 (prompts) men ba3d Step 4 (script video).
                          </p>
                          <textarea
                            className="w-full min-h-[180px] font-sans text-sm text-gray-800 bg-gray-50 p-4 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 outline-none resize-y"
                            value={voiceOnlyScript}
                            onChange={(e) => setVoiceOnlyScript(e.target.value)}
                            placeholder="Script dial l-voix hna…"
                            spellCheck={true}
                          />
                        </div>
                      )}
                      {visualPromptsText !== null && (
                        <div className="mb-6 pb-6 border-b border-gray-100">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-3">
                            <h3 className="font-bold text-gray-800">
                              3. Prompts — model (prompt wa7ed, fiche 2×2) + background
                            </h3>
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(visualPromptsText);
                                  alert("T-copia kolchi (markdown)!");
                                }}
                                className="text-sm text-orange-600 hover:text-orange-800 bg-orange-50 px-3 py-2 rounded-lg font-medium"
                              >
                                <Copy className="w-4 h-4 inline mr-1" />
                                Copi kolchi
                              </button>
                              <button
                                type="button"
                                onClick={() => void generateVisualPrompts()}
                                disabled={
                                  isGenerating ||
                                  !selectedProductId ||
                                  !voiceOnlyScript?.trim()
                                }
                                className="text-sm text-gray-700 border border-gray-200 hover:bg-gray-50 px-3 py-2 rounded-lg font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                              >
                                {isGenerating && generatingPhase === "visuals" ? (
                                  <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                                ) : (
                                  <Sparkles className="w-4 h-4 shrink-0" />
                                )}
                                Generi merra khra
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 mb-3">
                            <strong>Model</strong>: fiche 4 druifat، tenue <strong>mertabta b script</strong>، fond byed studio،{" "}
                            <strong>bla produit</strong> f yed. <strong>Background</strong>: pièce <strong>waqi3iya</strong> مرتبطة{" "}
                            b script / product context، <strong>machy</strong> m3ammra، <strong>machi</strong> fond byed، bla TikTok/ring
                            light f prompt — <strong>mamnou3</strong> ay model/bnadem (7ta reflection/silhouette) w nafs blasa f ga3 l-machahid.
                          </p>
                          {modelImagePrompt != null && backgroundPromptOnly != null ? (
                            <div className="space-y-4">
                              <div className="rounded-xl border border-violet-100 bg-violet-50/30 p-3 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-sm font-semibold text-gray-800">
                                    Model — 1 prompt → 1 image m9soma 4
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(modelImagePrompt);
                                      alert("T-copia prompt dial model!");
                                    }}
                                    className="text-xs text-orange-600 hover:text-orange-800 bg-orange-50 px-2.5 py-1.5 rounded-lg font-medium inline-flex items-center gap-1"
                                  >
                                    <Copy className="w-3.5 h-3.5 shrink-0" />
                                    Copi
                                  </button>
                                </div>
                                <textarea
                                  className="w-full min-h-[200px] font-sans text-sm text-gray-800 bg-white p-3 rounded-lg border border-violet-100 focus:ring-2 focus:ring-violet-500 outline-none resize-y"
                                  value={modelImagePrompt}
                                  onChange={(e) => {
                                    const m = e.target.value;
                                    setModelImagePrompt(m);
                                    setVisualPromptsText(
                                      buildStep3VisualMarkdown(m, backgroundPromptOnly)
                                    );
                                  }}
                                  spellCheck={true}
                                />
                              </div>
                              <div className="rounded-xl border border-stone-200 bg-stone-50/80 p-3 space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="text-sm font-semibold text-gray-800">
                                    Background (bla model)
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(backgroundPromptOnly);
                                      alert("T-copia background!");
                                    }}
                                    className="text-xs text-orange-600 hover:text-orange-800 bg-orange-50 px-2.5 py-1.5 rounded-lg font-medium inline-flex items-center gap-1"
                                  >
                                    <Copy className="w-3.5 h-3.5 shrink-0" />
                                    Copi
                                  </button>
                                </div>
                                <textarea
                                  className="w-full min-h-[120px] font-sans text-sm text-gray-800 bg-white p-3 rounded-lg border border-stone-200 focus:ring-2 focus:ring-stone-500 outline-none resize-y"
                                  value={backgroundPromptOnly}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setBackgroundPromptOnly(v);
                                    setVisualPromptsText(
                                      buildStep3VisualMarkdown(modelImagePrompt, v)
                                    );
                                  }}
                                  spellCheck={true}
                                />
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-2">
                                Format ma-t9rach — khass &quot;## Model&quot; o &quot;## Background&quot;
                                — edith hna wla 3awd generi Step 3.
                              </p>
                              <textarea
                                className="w-full min-h-[220px] font-sans text-sm text-gray-800 bg-violet-50/40 p-4 rounded-xl border border-violet-100 focus:ring-2 focus:ring-violet-500 outline-none resize-y"
                                value={visualPromptsText}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  const again = parseStep3ModelBackground(v);
                                  if (again) {
                                    setModelImagePrompt(again.model);
                                    setBackgroundPromptOnly(again.background);
                                    setVisualPromptsText(
                                      buildStep3VisualMarkdown(again.model, again.background)
                                    );
                                  } else {
                                    setVisualPromptsText(v);
                                    setModelImagePrompt(null);
                                    setBackgroundPromptOnly(null);
                                  }
                                }}
                                placeholder="## Model … (prompt wa7ed) … ## Background …"
                                spellCheck={true}
                              />
                            </>
                          )}
                        </div>
                      )}
                      {generatedScript && (
                        <>
                      <div className="space-y-3 pb-6 mb-6 border-b border-gray-100">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Tsawer l-Webhook (khtiyari) — zidhom men ba3d ma y-tgenera script
                        </p>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <div className="flex-1 min-w-0 flex items-center gap-2">
                            <label className="flex-1 min-w-0 cursor-pointer border border-dashed border-gray-200 rounded-xl p-3 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                              <input type="file" accept="image/*" className="hidden" onChange={handleModelImageUpload} disabled={isUploadingModel} />
                              {isUploadingModel ? <Loader2 className="w-4 h-4 text-orange-500 animate-spin shrink-0" /> : <Upload className="w-4 h-4 text-gray-400 shrink-0" />}
                              <span className="text-xs text-gray-500 truncate">{modelImageFile ? modelImageFile.name : "Model Ref"}</span>
                            </label>
                            <button
                              type="button"
                              title="Khtar men tsawer li deja uploditi"
                              onClick={() => setReferenceImagePicker({ kind: "generateRef", field: "model" })}
                              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition-colors"
                            >
                              <Images className="w-4 h-4 shrink-0" />
                              <span className="hidden sm:inline">Déjà</span>
                            </button>
                          </div>
                          {modelImageUrl && (
                            <div className="w-12 h-12 rounded-lg overflow-hidden border border-gray-200 shrink-0 mx-auto sm:mx-0">
                              <img src={modelImageUrl} alt="Model" className="w-full h-full object-cover" />
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <div className="flex-1 min-w-0 flex items-center gap-2">
                            <label className="flex-1 min-w-0 cursor-pointer border border-dashed border-gray-200 rounded-xl p-3 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                              <input type="file" accept="image/*" className="hidden" onChange={handleProductImageUpload} disabled={isUploadingProduct} />
                              {isUploadingProduct ? <Loader2 className="w-4 h-4 text-orange-500 animate-spin shrink-0" /> : <Upload className="w-4 h-4 text-gray-400 shrink-0" />}
                              <span className="text-xs text-gray-500 truncate">{productImageFile ? productImageFile.name : "Product Ref"}</span>
                            </label>
                            <button
                              type="button"
                              title="Khtar men tsawer li deja uploditi"
                              onClick={() => setReferenceImagePicker({ kind: "generateRef", field: "product" })}
                              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition-colors"
                            >
                              <Images className="w-4 h-4 shrink-0" />
                              <span className="hidden sm:inline">Déjà</span>
                            </button>
                          </div>
                          {productImageUrl && (
                            <div className="w-12 h-12 rounded-lg overflow-hidden border border-gray-200 shrink-0 mx-auto sm:mx-0">
                              <img src={productImageUrl} alt="Product" className="w-full h-full object-cover" />
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <div className="flex-1 min-w-0 flex items-center gap-2">
                            <label className="flex-1 min-w-0 cursor-pointer border border-dashed border-gray-200 rounded-xl p-3 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                              <input type="file" accept="image/*" className="hidden" onChange={handleBackgroundImageUpload} disabled={isUploadingBackground} />
                              {isUploadingBackground ? <Loader2 className="w-4 h-4 text-orange-500 animate-spin shrink-0" /> : <Upload className="w-4 h-4 text-gray-400 shrink-0" />}
                              <span className="text-xs text-gray-500 truncate">{backgroundImageFile ? backgroundImageFile.name : "Background Ref"}</span>
                            </label>
                            <button
                              type="button"
                              title="Khtar men tsawer li deja uploditi"
                              onClick={() => setReferenceImagePicker({ kind: "generateRef", field: "background" })}
                              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition-colors"
                            >
                              <Images className="w-4 h-4 shrink-0" />
                              <span className="hidden sm:inline">Déjà</span>
                            </button>
                          </div>
                          {backgroundImageUrl && (
                            <div className="w-12 h-12 rounded-lg overflow-hidden border border-gray-200 shrink-0 mx-auto sm:mx-0">
                              <img src={backgroundImageUrl} alt="Background" className="w-full h-full object-cover" />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="mb-6">
                        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-center mb-4">
                          <button 
                            type="button"
                            onClick={() => setIsScriptCollapsed(!isScriptCollapsed)}
                            className="flex items-center gap-2 hover:bg-gray-50 px-2 py-1 rounded-lg transition-colors self-start"
                          >
                            <h3 className="font-bold text-gray-800 text-lg sm:text-xl">4. Script video (kamal)</h3>
                            {isScriptCollapsed ? <ChevronDown className="w-5 h-5 text-gray-500" /> : <ChevronUp className="w-5 h-5 text-gray-500" />}
                          </button>
                          <button 
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(generatedScript);
                              alert("T-copia Script!");
                            }}
                            className="text-sm text-orange-600 hover:text-orange-800 hover:bg-orange-100 flex items-center justify-center gap-2 bg-orange-50 px-3 py-2 rounded-lg transition-colors font-medium w-full sm:w-auto"
                          >
                            <Copy className="w-4 h-4" /> Copi Script Bohdo
                          </button>
                        </div>
                        {!isScriptCollapsed && (
                          <div className="prose prose-orange max-w-none text-gray-800 bg-gray-50 p-4 rounded-xl border border-gray-200 mt-2">
                            <Markdown>{generatedScript}</Markdown>
                          </div>
                        )}
                      </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 text-center">
                      <PenTool className="w-12 h-12 mb-2 opacity-20" />
                      <p>Khtar produit o dīr Step 1 (l-Fikra) bach t-bda.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'saved' && (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold">Scripts Mkhbyin</h2>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {savedScripts.map(script => {
                const product = script.productId === 'all' 
                  ? { name: 'Ga3 l-Produits' } 
                  : products.find(p => p.id === script.productId);
                  
                return (
                  <div key={script.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-[400px]">
                    <div className="p-4 border-b border-gray-50 bg-gray-50/50 flex items-center justify-between">
                      <div>
                        <h3 className="font-bold text-gray-800">{product?.name || 'Produit mmsou7'}</h3>
                        <p className="text-xs text-gray-500 truncate max-w-[200px]">
                          {script.customPrompt || "Standard"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => setScriptToSend(script)}
                          className="p-2 text-gray-400 hover:text-orange-500 transition-colors"
                          title="Sifet l-Webhook"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => {
                            const scenesText = script.scenes && script.scenes.length > 0 ? '\n\n--- PROMPTS ---\n\n' + script.scenes.map((s: any) => {
                              const debutModelRef = s.debut?.use_model_ref !== undefined ? ` [Model Ref: ${s.debut.use_model_ref ? 'Yes' : 'No'}]` : '';
                              const debutProductRef = s.debut?.use_product_ref !== undefined ? ` [Product Ref: ${s.debut.use_product_ref ? 'Yes' : 'No'}]` : '';
                              const debutBackgroundRef = s.debut?.use_background_ref !== undefined ? ` [Background Ref: ${s.debut.use_background_ref ? 'Yes' : 'No'}]` : '';
                              const finModelRef = s.fin?.use_model_ref !== undefined ? ` [Model Ref: ${s.fin.use_model_ref ? 'Yes' : 'No'}]` : '';
                              const finProductRef = s.fin?.use_product_ref !== undefined ? ` [Product Ref: ${s.fin.use_product_ref ? 'Yes' : 'No'}]` : '';
                              const finBackgroundRef = s.fin?.use_background_ref !== undefined ? ` [Background Ref: ${s.fin.use_background_ref ? 'Yes' : 'No'}]` : '';
                              return `Scene ${s.sceneNumber || s.scene_number}:\nDebut${debutModelRef}${debutProductRef}${debutBackgroundRef}: ${s.debut?.prompt || s.debut}\nFin${finModelRef}${finProductRef}${finBackgroundRef}: ${s.fin?.prompt || s.fin}`;
                            }).join('\n\n') : '';
                            const fullTextToCopy = `${script.content}${scenesText}`;
                            navigator.clipboard.writeText(fullTextToCopy);
                            alert("T-copia kolchi!");
                          }}
                          className="p-2 text-gray-400 hover:text-orange-500 transition-colors"
                          title="Copi Kolchi"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => deleteSavedScript(script.id)} 
                          className="p-2 text-gray-400 hover:text-red-500 transition-colors"
                          title="Mse7"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="p-6 flex-1 overflow-y-auto">
                      <div className="prose prose-sm prose-orange max-w-none">
                        <Markdown>{script.content}</Markdown>
                      </div>
                      {script.scenes && script.scenes.length > 0 && (
                        <div className="mt-6 pt-6 border-t border-gray-100 space-y-4">
                          <h4 className="font-bold text-gray-800 text-lg">Prompts d'Images (Scenes)</h4>
                          {script.scenes.map((scene: any, idx: number) => (
                            <div key={idx} className="bg-white p-5 rounded-xl border border-gray-200 space-y-6">
                              <div className="border-b border-gray-100 pb-3">
                                <h5 className="font-bold text-lg text-orange-600">
                                  Scene {scene.sceneNumber || scene.scene_number || (idx + 1)}
                                  {scene.scene_title && <span className="text-gray-700 ml-2">- {scene.scene_title}</span>}
                                </h5>
                              </div>
                              
                              <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-3">
                                    <h6 className="font-bold text-sm text-gray-800">DEBUT (START)</h6>
                                    {scene.debut?.use_model_ref !== undefined && (
                                      <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", scene.debut.use_model_ref ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500")}>
                                        Model Ref: {scene.debut.use_model_ref ? 'Yes' : 'No'}
                                      </span>
                                    )}
                                    {scene.debut?.use_product_ref !== undefined && (
                                      <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", scene.debut.use_product_ref ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500")}>
                                        Product Ref: {scene.debut.use_product_ref ? 'Yes' : 'No'}
                                      </span>
                                    )}
                                    {scene.debut?.use_background_ref !== undefined && (
                                      <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", scene.debut.use_background_ref ? "bg-purple-50 text-purple-600" : "bg-gray-100 text-gray-500")}>
                                        Background Ref: {scene.debut.use_background_ref ? 'Yes' : 'No'}
                                      </span>
                                    )}
                                  </div>
                                  <button 
                                    onClick={() => {
                                      navigator.clipboard.writeText(scene.debut?.prompt || scene.debut);
                                      alert("T-copia Debut!");
                                    }}
                                    className="text-xs text-orange-600 hover:text-orange-800 flex items-center gap-1 transition-colors font-medium"
                                  >
                                    <Copy className="w-3.5 h-3.5" /> Copi
                                  </button>
                                </div>
                                <div className="flex gap-4 items-start">
                                  <p className="flex-1 text-sm text-gray-700 bg-white p-4 rounded-lg border border-gray-200 leading-relaxed m-0">{scene.debut?.prompt || scene.debut}</p>
                                  <div className="w-40 shrink-0">
                                    {sceneImages[`${script.id}-${idx}-debut`] ? (
                                      <div className="relative w-full aspect-[9/16] bg-gray-100 rounded-lg border border-gray-200 overflow-hidden shadow-sm group">
                                        <img src={sceneImages[`${script.id}-${idx}-debut`]} alt="Debut" className="w-full h-full object-cover" />
                                        <label className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                                          <span className="text-white text-xs font-medium flex items-center gap-1"><Edit2 className="w-3 h-3"/> Bddel</span>
                                          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleSceneImageUpload(script.id, idx, 'debut', e)} />
                                        </label>
                                      </div>
                                    ) : (
                                      <label className="w-full aspect-[9/16] flex flex-col items-center justify-center bg-orange-50 hover:bg-orange-100 border border-dashed border-orange-200 rounded-lg cursor-pointer transition-colors">
                                        {isUploadingSceneImage[`${script.id}-${idx}-debut`] ? (
                                          <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                                        ) : (
                                          <>
                                            <Upload className="w-5 h-5 text-orange-500 mb-1" />
                                            <span className="text-xs font-medium text-orange-700 text-center px-2">Zid Tswira</span>
                                          </>
                                        )}
                                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleSceneImageUpload(script.id, idx, 'debut', e)} />
                                      </label>
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              <div className="space-y-3">
                                <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-3">
                                    <h6 className="font-bold text-sm text-gray-800">FIN (END)</h6>
                                    {scene.fin?.use_model_ref !== undefined && (
                                      <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", scene.fin.use_model_ref ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500")}>
                                        Model Ref: {scene.fin.use_model_ref ? 'Yes' : 'No'}
                                      </span>
                                    )}
                                    {scene.fin?.use_product_ref !== undefined && (
                                      <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", scene.fin.use_product_ref ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500")}>
                                        Product Ref: {scene.fin.use_product_ref ? 'Yes' : 'No'}
                                      </span>
                                    )}
                                    {scene.fin?.use_background_ref !== undefined && (
                                      <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", scene.fin.use_background_ref ? "bg-purple-50 text-purple-600" : "bg-gray-100 text-gray-500")}>
                                        Background Ref: {scene.fin.use_background_ref ? 'Yes' : 'No'}
                                      </span>
                                    )}
                                  </div>
                                  <button 
                                    onClick={() => {
                                      navigator.clipboard.writeText(scene.fin?.prompt || scene.fin);
                                      alert("T-copia Fin!");
                                    }}
                                    className="text-xs text-orange-600 hover:text-orange-800 flex items-center gap-1 transition-colors font-medium"
                                  >
                                    <Copy className="w-3.5 h-3.5" /> Copi
                                  </button>
                                </div>
                                <div className="flex gap-4 items-start">
                                  <p className="flex-1 text-sm text-gray-700 bg-white p-4 rounded-lg border border-gray-200 leading-relaxed m-0">{scene.fin?.prompt || scene.fin}</p>
                                  <div className="w-40 shrink-0">
                                    {sceneImages[`${script.id}-${idx}-fin`] ? (
                                      <div className="relative w-full aspect-[9/16] bg-gray-100 rounded-lg border border-gray-200 overflow-hidden shadow-sm group">
                                        <img src={sceneImages[`${script.id}-${idx}-fin`]} alt="Fin" className="w-full h-full object-cover" />
                                        <label className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                                          <span className="text-white text-xs font-medium flex items-center gap-1"><Edit2 className="w-3 h-3"/> Bddel</span>
                                          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleSceneImageUpload(script.id, idx, 'fin', e)} />
                                        </label>
                                      </div>
                                    ) : (
                                      <label className="w-full aspect-[9/16] flex flex-col items-center justify-center bg-orange-50 hover:bg-orange-100 border border-dashed border-orange-200 rounded-lg cursor-pointer transition-colors">
                                        {isUploadingSceneImage[`${script.id}-${idx}-fin`] ? (
                                          <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                                        ) : (
                                          <>
                                            <Upload className="w-5 h-5 text-orange-500 mb-1" />
                                            <span className="text-xs font-medium text-orange-700 text-center px-2">Zid Tswira</span>
                                          </>
                                        )}
                                        <input type="file" accept="image/*" className="hidden" onChange={(e) => handleSceneImageUpload(script.id, idx, 'fin', e)} />
                                      </label>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              
              {savedScripts.length === 0 && (
                <div className="col-span-full py-20 text-center space-y-4 opacity-40">
                  <Bookmark className="w-12 h-12 mx-auto" />
                  <p>Mazal ma sauvegarda hta script.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'videoResult' && (
          <div className="w-full flex flex-col md:flex-row gap-8">
            {/* Sidebar for History */}
            {webhookHistory.length > 0 && (
              <div className="w-full md:w-72 flex-shrink-0">
                <WebhookHistorySidebarGrouped
                  sections={webhookHistoryProductSections}
                  products={products}
                  selectedHistoryId={selectedHistoryId}
                  onSelect={openWebhookHistoryEntry}
                  onRename={renameHistoryItem}
                  onDelete={deleteHistoryItem}
                  subtitle="Kol produit fih lista dyal videos: Veo ✓ ila t-generiti packages hna, sinon Mazal Veo."
                />
              </div>
            )}

            {/* Main Content */}
            <div className="flex-1 space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h2 className="text-2xl font-bold flex flex-wrap items-center gap-2">
                  <Video className="w-6 h-6 text-orange-500 shrink-0" />
                  Natija dial l-Video (Ad Video)
                  {selectedHistoryId && (
                    <span className="text-sm font-mono bg-orange-100 text-orange-700 px-2.5 py-1 rounded-lg border border-orange-200">
                      #{selectedHistoryId.slice(-5)}
                    </span>
                  )}
                </h2>
                {selectedHistoryProduct ? (
                  <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-2.5 py-1.5 shadow-sm shrink-0">
                    <ProductThumb url={productVisualRef(selectedHistoryProduct)} alt="" size="sm" />
                    <span className="text-xs font-semibold text-gray-700 max-w-[200px] truncate">
                      {selectedHistoryProduct.name}
                    </span>
                  </div>
                ) : null}
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-600 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 min-h-[400px] flex flex-col items-center justify-center text-center">
                {isSendingWebhook ? (
                  <div className="space-y-6 flex flex-col items-center">
                    <div className="relative">
                      <div className="w-24 h-24 border-4 border-orange-100 rounded-full animate-pulse"></div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Loader2 className="w-10 h-10 text-orange-500 animate-spin" />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-xl font-bold text-gray-800">Kantsnaw l-Video twjed...</h3>
                      <p className="text-gray-500 max-w-md">
                        L-webhook rah khdam daba. Had l-3amaliya t9der takhed chwia dl-we9t 3la 7sab l-platform li katsawb l-video.
                      </p>
                    </div>
                  </div>
                ) : generatedVideoUrl ? (
                  <div className="space-y-6 w-full max-w-2xl">
                    <div className="bg-green-50 text-green-700 p-4 rounded-2xl flex items-center justify-center gap-2 font-medium">
                      <Check className="w-5 h-5" />
                      L-Video wjdat b-naja7!
                    </div>
                    <div className="aspect-video bg-black rounded-2xl overflow-hidden shadow-lg border border-gray-200">
                      <video 
                        src={generatedVideoUrl} 
                        controls 
                        className="w-full h-full object-contain"
                        autoPlay
                      />
                    </div>
                    <div className="flex justify-center">
                      <a 
                        href={generatedVideoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-6 py-3 bg-orange-500 text-white rounded-xl font-bold hover:bg-orange-600 transition-colors flex items-center gap-2"
                      >
                        <Video className="w-5 h-5" />
                        Telecharger l-Video
                      </a>
                    </div>
                  </div>
                ) : webhookResponseData ? (
                  <div className="w-full text-left space-y-6">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                      <h3 className="font-bold text-gray-800">Natija mn l-Webhook</h3>
                      <div className="flex items-center gap-2 flex-wrap justify-end">
                        <button
                          type="button"
                          onClick={() => void handleDownloadAllSceneStills()}
                          disabled={!selectedHistoryId || isDownloadingSceneStills}
                          className="px-3 py-1.5 bg-gray-100 text-gray-800 hover:bg-gray-200 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 disabled:opacity-50"
                          title="ZIP: 3 l7roof lwlin dial video ID + smiyat XXX-debut-N / XXX-fin-N"
                        >
                          {isDownloadingSceneStills ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                          Telecharger ZIP
                        </button>
                        <button
                          type="button"
                          onClick={() => void generateVeoScenePackagesInApp()}
                          disabled={isGeneratingVeoPackages}
                          className="px-3 py-1.5 bg-orange-100 text-orange-700 hover:bg-orange-200 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 disabled:opacity-50"
                          title="Generi packages Veo (OpenAI) — bla webhook"
                        >
                          {isGeneratingVeoPackages ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Sparkles className="w-4 h-4" />
                          )}
                          Generi Veo (hna)
                        </button>
                        <button 
                          onClick={() => {
                            let scenesToCopy = webhookResponseData.scenes;
                            if (typeof scenesToCopy === 'string') {
                              try { 
                                const parsed = JSON.parse(scenesToCopy); 
                                if (Array.isArray(parsed)) scenesToCopy = parsed;
                              } catch(e) {}
                            }
                            
                            let scenesText = '';
                            if (Array.isArray(scenesToCopy) && scenesToCopy.length > 0) {
                              scenesText = '\n\n--- PROMPTS ---\n\n' + scenesToCopy.map((s: any, idx: number) => {
                                const debutModelRef = s.debut?.use_model_ref !== undefined ? ` [Model Ref: ${s.debut.use_model_ref ? 'Yes' : 'No'}]` : '';
                                const debutProductRef = s.debut?.use_product_ref !== undefined ? ` [Product Ref: ${s.debut.use_product_ref ? 'Yes' : 'No'}]` : '';
                                const debutBackgroundRef = s.debut?.use_background_ref !== undefined ? ` [Background Ref: ${s.debut.use_background_ref ? 'Yes' : 'No'}]` : '';
                                const finModelRef = s.fin?.use_model_ref !== undefined ? ` [Model Ref: ${s.fin.use_model_ref ? 'Yes' : 'No'}]` : '';
                                const finProductRef = s.fin?.use_product_ref !== undefined ? ` [Product Ref: ${s.fin.use_product_ref ? 'Yes' : 'No'}]` : '';
                                const finBackgroundRef = s.fin?.use_background_ref !== undefined ? ` [Background Ref: ${s.fin.use_background_ref ? 'Yes' : 'No'}]` : '';
                                
                                return `Scene ${s.sceneNumber || s.scene_number || (idx + 1)}:\nDebut${debutModelRef}${debutProductRef}${debutBackgroundRef}: ${s.debut?.prompt || s.debut || ''}\nFin${finModelRef}${finProductRef}${finBackgroundRef}: ${s.fin?.prompt || s.fin || ''}`;
                              }).join('\n\n');
                            } else if (scenesToCopy) {
                              scenesText = '\n\n--- PROMPTS ---\n\n' + (typeof scenesToCopy === 'string' ? scenesToCopy : JSON.stringify(scenesToCopy, null, 2));
                            }
                            
                            const fullTextToCopy = `${webhookResponseData.script || ''}${scenesText}`;
                            navigator.clipboard.writeText(fullTextToCopy);
                            alert("T-copia kolchi!");
                          }}
                          className="p-2 text-gray-400 hover:text-orange-500 transition-colors"
                          title="Copi Kolchi"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {(isGeneratingVeoPackages || veoInlineProgress) && (
                      <p className="text-xs text-orange-700 px-1 pb-2">{veoInlineProgress ?? "Kan-tsenni…"}</p>
                    )}
                    <div className="p-6 flex-1 overflow-y-auto">
                      {webhookResponseData.script && (
                        <div className="mb-6">
                          <div className="flex justify-between items-center mb-4">
                            <button 
                              onClick={() => setIsScriptCollapsed(!isScriptCollapsed)}
                              className="flex items-center gap-2 hover:bg-gray-50 px-2 py-1 rounded-lg transition-colors"
                            >
                              <h3 className="font-bold text-gray-800 text-xl">Script</h3>
                              {isScriptCollapsed ? <ChevronDown className="w-5 h-5 text-gray-500" /> : <ChevronUp className="w-5 h-5 text-gray-500" />}
                            </button>
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(webhookResponseData.script);
                                alert("T-copia Script!");
                              }}
                              className="text-sm text-orange-600 hover:text-orange-800 hover:bg-orange-100 flex items-center gap-2 bg-orange-50 px-3 py-1.5 rounded-lg transition-colors font-medium"
                            >
                              <Copy className="w-4 h-4" /> Copi Script Bohdo
                            </button>
                          </div>
                          {!isScriptCollapsed && (
                            <div className="prose prose-orange max-w-none text-gray-800 bg-gray-50 p-4 rounded-xl border border-gray-200 mt-2">
                              <Markdown>{webhookResponseData.script}</Markdown>
                            </div>
                          )}
                        </div>
                      )}
                      {webhookResponseData.scenes && (
                        <div className="mt-8 pt-6 border-t border-gray-100 space-y-4">
                          <h4 className="font-bold text-gray-800 text-lg">Prompts d'Images (Scenes)</h4>
                          {(() => {
                            let scenes = parseScenesData(webhookResponseData.scenes);
                            
                            if (Array.isArray(scenes) && scenes.length > 0) {
                              return scenes.map((scene: any, idx: number) => (
                                <div key={idx} className="bg-white p-5 rounded-xl border border-gray-200 space-y-6">
                                  <div className="border-b border-gray-100 pb-3">
                                    <h5 className="font-bold text-lg text-orange-600">
                                      Scene {scene.sceneNumber || scene.scene_number || (idx + 1)}
                                      {scene.scene_title && <span className="text-gray-700 ml-2">- {scene.scene_title}</span>}
                                    </h5>
                                  </div>
                                  
                                  <div className="space-y-3">
                                    <div className="flex justify-between items-center">
                                      <div className="flex items-center gap-3">
                                        <h6 className="font-bold text-sm text-gray-800">DEBUT (START)</h6>
                                        {scene.debut?.use_model_ref !== undefined && (
                                          <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", scene.debut.use_model_ref ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500")}>
                                            Model Ref: {scene.debut.use_model_ref ? 'Yes' : 'No'}
                                          </span>
                                        )}
                                        {scene.debut?.use_product_ref !== undefined && (
                                          <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", scene.debut.use_product_ref ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500")}>
                                            Product Ref: {scene.debut.use_product_ref ? 'Yes' : 'No'}
                                          </span>
                                        )}
                                        {scene.debut?.use_background_ref !== undefined && (
                                          <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", scene.debut.use_background_ref ? "bg-purple-50 text-purple-600" : "bg-gray-100 text-gray-500")}>
                                            Background Ref: {scene.debut.use_background_ref ? 'Yes' : 'No'}
                                          </span>
                                        )}
                                      </div>
                                      <button 
                                        onClick={() => {
                                          navigator.clipboard.writeText(scene.debut?.prompt || scene.debut);
                                          alert("T-copia Debut!");
                                        }}
                                        className="text-xs text-orange-600 hover:text-orange-800 flex items-center gap-1 transition-colors font-medium"
                                      >
                                        <Copy className="w-3.5 h-3.5" /> Copi
                                      </button>
                                    </div>
                                    <div className="flex gap-4 items-start">
                                      <p className="flex-1 text-sm text-gray-700 bg-white p-4 rounded-lg border border-gray-200 leading-relaxed m-0">{scene.debut?.prompt || scene.debut}</p>
                                      <div className="w-40 shrink-0">
                                        {sceneImages[`${selectedHistoryId}-${idx}-debut`] ? (
                                          <div className="relative w-full aspect-[9/16] bg-gray-100 rounded-lg border border-gray-200 overflow-hidden shadow-sm group">
                                            <img src={sceneImages[`${selectedHistoryId}-${idx}-debut`]} alt="Debut" className="w-full h-full object-cover" />
                                            <label className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                                              <span className="text-white text-xs font-medium flex items-center gap-1"><Edit2 className="w-3 h-3"/> Bddel</span>
                                              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleSceneImageUpload(selectedHistoryId!, idx, 'debut', e)} />
                                            </label>
                                          </div>
                                        ) : (
                                          <label className="w-full aspect-[9/16] flex flex-col items-center justify-center bg-orange-50 hover:bg-orange-100 border border-dashed border-orange-200 rounded-lg cursor-pointer transition-colors">
                                            {isUploadingSceneImage[`${selectedHistoryId}-${idx}-debut`] ? (
                                              <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                                            ) : (
                                              <>
                                                <Upload className="w-5 h-5 text-orange-500 mb-1" />
                                                <span className="text-xs font-medium text-orange-700 text-center px-2">Zid Tswira</span>
                                              </>
                                            )}
                                            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleSceneImageUpload(selectedHistoryId!, idx, 'debut', e)} />
                                          </label>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  
                                  <div className="space-y-3">
                                    <div className="flex justify-between items-center">
                                      <div className="flex items-center gap-3">
                                        <h6 className="font-bold text-sm text-gray-800">FIN (END)</h6>
                                        {scene.fin?.use_model_ref !== undefined && (
                                          <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", scene.fin.use_model_ref ? "bg-blue-50 text-blue-600" : "bg-gray-100 text-gray-500")}>
                                            Model Ref: {scene.fin.use_model_ref ? 'Yes' : 'No'}
                                          </span>
                                        )}
                                        {scene.fin?.use_product_ref !== undefined && (
                                          <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", scene.fin.use_product_ref ? "bg-green-50 text-green-600" : "bg-gray-100 text-gray-500")}>
                                            Product Ref: {scene.fin.use_product_ref ? 'Yes' : 'No'}
                                          </span>
                                        )}
                                        {scene.fin?.use_background_ref !== undefined && (
                                          <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", scene.fin.use_background_ref ? "bg-purple-50 text-purple-600" : "bg-gray-100 text-gray-500")}>
                                            Background Ref: {scene.fin.use_background_ref ? 'Yes' : 'No'}
                                          </span>
                                        )}
                                      </div>
                                      <button 
                                        onClick={() => {
                                          navigator.clipboard.writeText(scene.fin?.prompt || scene.fin);
                                          alert("T-copia Fin!");
                                        }}
                                        className="text-xs text-orange-600 hover:text-orange-800 flex items-center gap-1 transition-colors font-medium"
                                      >
                                        <Copy className="w-3.5 h-3.5" /> Copi
                                      </button>
                                    </div>
                                    <div className="flex gap-4 items-start">
                                      <p className="flex-1 text-sm text-gray-700 bg-white p-4 rounded-lg border border-gray-200 leading-relaxed m-0">{scene.fin?.prompt || scene.fin}</p>
                                      <div className="w-40 shrink-0">
                                        {sceneImages[`${selectedHistoryId}-${idx}-fin`] ? (
                                          <div className="relative w-full aspect-[9/16] bg-gray-100 rounded-lg border border-gray-200 overflow-hidden shadow-sm group">
                                            <img src={sceneImages[`${selectedHistoryId}-${idx}-fin`]} alt="Fin" className="w-full h-full object-cover" />
                                            <label className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                                              <span className="text-white text-xs font-medium flex items-center gap-1"><Edit2 className="w-3 h-3"/> Bddel</span>
                                              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleSceneImageUpload(selectedHistoryId!, idx, 'fin', e)} />
                                            </label>
                                          </div>
                                        ) : (
                                          <label className="w-full aspect-[9/16] flex flex-col items-center justify-center bg-orange-50 hover:bg-orange-100 border border-dashed border-orange-200 rounded-lg cursor-pointer transition-colors">
                                            {isUploadingSceneImage[`${selectedHistoryId}-${idx}-fin`] ? (
                                              <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                                            ) : (
                                              <>
                                                <Upload className="w-5 h-5 text-orange-500 mb-1" />
                                                <span className="text-xs font-medium text-orange-700 text-center px-2">Zid Tswira</span>
                                              </>
                                            )}
                                            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleSceneImageUpload(selectedHistoryId!, idx, 'fin', e)} />
                                          </label>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ));
                            } else {
                              return (
                                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                                  <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">
                                    {typeof scenes === 'string' ? scenes : JSON.stringify(scenes, null, 2)}
                                  </pre>
                                </div>
                              );
                            }
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                ) : webhookResponseText ? (
                  <div className="w-full text-left space-y-4">
                    <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                      <h3 className="font-bold text-gray-800">Natija mn l-Webhook (Raw)</h3>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(webhookResponseText);
                          alert("T-copia!");
                        }}
                        className="p-2 text-gray-400 hover:text-orange-500 transition-colors"
                        title="Copi"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 max-h-[400px] overflow-y-auto">
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
                        {webhookResponseText}
                      </pre>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 opacity-50">
                    <Video className="w-16 h-16 mx-auto text-gray-400" />
                    <p className="text-gray-500">
                      Sifet script l-webhook bach tchouf natija hna.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {activeTab === 'veoResult' && (
          <div className="w-full flex flex-col md:flex-row gap-8">
            {webhookHistory.length > 0 && (
              <div className="w-full md:w-72 flex-shrink-0">
                <WebhookHistorySidebarGrouped
                  sections={webhookHistoryProductSections}
                  products={products}
                  selectedHistoryId={selectedHistoryId}
                  onSelect={openWebhookHistoryEntry}
                  onRename={renameHistoryItem}
                  onDelete={deleteHistoryItem}
                  subtitle="Nafs n-nizam: chof 3la kol produit ch7al Veo t-sauvegardaw w ch7al mazal."
                />
              </div>
            )}
            <div className="flex-1 min-w-0 max-w-4xl mx-auto md:mx-0 space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <h2 className="text-2xl font-bold flex items-center gap-2 flex-wrap min-w-0">
                <Sparkles className="w-6 h-6 text-orange-500 shrink-0" />
                <span className="min-w-0">Veo Prompts (Natija d Tsawer)</span>
                {selectedHistoryId && (
                  <span className="text-sm font-mono bg-orange-100 text-orange-700 px-2.5 py-1 rounded-lg border border-orange-200 shrink-0">
                    #{selectedHistoryId.slice(-5)}
                  </span>
                )}
                {selectedHistoryProduct ? (
                  <span className="inline-flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-2 py-1 shadow-sm text-sm font-semibold text-gray-700 max-w-full">
                    <ProductThumb url={productVisualRef(selectedHistoryProduct)} alt="" size="sm" />
                    <span className="truncate max-w-[12rem] sm:max-w-xs">{selectedHistoryProduct.name}</span>
                  </span>
                ) : null}
              </h2>
              <button
                type="button"
                onClick={() => void handleDownloadAllSceneStills()}
                disabled={!selectedHistoryId || isDownloadingSceneStills}
                className="shrink-0 px-4 py-2 bg-gray-100 text-gray-800 hover:bg-gray-200 rounded-xl font-medium text-sm transition-colors flex items-center justify-center gap-2 disabled:opacity-50 border border-gray-200"
                title="Fichier ZIP: 3 l7roof lwlin dial ID + XXX-debut-N · XXX-fin-N"
              >
                {isDownloadingSceneStills ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Telecharger ZIP (debut/fin)
              </button>
            </div>

            {error && (
              <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-600 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {veoResponseData ? (
                <div className="p-6">
                  {(isGeneratingVeoPackages || veoResponseData.generating) && (
                    <div className="mb-6 p-4 rounded-xl border border-orange-200 bg-orange-50/80 flex flex-col sm:flex-row sm:items-center gap-3">
                      <Loader2 className="w-8 h-8 text-orange-500 animate-spin shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-gray-900">Kan-generi Veo (machhad b-machhad)</p>
                        <p className="text-sm text-gray-600 truncate">
                          {veoInlineProgress ?? "Kan-tsenni…"}
                        </p>
                        {Array.isArray(veoResponseData.scenes) && veoResponseData.generationTotal != null ? (
                          <p className="text-xs text-orange-800 mt-1">
                            T-wslat: {veoResponseData.scenes.length} / {veoResponseData.generationTotal} — kol machhad
                            yban hna 9bel ma y-kml l-li mura.
                          </p>
                        ) : null}
                      </div>
                    </div>
                  )}
                  {(veoResponseData.scenes && Array.isArray(veoResponseData.scenes)) || Array.isArray(veoResponseData) ? (
                    <div className="space-y-8">
                      {(Array.isArray(veoResponseData) ? veoResponseData : veoResponseData.scenes).map((scene: any, idx: number) => {
                        const sceneNo = scene.sceneNumber || scene.scene_number || idx + 1;
                        let prompts: string[] = [];
                        if (scene.veo_prompts && Array.isArray(scene.veo_prompts)) {
                          prompts = scene.veo_prompts;
                        } else if (scene.prompts && Array.isArray(scene.prompts)) {
                          prompts = scene.prompts;
                        } else {
                          Object.keys(scene).forEach((key) => {
                            if (
                              key.toLowerCase().includes("prompt") &&
                              typeof scene[key] === "string" &&
                              key !== "negativePrompt"
                            ) {
                              prompts.push(scene[key]);
                            }
                          });
                        }

                        const hasVeo31 =
                          typeof scene.veoPrompt === "string" &&
                          scene.veoPrompt.trim().length > 0;

                        const debutPreview =
                          selectedHistoryId != null
                            ? findSceneImageUrl(sceneImages, selectedHistoryId, idx, "debut")
                            : null;
                        const finPreview =
                          selectedHistoryId != null
                            ? findSceneImageUrl(sceneImages, selectedHistoryId, idx, "fin")
                            : null;

                        const stillAside =
                          selectedHistoryId != null ? (
                            <aside className="grid grid-cols-2 gap-2 sm:gap-3 shrink-0 w-full max-w-[22rem] mx-auto sm:max-w-[24rem] md:w-[20.5rem] md:max-w-none md:mx-0 md:sticky md:top-3 self-start">
                              <div className="min-w-0 text-center">
                                <span className="text-[10px] uppercase tracking-wide text-gray-500 block mb-1">
                                  Debut
                                </span>
                                {debutPreview ? (
                                  <img
                                    src={debutPreview}
                                    alt={`Scene ${sceneNo} debut`}
                                    className="w-full aspect-[9/16] object-cover rounded-lg border border-gray-200 bg-white shadow-sm"
                                  />
                                ) : (
                                  <div className="w-full aspect-[9/16] rounded-lg border border-dashed border-gray-200 bg-gray-100/80 flex items-center justify-center text-[10px] text-gray-400 px-1 text-center leading-tight">
                                    Mazal ma-t-uploadiwch
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 text-center">
                                <span className="text-[10px] uppercase tracking-wide text-gray-500 block mb-1">
                                  Fin
                                </span>
                                {finPreview ? (
                                  <img
                                    src={finPreview}
                                    alt={`Scene ${sceneNo} fin`}
                                    className="w-full aspect-[9/16] object-cover rounded-lg border border-gray-200 bg-white shadow-sm"
                                  />
                                ) : (
                                  <div className="w-full aspect-[9/16] rounded-lg border border-dashed border-gray-200 bg-gray-100/80 flex items-center justify-center text-[10px] text-gray-400 px-1 text-center leading-tight">
                                    Mazal ma-t-uploadiwch
                                  </div>
                                )}
                              </div>
                            </aside>
                          ) : null;

                        return (
                          <div
                            key={String(scene.sceneNumber ?? scene.scene_number ?? idx)}
                            className="bg-gray-50 rounded-xl p-4 sm:p-6 border border-gray-200"
                          >
                            <div className="mb-4 border-b border-gray-200 pb-3">
                              <h3 className="font-bold text-lg text-gray-800">
                                Scene {sceneNo}
                                {veoResponseData?.generatedInApp && (
                                  <span className="ml-2 text-xs font-normal text-gray-500">(VEO 3.1 — hna)</span>
                                )}
                              </h3>
                            </div>

                            <div className="flex flex-col-reverse md:flex-row md:items-start gap-4">
                              <div className="flex-1 min-w-0 space-y-3 min-h-0">
                            {scene._parseError && (
                              <div className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-3">
                                JSON ma-t9rach: {scene._parseError}
                                {scene._rawPackageText ? (
                                  <pre className="mt-2 text-xs whitespace-pre-wrap max-h-48 overflow-auto">
                                    {scene._rawPackageText}
                                  </pre>
                                ) : null}
                              </div>
                            )}

                            {typeof scene._imageAnalysis === "string" && scene._imageAnalysis.trim() && (
                              <details className="text-sm rounded-lg border border-gray-100 bg-white group">
                                <summary className="cursor-pointer list-none px-3 py-2 font-medium text-gray-600 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                                  <ChevronDown className="w-4 h-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
                                  Image analysis (debut → fin)
                                </summary>
                                <pre className="mt-0 text-xs text-gray-700 whitespace-pre-wrap bg-gray-50/80 p-3 border-t border-gray-100 max-h-56 overflow-auto">
                                  {scene._imageAnalysis}
                                </pre>
                              </details>
                            )}

                            {(() => {
                              const tos = scene.textOnScreen;
                              if (!hasVeo31 && (!tos || typeof tos !== "object")) return null;
                              if (!tos || typeof tos !== "object") {
                                return (
                                  <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-950">
                                    <span className="font-semibold">Text f screen</span> — ma-l9inach{" "}
                                    <code className="text-[10px] bg-white/80 px-1 rounded">textOnScreen</code> — 3awd
                                    &quot;Generi Veo&quot;.
                                  </div>
                                );
                              }
                              const allowed = tos.allowed === true;
                              const rationale =
                                typeof tos.rationale === "string" ? tos.rationale.trim() : "";
                              const lines = normalizeTextOnScreenLines(tos.lines);
                              const copyPayload = lines
                                .map((L) =>
                                  [L.text, L.role ? `(${L.role})` : "", L.approxTimingSec ? `@ ${L.approxTimingSec}` : ""]
                                    .filter(Boolean)
                                    .join(" ")
                                )
                                .join("\n");
                              const lineCount = lines.length;
                              return (
                                <div className="flex gap-1.5 items-stretch">
                                  <details className="flex-1 min-w-0 text-sm rounded-lg border border-teal-100 bg-white shadow-sm group">
                                    <summary className="cursor-pointer list-none px-3 py-2.5 font-medium text-gray-700 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                                      <ChevronDown className="w-4 h-4 shrink-0 text-teal-600/70 transition-transform group-open:rotate-180" />
                                      <span className="text-xs font-bold text-teal-700 uppercase tracking-wider">
                                        Text f l&apos;écran
                                      </span>
                                      <span
                                        className={cn(
                                          "text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border ml-1",
                                          allowed
                                            ? "bg-teal-600 text-white border-teal-700"
                                            : "bg-gray-100 text-gray-600 border-gray-200"
                                        )}
                                      >
                                        {allowed ? "overlays" : "clean"}
                                      </span>
                                      <span className="text-[10px] font-normal text-gray-500 normal-case">
                                        · {lineCount} ligne{lineCount !== 1 ? "s" : ""}
                                      </span>
                                    </summary>
                                    <div className="px-3 pb-3 border-t border-teal-50/80 space-y-3">
                                      <p className="text-[11px] text-teal-900/85 leading-snug pt-2">
                                        CapCut / Reels — ma-tburniwch f Veo; negative prompt kib9a 7mi men subtitles
                                        baked-in.
                                      </p>
                                      {rationale ? (
                                        <p className="text-sm text-gray-800 leading-relaxed">{rationale}</p>
                                      ) : null}
                                      {lines.length > 0 ? (
                                        <ul className="space-y-2">
                                          {lines.map((line, li) => (
                                            <li
                                              key={li}
                                              className="flex flex-col gap-1 rounded-lg border border-teal-100/80 bg-teal-50/30 px-3 py-2"
                                            >
                                              <p className="text-sm font-semibold text-gray-900 leading-snug">
                                                &ldquo;{line.text}&rdquo;
                                              </p>
                                              <div className="flex flex-wrap gap-2 text-[10px] text-gray-600">
                                                {line.role ? (
                                                  <span className="px-1.5 py-0.5 rounded bg-white font-medium text-gray-700 border border-gray-100">
                                                    {line.role}
                                                  </span>
                                                ) : null}
                                                {line.approxTimingSec ? (
                                                  <span className="px-1.5 py-0.5 rounded bg-teal-100/60 text-teal-900 font-medium">
                                                    ~{line.approxTimingSec}
                                                  </span>
                                                ) : null}
                                              </div>
                                            </li>
                                          ))}
                                        </ul>
                                      ) : allowed ? (
                                        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                                          allowed=true walakin lines khawyin — 3awd generi had l-machhad.
                                        </p>
                                      ) : (
                                        <p className="text-xs text-gray-600 italic">
                                          Ma t-proposiw hta overlay — clip clean.
                                        </p>
                                      )}
                                    </div>
                                  </details>
                                  {copyPayload ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void navigator.clipboard.writeText(copyPayload);
                                        alert("T-copia lines d text!");
                                      }}
                                      className="shrink-0 self-start p-2.5 mt-0.5 text-gray-400 hover:text-teal-700 rounded-lg hover:bg-teal-50 border border-transparent hover:border-teal-100"
                                      title="Copi kolchi"
                                    >
                                      <Copy className="w-4 h-4" />
                                    </button>
                                  ) : null}
                                </div>
                              );
                            })()}

                            {hasVeo31 ? (
                              <div className="space-y-3">
                                <div className="flex gap-1.5 items-stretch">
                                  <details className="flex-1 min-w-0 text-sm rounded-lg border border-gray-100 bg-white shadow-sm group">
                                    <summary className="cursor-pointer list-none px-3 py-2.5 font-medium text-gray-700 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                                      <ChevronDown className="w-4 h-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
                                      <span className="text-xs font-bold text-orange-500 uppercase tracking-wider">
                                        veoPrompt
                                      </span>
                                    </summary>
                                    <div className="px-3 pb-3 border-t border-gray-50">
                                      <p className="text-gray-700 text-sm whitespace-pre-wrap pt-2">
                                        {scene.veoPrompt}
                                      </p>
                                    </div>
                                  </details>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(scene.veoPrompt);
                                      alert("T-copia veoPrompt!");
                                    }}
                                    className="shrink-0 self-start p-2.5 mt-0.5 text-gray-400 hover:text-orange-500 rounded-lg hover:bg-orange-50 border border-transparent hover:border-orange-100"
                                    title="Copi veoPrompt"
                                  >
                                    <Copy className="w-4 h-4" />
                                  </button>
                                </div>
                                {typeof scene.negativePrompt === "string" && scene.negativePrompt.trim() && (
                                  <div className="flex gap-1.5 items-stretch">
                                    <details className="flex-1 min-w-0 text-sm rounded-lg border border-gray-100 bg-white shadow-sm group">
                                      <summary className="cursor-pointer list-none px-3 py-2.5 font-medium text-gray-700 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                                        <ChevronDown className="w-4 h-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
                                        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                                          negativePrompt
                                        </span>
                                      </summary>
                                      <div className="px-3 pb-3 border-t border-gray-50">
                                        <p className="text-gray-700 text-sm whitespace-pre-wrap pt-2">
                                          {scene.negativePrompt}
                                        </p>
                                      </div>
                                    </details>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        navigator.clipboard.writeText(scene.negativePrompt);
                                        alert("T-copia negativePrompt!");
                                      }}
                                      className="shrink-0 self-start p-2.5 mt-0.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 border border-transparent hover:border-gray-200"
                                      title="Copi negativePrompt"
                                    >
                                      <Copy className="w-4 h-4" />
                                    </button>
                                  </div>
                                )}
                                <div className="flex gap-1.5 items-stretch">
                                  <details className="flex-1 min-w-0 text-sm rounded-lg border border-gray-100 bg-white group">
                                    <summary className="cursor-pointer list-none px-3 py-2.5 font-medium text-gray-600 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                                      <ChevronDown className="w-4 h-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
                                      Full JSON
                                    </summary>
                                    <pre className="mt-0 text-xs bg-gray-50/80 p-3 border-t border-gray-100 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap font-mono">
                                      {JSON.stringify(scene, null, 2)}
                                    </pre>
                                  </details>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(JSON.stringify(scene, null, 2));
                                      alert("T-copia Full JSON!");
                                    }}
                                    className="shrink-0 self-start p-2.5 mt-0.5 text-gray-400 hover:text-orange-500 rounded-lg hover:bg-orange-50 border border-transparent hover:border-orange-100"
                                    title="Copi Full JSON"
                                  >
                                    <Copy className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ) : prompts.length > 0 ? (
                              <div className="space-y-4">
                                {prompts.map((prompt: string, pIdx: number) => (
                                  <div key={pIdx} className="bg-white p-4 rounded-lg border border-gray-100 shadow-sm relative group">
                                    <div className="flex justify-between items-start gap-4">
                                      <div className="flex-1">
                                        <span className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-1 block">Veo Prompt {pIdx + 1}</span>
                                        <p className="text-gray-700 text-sm">{prompt}</p>
                                      </div>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          navigator.clipboard.writeText(prompt);
                                          alert("T-copia Prompt!");
                                        }}
                                        className="text-gray-400 hover:text-orange-500 transition-colors p-2 bg-gray-50 rounded-lg group-hover:bg-orange-50"
                                        title="Copi Prompt"
                                      >
                                        <Copy className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-gray-500 italic text-sm">
                                Makayninch veo prompts f had scene.
                                <pre className="mt-2 text-xs bg-white p-2 rounded border overflow-x-auto">{JSON.stringify(scene, null, 2)}</pre>
                              </div>
                            )}
                              </div>
                              {stillAside}
                            </div>
                          </div>
                        );
                      })}
                      {veoResponseData.generating &&
                        typeof veoResponseData.generationTotal === "number" &&
                        Array.isArray(veoResponseData.scenes) &&
                        veoResponseData.scenes.length < veoResponseData.generationTotal && (
                          <div className="rounded-xl border border-dashed border-orange-200 bg-orange-50/50 p-6 text-center text-sm text-gray-700">
                            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-orange-500" />
                            Machhad {veoResponseData.scenes.length + 1} /{" "}
                            {veoResponseData.generationTotal} — mazal f OpenAI…
                          </div>
                        )}
                    </div>
                  ) : veoResponseData.rawText ? (
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                      <h4 className="font-bold text-gray-700 mb-2">Raw Response:</h4>
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">
                        {veoResponseData.rawText}
                      </pre>
                    </div>
                  ) : (
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                      <h4 className="font-bold text-gray-700 mb-2">JSON Response:</h4>
                      <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">
                        {JSON.stringify(veoResponseData, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-12 text-center text-gray-400 flex flex-col items-center justify-center">
                  <Sparkles className="w-12 h-12 mb-4 opacity-20" />
                  <p>Mazal ma-generit hta package Veo.</p>
                  <p className="text-sm mt-2 max-w-md">
                    Mn onglet Video: mlli y-wjdo script dyal l-webhook o tsawer debut/fin l-koll machhad,
                    click Generi Veo (hna) — OpenAI ghadi y7ell tsawer o y-generi JSON (bla webhook).
                  </p>
                  {webhookHistory.length === 0 && (
                    <p className="text-sm mt-2 text-gray-500">
                      Ila ma-kaynach liste: connecté b-compte li fih sijil videos.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
          </div>
        )}

        {activeTab === "settings" && (
          <div className="max-w-2xl mx-auto space-y-8 pb-12">
            <div className="flex items-start gap-3">
              <div className="bg-orange-100 p-2 rounded-xl shrink-0">
                <Settings className="w-6 h-6 text-orange-600" />
              </div>
              <div>
                <h2 className="text-2xl font-bold">I3dadat</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Zid lmots li Veo ma-kaybefore-homch, khtar lougha d script swoti. Lougha o liste
                  Veo: sauvegarde automatique f navigateur. Webhooks: &quot;Sauvegarder&quot; b-compte
                  dialk f Supabase.
                </p>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6 space-y-4">
              <h3 className="font-semibold text-gray-800">Webhooks (Make.com)</h3>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Webhook URL — script / video
                </label>
                <input
                  type="url"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                  placeholder="https://hook.eu1.make.com/..."
                />
                <p className="text-xs text-gray-500 mt-2">
                  POST dial l-script mnin y-tgenera (kamel).
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Webhook URL — tsawer (scenes)
                </label>
                <input
                  type="url"
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
                  value={imagesWebhookUrl}
                  onChange={(e) => setImagesWebhookUrl(e.target.value)}
                  placeholder="https://hook.eu1.make.com/..."
                />
                <p className="text-xs text-gray-500 mt-2">
                  (Ikhtiyari / legacy) POST l-Make. Veo dial l-app daba k-ykhdem b OpenAI hna — ma-mo7tajch had URL bach t-generi packages.
                </p>
              </div>
              <button
                type="button"
                disabled={isSavingWebhookSettings}
                onClick={() => void saveWebhookSettings()}
                className="w-full sm:w-auto px-6 py-3 bg-orange-500 text-white rounded-xl font-semibold hover:bg-orange-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSavingWebhookSettings ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : null}
                Sauvegarder webhooks
              </button>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 sm:p-6 space-y-4">
              <h3 className="font-semibold text-gray-800">Lougha o Veo</h3>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Lougha d script swoti
                </label>
                <VoiceLanguageSelect
                  value={voiceScriptLanguage}
                  onChange={setVoiceScriptLanguage}
                  otherValue={voiceScriptLanguageOther}
                  onChangeOther={setVoiceScriptLanguageOther}
                  accentValue={voiceAccent}
                  onChangeAccent={setVoiceAccent}
                  accentOtherValue={voiceAccentOther}
                  onChangeAccentOther={setVoiceAccentOther}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                  Kalma / mots ma-yt accepted-iwch f Veo 3
                </label>
                <textarea
                  className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none resize-y min-h-[100px] text-base sm:text-sm"
                  placeholder="Khelli line w7da l kol kelma, ola comma / virgule"
                  value={veoAvoidWords}
                  onChange={(e) => setVeoAvoidWords(e.target.value)}
                />
                <p className="mt-2 text-xs text-gray-500">
                  L-AI k-yjannb had lmots f script & texte. Tashkīl 3la l-kelmāt s3iba
                  f 3arabi kay-dkhul f prompts dial generi.
                </p>
              </div>
              <div className="pt-2 border-t border-gray-100">
                <p className="text-sm text-gray-700 mb-2">
                  Historique dial Step 3 (model + background) f had n-navigateur:{" "}
                  <span className="font-medium tabular-nums">{usedStep3VisualCount}</span>{" "}
                  generasyon m-sauvegardyin bach ma-yt3awd-ch nafs prompts.
                </p>
                <button
                  type="button"
                  className="text-sm text-gray-700 border border-gray-200 hover:bg-gray-50 px-4 py-2 rounded-xl font-medium"
                  onClick={() => {
                    saveUsedVisualPrompts({ models: [], backgrounds: [] });
                    setVisualPromptHistoryTick((t) => t + 1);
                    alert("Tfaret l-historique dial prompts (model + background).");
                  }}
                >
                  Fergh historique dial prompts (Step 3)
                </button>
              </div>
              <div className="pt-2 border-t border-gray-100">
                <p className="text-sm text-gray-700 mb-2">
                  Draft dial onglet Generate (fikra, voix, prompts, script…): sauvegarde
                  automatique f navigateur — refresh ma-kaymsa7-ch l-khedma.
                </p>
                <button
                  type="button"
                  className="text-sm text-red-700 border border-red-200 hover:bg-red-50 px-4 py-2 rounded-xl font-medium"
                  onClick={() => {
                    if (
                      !confirm(
                        "Fergh draft dial Generate (local) w refresh l-page? Ma-t9derch t-3awd-h.",
                      )
                    )
                      return;
                    clearWorkspaceDraft();
                    window.location.reload();
                  }}
                >
                  Fergh draft Generate + refresh
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      {/* Missing Images Dialog Modal */}
      {missingImagesDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-xl font-bold text-gray-900">Tsawer Na9sin</h3>
            <p className="text-gray-600">Khassek t-uploadi had tsawer 9bel ma t-generi Veo (hna):</p>
            <ul className="list-disc list-inside text-sm text-gray-700 max-h-40 overflow-y-auto bg-gray-50 p-3 rounded-lg border border-gray-200">
              {missingImagesDialog.map((img, i) => (
                <li key={i}>{img}</li>
              ))}
            </ul>
            <div className="flex justify-end pt-4">
              <button
                onClick={() => setMissingImagesDialog(null)}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white font-medium rounded-xl transition-colors"
              >
                Fhmt
              </button>
            </div>
          </div>
        </div>
      )}

      {referenceImagePicker != null && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ref-pick-title"
          onClick={() => setReferenceImagePicker(null)}
        >
          <div
            className="bg-white rounded-2xl p-5 max-w-lg w-full max-h-[85vh] flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-start gap-3 mb-2">
              <h3 id="ref-pick-title" className="text-lg font-bold text-gray-900 pr-2">
                Khtar tswira
              </h3>
              <button
                type="button"
                onClick={() => setReferenceImagePicker(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 shrink-0"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              Men récent, session, script mkhbi, wla tsawer l-produits — ma-t7tajch t3awd upload nfs l-fichier.
            </p>
            {referenceImagePickOptions.length === 0 ? (
              <p className="text-sm text-gray-500 py-8 text-center">
                Ma kayn walu · uplodi tswira lwel mra bach t-tsajel f s-sijil dial had n-navigateur.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 overflow-y-auto max-h-[55vh] pr-1">
                {referenceImagePickOptions.map(({ url, label }) => {
                  const target = referenceImagePicker;
                  if (target == null) return null;
                  return (
                    <button
                      key={url}
                      type="button"
                      onClick={() => void applyReferenceImagePick(target, url)}
                      className="group text-left rounded-xl border border-gray-200 overflow-hidden hover:border-orange-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
                    >
                      <div className="aspect-square bg-gray-100">
                        <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
                      </div>
                      <p className="text-[10px] leading-tight text-gray-600 px-1.5 py-1 truncate" title={label}>
                        {label}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex justify-end pt-4 mt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setReferenceImagePicker(null)}
                className="px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl text-sm font-medium transition-colors"
              >
                Lghi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete History Confirm Modal */}
      {deleteHistoryConfirmId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-xl font-bold text-gray-900">Tms7 l-Video?</h3>
            <p className="text-gray-600">Wach m2ked bghiti tms7 had l-video mn s-sijil?</p>
            <div className="flex gap-3 pt-4">
              <button 
                onClick={() => setDeleteHistoryConfirmId(null)}
                className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors"
              >
                La
              </button>
              <button 
                onClick={confirmDeleteHistoryItem}
                className="flex-1 py-2.5 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 transition-colors"
              >
                Mse7
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rename History Modal */}
      {renameHistoryModalId && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-xl font-bold text-gray-900">Bddel Smiya</h3>
            <div>
              <input 
                type="text" 
                value={renameHistoryValue}
                onChange={(e) => setRenameHistoryValue(e.target.value)}
                className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
                placeholder="Smiya jdida..."
                autoFocus
              />
            </div>
            <div className="flex gap-3 pt-4">
              <button 
                onClick={() => setRenameHistoryModalId(null)}
                className="flex-1 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-medium hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={confirmRenameHistoryItem}
                disabled={!renameHistoryValue.trim()}
                className="flex-1 py-2.5 bg-orange-500 text-white rounded-xl font-medium hover:bg-orange-600 transition-colors disabled:opacity-50"
              >
                Sauvegarder
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Product Modal */}
      {isAddProductModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-xl font-bold">Zid Produit Jdid</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Smiya dial l-produit</label>
                <input 
                  type="text" 
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
                  value={newProductName}
                  onChange={e => setNewProductName(e.target.value)}
                  placeholder="Matalan: Sabat Nike..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea 
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none resize-none"
                  rows={3}
                  value={newProductDesc}
                  onChange={e => setNewProductDesc(e.target.value)}
                  placeholder="Wsef l-produit dialk..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Script details (khass l-AI y3rf)
                </label>
                <textarea
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none resize-none"
                  rows={4}
                  value={newProductScriptDetails}
                  onChange={(e) => setNewProductScriptDetails(e.target.value)}
                  placeholder="مثال: الثمن، العرض، الفئة المستهدفة، المشكل اللي كيحلّ، USP، الضمان، ممنوع نقولو كذا، CTA..."
                />
                <p className="text-xs text-gray-500 mt-1">
                  هادشي كيدخل تلقائياً فـ Generi Script ملي كتختار هاد المنتج.
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">Model ref (khtiyari)</label>
                  <div className="flex items-stretch gap-2">
                    <label className="flex-1 cursor-pointer border border-dashed border-gray-200 rounded-xl p-3 flex items-center justify-center gap-2 hover:bg-gray-50 min-h-[3rem]">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void handleNewProductModelImageUpload(e)}
                        disabled={isUploadingNewProductModel}
                      />
                      {isUploadingNewProductModel ? (
                        <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                      ) : (
                        <Upload className="w-5 h-5 text-gray-400" />
                      )}
                      <span className="text-xs text-gray-500">Upload</span>
                    </label>
                    <button
                      type="button"
                      title="Khtar men déjà uploadé"
                      onClick={() => setReferenceImagePicker({ kind: "newProductRef", field: "model" })}
                      className="shrink-0 inline-flex flex-col items-center justify-center gap-0.5 px-2 py-2 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-xl transition-colors"
                    >
                      <Images className="w-4 h-4" />
                      <span className="hidden sm:block text-[10px]">Déjà</span>
                    </button>
                  </div>
                  <ProductThumb url={newProductModelImageUrl} alt="" size="md" />
                </div>
                <div className="space-y-2">
                  <label className="block text-sm font-medium text-gray-700">Tswira d l-produit (khtiyari)</label>
                  <div className="flex items-stretch gap-2">
                    <label className="flex-1 cursor-pointer border border-dashed border-gray-200 rounded-xl p-3 flex items-center justify-center gap-2 hover:bg-gray-50 min-h-[3rem]">
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void handleNewProductProductImageUpload(e)}
                        disabled={isUploadingNewProductProduct}
                      />
                      {isUploadingNewProductProduct ? (
                        <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
                      ) : (
                        <Upload className="w-5 h-5 text-gray-400" />
                      )}
                      <span className="text-xs text-gray-500">Upload</span>
                    </label>
                    <button
                      type="button"
                      title="Khtar men déjà uploadé"
                      onClick={() => setReferenceImagePicker({ kind: "newProductRef", field: "product" })}
                      className="shrink-0 inline-flex flex-col items-center justify-center gap-0.5 px-2 py-2 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-xl transition-colors"
                    >
                      <Images className="w-4 h-4" />
                      <span className="hidden sm:block text-[10px]">Déjà</span>
                    </button>
                  </div>
                  <ProductThumb url={newProductProductImageUrl} alt="" size="md" />
                </div>
              </div>
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button 
                onClick={() => {
                  setIsAddProductModalOpen(false);
                  setNewProductName('');
                  setNewProductDesc('');
                  setNewProductScriptDetails('');
                  setNewProductModelImageUrl(null);
                  setNewProductProductImageUrl(null);
                }}
                className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-xl font-medium transition-colors"
              >
                Lghi
              </button>
              <button 
                onClick={() => {
                  if (newProductName.trim()) {
                    addProduct(newProductName.trim(), newProductDesc.trim(), newProductScriptDetails.trim(), {
                      modelImageUrl: newProductModelImageUrl,
                      productImageUrl: newProductProductImageUrl,
                    });
                    setIsAddProductModalOpen(false);
                    setNewProductName('');
                    setNewProductDesc('');
                    setNewProductScriptDetails('');
                    setNewProductModelImageUrl(null);
                    setNewProductProductImageUrl(null);
                  }
                }}
                disabled={!newProductName.trim()}
                className="px-4 py-2 bg-orange-500 text-white rounded-xl font-medium hover:bg-orange-600 transition-colors disabled:opacity-50"
              >
                Zid Produit
              </button>
            </div>
          </div>
        </div>
      )}



      {/* Send Saved Script Modal */}
      {scriptToSend && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <Send className="w-5 h-5 text-orange-500" />
                Sifet l-Webhook
              </h3>
              <button onClick={() => setScriptToSend(null)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                T9der tzid tswira dyal l-model w tswira dyal l-produit 9bel ma tsifet l-script l-webhook.
              </p>

              {/* Model Image Upload */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Tswira dyal l-Model (Khtiyari)</label>
                <div className="flex items-center gap-2 sm:gap-4">
                  <div className="flex-1 min-w-0 flex items-stretch gap-2">
                    <label className="flex-1 min-w-0 cursor-pointer border-2 border-dashed border-gray-200 rounded-xl p-4 hover:bg-gray-50 transition-colors flex flex-col items-center justify-center gap-2">
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={handleSavedModelImageUpload}
                        disabled={isUploadingSavedModel}
                      />
                      {isUploadingSavedModel ? (
                        <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />
                      ) : (
                        <Upload className="w-5 h-5 text-gray-400" />
                      )}
                      <span className="text-sm text-gray-500 text-center break-all">
                        {savedScriptModelImageFile ? savedScriptModelImageFile.name : 'Zid tswira d l-model'}
                      </span>
                    </label>
                    <button
                      type="button"
                      title="Khtar men tsawer li deja uploditi"
                      onClick={() => setReferenceImagePicker({ kind: "savedScriptRef", field: "model" })}
                      className="shrink-0 self-center inline-flex flex-col items-center justify-center gap-0.5 px-2 py-2 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-xl transition-colors"
                    >
                      <Images className="w-4 h-4 shrink-0" />
                      <span className="hidden sm:block max-w-[3.5rem] text-center leading-tight">Déjà</span>
                    </button>
                  </div>
                  {savedScriptModelImageUrl && (
                    <div className="w-16 h-16 rounded-xl overflow-hidden border border-gray-200 shrink-0">
                      <img src={savedScriptModelImageUrl} alt="Model" className="w-full h-full object-cover" />
                    </div>
                  )}
                </div>
              </div>

              {/* Product Image Upload */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Tswira dyal l-Produit (Khtiyari)</label>
                <div className="flex items-center gap-2 sm:gap-4">
                  <div className="flex-1 min-w-0 flex items-stretch gap-2">
                    <label className="flex-1 min-w-0 cursor-pointer border-2 border-dashed border-gray-200 rounded-xl p-4 hover:bg-gray-50 transition-colors flex flex-col items-center justify-center gap-2">
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={handleSavedProductImageUpload}
                        disabled={isUploadingSavedProduct}
                      />
                      {isUploadingSavedProduct ? (
                        <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />
                      ) : (
                        <Upload className="w-5 h-5 text-gray-400" />
                      )}
                      <span className="text-sm text-gray-500 text-center break-all">
                        {savedScriptProductImageFile ? savedScriptProductImageFile.name : 'Zid tswira d l-produit'}
                      </span>
                    </label>
                    <button
                      type="button"
                      title="Khtar men tsawer li deja uploditi"
                      onClick={() => setReferenceImagePicker({ kind: "savedScriptRef", field: "product" })}
                      className="shrink-0 self-center inline-flex flex-col items-center justify-center gap-0.5 px-2 py-2 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-xl transition-colors"
                    >
                      <Images className="w-4 h-4 shrink-0" />
                      <span className="hidden sm:block max-w-[3.5rem] text-center leading-tight">Déjà</span>
                    </button>
                  </div>
                  {savedScriptProductImageUrl && (
                    <div className="w-16 h-16 rounded-xl overflow-hidden border border-gray-200 shrink-0">
                      <img src={savedScriptProductImageUrl} alt="Product" className="w-full h-full object-cover" />
                    </div>
                  )}
                </div>
              </div>

              {/* Background Image Upload */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Tswira dyal l-Background (Khtiyari)</label>
                <div className="flex items-center gap-2 sm:gap-4">
                  <div className="flex-1 min-w-0 flex items-stretch gap-2">
                    <label className="flex-1 min-w-0 cursor-pointer border-2 border-dashed border-gray-200 rounded-xl p-4 hover:bg-gray-50 transition-colors flex flex-col items-center justify-center gap-2">
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={handleSavedBackgroundImageUpload}
                        disabled={isUploadingSavedBackground}
                      />
                      {isUploadingSavedBackground ? (
                        <Loader2 className="w-5 h-5 text-orange-500 animate-spin" />
                      ) : (
                        <Upload className="w-5 h-5 text-gray-400" />
                      )}
                      <span className="text-sm text-gray-500 text-center break-all">
                        {savedScriptBackgroundImageFile ? savedScriptBackgroundImageFile.name : 'Zid tswira d l-background'}
                      </span>
                    </label>
                    <button
                      type="button"
                      title="Khtar men tsawer li deja uploditi"
                      onClick={() => setReferenceImagePicker({ kind: "savedScriptRef", field: "background" })}
                      className="shrink-0 self-center inline-flex flex-col items-center justify-center gap-0.5 px-2 py-2 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-xl transition-colors"
                    >
                      <Images className="w-4 h-4 shrink-0" />
                      <span className="hidden sm:block max-w-[3.5rem] text-center leading-tight">Déjà</span>
                    </button>
                  </div>
                  {savedScriptBackgroundImageUrl && (
                    <div className="w-16 h-16 rounded-xl overflow-hidden border border-gray-200 shrink-0">
                      <img src={savedScriptBackgroundImageUrl} alt="Background" className="w-full h-full object-cover" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setScriptToSend(null)}
                className="flex-1 px-4 py-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl font-medium transition-colors"
              >
                Blech
              </button>
              <button
                onClick={sendSavedScriptToWebhook}
                disabled={
                  !webhookUrl ||
                  isUploadingSavedModel ||
                  isUploadingSavedProduct ||
                  isUploadingSavedBackground
                }
                className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-xl font-medium hover:bg-orange-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                Sifet
              </button>
            </div>
            {!webhookUrl && (
              <p className="text-xs text-red-500 text-center">
                Khassk t-zid l-webhook URL f onglet I3dadat 9bel ma tsifet.
              </p>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
