import { readFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { PROJECT_ROOT, ToolError } from "./config/env.js";
import { downloadDriveFile, driveFileIdFromUrl, fetchBytes } from "./google/docs.js";
import { extFor, sniffImageMime, uploadImageBytes, type ImageBytes } from "./shopify/files.js";

/** upload_image sources: public URL, Google contentUri, Drive file id/link, or a file fetch_google_doc downloaded. */
export interface ImageSource {
  url?: string;
  contentUri?: string;
  driveFileId?: string;
  filePath?: string;
}

async function loadImage(src: ImageSource): Promise<ImageBytes> {
  let data: Buffer;
  let name = "image";
  if (src.filePath) {
    const abs = resolve(PROJECT_ROOT, src.filePath);
    const rel = relative(resolve(PROJECT_ROOT, "runs"), abs);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new ToolError("NOT_ALLOWED", "filePath must be inside the project's runs/ folder");
    data = await readFile(abs);
    name = basename(abs).replace(/\.[^.]+$/, "");
  } else if (src.driveFileId || (src.url && driveFileIdFromUrl(src.url))) {
    const id = src.driveFileId ?? driveFileIdFromUrl(src.url!)!;
    const f = await downloadDriveFile(id);
    data = f.data;
    name = f.name.replace(/\.[^.]+$/, "");
  } else if (src.contentUri || src.url) {
    const u = (src.contentUri ?? src.url)!;
    try {
      data = await fetchBytes(u);
    } catch (err) {
      throw new ToolError("IMAGE", (err as Error).message);
    }
    if (src.url) name = decodeURIComponent(new URL(src.url).pathname.split("/").pop() ?? "image").replace(/\.[^.]+$/, "") || "image";
  } else {
    throw new ToolError("VALIDATION", "Give one image source: url, contentUri, driveFileId or filePath");
  }
  const mimeType = sniffImageMime(data);
  if (!mimeType) throw new ToolError("IMAGE", "Source is not a JPEG/PNG/GIF/WebP image (Drive/Docs link not shared, or an HTML page?)");
  const safe = name.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "image";
  return { data, mimeType, filename: `${safe}.${extFor(mimeType)}` };
}

export async function uploadImage(src: ImageSource, alt?: string) {
  const img = await loadImage(src);
  return uploadImageBytes(img, alt);
}
