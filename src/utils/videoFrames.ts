export type ExtractedFrame = {
  id: string;
  index: number;
  timeSec: number;
  dataUrl: string;
};

export type FrameExtractMode = "count" | "interval";

export type FrameExtractOptions = {
  mode: FrameExtractMode;
  /** Evenly spaced frame count (mode count). Clamped 2–120. */
  frameCount?: number;
  /** Seconds between captures (mode interval). Min 0.25. */
  intervalSec?: number;
};

function waitForEvent(el: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
      reject(new Error("Video frame capture timed out"));
    }, timeoutMs);
    const onOk = () => {
      window.clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
      resolve();
    };
    const onErr = () => {
      window.clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
      reject(new Error("Video decode error"));
    };
    el.addEventListener(event, onOk, { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

async function captureFrameAt(
  video: HTMLVideoElement,
  timeSec: number,
  maxWidth: number
): Promise<string> {
  video.currentTime = Math.max(0, Math.min(timeSec, Math.max(0, video.duration - 0.05)));
  await waitForEvent(video, "seeked", 8000);

  const canvas = document.createElement("canvas");
  const scale = maxWidth / (video.videoWidth || maxWidth);
  canvas.width = maxWidth;
  canvas.height = Math.max(1, Math.round((video.videoHeight || maxWidth * 9 / 16) * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.88);
}

function buildCaptureTimes(duration: number, options: FrameExtractOptions): number[] {
  const d = Math.max(0.1, duration);
  if (options.mode === "interval") {
    const step = Math.max(0.25, options.intervalSec ?? 1);
    const times: number[] = [];
    for (let t = 0; t <= d; t += step) {
      times.push(Math.min(t, d - 0.05));
    }
    if (times.length === 0 || times[times.length - 1] < d - 0.1) {
      times.push(Math.max(0, d - 0.05));
    }
    return times;
  }
  const count = Math.min(120, Math.max(2, options.frameCount ?? 24));
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, i) =>
    Math.min((i / (count - 1)) * Math.max(0, d - 0.05), Math.max(0, d - 0.05))
  );
}

export async function extractVideoFrames(
  file: File,
  options: FrameExtractOptions
): Promise<{ duration: number; frames: ExtractedFrame[] }> {
  if (file.size > 200 * 1024 * 1024) {
    throw new Error("Video kbir bzaf (max 200MB).");
  }

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  try {
    await waitForEvent(video, "loadedmetadata", 15000);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (duration <= 0) throw new Error("Ma-l9inach duration dial l-video.");

    const times = buildCaptureTimes(duration, options);
    const frames: ExtractedFrame[] = [];

    for (let i = 0; i < times.length; i++) {
      const dataUrl = await captureFrameAt(video, times[i], 720);
      frames.push({
        id: `f-${i}-${Math.round(times[i] * 1000)}`,
        index: i,
        timeSec: times[i],
        dataUrl,
      });
    }

    return { duration, frames };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}

/** Max scenes in Clone Video (also limited by frame count − 1). */
export const MAX_CLONE_SCENES = 40;
export const MIN_CLONE_SCENES = 2;

export function clampCloneSceneCount(raw: number, frameCount = 120): number {
  const maxByFrames = Math.max(MIN_CLONE_SCENES, frameCount - 1);
  const cap = Math.min(MAX_CLONE_SCENES, maxByFrames);
  return Math.min(cap, Math.max(MIN_CLONE_SCENES, raw));
}

/** Pick boundary frame indices for N scenes (N pairs of consecutive boundaries). */
export function autoSceneBoundaries(frameCount: number, sceneCount: number): number[] {
  const n = Math.max(1, frameCount);
  const scenes = Math.min(Math.max(1, sceneCount), Math.max(1, n - 1));
  if (n < 2) return [0];
  const needed = scenes + 1;
  const indices: number[] = [];
  for (let i = 0; i < needed; i++) {
    indices.push(Math.min(n - 1, Math.round((i * (n - 1)) / scenes)));
  }
  return [...new Set(indices)].sort((a, b) => a - b);
}

export function scenesFromBoundaries(
  frames: ExtractedFrame[],
  boundaryIndices: number[]
): { sceneNumber: number; debut: ExtractedFrame; fin: ExtractedFrame }[] {
  const sorted = [...new Set(boundaryIndices)].filter((i) => i >= 0 && i < frames.length).sort((a, b) => a - b);
  const out: { sceneNumber: number; debut: ExtractedFrame; fin: ExtractedFrame }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    out.push({
      sceneNumber: i + 1,
      debut: frames[sorted[i]],
      fin: frames[sorted[i + 1]],
    });
  }
  return out;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(",");
  const mime = header.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
