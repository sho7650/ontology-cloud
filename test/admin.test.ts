/** Worker 全体 (SELF): 管理画面のアクセス制御、リセット、MCP エンドポイントの 401、OAuth メタデータ。 */
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SESSION_COOKIE,
  STATE_COOKIE,
  createSessionCookie,
  createStateCookie,
  csrfToken,
  readSession,
  sign,
  timingSafeEqual,
  verify,
  verifyState,
} from "../src/admin/session";
import { esc } from "../src/admin/views";
import { recentAudit } from "../src/store/audit";
import { getObject, listAllObjects } from "../src/store/objects";
import { resetSampleData } from "../src/store/seed";

const SECRET = env.COOKIE_ENCRYPTION_KEY;
const OWNER = env.OWNER_EMAIL;
const BASE = "https://ontology.example.com";

const cookieValue = (setCookie: string): string => setCookie.split(";")[0];

async function ownerCookie(): Promise<string> {
  return cookieValue(await createSessionCookie(SECRET, OWNER));
}

beforeEach(async () => {
  await resetSampleData(env.DB);
});
afterEach(() => vi.restoreAllMocks());

/** Google のトークン交換と userinfo だけを差し替え、それ以外の fetch は素通しする。 */
function mockGoogle(email: string): void {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://accounts.google.com/o/oauth2/token")) return Response.json({ access_token: "tok" });
    if (url.startsWith("https://www.googleapis.com/oauth2/v2/userinfo")) return Response.json({ email });
    return real(input, init);
  });
}

describe("session helpers", () => {
  it("round-trips signed values and rejects tampering", async () => {
    const token = await sign(SECRET, "hello");
    expect(await verify(SECRET, token)).toBe("hello");
    expect(await verify(SECRET, `${token}x`)).toBeNull();
    expect(await verify(SECRET, "nodot")).toBeNull();
    expect(await verify("other-secret", token)).toBeNull();
    expect(await verify(SECRET, undefined)).toBeNull();
  });

  it("reads a valid session and ignores expired or forged ones", async () => {
    const valid = new Request(BASE, { headers: { Cookie: await ownerCookie() } });
    expect(await readSession(valid, SECRET)).toBe(OWNER);
    const expired = new Request(BASE, { headers: { Cookie: cookieValue(await createSessionCookie(SECRET, OWNER, -10)) } });
    expect(await readSession(expired, SECRET)).toBeNull();
    const forged = new Request(BASE, { headers: { Cookie: `${SESSION_COOKIE}=${btoa(JSON.stringify({ email: OWNER, exp: 9e9 }))}.sig` } });
    expect(await readSession(forged, SECRET)).toBeNull();
    const garbage = new Request(BASE, { headers: { Cookie: `${SESSION_COOKIE}=${await sign(SECRET, "not json")}` } });
    expect(await readSession(garbage, SECRET)).toBeNull();
  });

  it("verifies OAuth state only while unexpired and matching", async () => {
    const { state, setCookie } = await createStateCookie(SECRET);
    const withCookie = (c: string): Request => new Request(BASE, { headers: { Cookie: cookieValue(c) } });
    expect(await verifyState(withCookie(setCookie), SECRET, state)).toBe(true);
    expect(await verifyState(withCookie(setCookie), SECRET, "other")).toBe(false);
    expect(await verifyState(withCookie(setCookie), SECRET, undefined)).toBe(false);
    expect(await verifyState(new Request(BASE), SECRET, state)).toBe(false);
    const expired = await createStateCookie(SECRET, -1);
    expect(await verifyState(withCookie(expired.setCookie), SECRET, expired.state)).toBe(false);
    const garbage = new Request(BASE, { headers: { Cookie: `${STATE_COOKIE}=${await sign(SECRET, "not json")}` } });
    expect(await verifyState(garbage, SECRET, state)).toBe(false);
  });

  it("timingSafeEqual compares whole strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "ab")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("escapes HTML", () => {
    expect(esc(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

describe("GET /admin", () => {
  it("shows the login page without a session", async () => {
    const res = await SELF.fetch(`${BASE}/admin`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Google でログイン");
    expect(html).not.toContain("audit_log");
  });

  it("ignores a forged cookie", async () => {
    const res = await SELF.fetch(`${BASE}/admin`, { headers: { Cookie: `${SESSION_COOKIE}=forged.value` } });
    expect(await res.text()).toContain("Google でログイン");
  });

  it("shows the dashboard for the owner", async () => {
    const res = await SELF.fetch(`${BASE}/admin`, { headers: { Cookie: await ownerCookie() } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(OWNER);
    expect(html).toContain("山田商事");
    expect(html).toContain("audit_log");
    expect(html).toContain('name="csrf"');
  });

  it("redirects /admin/login to Google with a state cookie", async () => {
    const res = await SELF.fetch(`${BASE}/admin/login`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location") ?? "");
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("redirect_uri")).toBe(`${BASE}/admin/callback`);
    expect(location.searchParams.get("state")).toBeTruthy();
    expect(res.headers.get("Set-Cookie")).toContain("admin_oauth_state=");
  });
});

describe("GET /admin/callback", () => {
  async function loginFlow(email: string): Promise<Response> {
    const login = await SELF.fetch(`${BASE}/admin/login`, { redirect: "manual" });
    const state = new URL(login.headers.get("Location") ?? "").searchParams.get("state") ?? "";
    const stateCookie = cookieValue(login.headers.get("Set-Cookie") ?? "");
    mockGoogle(email);
    return SELF.fetch(`${BASE}/admin/callback?code=abc&state=${encodeURIComponent(state)}`, {
      redirect: "manual",
      headers: { Cookie: stateCookie },
    });
  }

  it("issues a session for the owner", async () => {
    const res = await loginFlow(OWNER);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/admin");
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.includes("Max-Age=0"))).toBe(true);
  });

  it("refuses other Google accounts", async () => {
    const res = await loginFlow("someone@example.com");
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("所有者ではありません");
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
  });

  it("rejects a mismatched state", async () => {
    const res = await SELF.fetch(`${BASE}/admin/callback?code=abc&state=wrong`, { redirect: "manual" });
    expect(res.status).toBe(400);
  });
});

describe("POST /admin/reset", () => {
  it("requires an owner session", async () => {
    const res = await SELF.fetch(`${BASE}/admin/reset`, { method: "POST", body: new URLSearchParams({ csrf: "x" }) });
    expect(res.status).toBe(403);
  });

  it("requires a matching CSRF token", async () => {
    const res = await SELF.fetch(`${BASE}/admin/reset`, {
      method: "POST",
      headers: { Cookie: await ownerCookie() },
      body: new URLSearchParams({ csrf: "wrong" }),
    });
    expect(res.status).toBe(403);
  });

  it("resets the data and audits the reset", async () => {
    await env.DB.prepare("DELETE FROM objects WHERE type = 'Order' AND id = 'O1001'").run();
    const cookie = await ownerCookie();
    const csrf = (await csrfToken(SECRET, new Request(BASE, { headers: { Cookie: cookie } }))) ?? "";
    const res = await SELF.fetch(`${BASE}/admin/reset`, {
      method: "POST",
      redirect: "manual",
      headers: { Cookie: cookie },
      body: new URLSearchParams({ csrf }),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/admin?reset=done");
    expect(await getObject(env.DB, "Order", "O1001")).not.toBeNull();
    expect((await listAllObjects(env.DB)).length).toBeGreaterThan(40);
    const [log] = await recentAudit(env.DB);
    expect(log).toMatchObject({ actor: OWNER, action: "reset_sample_data", result: "ok" });
  });

  it("initialises a brand-new database from the dashboard and reset (no wrangler migrations)", async () => {
    await env.DB.batch([
      env.DB.prepare("DROP TABLE IF EXISTS links"),
      env.DB.prepare("DROP TABLE IF EXISTS objects"),
      env.DB.prepare("DROP TABLE IF EXISTS audit_log"),
    ]);
    const cookie = await ownerCookie();
    const page = await SELF.fetch(`${BASE}/admin`, { headers: { Cookie: cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("audit_log");

    const csrf = (await csrfToken(SECRET, new Request(BASE, { headers: { Cookie: cookie } }))) ?? "";
    const res = await SELF.fetch(`${BASE}/admin/reset`, {
      method: "POST",
      redirect: "manual",
      headers: { Cookie: cookie },
      body: new URLSearchParams({ csrf }),
    });
    expect(res.status).toBe(303);
    expect(await listAllObjects(env.DB)).toHaveLength(48);
  });

  it("logout clears the session cookie", async () => {
    const res = await SELF.fetch(`${BASE}/admin/logout`, { method: "POST", redirect: "manual", headers: { Cookie: await ownerCookie() } });
    expect(res.status).toBe(303);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});

describe("OAuth surface", () => {
  it("rejects /mcp without a bearer token", async () => {
    const res = await SELF.fetch(`${BASE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(res.status).toBe(401);
  });

  it("publishes authorization server metadata with dynamic registration", async () => {
    const res = await SELF.fetch(`${BASE}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const meta = (await res.json()) as { registration_endpoint?: string; authorization_endpoint?: string };
    expect(meta.registration_endpoint).toBe(`${BASE}/register`);
    expect(meta.authorization_endpoint).toBe(`${BASE}/authorize`);
  });

  it("serves the landing page", async () => {
    const res = await SELF.fetch(`${BASE}/`);
    expect(await res.text()).toContain(`claude mcp add --transport http ontology ${BASE}/mcp`);
  });
});

describe("public pages for the Google OAuth consent screen", () => {
  const APP = env.APP_NAME;

  it("home page explains the app under the consent-screen name without a login prompt", async () => {
    const res = await SELF.fetch(`${BASE}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`<title>${APP}</title>`);
    expect(html).toContain(`<h1>${APP}</h1>`);
    expect(html).toContain("このアプリの目的");
    expect(html).toContain("Google アカウント情報の扱い");
    expect(html).toContain(`claude mcp add --transport http ontology ${BASE}/mcp`);
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain(`mailto:${OWNER}`);
    expect(html).not.toContain('href="/admin"');
    expect(html).not.toContain("Google でログイン");
    expect(html).not.toContain("google-site-verification");
  });

  it("home page carries OGP / Twitter Card tags with absolute image URL and shows the hero image", async () => {
    const html = await (await SELF.fetch(`${BASE}/`)).text();
    const head = html.slice(0, html.indexOf("<body>"));
    expect(head).toContain(`<meta property="og:image" content="${BASE}/og-image.jpg">`);
    expect(head).toContain(`<meta property="og:url" content="${BASE}/">`);
    expect(head).toContain(`<meta property="og:title" content="${APP}">`);
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(head).toContain(`<meta name="twitter:image" content="${BASE}/og-image.jpg">`);
    expect(head).toContain('<meta name="description" content="');
    expect(html).toContain('<img src="/hero.jpg"');
  });

  it("serves the images as static assets", async () => {
    for (const path of ["/og-image.jpg", "/hero.jpg"]) {
      const res = await SELF.fetch(`${BASE}${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get("content-type"), path).toContain("image/jpeg");
    }
  });

  it("privacy policy is bilingual and covers collection, use, storage, sharing, deletion", async () => {
    const res = await SELF.fetch(`${BASE}/privacy`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    for (const needle of [
      `${APP} プライバシーポリシー`,
      `${APP} Privacy Policy (English)`,
      "<code>email</code>",
      "<code>profile</code>",
      "削除の請求",
      "Google API Services User Data Policy",
      "Limited Use",
      "myaccount.google.com/permissions",
      `mailto:${OWNER}`,
      `${BASE}/`,
    ]) {
      expect(html, needle).toContain(needle);
    }
  });

  it("terms of service is bilingual", async () => {
    const res = await SELF.fetch(`${BASE}/terms`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`${APP} 利用規約`);
    expect(html).toContain(`${APP} Terms of Service (English)`);
    expect(html).toContain("すべての利用者の間で共有");
    expect(html).toContain('href="/privacy"');
  });

  it("OAuth approval dialog shows the consent-screen app name", async () => {
    const reg = await SELF.fetch(`${BASE}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "probe", redirect_uris: ["http://localhost:9999/callback"] }),
    });
    const { client_id } = (await reg.json()) as { client_id: string };
    const params = new URLSearchParams({
      response_type: "code",
      client_id,
      redirect_uri: "http://localhost:9999/callback",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
      state: "s",
    });
    const res = await SELF.fetch(`${BASE}/authorize?${params}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(APP);
  });
});
