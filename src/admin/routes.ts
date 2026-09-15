/**
 * /admin: 所有者 (OWNER_EMAIL) 専用の管理画面。
 * MCP 側の OAuth (workers-oauth-provider) とは別に、ブラウザ用の Google ログインを持つ。
 */
import { Hono } from "hono";

import { fetchUpstreamAuthToken, getUpstreamAuthorizeUrl } from "../auth/utils";
import { RESET_ACTION } from "../mcp/server";
import { recentAudit, writeAudit } from "../store/audit";
import { listAllLinks, listAllObjects } from "../store/objects";
import { ensureSchema } from "../store/schema";
import { resetSampleData } from "../store/seed";
import {
  clearSessionCookie,
  clearStateCookie,
  createSessionCookie,
  createStateCookie,
  csrfToken,
  readSession,
  timingSafeEqual,
  verifyState,
} from "./session";
import { dashboardPage, forbiddenPage, loginPage } from "./views";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://accounts.google.com/o/oauth2/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const AUDIT_ROWS = 100;

export const adminRoutes = new Hono<{ Bindings: Env }>();

/** ログイン済みの所有者 email。所有者でなければ null。 */
async function ownerSession(request: Request, env: Env): Promise<string | null> {
  const email = await readSession(request, env.COOKIE_ENCRYPTION_KEY);
  return email !== null && email === env.OWNER_EMAIL ? email : null;
}

adminRoutes.get("/", async (c) => {
  const email = await ownerSession(c.req.raw, c.env);
  if (!email) return c.html(loginPage());
  await ensureSchema(c.env.DB); // 初回デプロイ直後の空の D1 でも一覧 (空) とリセットボタンを出せるように
  const [objects, links, audit] = await Promise.all([listAllObjects(c.env.DB), listAllLinks(c.env.DB), recentAudit(c.env.DB, AUDIT_ROWS)]);
  const csrf = (await csrfToken(c.env.COOKIE_ENCRYPTION_KEY, c.req.raw)) ?? "";
  return c.html(dashboardPage({ email, csrf, objects, links, audit, resetDone: c.req.query("reset") === "done" }));
});

adminRoutes.get("/login", async (c) => {
  const { state, setCookie } = await createStateCookie(c.env.COOKIE_ENCRYPTION_KEY);
  const location = getUpstreamAuthorizeUrl({
    upstreamUrl: GOOGLE_AUTHORIZE_URL,
    clientId: c.env.GOOGLE_CLIENT_ID,
    scope: "email profile",
    redirectUri: new URL("/admin/callback", c.req.url).href,
    state,
    hostedDomain: c.env.HOSTED_DOMAIN,
  });
  return new Response(null, { status: 302, headers: { Location: location, "Set-Cookie": setCookie } });
});

adminRoutes.get("/callback", async (c) => {
  if (!(await verifyState(c.req.raw, c.env.COOKIE_ENCRYPTION_KEY, c.req.query("state")))) {
    return c.text("Invalid OAuth state", 400);
  }
  const [accessToken, errorResponse] = await fetchUpstreamAuthToken({
    upstreamUrl: GOOGLE_TOKEN_URL,
    clientId: c.env.GOOGLE_CLIENT_ID,
    clientSecret: c.env.GOOGLE_CLIENT_SECRET,
    code: c.req.query("code"),
    redirectUri: new URL("/admin/callback", c.req.url).href,
    grantType: "authorization_code",
  });
  if (errorResponse) return errorResponse;

  const userinfo = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!userinfo.ok) return c.text("Failed to fetch user info", 502);
  const { email } = (await userinfo.json()) as { email?: string };
  if (!email) return c.text("Google account has no email", 400);

  const headers = new Headers();
  headers.append("Set-Cookie", clearStateCookie());
  if (email !== c.env.OWNER_EMAIL) {
    return new Response(forbiddenPage(email), { status: 403, headers: { ...Object.fromEntries(headers), "Content-Type": "text/html; charset=utf-8" } });
  }
  headers.append("Set-Cookie", await createSessionCookie(c.env.COOKIE_ENCRYPTION_KEY, email));
  headers.set("Location", "/admin");
  return new Response(null, { status: 302, headers });
});

adminRoutes.post("/reset", async (c) => {
  const email = await ownerSession(c.req.raw, c.env);
  if (!email) return c.text("Forbidden", 403);
  const form = await c.req.raw.formData();
  const expected = await csrfToken(c.env.COOKIE_ENCRYPTION_KEY, c.req.raw);
  const submitted = form.get("csrf");
  if (!expected || typeof submitted !== "string" || !timingSafeEqual(submitted, expected)) return c.text("Invalid CSRF token", 403);

  await resetSampleData(c.env.DB);
  await writeAudit(c.env.DB, { actor: email, action: RESET_ACTION, targetType: "*", targetId: "*", params: {}, before: null, after: null, result: "ok" });
  return c.redirect("/admin?reset=done", 303);
});

adminRoutes.post("/logout", (c) => {
  return new Response(null, { status: 303, headers: { Location: "/admin", "Set-Cookie": clearSessionCookie() } });
});
