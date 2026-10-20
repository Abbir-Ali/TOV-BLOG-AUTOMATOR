import type { ContentType } from "../config/contentTypes.js";
import { parseInspired } from "./inspired.js";
import { parsePress } from "./press.js";
import type { InlineImage, ParseResult } from "./types.js";

/** parse_brief entry point — deterministic, no AI. */
export function parseBrief(
  contentType: ContentType,
  text: string,
  images?: InlineImage[],
  /** Hyperlinks extracted from the doc body by fetch_google_doc. key=normalised text, value=URL. */
  links?: Record<string, string>,
): ParseResult {
  return contentType === "press"
    ? parsePress(text, links)
    : parseInspired(text, images, links);
}

export type { ParseResult, InlineImage } from "./types.js";
