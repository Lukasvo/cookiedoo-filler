# Cookiedoo Filler

Import vegan recipes from **Deliciously Ella** into **Cookidoo** (Thermomix TM6) with automatic translation to Thermomix notation and Dutch.

## Prerequisites

- Node.js 18+
- Cookidoo account (cookidoo.be or your locale)
- OpenAI API key

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your credentials
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `COOKIDOO_USERNAME` | Cookidoo login email |
| `COOKIDOO_PASSWORD` | Cookidoo password |
| `OPENAI_API_KEY`   | OpenAI API key (used for translation) |

---

## Adding New Recipes

### Single recipe (interactive)

```bash
npm run start <deliciously-ella-recipe-url>
```

Example:

```bash
npm run start "https://deliciouslyella.com/recipes/creamy-mushroom-pasta"
```

Flow:

1. Scrapes the recipe from Deliciously Ella
2. Translates to Thermomix TM6 format (Dutch, metric units, TTS annotations)
3. Shows a preview and asks for confirmation
4. Logs in to Cookidoo, creates a blank recipe, fills it, and optionally uploads the image

### Bulk import (non-interactive)

```bash
npm run bulk <url1,url2,url3,...>
```

Example:

```bash
npm run bulk "https://deliciouslyella.com/recipes/creamy-mushroom-pasta,https://deliciouslyella.com/recipes/green-smoothie"
```

- Logs in once, then imports each recipe in sequence
- Skips confirmation; reports success/failure per recipe and a final summary

---

## Project Structure

```
src/
├── index.ts        # Single-recipe CLI
├── bulk.ts         # Bulk import CLI
├── scraper.ts      # Deliciously Ella JSON-LD scraper
├── translator.ts   # LLM → Thermomix TM6 translator
├── prompts.ts      # System prompt for translation
└── cookidoo/
    ├── auth.ts     # CIAM OAuth2 login
    ├── client.ts   # Cookidoo API client
    └── schemas.ts  # Zod schemas for requests/responses
```

---

## Reverse-Engineered APIs

The Cookidoo integration is based on browser network inspection (Feb 2026). There is no official public API.

### Base URL & Locale

- **Base URL:** `https://cookidoo.be`
- **Locale:** `nl-BE` (used in all endpoints; change for other locales)

### Authentication

Cookidoo uses **Vorwerk CIAM** (Central Identity and Access Management) behind an **OAuth2 proxy**. Authentication is cookie-based after completing the CIAM flow.

#### Auth flow (3 phases)

1. **Phase 1 – Redirect chain to CIAM login**
   - `GET https://cookidoo.be/created-recipes/nl-BE`
   - OAuth2 proxy sets `_oauth2_proxy_csrf` cookie
   - Redirects through CIAM until the login page
   - Extract `requestId` from the URL or HTML

2. **Phase 2 – Submit credentials**
   - `POST https://ciam.prod.cookidoo.vorwerk-digital.com/login-srv/login`
   - Body: `application/x-www-form-urlencoded` with `requestId`, `username`, `password`
   - CIAM responds with 302 redirect to `cookidoo.be/oauth2/callback`

3. **Phase 3 – Callback and cookies**
   - Follow redirects to `cookidoo.be/oauth2/callback?code=...&state=...`
   - OAuth2 proxy sets:
     - `v-authenticated` – Vorwerk auth token
     - `_oauth2_proxy` – proxy session

#### Required cookies for API calls

| Cookie | Source | Purpose |
|--------|--------|---------|
| `tmde-lang` | Static | Locale (e.g. `nl-BE`) |
| `v-is-authenticated` | Static | `true` |
| `v-authenticated` | Phase 3 | Vorwerk auth token |
| `_oauth2_proxy` | Phase 3 | Proxy session |

All subsequent API calls use these cookies; no Bearer token is sent.

---

### Cookidoo Recipe API

All recipe endpoints expect:

- `Accept: application/json`
- `Content-Type: application/json`
- `Origin: https://cookidoo.be`
- `X-Requested-With: xmlhttprequest`
- `Cookie: tmde-lang=nl-BE; v-is-authenticated=true; _oauth2_proxy=...; v-authenticated=...`

#### POST Create recipe

```
POST /created-recipes/nl-BE
```

**Request body:**

```json
{
  "recipeName": "My Recipe",
  "yield": { "value": 4, "unitText": "portion" }
}
```

**Response:**

```json
{
  "recipeId": "01KJ18TC81XWNVTMS7H6J7JK8M",
  "authorId": "...",
  "modifiedAt": "...",
  "createdAt": "...",
  "status": "...",
  "workStatus": "...",
  "recipeContent": { ... }
}
```

#### PATCH Update recipe

```
PATCH /created-recipes/nl-BE/{recipeId}
```

**Request body (partial):**

```json
{
  "name": "My Recipe",
  "totalTime": 3600,
  "prepTime": 900,
  "yield": { "value": 4, "unitText": "portion" },
  "ingredients": [
    { "type": "INGREDIENT", "text": "200 g cashewnoten" }
  ],
  "instructions": [
    {
      "type": "STEP",
      "text": "Meng alles: 30 sec/snelheid 10.",
      "annotations": [
        {
          "type": "TTS",
          "data": {
            "speed": "10",
            "time": 30,
            "temperature": null
          },
          "position": { "offset": 11, "length": 20 }
        }
      ]
    }
  ]
}
```

**TTS annotation (Time/Temperature/Speed):**

- `speed`: `"1"`–`"10"`
- `time`: duration in seconds
- `temperature`: `{ "value": "100", "unit": "C" }` or omit for no heat
- `direction`: `"CCW"` (counter-clockwise / reverse blade) — for risotto, simmering, gentle stirring

**Reverse blade symbol in step text:**

Cookidoo uses U+E003 (Private Use Area) for the reverse blade. In notation, it appears between slashes: `20 min/100°C/⟲/snelheid 1`. The UI renders it as a counter-clockwise arrow. Our translator outputs ⟲ (U+21B6) and converts it to U+E003 when sending to the API.

#### DELETE Recipe

```
DELETE /created-recipes/nl-BE/{recipeId}
```

---

### Image upload

Images are uploaded via **Cloudinary**, not Cookidoo directly.

1. **Get signature**
   ```
   POST /created-recipes/nl-BE/image/signature
   Body: { "timestamp": <unix>, "source": "uw", "custom_coordinates": "0,0,<w>,<h>" }
   Response: { "signature": "..." }
   ```

2. **Upload to Cloudinary**
   ```
   POST https://api-eu.cloudinary.com/v1_1/vorwerk-users-gc/image/upload
   FormData: upload_preset=prod-customer-recipe-signed, signature, timestamp,
             api_key, custom_coordinates, file
   Response: { "public_id": "...", "secure_url": "...", "url": "..." }
   ```

3. **Attach to recipe**
   ```
   PATCH /created-recipes/nl-BE/{recipeId}
   Body: { "image": "<public_id>.<ext>", "isImageOwnedByUser": false }
   ```

---

## Tests

```bash
npm test
```

Tests require network access (Deliciously Ella, Cookidoo, OpenAI) and valid `.env` credentials. Scraper and Cookidoo tests will fail without network; translator test needs `OPENAI_API_KEY`.
