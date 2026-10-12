import { shopifyGraphql } from "./client.js";

export interface MetafieldDefinition {
  namespace: string;
  key: string;
  type: string;
  name: string;
  validations: { name: string; value: string | null }[];
}

const TTL_MS = 10 * 60 * 1000;
let cache: { at: number; defs: MetafieldDefinition[] } | null = null;

const QUERY = /* GraphQL */ `
  query ArticleMetafieldDefinitions($after: String) {
    metafieldDefinitions(first: 100, ownerType: ARTICLE, after: $after) {
      nodes {
        namespace
        key
        name
        type { name }
        validations { name value }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface Resp {
  metafieldDefinitions: {
    nodes: { namespace: string; key: string; name: string; type: { name: string }; validations: { name: string; value: string | null }[] }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

/** Article metafield definitions from the live store, cached 10 minutes. */
export async function getMetafieldDefinitions(force = false): Promise<MetafieldDefinition[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.defs;
  const defs: MetafieldDefinition[] = [];
  let after: string | null = null;
  do {
    const data: Resp = await shopifyGraphql<Resp>(QUERY, { after });
    for (const n of data.metafieldDefinitions.nodes) {
      defs.push({ namespace: n.namespace, key: n.key, name: n.name, type: n.type.name, validations: n.validations });
    }
    after = data.metafieldDefinitions.pageInfo.hasNextPage ? data.metafieldDefinitions.pageInfo.endCursor : null;
  } while (after);
  cache = { at: Date.now(), defs };
  return defs;
}
