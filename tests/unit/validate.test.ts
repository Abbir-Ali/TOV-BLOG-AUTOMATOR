import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBrief } from "../../server/src/parse/index.js";
import { buildMetafieldInputs, serializeValue } from "../../server/src/validate/metafields.js";
import { validatePayload } from "../../server/src/validate/payload.js";
import { normalize, Source } from "../../server/src/validate/verbatim.js";

const brief = readFileSync(new URL("../fixtures/storage-ottomans-brief.txt", import.meta.url), "utf8");

function basePayload() {
  const r = parseBrief("inspired", brief);
  return structuredClone({ ...r.payload, source: { docId: "1AbCdEfGhIjKlMnOpQrStUvWxYz" } }) as any;
}

describe("verbatim", () => {
  it("normalizes tags, entities, quotes, dashes and whitespace", () => {
    expect(normalize("<p>It&rsquo;s  a “good” idea &mdash; yes</p>")).toBe(`It's a "good" idea - yes`);
    const s = new Source("Kids’ toys — and more");
    expect(s.has("Kids' toys - and more")).toBe(true);
    expect(s.has("Kids toys")).toBe(false);
  });
});

describe("validate_payload", () => {
  it("passes the parser output for the fixture", () => {
    const v = validatePayload(basePayload(), brief);
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("blocks invented text in the body", () => {
    const p = basePayload();
    p.article.bodyHtml = p.article.bodyHtml.replace("The remote graveyard.", "The remote graveyard, which is very sad.");
    const v = validatePayload(p, brief);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => e.kind === "verbatim" && e.field === "article.bodyHtml")).toBe(true);
  });

  it("blocks paraphrased card descriptions", () => {
    const p = basePayload();
    p.metafields.custom_content_with_badge[0].description = "Soft and textural, a real cuddly piece.";
    expect(validatePayload(p, brief).errors.some((e) => e.field.endsWith("[0].description"))).toBe(true);
  });

  it("denies Featured_Blog and non-allowlisted keys", () => {
    const p = basePayload();
    p.metafields.Featured_Blog = true;
    p.metafields.featured = "Vogue";
    const fields = validatePayload(p, brief).errors.map((e) => e.field);
    expect(fields).toContain("metafields.Featured_Blog");
    expect(fields).toContain("metafields.featured");
  });

  it("checks TOC ↔ h2 and h2 numbering", () => {
    const p = basePayload();
    p.article.bodyHtml = p.article.bodyHtml.replace('id="toc2"', 'id="toc3"');
    p.metafields.article_toc_title = "Clutter Has Met Its Match";
    const msgs = validatePayload(p, brief).errors.map((e) => e.message).join("\n");
    expect(msgs).toMatch(/must have id="toc2"/);
    expect(msgs).toMatch(/article_toc_title|h2 texts/);
  });

  it("checks placeholders against card metafields", () => {
    const p = basePayload();
    p.article.bodyHtml = p.article.bodyHtml.replace("[[custom-content-with-badge]]", "");
    expect(validatePayload(p, brief).errors.some((e) => /placeholder|missing from the body/.test(e.message))).toBe(true);
  });

  it("checks derived tag fields", () => {
    const p = basePayload();
    p.metafields.blogtagline = "Storage Benches · Storage Ottomans";
    expect(validatePayload(p, brief).errors.some((e) => e.field === "metafields.blogtagline")).toBe(true);
  });

  it("accepts a correct footer_text and rejects a malformed one", () => {
    const p = basePayload();
    p.metafields.custom_content_with_badge[0].footer_text =
      '<a href="https://tovfurniture.com/products/anita-bench" style="color: rgb(183, 91, 100);">Anita Storage Bench</a>';
    expect(validatePayload(p, brief).ok).toBe(true);
    p.metafields.custom_content_with_badge[0].footer_text = '<a href="https://tovfurniture.com/products/anita-bench">Anita</a>';
    expect(validatePayload(p, brief).ok).toBe(false);
  });

  it("rejects wrong card key order", () => {
    const p = basePayload();
    const { title, ...rest } = p.metafields.custom_content_with_badge[0];
    p.metafields.custom_content_with_badge[0] = { ...rest, title };
    expect(validatePayload(p, brief).errors.some((e) => /keys must be exactly/.test(e.message))).toBe(true);
  });

  it("errors when live definitions disagree with §8", () => {
    const p = basePayload();
    const defs = Object.keys(p.metafields).map((key) => ({ namespace: "custom", key, name: key, type: "single_line_text_field", validations: [] }));
    const v = validatePayload(p, brief, defs);
    expect(v.errors.some((e) => /Live definitions win/.test(e.message))).toBe(true);
  });
});

describe("metafield serialization (§8)", () => {
  it("formats each type", () => {
    expect(serializeValue("Add_Schema_Mentions", "boolean", true).value).toBe("true");
    expect(serializeValue("Add_Schema_Mentions", "boolean", "True").error).toBeTruthy();
    expect(serializeValue("x", "single_line_text_field", "a\nb").error).toMatch(/newlines/);
    expect(JSON.parse(serializeValue("q", "rich_text_field", "Hello").value!)).toEqual({
      type: "root",
      children: [{ type: "paragraph", children: [{ type: "text", value: "Hello" }] }],
    });
    expect(serializeValue("p", "list.product_reference", "gid://shopify/Product/1").value).toBe('["gid://shopify/Product/1"]');
    expect(serializeValue("p", "list.product_reference", ["dex-ottoman"]).error).toBeTruthy();
    expect(serializeValue("u", "url", "http://example.com").error).toBeTruthy();
    expect(serializeValue("j", "json", [{ a: 1 }]).value).toBe('[{"a":1}]');
  });

  it("builds typed inputs in namespace custom", () => {
    const { inputs, errors } = buildMetafieldInputs("press", { featured: "Vogue", Add_Schema_Mentions: true, customlink_text: "read the article" });
    expect(errors).toEqual([]);
    expect(inputs).toContainEqual({ namespace: "custom", key: "Add_Schema_Mentions", type: "boolean", value: "true" });
  });
});
