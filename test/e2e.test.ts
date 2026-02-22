import { describe, it, expect } from "vitest";
import { scrapeDeliciouslyElla } from "../src/scraper.js";
import { translateRecipe } from "../src/translator.js";
import { CookidooClient } from "../src/cookidoo/client.js";

const hasAll =
  !!process.env.OPENAI_API_KEY &&
  !!process.env.COOKIDOO_USERNAME &&
  !!process.env.COOKIDOO_PASSWORD;

describe.skipIf(!hasAll)("E2E: Deliciously Ella → Cookidoo", () => {
  it(
    "scrapes, translates, creates, verifies, and deletes a recipe",
    async () => {
      const scraped = await scrapeDeliciouslyElla(
        "https://deliciouslyella.com/recipes/creamy-mushroom-pasta/"
      );
      expect(scraped.name).toBe("Creamy Mushroom Pasta");

      const patch = await translateRecipe(scraped);
      expect(patch.instructions!.length).toBeGreaterThan(0);

      const client = await CookidooClient.fromEnvAsync();
      const created = await client.createRecipe({
        recipeName: `[E2E TEST] ${patch.name}`,
        yield: patch.yield,
      });
      expect(created.recipeId).toBeTruthy();

      try {
        const updated = await client.updateRecipe(created.recipeId, {
          ...patch,
          name: `[E2E TEST] ${patch.name}`,
        });

        expect(updated.recipeContent.ingredients!.length).toBeGreaterThan(0);
        expect(updated.recipeContent.instructions!.length).toBeGreaterThan(0);
        expect(updated.recipeContent.name).toContain("E2E TEST");
      } finally {
        await client.deleteRecipe(created.recipeId);
      }
    },
    120_000
  );
});
