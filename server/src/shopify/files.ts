import { ToolError } from "../config/env.js";
import { shopifyGraphql, type UserError } from "./client.js";

/** §5 upload_image: stagedUploadsCreate → upload → fileCreate → poll until READY. */

export interface ImageBytes {
  data: Buffer;
  mimeType: string;
  filename: string;
}

const STAGED = /* GraphQL */ `
  mutation Staged($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets { url resourceUrl parameters { name value } }
      userErrors { field message }
    }
  }
`;

const FILE_CREATE = /* GraphQL */ `
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files { id fileStatus }
      userErrors { field message code }
    }
  }
`;

const FILE_STATUS = /* GraphQL */ `
  query FileStatus($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        fileStatus
        fileErrors { message }
        image { url }
      }
    }
  }
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Detect image type from magic bytes (more reliable than a Google content-type header). */
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export const extFor = (mime: string) =>
  ({ "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" })[mime] ?? "bin";

export async function uploadImageBytes(img: ImageBytes, alt?: string): Promise<{ url: string; fileGid: string }> {
  const staged = await shopifyGraphql<{
    stagedUploadsCreate: {
      stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[];
      userErrors: UserError[];
    };
  }>(STAGED, {
    input: [
      {
        resource: "IMAGE",
        filename: img.filename,
        mimeType: img.mimeType,
        httpMethod: "POST",
        fileSize: String(img.data.length),
      },
    ],
  });
  if (staged.stagedUploadsCreate.userErrors.length) {
    throw new ToolError("IMAGE", "stagedUploadsCreate failed", staged.stagedUploadsCreate.userErrors);
  }
  const target = staged.stagedUploadsCreate.stagedTargets[0]!;

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([new Uint8Array(img.data)], { type: img.mimeType }), img.filename);
  const up = await fetch(target.url, { method: "POST", body: form });
  if (!up.ok) throw new ToolError("IMAGE", `Staged upload failed (${up.status}): ${(await up.text()).slice(0, 300)}`);

  const created = await shopifyGraphql<{
    fileCreate: { files: { id: string; fileStatus: string }[]; userErrors: UserError[] };
  }>(FILE_CREATE, {
    files: [{ originalSource: target.resourceUrl, contentType: "IMAGE", alt: alt ?? "" }],
  });
  if (created.fileCreate.userErrors.length) {
    throw new ToolError("IMAGE", "fileCreate failed", created.fileCreate.userErrors);
  }
  const fileGid = created.fileCreate.files[0]!.id;

  // Poll until READY (max ~60s).
  for (let i = 0; i < 30; i++) {
    const st = await shopifyGraphql<{
      node: { fileStatus: string; fileErrors: { message: string }[]; image: { url: string } | null } | null;
    }>(FILE_STATUS, { id: fileGid });
    const n = st.node;
    if (n?.fileStatus === "READY" && n.image?.url) return { url: n.image.url, fileGid };
    if (n?.fileStatus === "FAILED") {
      throw new ToolError("IMAGE", `Shopify could not process the image: ${n.fileErrors.map((e) => e.message).join("; ")}`);
    }
    await sleep(2000);
  }
  throw new ToolError("IMAGE", `Image ${fileGid} not READY after 60s`);
}
