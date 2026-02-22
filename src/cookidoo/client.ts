import {
  CreateRecipeRequestSchema,
  CreateRecipeResponseSchema,
  ImageSignatureResponseSchema,
  CloudinaryUploadResponseSchema,
  PatchRecipeRequestSchema,
  PatchRecipeResponseSchema,
  type CreateRecipeRequest,
  type CreateRecipeResponse,
  type PatchRecipeRequest,
  type PatchRecipeResponse,
} from "./schemas.js";
import {
  loginWithPassword,
  type CookidooAuth,
} from "./auth.js";

const BASE_URL = "https://cookidoo.be";
const LOCALE = "nl-BE";

const CLOUDINARY_CLOUD = "vorwerk-users-gc";
const CLOUDINARY_API_KEY = "993585863591145";
const CLOUDINARY_UPLOAD_PRESET = "prod-customer-recipe-signed";

/**
 * Reads image dimensions from JPEG or PNG binary data without an external library.
 * Falls back to a large bounding box if parsing fails.
 */
function getImageDimensions(buf: Buffer): { width: number; height: number } {
  const fallback = { width: 4000, height: 4000 };
  try {
    if (buf[0] === 0x89 && buf[1] === 0x50) {
      // PNG: width/height at bytes 16-23
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      // JPEG: scan for SOF0/SOF2 marker (0xFFC0 or 0xFFC2)
      let offset = 2;
      while (offset < buf.length - 8) {
        if (buf[offset] !== 0xff) break;
        const marker = buf[offset + 1];
        if (marker === 0xc0 || marker === 0xc2) {
          return {
            height: buf.readUInt16BE(offset + 5),
            width: buf.readUInt16BE(offset + 7),
          };
        }
        const len = buf.readUInt16BE(offset + 2);
        offset += 2 + len;
      }
    }
  } catch {}
  return fallback;
}

export class CookidooClient {
  private auth: CookidooAuth;

  constructor(auth: CookidooAuth) {
    this.auth = auth;
  }

  static async login(credentials: {
    username: string;
    password: string;
  }): Promise<CookidooClient> {
    const auth = await loginWithPassword(credentials);
    return new CookidooClient(auth);
  }

  static async fromEnvAsync(): Promise<CookidooClient> {
    const username = process.env.COOKIDOO_USERNAME;
    const password = process.env.COOKIDOO_PASSWORD;
    if (!username || !password) {
      throw new Error(
        "Missing COOKIDOO_USERNAME or COOKIDOO_PASSWORD in environment"
      );
    }
    return CookidooClient.login({ username, password });
  }

  private get cookieHeader(): string {
    return [
      `tmde-lang=${LOCALE}`,
      "v-is-authenticated=true",
      `_oauth2_proxy=${this.auth.oauth2Proxy}`,
      `v-authenticated=${this.auth.vAuthenticated}`,
    ].join("; ");
  }

  private get baseHeaders(): Record<string, string> {
    return {
      accept: "application/json",
      "content-type": "application/json",
      cookie: this.cookieHeader,
      origin: BASE_URL,
      "x-requested-with": "xmlhttprequest",
    };
  }

  async createRecipe(
    request: CreateRecipeRequest
  ): Promise<CreateRecipeResponse> {
    const body = CreateRecipeRequestSchema.parse(request);

    const res = await fetch(`${BASE_URL}/created-recipes/${LOCALE}`, {
      method: "POST",
      headers: {
        ...this.baseHeaders,
        referer: `${BASE_URL}/created-recipes/${LOCALE}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Cookidoo POST create failed (${res.status}): ${text}`
      );
    }

    const json = await res.json();
    return CreateRecipeResponseSchema.parse(json);
  }

  async updateRecipe(
    recipeId: string,
    request: PatchRecipeRequest
  ): Promise<PatchRecipeResponse> {
    const body = PatchRecipeRequestSchema.parse(request);

    const res = await fetch(
      `${BASE_URL}/created-recipes/${LOCALE}/${recipeId}`,
      {
        method: "PATCH",
        headers: {
          ...this.baseHeaders,
          referer: `${BASE_URL}/created-recipes/${LOCALE}/${recipeId}/edit`,
        },
        body: JSON.stringify(body),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Cookidoo PATCH update failed (${res.status}): ${text}`
      );
    }

    const json = await res.json();
    return PatchRecipeResponseSchema.parse(json);
  }

  /**
   * Downloads an image from a URL and uploads it to the recipe via Cloudinary.
   * 3-step flow: get signature -> upload to Cloudinary -> PATCH recipe with image path.
   */
  async uploadImage(
    recipeId: string,
    imageUrl: string
  ): Promise<PatchRecipeResponse> {
    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) {
      throw new Error(`Failed to download image from ${imageUrl}: ${imageRes.status}`);
    }
    const imageBuffer = Buffer.from(await imageRes.arrayBuffer());

    const contentType = imageRes.headers.get("content-type") ?? "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpg";

    const { width, height } = getImageDimensions(imageBuffer);
    const coords = `0,0,${width},${height}`;

    const timestamp = Math.floor(Date.now() / 1000);
    const sigRes = await fetch(
      `${BASE_URL}/created-recipes/${LOCALE}/image/signature`,
      {
        method: "POST",
        headers: this.baseHeaders,
        body: JSON.stringify({
          timestamp,
          source: "uw",
          custom_coordinates: coords,
        }),
      }
    );
    if (!sigRes.ok) {
      const text = await sigRes.text();
      throw new Error(`Cookidoo image signature failed (${sigRes.status}): ${text}`);
    }
    const sigData = ImageSignatureResponseSchema.parse(await sigRes.json());

    const formData = new FormData();
    formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    formData.append("source", "uw");
    formData.append("signature", sigData.signature);
    formData.append("timestamp", String(timestamp));
    formData.append("api_key", CLOUDINARY_API_KEY);
    formData.append("custom_coordinates", coords);
    formData.append(
      "file",
      new Blob([imageBuffer], { type: contentType }),
      `recipe-image.${ext}`
    );

    const cloudRes = await fetch(
      `https://api-eu.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`,
      {
        method: "POST",
        body: formData,
      }
    );
    if (!cloudRes.ok) {
      const text = await cloudRes.text();
      throw new Error(`Cloudinary upload failed (${cloudRes.status}): ${text}`);
    }
    const cloudData = CloudinaryUploadResponseSchema.parse(await cloudRes.json());

    const imagePath = cloudData.public_id + "." + ext;
    return this.updateRecipe(recipeId, {
      image: imagePath,
      isImageOwnedByUser: false,
    });
  }

  async deleteRecipe(recipeId: string): Promise<void> {
    const res = await fetch(
      `${BASE_URL}/created-recipes/${LOCALE}/${recipeId}`,
      {
        method: "DELETE",
        headers: this.baseHeaders,
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Cookidoo DELETE failed (${res.status}): ${text}`
      );
    }
  }
}
