import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CACHE_FILE = join(process.cwd(), ".cookidoo-cache.json");

export const HINTS_PREFIX = "Bron: ";

interface CacheData {
  [sourceUrl: string]: string; // sourceUrl → recipeId
}

async function readCache(): Promise<CacheData> {
  try {
    const raw = await readFile(CACHE_FILE, "utf-8");
    return JSON.parse(raw) as CacheData;
  } catch {
    return {};
  }
}

async function writeCache(data: CacheData): Promise<void> {
  await writeFile(CACHE_FILE, JSON.stringify(data, null, 2) + "\n");
}

export async function getCachedRecipeId(
  sourceUrl: string
): Promise<string | null> {
  const cache = await readCache();
  return cache[sourceUrl] ?? null;
}

export async function setCachedRecipeId(
  sourceUrl: string,
  recipeId: string
): Promise<void> {
  const cache = await readCache();
  cache[sourceUrl] = recipeId;
  await writeCache(cache);
}

export async function removeCachedRecipeId(
  sourceUrl: string
): Promise<void> {
  const cache = await readCache();
  delete cache[sourceUrl];
  await writeCache(cache);
}

/** Merge multiple sourceUrl → recipeId entries into the cache (e.g. after syncing from HTML list). */
export async function mergeCachedRecipeIds(
  entries: Record<string, string>
): Promise<void> {
  const cache = await readCache();
  for (const [url, id] of Object.entries(entries)) {
    cache[url] = id;
  }
  await writeCache(cache);
}

export function buildHints(sourceUrl: string): string {
  return `${HINTS_PREFIX}${sourceUrl}`;
}
