import { z } from "zod/v4";
import * as cheerio from "cheerio";

const HowToStepSchema = z.object({
  "@type": z.literal("HowToStep"),
  text: z.string(),
});

export const DeliciouslyEllaRecipeSchema = z.object({
  "@context": z.literal("https://schema.org"),
  "@type": z.literal("Recipe"),
  name: z.string(),
  description: z.string().optional(),
  image: z.string(),
  recipeCategory: z.string().optional(),
  recipeIngredient: z.array(z.string()),
  recipeInstructions: z.array(HowToStepSchema),
  cookTime: z.string().optional(),
  prepTime: z.string().optional(),
  totalTime: z.string().optional(),
  recipeYield: z.union([z.number(), z.string()]),
  datePublished: z.string().optional(),
  url: z.string().optional(),
  author: z
    .object({
      "@type": z.string(),
      name: z.string(),
    })
    .optional(),
});

export type DeliciouslyEllaRecipe = z.infer<typeof DeliciouslyEllaRecipeSchema>;

function parseISO8601Duration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || "0", 10);
  const minutes = parseInt(match[2] || "0", 10);
  const seconds = parseInt(match[3] || "0", 10);
  return hours * 3600 + minutes * 60 + seconds;
}

function normalizeImageUrl(url: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  return url;
}

export interface ScrapedRecipe {
  name: string;
  description: string;
  imageUrl: string;
  category: string;
  ingredients: string[];
  instructions: string[];
  cookTimeSeconds: number;
  prepTimeSeconds: number;
  totalTimeSeconds: number;
  servings: number;
  sourceUrl: string;
}

export async function scrapeDeliciouslyElla(
  url: string
): Promise<ScrapedRecipe> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`
    );
  }
  const html = await response.text();
  const $ = cheerio.load(html);

  const ldJsonScript = $('script[type="application/ld+json"]').first();
  if (!ldJsonScript.length) {
    throw new Error("No JSON-LD found on the page");
  }

  const rawJson = JSON.parse(ldJsonScript.html()!);
  const recipe = DeliciouslyEllaRecipeSchema.parse(rawJson);

  const servingsRaw = recipe.recipeYield;
  const servings =
    typeof servingsRaw === "number"
      ? servingsRaw
      : parseInt(servingsRaw, 10) || 4;

  return {
    name: recipe.name,
    description: recipe.description ?? "",
    imageUrl: normalizeImageUrl(recipe.image),
    category: recipe.recipeCategory ?? "Main",
    ingredients: recipe.recipeIngredient,
    instructions: recipe.recipeInstructions.map((step) => step.text.trim()),
    cookTimeSeconds: recipe.cookTime
      ? parseISO8601Duration(recipe.cookTime)
      : 0,
    prepTimeSeconds: recipe.prepTime
      ? parseISO8601Duration(recipe.prepTime)
      : 0,
    totalTimeSeconds: recipe.totalTime
      ? parseISO8601Duration(recipe.totalTime)
      : 0,
    servings,
    sourceUrl: url,
  };
}
