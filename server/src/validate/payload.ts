import {
  AUTHOR_FALLBACK,
  BADGE_TEXT_COLOR,
  CARD_KEYS,
  CARD_METAFIELDS,
  CONFIRM_IMAGE_PLACEHOLDER,
  DESIGN_BOX_PARAGRAPH,
  KNOWN_BADGES,
  LINK_STYLE,
  OTHER_BADGE_COLORS,
  PLACEHOLDERS,
  PRESS_LINK_TEXT,
  SIDEBAR_DEFAULTS,
  footerLabel,
  titleCase,
} from "../config/contentTypes.js";
import { REQUIRED_METAFIELDS } from "../config/metafields.js";
import type { MetafieldDefinition } from "../shopify/definitions.js";
import { buildMetafieldInputs, richTextFromPlain, richTextValues, type RichTextNode } from "./metafields.js";
import { PayloadSchema, type Advisory, type Issue, type MetafieldInput, type Payload } from "./schema.js";
import { normalize, preview, Source } from "./verbatim.js";

/**
 * §5 validate_payload — the same validator create/update run internally.
 * Types, required fields, allowlist, verbatim check, placeholder counts, TOC ↔ h2 consistency,
 * JSON shape, no newlines in single-line fields.
 */

export interface ValidationResult {
  ok: boolean;
  errors: Issue[];
  advisories: Advisory[];
  payload?: Payload;
  metafieldInputs: MetafieldInput[];
}

const SYSTEM_TAG = /^(src:|mcp-test$)/;
const CARD_FOOTER = /^<a href="(https:\/\/[^"\s]+)" style="color: rgb\(183, 91, 100\);">([^<]+)<\/a>$/;
const NORM_DESIGN_BOX = normalize(DESIGN_BOX_PARAGRAPH);

export function h2Headings(html: string): { id: string | null; text: string }[] {
  return [...html.matchAll(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi)].map((m) => ({
    id: /\bid\s*=\s*"([^"]*)"/i.exec(m[1]!)?.[1] ?? null,
    text: normalize(m[2]!),
  }));
}

/** Splits body HTML into text segments at block boundaries and <br>, after removing allowed fixed content. */
function bodySegments(html: string): string[] {
  let h = html.split(DESIGN_BOX_PARAGRAPH).join("\n");
  for (const p of PLACEHOLDERS) h = h.split(p).join("\n");
  h = h
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|h[1-6]|li|ul|ol|div|table|thead|tbody|tfoot|tr|td|th|blockquote|figure|figcaption|section)\b[^>]*>/gi, "\n")
    .replace(/<img\b[^>]*>/gi, "\n");
  return h
    .split("\n")
    .map((s) => normalize(s))
    .filter(Boolean);
}

function check(cond: boolean, errors: Issue[], field: string, kind: Issue["kind"], message: string) {
  if (!cond) errors.push({ field, kind, message });
}

export function validatePayload(raw: unknown, sourceText: string, defs?: MetafieldDefinition[]): ValidationResult {
  const errors: Issue[] = [];
  const advisories: Advisory[] = [];

  const parsed = PayloadSchema.safeParse(raw);
  if (!parsed.success) {
    for (const i of parsed.error.issues) errors.push({ field: i.path.join("."), kind: "shape", message: i.message });
    return { ok: false, errors, advisories, metafieldInputs: [] };
  }
  const p = parsed.data;
  const ct = p.contentType;
  const a = p.article;
  const mf = { ...(p.metafields ?? {}) } as Record<string, unknown>;
  const src = new Source(sourceText);
  if (!src.norm) errors.push({ field: "sourceText", kind: "required", message: "sourceText is empty — pass fetch_google_doc's sourceText" });

  const verb = (field: string, value: string | undefined | null) => {
    if (value && !src.has(value)) {
      errors.push({ field, kind: "verbatim", message: `Not found verbatim in source: "${preview(value)}"` });
    }
  };
  const verbOrFixed = (field: string, value: unknown, fixed: string) => {
    if (typeof value === "string" && value !== fixed) verb(field, value);
  };

  // ---- article fields ----
  check(!!a.title.trim(), errors, "article.title", "required", "title (HEADLINE) is required");
  check(!/[\r\n]/.test(a.title), errors, "article.title", "type", "title must be a single line");
  verb("article.title", a.title);
  check(!!a.bodyHtml.trim(), errors, "article.bodyHtml", "required", "bodyHtml is required");
  if (ct === "inspired") check(!!a.summary?.trim(), errors, "article.summary", "required", "summary (SUMMARY (TLDR)) is required");
  if (a.summary && /<[a-z]/i.test(a.summary)) errors.push({ field: "article.summary", kind: "type", message: "summary must be plain text" });
  verb("article.summary", a.summary);
  if (a.authorName && a.authorName !== AUTHOR_FALLBACK) verb("article.authorName", a.authorName);
  if (ct === "press") check(!!a.authorName?.trim(), errors, "article.authorName", "required", "authorName (OWNER) is required for Press");
  if (a.image?.url) {
    try {
      check(new URL(a.image.url).protocol === "https:", errors, "article.image.url", "type", "image url must be https");
    } catch {
      errors.push({ field: "article.image.url", kind: "type", message: "image url is not a valid URL" });
    }
    verb("article.image.altText", a.image.altText);
    if (!a.image.altText) advisories.push({ field: "article.image.altText", message: "Featured image has no alt text — add during review" });
  } else {
    advisories.push({ field: "article.image", message: "No featured image — upload one during review" });
  }

  const contentTags = (a.tags ?? []).filter((t) => !SYSTEM_TAG.test(t));
  contentTags.forEach((t, i) => {
    check(t === t.toLowerCase() && !/\s/.test(t), errors, `article.tags[${i}]`, "derived", `tag "${t}" must be lowercase with hyphens`);
    if (!src.hasLoose(t.replace(/-/g, " "))) {
      errors.push({ field: `article.tags[${i}]`, kind: "verbatim", message: `tag "${t}" does not come from TAGS in the source` });
    }
  });
  if (ct === "inspired" && !contentTags.length) errors.push({ field: "article.tags", kind: "required", message: "TAGS are required for Inspired" });

  // ---- required metafields ----
  for (const k of REQUIRED_METAFIELDS[ct]) {
    const v = mf[k];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) {
      errors.push({ field: `metafields.${k}`, kind: "required", message: `${k} is required for ${ct}` });
    }
  }

  // ---- content-type specific ----
  if (ct === "inspired") validateInspired(p, mf, contentTags, src, errors, advisories, verb, verbOrFixed);
  else validatePress(p, mf, errors, verb);

  // ---- types / allowlist ----
  const { inputs, errors: typeErrors } = buildMetafieldInputs(ct, mf, defs);
  errors.push(...typeErrors);

  // Pass through the model's advisories after ours (dedupe by normalised field key).
  // Strip "article." / "metafields." prefixes so parser fields like "image" and "cta_button_link_1"
  // match the validator's "article.image" and "metafields.cta_button_link_1".
  const normField = (f: string | undefined) => (f ?? "").replace(/^(article|metafields)\./, "").replace(/^metafields\./, "");
  const seenFields = new Set(advisories.map((x) => normField(x.field)));
  for (const adv of p.advisories ?? []) {
    const key = normField(adv.field);
    if (!seenFields.has(key)) {
      advisories.push(adv);
      seenFields.add(key);
    }
  }

  return { ok: errors.length === 0, errors, advisories, payload: p, metafieldInputs: inputs };
}

function validateInspired(
  p: Payload,
  mf: Record<string, unknown>,
  tags: string[],
  src: Source,
  errors: Issue[],
  advisories: Advisory[],
  verb: (f: string, v: string | undefined | null) => void,
  verbOrFixed: (f: string, v: unknown, fixed: string) => void,
) {
  const body = p.article.bodyHtml;

  // Body verbatim.
  for (const seg of bodySegments(body)) {
    if (seg === NORM_DESIGN_BOX || seg === CONFIRM_IMAGE_PLACEHOLDER) continue;
    const shopThe = /^Shop the (.+) →$/.exec(seg);
    if (shopThe) {
      if (!src.has(shopThe[1]!)) errors.push({ field: "article.bodyHtml", kind: "verbatim", message: `Comparison link product "${shopThe[1]}" not in source` });
      continue;
    }
    if (!src.has(seg)) errors.push({ field: "article.bodyHtml", kind: "verbatim", message: `Body text not found verbatim in source: "${preview(seg)}"` });
  }
  for (const m of body.matchAll(/<img\b[^>]*\balt\s*=\s*"([^"]*)"/gi)) {
    if (m[1] && m[1] !== "[Brand A product]" && m[1] !== "[Brand B product]" && !src.has(m[1])) {
      errors.push({ field: "article.bodyHtml", kind: "verbatim", message: `Image alt not in source: "${preview(m[1])}"` });
    }
  }
  if (/<!--/.test(body)) errors.push({ field: "article.bodyHtml", kind: "structure", message: "Body contains an HTML comment (e.g. an unbuilt <!-- TYPE_6 --> comparison marker)" });
  if (body.includes(CONFIRM_IMAGE_PLACEHOLDER)) advisories.push({ field: "article.bodyHtml", message: "Comparison card image missing — replace [CONFIRM IMAGE URL]" });
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    if (/\balt\s*=\s*""/.test(m[0]) || !/\balt\s*=/.test(m[0])) advisories.push({ field: "article.bodyHtml", message: "Inline image without alt text — add during review" });
  }

  // Body links styled.
  for (const m of body.matchAll(/<a\b[^>]*>/gi)) {
    if (!m[0].includes(`style="${LINK_STYLE}"`)) {
      errors.push({ field: "article.bodyHtml", kind: "structure", message: `Body link missing style="${LINK_STYLE}": ${m[0]}` });
    }
  }

  // h2 ids + TOC consistency.
  const h2s = h2Headings(body);
  h2s.forEach((h, i) => {
    if (h.id !== `toc${i + 1}`) errors.push({ field: "article.bodyHtml", kind: "structure", message: `h2 #${i + 1} "${h.text}" must have id="toc${i + 1}" (has ${h.id ? `"${h.id}"` : "none"})` });
  });
  if (typeof mf.article_toc_title === "string") {
    const toc = mf.article_toc_title.split("||").map((s) => normalize(s));
    const expected = h2s.map((h) => h.text);
    if (toc.join("||") !== expected.join("||")) {
      errors.push({ field: "metafields.article_toc_title", kind: "derived", message: `must equal the body h2 texts joined "||": expected "${expected.join("||")}"` });
    }
  }

  // Placeholders ↔ card metafields.
  CARD_METAFIELDS.forEach((key, i) => {
    const ph = PLACEHOLDERS[i]!;
    const count = body.split(ph).length - 1;
    const has = Array.isArray(mf[key]) ? (mf[key] as unknown[]).length > 0 : !!mf[key];
    if (count > 1) errors.push({ field: "article.bodyHtml", kind: "structure", message: `${ph} appears ${count} times (max 1)` });
    if (count && !has) errors.push({ field: `metafields.${key}`, kind: "structure", message: `${ph} is in the body but ${key} is empty` });
    if (!count && has) errors.push({ field: "article.bodyHtml", kind: "structure", message: `${key} has cards but ${ph} is missing from the body` });
  });
  if (body.includes(PLACEHOLDERS[1]) && !body.includes(PLACEHOLDERS[0])) {
    errors.push({ field: "article.bodyHtml", kind: "structure", message: `${PLACEHOLDERS[1]} used without ${PLACEHOLDERS[0]}` });
  }
  if (/\[\[custom-content-with-badge\d+\]\]/.test(body.replace(PLACEHOLDERS[1], ""))) {
    errors.push({ field: "article.bodyHtml", kind: "structure", message: "More than two TYPE_2 sections — BLOCK (only two card slots exist)" });
  }

  // Derived tag fields.
  const tagWords = tags.map((t) => titleCase(t.replace(/-/g, " ")));
  if (typeof mf.homepage_display_tag === "string" && tagWords.length && mf.homepage_display_tag !== tagWords[0]) {
    errors.push({ field: "metafields.homepage_display_tag", kind: "derived", message: `must be the first tag in title case: "${tagWords[0]}"` });
  }
  if (typeof mf.blogtagline === "string" && tagWords.length) {
    const exp = tagWords.slice(0, 2).join(" · ");
    if (mf.blogtagline !== exp) errors.push({ field: "metafields.blogtagline", kind: "derived", message: `must be the first two tags in title case joined " · ": "${exp}"` });
  }

  // Plain verbatim fields.
  for (const k of ["reading_time", "cta_title_1", "cta_button_label_1"]) if (typeof mf[k] === "string") verb(`metafields.${k}`, mf[k] as string);
  if (typeof mf.cta_text_1 === "string") for (const line of mf.cta_text_1.split(/\r?\n/)) verb("metafields.cta_text_1", line);
  if (typeof mf.cta_button_link_1 === "string") verb("metafields.cta_button_link_1", mf.cta_button_link_1);
  else advisories.push({ field: "metafields.cta_button_link_1", message: "CTA button link not in doc — add during review" });
  verbOrFixed("metafields.article_author", mf.article_author, AUTHOR_FALLBACK);
  for (const [k, def] of Object.entries(SIDEBAR_DEFAULTS)) verbOrFixed(`metafields.${k}`, mf[k], def);

  // Rich text summary.
  if (mf.quick_scoop_content !== undefined) {
    let node = mf.quick_scoop_content as RichTextNode | string;
    if (typeof node === "string") {
      try {
        node = node.trim().startsWith("{") ? (JSON.parse(node) as RichTextNode) : richTextFromPlain(node);
      } catch {
        node = richTextFromPlain(node as string);
      }
    }
    if (node && typeof node === "object") for (const v of richTextValues(node)) verb("metafields.quick_scoop_content", v);
  }

  // FAQs.
  if (mf.faqs !== undefined) {
    const faqs = typeof mf.faqs === "string" ? safeJson(mf.faqs) : mf.faqs;
    if (!Array.isArray(faqs)) errors.push({ field: "metafields.faqs", kind: "type", message: "faqs must be an array" });
    else
      faqs.forEach((f, i) => {
        if (!f || typeof f !== "object" || Array.isArray(f)) {
          errors.push({ field: `metafields.faqs[${i}]`, kind: "type", message: 'each FAQ must be exactly {"question","answer"}' });
          return;
        }
        // Normalise key order: accept {answer, question} as well as {question, answer}.
        const keys = new Set(Object.keys(f));
        if (!keys.has("question") || !keys.has("answer") || keys.size !== 2) {
          errors.push({ field: `metafields.faqs[${i}]`, kind: "type", message: 'each FAQ must be exactly {"question","answer"}' });
          return;
        }
        verb(`metafields.faqs[${i}].question`, f.question);
        verb(`metafields.faqs[${i}].answer`, f.answer);
        if (normalize(body).includes(normalize(f.question))) {
          errors.push({ field: "article.bodyHtml", kind: "structure", message: "FAQ content must not be in the body (TYPE_4 goes only in faqs)" });
        }
      });
  }
  if (typeof mf.cta_title_1 === "string" && h2s.some((h) => h.text === normalize(mf.cta_title_1 as string))) {
    errors.push({ field: "article.bodyHtml", kind: "structure", message: "CTA heading must not be in the body (TYPE_5 goes only in cta_* fields)" });
  }

  // Product cards.
  const badgeColors = new Map<string, string>();
  CARD_METAFIELDS.forEach((key) => {
    if (mf[key] === undefined) return;
    const cards = typeof mf[key] === "string" ? safeJson(mf[key] as string) : mf[key];
    if (!Array.isArray(cards)) {
      errors.push({ field: `metafields.${key}`, kind: "type", message: "must be an array of product cards" });
      return;
    }
    cards.forEach((c, i) => validateCard(c, `metafields.${key}[${i}]`, errors, advisories, badgeColors, verb));
  });
}

function validateCard(
  c: unknown,
  field: string,
  errors: Issue[],
  advisories: Advisory[],
  badgeColors: Map<string, string>,
  verb: (f: string, v: string | undefined | null) => void,
) {
  if (!c || typeof c !== "object" || Array.isArray(c)) {
    errors.push({ field, kind: "type", message: "card must be an object" });
    return;
  }
  // Normalise key order — Claude (and JSON parsers) may reorder keys alphabetically.
  // Re-build the card in CARD_KEYS order so the order check never fails on a valid card.
  const raw = c as Record<string, unknown>;
  const hasAllKeys = CARD_KEYS.every((k) => k in raw);
  const card: Record<string, unknown> = hasAllKeys
    ? Object.fromEntries(CARD_KEYS.map((k) => [k, raw[k]]))
    : raw;
  if (Object.keys(card).join(",") !== CARD_KEYS.join(",")) {
    errors.push({ field, kind: "type", message: `card keys must be exactly, in order: ${CARD_KEYS.join(", ")}` });
    return;
  }
  const str = (k: string) => (typeof card[k] === "string" ? (card[k] as string) : null);
  for (const k of CARD_KEYS) {
    if (k === "bullets") continue;
    if (str(k) === null) errors.push({ field: `${field}.${k}`, kind: "type", message: `${k} must be a string` });
  }
  const title = str("title") ?? "";
  const badge = str("badge") ?? "";
  const color = str("badge_color") ?? "";
  if (!title.trim()) errors.push({ field: `${field}.title`, kind: "required", message: "card title is required" });
  if (/<[a-z]/i.test(title)) errors.push({ field: `${field}.title`, kind: "type", message: "card title must be plain text" });
  verb(`${field}.title`, title);
  verb(`${field}.description`, str("description"));
  const cardText = [title, badge, str("description") ?? "", ...(Array.isArray(card.bullets) ? card.bullets : [])].join(" ");
  if (/\[(CONFIRM|TBD|TODO|ADD|INSERT)[^\]]*\]|\bTBD\b|\bTODO\b/i.test(cardText)) {
    errors.push({ field, kind: "structure", message: "placeholder text inside card JSON is not allowed" });
  }

  // Badge + colour.
  if (!badge) {
    if (color) errors.push({ field: `${field}.badge_color`, kind: "derived", message: "badge_color must be empty when badge is empty" });
    advisories.push({ field: `${field}.badge`, message: `No badge for "${title}" — confirm during review` });
  } else {
    verb(`${field}.badge`, badge);
    const known = Object.entries(KNOWN_BADGES).find(([b]) => b.toLowerCase() === badge.toLowerCase());
    if (known && color !== known[1]) errors.push({ field: `${field}.badge_color`, kind: "derived", message: `"${known[0]}" must use ${known[1]}` });
    if (!known && !OTHER_BADGE_COLORS.includes(color)) {
      errors.push({ field: `${field}.badge_color`, kind: "derived", message: `other badges must use one of ${OTHER_BADGE_COLORS.join(", ")}` });
    }
    const prev = badgeColors.get(color);
    if (prev && prev.toLowerCase() !== badge.toLowerCase()) {
      errors.push({ field: `${field}.badge_color`, kind: "derived", message: `${color} is already used by badge "${prev}" in this post` });
    }
    badgeColors.set(color, badge);
  }
  if (card.badge_text_color !== BADGE_TEXT_COLOR) errors.push({ field: `${field}.badge_text_color`, kind: "derived", message: `must be ${BADGE_TEXT_COLOR}` });

  // Bullets.
  if (!Array.isArray(card.bullets) || card.bullets.length > 1 || card.bullets.some((b) => typeof b !== "string")) {
    errors.push({ field: `${field}.bullets`, kind: "type", message: 'bullets must be ["Best for…"] or []' });
  } else {
    for (const b of card.bullets as string[]) {
      if (!/^Best for\b/i.test(normalize(b))) errors.push({ field: `${field}.bullets`, kind: "structure", message: 'bullet must be the "Best for…" sentence' });
      verb(`${field}.bullets`, b);
    }
    if (!card.bullets.length) advisories.push({ field: `${field}.bullets`, message: `No "Best for…" sentence for "${title}"` });
  }

  // Footer.
  if (str("footer_label") !== footerLabel(title)) {
    errors.push({ field: `${field}.footer_label`, kind: "derived", message: `must be "${footerLabel(title)}"` });
  }
  const ft = str("footer_text") ?? "";
  if (!ft) advisories.push({ field: `${field}.footer_text`, message: `Confirm product link for "${title}"` });
  else {
    const m = CARD_FOOTER.exec(ft);
    if (!m) errors.push({ field: `${field}.footer_text`, kind: "structure", message: `must be "" or <a href="https://…/products/…" style="${LINK_STYLE}">Name</a>` });
    else if (!/\/products\//.test(m[1]!)) errors.push({ field: `${field}.footer_text`, kind: "structure", message: "footer link must point to a product page (/products/…)" });
  }
}

function validatePress(
  p: Payload,
  mf: Record<string, unknown>,
  errors: Issue[],
  verb: (f: string, v: string | undefined | null) => void,
) {
  const body = p.article.bodyHtml.trim();
  const m = /^<p>([\s\S]*)<\/p>$/.exec(body);
  if (!m || /<\/?p\b/i.test(m[1]!)) errors.push({ field: "article.bodyHtml", kind: "structure", message: "Press body must be exactly <p>{SUMMARY}</p>" });
  else verb("article.bodyHtml", m[1]!);
  if (typeof mf.featured === "string") verb("metafields.featured", mf.featured);
  if (typeof mf.customurl === "string") verb("metafields.customurl", mf.customurl);
  if (mf.customlink_text !== undefined && mf.customlink_text !== PRESS_LINK_TEXT) {
    errors.push({ field: "metafields.customlink_text", kind: "derived", message: `must be "${PRESS_LINK_TEXT}"` });
  }
  if (mf.Add_Schema_Mentions !== undefined && mf.Add_Schema_Mentions !== true && mf.Add_Schema_Mentions !== "true") {
    errors.push({ field: "metafields.Add_Schema_Mentions", kind: "derived", message: "must be true" });
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}
