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
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import JSZip from "jszip";
import { buildCloneFullScript, CLONE_LANGUAGE_LABEL, CLONE_VEO_SCENE_SECONDS } from "./utils/buildCloneFullScript";
import { postAiJson } from "./utils/postAiJson";
import { buildCloneAnalyzeRequest } from "./utils/cloneAnalyzePayload";
import { isAiUsagePayload, setUsagePersistContext, type AiUsagePayload } from "./utils/aiUsage";
import { AiUsageCostChip, AiUsageTodayBadge } from "./components/AiUsagePanel";
import {
  FlowExtensionBar,
  FlowExtensionSceneButton,
  toFlowSceneExport,
} from "./components/FlowExtensionBar";
import {
  createCloneProject,
  fetchCloneProject,
  listCloneProjects,
  updateCloneProject,
  type CloneProject,
  type CloneProjectData,
  type StoredCloneScene,
  type StoredFrameMeta,
} from "./utils/cloneProjectDb";
import {
  autoSceneBoundaries,
  clampCloneSceneCount,
  downloadDataUrl,
  extractVideoFrames,
  MAX_CLONE_SCENES,
  MIN_CLONE_SCENES,
  scenesFromBoundaries,
  getSceneFrames,
  type ExtractedFrame,
  type FrameExtractMode,
} from "./utils/videoFrames";
import {
  fetchVisionLockStatus,
  releaseVisionAnalyzeLock,
  visionLockWaitMessage,
  type VisionLockStatus,
} from "./utils/visionLock";
import { CLONE_AI_CONCURRENCY, CLONE_AI_MIN_DELAY_MS, CLONE_ANALYZE_DELAY_MS, markAnalyzeFinished, runWithConcurrency, waitBeforeNextAnalyze } from "./utils/runWithConcurrency";

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
  /** Open a saved clone project from Usage page or history. */
  initialProjectId?: string | null;
};

const STEP_LABELS = ["Split video", "Scenes", "Analyze", "Veo prompts"] as const;

type FlowSettings = {
  aspectRatio: string;
  model: string;
  duration: string;
  outputs: string;
  videoMode: string;
  autoRun: boolean;
};

const DEFAULT_FLOW_SETTINGS: FlowSettings = {
  aspectRatio: "9:16",
  model: "Veo 3.1",
  duration: "8",
  outputs: "1",
  videoMode: "Frames to Video",
  autoRun: true,
};

const FLOW_SETTINGS_KEY = "vf_flow_settings";

function loadFlowSettings(): FlowSettings {
  try {
    const raw = localStorage.getItem(FLOW_SETTINGS_KEY);
    if (!raw) return DEFAULT_FLOW_SETTINGS;
    return { ...DEFAULT_FLOW_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_FLOW_SETTINGS;
  }
}

function saveFlowSettings(partial: Partial<FlowSettings>) {
  const next = { ...loadFlowSettings(), ...partial };
  localStorage.setItem(FLOW_SETTINGS_KEY, JSON.stringify(next));
  return next;
}

function ClonePipelineBoard({
  videoName,
  framesCount,
  scenes,
  step,
  isExtracting,
  isAnalyzing,
  isGenerating,
  autoPipeline,
}: {
  videoName: string | null;
  framesCount: number;
  scenes: CloneScene[];
  step: WizardStep;
  isExtracting: boolean;
  isAnalyzing: boolean;
  isGenerating: boolean;
  autoPipeline: boolean;
}) {
  if (!videoName && framesCount === 0 && scenes.length === 0 && step === 1) return null;

  const total = scenes.length;
  const analyzed = scenes.filter((s) => s.analyzeStatus === "done").length;
  const analyzeErrors = scenes.filter((s) => s.analyzeStatus === "error").length;
  const prompted = scenes.filter((s) => s.promptStatus === "done").length;
  const promptErrors = scenes.filter((s) => s.promptStatus === "error").length;

  const steps = [
    {
      label: "Video",
      done: !!videoName,
      active: false,
      detail: videoName ?? "No video",
    },
    {
      label: "Frames",
      done: framesCount > 0,
      active: isExtracting,
      detail: framesCount > 0 ? `${framesCount} frames` : "—",
    },
    {
      label: "Scenes",
      done: total > 0,
      active: step === 2 && total === 0,
      detail: total ? `${total} scene(s)` : "—",
    },
    {
      label: "Analyze",
      done: total > 0 && analyzed === total,
      active: isAnalyzing,
      detail: total
        ? analyzeErrors
          ? `${analyzed}/${total} · ${analyzeErrors} err`
          : `${analyzed}/${total}`
        : "—",
      error: analyzeErrors > 0,
    },
    {
      label: "Veo prompts",
      done: total > 0 && scenes.every((s) => !s.analysis?.trim() || s.promptStatus === "done"),
      active: isGenerating,
      detail: total
        ? promptErrors
          ? `${prompted}/${total} · ${promptErrors} err`
          : `${prompted}/${total}`
        : "—",
      error: promptErrors > 0,
    },
  ];

  return (
    <div className="bg-white border-b border-gray-100">
      <div className="max-w-5xl mx-auto px-4 py-3">
        <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Pipeline status</h2>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {steps.map((s) => (
            <div
              key={s.label}
              className={cn(
                "rounded-xl border px-2 py-2 text-center text-xs",
                s.done
                  ? "border-green-200 bg-green-50"
                  : s.active
                    ? "border-violet-300 bg-violet-50 ring-2 ring-violet-200"
                    : s.error
                      ? "border-red-200 bg-red-50"
                      : "border-gray-200 bg-gray-50"
              )}
            >
              <div className="font-bold text-[10px] uppercase text-gray-500">{s.label}</div>
              <div className="font-semibold mt-1 truncate">{s.detail}</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-500 mt-2">
          {autoPipeline
            ? "Full pipeline — upload video, set settings, then wait until all Veo prompts are done."
            : "Step by step — run Analyze and Generate prompts when you are ready."}
        </p>
      </div>
    </div>
  );
}

const PLACEHOLDER_FRAME =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='9' height='16' fill='%23e5e7eb'/%3E";

function sceneImageSrc(dataUrl: string, httpsUrl?: string): string {
  if (httpsUrl?.startsWith("https://")) return httpsUrl;
  return dataUrl;
}

function frameFromMeta(meta: StoredFrameMeta, httpsUrl?: string): ExtractedFrame {
  return {
    id: meta.id,
    index: meta.index,
    timeSec: meta.timeSec,
    dataUrl: httpsUrl?.startsWith("https://") ? httpsUrl : PLACEHOLDER_FRAME,
  };
}

function scenesForFullScript(scenes: CloneScene[], allFrames: ExtractedFrame[]) {
  return scenes.map((s) => ({
    sceneNumber: s.sceneNumber,
    debut: s.debut,
    fin: s.fin,
    analysis: s.analysis,
    frameCount: getSceneFrames(allFrames, s.debut, s.fin).length,
  }));
}

function normalizeStuckSceneStatuses(scenes: CloneScene[]): CloneScene[] {
  return scenes.map((s) => {
    let analyzeStatus = s.analyzeStatus;
    let promptStatus = s.promptStatus;
    let error = s.error;

    if (analyzeStatus === "loading") {
      if (s.analysis?.trim()) {
        analyzeStatus = "done";
      } else {
        analyzeStatus = "error";
        error = error || "Analyze interrupted — click Analyze to retry.";
      }
    }

    if (promptStatus === "loading") {
      if (s.scenePackage || s.veoPrompt?.trim()) {
        promptStatus = "done";
      } else {
        promptStatus = s.analysis?.trim() ? "idle" : "idle";
        error = error || (s.analysis?.trim() ? "Prompt generation interrupted — click Generate to retry." : undefined);
      }
    }

    return { ...s, analyzeStatus, promptStatus, error };
  });
}

function restoreCloneScene(stored: StoredCloneScene, frames: ExtractedFrame[]): CloneScene {
  const debut =
    frames[stored.debutIndex] ??
    frameFromMeta(
      { id: `d-${stored.sceneNumber}`, index: stored.debutIndex, timeSec: stored.debutTimeSec },
      stored.debutUrl
    );
  const fin =
    frames[stored.finIndex] ??
    frameFromMeta(
      { id: `f-${stored.sceneNumber}`, index: stored.finIndex, timeSec: stored.finTimeSec },
      stored.finUrl
    );
  return {
    sceneNumber: stored.sceneNumber,
    debut,
    fin,
    debutUrl: stored.debutUrl,
    finUrl: stored.finUrl,
    analysis: stored.analysis,
    scenePackage: stored.scenePackage,
    veoPrompt: stored.veoPrompt,
    negativePrompt: stored.negativePrompt,
    parseError: stored.parseError,
    rawPackageText: stored.rawPackageText,
    usageAnalyze: stored.usageAnalyze,
    usagePrompt: stored.usagePrompt,
    analyzeStatus:
      stored.analyzeStatus === "loading" ||
      stored.analyzeStatus === "done" ||
      stored.analyzeStatus === "error"
        ? stored.analyzeStatus
        : "idle",
    promptStatus:
      stored.promptStatus === "loading" ||
      stored.promptStatus === "done" ||
      stored.promptStatus === "error"
        ? stored.promptStatus
        : "idle",
    error: stored.error,
  };
}

function applyProjectData(project: CloneProject): {
  step: WizardStep;
  frames: ExtractedFrame[];
  scenes: CloneScene[];
  settings: Pick<
    CloneProjectData,
    "extractMode" | "frameCount" | "intervalSec" | "sceneCount" | "boundaryIndices"
  >;
} {
  const { data } = project;
  const frames = data.frameMeta.map((m) => frameFromMeta(m));
  const scenes = normalizeStuckSceneStatuses(
    data.scenes.map((s) => restoreCloneScene(s, frames))
  );
  const step = Math.min(4, Math.max(1, project.step)) as WizardStep;
  return {
    step,
    frames,
    scenes,
    settings: {
      extractMode: data.extractMode,
      frameCount: data.frameCount,
      intervalSec: data.intervalSec,
      sceneCount: data.sceneCount,
      boundaryIndices: data.boundaryIndices,
    },
  };
}

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

export default function CloneVideoWorkspace({
  onBack,
  userId,
  onOpenUsage,
  initialProjectId,
}: Props) {
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
  const [savedProjects, setSavedProjects] = useState<CloneProject[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [resumedSourceName, setResumedSourceName] = useState<string | null>(null);
  const [needsVideoResync, setNeedsVideoResync] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [autoPipeline, setAutoPipeline] = useState(() => {
    try {
      return localStorage.getItem("vf_auto_pipeline") !== "false";
    } catch {
      return true;
    }
  });
  const [visionLockBlocked, setVisionLockBlocked] = useState<VisionLockStatus | null>(null);
  const [flowSettings, setFlowSettings] = useState<FlowSettings>(loadFlowSettings);
  const toastTimer = useRef<number | null>(null);

  useEffect(() => {
    setIsAnalyzing(false);
    setIsGenerating(false);
    setScenes((prev) => {
      if (!prev.some((s) => s.analyzeStatus === "loading" || s.promptStatus === "loading")) {
        return prev;
      }
      return normalizeStuckSceneStatuses(prev);
    });
  }, []);

  useEffect(() => {
    setUsagePersistContext(
      projectId
        ? { userId, projectType: "clone", projectId }
        : { userId, projectType: "clone" }
    );
    return () => setUsagePersistContext(userId ? { userId } : null);
  }, [userId, projectId]);

  useEffect(() => {
    if (step !== 3) {
      setVisionLockBlocked(null);
      return;
    }
    let cancelled = false;
    const poll = async () => {
      const status = await fetchVisionLockStatus();
      if (!cancelled) {
        setVisionLockBlocked(status.locked ? status : null);
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [step]);

  const persistProject = useCallback(
    async (opts: { step: WizardStep; scenesOverride?: CloneScene[] }) => {
      if (!userId) return;
      if (!videoFile && !projectId) return;
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
      const name =
        videoFile?.name.replace(/\.[^.]+$/, "") ||
        resumedSourceName?.replace(/\.[^.]+$/, "") ||
        "Clone project";
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
            name,
            sourceVideoName: videoFile?.name ?? resumedSourceName ?? undefined,
            durationSec: duration,
            step: opts.step,
            status,
            data,
          });
          setProjectId(created.id);
        }
        setSaveStatus("saved");
        window.setTimeout(() => setSaveStatus("idle"), 2000);
        void listCloneProjects(userId).then(setSavedProjects).catch(() => {});
      } catch (e) {
        console.error("clone project save", e);
        setSaveStatus("error");
      }
    },
    [
      userId,
      videoFile,
      resumedSourceName,
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

  const loadSavedProject = useCallback(
    async (id: string) => {
      setError(null);
      setLoadingProjects(true);
      try {
        const project = await fetchCloneProject(id, userId);
        if (!project) {
          setError("Project ma-l9inach f DB.");
          return;
        }
        const applied = applyProjectData(project);
        setProjectId(project.id);
        setResumedSourceName(project.sourceVideoName);
        setNeedsVideoResync(true);
        setVideoFile(null);
        if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
        setVideoPreviewUrl(null);
        setDuration(project.durationSec ?? 0);
        setExtractMode(applied.settings.extractMode);
        setFrameCount(applied.settings.frameCount);
        setIntervalSec(applied.settings.intervalSec);
        setSceneCount(applied.settings.sceneCount);
        setBoundaryIndices(applied.settings.boundaryIndices);
        setFrames(applied.frames);
        setScenes(applied.scenes);
        setStep(applied.step);
        const hadStuck = (project.data.scenes ?? []).some(
          (s) => s.analyzeStatus === "loading" || s.promptStatus === "loading"
        );
        if (hadStuck) {
          void updateCloneProject(project.id, userId, {
            step: applied.step,
            data: {
              ...project.data,
              scenes: buildStoredScenes(applied.scenes),
            },
          }).catch(() => {});
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load project");
      } finally {
        setLoadingProjects(false);
      }
    },
    [userId, videoPreviewUrl]
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingProjects(true);
    void listCloneProjects(userId)
      .then((rows) => {
        if (!cancelled) setSavedProjects(rows);
      })
      .catch(() => {
        if (!cancelled) setSavedProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (initialProjectId) {
      void loadSavedProject(initialProjectId);
    }
  }, [initialProjectId, loadSavedProject]);

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

  const flowExportScenes = useMemo(
    () =>
      scenes.map((s) =>
        toFlowSceneExport(
          s.sceneNumber,
          sceneImageSrc(s.debut.dataUrl, s.debutUrl),
          sceneImageSrc(s.fin.dataUrl, s.finUrl),
          {
            scenePackage: s.scenePackage,
            analysis: s.analysis,
            veoPrompt: s.veoPrompt,
            negativePrompt: s.negativePrompt,
          }
        )
      ),
    [scenes]
  );

  const pendingAnalyzeCount = useMemo(
    () => scenes.filter((s) => s.analyzeStatus !== "done" || !s.analysis?.trim()).length,
    [scenes]
  );

  const pendingPromptCount = useMemo(
    () =>
      scenes.filter(
        (s) =>
          s.analysis?.trim() &&
          (s.promptStatus !== "done" || !s.veoPrompt?.trim() || !s.scenePackage)
      ).length,
    [scenes]
  );

  const handleVideoPick = (file: File | null, opts?: { resume?: boolean }) => {
    if (!file) return;
    setVideoFile(file);
    setError(null);
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(URL.createObjectURL(file));
    if (opts?.resume) {
      setNeedsVideoResync(true);
      setResumedSourceName((prev) => prev ?? file.name);
      return;
    }
    setFrames([]);
    setBoundaryIndices([]);
    setScenes([]);
    setProjectId(null);
    setResumedSourceName(null);
    setNeedsVideoResync(false);
    setStep(1);
  };

  const resyncFramesFromVideo = async () => {
    if (!videoFile) {
      setError("3afak re-uploadi l-video dial l-project.");
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
      const savedBounds = boundaryIndices.filter((i) => i >= 0 && i < result.frames.length);
      const bounds =
        savedBounds.length >= 2
          ? savedBounds
          : autoSceneBoundaries(
              result.frames.length,
              clampCloneSceneCount(parseInt(sceneCount, 10) || 6, result.frames.length)
            );
      setBoundaryIndices(bounds);
      const pairs = scenesFromBoundaries(result.frames, bounds);
      const merged = pairs.map((p) => {
        const stored = scenes.find((s) => s.sceneNumber === p.sceneNumber);
        if (!stored) {
          return {
            sceneNumber: p.sceneNumber,
            debut: p.debut,
            fin: p.fin,
            analyzeStatus: "idle" as const,
            promptStatus: "idle" as const,
          };
        }
        return {
          ...stored,
          debut: p.debut,
          fin: p.fin,
        };
      });
      setScenes(merged);
      setNeedsVideoResync(false);
      void persistProject({ step, scenesOverride: merged });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mouchkil f re-sync frames.");
    } finally {
      setIsExtracting(false);
    }
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
      const sc = clampCloneSceneCount(parseInt(sceneCount, 10) || 6, result.frames.length);
      const bounds = autoSceneBoundaries(result.frames.length, sc);
      setBoundaryIndices(bounds);
      if (!autoPipeline) {
        setScenes([]);
        setStep(2);
        void persistProject({ step: 2 });
        return;
      }
      const newScenes = scenesFromBoundaries(result.frames, bounds).map((p) => ({
        sceneNumber: p.sceneNumber,
        debut: p.debut,
        fin: p.fin,
        analyzeStatus: "idle" as const,
        promptStatus: "idle" as const,
      }));
      setScenes(newScenes);
      setStep(3);
      void persistProject({ step: 3, scenesOverride: newScenes });
      void runAnalyzeAll(newScenes);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mouchkil f-extract frames.");
    } finally {
      setIsExtracting(false);
    }
  };

  const applyAutoBoundaries = () => {
    const sc = clampCloneSceneCount(parseInt(sceneCount, 10) || 6, frames.length);
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
    if (autoPipeline) {
      void runAnalyzeAll(newScenes);
    }
  };

  const runAnalyzeScene = async (sceneNumber: number) => {
    if (isAnalyzing) return;
    const i = scenes.findIndex((s) => s.sceneNumber === sceneNumber);
    if (i < 0) return;
    if (needsVideoResync) {
      setError("Re-upload video w dir Re-sync frames qbel analyze.");
      return;
    }
    const lock = await fetchVisionLockStatus();
    if (lock.locked) {
      setVisionLockBlocked(lock);
      setError(visionLockWaitMessage(lock));
      return;
    }
    setError(null);
    const next = scenes.map((s) => ({ ...s }));
    next[i] = { ...next[i], analyzeStatus: "loading" as const, error: undefined };
    setScenes(next);
    try {
      await waitBeforeNextAnalyze();
      const s = next[i];
      const payload = await buildCloneAnalyzeRequest(s, frames);
      const json = await postAiJson(
        "/api/ai/veo-scene-analyze",
        {
          ...payload,
          lockHint: `Scene ${s.sceneNumber}/${scenes.length}`,
        },
        180_000,
        `Clone analyze — Scene ${s.sceneNumber} (${payload.sceneFrameImageUrls.length} frames)`
      );
      next[i] = {
        ...next[i],
        debutUrl: payload.debutImageUrl.startsWith("https://") ? payload.debutImageUrl : undefined,
        finUrl: payload.finImageUrl.startsWith("https://") ? payload.finImageUrl : undefined,
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
    } finally {
      markAnalyzeFinished();
      await releaseVisionAnalyzeLock();
      setScenes([...next]);
      void persistProject({ step: 3, scenesOverride: next });
    }
  };

  const runAnalyzeAll = async (sourceScenes?: CloneScene[]) => {
    const workScenes = sourceScenes ?? scenes;
    if (workScenes.length === 0) return;
    if (needsVideoResync) {
      setError("Re-upload video w dir Re-sync frames qbel analyze.");
      return;
    }
    const targets = workScenes
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.analyzeStatus !== "done" || !s.analysis?.trim());
    if (targets.length === 0) {
      setError("Kolchi deja analyzed — dir Re-analyze 3la scene bohdha.");
      return;
    }
    const lock = await fetchVisionLockStatus();
    if (lock.locked) {
      setVisionLockBlocked(lock);
      setError(visionLockWaitMessage(lock));
      return;
    }
    setIsAnalyzing(true);
    setError(null);
    const next: CloneScene[] = workScenes.map((s) => ({ ...s }));
    for (const { i } of targets) {
      next[i] = { ...next[i], analyzeStatus: "loading", error: undefined };
    }
    setScenes([...next]);

    try {
      const tasks = targets.map(({ i }) => async () => {
        const s = workScenes[i];
        try {
          await waitBeforeNextAnalyze();
          const payload = await buildCloneAnalyzeRequest(s, frames);
          const json = await postAiJson(
            "/api/ai/veo-scene-analyze",
            {
              ...payload,
              lockHint: `Scene ${s.sceneNumber}/${workScenes.length}`,
            },
            180_000,
            `Clone analyze — Scene ${s.sceneNumber} (${payload.sceneFrameImageUrls.length} frames)`
          );
          next[i] = {
            ...next[i],
            debutUrl: payload.debutImageUrl.startsWith("https://") ? payload.debutImageUrl : undefined,
            finUrl: payload.finImageUrl.startsWith("https://") ? payload.finImageUrl : undefined,
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
        markAnalyzeFinished();
        void persistProject({ step: 3, scenesOverride: next });
      });

      await runWithConcurrency(tasks, CLONE_AI_CONCURRENCY);

      if (next.every((s) => s.analyzeStatus === "done")) {
        setStep(4);
        void persistProject({ step: 4, scenesOverride: next });
        if (autoPipeline) {
          void runGeneratePrompts(next);
        }
      } else {
        void persistProject({ step: 3, scenesOverride: next });
      }
    } finally {
      setIsAnalyzing(false);
      await releaseVisionAnalyzeLock();
    }
  };

  const applyPromptApiResult = (
    scene: CloneScene,
    data: Record<string, unknown>
  ): CloneScene => {
    if (data.scenePackage != null) {
      const pkg = data.scenePackage as Record<string, unknown>;
      return {
        ...scene,
        scenePackage: pkg,
        veoPrompt: typeof pkg.veoPrompt === "string" ? pkg.veoPrompt : "",
        negativePrompt: typeof pkg.negativePrompt === "string" ? pkg.negativePrompt : "",
        parseError: undefined,
        rawPackageText: undefined,
        usagePrompt: isAiUsagePayload(data.usage) ? data.usage : scene.usagePrompt,
        promptStatus: "done",
        error: undefined,
      };
    }
    return {
      ...scene,
      scenePackage: undefined,
      veoPrompt: "",
      negativePrompt: "",
      parseError: typeof data.parseError === "string" ? data.parseError : "JSON parse failed",
      rawPackageText: typeof data.rawPackageText === "string" ? data.rawPackageText : "",
      promptStatus: "error",
    };
  };

  const runGeneratePromptScene = async (sceneNumber: number) => {
    if (isGenerating || isAnalyzing) return;
    const i = scenes.findIndex((s) => s.sceneNumber === sceneNumber);
    if (i < 0) return;
    if (!scenes[i].analysis?.trim()) {
      setError(`Scene ${sceneNumber}: analyze lwl.`);
      return;
    }
    setError(null);
    const next = scenes.map((s) => ({ ...s }));
    next[i] = { ...next[i], promptStatus: "loading" as const, error: undefined };
    setScenes(next);

    const refDuration =
      duration > 0 ? duration : (next[next.length - 1]?.fin.timeSec ?? 0);
    const fullScript = buildCloneFullScript(scenesForFullScript(next, frames), refDuration);

    try {
      const s = next[i];
      const data = await postAiJson(
        "/api/ai/veo-scene-package",
        {
          fullScript,
          sceneNumber: s.sceneNumber,
          imageAnalysis: s.analysis,
          languageLabel: CLONE_LANGUAGE_LABEL,
          workflowMode: "clone",
        },
        180_000,
        `Clone Veo package — Scene ${s.sceneNumber}`
      );
      next[i] = applyPromptApiResult(next[i], data);
    } catch (e) {
      next[i] = {
        ...next[i],
        promptStatus: "error",
        error: e instanceof Error ? e.message : "Prompt failed",
      };
    }
    setScenes([...next]);
    void persistProject({ step: 4, scenesOverride: next });
  };

  const runGeneratePrompts = async (sourceScenes?: CloneScene[]) => {
    const workScenes = sourceScenes ?? scenes;
    if (workScenes.length === 0) return;
    setIsGenerating(true);
    setGenerateProgress(null);
    setError(null);

    const refDuration =
      duration > 0 ? duration : (workScenes[workScenes.length - 1]?.fin.timeSec ?? 0);
    const fullScript = buildCloneFullScript(scenesForFullScript(workScenes, frames), refDuration);

    const next = workScenes.map((s) => ({ ...s }));
    const targets = next
      .map((s, i) => ({ s, i }))
      .filter(
        ({ s }) =>
          s.analysis?.trim() &&
          (s.promptStatus !== "done" || !s.veoPrompt?.trim() || !s.scenePackage)
      );

    if (targets.length === 0) {
      setError("Kolchi deja 3ndo prompts — dir Regenerate 3la scene bohdha.");
      setIsGenerating(false);
      return;
    }

    for (const { i } of targets) {
      next[i] = { ...next[i], promptStatus: "loading" as const, error: undefined };
    }
    const pendingCount = targets.length;
    setScenes([...next]);
    setGenerateProgress(
      pendingCount > 0
        ? `Generating ${pendingCount} pending scene(s) (${CLONE_AI_CONCURRENCY} at a time)…`
        : null
    );

    let done = 0;
    const promptTasks = targets.map(({ s, i }) => async () => {
      try {
        const data = await postAiJson(
          "/api/ai/veo-scene-package",
          {
            fullScript,
            sceneNumber: s.sceneNumber,
            imageAnalysis: s.analysis,
            languageLabel: CLONE_LANGUAGE_LABEL,
            workflowMode: "clone",
          },
          180_000,
          `Clone Veo package — Scene ${s.sceneNumber}`
        );
        next[i] = applyPromptApiResult(next[i], data);
      } catch (e) {
        next[i] = {
          ...next[i],
          promptStatus: "error",
          error: e instanceof Error ? e.message : "Prompt failed",
        };
      } finally {
        done += 1;
        setGenerateProgress(`Prompts ${done} / ${pendingCount} done…`);
        setScenes([...next]);
        void persistProject({ step: 4, scenesOverride: next });
      }
    });

    await runWithConcurrency(promptTasks, CLONE_AI_CONCURRENCY, { minDelayMs: CLONE_AI_MIN_DELAY_MS });

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

      <ClonePipelineBoard
        videoName={videoFile?.name ?? resumedSourceName}
        framesCount={frames.length}
        scenes={scenes}
        step={step}
        isExtracting={isExtracting}
        isAnalyzing={isAnalyzing}
        isGenerating={isGenerating}
        autoPipeline={autoPipeline}
      />

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        {needsVideoResync && projectId ? (
          <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-900 space-y-3">
            <p>
              Project <span className="font-semibold">{resumedSourceName ?? "saved"}</span> — re-upload
              l-video bach t-restauri frames w t-continuer analyze/prompts.
            </p>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-amber-200 rounded-lg cursor-pointer hover:bg-amber-50/80 text-sm font-medium">
                <input
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleVideoPick(f, { resume: true });
                    e.target.value = "";
                  }}
                />
                <Upload className="w-4 h-4" />
                Re-upload video
              </label>
              {videoFile ? (
                <button
                  type="button"
                  onClick={() => void resyncFramesFromVideo()}
                  disabled={isExtracting}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium disabled:opacity-50"
                >
                  {isExtracting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Re-sync frames
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {savedProjects.length > 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
            <h2 className="font-semibold text-gray-800">Saved clone projects</h2>
            {loadingProjects ? (
              <p className="text-sm text-gray-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading…
              </p>
            ) : (
              <ul className="space-y-2 max-h-56 overflow-y-auto">
                {savedProjects.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-3 bg-gray-50 rounded-xl border border-gray-100"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{p.name}</div>
                      <div className="text-xs text-gray-500">
                        Step {p.step} · {p.data.scenes.length} scene(s) ·{" "}
                        {new Date(p.updatedAt).toLocaleString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadSavedProject(p.id)}
                      className="shrink-0 text-sm font-semibold text-violet-700 hover:underline"
                    >
                      Continue →
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {error ? (
          <div className="p-3 bg-red-50 border border-red-100 rounded-xl flex items-start gap-2 text-red-600 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        ) : null}

        {step === 1 && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
              <h2 className="text-lg font-semibold">1 — Upload video & settings</h2>
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
                    Scenes visées ({MIN_CLONE_SCENES}–{MAX_CLONE_SCENES})
                  </label>
                  <input
                    type="number"
                    min={MIN_CLONE_SCENES}
                    max={MAX_CLONE_SCENES}
                    className="mt-1 w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl"
                    value={sceneCount}
                    onChange={(e) => setSceneCount(e.target.value)}
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Step 2: boundaries auto — max {MAX_CLONE_SCENES} scenes (wla 9ad ma 3ndk frames).
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-gray-800">Google Flow settings</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="text-xs">
                    <span className="font-semibold text-gray-500 uppercase">Aspect</span>
                    <select
                      className="mt-1 w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                      value={flowSettings.aspectRatio}
                      onChange={(e) => setFlowSettings(saveFlowSettings({ aspectRatio: e.target.value }))}
                    >
                      <option value="9:16">9:16 (vertical)</option>
                      <option value="16:9">16:9</option>
                      <option value="1:1">1:1</option>
                    </select>
                  </label>
                  <label className="text-xs">
                    <span className="font-semibold text-gray-500 uppercase">Duration</span>
                    <select
                      className="mt-1 w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                      value={flowSettings.duration}
                      onChange={(e) => setFlowSettings(saveFlowSettings({ duration: e.target.value }))}
                    >
                      <option value="5">5s</option>
                      <option value="8">8s</option>
                      <option value="10">10s</option>
                    </select>
                  </label>
                  <label className="text-xs">
                    <span className="font-semibold text-gray-500 uppercase">Model</span>
                    <input
                      className="mt-1 w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                      value={flowSettings.model}
                      onChange={(e) => setFlowSettings(saveFlowSettings({ model: e.target.value }))}
                    />
                  </label>
                  <label className="text-xs">
                    <span className="font-semibold text-gray-500 uppercase">Outputs</span>
                    <select
                      className="mt-1 w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm"
                      value={flowSettings.outputs}
                      onChange={(e) => setFlowSettings(saveFlowSettings({ outputs: e.target.value }))}
                    >
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="4">4</option>
                    </select>
                  </label>
                </div>
              </div>

              <fieldset className="space-y-2">
                <legend className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  How to run
                </legend>
                <label
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors",
                    autoPipeline ? "border-violet-400 bg-violet-50" : "border-gray-200 bg-gray-50"
                  )}
                >
                  <input
                    type="radio"
                    name="pipelineMode"
                    className="mt-1 accent-violet-600"
                    checked={autoPipeline}
                    onChange={() => {
                      setAutoPipeline(true);
                      try {
                        localStorage.setItem("vf_auto_pipeline", "true");
                      } catch {
                        /* ignore */
                      }
                    }}
                  />
                  <span className="text-sm">
                    <span className="font-semibold block">Full pipeline</span>
                    <span className="text-gray-500 text-xs">
                      Extract → analyze → Veo prompts automatically
                    </span>
                  </span>
                </label>
                <label
                  className={cn(
                    "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors",
                    !autoPipeline ? "border-violet-400 bg-violet-50" : "border-gray-200 bg-gray-50"
                  )}
                >
                  <input
                    type="radio"
                    name="pipelineMode"
                    className="mt-1 accent-violet-600"
                    checked={!autoPipeline}
                    onChange={() => {
                      setAutoPipeline(false);
                      try {
                        localStorage.setItem("vf_auto_pipeline", "false");
                      } catch {
                        /* ignore */
                      }
                    }}
                  />
                  <span className="text-sm">
                    <span className="font-semibold block">Step by step</span>
                    <span className="text-gray-500 text-xs">
                      Pause after each step — you click Analyze &amp; Generate
                    </span>
                  </span>
                </label>
              </fieldset>

              <button
                type="button"
                disabled={!videoFile || isExtracting}
                onClick={() => void runExtract()}
                className="w-full py-3 bg-violet-600 text-white font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isExtracting ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {autoPipeline ? "Start full pipeline" : "Extract frames →"}
              </button>
              <p className="text-xs text-gray-500 text-center">
                {autoPipeline
                  ? "Runs extract → analyze → Veo prompts automatically."
                  : "Step by step: extract frames, adjust scenes, then run Analyze and Generate yourself."}
              </p>
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
                      {p.fin.timeSec.toFixed(2)}s) · {p.sceneFrames.length} frame
                      {p.sceneFrames.length !== 1 ? "s" : ""} for analyze
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
              {autoPipeline ? "Confirm scenes → Analyze" : "Confirm scenes → Continue"}
            </button>
          </div>
        )}

        {step === 3 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <h2 className="text-lg font-semibold">3 — Analyze chno tbeddel (debut → fin)</h2>
            {visionLockBlocked ? (
              <div
                className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
                role="alert"
              >
                <AlertCircle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
                <p>{visionLockWaitMessage(visionLockBlocked)}</p>
              </div>
            ) : null}
            <p className="text-sm text-gray-600">
              Vision analyzes <strong>every frame</strong> between each scene&apos;s debut and fin
              (not just the two endpoints), then outputs <strong>TIMED ACTION SPLIT</strong> for
              0–8s Veo.
            </p>
            <button
              type="button"
              disabled={
                isAnalyzing ||
                !!visionLockBlocked ||
                scenes.length === 0 ||
                pendingAnalyzeCount === 0
              }
              onClick={() => void runAnalyzeAll()}
              className="w-full py-3 bg-violet-600 text-white font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isAnalyzing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {pendingAnalyzeCount > 0
                ? `Analyze pending (${pendingAnalyzeCount})`
                : "All scenes analyzed"}
            </button>
            <p className="text-xs text-gray-500 text-center">
              Scenes run <strong>one at a time</strong> with an ~8s pause between each (avoids OpenAI rate
              limits). Use <strong>Re-analyze</strong> on each card for a single scene.
            </p>
            <div className="space-y-4">
              {scenes.map((s) => (
                <div key={s.sceneNumber} className="border border-gray-100 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-bold">Scene {s.sceneNumber}</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        disabled={isAnalyzing || isGenerating || !!visionLockBlocked}
                        onClick={() => void runAnalyzeScene(s.sceneNumber)}
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-violet-200 bg-violet-50 text-violet-800 font-medium disabled:opacity-50 flex items-center gap-1"
                      >
                        {s.analyzeStatus === "loading" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                        {s.analyzeStatus === "done" && s.analysis?.trim()
                          ? "Re-analyze"
                          : "Analyze"}
                      </button>
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
                    <img src={sceneImageSrc(s.debut.dataUrl, s.debutUrl)} alt="" className="w-16 aspect-[9/16] object-cover rounded-lg" />
                    <img src={sceneImageSrc(s.fin.dataUrl, s.finUrl)} alt="" className="w-16 aspect-[9/16] object-cover rounded-lg" />
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
                disabled={isGenerating || pendingPromptCount === 0}
                onClick={() => void runGeneratePrompts()}
                className="w-full py-3 bg-violet-600 text-white font-bold rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {pendingPromptCount > 0
                  ? `Generate pending prompts (${pendingPromptCount})`
                  : "All prompts generated"}
              </button>
              {generateProgress ? (
                <p className="text-xs text-violet-800 text-center">{generateProgress}</p>
              ) : null}
              <p className="text-xs text-gray-500 text-center">
                Use <strong>Regenerate</strong> on each scene card for one scene at a time. Full JSON
                package is saved to your project in the database.
              </p>
              <FlowExtensionBar scenes={flowExportScenes} disabled={isGenerating} />
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
                      disabled={
                        isGenerating ||
                        isAnalyzing ||
                        !s.analysis?.trim()
                      }
                      onClick={() => void runGeneratePromptScene(s.sceneNumber)}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-violet-200 bg-violet-50 text-violet-800 font-medium disabled:opacity-50 flex items-center gap-1"
                    >
                      {s.promptStatus === "loading" ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3" />
                      )}
                      {s.promptStatus === "done" && s.scenePackage
                        ? "Regenerate"
                        : "Generate prompt"}
                    </button>
                    <button
                    type="button"
                    onClick={() => void downloadScenePairZip(s)}
                    className="text-sm px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium flex items-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    ZIP debut + fin
                  </button>
                    <FlowExtensionSceneButton
                      scene={toFlowSceneExport(
                        s.sceneNumber,
                        sceneImageSrc(s.debut.dataUrl, s.debutUrl),
                        sceneImageSrc(s.fin.dataUrl, s.finUrl),
                        {
                          scenePackage: s.scenePackage,
                          analysis: s.analysis,
                          veoPrompt: s.veoPrompt,
                          negativePrompt: s.negativePrompt,
                        }
                      )}
                      disabled={!hasVeo31}
                    />
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="text-center">
                    <img src={sceneImageSrc(s.debut.dataUrl, s.debutUrl)} alt="" className="w-24 aspect-[9/16] object-cover rounded-lg border" />
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
                    <img src={sceneImageSrc(s.fin.dataUrl, s.finUrl)} alt="" className="w-24 aspect-[9/16] object-cover rounded-lg border" />
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
