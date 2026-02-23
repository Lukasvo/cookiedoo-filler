import "dotenv/config";
import { scrapeDeliciouslyElla } from "./scraper.js";
import { translateRecipe } from "./translator.js";
import { CookidooClient } from "./cookidoo/client.js";
import {
  getCachedRecipeId,
  setCachedRecipeId,
  buildHints,
} from "./cache.js";

async function main() {
  const input = process.argv[2];
  if (!input) {
    console.error(
      "Usage: npx tsx src/bulk.ts <url1,url2,url3,...>"
    );
    process.exit(1);
  }

  const urls = input
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);

  console.log(`\n📦 Bulk import: ${urls.length} recipe(s)\n`);

  console.log(`🔑 Logging in to Cookidoo...`);
  const client = await CookidooClient.fromEnvAsync();
  console.log(`   Authenticated.\n`);

  const results: { url: string; name: string; status: string; action?: string; link?: string }[] = [];

  for (const [idx, url] of urls.entries()) {
    const label = `[${idx + 1}/${urls.length}]`;

    try {
      console.log(`${label} 🔍 Scraping ${url}`);
      const scraped = await scrapeDeliciouslyElla(url);
      console.log(`${label}    "${scraped.name}"`);

      console.log(`${label} 🤖 Translating...`);
      const patch = await translateRecipe(scraped);
      patch.hints = buildHints(url);

      // Check for existing recipe
      let existingId: string | null = null;
      const cachedId = await getCachedRecipeId(url);
      if (cachedId && (await client.recipeExists(cachedId))) {
        existingId = cachedId;
      }

      let recipeId: string;
      if (existingId) {
        console.log(`${label} ♻️  Updating existing recipe ${existingId}...`);
        const updated = await client.updateRecipe(existingId, patch);
        recipeId = updated.recipeId;
      } else {
        console.log(`${label} 📤 Creating on Cookidoo...`);
        const created = await client.createRecipe({
          recipeName: patch.name!,
          yield: patch.yield,
        });
        recipeId = created.recipeId;
        await client.updateRecipe(recipeId, patch);
      }

      if (scraped.imageUrl) {
        try {
          await client.uploadImage(recipeId, scraped.imageUrl);
        } catch {
          console.warn(`${label}    ⚠️  Image upload failed (non-fatal)`);
        }
      }

      await setCachedRecipeId(url, recipeId);
      const link = `https://cookidoo.be/created-recipes/nl-BE/${recipeId}`;
      const action = existingId ? "updated" : "created";
      console.log(`${label} ✅ ${patch.name} (${action}) → ${link}\n`);
      results.push({ url, name: patch.name!, status: "ok", action, link });
    } catch (err: any) {
      console.error(`${label} ❌ Failed: ${err.message}\n`);
      results.push({ url, name: url, status: `error: ${err.message}` });
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  const ok = results.filter((r) => r.status === "ok");
  const created = ok.filter((r) => r.action === "created").length;
  const updated = ok.filter((r) => r.action === "updated").length;
  console.log(`📊 Summary: ${ok.length}/${results.length} succeeded (${created} created, ${updated} updated)\n`);
  for (const r of results) {
    const icon = r.status === "ok" ? "✅" : "❌";
    const tag = r.action ? ` [${r.action}]` : "";
    console.log(`  ${icon} ${r.name}${tag}`);
    if (r.link) console.log(`     ${r.link}`);
  }
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
