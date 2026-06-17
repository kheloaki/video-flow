export function estimateDataUrlBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Math.ceil((base64.length * 3) / 4);
}

export function compressDataUrlForVision(dataUrl, maxWidth = 512, quality = 0.72) {
  if (typeof OffscreenCanvas !== "undefined") {
    return compressWithOffscreen(dataUrl, maxWidth, quality);
  }
  return compressWithDomImage(dataUrl, maxWidth, quality);
}

async function compressWithOffscreen(dataUrl, maxWidth, quality) {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const nw = bitmap.width || maxWidth;
  const nh = bitmap.height || maxWidth;
  const scale = Math.min(1, maxWidth / nw);
  const w = Math.max(1, Math.round(nw * scale));
  const h = Math.max(1, Math.round(nh * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.drawImage(bitmap, 0, 0, w, h);
  const out = await canvas.convertToBlob({ type: "image/jpeg", quality });
  return blobToDataUrl(out);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function compressWithDomImage(dataUrl, maxWidth, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const nw = img.naturalWidth || maxWidth;
      const nh = img.naturalHeight || maxWidth;
      const scale = Math.min(1, maxWidth / nw);
      const w = Math.max(1, Math.round(nw * scale));
      const h = Math.max(1, Math.round(nh * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas not supported"));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = dataUrl;
  });
}

export async function prepareVisionImageUrl(dataUrl, maxBytesPerImage = 900_000) {
  const attempts = [
    [512, 0.72],
    [448, 0.68],
    [384, 0.65],
    [320, 0.6],
  ];
  let best = dataUrl;
  for (const [w, q] of attempts) {
    best = await compressDataUrlForVision(dataUrl, w, q);
    if (estimateDataUrlBytes(best) <= maxBytesPerImage) return best;
  }
  return best;
}
