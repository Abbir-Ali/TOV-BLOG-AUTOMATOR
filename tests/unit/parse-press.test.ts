import { describe, expect, it } from "vitest";
import { detectContentType } from "../../server/src/parse/detect.js";
import { parseBrief } from "../../server/src/parse/index.js";
import { validatePayload } from "../../server/src/validate/payload.js";

const doc = [
  "CONTENT TYPE: PRESS",
  "OWNER: Cat Dang",
  "HEADLINE: TOV's Dex Ottoman Lands in Architectural Digest",
  "PUBLICATION: Architectural Digest",
  "ARTICLE URL: https://www.architecturaldigest.com/story/best-ottomans",
  "COVERAGE DATE: 2026-10-01",
  "SUMMARY: The Dex Ottoman was named one of the best ottomans of the year.",
  "PRODUCTS:",
  "Dex Ottoman — https://tovfurniture.com/products/dex-ottoman",
  "FEATURED IMAGE: https://example.com/dex.jpg",
  "FEATURED IMAGE ALT: Dex Ottoman in a living room",
].join("\n");

describe("parse_brief — Press", () => {
  const r = parseBrief("press", doc);
  const mf = r.payload.metafields as Record<string, unknown>;

  it("detects and maps all fields", () => {
    expect(detectContentType(doc)).toBe("press");
    expect(r.missing).toEqual([]);
    expect(r.payload.article.title).toBe("TOV's Dex Ottoman Lands in Architectural Digest");
    expect(r.payload.article.bodyHtml).toBe("<p>The Dex Ottoman was named one of the best ottomans of the year.</p>");
    expect(r.payload.article.authorName).toBe("Cat Dang");
    expect(mf).toEqual({
      featured: "Architectural Digest",
      customurl: "https://www.architecturaldigest.com/story/best-ottomans",
      customlink_text: "read the article",
      Add_Schema_Mentions: true,
    });
    expect(r.productCards).toEqual([
      { slot: "Article_Featured_product", index: 0, productRef: { query: "Dex Ottoman", url: "https://tovfurniture.com/products/dex-ottoman" } },
    ]);
    expect(r.featuredImage).toMatchObject({ source: "https://example.com/dex.jpg", alt: "Dex Ottoman in a living room" });
  });

  it("validates once products are resolved", () => {
    const p = { ...r.payload, source: { docId: "1AbCdEfGhIjKlMnOpQrStUvWxYz" }, metafields: { ...mf, Article_Featured_product: ["gid://shopify/Product/42"] } };
    const v = validatePayload(p, doc);
    expect(v.errors).toEqual([]);
    const missing = validatePayload({ ...p, metafields: mf }, doc);
    expect(missing.errors.map((e) => e.field)).toContain("metafields.Article_Featured_product");
  });

  it("reports missing required labels", () => {
    expect(parseBrief("press", "CONTENT TYPE: PRESS\nHEADLINE: Hi").missing).toEqual(
      expect.arrayContaining(["OWNER", "PUBLICATION", "ARTICLE URL", "SUMMARY", "PRODUCTS (at least one)"]),
    );
  });
});
