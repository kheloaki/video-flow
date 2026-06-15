import { dataUrlToBlob } from "./videoFrames";
import { uploadFiles } from "./uploadthing";

/** Approx decoded bytes for a data URL (base64). */
export function estimateDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(",")[1] ?? "";
  return Math.ceil((base64.length * 3) / 4);
}

/** Resize + JPEG compress so two frames + JSON stay under Vercel's ~4.5MB request cap. */
export async function compressDataUrlForVision(
  dataUrl: string,
  maxWidth = 512,
  quality = 0.72
): Promise<string> {
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
      if (!ctx) {
        reject(new Error("Canvas not supported"));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = dataUrl;
  });
}

async function compressUnderBudget(dataUrl: string, maxBytes: number): Promise<string> {
  const attempts: Array<[number, number]> = [
    [512, 0.72],
    [448, 0.68],
    [384, 0.65],
    [320, 0.6],
  ];
  let best = dataUrl;
  for (const [w, q] of attempts) {
    best = await compressDataUrlForVision(dataUrl, w, q);
    if (estimateDataUrlBytes(best) <= maxBytes) return best;
  }
  return best;
}

/**
 * Prefer HTTPS URL (UploadThing) for tiny API payloads on Vercel.
 * Fallback: compressed JPEG data URL under per-image budget.
 */
export async function prepareVisionImageUrl(
  dataUrl: string,
  filename: string,
  maxBytesPerImage = 900_000
): Promise<string> {
  const compressed = await compressUnderBudget(dataUrl, maxBytesPerImage);

  try {
    const blob = dataUrlToBlob(compressed);
    const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
    const res = await uploadFiles("imageUploader", { files: [file] });
    const url = res?.[0]?.url?.trim();
    if (url?.startsWith("https://")) return url;
  } catch {
    /* UploadThing unavailable — inline data URL */
  }

  return compressed;
}
