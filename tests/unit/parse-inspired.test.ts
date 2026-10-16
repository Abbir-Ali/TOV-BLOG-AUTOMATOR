import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DESIGN_BOX_PARAGRAPH } from "../../server/src/config/contentTypes.js";
import { parseBrief } from "../../server/src/parse/index.js";
import { detectContentType } from "../../server/src/parse/detect.js";

const brief = readFileSync(new URL("../fixtures/storage-ottomans-brief.txt", import.meta.url), "utf8");
const r = parseBrief("inspired", brief);
const mf = r.payload.metafields as Record<string, any>;

describe("parse_brief — Inspired (storage ottomans fixture)", () => {
  it("detects the content type", () => {
    expect(detectContentType(brief)).toBe("inspired");
  });

  it("maps header fields exactly", () => {
    expect(r.missing).toEqual([]);
    expect(r.payload.article.title).toBe("Storage Ottomans That Hide the Mess and Steal the Room");
    expect(r.payload.article.summary).toMatch(/^A storage ottoman is the rare piece/);
    expect(r.payload.article.authorName).toBe("Cat Dang");
    expect(r.payload.article.tags).toEqual(["storage-ottomans", "storage-benches", "living-room", "entryway", "new-arrivals"]);
    expect(mf.reading_time).toBe("5 min read");
    expect(mf.blogtagline).toBe("Storage Ottomans · Storage Benches");
    expect(mf.homepage_display_tag).toBe("Storage Ottomans");
    expect(mf.article_author).toBe("Cat Dang");
    expect(mf.quick_scoop_content.type).toBe("root");
  });

  it("numbers h2s over content sections only and builds the TOC", () => {
    const body = r.payload.article.bodyHtml;
    expect(body).toContain('<h2 id="toc1">Clutter Has Met Its Match</h2>');
    expect(body).toContain('<h2 id="toc4">Style It Like It Was Never Hiding Anything</h2>');
    expect(body).not.toContain("toc5");
    expect(mf.article_toc_title).toBe(
      "Clutter Has Met Its Match||Where a Storage Ottoman Earns Its Spot||Meet the New Drops||Style It Like It Was Never Hiding Anything",
    );
    expect(body).not.toContain("Frequently Asked Questions");
    expect(body).not.toContain("Ready to Hide Everything");
  });

  it("detects TYPE_3 sub-headings", () => {
    expect(r.payload.article.bodyHtml).toContain("<h3>The Entryway</h3>");
    expect(r.payload.article.bodyHtml).toContain("<h3>Mix Textures, Not Just Colors</h3>");
  });

  it("puts a single placeholder for the TYPE_2 section and builds cards", () => {
    const body = r.payload.article.bodyHtml;
    expect(body.split("[[custom-content-with-badge]]").length).toBe(2);
    expect(body).not.toContain("[[custom-content-with-badge2]]");
    const cards = mf.custom_content_with_badge;
    expect(cards).toHaveLength(6);
    expect(Object.keys(cards[0])).toEqual(["title", "badge", "badge_color", "badge_text_color", "description", "bullets", "footer_label", "footer_text"]);
    expect(cards[1]).toMatchObject({ title: 'Andrea Performance Velvet Storage Bench (31" to 50")', badge: "Most Flexible", badge_color: "#3f4b59" });
    expect(cards[3]).toMatchObject({ badge: "Statement Length", badge_color: "#6a596b", footer_label: "Shop Thalia →" });
    expect(cards[0].bullets).toEqual(["Best for the person who wants storage with a cuddly point of view."]);
    expect(cards[0].description).not.toMatch(/Best for/);
    expect(cards[0].footer_text).toBe('Anita 39" Faux Shearling Storage Bench With Reversible Tray Top');
    expect(r.productCards).toHaveLength(6);
  });

  it("parses FAQs and CTA", () => {
    expect(mf.faqs).toHaveLength(5);
    expect(mf.faqs[1].question).toBe("How do I choose between an ottoman, a bench and a stool?");
    expect(mf.cta_title_1).toBe("Ready to Hide Everything in Plain Sight?");
    expect(mf.cta_button_label_1).toBe("Shop Benches & Ottomans");
    expect(mf.cta_button_link_1).toBeUndefined();
    expect(r.payload.advisories.some((a) => a.field === "cta_button_link_1")).toBe(true);
  });

  it("applies the Design Box rule to the section named in Editor notes", () => {
    const body = r.payload.article.bodyHtml;
    expect(body.trimEnd().endsWith(DESIGN_BOX_PARAGRAPH)).toBe(true);
    expect(r.decisions[0]).toMatch(/Style It Like It Was Never Hiding Anything/);
  });

  it("never writes Featured_Blog and adds the checklist reminder", () => {
    expect(mf.Featured_Blog).toBeUndefined();
    expect(r.payload.checklist).toContain("Set Featured Blog if this post should be featured");
  });

  it("reports missing required labels", () => {
    const res = parseBrief("inspired", "[FORMAT: TYPE_1_TEXT]\nIntro\nSome text here.");
    expect(res.missing).toEqual(expect.arrayContaining(["HEADLINE", "SUMMARY (TLDR)", "READ TIME", "TAGS", "TYPE_5_CTA heading"]));
  });

  it("matches PRODUCT LINKS to cards and supports CTA LINK", () => {
    const withLinks = brief
      .replace("[FORMAT: TYPE_3_SUBTITLES]\nStyle It", "PRODUCT LINKS:\nThalia — https://tovfurniture.com/products/thalia-bench\n[FORMAT: TYPE_3_SUBTITLES]\nStyle It")
      .replace("Shop Benches & Ottomans", "Shop Benches & Ottomans\nCTA LINK: https://tovfurniture.com/collections/benches");
    const res = parseBrief("inspired", withLinks);
    expect(res.productCards[3]!.productRef.url).toBe("https://tovfurniture.com/products/thalia-bench");
    expect((res.payload.metafields as any).cta_button_link_1).toBe("https://tovfurniture.com/collections/benches");
  });
});
