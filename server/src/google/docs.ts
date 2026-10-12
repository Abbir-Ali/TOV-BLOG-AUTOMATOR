import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getConfig, PROJECT_ROOT, ToolError } from "../config/env.js";
import { detectContentType } from "../parse/detect.js";
import { extFor, sniffImageMime } from "../shopify/files.js";

/** §5 fetch_google_doc — service account, plain text with paragraph boundaries, inline images downloaded at once. */

const SCOPES = [
  "https://www.googleapis.com/auth/documents.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

export interface DocImage {
  index: number;
  /** Image sits after this line of `paragraphs` (-1 = before the first line). */
  afterLineIndex: number;
  objectId: string;
  contentUri: string | null;
  alt: string;
  /** Downloaded copy (contentUri expires after ~30 min) — pass to upload_image as { filePath }. */
  filePath: string | null;
  mimeType: string | null;
  downloadError?: string;
}

export interface DocTable {
  afterLineIndex: number;
  rows: string[][];
}

export interface FetchedDoc {
  docId: string;
  title: string;
  /** Lines joined with \n — what parse_brief reads. */
  text: string;
  /** text + image alt texts — pass this as validate_payload's sourceText. */
  sourceText: string;
  paragraphs: string[];
  images: DocImage[];
  tables: DocTable[];
  detectedContentType: "inspired" | "press" | "unknown";
}

export function docIdFromUrl(urlOrId: string): string {
  const s = urlOrId.trim();
  const m = /\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]{20,})/.exec(s);
  if (m) return m[1]!;
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  throw new ToolError("VALIDATION", `Not a Google Doc URL or id: ${s}`);
}

export function driveFileIdFromUrl(url: string): string | null {
  const m = /\/file\/d\/([a-zA-Z0-9_-]{10,})/.exec(url) ?? /[?&]id=([a-zA-Z0-9_-]{10,})/.exec(url);
  return m && /(drive|docs)\.google\.com/.test(url) ? m[1]! : null;
}

export function serviceAccountEmail(): string {
  try {
    const key = JSON.parse(readFileSync(getConfig().googleCredentials, "utf8")) as { client_email?: string };
    return key.client_email ?? "<service-account-email>";
  } catch {
    return "<service-account-email>";
  }
}

async function googleClients() {
  const cfg = getConfig();
  if (!existsSync(cfg.googleCredentials)) {
    throw new ToolError("CONFIG", `Google service account key not found at ${cfg.googleCredentials} (GOOGLE_APPLICATION_CREDENTIALS)`);
  }
  const { google } = await import("googleapis"); // lazy: keeps server start fast
  const auth = new google.auth.GoogleAuth({ keyFile: cfg.googleCredentials, scopes: SCOPES });
  return { docs: google.docs({ version: "v1", auth }), drive: google.drive({ version: "v3", auth }) };
}

function accessError(err: unknown, what: string): never {
  const status = (err as { code?: number; status?: number }).code ?? (err as { status?: number }).status;
  if (status === 403 || status === 404) {
    throw new ToolError("DOC_ACCESS", `Cannot read ${what} (${status}). Share it with ${serviceAccountEmail()} (Viewer).`);
  }
  throw new ToolError("DOC_ACCESS", `Google API error reading ${what}: ${(err as Error).message}`);
}

/* Minimal shapes of the Docs API objects we read. */
interface TextRun { content?: string | null }
interface ParaElement { textRun?: TextRun | null; inlineObjectElement?: { inlineObjectId?: string | null } | null }
interface Paragraph { elements?: ParaElement[] | null; positionedObjectIds?: string[] | null }
interface StructuralElement {
  paragraph?: Paragraph | null;
  table?: { tableRows?: { tableCells?: { content?: StructuralElement[] | null }[] | null }[] | null } | null;
}
interface EmbeddedObject { title?: string | null; description?: string | null; imageProperties?: { contentUri?: string | null } | null }
type ObjMap = Record<string, { inlineObjectProperties?: { embeddedObject?: EmbeddedObject | null } | null; positionedObjectProperties?: { embeddedObject?: EmbeddedObject | null } | null }>;

const cleanLine = (s: string) => s.replace(/\u000b/g, "\n").replace(/[ \t]+$/gm, "");

export async function fetchGoogleDoc(docUrlOrId: string): Promise<FetchedDoc> {
  const docId = docIdFromUrl(docUrlOrId);
  const { docs } = await googleClients();
  let doc;
  try {
    doc = (await docs.documents.get({ documentId: docId })).data;
  } catch (err) {
    accessError(err, `Google Doc ${docId}`);
  }

  const objects: ObjMap = { ...((doc.inlineObjects ?? {}) as ObjMap), ...((doc.positionedObjects ?? {}) as ObjMap) };
  const paragraphs: string[] = [];
  const imageRefs: { objectId: string; afterLineIndex: number }[] = [];
  const tables: DocTable[] = [];

  const paraText = (p: Paragraph) => (p.elements ?? []).map((e) => e.textRun?.content ?? "").join("");

  const walk = (content: StructuralElement[]) => {
    for (const el of content) {
      if (el.paragraph) {
        const p = el.paragraph;
        const lines = cleanLine(paraText(p))
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        const before = paragraphs.length - 1;
        paragraphs.push(...lines);
        // Inline images in a text paragraph sit after that paragraph; in an empty paragraph, after the previous line.
        const at = lines.length ? paragraphs.length - 1 : before;
        for (const e of p.elements ?? []) {
          const id = e.inlineObjectElement?.inlineObjectId;
          if (id) imageRefs.push({ objectId: id, afterLineIndex: at });
        }
        for (const id of p.positionedObjectIds ?? []) imageRefs.push({ objectId: id, afterLineIndex: at });
      } else if (el.table) {
        const rows = (el.table.tableRows ?? []).map((r) =>
          (r.tableCells ?? []).map((c) =>
            (c.content ?? [])
              .map((ce) => (ce.paragraph ? cleanLine(paraText(ce.paragraph)).trim() : ""))
              .filter(Boolean)
              .join("\n"),
          ),
        );
        tables.push({ afterLineIndex: paragraphs.length - 1, rows });
        // Cell text also goes into the line stream so the parser and verbatim check see it.
        for (const row of rows) for (const cell of row) paragraphs.push(...cell.split("\n").filter(Boolean));
      }
    }
  };
  walk((doc.body?.content ?? []) as StructuralElement[]);

  const text = paragraphs.join("\n");
  const images = await downloadImages(docId, imageRefs, objects);
  const alts = images.map((i) => i.alt).filter(Boolean);

  return {
    docId,
    title: doc.title ?? "",
    text,
    sourceText: alts.length ? `${text}\n${alts.join("\n")}` : text,
    paragraphs,
    images,
    tables,
    detectedContentType: detectContentType(text),
  };
}

async function downloadImages(docId: string, refs: { objectId: string; afterLineIndex: number }[], objects: ObjMap): Promise<DocImage[]> {
  const dir = resolve(PROJECT_ROOT, "runs", "_images", docId);
  const out: DocImage[] = [];
  for (const [index, ref] of refs.entries()) {
    const obj = objects[ref.objectId];
    const emb = obj?.inlineObjectProperties?.embeddedObject ?? obj?.positionedObjectProperties?.embeddedObject;
    const contentUri = emb?.imageProperties?.contentUri ?? null;
    const img: DocImage = {
      index,
      afterLineIndex: ref.afterLineIndex,
      objectId: ref.objectId,
      contentUri,
      alt: (emb?.description || emb?.title || "").trim(),
      filePath: null,
      mimeType: null,
    };
    if (contentUri) {
      try {
        const data = await fetchBytes(contentUri);
        const mime = sniffImageMime(data);
        if (!mime) throw new Error("downloaded data is not an image");
        await mkdir(dir, { recursive: true });
        img.filePath = resolve(dir, `img-${index}.${extFor(mime)}`);
        img.mimeType = mime;
        await writeFile(img.filePath, data);
      } catch (err) {
        img.downloadError = (err as Error).message;
      }
    } else {
      img.downloadError = "image has no contentUri (drawing or unsupported embed)";
    }
    out.push(img);
  }
  return out;
}

/** GET with 2 retries (§9: images retry 2×). */
export async function fetchBytes(url: string, retries = 2): Promise<Buffer> {
  let lastErr: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (i < retries) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error(`download failed for ${url.slice(0, 80)}…: ${(lastErr as Error).message}`);
}

export async function downloadDriveFile(fileId: string): Promise<{ data: Buffer; name: string }> {
  const { drive } = await googleClients();
  try {
    const meta = await drive.files.get({ fileId, fields: "name,mimeType", supportsAllDrives: true });
    const res = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
    return { data: Buffer.from(res.data as ArrayBuffer), name: meta.data.name ?? `drive-${fileId}` };
  } catch (err) {
    accessError(err, `Drive file ${fileId}`);
  }
}
