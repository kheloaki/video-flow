export const MAX_CLONE_SCENES = 40;
export const MIN_CLONE_SCENES = 2;

export function clampCloneSceneCount(raw, frameCount = 120) {
  const maxByFrames = Math.max(MIN_CLONE_SCENES, frameCount - 1);
  const cap = Math.min(MAX_CLONE_SCENES, maxByFrames);
  return Math.min(cap, Math.max(MIN_CLONE_SCENES, raw));
}

function waitForEvent(el, event, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
      reject(new Error("Video frame capture timed out"));
    }, timeoutMs);
    const onOk = () => {
      clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
      resolve();
    };
    const onErr = () => {
      clearTimeout(timer);
      el.removeEventListener(event, onOk);
      el.removeEventListener("error", onErr);
      reject(new Error("Video decode error"));
    };
    el.addEventListener(event, onOk, { once: true });
    el.addEventListener("error", onErr, { once: true });
  });
}

async function captureFrameAt(video, timeSec, maxWidth) {
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

function buildCaptureTimes(duration, options) {
  const d = Math.max(0.1, duration);
  if (options.mode === "interval") {
    const step = Math.max(0.25, options.intervalSec ?? 1);
    const times = [];
    for (let t = 0; t <= d; t += step) times.push(Math.min(t, d - 0.05));
    if (!times.length || times[times.length - 1] < d - 0.1) times.push(Math.max(0, d - 0.05));
    return times;
  }
  const count = Math.min(120, Math.max(2, options.frameCount ?? 24));
  return Array.from({ length: count }, (_, i) =>
    Math.min((i / (count - 1)) * Math.max(0, d - 0.05), Math.max(0, d - 0.05))
  );
}

export async function extractVideoFrames(file, options) {
  if (file.size > 200 * 1024 * 1024) throw new Error("Video kbir bzaf (max 200MB).");
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
    const frames = [];
    for (let i = 0; i < times.length; i++) {
      const dataUrl = await captureFrameAt(video, times[i], 720);
      frames.push({ id: `f-${i}-${Math.round(times[i] * 1000)}`, index: i, timeSec: times[i], dataUrl });
    }
    return { duration, frames };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    video.load();
  }
}

export function autoSceneBoundaries(frameCount, sceneCount) {
  const n = Math.max(1, frameCount);
  const scenes = Math.min(Math.max(1, sceneCount), Math.max(1, n - 1));
  if (n < 2) return [0];
  const needed = scenes + 1;
  const indices = [];
  for (let i = 0; i < needed; i++) {
    indices.push(Math.min(n - 1, Math.round((i * (n - 1)) / scenes)));
  }
  return [...new Set(indices)].sort((a, b) => a - b);
}

export const MAX_SCENE_ANALYZE_FRAMES = 10;

export function getSceneFrames(frames, debut, fin) {
  const start = Math.min(debut.index, fin.index);
  const end = Math.max(debut.index, fin.index);
  return frames.filter((f) => f.index >= start && f.index <= end);
}

export function subsampleSceneFrames(sceneFrames, maxFrames = MAX_SCENE_ANALYZE_FRAMES) {
  if (sceneFrames.length <= maxFrames) return sceneFrames;
  if (maxFrames < 2) return [sceneFrames[0]];
  const out = [sceneFrames[0]];
  const middle = sceneFrames.slice(1, -1);
  const slots = maxFrames - 2;
  for (let i = 0; i < slots; i++) {
    const idx = Math.round(((i + 1) * (middle.length + 1)) / (slots + 1)) - 1;
    const pick = middle[Math.max(0, Math.min(middle.length - 1, idx))];
    if (pick && out[out.length - 1]?.index !== pick.index) out.push(pick);
  }
  const last = sceneFrames[sceneFrames.length - 1];
  if (out[out.length - 1]?.index !== last.index) out.push(last);
  return out;
}

export function scenesFromBoundaries(frames, boundaryIndices) {
  const sorted = [...new Set(boundaryIndices)]
    .filter((i) => i >= 0 && i < frames.length)
    .sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const debut = frames[sorted[i]];
    const fin = frames[sorted[i + 1]];
    out.push({
      sceneNumber: i + 1,
      debut,
      fin,
      sceneFrames: getSceneFrames(frames, debut, fin),
    });
  }
  return out;
}
