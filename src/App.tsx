/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  CheckCircle
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import Markdown from 'react-markdown';
import localforage from 'localforage';

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
  thumbnailBase64?: string;
  createdAt: any;
  ownerId: string;
}

interface PendingVideo {
  id: string;
  productId: string;
  file: File;
  url: string;
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

function handleDbError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path
  };
  console.error("Database error:", JSON.stringify(errInfo));
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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  const [products, setProducts] = useState<Product[]>([]);
  const [videos, setVideos] = useState<VideoData[]>([]);
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([]);
  
  const [activeTab, setActiveTab] = useState<'products' | 'generate' | 'saved' | 'videoResult' | 'veoResult'>('products');
  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({});
  
  // Modal State
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [newProductName, setNewProductName] = useState('');
  const [newProductDesc, setNewProductDesc] = useState('');
  
  // Generation State
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [duration, setDuration] = useState('40-50');
  const [sceneCount, setSceneCount] = useState('auto');
  const [useModelRef, setUseModelRef] = useState(false);
  const [useProductRef, setUseProductRef] = useState(false);
  const [useBackgroundRef, setUseBackgroundRef] = useState(false);
  const [modelImageFile, setModelImageFile] = useState<File | null>(null);
  const [productImageFile, setProductImageFile] = useState<File | null>(null);
  const [backgroundImageFile, setBackgroundImageFile] = useState<File | null>(null);
  const [modelImageUrl, setModelImageUrl] = useState<string | null>(null);
  const [productImageUrl, setProductImageUrl] = useState<string | null>(null);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | null>(null);
  const [isUploadingModel, setIsUploadingModel] = useState(false);
  const [isUploadingProduct, setIsUploadingProduct] = useState(false);
  const [isUploadingBackground, setIsUploadingBackground] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedScript, setGeneratedScript] = useState<string | null>(null);
  const [generatedScenes, setGeneratedScenes] = useState<any[] | null>(null);
  const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
  const [webhookResponseText, setWebhookResponseText] = useState<string | null>(null);
  const [webhookResponseData, setWebhookResponseData] = useState<any | null>(null);
  const [veoResponseData, setVeoResponseData] = useState<any | null>(null);
  const [webhookHistory, setWebhookHistory] = useState<WebhookHistoryItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [isScriptCollapsed, setIsScriptCollapsed] = useState(false);
  
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
  
  // Settings State
  const [showSettings, setShowSettings] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState(() => localStorage.getItem('makeWebhookUrl') || '');
  const [imagesWebhookUrl, setImagesWebhookUrl] = useState(() => localStorage.getItem('imagesWebhookUrl') || '');
  const [isSendingWebhook, setIsSendingWebhook] = useState(false);
  const [isSendingImages, setIsSendingImages] = useState(false);
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
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
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

  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sceneImages, setSceneImages] = useState<Record<string, string>>({});
  const [isUploadingSceneImage, setIsUploadingSceneImage] = useState<Record<string, boolean>>({});

  const refreshUserData = useCallback(async (userId: string) => {
    try {
    const [
      { data: productsRows, error: pErr },
      { data: videosRows, error: vErr },
      { data: scriptsRows, error: sErr },
      { data: historyRows, error: hErr },
    ] = await Promise.all([
      supabase.from("products").select("*").eq("owner_id", userId).order("created_at", { ascending: false }),
      supabase.from("videos").select("*").eq("owner_id", userId).order("created_at", { ascending: false }),
      supabase.from("saved_scripts").select("*").eq("owner_id", userId).order("created_at", { ascending: false }),
      supabase.from("video_history").select("*").eq("owner_id", userId).order("created_at", { ascending: false }),
    ]);
    if (pErr) handleDbError(pErr, OperationType.LIST, "products");
    if (vErr) handleDbError(vErr, OperationType.LIST, "videos");
    if (sErr) handleDbError(sErr, OperationType.LIST, "saved_scripts");
    if (hErr) handleDbError(hErr, OperationType.LIST, "video_history");

    const productsMapped: Product[] = (productsRows ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) ?? "",
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
        setProducts([]);
        setVideos([]);
        setSavedScripts([]);
        setWebhookHistory([]);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setIsAuthReady(true);
      if (session?.user) {
        void refreshUserData(session.user.id);
      } else {
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
    await supabase.auth.signOut();
  };

  // Product Actions
  const addProduct = async (name: string, description: string) => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from("products")
        .insert({
          name,
          description,
          owner_id: user.id,
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
            "API 404: l-server ma-khdamch. Demmar b `npm run dev` (http://localhost:3000) wla `tsx server.ts` + Vite. Ma-tkhdemch ghir `vite` bohdo bla Express."
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

  const generateScript = async () => {
    if (!selectedProductId) {
      setError("3afak khtar produit wla 'Ga3 l-Produits'.");
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      // Use transcriptions from selected product or all products
      const relevantVideos = selectedProductId === 'all' 
        ? videos 
        : videos.filter(v => v.productId === selectedProductId);
        
      const context = relevantVideos.map(v => `Example Script:\n${v.transcription}`).join('\n\n---\n\n');
      
      let productInfo = "All Products";
      if (selectedProductId !== 'all') {
        const product = products.find(p => p.id === selectedProductId);
        if (product) {
          productInfo = `Product: ${product.name}\nDescription: ${product.description}`;
        }
      }

      let wordCountHint = "";
      if (duration === "0-15") wordCountHint = "CRITICAL: The script MUST be EXTREMELY SHORT (max 20-30 words total). Very fast-paced hook and CTA only.";
      else if (duration === "15-20") wordCountHint = "CRITICAL: The script MUST be VERY SHORT (max 30-40 words total). Keep it extremely punchy and fast. DO NOT write a long script.";
      else if (duration === "20-30") wordCountHint = "CRITICAL: The script MUST be SHORT (around 50-60 words total). Fast-paced, straight to the point.";
      else if (duration === "30-40") wordCountHint = "CRITICAL: The script MUST be SHORT-MEDIUM (around 70-80 words total). Good pacing.";
      else if (duration === "40-50") wordCountHint = "CRITICAL: The script MUST be MEDIUM length (around 100-120 words total).";
      else if (duration === "50-60") wordCountHint = "CRITICAL: The script MUST be MEDIUM-LONG length (around 130-140 words total).";
      else if (duration === "60+") wordCountHint = "CRITICAL: The script MUST be LONG (150+ words total). Detailed storytelling.";

      const isUniqueRequested = customPrompt.toLowerCase().includes('unique');
      const styleInstruction = isUniqueRequested 
        ? "CRITICAL INSTRUCTION: The user requested a UNIQUE script. DO NOT copy the examples. You MUST generate a completely NEW, UNIQUE, and DIFFERENT script. Do not repeat the exact same hooks or phrases."
        : "INSTRUCTION: You can take inspiration, mix, and match elements from the 'Style Examples' above to match the user's preferred style. However, DO NOT output the exact same script. Create a fresh variation.";

      let sceneInstruction = "CRITICAL INSTRUCTION: Divide the script into scenes of approximately 8 seconds each (e.g., 4 or 5 scenes depending on the total duration).";
      if (sceneCount !== 'auto') {
        sceneInstruction = `CRITICAL INSTRUCTION: You MUST divide the script into EXACTLY ${sceneCount} scenes.`;
      }

      const prompt = `
        You are an expert Moroccan TikTok Ad Script Writer. 
        Write a high-converting script in Moroccan Darija.
        
        ${productInfo}
        
        Target Duration: ${duration} seconds.
        ${wordCountHint}
        
        User's Custom Instructions / Tone:
        ${customPrompt || "Make it engaging and viral."}

        You MUST follow this EXACT structure and format (in Arabic/Darija) with the exact markdown bolding:
        
        بصفتي خبير في كتابة إعلانات تيك توك بالمغرب، أؤكد لك أن هذا السكريبت سيكون له تأثير قوي جداً (High Conversion Rate). تلبيةً لطلبك، السكريبت **مختلف كلياً (Unique)** عن الإعلانات السابقة، و**يبدأ مباشرة بالنتيجة المبهرة** كما طلبت. البدء بالنتيجة يخطف انتباه المشاهد (Stop the scroll) في الثواني الأولى ويجعله يتساءل: "كيفاش دارت ليها؟"، مما يرفع نسبة المشاهدة الكاملة للفيديو.
        
        📝 **هيكل الإعلان (TikTok Ad Script)**
        المنتج: [Product Name]
        المدة المتوقعة: ${duration} ثانية.

        🎬 **السكريبت الصوتي (Voice Script) والتعليمات البصرية:**
        ${sceneInstruction}

        **المشهد 1 (Scene 1) - الخطاف (HOOK) - من 0 إلى X ثواني**
        [شنو تبيني فالفيديو]: ...
        [النص الصوتي - Voice Script]: ...

        **المشهد 2 (Scene 2) - من X إلى Y ثانية**
        [شنو تبيني فالفيديو]: ...
        [النص الصوتي - Voice Script]: ...
        
        (Continue adding scenes until the target duration or scene count is reached. The last scene should include the CTA).

        ---

        💡 **نصائح إضافية لنجاح الإعلان (Text On Screen):**
        *   **الثانية X-Y:** اكتب الفوق بالبنط العريض: "..."
        (Provide text to display on screen at specific seconds)

        **نصيحة في الأداء الصوتي:**
        *   **في المشهد الأول:** ...
        *   **في المشهد الثاني والثالث:** ...
        (Provide tips on how to deliver the voiceover)

        ---

        🎙️ **السكريبت الصوتي الكامل (Full Voice Script):**
        (Provide the complete voice script from start to finish in one continuous block of text here, so it's easy to read for recording. ONLY the spoken words, no visual instructions).

        Style Examples from previous videos:
        ${context || "Standard high-energy Moroccan TikTok slang."}

        ${styleInstruction}
      `;

      const chatRes = await fetch(apiUrl("/api/ai/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          temperature: isUniqueRequested ? 0.9 : 0.7,
        }),
      });
      const chatJson = (await chatRes.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
      };
      if (!chatRes.ok) {
        throw new Error(
          chatJson.error || `Generi HTTP ${chatRes.status}`
        );
      }

      const responseText = chatJson.text?.trim();
      if (responseText) {
        setGeneratedScript(responseText);
        setGeneratedScenes(null);
      } else {
        setGeneratedScript("Smah lina, ma9dernach n-generiw script.");
      }

    } catch (err) {
      console.error(err);
      setError(generationErrorMessage(err));
    } finally {
      setIsGenerating(false);
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
        setModelImageUrl(res[0].url);
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
        setProductImageUrl(res[0].url);
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
        setBackgroundImageUrl(res[0].url);
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

  const sendImagesToWebhook = async () => {
    if (!imagesWebhookUrl || !webhookResponseData || !webhookResponseData.scenes) return;

    const parsedScenes = parseScenesData(webhookResponseData.scenes);
    
    // Check for missing images
    const missingImages: string[] = [];
    parsedScenes.forEach((scene: any, idx: number) => {
      const sceneNum = scene.sceneNumber || scene.scene_number || (idx + 1);
      if (!sceneImages[`${selectedHistoryId}-${idx}-debut`]) {
        missingImages.push(`Scene ${sceneNum} - Debut`);
      }
      if (!sceneImages[`${selectedHistoryId}-${idx}-fin`]) {
        missingImages.push(`Scene ${sceneNum} - Fin`);
      }
    });

    if (missingImages.length > 0) {
      setMissingImagesDialog(missingImages);
      return;
    }

    setIsSendingImages(true);

    try {
      const scenesPayload = parsedScenes.map((scene: any, idx: number) => ({
        sceneNumber: scene.sceneNumber || scene.scene_number || (idx + 1),
        debut_image_url: sceneImages[`${selectedHistoryId}-${idx}-debut`] || null,
        fin_image_url: sceneImages[`${selectedHistoryId}-${idx}-fin`] || null,
        debut_prompt: scene.debut?.prompt || "",
        fin_prompt: scene.fin?.prompt || ""
      }));

      const payload = {
        script: webhookResponseData.script || generatedScript,
        scenes: scenesPayload,
        timestamp: new Date().toISOString(),
        videoId: videoPageDisplayId(selectedHistoryId),
      };

      const response = await fetch(imagesWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const text = await response.text();
        
        // Mark as sent in history
        if (selectedHistoryId && user) {
          try {
            const { error } = await supabase
              .from("video_history")
              .update({ sent_to_webhook: true })
              .eq("id", selectedHistoryId);
            if (error) throw error;
            await refreshUserData(user.id);
          } catch (err) {
            console.error("Failed to update sent_to_webhook", err);
          }
        }

        try {
          const data = JSON.parse(text);
          setVeoResponseData(data);
          setActiveTab('veoResult');
          alert('Tsawer tsifto l-webhook b-naja7! (Veo Prompts wjdo)');
        } catch (e) {
          setVeoResponseData({ rawText: text });
          setActiveTab('veoResult');
          alert('Tsawer tsifto l-webhook b-naja7!');
        }
      } else {
        alert('Mouchkil f tsifat d tsawer l-webhook.');
      }
    } catch (error) {
      console.error("Error sending images to webhook:", error);
      alert('Mouchkil f tsifat d tsawer l-webhook.');
    } finally {
      setIsSendingImages(false);
    }
  };

  const sendToWebhook = async () => {
    if (!webhookUrl || !generatedScript || generatedScript === "Smah lina, ma9dernach n-generiw script.") return;
    if (!user) return;

    setIsSendingWebhook(true);
    setWebhookStatus("idle");
    setGeneratedVideoUrl(null);
    setWebhookResponseText(null);
    setWebhookResponseData(null);
    setActiveTab("videoResult");

    const historyId = await createVideoHistoryPending(selectedProductId);
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
          productId: selectedProductId,
          duration,
          sceneCount,
          customPrompt,
          script: generatedScript,
          scenes: generatedScenes ? generatedScenes.map((s) => JSON.stringify(s)).join(", ") : "",
          modelImageUrl,
          productImageUrl,
          backgroundImageUrl,
          useModelRef,
          useProductRef,
          useBackgroundRef,
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
              await finalizeVideoHistory(historyId, null, null, url);
            } else {
              console.log("Webhook response JSON:", data);
              if (text.startsWith("http")) {
                setGeneratedVideoUrl(text);
                setWebhookResponseText(null);
                setWebhookResponseData(null);
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
                await finalizeVideoHistory(historyId, parsedData, text, null);
              }
            }
          } catch {
            const brokenData = parseBrokenWebhookResponse(text);
            if (brokenData) {
              setWebhookResponseData(brokenData);
              setWebhookResponseText(null);
              await finalizeVideoHistory(historyId, brokenData, text, null);
            } else {
              const cleanText = text.replace(/^["']|["']$/g, "").trim();
              if (cleanText.startsWith("http")) {
                setGeneratedVideoUrl(cleanText);
                setWebhookResponseText(null);
                setWebhookResponseData(null);
                await finalizeVideoHistory(historyId, null, null, cleanText);
              } else {
                console.log("Webhook raw response:", text);
                setWebhookResponseText(text);
                setWebhookResponseData(null);
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

      let voiceScriptOnly = "";
      const marker = "السكريبت الصوتي الكامل";
      if (generatedScript.includes(marker)) {
        const parts = generatedScript.split(marker);
        let lastPart = parts[parts.length - 1];
        const newlineIndex = lastPart.indexOf('\n');
        if (newlineIndex !== -1) {
          voiceScriptOnly = lastPart.substring(newlineIndex + 1).trim();
        } else {
          voiceScriptOnly = lastPart.replace(/^[^:]*:\s*/, '').trim();
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
        setSavedScriptModelImageUrl(res[0].url);
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
        setSavedScriptProductImageUrl(res[0].url);
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
        setSavedScriptBackgroundImageUrl(res[0].url);
      }
    } catch (err) {
      console.error("Failed to upload background image:", err);
      alert("Mouchkil f upload d tswira d l-background");
    } finally {
      setIsUploadingSavedBackground(false);
    }
  };

  const sendSavedScriptToWebhook = async () => {
    if (!webhookUrl || !scriptToSend) return;
    if (!user) return;
    const st = scriptToSend;

    setIsSendingWebhook(true);
    setWebhookStatus("idle");
    setGeneratedVideoUrl(null);
    setWebhookResponseText(null);
    setWebhookResponseData(null);
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
              await finalizeVideoHistory(historyId, null, null, url);
            } else {
              console.log("Webhook response JSON:", data);
              if (text.startsWith("http")) {
                setGeneratedVideoUrl(text);
                setWebhookResponseText(null);
                setWebhookResponseData(null);
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
                await finalizeVideoHistory(historyId, parsedData, text, null);
              }
            }
          } catch {
            const brokenData = parseBrokenWebhookResponse(text);
            if (brokenData) {
              setWebhookResponseData(brokenData);
              setWebhookResponseText(null);
              await finalizeVideoHistory(historyId, brokenData, text, null);
            } else {
              const cleanText = text.replace(/^["']|["']$/g, "").trim();
              if (cleanText.startsWith("http")) {
                setGeneratedVideoUrl(cleanText);
                setWebhookResponseText(null);
                setWebhookResponseData(null);
                await finalizeVideoHistory(historyId, null, null, cleanText);
              } else {
                console.log("Webhook raw response:", text);
                setWebhookResponseText(text);
                setWebhookResponseData(null);
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

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center space-y-6">
          <div className="bg-orange-500 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-orange-200">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Video Flow</h1>
          <p className="text-gray-500">Kteb scripts dial TikTok ads b-Darija derya o b-style dialk.</p>
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
            <label className="block text-sm font-medium text-gray-700">Password</label>
            <input
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none"
              autoComplete={authMode === "signup" ? "new-password" : "current-password"}
            />
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
          </div>
          {loginMessage && (
            <p className="text-sm text-green-600 bg-green-50 rounded-xl px-3 py-2">{loginMessage}</p>
          )}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-xl px-3 py-2">{error}</p>
          )}
          <button
            type="button"
            onClick={() => void handlePasswordAuth()}
            disabled={loginSending}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold flex items-center justify-center gap-3 hover:bg-gray-800 transition-all disabled:opacity-60"
          >
            {loginSending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <LogIn className="w-5 h-5" />
            )}
            {loginSending
              ? "Sandani..."
              : authMode === "signup"
                ? "Sijel"
                : "Dkhol"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans pb-20">
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
              <button onClick={() => setShowSettings(true)} className="p-2 text-gray-400 hover:text-gray-700 transition-colors" type="button" title="Settings">
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
            <button onClick={() => setShowSettings(true)} className="p-2 text-gray-400 hover:text-gray-700 transition-colors" type="button" title="Settings">
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
                <div className="py-20 text-center space-y-4 opacity-40">
                  <Package className="w-12 h-12 mx-auto" />
                  <p>Mazal ma ztti hta produit. Click 3la "Zid Produit" l-fou9.</p>
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
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Ch7al mn second bghiti f l-video?</label>
                    <select 
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                    >
                      <option value="0-15">9el mn 15 Thaniya (Khataf)</option>
                      <option value="15-20">15 - 20 Thaniya (Zerbana)</option>
                      <option value="20-30">20 - 30 Thaniya (Mzyana)</option>
                      <option value="30-40">30 - 40 Thaniya (Moutawassita)</option>
                      <option value="40-50">40 - 50 Thaniya (Mfassla)</option>
                      <option value="50-60">50 - 60 Thaniya (Chwya Twila)</option>
                      <option value="60+">Kter mn 60 Thaniya (Twila)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Ch7al mn machhad (Scenes)?</label>
                    <select 
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
                      value={sceneCount}
                      onChange={(e) => setSceneCount(e.target.value)}
                    >
                      <option value="auto">Auto (kol 8 t-tawani)</option>
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
                    onClick={generateScript}
                    disabled={isGenerating || !selectedProductId}
                    className="w-full py-3 bg-orange-500 text-white font-bold rounded-xl shadow-lg shadow-orange-100 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Sparkles className="w-4 h-4" /> Generi Script</>}
                  </button>
                </div>
              </div>
            </div>

            <div className="lg:col-span-7 min-h-0">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 h-full flex flex-col min-h-[280px] sm:min-h-[400px]">
                <div className="p-3 sm:p-4 border-b border-gray-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-lg font-semibold shrink-0">Natija</h2>
                  {generatedScript && (
                    <div className="flex flex-wrap items-center gap-2">
                      {webhookUrl && (
                        <button 
                          onClick={sendToWebhook}
                          disabled={isSendingWebhook || isUploadingModel || isUploadingProduct}
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
                      <button 
                        onClick={saveScript}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors flex items-center gap-2 text-sm text-gray-600"
                      >
                        <Save className="w-4 h-4" />
                        Sauvegarder
                      </button>
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
                          const fullTextToCopy = `${generatedScript}${scenesText}`;
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
                  {generatedScript ? (
                    <div>
                      <div className="space-y-3 pb-6 mb-6 border-b border-gray-100">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                          Tsawer l-Webhook (khtiyari) — zidhom men ba3d ma y-tgenera script
                        </p>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <label className="flex-1 min-w-0 cursor-pointer border border-dashed border-gray-200 rounded-xl p-3 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                            <input type="file" accept="image/*" className="hidden" onChange={handleModelImageUpload} disabled={isUploadingModel} />
                            {isUploadingModel ? <Loader2 className="w-4 h-4 text-orange-500 animate-spin shrink-0" /> : <Upload className="w-4 h-4 text-gray-400 shrink-0" />}
                            <span className="text-xs text-gray-500 truncate">{modelImageFile ? modelImageFile.name : "Model Ref"}</span>
                          </label>
                          {modelImageUrl && (
                            <div className="w-12 h-12 rounded-lg overflow-hidden border border-gray-200 shrink-0 mx-auto sm:mx-0">
                              <img src={modelImageUrl} alt="Model" className="w-full h-full object-cover" />
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <label className="flex-1 min-w-0 cursor-pointer border border-dashed border-gray-200 rounded-xl p-3 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                            <input type="file" accept="image/*" className="hidden" onChange={handleProductImageUpload} disabled={isUploadingProduct} />
                            {isUploadingProduct ? <Loader2 className="w-4 h-4 text-orange-500 animate-spin shrink-0" /> : <Upload className="w-4 h-4 text-gray-400 shrink-0" />}
                            <span className="text-xs text-gray-500 truncate">{productImageFile ? productImageFile.name : "Product Ref"}</span>
                          </label>
                          {productImageUrl && (
                            <div className="w-12 h-12 rounded-lg overflow-hidden border border-gray-200 shrink-0 mx-auto sm:mx-0">
                              <img src={productImageUrl} alt="Product" className="w-full h-full object-cover" />
                            </div>
                          )}
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <label className="flex-1 min-w-0 cursor-pointer border border-dashed border-gray-200 rounded-xl p-3 hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                            <input type="file" accept="image/*" className="hidden" onChange={handleBackgroundImageUpload} disabled={isUploadingBackground} />
                            {isUploadingBackground ? <Loader2 className="w-4 h-4 text-orange-500 animate-spin shrink-0" /> : <Upload className="w-4 h-4 text-gray-400 shrink-0" />}
                            <span className="text-xs text-gray-500 truncate">{backgroundImageFile ? backgroundImageFile.name : "Background Ref"}</span>
                          </label>
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
                            <h3 className="font-bold text-gray-800 text-lg sm:text-xl">Script</h3>
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
                    </div>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center text-gray-400 text-center">
                      <PenTool className="w-12 h-12 mb-2 opacity-20" />
                      <p>Khtar produit o click 3la "Generi Script" bach t-chouf natija hna.</p>
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
              <div className="w-full md:w-64 flex-shrink-0 space-y-4">
                <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2">
                  <History className="w-5 h-5 text-orange-500" />
                  Sijil (History)
                </h3>
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden shadow-sm">
                  <div className="max-h-[600px] overflow-y-auto">
                    {webhookHistory.map(item => (
                      <div
                        key={item.id}
                        className={cn(
                          "w-full text-left p-4 border-b border-gray-50 hover:bg-orange-50 transition-colors relative group",
                          selectedHistoryId === item.id ? "bg-orange-50 border-l-4 border-l-orange-500" : ""
                        )}
                      >
                        <button
                          className="w-full text-left"
                          onClick={() => {
                            setSelectedHistoryId(item.id);
                            if (item.videoUrl) {
                              setGeneratedVideoUrl(item.videoUrl);
                              setWebhookResponseData(null);
                              setWebhookResponseText(null);
                            } else if (item.data) {
                              setWebhookResponseData(item.data);
                              setWebhookResponseText(null);
                              setGeneratedVideoUrl(null);
                            } else if (item.rawText) {
                              setWebhookResponseText(item.rawText);
                              setWebhookResponseData(null);
                              setGeneratedVideoUrl(null);
                            }
                          }}
                        >
                          <div className="flex justify-between items-start mb-1">
                            <div className="text-sm font-bold text-gray-800 truncate pr-2 flex items-center gap-2">
                              {item.name || (item.productId ? products.find(p => p.id === item.productId)?.name || 'Produit' : 'Natija')}
                              {item.sentToWebhook && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 text-[10px] font-medium">
                                  <CheckCircle className="w-3 h-3" /> Siftnah
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-md border border-gray-200 shrink-0">
                              #{item.id.slice(-5)}
                            </span>
                          </div>
                          <div className="text-xs text-gray-500">
                            {new Date(item.timestamp).toLocaleString('fr-FR', {
                              day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
                            })}
                          </div>
                        </button>
                        
                        {/* Actions overlay */}
                        <div className="absolute right-2 bottom-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => renameHistoryItem(item.id, e)}
                            className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded-md transition-colors"
                            title="Bddel Smiya"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => deleteHistoryItem(item.id, e)}
                            className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                            title="Mse7"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Main Content */}
            <div className="flex-1 space-y-8">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                  <Video className="w-6 h-6 text-orange-500" />
                  Natija dial l-Video (Ad Video)
                  {selectedHistoryId && (
                    <span className="ml-2 text-sm font-mono bg-orange-100 text-orange-700 px-2.5 py-1 rounded-lg border border-orange-200">
                      #{selectedHistoryId.slice(-5)}
                    </span>
                  )}
                </h2>
              </div>

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
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={sendImagesToWebhook}
                          disabled={isSendingImages || !imagesWebhookUrl}
                          className="px-3 py-1.5 bg-orange-100 text-orange-700 hover:bg-orange-200 rounded-lg font-medium text-sm transition-colors flex items-center gap-2 disabled:opacity-50"
                          title="Sifet Tsawer l-Webhook"
                        >
                          {isSendingImages ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                          Sifet Tsawer
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
          <div className="w-full max-w-4xl mx-auto space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-orange-500" />
                Veo Prompts (Natija d Tsawer)
                {selectedHistoryId && (
                  <span className="ml-2 text-sm font-mono bg-orange-100 text-orange-700 px-2.5 py-1 rounded-lg border border-orange-200">
                    #{selectedHistoryId.slice(-5)}
                  </span>
                )}
              </h2>
            </div>
            
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {veoResponseData ? (
                <div className="p-6">
                  {(veoResponseData.scenes && Array.isArray(veoResponseData.scenes)) || Array.isArray(veoResponseData) ? (
                    <div className="space-y-8">
                      {(Array.isArray(veoResponseData) ? veoResponseData : veoResponseData.scenes).map((scene: any, idx: number) => {
                        // Extract prompts, handling different possible JSON structures
                        let prompts: string[] = [];
                        if (scene.veo_prompts && Array.isArray(scene.veo_prompts)) {
                          prompts = scene.veo_prompts;
                        } else if (scene.prompts && Array.isArray(scene.prompts)) {
                          prompts = scene.prompts;
                        } else {
                          // Try to find any string values that look like prompts
                          Object.keys(scene).forEach(key => {
                            if (key.toLowerCase().includes('prompt') && typeof scene[key] === 'string') {
                              prompts.push(scene[key]);
                            }
                          });
                        }

                        return (
                          <div key={idx} className="bg-gray-50 rounded-xl p-6 border border-gray-200">
                            <h3 className="font-bold text-lg text-gray-800 mb-4 border-b border-gray-200 pb-2">
                              Scene {scene.sceneNumber || scene.scene_number || (idx + 1)}
                            </h3>
                            
                            {prompts.length > 0 ? (
                              <div className="space-y-4">
                                {prompts.map((prompt: string, pIdx: number) => (
                                  <div key={pIdx} className="bg-white p-4 rounded-lg border border-gray-100 shadow-sm relative group">
                                    <div className="flex justify-between items-start gap-4">
                                      <div className="flex-1">
                                        <span className="text-xs font-bold text-orange-500 uppercase tracking-wider mb-1 block">Veo Prompt {pIdx + 1}</span>
                                        <p className="text-gray-700 text-sm">{prompt}</p>
                                      </div>
                                      <button 
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
                        );
                      })}
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
                  <p>Mazal mawslat hta natija mn l-webhook dyal tsawer.</p>
                  <p className="text-sm mt-2">Sifet tsawer mn l-onglet "Video" bach tchouf natija hna.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
      {/* Missing Images Dialog Modal */}
      {missingImagesDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full space-y-4">
            <h3 className="text-xl font-bold text-gray-900">Tsawer Na9sin</h3>
            <p className="text-gray-600">Khassek t-uploadi had tsawer 9bel ma tsifet l-webhook:</p>
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
            </div>
            <div className="flex gap-3 justify-end mt-6">
              <button 
                onClick={() => {
                  setIsAddProductModalOpen(false);
                  setNewProductName('');
                  setNewProductDesc('');
                }}
                className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-xl font-medium transition-colors"
              >
                Lghi
              </button>
              <button 
                onClick={() => {
                  if (newProductName.trim()) {
                    addProduct(newProductName.trim(), newProductDesc.trim());
                    setIsAddProductModalOpen(false);
                    setNewProductName('');
                    setNewProductDesc('');
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
                <div className="flex items-center gap-4">
                  <label className="flex-1 cursor-pointer border-2 border-dashed border-gray-200 rounded-xl p-4 hover:bg-gray-50 transition-colors flex flex-col items-center justify-center gap-2">
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
                    <span className="text-sm text-gray-500">
                      {savedScriptModelImageFile ? savedScriptModelImageFile.name : 'Zid tswira d l-model'}
                    </span>
                  </label>
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
                <div className="flex items-center gap-4">
                  <label className="flex-1 cursor-pointer border-2 border-dashed border-gray-200 rounded-xl p-4 hover:bg-gray-50 transition-colors flex flex-col items-center justify-center gap-2">
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
                    <span className="text-sm text-gray-500">
                      {savedScriptProductImageFile ? savedScriptProductImageFile.name : 'Zid tswira d l-produit'}
                    </span>
                  </label>
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
                <div className="flex items-center gap-4">
                  <label className="flex-1 cursor-pointer border-2 border-dashed border-gray-200 rounded-xl p-4 hover:bg-gray-50 transition-colors flex flex-col items-center justify-center gap-2">
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
                    <span className="text-sm text-gray-500">
                      {savedScriptBackgroundImageFile ? savedScriptBackgroundImageFile.name : 'Zid tswira d l-background'}
                    </span>
                  </label>
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
                disabled={!webhookUrl || isUploadingSavedModel || isUploadingSavedProduct}
                className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-xl font-medium hover:bg-orange-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                Sifet
              </button>
            </div>
            {!webhookUrl && (
              <p className="text-xs text-red-500 text-center">
                Khassk t-zid l-webhook URL f l-i3dadat (Settings) 9bel ma tsifet.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full space-y-4">
            <h3 className="text-xl font-bold flex items-center gap-2">
              <Settings className="w-5 h-5 text-gray-500" />
              Settings (I3dadat)
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL (Make.com)</label>
                <input 
                  type="url" 
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
                  value={webhookUrl}
                  onChange={e => setWebhookUrl(e.target.value)}
                  placeholder="https://hook.eu1.make.com/..."
                />
                <p className="text-xs text-gray-500 mt-2">
                  Had l-URL ghadi n-sifto lih l-script mnin y-tgenera (POST request).
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Images Webhook URL (Make.com)</label>
                <input 
                  type="url" 
                  className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none"
                  value={imagesWebhookUrl}
                  onChange={e => setImagesWebhookUrl(e.target.value)}
                  placeholder="https://hook.eu1.make.com/..."
                />
                <p className="text-xs text-gray-500 mt-2">
                  Had l-URL ghadi n-sifto lih tsawer dyal kol scene m3a script (POST request).
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
              <button 
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded-xl font-medium transition-colors"
              >
                Lghi
              </button>
              <button 
                onClick={() => {
                  localStorage.setItem('makeWebhookUrl', webhookUrl.trim());
                  localStorage.setItem('imagesWebhookUrl', imagesWebhookUrl.trim());
                  setShowSettings(false);
                  alert('Settings m-sauvegarder b-naja7!');
                }}
                className="px-4 py-2 bg-orange-500 text-white rounded-xl font-medium hover:bg-orange-600 transition-colors"
              >
                Sauvegarder
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
