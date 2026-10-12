import { PRESS_LINK_TEXT, escapeHtml } from "../config/contentTypes.js";
import type { Advisory } from "../validate/schema.js";
import { splitLabels, splitNameUrl } from "./detect.js";
import type { ParseResult, Unparsed } from "./types.js";

/** §7.5 deterministic Press parser. */

const LABELS = [
  "CONTENT TYPE",
  "OWNER",
  "HEADLINE",
  "PUBLICATION",
  "ARTICLE URL",
  "COVERAGE DATE",
  "SUMMARY",
  "PRODUCTS",
  "FEATURED IMAGE ALT",
  "FEATURED IMAGE",
] as const;

export function parsePress(text: string): ParseResult {
  const lines = text.split(/\r?\n/).map((t, i) => ({ i, text: t.trim() })).filter((l) => l.text);
  const fields = new Map<string, string>();
  const products: { name: string; url: string | null }[] = [];
  const unparsed: Unparsed[] = [];
  const advisories: Advisory[] = [];
  const missing: string[] = [];
  let current: string | null = null;
  let featuredImageLine: number | null = null;

  for (const l of lines) {
    const labels = splitLabels(l.text, LABELS);
    if (labels) {
      for (const [k, v] of labels) {
        if (k === "PRODUCTS") {
          if (v) products.push(splitNameUrl(v));
        } else fields.set(k, v);
        if (k === "FEATURED IMAGE") featuredImageLine = l.i;
        current = k;
      }
      continue;
    }
    if (current === "PRODUCTS") products.push(splitNameUrl(l.text));
    else if (current && fields.get(current) === "" && current !== "FEATURED IMAGE") fields.set(current, l.text);
    else if (current === "SUMMARY") fields.set("SUMMARY", `${fields.get("SUMMARY")}\n${l.text}`);
    else unparsed.push({ kind: "unknown-line", lineIndex: l.i, text: l.text });
  }

  const get = (k: string) => fields.get(k)?.trim() ?? "";
  for (const k of ["OWNER", "HEADLINE", "PUBLICATION", "ARTICLE URL", "SUMMARY"]) if (!get(k)) missing.push(k);
  if (!products.length) missing.push("PRODUCTS (at least one)");

  const articleUrl = get("ARTICLE URL");
  if (articleUrl) {
    try {
      if (new URL(articleUrl).protocol !== "https:") missing.push("ARTICLE URL (must be https)");
    } catch {
      missing.push("ARTICLE URL (not a valid URL)");
    }
  }
  const summary = get("SUMMARY");
  if (summary.includes("\n")) unparsed.push({ kind: "multi-paragraph-summary", text: summary, hint: "Press body is a single <p>; joined with a space" });
  if (featuredImageLine === null) advisories.push({ field: "image", message: "No FEATURED IMAGE in doc — upload during review" });
  for (const pr of products) if (!pr.url) advisories.push({ field: "Article_Featured_product", message: `No URL for product "${pr.name}" — matched by name` });

  return {
    contentType: "press",
    payload: {
      contentType: "press",
      article: {
        title: get("HEADLINE"),
        bodyHtml: summary ? `<p>${escapeHtml(summary.replace(/\s*\n\s*/g, " "))}</p>` : "",
        summary: "",
        tags: [],
        authorName: get("OWNER"),
        image: null,
      },
      metafields: {
        ...(get("PUBLICATION") && { featured: get("PUBLICATION") }),
        ...(articleUrl && { customurl: articleUrl }),
        customlink_text: PRESS_LINK_TEXT,
        Add_Schema_Mentions: true,
      },
      advisories,
      checklist: get("COVERAGE DATE") ? [`Coverage date in doc: ${get("COVERAGE DATE")}`] : [],
    },
    productCards: products.map((p, index) => ({ slot: "Article_Featured_product", index, productRef: { query: p.name, url: p.url } })),
    featuredImage: { source: get("FEATURED IMAGE") || null, alt: get("FEATURED IMAGE ALT"), labelLineIndex: featuredImageLine },
    editor: {},
    subtitle: "",
    missing,
    decisions: [],
    unparsed,
  };
}
