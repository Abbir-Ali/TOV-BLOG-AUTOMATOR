import type { ContentType } from "./contentTypes.js";

/** §8 — the only metafields the server will ever write (namespace `custom`). */
export const NAMESPACE = "custom";

export type MetafieldType =
  | "single_line_text_field"
  | "multi_line_text_field"
  | "rich_text_field"
  | "json"
  | "list.product_reference"
  | "url"
  | "boolean";

export interface MetafieldSpec {
  type: MetafieldType;
  types: ContentType[];
}

export const METAFIELDS: Record<string, MetafieldSpec> = {
  homepage_display_tag: { type: "single_line_text_field", types: ["inspired"] },
  reading_time: { type: "single_line_text_field", types: ["inspired"] },
  article_author: { type: "single_line_text_field", types: ["inspired"] },
  quick_scoop_content: { type: "rich_text_field", types: ["inspired"] },
  sidebar_cta_title: { type: "single_line_text_field", types: ["inspired"] },
  sidebar_cta_text: { type: "multi_line_text_field", types: ["inspired"] },
  sidebar_cta_button_text: { type: "single_line_text_field", types: ["inspired"] },
  sidebar_button_link: { type: "single_line_text_field", types: ["inspired"] },
  article_toc_title: { type: "single_line_text_field", types: ["inspired"] },
  custom_content_with_badge: { type: "json", types: ["inspired"] },
  custom_content_with_badge2: { type: "json", types: ["inspired"] },
  faqs: { type: "json", types: ["inspired"] },
  cta_title_1: { type: "single_line_text_field", types: ["inspired"] },
  cta_text_1: { type: "multi_line_text_field", types: ["inspired"] },
  cta_button_label_1: { type: "single_line_text_field", types: ["inspired"] },
  cta_button_link_1: { type: "single_line_text_field", types: ["inspired"] },
  blogtagline: { type: "single_line_text_field", types: ["inspired"] },
  Article_Featured_product: { type: "list.product_reference", types: ["inspired", "press"] },
  featured: { type: "single_line_text_field", types: ["press"] },
  customurl: { type: "url", types: ["press"] },
  customlink_text: { type: "single_line_text_field", types: ["press"] },
  Add_Schema_Mentions: { type: "boolean", types: ["press"] },
};

/** Never written, whatever the payload says (rule 6 + §8). */
export const NEVER_WRITTEN = new Set([
  "Featured_Blog",
  "author_image",
  "author_position",
  "hidden",
  "article_banner_tag",
  "banner_position",
  "bannor_imgas",
]);

export const allowedKeys = (ct: ContentType) =>
  Object.entries(METAFIELDS)
    .filter(([, s]) => s.types.includes(ct))
    .map(([k]) => k);

/** Required metafields per content type (missing → error). */
export const REQUIRED_METAFIELDS: Record<ContentType, string[]> = {
  inspired: [
    "reading_time",
    "article_author",
    "quick_scoop_content",
    "article_toc_title",
    "blogtagline",
    "homepage_display_tag",
    "sidebar_cta_title",
    "sidebar_cta_text",
    "sidebar_cta_button_text",
    "sidebar_button_link",
    "cta_title_1",
    "cta_text_1",
    "cta_button_label_1",
  ],
  press: ["featured", "customurl", "customlink_text", "Add_Schema_Mentions", "Article_Featured_product"],
};
