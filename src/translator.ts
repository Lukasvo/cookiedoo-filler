import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod/v4";
import { THERMOMIX_TM6_SYSTEM_PROMPT } from "./prompts.js";
import type { ScrapedRecipe } from "./scraper.js";
import type {
  Instruction,
  Ingredient,
  Annotation,
  PatchRecipeRequest,
} from "./cookidoo/schemas.js";

const AnnotationOutputSchema = z.object({
  type: z
    .enum(["TTS", "INGREDIENT"])
    .describe("TTS for Thermomix settings, INGREDIENT for ingredient references"),
  speed: z
    .string()
    .describe('Speed 1-10 for TTS, empty string for INGREDIENT.'),
  timeSeconds: z
    .number()
    .int()
    .describe("Duration in seconds for TTS, 0 for INGREDIENT."),
  temperatureValue: z
    .string()
    .describe('Temperature: "37"-"120", "varoma", or empty string if no heat or INGREDIENT type'),
  direction: z
    .string()
    .describe(
      '"CCW" for counter-clockwise/reverse blade (gentle stirring: risotto, grains, delicate sauces), empty string otherwise.'
    ),
  ingredientText: z
    .string()
    .describe(
      "Exact ingredient text as it appears in the step text (e.g. '100 g broccoli'). Required for INGREDIENT, empty string for TTS."
    ),
  offset: z.number().int().describe("Character offset in the step text"),
  length: z.number().int().describe("Length of the annotation span in the text"),
});

const TranslatedRecipeSchema = z.object({
  name: z.string().describe("Recipe name in Dutch"),
  ingredients: z.array(
    z.object({
      text: z
        .string()
        .describe("Ingredient in metric units, Dutch, e.g. '200 g cashewnoten'"),
    })
  ),
  instructions: z.array(
    z.object({
      text: z
        .string()
        .describe(
          "Step text in Dutch with TM6 notation embedded, e.g. 'Meng alles: 30 sec/snelheid 10'"
        ),
      annotations: z
        .array(AnnotationOutputSchema)
        .describe(
          "ALL annotations: one TTS annotation for each Thermomix setting in the text, AND one INGREDIENT annotation for every ingredient mention. Every TTS pattern and every ingredient reference MUST have an annotation."
        ),
    })
  ),
  totalTimeSeconds: z.number().int().describe("Total time in seconds"),
  prepTimeSeconds: z.number().int().describe("Active prep time in seconds"),
  servings: z.number().int(),
});

type TranslatedRecipe = z.infer<typeof TranslatedRecipeSchema>;

// Cookidoo uses U+E003 (Private Use Area) for the reverse blade symbol. LLMs typically output
// ⟲ (U+21B6) instead; we substitute it when building the Cookidoo payload.
export const REVERSE_BLADE_CHAR = "\uE003"; // Cookidoo API format

// Regex matching TTS notation: "10 min/100°C/snelheid 1", "30 sec/snelheid 10",
// "20 min/100°C/⟲/snelheid 1" or "20 min/100°C/\uE003/snelheid 1" (reverse)
const TTS_PATTERN =
  /\d+(?:-\d+)?\s*(?:min|sec)\/(?:\d+°C\/|[Vv]aroma\/)?(?:[\uE003\u21b6]\/)?snelheid\s*[\d.]+/g;

/**
 * LLMs can't count character positions reliably. This function finds the actual
 * TTS notation and ingredient mentions in the step text and corrects annotation positions.
 */
function fixAnnotationPositions(
  steps: TranslatedRecipe["instructions"]
): TranslatedRecipe["instructions"] {
  return steps.map((step) => {
    if (!step.annotations.length) return step;

    const ttsMatches = [...step.text.matchAll(TTS_PATTERN)];
    let ttsIndex = 0;
    const searchFromByDescription = new Map<string, number>();

    const fixedAnnotations = step.annotations
      .map((ann) => {
        if (ann.type === "TTS") {
          const match = ttsMatches[ttsIndex++];
          if (!match || match.index === undefined) return null;
          return {
            ...ann,
            offset: match.index,
            length: match[0].length,
          };
        }
        const desc = ann.ingredientText;
        if (!desc) return null;
        const from = searchFromByDescription.get(desc) ?? 0;
        const idx = step.text.indexOf(desc, from);
        if (idx === -1) return null;
        searchFromByDescription.set(desc, idx + desc.length);
        return {
          ...ann,
          offset: idx,
          length: desc.length,
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    return { ...step, annotations: fixedAnnotations };
  });
}

export async function translateRecipe(
  recipe: ScrapedRecipe
): Promise<PatchRecipeRequest> {
  const userPrompt = `Translate this recipe to a Thermomix TM6 recipe:

Name: ${recipe.name}
Servings: ${recipe.servings}
Category: ${recipe.category}
Description: ${recipe.description}

Ingredients:
${recipe.ingredients.map((i) => `- ${i}`).join("\n")}

Instructions:
${recipe.instructions.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Total time: ${recipe.totalTimeSeconds} seconds
Cook time: ${recipe.cookTimeSeconds} seconds`;

  const { object: translated } = await generateObject({
    model: openai("gpt-4o"),
    schema: TranslatedRecipeSchema,
    system: THERMOMIX_TM6_SYSTEM_PROMPT,
    prompt: userPrompt,
  });

  const fixed: TranslatedRecipe = {
    ...translated,
    instructions: fixAnnotationPositions(translated.instructions),
  };

  return addMissingIngredientAnnotations(toCookidooPatch(fixed));
}

function toCookidooPatch(translated: TranslatedRecipe): PatchRecipeRequest {
  const ingredients: Ingredient[] = translated.ingredients.map((i) => ({
    type: "INGREDIENT" as const,
    text: i.text,
  }));

  const instructions: Instruction[] = translated.instructions.map((step) => ({
    type: "STEP" as const,
    text: step.text.replace(/\u21b6/g, REVERSE_BLADE_CHAR), // ⟲ → U+E003 (Cookidoo API)
    annotations:
      step.annotations.length > 0
        ? step.annotations.map((a) =>
            a.type === "TTS"
              ? {
                  type: "TTS" as const,
                  data: {
                    speed: a.speed,
                    time: a.timeSeconds,
                    ...(a.temperatureValue
                      ? { temperature: { value: a.temperatureValue, unit: "C" as const } }
                      : {}),
                    ...(a.direction
                      ? { direction: a.direction as "CCW" }
                      : {}),
                  },
                  position: { offset: a.offset, length: a.length },
                }
              : {
                  type: "INGREDIENT" as const,
                  data: {
                    description: matchToIngredient(
                      a.ingredientText,
                      translated.ingredients
                    ),
                  },
                  position: { offset: a.offset, length: a.length },
                }
          )
        : undefined,
  }));

  return {
    name: translated.name,
    totalTime: translated.totalTimeSeconds,
    prepTime: translated.prepTimeSeconds,
    yield: { value: translated.servings, unitText: "portion" as const },
    ingredients,
    instructions,
  };
}

/**
 * Maps a mention text from the LLM to the best matching full ingredient text
 * using word-overlap scoring to avoid false positives like "snufje" matching
 * the wrong ingredient.
 */
function matchToIngredient(
  mention: string,
  ingredients: { text: string }[]
): string {
  const exact = ingredients.find((i) => i.text === mention);
  if (exact) return exact.text;

  const contains = ingredients.find((i) => i.text.includes(mention));
  if (contains) return contains.text;

  const reverse = ingredients.find((i) => mention.includes(i.text));
  if (reverse) return reverse.text;

  const mentionWords = mention
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  let bestMatch: string | null = null;
  let bestScore = 0;

  for (const ing of ingredients) {
    const ingWords = ing.text.toLowerCase().split(/\s+/);
    let score = 0;
    for (const mw of mentionWords) {
      if (ingWords.includes(mw)) {
        score += 1;
      } else {
        for (const iw of ingWords) {
          if (iw.includes(mw) || mw.includes(iw)) {
            score += 0.5;
            break;
          }
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = ing.text;
    }
  }

  if (bestMatch && bestScore >= 1) return bestMatch;
  return mention;
}

/**
 * Tries to find an ingredient mention in step text using multiple strategies.
 */
function findIngredientInText(
  ingredientText: string,
  stepText: string
): { offset: number; length: number } | null {
  let idx = stepText.indexOf(ingredientText);
  if (idx !== -1) return { offset: idx, length: ingredientText.length };

  const withoutQty = ingredientText
    .replace(
      /^(?:\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|cl|dl|eetlepels?|theelepels?|teentjes?|stuk(?:s|jes?)?)|snufjes?|snufje|handvol|scheutje|druppel|grote?|kleine?)\s+/i,
      ""
    )
    .trim();

  if (withoutQty !== ingredientText && withoutQty.length >= 3) {
    idx = stepText.indexOf(withoutQty);
    if (idx !== -1) return { offset: idx, length: withoutQty.length };
  }

  const nameToSearch = withoutQty || ingredientText;
  const words = nameToSearch.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const suffix = words.slice(i).join(" ");
    if (suffix.length < 4) continue;
    idx = stepText.indexOf(suffix);
    if (idx !== -1) return { offset: idx, length: suffix.length };
  }

  const longWords = words
    .filter((w) => w.replace(/[^a-zA-ZÀ-ÿ]/g, "").length >= 5)
    .sort((a, b) => b.length - a.length);
  for (const word of longWords) {
    idx = stepText.indexOf(word);
    if (idx !== -1) return { offset: idx, length: word.length };
  }

  const parts = nameToSearch.split(/\s*[&]\s*|\s+en\s+/);
  if (parts.length > 1) {
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.length >= 4) {
        idx = stepText.indexOf(trimmed);
        if (idx !== -1) return { offset: idx, length: trimmed.length };
      }
    }
  }

  return null;
}

/**
 * Scans step text for ingredient mentions that aren't already annotated
 * and adds INGREDIENT annotations deterministically.
 */
function addMissingIngredientAnnotations(
  patch: PatchRecipeRequest
): PatchRecipeRequest {
  const ingredients = patch.ingredients ?? [];
  const instructions = patch.instructions ?? [];
  if (!ingredients.length || !instructions.length) return patch;

  const coveredIngredients = new Set<string>();
  for (const step of instructions) {
    for (const ann of step.annotations ?? []) {
      if (ann.type === "INGREDIENT") {
        coveredIngredients.add(ann.data.description);
      }
    }
  }

  const updatedInstructions = instructions.map((step) => {
    const annotations: Annotation[] = [...(step.annotations ?? [])];

    for (const ing of ingredients) {
      if (coveredIngredients.has(ing.text)) continue;

      const match = findIngredientInText(ing.text, step.text);
      if (!match) continue;

      const overlaps = annotations.some((a) => {
        const aEnd = a.position.offset + a.position.length;
        const mEnd = match.offset + match.length;
        return match.offset < aEnd && mEnd > a.position.offset;
      });

      if (!overlaps) {
        annotations.push({
          type: "INGREDIENT" as const,
          data: { description: ing.text },
          position: match,
        });
        coveredIngredients.add(ing.text);
      }
    }

    annotations.sort((a, b) => a.position.offset - b.position.offset);

    return {
      ...step,
      annotations: annotations.length > 0 ? annotations : undefined,
    };
  });

  return { ...patch, instructions: updatedInstructions };
}
