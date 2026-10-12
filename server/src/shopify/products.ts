import { getConfig } from "../config/env.js";
import { shopifyGraphql } from "./client.js";

export interface ProductHit {
  gid: string;
  title: string;
  handle: string;
  url: string;
  status: string;
  imageUrl: string | null;
  /** true when the title contains every significant word of the query (Product Resolver auto-accept rule, §4.3). */
  containsAllSignificantWords: boolean;
}

const QUERY = /* GraphQL */ `
  query FindProducts($first: Int!, $query: String!) {
    products(first: $first, query: $query) {
      nodes {
        id
        title
        handle
        status
        onlineStoreUrl
        featuredMedia { preview { image { url } } }
      }
    }
  }
`;

interface Resp {
  products: {
    nodes: {
      id: string;
      title: string;
      handle: string;
      status: string;
      onlineStoreUrl: string | null;
      featuredMedia: { preview: { image: { url: string } | null } | null } | null;
    }[];
  };
}

const STOPWORDS = new Set(["the", "a", "an", "and", "or", "of", "with", "in", "for", "to", "set"]);

/** Words that identify a product: lowercase, no measurements/punctuation, no stopwords. */
export function significantWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/** Handle from a PDP URL like https://tovfurniture.com/products/dex-ottoman?variant=1 */
export function handleFromUrl(url: string): string | null {
  const m = /\/products\/([a-z0-9][a-z0-9-]*)/i.exec(url);
  return m ? m[1]!.toLowerCase() : null;
}

/** Shopify search syntax: quote-free free text so names like `Anita 39" Bench` don't break the query. */
const searchText = (s: string) => significantWords(s).join(" ");

export async function findProducts(input: { handle?: string; query?: string; limit?: number }): Promise<ProductHit[]> {
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);
  const handle = input.handle ? (handleFromUrl(input.handle) ?? input.handle.trim().toLowerCase()) : undefined;
  if (!handle && !input.query?.trim()) return [];

  const q = handle ? `handle:${handle}` : searchText(input.query!);
  const data = await shopifyGraphql<Resp>(QUERY, { first: limit, query: q });
  const base = getConfig().publicStoreUrl;
  const words = significantWords(input.query ?? "");

  let nodes = data.products.nodes;
  if (handle) nodes = nodes.filter((n) => n.handle === handle); // exact handle only
  return nodes.map((n) => {
    const titleWords = new Set(significantWords(n.title));
    return {
      gid: n.id,
      title: n.title,
      handle: n.handle,
      url: `${base}/products/${n.handle}`,
      status: n.status,
      imageUrl: n.featuredMedia?.preview?.image?.url ?? null,
      containsAllSignificantWords: words.length > 0 && words.every((w) => titleWords.has(w)),
    };
  });
}
