import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod/v4";
import { THERMOMIX_TM6_SYSTEM_PROMPT } from "./prompts.js";
import type { ScrapedRecipe } from "./scraper.js";
import type {
  Instruction,
  Ingredient,
  PatchRecipeRequest,
} from "./cookidoo/schemas.js";

const TTSDataSchema = z.object({
  speed: z.string().describe("Speed 1-10"),
  time: z.number().int().describe("Duration in seconds"),
  temperature: z
    .object({
      value: z.string().describe('Temperature: "37"-"120" or "varoma"'),
      unit: z.literal("C"),
    })
    .nullable()
    .describe("null if no heat is needed"),
  direction: z
    .literal("CCW")
    .nullable()
    .describe(
      "Set to CCW (counter-clockwise/reverse) for gentle stirring without cutting: risotto, simmering rice/grains, delicate sauces. null otherwise"
    ),
});

const AnnotationOutputSchema = z.object({
  type: z.literal("TTS"),
  data: TTSDataSchema,
  position: z.object({
    offset: z.number().int().describe("Character offset in the step text"),
    length: z.number().int().describe("Length of the TTS notation in the text"),
  }),
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
        .describe("TTS annotations matching the notation in the text"),
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
  /\d+(?:-\d+)?\s*(?:min|sec)\/(?:\d+°C\/|[Vv]aroma\/)?[\uE003\u21b6]\/snelheid\s*[\d.]+/g;

/**
 * LLMs can't count character positions reliably. This function finds the actual
 * TTS notation strings in the step text and corrects annotation offsets/lengths.
 */
function fixAnnotationPositions(
  steps: TranslatedRecipe["instructions"]
): TranslatedRecipe["instructions"] {
  return steps.map((step) => {
    if (!step.annotations.length) return step;

    const matches = [...step.text.matchAll(TTS_PATTERN)];
    if (matches.length === 0) {
      return { ...step, annotations: [] };
    }

    const fixedAnnotations = step.annotations
      .map((ann, i) => {
        const match = matches[i];
        if (!match || match.index === undefined) return null;
        return {
          ...ann,
          position: {
            offset: match.index,
            length: match[0].length,
          },
        };
      })
      .filter((a) => a !== null);

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

  return toCookidooPatch(fixed);
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
        ? step.annotations.map((a) => ({
            type: "TTS" as const,
            data: {
              speed: a.data.speed,
              time: a.data.time,
              ...(a.data.temperature
                ? { temperature: a.data.temperature }
                : {}),
              ...(a.data.direction ? { direction: a.data.direction } : {}),
            },
            position: a.position,
          }))
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
