import type { ContentType } from "../config/contentTypes.js";
import type { Advisory } from "../validate/schema.js";

export interface ProductCardDraft {
  title: string;
  badge: string;
  badge_color: string;
  badge_text_color: string;
  description: string;
  bullets: string[];
  footer_label: string;
  footer_text: string;
}

/** Already-uploaded inline image to place in the body after `afterLineIndex` (line index in the parsed text). */
export interface InlineImage {
  afterLineIndex: number;
  url?: string;
  alt?: string;
  role?: "featured" | "inline";
}

export interface Unparsed {
  kind: string;
  text?: string;
  lineIndex?: number;
  format?: string;
  field?: string;
  hint?: string;
}

export interface ParseResult {
  contentType: ContentType;
  /** Partial §6 payload (source + image are filled by later agents). */
  payload: {
    contentType: ContentType;
    article: {
      title: string;
      bodyHtml: string;
      summary: string;
      tags: string[];
      authorName: string;
      image: null;
    };
    metafields: Record<string, unknown>;
    advisories: Advisory[];
    checklist: string[];
  };
  /** One entry per product to resolve (Inspired cards or Press PRODUCTS). */
  productCards: {
    slot: string;
    index: number;
    productRef: { query: string; url: string | null };
  }[];
  featuredImage: { source: string | null; alt: string; labelLineIndex: number | null };
  editor: Record<string, string>;
  subtitle: string;
  /** Required labels the doc lacks → BLOCK with these exact names. */
  missing: string[];
  /** Mechanical decisions the parser made that a reviewer may want to see. */
  decisions: string[];
  /** Judgement calls left for the Extractor. */
  unparsed: Unparsed[];
}
