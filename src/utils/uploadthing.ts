import { genUploader } from "uploadthing/client";
import type { OurFileRouter } from "../../server";

export const { uploadFiles } = genUploader<OurFileRouter>({
  url: "/api/uploadthing",
});
