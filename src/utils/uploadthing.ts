import { genUploader } from "uploadthing/client";
import type { OurFileRouter } from "../../server";
import { apiUrl } from "../apiBase";

const { uploadFiles: uploadFilesUt } = genUploader<OurFileRouter>({
  url: apiUrl("/api/uploadthing"),
});

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(file);
  });
}

/** Upload to UploadThing; on network/DNS failure fall back to inline data URLs (works with OpenAI vision). */
export async function uploadFiles(
  ...args: Parameters<typeof uploadFilesUt>
): ReturnType<typeof uploadFilesUt> {
  try {
    return await uploadFilesUt(...args);
  } catch (e) {
    const files = args[1]?.files;
    if (!files?.length) throw e;
    console.warn(
      "UploadThing ma-khdamch (DNS/network?) — kanst3mlo data URL local bach OpenAI vision y9ra tsawer.",
      e
    );
    const out = await Promise.all(
      files.map(async (file) => ({
        url: await fileToDataUrl(file),
        key: "local-data-url",
        name: file.name,
        size: file.size,
      }))
    );
    return out as Awaited<ReturnType<typeof uploadFilesUt>>;
  }
}
