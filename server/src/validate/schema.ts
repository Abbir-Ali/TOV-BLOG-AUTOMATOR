import { z } from "zod";
import { CONTENT_TYPES } from "../config/contentTypes.js";

/** §6 payload shape (`05-payload.json`). */

export const AdvisorySchema = z.object({
  field: z.string().optional(),
  message: z.string(),
});

export const PayloadSchema = z.object({
  contentType: z.enum(CONTENT_TYPES),
  source: z.object({
    docId: z.string().min(1, "source.docId is required (used for the src:<docId> tag)"),
    docUrl: z.string().optional(),
  }),
  article: z.object({
    title: z.string(),
    bodyHtml: z.string(),
    summary: z.string().optional(),
    tags: z.array(z.string()).optional(),
    authorName: z.string().optional(),
    image: z
      .object({ url: z.string(), altText: z.string().optional() })
      .nullable()
      .optional(),
  }),
  metafields: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Keyed by metafield key (namespace custom). Send natural values: strings; arrays/objects for json fields; " +
        "array of product GIDs for article_featured_product; plain string or rich-text object for quick_scoop_content; " +
        "true for add_schema_mentions. The server serializes and types them (§8).",
    ),
  advisories: z.array(AdvisorySchema).optional(),
  checklist: z.array(z.string()).optional(),
});

export type Payload = z.infer<typeof PayloadSchema>;
export type Advisory = z.infer<typeof AdvisorySchema>;

export interface Issue {
  field: string;
  message: string;
  kind: "shape" | "required" | "allowlist" | "type" | "verbatim" | "structure" | "derived";
}

export interface MetafieldInput {
  namespace: string;
  key: string;
  type: string;
  value: string;
}
