/**
 * Zod schemas for the Cookidoo web API (cookidoo.be).
 * Single source of truth: documentation + runtime validation + TypeScript types.
 *
 * Reverse-engineered from browser network requests (Feb 2026).
 * See raw curl examples in the plan doc for reference.
 */

import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Annotation schemas (embedded in instruction steps)
// ---------------------------------------------------------------------------

export const TemperatureSchema = z.object({
  value: z.string(), // "37", "100", "varoma"
  unit: z.literal("C").optional(),
});

export const PositionSchema = z.object({
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive(),
});

export const TTSAnnotationSchema = z.object({
  type: z.literal("TTS"),
  data: z.object({
    speed: z.string(), // "1" to "10"
    time: z.number().int().nonnegative(), // seconds
    temperature: TemperatureSchema.optional(),
    direction: z.literal("CCW").optional(), // reverse / counter-clockwise (e.g. risotto, gentle stirring)
  }),
  position: PositionSchema,
});

export const IngredientAnnotationSchema = z.object({
  type: z.literal("INGREDIENT"),
  data: z.object({
    description: z.string(),
  }),
  position: PositionSchema,
});

export const AnnotationSchema = z.discriminatedUnion("type", [
  TTSAnnotationSchema,
  IngredientAnnotationSchema,
]);

// ---------------------------------------------------------------------------
// Instruction & Ingredient schemas
// ---------------------------------------------------------------------------

export const InstructionSchema = z.object({
  type: z.literal("STEP"),
  text: z.string(),
  annotations: z.array(AnnotationSchema).optional(),
});

export const IngredientSchema = z.object({
  type: z.literal("INGREDIENT"),
  text: z.string(),
});

export const YieldSchema = z.object({
  value: z.number().int().positive(),
  unitText: z.literal("portion"),
});

// ---------------------------------------------------------------------------
// API Request schemas
// ---------------------------------------------------------------------------

export const CreateRecipeRequestSchema = z.object({
  recipeName: z.string().min(1),
  yield: YieldSchema.optional(),
});

export const PatchRecipeRequestSchema = z.object({
  name: z.string().min(1).optional(),
  totalTime: z.number().int().nonnegative().optional(),
  prepTime: z.number().int().nonnegative().optional(),
  yield: YieldSchema.optional(),
  ingredients: z.array(IngredientSchema).optional(),
  instructions: z.array(InstructionSchema).optional(),
  image: z.string().optional(),
  isImageOwnedByUser: z.boolean().optional(),
  hints: z.string().optional(), // notes field — used to store source URL for upsert
});

// ---------------------------------------------------------------------------
// API Response schemas
// ---------------------------------------------------------------------------

const ResponseAnnotationSchema = z
  .object({
    type: z.string(),
    data: z.record(z.string(), z.unknown()),
    position: PositionSchema,
  })
  .passthrough();

export const RecipeContentResponseSchema = z.object({
  name: z.string(),
  image: z.string(),
  ingredients: z.array(IngredientSchema).optional(),
  instructions: z
    .array(
      z.object({
        type: z.literal("STEP"),
        text: z.string(),
        annotations: z.array(ResponseAnnotationSchema).optional(),
        missedUsages: z.array(z.unknown()).optional(),
      })
    )
    .optional(),
  recipeIngredient: z.array(z.string()).optional(),
  recipeInstructions: z.array(z.string()).optional(),
  descriptiveAssets: z.array(z.unknown()).optional(),
  isImageCopyrightOwned: z.boolean().optional(),
  prepTime: z.number().optional(),
  totalTime: z.number().optional(),
  tool: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  yield: YieldSchema.optional(),
  hints: z.string().optional(),
});

export const CreateRecipeResponseSchema = z.object({
  recipeId: z.string(),
  authorId: z.string(),
  modifiedAt: z.string(),
  createdAt: z.string(),
  status: z.string(),
  workStatus: z.string(),
  recipeContent: RecipeContentResponseSchema,
});

export const PatchRecipeResponseSchema = CreateRecipeResponseSchema;

// ---------------------------------------------------------------------------
// Image upload schemas
// ---------------------------------------------------------------------------

export const ImageSignatureRequestSchema = z.object({
  timestamp: z.number().int(),
  source: z.literal("uw"),
  custom_coordinates: z.string(),
});

export const ImageSignatureResponseSchema = z.object({
  signature: z.string(),
});

export const CloudinaryUploadResponseSchema = z.object({
  public_id: z.string(),
  secure_url: z.string(),
  url: z.string(),
}).passthrough();

export const ImagePatchSchema = z.object({
  image: z.string(),
  isImageOwnedByUser: z.boolean(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type TTSAnnotation = z.infer<typeof TTSAnnotationSchema>;
export type IngredientAnnotation = z.infer<typeof IngredientAnnotationSchema>;
export type Annotation = z.infer<typeof AnnotationSchema>;
export type Instruction = z.infer<typeof InstructionSchema>;
export type Ingredient = z.infer<typeof IngredientSchema>;
export type RecipeYield = z.infer<typeof YieldSchema>;
export type CreateRecipeRequest = z.infer<typeof CreateRecipeRequestSchema>;
export type PatchRecipeRequest = z.infer<typeof PatchRecipeRequestSchema>;
export type CreateRecipeResponse = z.infer<typeof CreateRecipeResponseSchema>;
export type PatchRecipeResponse = z.infer<typeof PatchRecipeResponseSchema>;
