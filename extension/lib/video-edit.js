function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForEvent(el, name, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${name}`)), timeoutMs);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    el.addEventListener(name, done, { once: true });
    el.addEventListener(
      "error",
      () => {
        clearTimeout(timer);
        reject(new Error("Video load failed"));
      },
      { once: true }
    );
  });
}

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";
}

function loadVideoMeta(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;

    const timer = setTimeout(() => {
      video.src = "";
      reject(new Error("Could not read video metadata (timeout)"));
    }, 20000);

    const done = () => {
      clearTimeout(timer);
      if (!video.videoWidth || !video.duration || !Number.isFinite(video.duration)) {
        video.src = "";
        reject(new Error("Could not read video metadata"));
        return;
      }
      resolve({
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        duration: video.duration,
      });
      video.src = "";
    };

    video.onloadeddata = done;
    video.onerror = () => {
      clearTimeout(timer);
      video.src = "";
      reject(new Error("Could not read video metadata"));
    };
  });
}

/** Check if a blob URL is playable in this browser. */
export function probeVideoUrl(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = url;

    const timer = setTimeout(() => {
      video.src = "";
      resolve({ ok: false, error: "Playback timeout" });
    }, timeoutMs);

    video.onloadeddata = () => {
      clearTimeout(timer);
      const result = {
        ok: video.videoWidth > 0 && Number.isFinite(video.duration),
        duration: video.duration || 0,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      };
      video.src = "";
      if (!result.ok) result.error = "Video has no readable frames";
      resolve(result);
    };

    video.onerror = () => {
      clearTimeout(timer);
      video.src = "";
      resolve({ ok: false, error: "Browser cannot decode this video" });
    };
  });
}

async function renderClipToCanvas(url, canvas, ctx) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  await waitForEvent(video, "loadeddata");

  await new Promise((resolve, reject) => {
    let raf = 0;
    const draw = () => {
      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
      if (!video.ended && !video.paused) raf = requestAnimationFrame(draw);
    };

    video.onended = () => {
      cancelAnimationFrame(raf);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      resolve();
    };
    video.onerror = () => {
      cancelAnimationFrame(raf);
      reject(new Error("Clip playback failed"));
    };

    video
      .play()
      .then(() => {
        draw();
      })
      .catch(reject);
  });

  video.src = "";
}

/** @param {{ url: string, order: number }[]} clips sorted by order */
export async function combineVideoClips(clips, { onProgress } = {}) {
  if (!clips.length) throw new Error("Select at least one clip.");

  const sorted = [...clips].sort((a, b) => a.order - b.order);
  const first = await loadVideoMeta(sorted[0].url);

  const canvas = document.createElement("canvas");
  canvas.width = first.videoWidth;
  canvas.height = first.videoHeight;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas not supported.");

  const fps = 30;
  const stream = canvas.captureStream(fps);
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 8_000_000,
  });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const stopped = new Promise((resolve) => {
    recorder.onstop = resolve;
  });

  recorder.start(250);

  for (let i = 0; i < sorted.length; i++) {
    onProgress?.(`Combining clip ${i + 1} / ${sorted.length}…`);
    await renderClipToCanvas(sorted[i].url, canvas, ctx);
    await sleep(120);
  }

  recorder.stop();
  await stopped;

  const ext = mimeType.includes("mp4") ? "mp4" : "webm";
  return {
    blob: new Blob(chunks, { type: mimeType }),
    ext,
    mimeType,
    clipCount: sorted.length,
  };
}

/** Guess scene order from filename: scene-3.mp4, scene_3_fin, etc. */
export function guessClipOrder(filename) {
  const base = String(filename || "").toLowerCase();
  const patterns = [
    /scene[_\-\s]*(\d+)/,
    /clip[_\-\s]*(\d+)/,
    /part[_\-\s]*(\d+)/,
    /(\d+)\s*\.(?:mp4|webm|mov)/,
  ];
  for (const re of patterns) {
    const m = base.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}

export function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
