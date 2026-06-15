import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Cloud,
  Copy,
  Download,
  Loader2,
  Sparkles,
  Upload,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import JSZip from "jszip";
import { buildCloneDebutFinPrompts, buildCloneFullScript, CLONE_VEO_SCENE_SECONDS } from "./utils/buildCloneFullScript";
import { postAiJson } from "./utils/postAiJson";
import { prepareVisionImageUrl } from "./utils/prepareVisionImageUrl";
import { isAiUsagePayload, setUsagePersistContext, type AiUsagePayload } from "./utils/aiUsage";
import { AiUsageCostChip, AiUsageTodayBadge } from "./components/AiUsagePanel";
import {
  createCloneProject,
  updateCloneProject,
  type CloneProjectData,
  type StoredCloneScene,
} from "./utils/cloneProjectDb";
import {
  autoSceneBoundaries,
  downloadDataUrl,
  extractVideoFrames,
  scenesFromBoundaries,
  type ExtractedFrame,
  type FrameExtractMode,
} from "./utils/videoFrames";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type WizardStep = 1 | 2 | 3 | 4;

type CloneScene = {
  sceneNumber: number;
  debut: ExtractedFrame;
  fin: ExtractedFrame;
  debutUrl?: string;
  finUrl?: string;
  analysis?: string;
  scenePackage?: Record<string, unknown>;
  veoPrompt?: string;
  negativePrompt?: string;
  parseError?: string;
  rawPackageText?: string;
  usageAnalyze?: AiUsagePayload;
  usagePrompt?: AiUsagePayload;
  analyzeStatus: "idle" | "loading" | "done" | "error";
  promptStatus: "idle" | "loading" | "done" | "error";
  error?: string;
};

type Props = {
  onBack: () => void;
  userId: string;
  onOpenUsage?: () => void;
};

const STEP_LABELS = ["Split video", "Scenes", "Analyze", "Veo prompts"] as const;

function buildStoredScenes(scenes: CloneScene[]): StoredCloneScene[] {
  return scenes.map((s) => ({
    sceneNumber: s.sceneNumber,
    debutIndex: s.debut.index,
    finIndex: s.fin.index,
    debutTimeSec: s.debut.timeSec,
    finTimeSec: s.fin.timeSec,
    debutUrl: s.debutUrl,
    finUrl: s.finUrl,
    analysis: s.analysis,
    scenePackage: s.scenePackage,
    veoPrompt: s.veoPrompt,
    negativePrompt: s.negativePrompt,
    parseError: s.parseError,
    rawPackageText: s.rawPackageText,
    usageAnalyze: s.usageAnalyze,
    usagePrompt: s.usagePrompt,
    analyzeStatus: s.analyzeStatus,
    promptStatus: s.promptStatus,
    error: s.error,
  }));
}

function projectStatus(step: WizardStep, scenes: CloneScene[]): string {
  if (scenes.some((s) => s.promptStatus === "done")) return "complete";
  if (scenes.some((s) => s.analyzeStatus === "done")) return "analyzed";
  return step >= 2 ? "scenes" : "draft";
}

export default function CloneVideoWorkspace({ onBack, userId, onOpenUsage }: Props) {
  const [step, setStep] = useState<WizardStep>(1);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [extractMode, setExtractMode] = useState<FrameExtractMode>("count");
  const [frameCount, setFrameCount] = useState("24");
  const [intervalSec, setIntervalSec] = useState("1");
  const [sceneCount, setSceneCount] = useState("6");
  const [boundaryIndices, setBoundaryIndices] = useState<number[]>([]);
  const [scenes, setScenes] = useState<CloneScene[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    setUsagePersistContext(
      projectId
        ? { userId, projectType: "clone", projectId }
        : { userId, projectType: "clone" }
    );
    return () => setUsagePersistContext(userId ? { userId } : null);
  }, [userId, projectId]);

  const persistProject = useCallback(
    async (opts: { step: WizardStep; scenesOverride?: CloneScene[] }) => {
      if (!userId || !videoFile) return;
      setSaveStatus("saving");
      const scenesForSave = opts.scenesOverride ?? scenes;
      const data: CloneProjectData = {
        extractMode,
        frameCount,
        intervalSec,
        sceneCount,
        boundaryIndices,
        frameMeta: frames.map((f) => ({ id: f.id, index: f.index, timeSec: f.timeSec })),
        scenes: buildStoredScenes(scenesForSave),
      };
      const status = projectStatus(opts.step, scenesForSave);
      try {
        if (projectId) {
          await updateCloneProject(projectId, userId, {
            step: opts.step,
            durationSec: duration,
            status,
            data,
          });
        } else {
          const created = await createCloneProject(userId, {
            name: videoFile.name.replace(/\.[^.]+$/, "") || "Clone project",
            sourceVideoName: videoFile.name,
            durationSec: duration,
            step: opts.step,
            status,
            data,
          });
          setProjectId(created.id);
        }
        setSaveStatus("saved");
        window.setTimeout(() => setSaveStatus("idle"), 2000);
      } catch (e) {
        console.error("clone project save", e);
        setSaveStatus("error");
      }
    },
    [
      userId,
      videoFile,
      scenes,
      extractMode,
      frameCount,
      intervalSec,
      sceneCount,
      boundaryIndices,
      frames,
      duration,
      projectId,
    ]
  );

  const showCopyToast = useCallback((msg: string) => {
    setCopyToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setCopyToast(null);
      toastTimer.current = null;
    }, 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [videoPreviewUrl]);

  const scenePairs = useMemo(
    () => scenesFromBoundaries(frames, boundaryIndices),
    [frames, boundaryIndices]
  );

  const handleVideoPick = (file: File | null) => {
    if (!file) return;
    setVideoFile(file);
    setFrames([]);
    setBoundaryIndices([]);
    setScenes([]);
    setProjectId(null);
    setStep(1);
    setError(null);
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(URL.createObjectURL(file));
  };

  const runExtract = async () => {
    if (!videoFile) {
      setError("3afak uploadi video lwl.");
      return;
    }
    setIsExtracting(true);
    setError(null);
    try {
      const result = await extractVideoFrames(videoFile, {
        mode: extractMode,
        frameCount: parseInt(frameCount, 10) || 24,
        intervalSec: parseFloat(intervalSec) || 1,
      });
      setDuration(result.duration);
      setFrames(result.frames);
      const sc = Math.min(10, Math.max(2, parseInt(sceneCount, 10) || 6));
      const bounds = autoSceneBoundaries(result.frames.length, sc);
      setBoundaryIndices(bounds);
      void persistProject({ step: 1 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mouchkil f-extract frames.");
    } finally {
      setIsExtracting(false);
    }
  };

  const applyAutoBoundaries = () => {
    const sc = Math.min(10, Math.max(2, parseInt(sceneCount, 10) || 6));
    setBoundaryIndices(autoSceneBoundaries(frames.length, sc));
  };

  const toggleBoundary = (index: number) => {
    setBoundaryIndices((prev) => {
      const has = prev.includes(index);
      let next = has ? prev.filter((i) => i !== index) : [...prev, index];
      next = [...new Set(next)].sort((a, b) => a - b);
      if (next.length < 2) return prev;
      return next;
    });
  };

  const downloadAllFramesZip = async () => {
    if (frames.length === 0) return;
    setIsZipping(true);
    try {
      const zip = new JSZip();
      frames.forEach((f) => {
        const base64 = f.dataUrl.split(",")[1] ?? "";
        zip.file(`frame-${String(f.index + 1).padStart(3, "0")}-${f.timeSec.toFixed(2)}s.jpg`, base64, {
          base64: true,
        });
      });
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "clone-video-frames.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ZIP failed");
    } finally {
      setIsZipping(false);
    }
  };

  const goToScenes = () => {
    if (frames.length < 2) {
      setError("Khass 2 frames au moins. Extract frames lwl.");
      return;
    }
    applyAutoBoundaries();
    setError(null);
    setStep(2);
  };

  const confirmScenes = () => {
    if (scenePairs.length === 0) {
      setError("Khass 2 boundaries au moins bach tkon scene wa7da.");
      return;
    }
    const newScenes = scenePairs.map((p) => ({
      sceneNumber: p.sceneNumber,
      debut: p.debut,
      fin: p.fin,
      analyzeStatus: "idle" as const,
      promptStatus: "idle" as const,
    }));
    setScenes(newScenes);
    setError(null);
    setStep(3);
    void persistProject({ step: 3, scenesOverride: newScenes });
  };

  const runAnalyzeAll = async () => {
    if (scenes.length === 0) return;
    setIsAnalyzing(true);
    setError(null);
    const next = [...scenes];
    for (let i = 0; i < next.length; i++) {
      const s = next[i];
      next[i] = { ...s, analyzeStatus: "loading", error: undefined };
      setScenes([...next]);
      try {
        const { debutPrompt, finPrompt } = buildCloneDebutFinPrompts({
          sceneNumber: s.sceneNumber,
          debut: s.debut,
          fin: s.fin,
        });
        const [debutImageUrl, finImageUrl] = await Promise.all([
          prepareVisionImageUrl(s.debut.dataUrl, `scene-${s.sceneNumber}-debut.jpg`),
          prepareVisionImageUrl(s.fin.dataUrl, `scene-${s.sceneNumber}-fin.jpg`),
        ]);
        const json = await postAiJson(
          "/api/ai/veo-scene-analyze",
          {
            debutImageUrl,
            finImageUrl,
            debutPrompt,
            finPrompt,
            workflowMode: "clone",
            sceneNumber: s.sceneNumber,
            referenceDebutSec: s.debut.timeSec,
            referenceFinSec: s.fin.timeSec,
            veoOutputDurationSec: CLONE_VEO_SCENE_SECONDS,
          },
          180_000,
          `Clone analyze — Scene ${s.sceneNumber}`
        );
        next[i] = {
          ...next[i],
          debutUrl: debutImageUrl.startsWith("https://") ? debutImageUrl : undefined,
          finUrl: finImageUrl.startsWith("https://") ? finImageUrl : undefined,
          analysis: typeof json.analysis === "string" ? json.analysis.trim() : "",
          usageAnalyze: isAiUsagePayload(json.usage) ? json.usage : undefined,
          analyzeStatus: "done",
        };
      } catch (e) {
        next[i] = {
          ...next[i],
          analyzeStatus: "error",
          error: e instanceof Error ? e.message : "Analyze failed",
        };
      }
      setScenes([...next]);
    }
    setIsAnalyzing(false);
    if (next.every((s) => s.analyzeStatus === "done")) {
      setStep(4);
      void persistProject({ step: 4, scenesOverride: next });
    } else {
      void persistProject({ step: 3, scenesOverride: next });
    }
  };

  const runGeneratePrompts = async () => {
    if (scenes.length === 0) return;
    setIsGenerating(true);
    setGenerateProgress(null);
    setError(null);

    const refDuration =
      duration > 0 ? duration : (scenes[scenes.length - 1]?.fin.timeSec ?? 0);
    const fullScript = buildCloneFullScript(
      scenes.map((s) => ({
        sceneNumber: s.sceneNumber,
        debut: s.debut,
        fin: s.fin,
        analysis: s.analysis,
      })),
      refDuration
    );

    const next = [...scenes];
    for (let i = 0; i < next.length; i++) {
      const s = next[i];
      if (!s.analysis?.trim()) continue;
      next[i] = { ...s, promptStatus: "loading", error: undefined };
      setScenes([...next]);
      setGenerateProgress(`Scene ${s.sceneNumber} / ${next.length} — VEO JSON...`);
      try {
        const data = await postAiJson(
          "/api/ai/veo-scene-package",
          {
            fullScript,
            sceneNumber: s.sceneNumber,
            imageAnalysis: s.analysis,
            languageLabel: "Moroccan Darija",
            workflowMode: "clone",
          },
          180_000,
          `Clone Veo package — Scene ${s.sceneNumber}`
        );

        if (data.scenePackage != null) {
          const pkg = data.scenePackage as Record<string, unknown>;
          next[i] = {
            ...next[i],
            scenePackage: pkg,
            veoPrompt: typeof pkg.veoPrompt === "string" ? pkg.veoPrompt : "",
            negativePrompt:
              typeof pkg.negativePrompt === "string" ? pkg.negativePrompt : "",
            usagePrompt: isAiUsagePayload(data.usage) ? data.usage : undefined,
            promptStatus: "done",
          };
        } else {
          next[i] = {
            ...next[i],
            scenePackage: undefined,
            veoPrompt: "",
            negativePrompt: "",
            parseError:
              typeof data.parseError === "string" ? data.parseError : "JSON parse failed",
            rawPackageText:
              typeof data.rawPackageText === "string" ? data.rawPackageText : "",
            promptStatus: "error",
          };
        }
      } catch (e) {
        next[i] = {
          ...next[i],
          promptStatus: "error",
          error: e instanceof Error ? e.message : "Prompt failed",
        };
      }
      setScenes([...next]);
    }
    setIsGenerating(false);
    setGenerateProgress(null);
    void persistProject({ step: 4, scenesOverride: next });
  };

  const downloadScenePairZip = async (scene: CloneScene) => {
    const zip = new JSZip();
    const add = (dataUrl: string, label: string) => {
      const base64 = dataUrl.split(",")[1] ?? "";
      zip.file(label, base64, { base64: true });
    };
    add(scene.debut.dataUrl, `scene-${scene.sceneNumber}-debut.jpg`);
    add(scene.fin.dataUrl, `scene-${scene.sceneNumber}-fin.jpg`);
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `scene-${scene.sceneNumber}-debut-fin.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans pb-24">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100"
            title="Accueil"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="bg-violet-600 p-1.5 rounded-lg">
            <Clapperboard className="w-5 h-5 text-white" />
          </div>
          <h1 className="font-bold text-lg">Clone Video</h1>
          <AiUsageTodayBadge userId={userId} />
          {saveStatus === "saving" ? (
            <span className="text-[10px] text-violet-600 flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" /> Saving…
            </span>
          ) : saveStatus === "saved" ? (
            <span className="text-[10px] text-green-700 flex items-center gap-1">
              <Cloud className="w-3 h-3" /> Saved
            </span>
          ) : saveStatus === "error" ? (
            <span className="text-[10px] text-red-600">Save failed</span>
          ) : null}
          {onOpenUsage ? (
            <button
              type="button"
              onClick={onOpenUsage}
              className="text-[11px] font-medium text-emerald-700 hover:underline ml-auto sm:ml-0"
            >
              Usage →
            </button>
          ) : null}
        </div>
        <div className="max-w-5xl mx-auto px-4 pb-3 flex flex-wrap gap-2">
          {STEP_LABELS.map((label, i) => {
            const n = (i + 1) as WizardStep;
            const active = step === n;
            const done = step > n;
            return (
              <div
                key={label}
                className={cn(
                  "flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border",
                  active
                    ? "bg-violet-600 text-white border-violet-600"
                    : done
                      ? "bg-violet-50 text-violet-800 border-violet-200"
                      : "bg-gray-50 text-gray-500 border-gray-200"
                )}
              >
                <span>{n}</span>
                <span>{label}</span>
                {i < STEP_LABELS.length - 1 ? (
                  <ChevronRight className="w-3 h-3 opacity-40 hidden sm:block" />
                ) : null}
              </div>
            );
          })}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {error ? (
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-600 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : null}

        {step === 1 && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <h2 className="text-lg font-semibold">1 — Upload & split frames</h2>
              <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-2xl p-8 cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleVideoPick(f);
                    e.target.value = "";
                  }}
                />
                <Upload className="w-8 h-8 text-violet-500" />
                <span className="text-sm font-medium text-gray-700">
                  {videoFile ? videoFile.name : "Zid video bach t-cloni"}
                </span>
              </label>
              {videoPreviewUrl ? (
                <video src={videoPreviewUrl} controls className="w-full max-h-64 rounded-xl bg-black" />
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Mode split
                  </label>
                  <select
                    className="mt-1 w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl"
                    value={extractMode}
                    onChange={(e) => setExtractMode(e.target.value as FrameExtractMode)}
                  >
                    <option value="count">Nombre de frames (même espacement)</option>
                    <option value="interval">Chaque X secondes</option>
                  </select>
                </div>
                {extractMode === "count" ? (
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Frames (2–120)
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={120}
                      className="mt-1 w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl"
                      value={frameCount}
                      onChange={(e) => setFrameCount(e.target.value)}
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      Interval (sec)
                    </label>
                    <input
                      type="number"
                      min={0.25}
                      step={0.25}
                      className="mt-1 w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl"
                      value={intervalSec}
                      onChange={(e) => setIntervalSec(e.target.value)}
                    />
                  </div>
                )}
                <div>
                  <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Scenes visées (2–10)
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={10}
                    className="mt-1 w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl"
                    value={sceneCount}
                    onChange={(e) => setSceneCount(e.target.value)}
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Step 2: boundaries auto — ila 3ndk bzaf frames, n-grouperiw l-8 scenes max.
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={!videoFile || isExtracting}
                onClick={() => void runExtract()}
                className="w-full py-3 bg-violet-600 text-white font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isExtracting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Extract frames
              </button>
              {duration > 0 ? (
                <p className="text-xs text-gray-500 text-center">Duration: {duration.toFixed(2)}s</p>
              ) : null}
            </div>

            {frames.length > 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold">{frames.length} frames</h3>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={isZipping}
                      onClick={() => void downloadAllFramesZip()}
                      className="text-sm px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium flex items-center gap-1.5 disabled:opacity-50"
                    >
                      {isZipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                      ZIP kolchi
                    </button>
                    <button
                      type="button"
                      onClick={goToScenes}
                      className="text-sm px-4 py-2 bg-violet-600 text-white rounded-lg font-semibold"
                    >
                      Suivant: Scenes →
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 max-h-[480px] overflow-y-auto">
                  {frames.map((f) => (
                    <div key={f.id} className="rounded-xl border border-gray-100 overflow-hidden bg-gray-50">
                      <img src={f.dataUrl} alt="" className="w-full aspect-[9/16] object-cover" />
                      <div className="p-2 flex items-center justify-between gap-1">
                        <span className="text-[10px] text-gray-600 font-mono">#{f.index + 1}</span>
                        <span className="text-[10px] text-gray-500">{f.timeSec.toFixed(2)}s</span>
                        <button
                          type="button"
                          title="Download"
                          onClick={() =>
                            downloadDataUrl(f.dataUrl, `frame-${f.index + 1}-${f.timeSec.toFixed(2)}s.jpg`)
                          }
                          className="p-1 text-gray-400 hover:text-violet-600"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {step === 2 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold">2 — Définir les scenes (debut → fin)</h2>
            <p className="text-sm text-gray-600">
              Scene 1: frame A → B, Scene 2: B → C, … Click 3la frame bach t-zid/7yed boundary. Auto
              men nombre dial scenes.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={applyAutoBoundaries}
                className="text-sm px-3 py-2 bg-violet-50 text-violet-800 border border-violet-200 rounded-lg font-medium"
              >
                Auto {sceneCount} scenes
              </button>
              <span className="text-xs text-gray-500 self-center">
                {boundaryIndices.length} boundaries → {scenePairs.length} scene(s)
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {frames.map((f) => {
                const isBoundary = boundaryIndices.includes(f.index);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleBoundary(f.index)}
                    className={cn(
                      "shrink-0 w-20 rounded-xl border-2 overflow-hidden transition-all",
                      isBoundary ? "border-violet-600 ring-2 ring-violet-200" : "border-gray-200 opacity-80"
                    )}
                  >
                    <img src={f.dataUrl} alt="" className="w-full aspect-[9/16] object-cover" />
                    <div className="text-[10px] py-1 bg-white font-mono">{f.index + 1}</div>
                  </button>
                );
              })}
            </div>
            {scenePairs.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {scenePairs.map((p) => (
                  <li
                    key={p.sceneNumber}
                    className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-100"
                  >
                    <span className="font-bold text-violet-700">Scene {p.sceneNumber}</span>
                    <span className="text-gray-500">
                      #{p.debut.index + 1} ({p.debut.timeSec.toFixed(2)}s) → #{p.fin.index + 1} (
                      {p.fin.timeSec.toFixed(2)}s)
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <button
              type="button"
              disabled={scenePairs.length === 0}
              onClick={confirmScenes}
              className="w-full py-3 bg-violet-600 text-white font-bold rounded-xl disabled:opacity-50"
            >
              Suivant: Analyze →
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold">3 — Analyze chno tbeddel (debut → fin)</h2>
            <p className="text-sm text-gray-600">
              Vision y-3tik <strong>chno tbdl</strong> w <strong>TIMED ACTION SPLIT</strong> — kol
              change f wa9t logic (0–8s), machi kolchi f nafs l-instant.
            </p>
            <button
              type="button"
              disabled={isAnalyzing || scenes.length === 0}
              onClick={() => void runAnalyzeAll()}
              className="w-full py-3 bg-violet-600 text-white font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Analyze {scenes.length} scene(s)
            </button>
            <div className="space-y-4">
              {scenes.map((s) => (
                <div key={s.sceneNumber} className="border border-gray-100 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-bold">Scene {s.sceneNumber}</span>
                    <div className="flex items-center gap-2">
                      {s.usageAnalyze ? <AiUsageCostChip usage={s.usageAnalyze} /> : null}
                      {s.analyzeStatus === "loading" ? (
                      <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
                    ) : s.analyzeStatus === "done" ? (
                      <Check className="w-4 h-4 text-green-600" />
                    ) : s.analyzeStatus === "error" ? (
                      <AlertCircle className="w-4 h-4 text-red-500" />
                    ) : null}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <img src={s.debut.dataUrl} alt="" className="w-16 aspect-[9/16] object-cover rounded-lg" />
                    <img src={s.fin.dataUrl} alt="" className="w-16 aspect-[9/16] object-cover rounded-lg" />
                  </div>
                  {s.analysis ? (
                    <details className="text-sm rounded-lg border border-violet-100 bg-violet-50/30 group" open>
                      <summary className="cursor-pointer list-none px-3 py-2 font-medium text-violet-900 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                        <ChevronDown className="w-4 h-4 shrink-0 text-violet-500 transition-transform group-open:rotate-180" />
                        Changes + timed beats ({s.debut.timeSec.toFixed(1)}s → {s.fin.timeSec.toFixed(1)}s
                        ref)
                      </summary>
                      <pre className="mt-0 text-xs text-gray-700 whitespace-pre-wrap bg-white/80 p-3 border-t border-violet-100 max-h-72 overflow-y-auto">
                        {s.analysis}
                      </pre>
                    </details>
                  ) : null}
                  {s.error ? <p className="text-xs text-red-600">{s.error}</p> : null}
                </div>
              ))}
            </div>
            {scenes.every((s) => s.analyzeStatus === "done") ? (
              <button
                type="button"
                onClick={() => setStep(4)}
                className="w-full py-3 bg-gray-900 text-white font-bold rounded-xl"
              >
                Suivant: Veo prompts →
              </button>
            ) : null}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <h2 className="text-lg font-semibold">4 — Veo prompts & download</h2>
              <button
                type="button"
                disabled={isGenerating}
                onClick={() => void runGeneratePrompts()}
                className="w-full py-3 bg-violet-600 text-white font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Generi Veo prompts
              </button>
              {generateProgress ? (
                <p className="text-xs text-violet-800 text-center">{generateProgress}</p>
              ) : null}
              <p className="text-[11px] text-gray-500 text-center leading-snug">
                Nafs rich package dial Video Flow: full script + SCENE METADATA + clone mode (400–700+ mots
                veoPrompt).
              </p>
            </div>
            {scenes.map((s) => {
              const displayPkg: Record<string, unknown> = {
                ...(s.scenePackage ?? {}),
                sceneNumber: s.sceneNumber,
                _imageAnalysis: s.analysis ?? "",
              };
              const hasVeo31 =
                typeof s.veoPrompt === "string" && s.veoPrompt.trim().length > 0;

              return (
              <div key={s.sceneNumber} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-bold text-lg">Scene {s.sceneNumber}</h3>
                  <div className="flex flex-wrap items-center gap-2">
                    {s.usageAnalyze ? <AiUsageCostChip usage={s.usageAnalyze} /> : null}
                    {s.usagePrompt ? <AiUsageCostChip usage={s.usagePrompt} /> : null}
                    <button
                    type="button"
                    onClick={() => void downloadScenePairZip(s)}
                    className="text-sm px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium flex items-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    ZIP debut + fin
                  </button>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="text-center">
                    <img src={s.debut.dataUrl} alt="" className="w-24 aspect-[9/16] object-cover rounded-lg border" />
                    <button
                      type="button"
                      className="text-xs text-violet-600 mt-1"
                      onClick={() =>
                        downloadDataUrl(s.debut.dataUrl, `scene-${s.sceneNumber}-debut.jpg`)
                      }
                    >
                      Download debut
                    </button>
                  </div>
                  <div className="text-center">
                    <img src={s.fin.dataUrl} alt="" className="w-24 aspect-[9/16] object-cover rounded-lg border" />
                    <button
                      type="button"
                      className="text-xs text-violet-600 mt-1"
                      onClick={() => downloadDataUrl(s.fin.dataUrl, `scene-${s.sceneNumber}-fin.jpg`)}
                    >
                      Download fin
                    </button>
                  </div>
                </div>
                {s.parseError ? (
                  <div className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-3">
                    JSON ma-t9rach: {s.parseError}
                    {s.rawPackageText ? (
                      <pre className="mt-2 text-xs whitespace-pre-wrap max-h-48 overflow-auto">
                        {s.rawPackageText}
                      </pre>
                    ) : null}
                  </div>
                ) : null}

                {s.analysis?.trim() ? (
                  <details className="text-sm rounded-lg border border-gray-100 bg-white group">
                    <summary className="cursor-pointer list-none px-3 py-2 font-medium text-gray-600 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                      <ChevronDown className="w-4 h-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
                      Changes A → B (vision)
                    </summary>
                    <pre className="mt-0 text-xs text-gray-700 whitespace-pre-wrap bg-gray-50/80 p-3 border-t border-gray-100 max-h-56 overflow-auto">
                      {s.analysis}
                    </pre>
                  </details>
                ) : null}

                {hasVeo31 ? (
                  <div className="space-y-3">
                    <div className="flex gap-1.5 items-stretch">
                      <details className="flex-1 min-w-0 text-sm rounded-lg border border-gray-100 bg-white shadow-sm group" open>
                        <summary className="cursor-pointer list-none px-3 py-2.5 font-medium text-gray-700 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                          <ChevronDown className="w-4 h-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
                          <span className="text-xs font-bold text-orange-500 uppercase tracking-wider">
                            veoPrompt
                          </span>
                          <span className="text-[10px] font-normal text-gray-500 normal-case">
                            · {s.veoPrompt?.trim().split(/\s+/).length ?? 0} mots
                          </span>
                        </summary>
                        <div className="px-3 pb-3 border-t border-gray-50">
                          <p className="text-gray-700 text-sm whitespace-pre-wrap pt-2">{s.veoPrompt}</p>
                        </div>
                      </details>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(String(s.veoPrompt)).then(
                            () => showCopyToast("T-copia veoPrompt!"),
                            () => showCopyToast("Ma-t9rachch l-copie.")
                          );
                        }}
                        className="shrink-0 self-start p-2.5 mt-0.5 text-gray-400 hover:text-orange-500 rounded-lg hover:bg-orange-50 border border-transparent hover:border-orange-100"
                        title="Copi veoPrompt"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                    {typeof s.negativePrompt === "string" && s.negativePrompt.trim() ? (
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
                              {s.negativePrompt}
                            </p>
                          </div>
                        </details>
                        <button
                          type="button"
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(String(s.negativePrompt))
                              .then(
                                () => showCopyToast("T-copia negativePrompt!"),
                                () => showCopyToast("Ma-t9rachch l-copie.")
                              );
                          }}
                          className="shrink-0 self-start p-2.5 mt-0.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 border border-transparent hover:border-gray-200"
                          title="Copi negativePrompt"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    ) : null}
                    <div className="flex gap-1.5 items-stretch">
                      <details className="flex-1 min-w-0 text-sm rounded-lg border border-gray-100 bg-white group">
                        <summary className="cursor-pointer list-none px-3 py-2.5 font-medium text-gray-600 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                          <ChevronDown className="w-4 h-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" />
                          Full JSON
                        </summary>
                        <pre className="mt-0 text-xs bg-gray-50/80 p-3 border-t border-gray-100 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap font-mono">
                          {JSON.stringify(displayPkg, null, 2)}
                        </pre>
                      </details>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(JSON.stringify(displayPkg, null, 2))
                            .then(
                              () => showCopyToast("T-copia Full JSON!"),
                              () => showCopyToast("Ma-t9rachch l-copie.")
                            );
                        }}
                        className="shrink-0 self-start p-2.5 mt-0.5 text-gray-400 hover:text-orange-500 rounded-lg hover:bg-orange-50 border border-transparent hover:border-orange-100"
                        title="Copi Full JSON"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : s.promptStatus === "loading" ? (
                  <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
                ) : s.promptStatus === "error" && s.error ? (
                  <p className="text-xs text-red-600">{s.error}</p>
                ) : null}
              </div>
              );
            })}
          </div>
        )}
      </main>

      {copyToast ? (
        <div
          className="fixed bottom-6 left-1/2 z-[60] flex max-w-[min(90vw,22rem)] -translate-x-1/2 items-center gap-2 rounded-2xl border border-green-200 bg-white px-4 py-3 text-sm font-medium text-green-900 shadow-lg"
          role="status"
        >
          <Check className="h-5 w-5 shrink-0 text-green-600" />
          <span>{copyToast}</span>
        </div>
      ) : null}
    </div>
  );
}
