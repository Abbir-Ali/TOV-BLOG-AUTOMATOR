import type { ContentType } from "../config/contentTypes.js";
import { allowedKeys, METAFIELDS, NAMESPACE, NEVER_WRITTEN, type MetafieldType } from "../config/metafields.js";
import { CARD_KEYS } from "../config/contentTypes.js";
import type { MetafieldDefinition } from "../shopify/definitions.js";
import type { Issue, MetafieldInput } from "./schema.js";

/** §8 value formatting: natural values in, Shopify-typed `{namespace,key,type,value}` out. */

export interface RichTextNode {
  type: string;
  value?: string;
  children?: RichTextNode[];
  [k: string]: unknown;
}

/** Plain text → Shopify rich text JSON (one paragraph per non-empty line). */
export function richTextFromPlain(text: string): RichTextNode {
  const paras = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    type: "root",
    children: paras.map((p) => ({ type: "paragraph", children: [{ type: "text", value: p }] })),
  };
}

/** All text values inside a rich text tree (for the verbatim check). */
export function richTextValues(node: RichTextNode): string[] {
  const out: string[] = [];
  const walk = (n: RichTextNode) => {
    if (typeof n.value === "string") out.push(n.value);
    n.children?.forEach(walk);
  };
  walk(node);
  return out;
}

const GID_PRODUCT = /^gid:\/\/shopify\/Product\/\d+$/;

function isHttpsUrl(s: string): boolean {
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
}

/** Turns one natural value into the string Shopify expects for `type`. Returns an error message on failure. */
export function serializeValue(key: string, type: MetafieldType | string, raw: unknown): { value?: string; error?: string } {
  switch (type) {
    case "single_line_text_field": {
      if (typeof raw !== "string") return { error: "must be a string" };
      if (/[\r\n]/.test(raw)) return { error: "single-line field must not contain newlines" };
      if (!raw.trim()) return { error: "must not be empty (omit the key instead)" };
      return { value: raw };
    }
    case "multi_line_text_field": {
      if (typeof raw !== "string") return { error: "must be a string" };
      if (!raw.trim()) return { error: "must not be empty (omit the key instead)" };
      return { value: raw };
    }
    case "rich_text_field": {
      let node: unknown = raw;
      if (typeof raw === "string") {
        const t = raw.trim();
        if (t.startsWith("{")) {
          try {
            node = JSON.parse(t);
          } catch {
            return { error: "looks like JSON but does not parse" };
          }
        } else {
          node = richTextFromPlain(raw);
        }
      }
      const n = node as RichTextNode;
      if (!n || typeof n !== "object" || n.type !== "root" || !Array.isArray(n.children) || !n.children.length) {
        return { error: 'must be Shopify rich text JSON {"type":"root","children":[…]} or plain text' };
      }
      return { value: JSON.stringify(n) };
    }
    case "json": {
      let v: unknown = raw;
      if (typeof raw === "string") {
        try {
          v = JSON.parse(raw);
        } catch {
          return { error: "json field: string value does not parse as JSON (send the array/object itself)" };
        }
      }
      if (v === null || typeof v !== "object") return { error: "json field must be an array or object" };
      // Normalise FAQ key order: always {question, answer} regardless of input order.
      if (key === "faqs" && Array.isArray(v)) {
        v = (v as Record<string, unknown>[]).map((f) =>
          f && typeof f === "object" && "question" in f && "answer" in f
            ? { question: f.question, answer: f.answer }
            : f,
        );
      }
      // Normalise product card key order for custom_content_with_badge / custom_content_with_badge2.
      if ((key === "custom_content_with_badge" || key === "custom_content_with_badge2") && Array.isArray(v)) {
        v = (v as Record<string, unknown>[]).map((card) => {
          if (!card || typeof card !== "object") return card;
          const hasAll = CARD_KEYS.every((k) => k in card);
          return hasAll ? Object.fromEntries(CARD_KEYS.map((k) => [k, card[k]])) : card;
        });
      }
      return { value: JSON.stringify(v) };
    }
    case "list.product_reference": {
      let v: unknown = raw;
      if (typeof raw === "string") {
        const t = raw.trim();
        if (t.startsWith("[")) {
          try {
            v = JSON.parse(t);
          } catch {
            return { error: "does not parse as a JSON array" };
          }
        } else v = [t];
      }
      if (!Array.isArray(v) || !v.length) return { error: "must be a non-empty array of product GIDs" };
      const bad = v.filter((g) => typeof g !== "string" || !GID_PRODUCT.test(g));
      if (bad.length) return { error: `not product GIDs: ${JSON.stringify(bad)} (resolve via find_products; never send handles or titles)` };
      return { value: JSON.stringify([...new Set(v as string[])]) };
    }
    case "product_reference": {
      const g = Array.isArray(raw) ? raw[0] : raw;
      if (typeof g !== "string" || !GID_PRODUCT.test(g)) return { error: "must be a product GID" };
      return { value: g };
    }
    case "url": {
      if (typeof raw !== "string" || !isHttpsUrl(raw.trim())) return { error: "must be a valid absolute https URL" };
      return { value: raw.trim() };
    }
    case "boolean": {
      if (raw === true || raw === "true") return { value: "true" };
      if (raw === false || raw === "false") return { value: "false" };
      return { error: 'boolean must be true/false (sent as lowercase "true"/"false")' };
    }
    default:
      return { error: `unsupported metafield type ${type} for ${key}` };
  }
}

/**
 * Applies the allowlist (rule 4), Featured_Blog ban (rule 6) and type rules (rule 5).
 * When live definitions are given, a type disagreement with §8 is an error ("live definitions win — stop and tell Abbir").
 */
export function buildMetafieldInputs(
  ct: ContentType,
  metafields: Record<string, unknown>,
  defs?: MetafieldDefinition[],
): { inputs: MetafieldInput[]; errors: Issue[] } {
  const allowed = new Set(allowedKeys(ct));
  const inputs: MetafieldInput[] = [];
  const errors: Issue[] = [];
  const liveByKey = new Map((defs ?? []).filter((d) => d.namespace === NAMESPACE).map((d) => [d.key, d]));

  for (const [key, raw] of Object.entries(metafields)) {
    const field = `metafields.${key}`;
    if (raw === undefined || raw === null) continue;
    if (NEVER_WRITTEN.has(key)) {
      errors.push({ field, kind: "allowlist", message: `${key} is never written by this tool${key === "Featured_Blog" ? " (marketing sets it during review)" : ""}` });
      continue;
    }
    if (!allowed.has(key)) {
      errors.push({ field, kind: "allowlist", message: `${key} is not an allowed ${ct} metafield` });
      continue;
    }
    let type: string = METAFIELDS[key]!.type;
    if (defs) {
      const live = liveByKey.get(key);
      if (!live) {
        errors.push({ field, kind: "type", message: `No live metafield definition custom.${key} on this store — create it (see §8) or tell Abbir` });
        continue;
      }
      if (live.type !== type) {
        errors.push({
          field,
          kind: "type",
          message: `Live definition type is ${live.type} but §8 says ${type}. Live definitions win — stop and tell Abbir.`,
        });
        continue;
      }
      type = live.type;
    }
    const { value, error } = serializeValue(key, type, raw);
    if (error) errors.push({ field, kind: "type", message: `${key}: ${error}` });
    else inputs.push({ namespace: NAMESPACE, key, type, value: value! });
  }
  return { inputs, errors };
}

/** Converts stored Shopify metafield values back into the natural payload form (for read-back comparison). */
export function parseStoredValue(type: string, value: string): unknown {
  if (type === "json" || type === "rich_text_field" || type.startsWith("list.")) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (type === "boolean") return value === "true";
  return value;
}
