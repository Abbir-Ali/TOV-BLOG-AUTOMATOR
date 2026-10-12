import { getConfig, loadEnv } from "../config/env.js";
import { deleteTestArticle, listTestArticles } from "../shopify/articles.js";

/** `npm run test:cleanup` — deletes leftover draft articles tagged mcp-test (test env only). */
loadEnv();
if (getConfig().env !== "test") {
  console.error("MCP_ENV is not test — refusing to clean up.");
  process.exit(1);
}
const leftovers = (await listTestArticles()).filter((a) => !a.isPublished);
for (const a of leftovers) {
  await deleteTestArticle(a.id);
  console.log(`deleted ${a.id}  ${a.title}`);
}
console.log(`${leftovers.length} test article(s) deleted.`);
