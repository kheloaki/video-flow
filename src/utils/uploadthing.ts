import { genUploader } from "uploadthing/client";
import type { OurFileRouter } from "../../server";
import { apiUrl } from "../apiBase";

export const { uploadFiles } = genUploader<OurFileRouter>({
  url: apiUrl("/api/uploadthing"),
});
