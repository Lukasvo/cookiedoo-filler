import "dotenv/config";
import { scrapeDeliciouslyElla } from "./scraper.js";
import { translateRecipe } from "./translator.js";
import { CookidooClient } from "./cookidoo/client.js";

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

  const results: { url: string; name: string; status: string; link?: string }[] = [];

  for (const [idx, url] of urls.entries()) {
    const label = `[${idx + 1}/${urls.length}]`;

    try {
      console.log(`${label} 🔍 Scraping ${url}`);
      const scraped = await scrapeDeliciouslyElla(url);
      console.log(`${label}    "${scraped.name}"`);

      console.log(`${label} 🤖 Translating...`);
      const patch = await translateRecipe(scraped);

      console.log(`${label} 📤 Creating on Cookidoo...`);
      const created = await client.createRecipe({
        recipeName: patch.name!,
        yield: patch.yield,
      });
      await client.updateRecipe(created.recipeId, patch);

      if (scraped.imageUrl) {
        try {
          await client.uploadImage(created.recipeId, scraped.imageUrl);
        } catch {
          console.warn(`${label}    ⚠️  Image upload failed (non-fatal)`);
        }
      }

      const link = `https://cookidoo.be/created-recipes/nl-BE/${created.recipeId}`;
      console.log(`${label} ✅ ${patch.name} → ${link}\n`);
      results.push({ url, name: patch.name!, status: "ok", link });
    } catch (err: any) {
      console.error(`${label} ❌ Failed: ${err.message}\n`);
      results.push({ url, name: url, status: `error: ${err.message}` });
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`📊 Summary: ${results.filter((r) => r.status === "ok").length}/${results.length} succeeded\n`);
  for (const r of results) {
    const icon = r.status === "ok" ? "✅" : "❌";
    console.log(`  ${icon} ${r.name}`);
    if (r.link) console.log(`     ${r.link}`);
  }
}

main().catch((err) => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
