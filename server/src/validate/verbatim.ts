/**
 * §5 Verbatim check. Both the value and the source are normalized (strip HTML tags, decode entities, collapse
 * whitespace, unify quotes/dashes); the value must then be a substring of the source.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  rarr: "→",
  middot: "·",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

export const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ");

export function normalize(s: string): string {
  return decodeEntities(stripTags(s))
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[   ​﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Prepared source so repeated checks don't re-normalize it. */
export class Source {
  readonly norm: string;
  readonly lower: string;
  constructor(text: string) {
    this.norm = normalize(text);
    this.lower = this.norm.toLowerCase();
  }
  /** Exact (case-sensitive) verbatim check. Empty values trivially pass. */
  has(value: string): boolean {
    const v = normalize(value);
    return v === "" || this.norm.includes(v);
  }
  /** Case-insensitive check, only for derived values (title-cased tags etc.). */
  hasLoose(value: string): boolean {
    const v = normalize(value).toLowerCase();
    return v === "" || this.lower.includes(v);
  }
}

export const preview = (s: string, n = 120) => {
  const t = normalize(s);
  return t.length > n ? `${t.slice(0, n)}…` : t;
};
