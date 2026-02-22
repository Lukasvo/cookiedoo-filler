import { describe, it, expect } from "vitest";
import { scrapeDeliciouslyElla } from "../src/scraper.js";

describe("scrapeDeliciouslyElla", () => {
  it("scrapes a public recipe (Creamy Mushroom Pasta)", async () => {
    const recipe = await scrapeDeliciouslyElla(
      "https://deliciouslyella.com/recipes/creamy-mushroom-pasta/"
    );

    expect(recipe.name).toBe("Creamy Mushroom Pasta");
    expect(recipe.ingredients.length).toBeGreaterThan(5);
    expect(recipe.instructions.length).toBeGreaterThan(3);
    expect(recipe.servings).toBe(4);
    expect(recipe.totalTimeSeconds).toBe(1800);
    expect(recipe.imageUrl).toMatch(/^https:\/\//);
    expect(recipe.category).toBe("Mains");
  });

  it("scrapes a paywall recipe (Green Smoothie)", async () => {
    const recipe = await scrapeDeliciouslyElla(
      "https://deliciouslyella.com/en-eu/recipes/ellas-favourite-green-smoothie/"
    );

    expect(recipe.name).toBe("Ella's Favourite Green Smoothie");
    expect(recipe.ingredients.length).toBeGreaterThan(3);
    expect(recipe.instructions.length).toBeGreaterThan(1);
    expect(recipe.servings).toBe(1);
    expect(recipe.imageUrl).toMatch(/^https:\/\//);
  });

  it("throws on invalid URL", async () => {
    await expect(
      scrapeDeliciouslyElla("https://deliciouslyella.com/nonexistent-page-xyz")
    ).rejects.toThrow();
  });
});
