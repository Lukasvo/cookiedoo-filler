import { describe, it, expect } from "vitest";
import { scrapeDeliciouslyElla } from "../src/scraper.js";
import { translateRecipe } from "../src/translator.js";
import type { PatchRecipeRequest } from "../src/cookidoo/schemas.js";

function getIngredientCoverage(patch: PatchRecipeRequest) {
  const ingredients = patch.ingredients ?? [];
  const coveredIngredients = new Set<string>();

  for (const step of patch.instructions ?? []) {
    for (const ann of step.annotations ?? []) {
      if (ann.type === "INGREDIENT") {
        coveredIngredients.add(ann.data.description);
      }
    }
  }

  const covered = ingredients.filter((i) => coveredIngredients.has(i.text));
  const uncovered = ingredients.filter((i) => !coveredIngredients.has(i.text));

  return {
    total: ingredients.length,
    coveredCount: covered.length,
    covered: covered.map((i) => i.text),
    uncovered: uncovered.map((i) => i.text),
    percentage:
      ingredients.length > 0 ? (covered.length / ingredients.length) * 100 : 0,
  };
}

const hasOpenAI = !!process.env.OPENAI_API_KEY;

describe.skipIf(!hasOpenAI)("Ingredient annotation coverage", () => {
  it("Almond Butter Stir-Fry: >= 80% of ingredients should be tagged", async () => {
    const scraped = await scrapeDeliciouslyElla(
      "https://deliciouslyella.com/recipes/almond-butter-stir-fry/"
    );

    const patch = await translateRecipe(scraped);
    const coverage = getIngredientCoverage(patch);

    console.log(
      `\n📊 Ingredient Coverage: ${coverage.coveredCount}/${coverage.total} (${Math.round(coverage.percentage)}%)`
    );
    console.log("\n✅ Covered:");
    for (const text of coverage.covered) console.log(`   - ${text}`);
    console.log("\n❌ Uncovered:");
    for (const text of coverage.uncovered) console.log(`   - ${text}`);

    console.log("\n📝 Step annotations:");
    for (const [i, step] of (patch.instructions ?? []).entries()) {
      const preview =
        step.text.length > 100 ? step.text.substring(0, 100) + "…" : step.text;
      console.log(`\n   Step ${i + 1}: ${preview}`);
      for (const ann of step.annotations ?? []) {
        const mention = step.text.substring(
          ann.position.offset,
          ann.position.offset + ann.position.length
        );
        if (ann.type === "INGREDIENT") {
          console.log(
            `     🟢 INGREDIENT: "${mention}" → "${ann.data.description}"`
          );
        } else {
          console.log(`     ⚙️  TTS: "${mention}"`);
        }
      }
    }

    expect(coverage.percentage).toBeGreaterThanOrEqual(80);
  }, 120_000);
});
