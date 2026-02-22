import { describe, it, expect } from "vitest";
import { translateRecipe } from "../src/translator.js";
import type { ScrapedRecipe } from "../src/scraper.js";

const hasOpenAI = !!process.env.OPENAI_API_KEY;

const FIXTURE_RECIPE: ScrapedRecipe = {
  name: "Creamy Mushroom Pasta",
  description:
    "The creamy sauce is made from cashews, tamari and lemon juice.",
  imageUrl:
    "https://images.ctfassets.net/8ffyq0lxv9d2/5ME6pLr7QB3btKabF98GgJ/a497b3dda02a8d55f619353a83f2c753/test.jpg",
  category: "Mains",
  ingredients: [
    "3.5 oz cashews",
    "3.4 fl oz almond milk",
    "1 tablespoon tamari",
    "1 tablespoon nutritional yeast",
    "1 lemon",
    "1 onion",
    "4 cloves garlic",
    "7 oz mushrooms",
    "1 teaspoon dried rosemary",
    "10.6 oz pasta",
    "large handful of spinach",
    "pinch of sea salt & black pepper",
  ],
  instructions: [
    "Make the sauce by placing the cashews, almond milk, tamari, nutritional yeast, lemon juice and a sprinkling of salt into a powerful blender. Blitz to form a creamy sauce.",
    "Place a pan over medium heat and add a drizzle of olive oil. Once warm, add the diced onion, garlic and a sprinkling of salt. Cook for 10 minutes until the onion is soft.",
    "Once soft, add the sliced mushrooms, dried rosemary and a sprinkling of salt. Mix well and cook for 10 minutes until the mushrooms reduce in size and soften.",
    "While the mushrooms cook, cook the pasta according to the packet instructions. Once cooked, drain and mix through the mushroom mixture.",
    "Pour in the creamy sauce and add the spinach. Mix well and cook for a few minutes to heat everything through.",
    "Serve the pasta in bowls with some black pepper sprinkled on top.",
  ],
  cookTimeSeconds: 1800,
  prepTimeSeconds: 0,
  totalTimeSeconds: 1800,
  servings: 4,
  sourceUrl: "https://deliciouslyella.com/recipes/creamy-mushroom-pasta/",
};

describe.skipIf(!hasOpenAI)("translateRecipe", () => {
  it("translates a recipe to Thermomix TM6 format", async () => {
    const patch = await translateRecipe(FIXTURE_RECIPE);

    expect(patch.name).toBeTruthy();
    expect(patch.ingredients).toBeDefined();
    expect(patch.ingredients!.length).toBeGreaterThan(0);
    expect(patch.instructions).toBeDefined();
    expect(patch.instructions!.length).toBeGreaterThan(0);
    expect(patch.totalTime).toBeGreaterThan(0);
    expect(patch.yield?.value).toBe(4);

    for (const ing of patch.ingredients!) {
      expect(ing.type).toBe("INGREDIENT");
      expect(ing.text.length).toBeGreaterThan(0);
    }

    let hasAtLeastOneTTS = false;
    for (const step of patch.instructions!) {
      expect(step.type).toBe("STEP");
      expect(step.text.length).toBeGreaterThan(0);

      if (step.annotations?.length) {
        for (const ann of step.annotations) {
          if (ann.type === "TTS") {
            hasAtLeastOneTTS = true;
            expect(Number(ann.data.speed)).toBeGreaterThanOrEqual(1);
            expect(Number(ann.data.speed)).toBeLessThanOrEqual(10);
            expect(ann.data.time).toBeGreaterThan(0);
            expect(ann.position.offset).toBeGreaterThanOrEqual(0);
            expect(ann.position.length).toBeGreaterThan(0);

            const extracted = step.text.substring(
              ann.position.offset,
              ann.position.offset + ann.position.length
            );
            expect(extracted).toMatch(/\d+\s*(sec|min)/);
          }
        }
      }
    }

    expect(hasAtLeastOneTTS).toBe(true);
  }, 60_000);
});
