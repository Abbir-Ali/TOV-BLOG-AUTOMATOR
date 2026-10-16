import {
  AUTHOR_FALLBACK,
  BADGE_TEXT_COLOR,
  CARD_METAFIELDS,
  DESIGN_BOX_PARAGRAPH,
  FEATURED_BLOG_CHECKLIST,
  KNOWN_BADGES,
  PLACEHOLDERS,
  SIDEBAR_DEFAULTS,
  escapeHtml,
  footerLabel,
  titleCase,
  toTag,
} from "../config/contentTypes.js";
import { richTextFromPlain } from "../validate/metafields.js";
import type { Advisory } from "../validate/schema.js";
import { endsWithTerminal, splitLabels, splitNameUrl } from "./detect.js";
import type { InlineImage, ParseResult, ProductCardDraft, Unparsed } from "./types.js";

/** §7.1–7.4 deterministic Inspired parser (no AI). Judgement calls go to `unparsed` for the Extractor. */

const HEADER_LABELS = [
  "HEADLINE",
  "SUBTITLE",
  "READ TIME",
  "TAGS",
  "SUMMARY (TLDR)",
  "SUMMARY",
  "FEATURED IMAGE ALT",
  "FEATURED IMAGE",
  "IN THIS ARTICLE",
  "PRODUCT LINKS",
  "EDITOR METADATA",
] as const;
const META_LABELS = ["Week", "Owner", "Existing URL", "Internal links FROM", "Editor notes"] as const;
// Allow optional trailing content on the FORMAT line (e.g. "CTA LINK:" in the same table cell).
const FORMAT_RE = /^\[FORMAT:\s*(TYPE_\d+_[A-Z]+)\s*\]/i;
const CTA_LINK_RE = /^CTA LINK\s*:\s*(\S+)\s*$/i;
const CTA_LINK_EMPTY_RE = /^CTA LINK\s*:\s*$/i;
const BEST_FOR_RE = /(?:^|(?<=[.!?]["”'’)]*)\s+)Best for\b/;

interface Line {
  i: number;
  text: string;
}

interface Section {
  format: string;
  lines: Line[];
}

/** Sub-heading: short line without terminal punctuation, followed by a paragraph. */
const isSubheading = (s: string) => !endsWithTerminal(s) && s.split(/\s+/).length <= 12 && !/^https?:\/\//.test(s);

export function parseInspired(text: string, images: InlineImage[] = []): ParseResult {
  // Drop blank lines, // comment lines, and the TOV brief template's structural label lines
  // (e.g. "Text section — heading + paragraphs", "Article body", "Before you submit", etc.)
  // These are only noise; the [FORMAT: …] markers themselves are the real section boundaries.
  const TEMPLATE_NOISE = /^(?:(?:Text section|Tips or how-to|Product options|Product roundup|Comparison card|FAQ|Call to action)\s*[—–-]|Article (?:header|body)|Navigation and products|Before you submit|☐\s)/i;
  const lines: Line[] = text
    .split(/\r?\n/)
    .map((t, i) => ({ i, text: t.trim() }))
    .filter((l) => l.text && !l.text.startsWith("//") && !TEMPLATE_NOISE.test(l.text));
  const advisories: Advisory[] = [];
  const unparsed: Unparsed[] = [];
  const missing: string[] = [];
  const decisions: string[] = [];
  const checklist: string[] = [FEATURED_BLOG_CHECKLIST];

  // ---- header (everything before the first [FORMAT]) ----
  const header = new Map<string, string>();
  const meta = new Map<string, string>();
  const toc: string[] = [];
  const productLinks: { name: string; url: string | null }[] = [];
  const sections: Section[] = [];
  let featuredImageLine: number | null = null;
  let mode: "header" | "toc" | "links" | "section" = "header";
  let lastLabel: string | null = null;
  let lastMetaLabel: string | null = null;

  for (const l of lines) {
    const fmt = FORMAT_RE.exec(l.text);
    if (fmt) {
      sections.push({ format: fmt[1]!.toUpperCase(), lines: [] });
      mode = "section";
      // "CTA LINK: https://…" may appear on the same line as the FORMAT marker in table-based templates
      const trailing = l.text.slice(fmt[0].length).trim();
      if (trailing) sections[sections.length - 1]!.lines.push({ i: l.i, text: trailing });
      continue;
    }
    const labels = splitLabels(l.text, HEADER_LABELS);
    if (labels?.has("PRODUCT LINKS")) {
      mode = "links";
      const v = labels.get("PRODUCT LINKS");
      if (v) productLinks.push(splitNameUrl(v));
      continue;
    }
    if (mode === "links") {
      productLinks.push(splitNameUrl(l.text));
      continue;
    }
    if (mode === "section") {
      sections[sections.length - 1]!.lines.push(l);
      continue;
    }
    if (labels) {
      mode = labels.has("IN THIS ARTICLE") ? "toc" : "header";
      lastMetaLabel = null;
      for (const [k, v] of labels) {
        if (k === "EDITOR METADATA" || k === "IN THIS ARTICLE") continue;
        header.set(k === "SUMMARY" ? "SUMMARY (TLDR)" : k, v);
        if (k === "FEATURED IMAGE") featuredImageLine = l.i;
      }
      lastLabel = [...labels.keys()].pop()!;
      continue;
    }
    if (mode === "toc") {
      toc.push(l.text);
      continue;
    }
    const m = splitLabels(l.text, META_LABELS);
    if (m) {
      for (const [k, v] of m) meta.set(k, v.replace(/\s*\/\s*$/, "").trim());
      lastMetaLabel = [...m.keys()].pop()!;
      lastLabel = null;
      continue;
    }
    // Multi-line meta fields (e.g. Editor notes spanning several lines).
    if (lastMetaLabel && meta.get(lastMetaLabel) !== undefined) {
      const cur = meta.get(lastMetaLabel)!;
      meta.set(lastMetaLabel, cur ? `${cur}\n${l.text}` : l.text);
      continue;
    }
    if (l.text === "EDITOR METADATA") continue;
    // A label with an empty value takes the next line (e.g. "SUMMARY (TLDR):" on its own line).
    if (lastLabel && lastLabel !== "FEATURED IMAGE" && header.get(lastLabel === "SUMMARY" ? "SUMMARY (TLDR)" : lastLabel) === "") {
      header.set(lastLabel === "SUMMARY" ? "SUMMARY (TLDR)" : lastLabel, l.text);
      lastLabel = null;
      continue;
    }
    unparsed.push({ kind: "unknown-line", lineIndex: l.i, text: l.text });
  }

  const title = header.get("HEADLINE") ?? "";
  const summary = header.get("SUMMARY (TLDR)") ?? "";
  const readTime = header.get("READ TIME") ?? "";
  const rawTags = (header.get("TAGS") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (!title) missing.push("HEADLINE");
  if (!summary) missing.push("SUMMARY (TLDR)");
  if (!readTime) missing.push("READ TIME");
  if (!rawTags.length) missing.push("TAGS");
  if (!toc.length) advisories.push({ field: "article_toc_title", message: "No IN THIS ARTICLE list — headings taken from FORMAT sections" });

  const owner = meta.get("Owner") ?? "";
  const author = owner || AUTHOR_FALLBACK;
  if (!owner) advisories.push({ field: "article_author", message: `No Owner in EDITOR METADATA — author set to "${AUTHOR_FALLBACK}"` });
  const editorNotes = meta.get("Editor notes") ?? "";
  if (editorNotes) unparsed.push({ kind: "editor-notes", text: editorNotes, hint: "Turn action items into checklist entries; check for sidebar overrides and expert-quote slots" });
  const internal = meta.get("Internal links FROM");
  if (internal && !/^none$/i.test(internal)) checklist.push(`Add internal links FROM: ${internal}`);

  // ---- sections → body ----
  const blocks: { lineIndex: number; html: string; tocN?: number }[] = [];
  const h2s: string[] = [];
  const cardSlots: ProductCardDraft[][] = [];
  const productCards: ParseResult["productCards"] = [];
  const faqs: { question: string; answer: string }[] = [];
  const cta: { title?: string; text?: string; label?: string; link?: string } = {};
  let tocN = 0;
  const p = (s: string) => `<p>${escapeHtml(s)}</p>`;

  for (const sec of sections) {
    const [head, ...rest] = sec.lines;
    if (!head) {
      unparsed.push({ kind: "empty-section", format: sec.format });
      continue;
    }
    const isContent = !/TYPE_4|TYPE_5/.test(sec.format);
    if (isContent) {
      tocN++;
      h2s.push(head.text);
      blocks.push({ lineIndex: head.i, html: `<h2 id="toc${tocN}">${escapeHtml(head.text)}</h2>`, tocN });
      if (toc.length && !toc.includes(head.text)) {
        advisories.push({ field: "bodyHtml", message: `Section heading "${head.text}" is not in IN THIS ARTICLE` });
      }
    }

    switch (sec.format.replace(/_[A-Z]+$/, "")) {
      case "TYPE_1":
        for (const l of rest) blocks.push({ lineIndex: l.i, html: p(l.text) });
        break;

      case "TYPE_3":
        rest.forEach((l, k) => {
          const next = rest[k + 1];
          const h3 = isSubheading(l.text) && next && !isSubheading(next.text);
          blocks.push({ lineIndex: l.i, html: h3 ? `<h3>${escapeHtml(l.text)}</h3>` : p(l.text) });
        });
        break;

      case "TYPE_2": {
        const slot = cardSlots.length;
        if (slot >= 2) {
          missing.push("More than two TYPE_2_OPTIONS sections (only two card slots exist)");
          break;
        }
        const firstName = rest.findIndex((l, k) => !endsWithTerminal(l.text) && rest[k + 1] && endsWithTerminal(rest[k + 1]!.text));
        const intro = firstName === -1 ? rest : rest.slice(0, firstName);
        for (const l of intro) blocks.push({ lineIndex: l.i, html: p(l.text) });
        blocks.push({ lineIndex: (intro.at(-1) ?? head).i, html: PLACEHOLDERS[slot]! });

        const cards: ProductCardDraft[] = [];
        if (firstName !== -1) {
          let cur: { name: Line; desc: Line[] } | null = null;
          const flush = () => cur && cards.push(buildCard(cur.name.text, cur.desc.map((d) => d.text), slot, cards.length, advisories, unparsed));
          for (const l of rest.slice(firstName)) {
            if (!endsWithTerminal(l.text) && (!cur || cur.desc.length)) {
              flush();
              cur = { name: l, desc: [] };
            } else if (cur) cur.desc.push(l);
          }
          flush();
        }
        if (!cards.length) unparsed.push({ kind: "type2-no-cards", format: sec.format, text: rest.map((l) => l.text).join("\n") });
        cardSlots.push(cards);
        break;
      }

      case "TYPE_4": {
        let q: string | null = null;
        let ans: string[] = [];
        const flush = () => {
          if (q && ans.length) faqs.push({ question: q, answer: ans.join(" ") });
          else if (q) unparsed.push({ kind: "faq-no-answer", text: q });
        };
        for (const l of rest) {
          if (/\?["”'’)]*$/.test(l.text)) {
            flush();
            q = l.text;
            ans = [];
          } else if (q) ans.push(l.text);
          else unparsed.push({ kind: "faq-orphan-line", lineIndex: l.i, text: l.text });
        }
        flush();
        break;
      }

      case "TYPE_5": {
        cta.title = head.text;
        const body = rest.filter((l) => {
          const m = CTA_LINK_RE.exec(l.text);
          if (m) cta.link = m[1];
          return !m && !CTA_LINK_EMPTY_RE.test(l.text);
        });
        if (body.length >= 2) {
          cta.label = body.at(-1)!.text;
          cta.text = body.slice(0, -1).map((l) => l.text).join("\n");
        } else {
          missing.push("TYPE_5_CTA paragraph and button label");
        }
        break;
      }

      case "TYPE_6":
        blocks.push({ lineIndex: head.i, html: `<!-- TYPE_6:toc${tocN} -->` });
        unparsed.push({
          kind: "type6-comparison",
          hint: `Build the §7.2 comparison card from these lines and replace <!-- TYPE_6:toc${tocN} --> in bodyHtml`,
          text: rest.map((l) => l.text).join("\n"),
        });
        break;

      default:
        unparsed.push({ kind: "unknown-format", format: sec.format, text: sec.lines.map((l) => l.text).join("\n") });
    }
  }
  if (!cta.title) missing.push("TYPE_5_CTA heading");

  // ---- product links → card refs ----
  cardSlots.forEach((cards, slot) =>
    cards.forEach((card, index) => {
      const link = matchLink(card.title, productLinks);
      productCards.push({ slot: CARD_METAFIELDS[slot]!, index, productRef: { query: card.title, url: link?.url ?? null } });
    }),
  );
  if (productLinks.length) {
    const used = new Set(productCards.map((c) => c.productRef.url).filter(Boolean));
    for (const l of productLinks) if (l.url && !used.has(l.url)) unparsed.push({ kind: "unmatched-product-link", text: `${l.name} — ${l.url}` });
  }

  // ---- badge colours (known fixed; others cycle, never shared) ----
  assignBadgeColors(cardSlots.flat());

  // ---- Design Box rule (Editor notes ask for an expert/designer quote in a named section) ----
  if (editorNotes && /(expert|designer|design services)/i.test(editorNotes)) {
    const quoted = [...editorNotes.matchAll(/["“]([^"”]+)["”]\s*section/gi)].map((m) => m[1]!.trim());
    const targets = h2s.map((h, k) => ({ h, n: k + 1 })).filter(({ h }) => quoted.some((q) => h.toLowerCase().startsWith(q.toLowerCase())));
    if (targets.length === 1) {
      const n = targets[0]!.n;
      const nextH2 = blocks.findIndex((b) => b.tocN === n + 1);
      const at = nextH2 === -1 ? blocks.length : nextH2;
      // Insert before any trailing TYPE_4/5 content (which never lands in the body anyway).
      blocks.splice(at, 0, { lineIndex: blocks[at - 1]?.lineIndex ?? 0, html: DESIGN_BOX_PARAGRAPH });
      decisions.push(`Design Box paragraph appended to section "${targets[0]!.h}" (Editor notes ask for an expert quote there)`);
    } else {
      unparsed.push({ kind: "design-box", text: editorNotes, hint: "Editor notes mention an expert/designer quote — decide which section gets the Design Box paragraph" });
    }
  }

  // ---- inline images ----
  for (const img of images) {
    if (featuredImageLine !== null && img.afterLineIndex >= featuredImageLine && img.afterLineIndex <= featuredImageLine + 1 && img.role !== "inline") continue;
    if (!img.url) continue;
    let pos = -1;
    for (let k = 0; k < blocks.length; k++) if (blocks[k]!.lineIndex <= img.afterLineIndex) pos = k;
    if (pos === -1) continue;
    blocks.splice(pos + 1, 0, { lineIndex: img.afterLineIndex, html: `<img src="${img.url}" alt="${escapeAttr(img.alt ?? "")}">` });
    if (!img.alt) advisories.push({ field: "bodyHtml", message: `Inline image after line ${img.afterLineIndex} has no alt text` });
  }

  // ---- featured image ----
  const featuredSource = header.get("FEATURED IMAGE") || null;
  const featuredAlt = header.get("FEATURED IMAGE ALT") ?? "";
  if (featuredImageLine === null) advisories.push({ field: "image", message: "No FEATURED IMAGE in doc — upload during review" });

  // ---- metafields ----
  const tags = rawTags.map(toTag);
  const tagWords = rawTags.map(titleCase);
  const metafields: Record<string, unknown> = {
    reading_time: readTime || undefined,
    blogtagline: tagWords.length ? tagWords.slice(0, 2).join(" · ") : undefined,
    homepage_display_tag: tagWords[0],
    article_toc_title: h2s.join("||") || undefined,
    article_author: author,
    quick_scoop_content: summary ? richTextFromPlain(summary) : undefined,
    ...SIDEBAR_DEFAULTS,
    cta_title_1: cta.title,
    cta_text_1: cta.text,
    cta_button_label_1: cta.label,
    cta_button_link_1: cta.link,
    custom_content_with_badge: cardSlots[0]?.length ? cardSlots[0] : undefined,
    custom_content_with_badge2: cardSlots[1]?.length ? cardSlots[1] : undefined,
    faqs: faqs.length ? faqs : undefined,
  };
  for (const k of Object.keys(metafields)) if (metafields[k] === undefined) delete metafields[k];
  if (!cta.link) advisories.push({ field: "cta_button_link_1", message: "Not in doc — add during review" });
  if (cardSlots.flat().length) checklist.push("Confirm product links in the product cards");

  return {
    contentType: "inspired",
    payload: {
      contentType: "inspired",
      article: {
        title,
        bodyHtml: blocks.map((b) => b.html).join("\n"),
        summary,
        tags,
        authorName: author,
        image: null,
      },
      metafields,
      advisories,
      checklist,
    },
    productCards,
    featuredImage: { source: featuredSource, alt: featuredAlt, labelLineIndex: featuredImageLine },
    editor: Object.fromEntries(meta),
    subtitle: header.get("SUBTITLE") ?? "",
    missing,
    decisions,
    unparsed,
  };
}

function buildCard(
  nameLine: string,
  descLines: string[],
  slot: number,
  index: number,
  advisories: Advisory[],
  unparsed: Unparsed[],
): ProductCardDraft {
  let title = nameLine;
  let badge = "";
  for (const b of Object.keys(KNOWN_BADGES)) {
    const re = new RegExp(`\\s+${b.replace(/\s+/g, "\\s+")}\\s*$`, "i");
    if (re.test(nameLine)) {
      title = nameLine.replace(re, "").trim();
      badge = nameLine.slice(title.length).trim();
      break;
    }
  }
  const field = `${CARD_METAFIELDS[slot]}[${index}]`;
  if (!badge) {
    unparsed.push({ kind: "badge-check", field, text: nameLine, hint: "Name line has no known badge — split off an unknown badge if the line ends with one" });
  }

  const para = descLines.join(" ");
  let description = para;
  let bullets: string[] = [];
  const m = BEST_FOR_RE.exec(para);
  if (m) {
    const start = m.index + (m[0].length - m[0].trimStart().length);
    const rest = para.slice(start);
    const end = /[.!?]["”'’)]*(?=\s|$)/.exec(rest);
    const sentence = end ? rest.slice(0, end.index + end[0].length) : rest;
    const after = rest.slice(sentence.length).trim();
    description = para.slice(0, start).trim();
    bullets = [sentence.trim()];
    if (after) unparsed.push({ kind: "text-after-best-for", field, text: after, hint: "Text after the Best for… sentence was left out of the description" });
  } else {
    advisories.push({ field, message: `No "Best for…" sentence for "${title}"` });
  }

  return {
    title,
    badge,
    badge_color: "",
    badge_text_color: BADGE_TEXT_COLOR,
    description,
    bullets,
    footer_label: footerLabel(title),
    footer_text: "",
  };
}

/** Known badges use their fixed colour; other badges cycle the palette, one colour per distinct badge. */
export function assignBadgeColors(cards: ProductCardDraft[]): void {
  const others = new Map<string, string>();
  const palette = ["#805e39", "#8a5955", "#5b5e4b", "#645248", "#1d3037"];
  for (const c of cards) {
    if (!c.badge) {
      c.badge_color = "";
      continue;
    }
    const known = Object.entries(KNOWN_BADGES).find(([b]) => b.toLowerCase() === c.badge.toLowerCase());
    if (known) {
      c.badge_color = known[1];
      continue;
    }
    const key = c.badge.toLowerCase();
    if (!others.has(key)) others.set(key, palette[others.size % palette.length]!);
    c.badge_color = others.get(key)!;
  }
}

function matchLink(title: string, links: { name: string; url: string | null }[]) {
  const t = title.toLowerCase();
  return (
    links.find((l) => l.name.toLowerCase() === t) ??
    links.find((l) => t.startsWith(l.name.toLowerCase()) || l.name.toLowerCase().startsWith(t)) ??
    links.find((l) => l.name && t.split(/\s+/)[0] === l.name.toLowerCase().split(/\s+/)[0])
  );
}

const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, "&quot;");
