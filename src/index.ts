import "dotenv/config";
import { createInterface } from "readline/promises";
import { scrapeDeliciouslyElla } from "./scraper.js";
import { translateRecipe } from "./translator.js";
import { CookidooClient } from "./cookidoo/client.js";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error(
      "Usage: npx tsx src/index.ts <deliciously-ella-recipe-url>"
    );
    process.exit(1);
  }

  console.log(`\n🔍 Scraping recipe from ${url}...`);
  const scraped = await scrapeDeliciouslyElla(url);
  console.log(`   Found: "${scraped.name}" (${scraped.ingredients.length} ingredients, ${scraped.instructions.length} steps)`);

  console.log(`\n🤖 Translating to Thermomix TM6 format...`);
  const patch = await translateRecipe(scraped);
  
  console.log(`\n📋 Preview of translated recipe:`);
  console.log(`   Name: ${patch.name}`);
  console.log(`   Servings: ${patch.yield?.value}`);
  console.log(`   Prep time: ${Math.round((patch.prepTime ?? 0) / 60)} min`);
  console.log(`   Total time: ${Math.round((patch.totalTime ?? 0) / 60)} min`);
  console.log(`\n   Ingredients:`);
  for (const ing of patch.ingredients ?? []) {
    console.log(`   - ${ing.text}`);
  }
  console.log(`\n   Steps:`);
  for (const [i, step] of (patch.instructions ?? []).entries()) {
    console.log(`   ${i + 1}. ${step.text}`);
    if (step.annotations?.length) {
      for (const a of step.annotations) {
        if (a.type === "TTS") {
          const temp = a.data.temperature
            ? `${a.data.temperature.value}°C`
            : "no heat";
          console.log(
            `      ⚙️  ${a.data.time}s / ${temp} / speed ${a.data.speed}`
          );
        }
      }
    }
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    "\n✅ Create this recipe on Cookidoo? (y/n) "
  );
  rl.close();

  if (answer.toLowerCase() !== "y") {
    console.log("Cancelled.");
    process.exit(0);
  }

  console.log(`\n📤 Logging in to Cookidoo...`);
  const client = await CookidooClient.fromEnvAsync();
  console.log(`   Authenticated. Creating recipe...`);

  const created = await client.createRecipe({
    recipeName: patch.name!,
    yield: patch.yield,
  });
  console.log(`   Created blank recipe: ${created.recipeId}`);

  const updated = await client.updateRecipe(created.recipeId, patch);
  console.log(`   Updated with full content.`);

  if (scraped.imageUrl) {
    console.log(`\n🖼️  Uploading recipe image...`);
    try {
      await client.uploadImage(created.recipeId, scraped.imageUrl);
      console.log(`   Image uploaded.`);
    } catch (err: any) {
      console.warn(`   Image upload failed (non-fatal): ${err.message}`);
    }
  }

  console.log(
    `\n🎉 Done! View your recipe at: https://cookidoo.be/created-recipes/nl-BE/${updated.recipeId}`
  );
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
