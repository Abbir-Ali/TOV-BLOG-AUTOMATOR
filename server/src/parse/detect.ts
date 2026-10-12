/** §3 content type detection. */
export function detectContentType(text: string): "inspired" | "press" | "unknown" {
  if (/^\s*CONTENT TYPE\s*:\s*PRESS\b/im.test(text)) return "press";
  if (/\[FORMAT:\s*TYPE_\d/i.test(text) || /^\s*HEADLINE\s*:/im.test(text)) return "inspired";
  return "unknown";
}

/**
 * Splits a line holding one or more `LABEL: value` pairs (labels from `labels`, matched case-sensitively in caps)
 * into a map. Returns null when the line does not start with a known label.
 */
export function splitLabels(line: string, labels: readonly string[]): Map<string, string> | null {
  const alt = [...labels].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
  const re = new RegExp(`(?:^|\\s)(${alt})\\s*:`, "g");
  const hits = [...line.matchAll(re)];
  if (!hits.length || line.slice(0, hits[0]!.index).trim() !== "") return null;
  const out = new Map<string, string>();
  hits.forEach((h, i) => {
    const start = h.index! + h[0].length;
    const end = i + 1 < hits.length ? hits[i + 1]!.index! : line.length;
    out.set(h[1]!, line.slice(start, end).trim());
  });
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "Name — URL" / "Name – URL" / "Name - URL" → { name, url } */
export function splitNameUrl(line: string): { name: string; url: string | null } {
  const m = /^(.*?)\s+[—–-]\s+(https?:\/\/\S+)\s*$/.exec(line.trim());
  if (m) return { name: m[1]!.trim(), url: m[2]! };
  const url = /(https?:\/\/\S+)/.exec(line)?.[1] ?? null;
  return { name: url ? line.replace(url, "").replace(/[\s—–-]+$/, "").trim() : line.trim(), url };
}

/** Sentence-ending punctuation, optionally followed by closing quotes/brackets (`…done."`). */
export const endsWithTerminal = (s: string) => /[.!?…:;]["”'’)\]]*$/.test(s.trim());
