/**
 * Cookidoo web auth via CIAM OAuth2 flow.
 *
 * Full flow:
 * 1. GET cookidoo.be → 302 chain → oauth2 proxy sets _oauth2_proxy_csrf → redirect to CIAM login
 * 2. Extract requestId from CIAM login URL
 * 3. POST credentials to ciam.prod.cookidoo.vorwerk-digital.com/login-srv/login
 * 4. CIAM redirects to cookidoo.be/oauth2/callback?code=...&state=...
 * 5. GET callback with _oauth2_proxy_csrf cookie → proxy sets v-authenticated + _oauth2_proxy
 */

const COOKIDOO_START = "https://cookidoo.be/created-recipes/nl-BE";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36";

type CookieJar = Map<string, string>;

function parseAllSetCookies(res: Response): CookieJar {
  const jar: CookieJar = new Map();
  const raw =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : (res.headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/);

  for (const entry of raw) {
    if (!entry.trim()) continue;
    const nameVal = entry.split(";")[0].trim();
    const eqIdx = nameVal.indexOf("=");
    if (eqIdx > 0) {
      jar.set(nameVal.slice(0, eqIdx), nameVal.slice(eqIdx + 1));
    }
  }
  return jar;
}

function mergeTo(target: CookieJar, source: CookieJar) {
  for (const [k, v] of source) target.set(k, v);
}

function toCookieStr(jar: CookieJar): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

export interface CookidooCredentials {
  username: string;
  password: string;
}

export interface CookidooAuth {
  vAuthenticated: string;
  oauth2Proxy: string;
}

export async function loginWithPassword(
  credentials: CookidooCredentials
): Promise<CookidooAuth> {
  const debug = process.env.DEBUG_AUTH === "1";
  const log = (...args: unknown[]) => { if (debug) console.error("[auth]", ...args); };

  const allCookies: CookieJar = new Map();
  const MAX_REDIRECTS = 20;

  // --- Phase 1: follow redirects from cookidoo.be to the CIAM login page ---
  log("Phase 1: starting redirect chain from", COOKIDOO_START);
  let url = COOKIDOO_START;
  let requestId: string | null = null;

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    log(`  [${i}] GET ${url}`);
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "accept-language": "nl-NL,nl;q=0.9",
        "user-agent": UA,
        ...(allCookies.size ? { cookie: toCookieStr(allCookies) } : {}),
      },
    });

    const newCookies = parseAllSetCookies(res);
    log(`  [${i}] status=${res.status}, set-cookie keys=[${[...newCookies.keys()].join(", ")}]`);
    mergeTo(allCookies, newCookies);

    const parsed = new URL(url);
    const rid = parsed.searchParams.get("requestId");
    if (rid) {
      requestId = rid;
      log(`  [${i}] found requestId=${rid}`);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      log(`  [${i}] redirect → ${loc}`);
      if (!loc) break;
      url = loc.startsWith("http") ? loc : `${parsed.origin}${loc}`;
      continue;
    }

    if (res.status === 200) {
      if (!requestId) {
        const html = await res.text();
        const match = html.match(/requestId=([a-f0-9-]+)/i);
        if (match) {
          requestId = match[1];
          log(`  [${i}] extracted requestId from HTML: ${requestId}`);
        }
      }
      log(`  [${i}] landed on 200, cookies so far: [${[...allCookies.keys()].join(", ")}]`);
      break;
    }

    throw new Error(`Auth phase 1: unexpected ${res.status} at ${url}`);
  }

  if (!requestId) {
    throw new Error("Auth phase 1: no requestId found in redirect chain");
  }
  log("Phase 1 done. requestId=%s, cookie keys=[%s]", requestId, [...allCookies.keys()].join(", "));

  // Form on eu.login.vorwerk.com POSTs to ciam.prod.cookidoo.vorwerk-digital.com
  const loginUrl = "https://ciam.prod.cookidoo.vorwerk-digital.com/login-srv/login";
  log("Phase 2: POST %s (username=%s)", loginUrl, credentials.username);

  const loginRes = await fetch(loginUrl, {
    method: "POST",
    redirect: "manual",
    headers: {
      accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
      origin: "null",
      cookie: toCookieStr(allCookies),
    },
    body: new URLSearchParams({
      requestId,
      username: credentials.username,
      password: credentials.password,
    }).toString(),
  });

  const loginCookies = parseAllSetCookies(loginRes);
  log("Phase 2: status=%d, set-cookie keys=[%s], location=%s",
    loginRes.status,
    [...loginCookies.keys()].join(", "),
    loginRes.headers.get("location") ?? "(none)");
  mergeTo(allCookies, loginCookies);

  if (loginRes.status < 300 || loginRes.status >= 400) {
    const body = await loginRes.text();
    log("Phase 2 FAILED: response body (first 500 chars):", body.slice(0, 500));
    throw new Error(
      `Auth phase 2: login POST returned ${loginRes.status} (expected redirect). Wrong credentials?`
    );
  }

  // --- Phase 3: follow redirects from CIAM back to cookidoo.be/oauth2/callback ---
  let callbackUrl = loginRes.headers.get("location");
  if (!callbackUrl) {
    throw new Error("Auth phase 2: no Location header after login POST");
  }
  if (!callbackUrl.startsWith("http")) {
    callbackUrl = `${loginOrigin}${callbackUrl}`;
  }
  log("Phase 3: following callback chain from", callbackUrl);

  for (let i = 0; i < MAX_REDIRECTS; i++) {
    log(`  [${i}] GET ${callbackUrl}`);
    const res = await fetch(callbackUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "accept-language": "nl-NL,nl;q=0.9",
        "user-agent": UA,
        cookie: toCookieStr(allCookies),
      },
    });

    const cbCookies = parseAllSetCookies(res);
    log(`  [${i}] status=${res.status}, set-cookie keys=[${[...cbCookies.keys()].join(", ")}]`);
    mergeTo(allCookies, cbCookies);

    const vAuth = allCookies.get("v-authenticated");
    const oauth2 = allCookies.get("_oauth2_proxy");
    log(`  [${i}] v-authenticated=${vAuth ? "present" : "missing"}, _oauth2_proxy=${oauth2 ? "present (" + oauth2.length + " chars)" : "missing"}`);

    if (vAuth && oauth2) {
      log("Phase 3 done — auth cookies obtained");
      return { vAuthenticated: vAuth, oauth2Proxy: oauth2 };
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      log(`  [${i}] redirect → ${loc}`);
      if (!loc) break;
      const parsed = new URL(callbackUrl);
      callbackUrl = loc.startsWith("http") ? loc : `${parsed.origin}${loc}`;
      continue;
    }

    const body = await res.text();
    log(`  [${i}] non-redirect response, body (first 500 chars):`, body.slice(0, 500));
    break;
  }

  log("Phase 3 FAILED. All cookies: [%s]", [...allCookies.keys()].join(", "));
  throw new Error(
    "Auth phase 3: did not receive v-authenticated + _oauth2_proxy cookies after callback. " +
      "Check username/password."
  );
}
