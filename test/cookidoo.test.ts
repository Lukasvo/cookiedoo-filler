import { describe, it, expect } from "vitest";
import { CookidooClient } from "../src/cookidoo/client.js";

const hasAuth =
  !!process.env.COOKIDOO_USERNAME && !!process.env.COOKIDOO_PASSWORD;

describe.skipIf(!hasAuth)("CookidooClient", () => {
  let client: CookidooClient;
  let testRecipeId: string | undefined;

  it("creates a blank recipe", async () => {
    client = await CookidooClient.fromEnvAsync();

    const created = await client.createRecipe({
      recipeName: "[TEST] Auto-created recipe",
      yield: { value: 2, unitText: "portion" },
    });

    expect(created.recipeId).toBeTruthy();
    expect(created.recipeContent.name).toBe("[TEST] Auto-created recipe");
    const tools = created.recipeContent.tools ?? created.recipeContent.tool ?? [];
    expect(tools).toContain("TM6");
    testRecipeId = created.recipeId;
  });

  it("updates recipe with full content", async () => {
    expect(testRecipeId).toBeTruthy();

    const updated = await client.updateRecipe(testRecipeId!, {
      name: "[TEST] Updated recipe name",
      totalTime: 900,
      prepTime: 300,
      yield: { value: 4, unitText: "portion" },
      ingredients: [
        { type: "INGREDIENT", text: "200 g cashewnoten" },
        { type: "INGREDIENT", text: "100 ml amandelmelk" },
      ],
      instructions: [
        {
          type: "STEP",
          text: "Meng alles: 30 sec/snelheid 10",
          annotations: [
            {
              type: "TTS",
              data: { speed: "10", time: 30 },
              position: { offset: 12, length: 18 },
            },
          ],
        },
        {
          type: "STEP",
          text: "Verwarm: 5 min/100°C/snelheid 1",
          annotations: [
            {
              type: "TTS",
              data: {
                speed: "1",
                time: 300,
                temperature: { value: "100", unit: "C" },
              },
              position: { offset: 9, length: 22 },
            },
          ],
        },
      ],
    });

    expect(updated.recipeContent.name).toBe("[TEST] Updated recipe name");
    expect(updated.recipeContent.ingredients).toHaveLength(2);
    expect(updated.recipeContent.instructions).toHaveLength(2);
    expect(updated.recipeContent.prepTime).toBe(300);
    expect(updated.recipeContent.totalTime).toBe(900);
  });

  it("uploads an image to the recipe", async () => {
    expect(testRecipeId).toBeTruthy();

    const testImageUrl =
      "https://images.ctfassets.net/8ffyq0lxv9d2/5ME6pLr7QB3btKabF98GgJ/a497b3dda02a8d55f619353a83f2c753/__Safia_Shakarchi_-_Deliciously_Ella_-_Creamy_Mushroom_Pasta_-7__1_.jpg";

    const updated = await client.uploadImage(testRecipeId!, testImageUrl);
    expect(updated.recipeContent.image).not.toContain("placeholder");
  }, 60_000);

  it("deletes the test recipe", async () => {
    expect(testRecipeId).toBeTruthy();
    await expect(client.deleteRecipe(testRecipeId!)).resolves.not.toThrow();
  });
});
