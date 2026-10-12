import type { ContentType } from "../config/contentTypes.js";
import { parseInspired } from "./inspired.js";
import { parsePress } from "./press.js";
import type { InlineImage, ParseResult } from "./types.js";

/** parse_brief entry point — deterministic, no AI. */
export function parseBrief(contentType: ContentType, text: string, images?: InlineImage[]): ParseResult {
  return contentType === "press" ? parsePress(text) : parseInspired(text, images);
}

export type { ParseResult, InlineImage } from "./types.js";
