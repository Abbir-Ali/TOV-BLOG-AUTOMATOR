/** §3 + §7.6 — content types and the only fixed (non-doc) strings the system may write. */

export type ContentType = "inspired" | "press";
export const CONTENT_TYPES = ["inspired", "press"] as const;

export const BLOG_HANDLE: Record<ContentType, string> = { inspired: "inspired", press: "press" };

/** Set by the server, never by the model. `null` = Default blog post template. */
export const TEMPLATE_SUFFIX: Record<ContentType, string | null> = {
  inspired: "article-custom-json",
  press: null,
};

export const LINK_STYLE = "color: rgb(183, 91, 100);";

export const AUTHOR_FALLBACK = "TOV Furniture";

export const SIDEBAR_DEFAULTS = {
  sidebar_cta_title: "See It In Your Space",
  sidebar_cta_text: "Upload a photo of your room and let our visualizer show you exactly how it looks.",
  sidebar_cta_button_text: "Try The Design Box",
  sidebar_button_link: "https://tovfurniture.com/pages/design-box",
} as const;

export const DESIGN_BOX_PARAGRAPH =
  `<p>Upload a photo of your room and let our visualizer show you exactly how it looks. ` +
  `<a href="https://tovfurniture.com/pages/design-box" style="${LINK_STYLE}">Try The Design Box →</a></p>`;

export const PRESS_LINK_TEXT = "read the article";

/** §7.4 known badges (matched case-insensitively at the end of a product name line). */
export const KNOWN_BADGES: Record<string, string> = {
  "New Arrival": "#b15a63",
  "Best Seller": "#485b59",
  "Statement Length": "#6a596b",
  "Most Flexible": "#3f4b59",
  "Final Sale": "#5b3630",
};
/** Colours cycled for any other badge (no two different badges share a colour in one post). */
export const OTHER_BADGE_COLORS = ["#805e39", "#8a5955", "#5b5e4b", "#645248", "#1d3037"];
export const BADGE_TEXT_COLOR = "#ffffff";

export const PLACEHOLDERS = ["[[custom-content-with-badge]]", "[[custom-content-with-badge2]]"] as const;
export const CARD_METAFIELDS = ["custom_content_with_badge", "custom_content_with_badge2"] as const;

export const CONFIRM_IMAGE_PLACEHOLDER = "[CONFIRM IMAGE URL]";

export const FEATURED_BLOG_CHECKLIST = "Set Featured Blog if this post should be featured";

/** Exact key order required for product cards (§7.4). */
export const CARD_KEYS = [
  "title",
  "badge",
  "badge_color",
  "badge_text_color",
  "description",
  "bullets",
  "footer_label",
  "footer_text",
] as const;

export const footerLabel = (title: string) => `Shop ${title.trim().split(/\s+/)[0] ?? ""} →`;

export const footerText = (url: string, name: string) =>
  `<a href="${url}" style="${LINK_STYLE}">${escapeHtml(name)}</a>`;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** "storage ottomans" → "Storage Ottomans" (used for blogtagline / homepage_display_tag). */
export function titleCase(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** TAGS rule (§7.3): lowercase, spaces → hyphens. */
export const toTag = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "-");
